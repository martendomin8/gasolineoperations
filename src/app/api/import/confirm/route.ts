import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, linkages, auditLogs } from "@/lib/db/schema";
import { importDealSchema } from "@/lib/types/deal";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

const confirmSchema = z.object({
  deals: z.array(importDealSchema),
});

/**
 * Resolve (or create) a linkage for an imported deal. Every deal needs
 * a linkage_id per migration 0004, so this runs for every imported row:
 *   1. If linkageCode matches an existing linkage (linkage_number or
 *      temp_name) for this tenant → reuse its id.
 *   2. Otherwise create a new linkage. linkage_number = linkageCode if
 *      provided; temp_name = linkageCode || auto "TEMP-xxx" fallback.
 *
 * Kept in-route (not extracted) because it only runs from here. If a
 * second caller appears we'll factor it out.
 */
async function resolveLinkageId(
  db: Awaited<ReturnType<typeof withTenantDb<any>>>,
  tenantId: string,
  linkageCode: string | null,
  vesselName: string | null,
  vesselImo: string | null,
): Promise<string> {
  if (linkageCode && linkageCode.trim().length > 0) {
    const existing = await db
      .select({ id: linkages.id })
      .from(linkages)
      .where(
        and(
          eq(linkages.tenantId, tenantId),
          or(
            eq(linkages.linkageNumber, linkageCode),
            eq(linkages.tempName, linkageCode),
          ),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [created] = await db
      .insert(linkages)
      .values({
        tenantId,
        linkageNumber: linkageCode,
        tempName: linkageCode,
        vesselName,
        vesselImo,
        status: "active",
      })
      .returning({ id: linkages.id });
    return created.id;
  }

  // No linkageCode → unique auto-TEMP name so imports never collide.
  // Uses a timestamp suffix; operators can rename via the voyage bar
  // once they get an official linkage number from the trader.
  const tempName = `TEMP-IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const [created] = await db
    .insert(linkages)
    .values({
      tenantId,
      linkageNumber: null,
      tempName,
      vesselName,
      vesselImo,
      status: "active",
    })
    .returning({ id: linkages.id });
  return created.id;
}

// POST /api/import/confirm — Commit validated deals
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const { deals: dealArray } = confirmSchema.parse(body);

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const created: string[] = [];

      for (const dealData of dealArray) {
        const linkageId = await resolveLinkageId(
          db,
          session.user.tenantId,
          dealData.linkageCode ?? null,
          dealData.vesselName ?? null,
          dealData.vesselImo ?? null,
        );

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
            linkageId,
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
