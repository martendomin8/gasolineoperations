import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkageCosts, auditLogs } from "@/lib/db/schema";
import { updateLinkageCostSchema } from "@/lib/types/linkage-cost";
import { and, eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string; costId: string }> };

// PUT /api/linkages/:id/costs/:costId — edit a single cost line.
// Optimistic-locked via the version field, mirroring the pattern on
// /api/deals/:id so concurrent edits don't silently overwrite.
export const PUT = withAuth(
  async (req, ctx, session) => {
    const { id, costId } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = updateLinkageCostSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const { version, ...updates } = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [current] = await db
        .select()
        .from(linkageCosts)
        .where(
          and(
            eq(linkageCosts.id, costId),
            eq(linkageCosts.linkageId, id),
            eq(linkageCosts.tenantId, session.user.tenantId)
          )
        )
        .limit(1);

      if (!current) return { error: "not_found" as const };
      if (current.version !== version) return { error: "version_conflict" as const };

      // Build payload — drop undefined keys so a partial PUT doesn't NULL
      // out fields the operator left untouched.
      const payload: Record<string, unknown> = {
        version: version + 1,
        updatedAt: new Date(),
      };
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) payload[k] = v;
      }

      const [updated] = await db
        .update(linkageCosts)
        .set(payload)
        .where(
          and(
            eq(linkageCosts.id, costId),
            eq(linkageCosts.tenantId, session.user.tenantId),
            eq(linkageCosts.version, version)
          )
        )
        .returning();

      if (!updated) return { error: "version_conflict" as const };

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage_cost.updated",
        details: { linkageCostId: costId, linkageId: id, fields: Object.keys(updates) },
      });

      return { cost: updated };
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result.cost);
  },
  { roles: ["operator", "admin"] }
);

// DELETE /api/linkages/:id/costs/:costId — hard-delete (no soft-delete on
// cost rows; if it shouldn't exist anymore, drop it).
export const DELETE = withAuth(
  async (_req, ctx, session) => {
    const { id, costId } = await (ctx as RouteContext).params;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [existing] = await db
        .select()
        .from(linkageCosts)
        .where(
          and(
            eq(linkageCosts.id, costId),
            eq(linkageCosts.linkageId, id),
            eq(linkageCosts.tenantId, session.user.tenantId)
          )
        )
        .limit(1);

      if (!existing) return { error: "not_found" as const };

      await db
        .delete(linkageCosts)
        .where(
          and(
            eq(linkageCosts.id, costId),
            eq(linkageCosts.tenantId, session.user.tenantId)
          )
        );

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage_cost.deleted",
        details: { linkageCostId: costId, linkageId: id, category: existing.category },
      });

      return { ok: true as const };
    });

    if ("error" in result) {
      return NextResponse.json({ error: "Cost not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
  { roles: ["operator", "admin"] }
);
