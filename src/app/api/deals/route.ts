import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, auditLogs, users, workflowInstances, workflowSteps } from "@/lib/db/schema";
import { createDealSchema, dealFilterSchema } from "@/lib/types/deal";
import { eq, and, ilike, or, desc, sql } from "drizzle-orm";
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
    const primaryOp = alias(users, "primaryOp");
    const secondaryOp = alias(users, "secondaryOp");

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
          vesselName: deals.vesselName,
          vesselImo: deals.vesselImo,
          status: deals.status,
          pricingType: deals.pricingType,
          pricingFormula: deals.pricingFormula,
          pricingEstimatedDate: deals.pricingEstimatedDate,
          pricingPeriodType: deals.pricingPeriodType,
          pricingPeriodValue: deals.pricingPeriodValue,
          pricingConfirmed: deals.pricingConfirmed,
          estimatedBlNorDate: deals.estimatedBlNorDate,
          assignedOperatorId: deals.assignedOperatorId,
          secondaryOperatorId: deals.secondaryOperatorId,
          excelStatuses: deals.excelStatuses,
          operatorName: primaryOp.name,
          secondaryOperatorName: secondaryOp.name,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .leftJoin(primaryOp, eq(deals.assignedOperatorId, primaryOp.id))
        .leftJoin(secondaryOp, eq(deals.secondaryOperatorId, secondaryOp.id))
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
              voyDisOrders: null,
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
          } else if (step.stepType === "order" || nameLower.includes("order")) {
            statuses.voyDisOrders = displayStatus;
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
        voyDisOrders: stepStatuses.voyDisOrders ?? excelOverrides.voyDisOrders ?? null,
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
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "private, max-age=5, stale-while-revalidate=30");
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
      const [deal] = await db
        .insert(deals)
        .values({
          counterparty: validated.counterparty,
          direction: validated.direction,
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
          linkageCode: validated.linkageCode ?? null,
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

      return deal;
    });

    return NextResponse.json(result, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
