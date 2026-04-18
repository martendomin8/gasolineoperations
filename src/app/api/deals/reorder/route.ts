import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const reorderSchema = z.object({
  /** Array of deal IDs in the desired order */
  dealIds: z.array(z.string().uuid()).min(1),
});

/**
 * PATCH /api/deals/reorder — Update sort_order for a batch of deals.
 *
 * Accepts an ordered array of deal IDs. Each deal's sort_order is set
 * to its index in that array (0, 1, 2, ...). Used by the linkage view
 * drag & drop to persist ordering for both buy and sell sides.
 *
 * The sort_order determines port display sequence in the fleet map.
 */
export const PATCH = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const parseResult = reorderSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const { dealIds } = parseResult.data;

    await withTenantDb(session.user.tenantId, async (db) => {
      // Update each deal's sort_order to its index in the array.
      // Runs in parallel — each is an independent UPDATE.
      await Promise.all(
        dealIds.map((dealId, index) =>
          db
            .update(deals)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(
                eq(deals.id, dealId),
                eq(deals.tenantId, session.user.tenantId)
              )
            )
        )
      );
    });

    return NextResponse.json({ ok: true });
  },
  { roles: ["operator", "admin"] }
);
