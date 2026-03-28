import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { parties, auditLogs } from "@/lib/db/schema";
import { updatePartySchema } from "@/lib/types/party";
import { eq, and, isNull } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/parties/:id
export const GET = withAuth(async (_req, ctx, session) => {
  const { id } = await (ctx as RouteContext).params;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const [party] = await db
      .select()
      .from(parties)
      .where(
        and(
          eq(parties.id, id),
          eq(parties.tenantId, session.user.tenantId),
          isNull(parties.deletedAt)
        )
      )
      .limit(1);
    return party;
  });

  if (!result) {
    return NextResponse.json({ error: "Party not found" }, { status: 404 });
  }

  return NextResponse.json(result);
});

// PUT /api/parties/:id (admin only)
export const PUT = withAuth(
  async (req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;
    const body = await req.json();
    const validated = updatePartySchema.parse(body);
    const { version, ...updates } = validated;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // Optimistic locking: only update if version matches
      const [updated] = await db
        .update(parties)
        .set({
          ...updates,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(parties.id, id),
            eq(parties.tenantId, session.user.tenantId),
            eq(parties.version, version),
            isNull(parties.deletedAt)
          )
        )
        .returning();

      if (!updated) {
        return null;
      }

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "party.updated",
        details: { partyId: id, changes: updates },
      });

      return updated;
    });

    if (!result) {
      return NextResponse.json(
        { error: "Party not found or version conflict (concurrent edit)" },
        { status: 409 }
      );
    }

    return NextResponse.json(result);
  },
  { roles: ["admin"] }
);

// DELETE /api/parties/:id — soft delete (admin only)
export const DELETE = withAuth(
  async (_req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [deleted] = await db
        .update(parties)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(parties.id, id),
            eq(parties.tenantId, session.user.tenantId),
            isNull(parties.deletedAt)
          )
        )
        .returning();

      if (deleted) {
        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          userId: session.user.id,
          action: "party.deleted",
          details: { partyId: id, name: deleted.name },
        });
      }

      return deleted;
    });

    if (!result) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  },
  { roles: ["admin"] }
);
