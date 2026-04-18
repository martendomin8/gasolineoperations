import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { worldscaleRates } from "@/lib/db/schema";

// DELETE /api/worldscale-rates/:id
// Remove a stored rate. Scoped to tenant — deleting across tenants
// silently no-ops because of the WHERE on tenantId. Ops normally
// doesn't delete historical rates (the whole point is to keep them),
// so this exists for mistakes / typos.
export const DELETE = withAuth(async (_req, ctx, session) => {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const deleted = await withTenantDb(session.user.tenantId, async (db) => {
    const rows = await db
      .delete(worldscaleRates)
      .where(
        and(
          eq(worldscaleRates.id, id),
          eq(worldscaleRates.tenantId, session.user.tenantId)
        )
      )
      .returning({ id: worldscaleRates.id });
    return rows[0] ?? null;
  });

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
