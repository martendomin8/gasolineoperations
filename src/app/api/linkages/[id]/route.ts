import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkages, deals, auditLogs } from "@/lib/db/schema";
import { updateLinkageSchema } from "@/lib/types/linkage";
import { eq, and, sql } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/linkages/:id — Fetch a single linkage
export const GET = withAuth(async (_req, ctx, session) => {
  const { id } = await (ctx as RouteContext).params;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const [linkage] = await db
      .select()
      .from(linkages)
      .where(
        and(eq(linkages.id, id), eq(linkages.tenantId, session.user.tenantId))
      )
      .limit(1);

    return linkage ?? null;
  });

  if (!result) {
    return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
  }

  return NextResponse.json(result);
});

// PUT /api/linkages/:id — Update linkage fields (vesselName, vesselImo, linkageNumber, status)
export const PUT = withAuth(
  async (req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = updateLinkageSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const updates = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [current] = await db
        .select()
        .from(linkages)
        .where(
          and(eq(linkages.id, id), eq(linkages.tenantId, session.user.tenantId))
        )
        .limit(1);

      if (!current) {
        return { error: "not_found" as const };
      }

      const updatePayload: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (updates.linkageNumber !== undefined) updatePayload.linkageNumber = updates.linkageNumber;
      if (updates.status !== undefined) updatePayload.status = updates.status;
      if (updates.vesselName !== undefined) updatePayload.vesselName = updates.vesselName;
      if (updates.vesselImo !== undefined) updatePayload.vesselImo = updates.vesselImo;
      if (updates.assignedOperatorId !== undefined) updatePayload.assignedOperatorId = updates.assignedOperatorId;
      if (updates.secondaryOperatorId !== undefined) updatePayload.secondaryOperatorId = updates.secondaryOperatorId;

      const [updated] = await db
        .update(linkages)
        .set(updatePayload)
        .where(
          and(eq(linkages.id, id), eq(linkages.tenantId, session.user.tenantId))
        )
        .returning();

      // If linkageNumber was changed, update linkageCode on all deals under this linkage
      if (
        updates.linkageNumber !== undefined &&
        updates.linkageNumber !== current.linkageNumber
      ) {
        await db
          .update(deals)
          .set({
            linkageCode: updates.linkageNumber ?? current.tempName,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(deals.linkageId, id),
              eq(deals.tenantId, session.user.tenantId)
            )
          );
      }

      // Audit log the update
      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage.updated",
        details: {
          linkageId: id,
          changes: Object.fromEntries(
            Object.entries(updates).filter(([k]) => k in updatePayload)
          ),
        },
      });

      return { linkage: updated };
    });

    if ("error" in result) {
      return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
    }

    return NextResponse.json(result.linkage);
  },
  { roles: ["operator", "admin"] }
);

// DELETE /api/linkages/:id — Guarded delete (operator/admin)
// Only empty linkages (zero deals) can be removed. If the linkage still has deals,
// return 400 with error: "linkage_has_deals" so the UI can surface a helpful toast.
export const DELETE = withAuth(
  async (_req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [current] = await db
        .select()
        .from(linkages)
        .where(
          and(eq(linkages.id, id), eq(linkages.tenantId, session.user.tenantId))
        )
        .limit(1);

      if (!current) {
        return { error: "not_found" as const };
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(
          and(
            eq(deals.linkageId, id),
            eq(deals.tenantId, session.user.tenantId)
          )
        );

      if (count > 0) {
        return { error: "linkage_has_deals" as const, count };
      }

      await db
        .delete(linkages)
        .where(
          and(eq(linkages.id, id), eq(linkages.tenantId, session.user.tenantId))
        );

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage.deleted",
        details: {
          linkageId: id,
          linkageNumber: current.linkageNumber,
          tempName: current.tempName,
        },
      });

      return { deleted: true as const };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
      }
      if (result.error === "linkage_has_deals") {
        return NextResponse.json(
          {
            error: "linkage_has_deals",
            message: `Remove all ${result.count} deal${result.count === 1 ? "" : "s"} from this linkage before deleting it.`,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  },
  { roles: ["operator", "admin"] }
);
