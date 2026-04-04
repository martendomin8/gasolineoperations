import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, auditLogs } from "@/lib/db/schema";
import { importDealSchema } from "@/lib/types/deal";
import { z } from "zod";

const confirmSchema = z.object({
  deals: z.array(importDealSchema),
});

// POST /api/import/confirm — Commit validated deals
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const { deals: dealArray } = confirmSchema.parse(body);

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const created: string[] = [];

      for (const dealData of dealArray) {
        const [deal] = await db
          .insert(deals)
          .values({
            counterparty: dealData.counterparty,
            direction: dealData.direction,
            product: dealData.product || "TBD",
            incoterm: dealData.incoterm,
            loadport: dealData.loadport,
            laycanStart: dealData.laycanStart,
            laycanEnd: dealData.laycanEnd,
            quantityMt: String(dealData.quantityMt),
            nominatedQty: dealData.nominatedQty != null ? String(dealData.nominatedQty) : null,
            contractedQty: dealData.contractedQty ?? null,
            dischargePort: dealData.dischargePort ?? null,
            externalRef: dealData.externalRef ?? null,
            linkageCode: dealData.linkageCode ?? null,
            vesselName: dealData.vesselName ?? null,
            vesselImo: dealData.vesselImo ?? null,
            assignedOperatorId: dealData.assignedOperatorId ?? null,
            secondaryOperatorId: dealData.secondaryOperatorId ?? null,
            pricingFormula: dealData.pricingFormula ?? null,
            pricingType: dealData.pricingType ?? null,
            pricingEstimatedDate: dealData.pricingEstimatedDate ?? null,
            specialInstructions: dealData.specialInstructions ?? null,
            sourceRawText: dealData.sourceRawText ?? null,
            tenantId: session.user.tenantId,
            createdBy: session.user.id,
            status: "active", // Imported deals start as active
          })
          .returning({ id: deals.id });

        created.push(deal.id);

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: deal.id,
          userId: session.user.id,
          action: "deal.imported",
          details: { source: "excel_import" },
        });
      }

      return created;
    });

    return NextResponse.json({ imported: result.length, dealIds: result });
  },
  { roles: ["operator", "admin"] }
);
