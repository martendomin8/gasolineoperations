import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, dealParcels, dealChangeLogs } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

/**
 * PATCH /api/deals/:id/parcels/:no
 *
 * Update a single parcel's product (and optionally quantity / contractedQty)
 * on a multi-parcel deal. Cascades the change to back-to-back deals in the
 * same linkage:
 *
 *   - Find sibling deals (same `linkage_id`, NOT this deal).
 *   - For each, look up `deal_parcels` with the same `parcel_no`.
 *   - If that parcel currently carries the OLD product name, update it too.
 *
 * Sibling rows that already diverged (different product on the same parcel
 * slot) are left alone — that's how we avoid silently overwriting a deal
 * the operator deliberately set up differently.
 *
 * After parcel updates:
 *   - The owning deal's `product` is recomputed as the joined "X + Y" form
 *     when multi-parcel, or the single parcel's product when there's only
 *     one row. `quantity_mt` is recomputed as the sum.
 *   - The owning deal's `version` is bumped so the operator's open edit
 *     forms refresh on the next save attempt.
 *   - A `deal_change_logs` row is written for each cascaded deal whose
 *     parcel/product changed.
 */

const patchSchema = z.object({
  product: z.string().min(1).max(255).optional(),
  quantityMt: z.coerce.number().positive().optional(),
  contractedQty: z.string().max(100).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string; no: string }> };

export const PATCH = withAuth(
  async (req: NextRequest, ctx, session) => {
    const { id, no } = await (ctx as RouteContext).params;
    const parcelNo = Number(no);
    if (!Number.isInteger(parcelNo) || parcelNo < 1) {
      return NextResponse.json({ error: "invalid parcel_no" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // 1. Locate the target deal + its linkage_id (we need this for cascade).
      const [targetDeal] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, id), eq(deals.tenantId, session.user.tenantId)))
        .limit(1);
      if (!targetDeal) return { kind: "not_found" as const };

      // 2. Locate the parcel row to update.
      const [targetParcel] = await db
        .select()
        .from(dealParcels)
        .where(
          and(
            eq(dealParcels.dealId, id),
            eq(dealParcels.parcelNo, parcelNo),
            eq(dealParcels.tenantId, session.user.tenantId)
          )
        )
        .limit(1);
      if (!targetParcel) return { kind: "parcel_not_found" as const };

      const oldProduct = targetParcel.product;

      // 3. Update the parcel itself.
      const parcelUpdatePayload: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.product !== undefined) parcelUpdatePayload.product = updates.product;
      if (updates.quantityMt !== undefined) {
        parcelUpdatePayload.quantityMt = String(updates.quantityMt);
      }
      if (updates.contractedQty !== undefined) {
        parcelUpdatePayload.contractedQty = updates.contractedQty;
      }
      await db
        .update(dealParcels)
        .set(parcelUpdatePayload)
        .where(
          and(
            eq(dealParcels.dealId, id),
            eq(dealParcels.parcelNo, parcelNo),
            eq(dealParcels.tenantId, session.user.tenantId)
          )
        );

      // 4. Recompute the owning deal's denormalised summary fields.
      await recomputeDealSummary(db, session.user.tenantId, id);

      // 5. Audit log for this deal.
      if (updates.product !== undefined && updates.product !== oldProduct) {
        await db.insert(dealChangeLogs).values({
          tenantId: session.user.tenantId,
          dealId: id,
          fieldChanged: `parcel_${parcelNo}_product`,
          oldValue: oldProduct,
          newValue: updates.product,
          changedBy: session.user.id,
        });
      }

      // 6. Cascade across the linkage. Only triggered when product changes.
      let cascadedCount = 0;
      if (
        updates.product !== undefined &&
        updates.product !== oldProduct &&
        targetDeal.linkageId
      ) {
        // Find all sibling deals in the same linkage.
        const siblingDeals = await db
          .select({ id: deals.id })
          .from(deals)
          .where(
            and(
              eq(deals.linkageId, targetDeal.linkageId),
              eq(deals.tenantId, session.user.tenantId)
            )
          );

        for (const sibling of siblingDeals) {
          if (sibling.id === id) continue;
          // Only update sibling parcel if it still carries the OLD product.
          const [siblingParcel] = await db
            .select()
            .from(dealParcels)
            .where(
              and(
                eq(dealParcels.dealId, sibling.id),
                eq(dealParcels.parcelNo, parcelNo),
                eq(dealParcels.tenantId, session.user.tenantId)
              )
            )
            .limit(1);
          if (!siblingParcel) continue;
          if (siblingParcel.product !== oldProduct) continue;

          await db
            .update(dealParcels)
            .set({ product: updates.product, updatedAt: new Date() })
            .where(
              and(
                eq(dealParcels.dealId, sibling.id),
                eq(dealParcels.parcelNo, parcelNo),
                eq(dealParcels.tenantId, session.user.tenantId)
              )
            );
          await recomputeDealSummary(db, session.user.tenantId, sibling.id);
          await db.insert(dealChangeLogs).values({
            tenantId: session.user.tenantId,
            dealId: sibling.id,
            fieldChanged: `parcel_${parcelNo}_product`,
            oldValue: oldProduct,
            newValue: updates.product,
            changedBy: session.user.id,
          });
          cascadedCount++;
        }
      }

      return { kind: "ok" as const, cascadedCount };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "deal not found" }, { status: 404 });
    }
    if (result.kind === "parcel_not_found") {
      return NextResponse.json({ error: "parcel not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, cascadedCount: result.cascadedCount });
  },
  { roles: ["operator", "admin"] }
);

/**
 * Recompute `deals.product` (combined label) and `deals.quantity_mt` (sum)
 * from the deal's parcels[]. Bumps `version` so any open client form's
 * optimistic-lock check fails next save (forcing a refresh).
 */
async function recomputeDealSummary(
  db: Parameters<Parameters<typeof withTenantDb>[1]>[0],
  tenantId: string,
  dealId: string
): Promise<void> {
  const parcels = await db
    .select({
      product: dealParcels.product,
      quantityMt: dealParcels.quantityMt,
      contractedQty: dealParcels.contractedQty,
    })
    .from(dealParcels)
    .where(and(eq(dealParcels.dealId, dealId), eq(dealParcels.tenantId, tenantId)))
    .orderBy(asc(dealParcels.parcelNo));

  if (parcels.length === 0) return; // shouldn't happen — every deal has >= 1 parcel

  const combinedProduct =
    parcels.length === 1
      ? parcels[0].product
      : parcels.map((p) => p.product).join(" + ");
  const summedQty = parcels.reduce((s, p) => s + Number(p.quantityMt ?? 0), 0);

  // contractedQty for multi-parcel: join parcels' contracted_qty with " + ".
  // Keep deal-level contractedQty stable for single-parcel — operator may
  // have edited it via the B/L Figures cell separately, no need to clobber.
  const combinedContracted =
    parcels.length === 1
      ? undefined
      : parcels
          .map((p) => p.contractedQty)
          .filter((s): s is string => !!s && s.trim().length > 0)
          .join(" + ") || undefined;

  const updatePayload: Record<string, unknown> = {
    product: combinedProduct,
    quantityMt: String(summedQty),
    parcelCount: parcels.length,
    updatedAt: new Date(),
  };
  if (combinedContracted !== undefined) {
    updatePayload.contractedQty = combinedContracted;
  }

  // Bump version so optimistic locks on stale client copies invalidate.
  const [current] = await db
    .select({ version: deals.version })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)))
    .limit(1);
  if (current) {
    updatePayload.version = current.version + 1;
  }

  await db
    .update(deals)
    .set(updatePayload)
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)));
}
