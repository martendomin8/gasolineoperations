import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, linkages, auditLogs, users, workflowInstances, workflowSteps, type Deal } from "@/lib/db/schema";
import { matchTemplate, instantiateWorkflow } from "@/lib/workflow-engine";
import { createDealSchema, dealFilterSchema } from "@/lib/types/deal";
import { eq, and, ilike, or, desc, sql, like } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/** Map workflow step status to display value for Excel view */
function stepStatusToDisplay(status: string | null): string | null {
  switch (status) {
    case "sent":
    case "acknowledged":
    case "done":
      return "DONE";
    case "draft_generated":
      return "DRAFT READY";
    case "needs_update":
      return "NEEDS UPDATE";
    case "cancelled":
      return "CANCELLED";
    case "received":
      return "RECEIVED";
    case "na":
      return "N/A";
    default:
      return null;
  }
}

// GET /api/deals — Paginated deal list
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const filterResult = dealFilterSchema.safeParse({
    status: url.searchParams.get("status") || undefined,
    direction: url.searchParams.get("direction") || undefined,
    incoterm: url.searchParams.get("incoterm") || undefined,
    counterparty: url.searchParams.get("counterparty") || undefined,
    linkageCode: url.searchParams.get("linkageCode") || undefined,
    linkageId: url.searchParams.get("linkageId") || undefined,
    assignedOperatorId: url.searchParams.get("assignedOperatorId") || undefined,
    search: url.searchParams.get("search") || undefined,
    page: url.searchParams.get("page") || 1,
    perPage: url.searchParams.get("perPage") || 25,
  });
  if (!filterResult.success) {
    return NextResponse.json({ error: "Invalid filters", issues: filterResult.error.issues }, { status: 400 });
  }
  const filters = filterResult.data;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const conditions = [eq(deals.tenantId, session.user.tenantId)];

    if (filters.status) {
      conditions.push(eq(deals.status, filters.status));
    }
    // Note: completed/cancelled deals are hidden from dashboard + task queue,
    // NOT from the deals list. The deals list shows all statuses by default.
    if (filters.direction) conditions.push(eq(deals.direction, filters.direction));
    if (filters.incoterm) conditions.push(eq(deals.incoterm, filters.incoterm));
    // Prefer the stable linkageId FK — this is the grouping the linkage view uses.
    if (filters.linkageId)
      conditions.push(eq(deals.linkageId, filters.linkageId));
    if (filters.linkageCode)
      conditions.push(eq(deals.linkageCode, filters.linkageCode));
    if (filters.assignedOperatorId)
      conditions.push(eq(deals.assignedOperatorId, filters.assignedOperatorId));
    if (filters.search) {
      conditions.push(
        or(
          ilike(deals.counterparty, `%${filters.search}%`),
          ilike(deals.product, `%${filters.search}%`),
          ilike(deals.loadport, `%${filters.search}%`),
          ilike(deals.dischargePort, `%${filters.search}%`),
          ilike(deals.vesselName!, `%${filters.search}%`),
          ilike(deals.externalRef!, `%${filters.search}%`)
        )!
      );
    }

    const offset = (filters.page - 1) * filters.perPage;
    // Operators can live on either the deal OR the linkage. Per the architecture,
    // operators should live on the linkage (a voyage-level assignment), but legacy
    // deals may still carry them directly. Join both and COALESCE so the listing
    // works regardless of where the IDs are stored.
    const primaryOp = alias(users, "primaryOp");
    const secondaryOp = alias(users, "secondaryOp");
    const linkagePrimaryOp = alias(users, "linkagePrimaryOp");
    const linkageSecondaryOp = alias(users, "linkageSecondaryOp");

    const [rawItems, [{ count }]] = await Promise.all([
      db
        .select({
          id: deals.id,
          externalRef: deals.externalRef,
          linkageCode: deals.linkageCode,
          linkageId: deals.linkageId,
          dealType: deals.dealType,
          counterparty: deals.counterparty,
          direction: deals.direction,
          product: deals.product,
          quantityMt: deals.quantityMt,
          contractedQty: deals.contractedQty,
          nominatedQty: deals.nominatedQty,
          incoterm: deals.incoterm,
          loadport: deals.loadport,
          dischargePort: deals.dischargePort,
          laycanStart: deals.laycanStart,
          laycanEnd: deals.laycanEnd,
          vesselName: sql<string | null>`coalesce(${linkages.vesselName}, ${deals.vesselName})`,
          vesselImo: sql<string | null>`coalesce(${linkages.vesselImo}, ${deals.vesselImo})`,
          status: deals.status,
          pricingType: deals.pricingType,
          pricingFormula: deals.pricingFormula,
          pricingEstimatedDate: deals.pricingEstimatedDate,
          pricingPeriodType: deals.pricingPeriodType,
          pricingPeriodValue: deals.pricingPeriodValue,
          pricingConfirmed: deals.pricingConfirmed,
          estimatedBlNorDate: deals.estimatedBlNorDate,
          assignedOperatorId: sql<string | null>`coalesce(${linkages.assignedOperatorId}, ${deals.assignedOperatorId})`,
          secondaryOperatorId: sql<string | null>`coalesce(${linkages.secondaryOperatorId}, ${deals.secondaryOperatorId})`,
          loadedQuantityMt: deals.loadedQuantityMt,
          version: deals.version,
          excelStatuses: deals.excelStatuses,
          operatorName: sql<string | null>`coalesce(${linkagePrimaryOp.name}, ${primaryOp.name})`,
          secondaryOperatorName: sql<string | null>`coalesce(${linkageSecondaryOp.name}, ${secondaryOp.name})`,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .leftJoin(primaryOp, eq(deals.assignedOperatorId, primaryOp.id))
        .leftJoin(secondaryOp, eq(deals.secondaryOperatorId, secondaryOp.id))
        .leftJoin(linkages, eq(deals.linkageId, linkages.id))
        .leftJoin(linkagePrimaryOp, eq(linkages.assignedOperatorId, linkagePrimaryOp.id))
        .leftJoin(linkageSecondaryOp, eq(linkages.secondaryOperatorId, linkageSecondaryOp.id))
        .where(and(...conditions))
        .orderBy(desc(deals.createdAt))
        .limit(filters.perPage)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(and(...conditions)),
    ]);

    // Enrich with workflow step statuses for Excel view
    const dealIds = rawItems.map((d) => d.id);
    const stepStatusMap = new Map<string, Record<string, string | null>>();

    if (dealIds.length > 0) {
      const instances = await db
        .select({ id: workflowInstances.id, dealId: workflowInstances.dealId })
        .from(workflowInstances)
        .where(eq(workflowInstances.tenantId, session.user.tenantId));

      const instanceDealMap = new Map<string, string>();
      for (const inst of instances) {
        instanceDealMap.set(inst.id, inst.dealId);
      }

      if (instances.length > 0) {
        const allSteps = await db
          .select({
            workflowInstanceId: workflowSteps.workflowInstanceId,
            stepType: workflowSteps.stepType,
            stepName: workflowSteps.stepName,
            status: workflowSteps.status,
          })
          .from(workflowSteps)
          .where(eq(workflowSteps.tenantId, session.user.tenantId));

        for (const step of allSteps) {
          const dealId = instanceDealMap.get(step.workflowInstanceId);
          if (!dealId || !dealIds.includes(dealId)) continue;
          if (!stepStatusMap.has(dealId)) {
            stepStatusMap.set(dealId, {
              docInstructions: null,
              voyOrders: null,
              disOrders: null,
              vesselNomination: null,
              supervision: null,
              dischargeNomination: null,
              coaToTraders: null,
              outturn: null,
              freightInvoice: null,
              tax: null,
              invoiceToCp: null,
            });
          }
          const statuses = stepStatusMap.get(dealId)!;
          const displayStatus = stepStatusToDisplay(step.status);
          const nameLower = step.stepName.toLowerCase();

          if (step.stepType === "instruction" || nameLower.includes("doc")) {
            statuses.docInstructions = displayStatus;
          } else if (nameLower.includes("voyage") || (step.stepType === "order" && !nameLower.includes("discharge"))) {
            statuses.voyOrders = displayStatus;
          } else if (nameLower.includes("discharge") && nameLower.includes("order")) {
            statuses.disOrders = displayStatus;
          } else if (step.stepType === "nomination" && nameLower.includes("discharge")) {
            statuses.dischargeNomination = displayStatus;
          } else if (step.stepType === "nomination") {
            statuses.vesselNomination = displayStatus;
          } else if (step.stepType === "appointment" || nameLower.includes("inspector") || nameLower.includes("supervision")) {
            statuses.supervision = displayStatus;
          }
        }
      }
    }

    const items = rawItems.map((d) => {
      const stepStatuses = stepStatusMap.get(d.id) ?? {};
      const excelOverrides = (d.excelStatuses ?? {}) as Record<string, string | null>;

      // Workflow step statuses take priority; operator-managed fields come from excelStatuses
      return {
        ...d,
        docInstructions: stepStatuses.docInstructions ?? excelOverrides.docInstructions ?? null,
        voyOrders: stepStatuses.voyOrders ?? excelOverrides.voyOrders ?? null,
        disOrders: stepStatuses.disOrders ?? excelOverrides.disOrders ?? null,
        vesselNomination: stepStatuses.vesselNomination ?? excelOverrides.vesselNomination ?? null,
        supervision: stepStatuses.supervision ?? excelOverrides.supervision ?? null,
        dischargeNomination: stepStatuses.dischargeNomination ?? excelOverrides.dischargeNomination ?? null,
        coaToTraders: excelOverrides.coaToTraders ?? null,
        outturn: excelOverrides.outturn ?? null,
        freightInvoice: excelOverrides.freightInvoice ?? null,
        demurrage: excelOverrides.demurrage ?? null,
        tax: excelOverrides.tax ?? null,
        invoiceToCp: excelOverrides.invoiceToCp ?? null,
      };
    });

    return {
      items,
      total: count,
      page: filters.page,
      perPage: filters.perPage,
      totalPages: Math.ceil(count / filters.perPage),
    };
  });

  if (!result) {
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
  // No-store: deal data changes frequently (status edits, linkage renames,
  // adds, deletes). Stale data here causes cross-page consistency bugs (e.g.
  // dashboard showing TEMP-001 after a linkage rename to 911WTF).
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
});

// POST /api/deals — Create deal (operator/admin)
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const parseResult = createDealSchema.safeParse(body);
    if (!parseResult.success) {
      const first = parseResult.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const validated = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // --- Resolve linkage: every deal MUST belong to exactly one linkage ---
      // Priority:
      //   1. linkageId provided → look it up; sync linkageCode to its display name
      //   2. linkageId absent but linkageCode provided → look up linkage by code
      //      (matches linkage_number first, then temp_name) within tenant
      //   3. neither provided → auto-create a TEMP-NNN linkage
      //
      // The linkageCode fallback is the round-6 fix: previously the endpoint
      // silently auto-created a fresh TEMP linkage when the caller forgot to
      // pass linkageId, even when a perfectly valid linkageCode was supplied.
      // That made stale closures and prop drift duplicate linkages.
      let linkageId: string | null = validated.linkageId ?? null;
      let linkageCode: string | null = validated.linkageCode ?? null;

      if (linkageId) {
        const [existing] = await db
          .select({
            id: linkages.id,
            linkageNumber: linkages.linkageNumber,
            tempName: linkages.tempName,
          })
          .from(linkages)
          .where(
            and(
              eq(linkages.id, linkageId),
              eq(linkages.tenantId, session.user.tenantId)
            )
          )
          .limit(1);

        if (!existing) {
          throw new Error("Linkage not found");
        }
        // Keep linkageCode in sync with the linkage's display name
        linkageCode = existing.linkageNumber ?? existing.tempName;
      } else if (linkageCode) {
        // Fallback: look up the linkage by its display code (linkage_number,
        // then temp_name). If a match exists, attach this deal to it.
        const [byNumber] = await db
          .select({
            id: linkages.id,
            linkageNumber: linkages.linkageNumber,
            tempName: linkages.tempName,
          })
          .from(linkages)
          .where(
            and(
              eq(linkages.tenantId, session.user.tenantId),
              eq(linkages.linkageNumber, linkageCode)
            )
          )
          .limit(1);

        let matched = byNumber;
        if (!matched) {
          const [byTemp] = await db
            .select({
              id: linkages.id,
              linkageNumber: linkages.linkageNumber,
              tempName: linkages.tempName,
            })
            .from(linkages)
            .where(
              and(
                eq(linkages.tenantId, session.user.tenantId),
                eq(linkages.tempName, linkageCode)
              )
            )
            .limit(1);
          matched = byTemp;
        }

        if (matched) {
          linkageId = matched.id;
          linkageCode = matched.linkageNumber ?? matched.tempName;
        } else {
          // No match — fall through to auto-create below
          linkageId = null;
        }
      }

      if (!linkageId) {
        // Auto-create a TEMP-NNN linkage
        const [lastTemp] = await db
          .select({ tempName: linkages.tempName })
          .from(linkages)
          .where(
            and(
              eq(linkages.tenantId, session.user.tenantId),
              like(linkages.tempName, "TEMP-%")
            )
          )
          .orderBy(desc(linkages.tempName))
          .limit(1);

        let nextNumber = 1;
        if (lastTemp?.tempName) {
          const match = lastTemp.tempName.match(/^TEMP-(\d+)$/);
          if (match) nextNumber = parseInt(match[1], 10) + 1;
        }
        const tempName = `TEMP-${String(nextNumber).padStart(3, "0")}`;

        const [createdLinkage] = await db
          .insert(linkages)
          .values({
            tenantId: session.user.tenantId,
            linkageNumber: null,
            tempName,
          })
          .returning();

        linkageId = createdLinkage.id;
        linkageCode = tempName;
      }

      const [deal] = await db
        .insert(deals)
        .values({
          counterparty: validated.counterparty,
          direction: validated.direction,
          // dealType: must be persisted so terminal-op deals end up in the
          // INTERNAL/TERMINAL OPERATIONS section of the Excel view rather than
          // PURCHASE. The Zod schema defaults to "regular" so omitting this
          // here was the round-6 silent corruption bug.
          dealType: validated.dealType ?? "regular",
          product: validated.product,
          incoterm: validated.incoterm,
          loadport: validated.loadport,
          laycanStart: validated.laycanStart,
          laycanEnd: validated.laycanEnd,
          quantityMt: String(validated.quantityMt),
          nominatedQty: validated.nominatedQty != null ? String(validated.nominatedQty) : null,
          contractedQty: validated.contractedQty ?? null,
          dischargePort: validated.dischargePort ?? null,
          externalRef: validated.externalRef ?? null,
          linkageCode,
          linkageId,
          vesselName: validated.vesselName ?? null,
          vesselImo: validated.vesselImo ?? null,
          assignedOperatorId: validated.assignedOperatorId ?? null,
          secondaryOperatorId: validated.secondaryOperatorId ?? null,
          pricingFormula: validated.pricingFormula ?? null,
          pricingType: validated.pricingType ?? null,
          pricingEstimatedDate: validated.pricingEstimatedDate ?? null,
          specialInstructions: validated.specialInstructions ?? null,
          sourceRawText: validated.sourceRawText ?? null,
          tenantId: session.user.tenantId,
          createdBy: session.user.id,
        })
        .returning();

      // Propagate vessel info up to the linkage. When the deal has vessel info and
      // the linkage's corresponding vessel field is still empty, write it so all
      // sibling deals share the same vessel at the linkage level.
      if (linkageId && (validated.vesselName || validated.vesselImo)) {
        const [existingLinkage] = await db
          .select({
            vesselName: linkages.vesselName,
            vesselImo: linkages.vesselImo,
          })
          .from(linkages)
          .where(
            and(
              eq(linkages.id, linkageId),
              eq(linkages.tenantId, session.user.tenantId)
            )
          )
          .limit(1);

        if (existingLinkage) {
          const linkagePatch: Record<string, unknown> = {};
          if (!existingLinkage.vesselName && validated.vesselName) {
            linkagePatch.vesselName = validated.vesselName;
          }
          if (!existingLinkage.vesselImo && validated.vesselImo) {
            linkagePatch.vesselImo = validated.vesselImo;
          }
          if (Object.keys(linkagePatch).length > 0) {
            linkagePatch.updatedAt = new Date();
            await db
              .update(linkages)
              .set(linkagePatch)
              .where(
                and(
                  eq(linkages.id, linkageId),
                  eq(linkages.tenantId, session.user.tenantId)
                )
              );
          }
        }
      }

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: deal.id,
        userId: session.user.id,
        action: "deal.created",
        details: {
          counterparty: deal.counterparty,
          direction: deal.direction,
          incoterm: deal.incoterm,
          product: deal.product,
        },
      });

      // Auto-instantiate workflow if a matching template exists.
      // No operator action needed — the workflow appears immediately.
      try {
        const template = await matchTemplate(deal as Deal, db);
        if (template) {
          await instantiateWorkflow(deal as Deal, template.id, db);
        }
      } catch {
        // Non-fatal: deal is created even if workflow instantiation fails
      }

      return deal;
    });

    return NextResponse.json(result, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
