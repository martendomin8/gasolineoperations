import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import {
  deals,
  auditLogs,
  workflowInstances,
  workflowSteps,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// Map Excel column names → workflow step matching criteria
// ---------------------------------------------------------------------------

const FIELD_TO_STEP_MATCH: Record<
  string,
  { stepType?: string; nameIncludes?: string; excludeNameIncludes?: string }
> = {
  docInstructions: { stepType: "instruction" },
  voyOrders: { stepType: "order", nameIncludes: "voyage" },
  disOrders: { stepType: "order", nameIncludes: "discharge" },
  vesselNomination: { stepType: "nomination", excludeNameIncludes: "discharge" },
  supervision: { stepType: "appointment" },
  dischargeNomination: { stepType: "nomination", nameIncludes: "discharge" },
};

// These are operator-managed columns — stored directly on the deal as JSONB
const OPERATOR_MANAGED_FIELDS = new Set([
  "coaToTraders",
  "outturn",
  "freightInvoice",
  "tax",
  "invoiceToCp",
  "demurrage",
]);

// Pricing-specific fields that update deal columns directly
const PRICING_FIELDS = new Set([
  "pricingConfirmed",
  "estimatedBlNorDate",
]);

const statusFieldSchema = z.object({
  field: z.string().min(1),
  value: z.string(),
});

// ---------------------------------------------------------------------------
// PUT /api/deals/:id/status-field — Update a single status field inline
// ---------------------------------------------------------------------------

export const PUT = withAuth(
  async (req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = statusFieldSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const { field, value } = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // Verify deal exists and belongs to tenant
      const [deal] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
        .limit(1);

      if (!deal) return { error: "not_found" as const };

      // --- Pricing fields: update deal columns directly ---
      if (PRICING_FIELDS.has(field)) {
        const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
        if (field === "pricingConfirmed") {
          updatePayload.pricingConfirmed = value === "true" || value === "1";
        } else if (field === "estimatedBlNorDate") {
          updatePayload.estimatedBlNorDate = value || null;
        }

        await db
          .update(deals)
          .set(updatePayload)
          .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)));

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: id,
          userId: session.user.id,
          action: "deal.pricing_updated",
          details: { field, value },
        });

        return { ok: true, field, value };
      }

      // --- Operator-managed fields: stored as excelStatuses JSONB ---
      if (OPERATOR_MANAGED_FIELDS.has(field)) {
        const currentStatuses =
          ((deal as Record<string, unknown>).excelStatuses as Record<string, string> | null) ?? {};
        const updatedStatuses = { ...currentStatuses, [field]: value || null };

        await db
          .update(deals)
          .set({ excelStatuses: updatedStatuses, updatedAt: new Date() } as Record<string, unknown>)
          .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)));

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: id,
          userId: session.user.id,
          action: "deal.excel_status_updated",
          details: { field, value },
        });

        return { ok: true, field, value };
      }

      // --- Workflow step fields: advance the matching step ---
      const matcher = FIELD_TO_STEP_MATCH[field];
      if (!matcher) {
        return { error: "unknown_field" as const, message: `Unknown field: ${field}` };
      }

      // Find workflow instance for this deal
      const [instance] = await db
        .select()
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.dealId, id),
            eq(workflowInstances.tenantId, session.user.tenantId)
          )
        )
        .limit(1);

      if (!instance) {
        // No workflow instance — store as operator-managed fallback
        const currentStatuses =
          ((deal as Record<string, unknown>).excelStatuses as Record<string, string> | null) ?? {};
        const updatedStatuses = { ...currentStatuses, [field]: value || null };

        await db
          .update(deals)
          .set({ excelStatuses: updatedStatuses, updatedAt: new Date() } as Record<string, unknown>)
          .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)));

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: id,
          userId: session.user.id,
          action: "deal.excel_status_updated",
          details: { field, value, fallback: true },
        });

        return { ok: true, field, value };
      }

      // Find matching step
      const steps = await db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowInstanceId, instance.id));

      const matchingStep = steps.find((s) => {
        const nameLower = s.stepName.toLowerCase();
        if (matcher.stepType && s.stepType !== matcher.stepType) return false;
        if (matcher.nameIncludes && !nameLower.includes(matcher.nameIncludes)) return false;
        if (matcher.excludeNameIncludes && nameLower.includes(matcher.excludeNameIncludes))
          return false;
        return true;
      });

      if (!matchingStep) {
        // No matching step found — fall back to excelStatuses JSONB storage
        const currentStatuses =
          ((deal as Record<string, unknown>).excelStatuses as Record<string, string> | null) ?? {};
        const updatedStatuses = { ...currentStatuses, [field]: value || null };

        await db
          .update(deals)
          .set({ excelStatuses: updatedStatuses, updatedAt: new Date() } as Record<string, unknown>)
          .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)));

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: id,
          userId: session.user.id,
          action: "deal.excel_status_updated",
          details: { field, value, fallback: "no_matching_step" },
        });

        return { ok: true, field, value };
      }

      // Map display value to step status
      const newStepStatus =
        value === "Done" ? "done" : value === "N/A" ? "na" : "ready";

      await db
        .update(workflowSteps)
        .set({ status: newStepStatus })
        .where(eq(workflowSteps.id, matchingStep.id));

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: id,
        userId: session.user.id,
        action: "workflow.step_status_changed",
        details: {
          stepId: matchingStep.id,
          stepName: matchingStep.stepName,
          field,
          oldStatus: matchingStep.status,
          newStatus: newStepStatus,
        },
      });

      return { ok: true, field, value, stepId: matchingStep.id };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Deal not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: result.message ?? result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  },
  { roles: ["operator", "admin"] }
);
