import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, auditLogs, dealChangeLogs, emailDrafts, workflowSteps, workflowInstances } from "@/lib/db/schema";
import { updateDealSchema, isValidTransition, RE_NOTIFICATION_FIELDS } from "@/lib/types/deal";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { DealStatus } from "@/lib/db/schema";

// Map camelCase deal field names → snake_case merge field keys used in templates
const DEAL_FIELD_TO_MERGE_KEY: Record<string, string> = {
  vesselName: "vessel_name",
  vesselImo: "vessel_imo",
  quantityMt: "quantity_mt",
  laycanStart: "laycan_start",
  laycanEnd: "laycan_end",
  loadport: "loadport",
  dischargePort: "discharge_port",
  product: "product",
  counterparty: "counterparty",
  incoterm: "incoterm",
  pricingFormula: "pricing_formula",
  externalRef: "external_ref",
};

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/deals/:id — Full deal detail
export const GET = withAuth(async (_req, ctx, session) => {
  const { id } = await (ctx as RouteContext).params;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
      .limit(1);

    if (!deal) return null;

    // Fetch change history and audit log
    const [changes, logs] = await Promise.all([
      db
        .select()
        .from(dealChangeLogs)
        .where(eq(dealChangeLogs.dealId, id))
        .orderBy(desc(dealChangeLogs.createdAt))
        .limit(50),
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.dealId, id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50),
    ]);

    return { ...deal, changeHistory: changes, auditLog: logs };
  });

  if (!result) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Traders don't see raw source text
  if (session.user.role === "trader") {
    result.sourceRawText = null;
  }

  return NextResponse.json(result);
});

// PUT /api/deals/:id — Update deal with change detection (operator/admin)
export const PUT = withAuth(
  async (req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;
    const body = await req.json();
    const validated = updateDealSchema.parse(body);
    const { version, status: newStatus, ...updates } = validated;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // Fetch current deal for change detection
      const [current] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
        .limit(1);

      if (!current || current.version !== version) {
        return { error: "not_found_or_conflict" as const };
      }

      // Validate status transition
      if (newStatus && newStatus !== current.status) {
        if (!isValidTransition(current.status as DealStatus, newStatus as DealStatus)) {
          return {
            error: "invalid_transition" as const,
            message: `Cannot transition from ${current.status} to ${newStatus}`,
          };
        }
      }

      // Build update payload
      const updatePayload: Record<string, unknown> = {
        ...updates,
        version: version + 1,
        updatedAt: new Date(),
      };
      if (newStatus) updatePayload.status = newStatus;
      if (updates.quantityMt) updatePayload.quantityMt = String(updates.quantityMt);

      // Perform update with optimistic lock
      const [updated] = await db
        .update(deals)
        .set(updatePayload)
        .where(
          and(
            eq(deals.id, id),
            eq(deals.tenantId, session.user.tenantId),
            eq(deals.version, version)
          )
        )
        .returning();

      if (!updated) {
        return { error: "not_found_or_conflict" as const };
      }

      // Change detection: log every field that changed
      const fieldsToCheck: string[] = Object.keys(updates);
      if (newStatus && newStatus !== current.status) {
        fieldsToCheck.push("status");
      }

      for (const field of fieldsToCheck) {
        const oldVal = String((current as any)[field] ?? "");
        const newVal = String(field === "status" ? newStatus : (updates as any)[field] ?? "");
        if (oldVal !== newVal) {
          await db.insert(dealChangeLogs).values({
            tenantId: session.user.tenantId,
            dealId: id,
            fieldChanged: field,
            oldValue: oldVal || null,
            newValue: newVal || null,
            changedBy: session.user.id,
          });
        }
      }

      // Re-notification: scan sent/acknowledged drafts whose merge fields overlap with changed fields
      const changedFields = fieldsToCheck.filter((f) => {
        const o = String((current as any)[f] ?? "");
        const n = String(f === "status" ? newStatus : (updates as any)[f] ?? "");
        return o !== n;
      });

      const reNotifyFields = changedFields.filter((f) =>
        (RE_NOTIFICATION_FIELDS as readonly string[]).includes(f)
      );

      if (reNotifyFields.length > 0) {
        // Find the workflow instance for this deal
        const [instance] = await db
          .select()
          .from(workflowInstances)
          .where(and(
            eq(workflowInstances.dealId, id),
            eq(workflowInstances.tenantId, session.user.tenantId)
          ));

        if (instance) {
          // Get all sent/acknowledged steps for this instance
          const sentSteps = await db
            .select()
            .from(workflowSteps)
            .where(
              and(
                eq(workflowSteps.workflowInstanceId, instance.id),
                inArray(workflowSteps.status, ["sent", "acknowledged"])
              )
            );

          const stepIdsWithDrafts = sentSteps
            .map((s) => s.emailDraftId)
            .filter((id): id is string => id != null);

          if (stepIdsWithDrafts.length > 0) {
            // Fetch the drafts and check mergeFieldsUsed
            const draftsToCheck = await db
              .select()
              .from(emailDrafts)
              .where(inArray(emailDrafts.id, stepIdsWithDrafts));

            // Build merge keys for changed fields
            const changedMergeKeys = reNotifyFields
              .map((f) => DEAL_FIELD_TO_MERGE_KEY[f])
              .filter(Boolean);

            // Find draft IDs whose mergeFieldsUsed includes any changed key
            const affectedDraftIds = draftsToCheck
              .filter((d) => {
                const used = (d.mergeFieldsUsed ?? {}) as Record<string, string>;
                return changedMergeKeys.some((k) => k in used);
              })
              .map((d) => d.id);

            if (affectedDraftIds.length > 0) {
              // Map draftId → stepId
              const affectedStepIds = sentSteps
                .filter((s) => s.emailDraftId && affectedDraftIds.includes(s.emailDraftId))
                .map((s) => s.id);

              if (affectedStepIds.length > 0) {
                await db
                  .update(workflowSteps)
                  .set({ status: "needs_update" })
                  .where(inArray(workflowSteps.id, affectedStepIds));

                await db.insert(auditLogs).values({
                  tenantId: session.user.tenantId,
                  dealId: id,
                  userId: session.user.id,
                  action: "workflow.re_notification_flagged",
                  details: {
                    changedFields: reNotifyFields,
                    affectedSteps: affectedStepIds.length,
                  },
                });
              }
            }
          }
        }
      }

      // Audit log
      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: id,
        userId: session.user.id,
        action: newStatus && newStatus !== current.status ? "deal.status_changed" : "deal.updated",
        details: {
          changes: Object.fromEntries(
            changedFields
              .map((f) => [
                f,
                {
                  from: (current as any)[f],
                  to: f === "status" ? newStatus : (updates as any)[f],
                },
              ])
          ),
        },
      });

      return { deal: updated };
    });

    if ("error" in result) {
      if (result.error === "not_found_or_conflict") {
        return NextResponse.json(
          { error: "Deal not found or version conflict" },
          { status: 409 }
        );
      }
      if (result.error === "invalid_transition") {
        return NextResponse.json({ error: result.message }, { status: 422 });
      }
    }

    return NextResponse.json((result as any).deal);
  },
  { roles: ["operator", "admin"] }
);

// DELETE /api/deals/:id — Cancel deal (operator/admin)
export const DELETE = withAuth(
  async (_req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [current] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
        .limit(1);

      if (!current) return null;

      if (!isValidTransition(current.status as DealStatus, "cancelled")) {
        return { error: `Cannot cancel a deal in ${current.status} status` };
      }

      const [updated] = await db
        .update(deals)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
        .returning();

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: id,
        userId: session.user.id,
        action: "deal.cancelled",
        details: { previousStatus: current.status },
      });

      return updated;
    });

    if (!result) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json(result);
  },
  { roles: ["operator", "admin"] }
);
