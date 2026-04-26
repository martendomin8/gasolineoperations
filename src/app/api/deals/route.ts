import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, dealParcels, linkages, linkageSteps, auditLogs, users, workflowInstances, workflowSteps, type Deal } from "@/lib/db/schema";
import { matchTemplate, instantiateWorkflow } from "@/lib/workflow-engine";
import { createDealSchema, dealFilterSchema } from "@/lib/types/deal";
import { eq, and, ilike, or, desc, asc, sql, like, inArray } from "drizzle-orm";
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
          parcelCount: deals.parcelCount,
          arrivalAt: deals.arrivalAt,
          arrivalIsActual: deals.arrivalIsActual,
          departureOverride: deals.departureOverride,
          version: deals.version,
          excelStatuses: deals.excelStatuses,
          operatorName: sql<string | null>`coalesce(${linkagePrimaryOp.name}, ${primaryOp.name})`,
          secondaryOperatorName: sql<string | null>`coalesce(${linkageSecondaryOp.name}, ${secondaryOp.name})`,
          sortOrder: deals.sortOrder,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .leftJoin(primaryOp, eq(deals.assignedOperatorId, primaryOp.id))
        .leftJoin(secondaryOp, eq(deals.secondaryOperatorId, secondaryOp.id))
        .leftJoin(linkages, eq(deals.linkageId, linkages.id))
        .leftJoin(linkagePrimaryOp, eq(linkages.assignedOperatorId, linkagePrimaryOp.id))
        .leftJoin(linkageSecondaryOp, eq(linkages.secondaryOperatorId, linkageSecondaryOp.id))
        .where(and(...conditions))
        .orderBy(asc(deals.sortOrder), desc(deals.createdAt))
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

    // Multi-parcel deals get their per-grade breakdown attached so the
    // linkage view can render "ISOMERATE 2.5kt + REFORMATE 2.5kt" on the
    // deal card. Single-parcel deals (parcel_count = 1) skip this — their
    // single grade is already in `product` / `quantityMt` and adding a
    // parcels array of length 1 would just bloat the dashboard payload.
    const multiParcelDealIds = rawItems
      .filter((d) => (d.parcelCount ?? 1) > 1)
      .map((d) => d.id);
    const parcelsByDeal = new Map<
      string,
      Array<{ parcelNo: number; product: string; quantityMt: string; contractedQty: string | null }>
    >();
    if (multiParcelDealIds.length > 0) {
      // Use drizzle's inArray rather than raw `sql\`... = ANY(${arr}::uuid[])\``
      // because postgres-js doesn't reliably bind a JS array through the
      // drizzle sql template literal — the array gets stringified and the
      // ::uuid[] cast then chokes on a comma-separated UUID blob, which
      // surfaces as a 500 on every GET /api/deals request that contains a
      // multi-parcel deal. inArray serialises the array correctly.
      const parcelRows = await db
        .select({
          dealId: dealParcels.dealId,
          parcelNo: dealParcels.parcelNo,
          product: dealParcels.product,
          quantityMt: dealParcels.quantityMt,
          contractedQty: dealParcels.contractedQty,
        })
        .from(dealParcels)
        .where(
          and(
            eq(dealParcels.tenantId, session.user.tenantId),
            inArray(dealParcels.dealId, multiParcelDealIds)
          )
        )
        .orderBy(asc(dealParcels.dealId), asc(dealParcels.parcelNo));
      for (const row of parcelRows) {
        if (!parcelsByDeal.has(row.dealId)) parcelsByDeal.set(row.dealId, []);
        parcelsByDeal.get(row.dealId)!.push({
          parcelNo: row.parcelNo,
          product: row.product,
          quantityMt: row.quantityMt,
          contractedQty: row.contractedQty,
        });
      }
    }
    // voyOrders / disOrders are per-voyage (linkage-level), not per-deal. All
    // deals belonging to the same linkage share the same voy/dis status, read
    // from linkage_steps. Built once per request and applied after the
    // per-deal workflow_steps pass so the linkage-level value wins.
    const voyDisByLinkage = new Map<string, { voyOrders: string | null; disOrders: string | null }>();

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

      // Voyage / Discharge orders live at linkage level (linkage_steps). Pull
      // them in a single query for every linkage referenced by this page of
      // deals, then override each deal's voyOrders / disOrders below.
      const linkageIds = Array.from(
        new Set(rawItems.map((d) => d.linkageId).filter((x): x is string => !!x))
      );
      if (linkageIds.length > 0) {
        const linkStepsRows = await db
          .select({
            linkageId: linkageSteps.linkageId,
            stepType: linkageSteps.stepType,
            stepName: linkageSteps.stepName,
            status: linkageSteps.status,
          })
          .from(linkageSteps)
          .where(eq(linkageSteps.tenantId, session.user.tenantId));

        for (const ls of linkStepsRows) {
          if (!linkageIds.includes(ls.linkageId)) continue;
          const nameLower = ls.stepName.toLowerCase();
          const display = stepStatusToDisplay(ls.status);
          if (!voyDisByLinkage.has(ls.linkageId)) {
            voyDisByLinkage.set(ls.linkageId, { voyOrders: null, disOrders: null });
          }
          const slot = voyDisByLinkage.get(ls.linkageId)!;
          if (nameLower.includes("discharge")) {
            slot.disOrders = display;
          } else if (nameLower.includes("voyage") || ls.stepType === "order") {
            slot.voyOrders = display;
          }
        }
      }
    }

    const items = rawItems.map((d) => {
      const stepStatuses = stepStatusMap.get(d.id) ?? {};
      const excelOverrides = (d.excelStatuses ?? {}) as Record<string, string | null>;
      const linkageVoyDis = d.linkageId ? voyDisByLinkage.get(d.linkageId) : undefined;

      // Workflow step statuses take priority; operator-managed fields come from excelStatuses.
      // For voy/dis orders the linkage-level step (linkage_steps) is authoritative — it
      // overrides any per-deal workflow_steps value so the Excel cell and the linkage
      // vessel workflow stay in sync.
      return {
        ...d,
        parcels: parcelsByDeal.get(d.id),
        docInstructions: stepStatuses.docInstructions ?? excelOverrides.docInstructions ?? null,
        voyOrders: linkageVoyDis?.voyOrders ?? stepStatuses.voyOrders ?? excelOverrides.voyOrders ?? null,
        disOrders: linkageVoyDis?.disOrders ?? stepStatuses.disOrders ?? excelOverrides.disOrders ?? null,
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

      // Build the parcel list before inserting the deal: every deal must
      // carry at least one row in `deal_parcels`, even single-parcel ones,
      // so consumers (linkage view, BL tracking, AI Q&A) can iterate
      // parcels[] without a length-zero special case. If the caller passed
      // `parcels` with 2+ entries we honour it (multi-parcel deal); if
      // they passed an array with 1 entry or omitted it entirely we
      // synthesise a single parcel from the deal-level summary fields.
      const parcelInputs = (validated.parcels && validated.parcels.length > 0)
        ? validated.parcels
        : [{
            product: validated.product,
            quantityMt: validated.quantityMt,
            contractedQty: validated.contractedQty ?? null,
          }];
      const parcelCount = parcelInputs.length;

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
          // Structured period fields were missing from this insert payload —
          // Zod accepted them, the parse confirm modal sent them, but they
          // never landed in the DB. The Excel PRICING column then rendered
          // an em-dash for every freshly-parsed deal because the cell only
          // reads structured fields, not pricingFormula.
          pricingPeriodType: validated.pricingPeriodType ?? null,
          pricingPeriodValue: validated.pricingPeriodValue ?? null,
          pricingConfirmed: validated.pricingConfirmed ?? false,
          estimatedBlNorDate: validated.estimatedBlNorDate ?? null,
          loadedQuantityMt:
            validated.loadedQuantityMt != null ? String(validated.loadedQuantityMt) : null,
          pricingEstimatedDate: validated.pricingEstimatedDate ?? null,
          specialInstructions: validated.specialInstructions ?? null,
          sourceRawText: validated.sourceRawText ?? null,
          parcelCount,
          tenantId: session.user.tenantId,
          createdBy: session.user.id,
        })
        .returning();

      // Persist parcel rows. parcel_no is 1-based so BL number alignment
      // matches the trader's recap order. ON DELETE CASCADE on deal_parcels
      // takes care of cleanup if the deal is later deleted.
      await db.insert(dealParcels).values(
        parcelInputs.map((p, i) => ({
          tenantId: session.user.tenantId,
          dealId: deal.id,
          parcelNo: i + 1,
          product: p.product,
          quantityMt: String(p.quantityMt),
          contractedQty: p.contractedQty ?? null,
        }))
      );

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
