import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { parties, auditLogs } from "@/lib/db/schema";
import { createPartySchema, partyFilterSchema } from "@/lib/types/party";
import { eq, and, ilike, isNull, or } from "drizzle-orm";

// GET /api/parties — List parties for tenant
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const filters = partyFilterSchema.parse({
    type: url.searchParams.get("type") || undefined,
    port: url.searchParams.get("port") || undefined,
    search: url.searchParams.get("search") || undefined,
  });

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const conditions = [
      eq(parties.tenantId, session.user.tenantId),
      isNull(parties.deletedAt),
    ];

    if (filters.type) {
      conditions.push(eq(parties.type, filters.type));
    }
    if (filters.search) {
      conditions.push(
        or(
          ilike(parties.name, `%${filters.search}%`),
          ilike(parties.port!, `%${filters.search}%`)
        )!
      );
    }

    return db
      .select()
      .from(parties)
      .where(and(...conditions))
      .orderBy(parties.type, parties.name);
  });

  return NextResponse.json(result);
});

// POST /api/parties — Create party (admin only)
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const validated = createPartySchema.parse(body);

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [party] = await db
        .insert(parties)
        .values({
          ...validated,
          tenantId: session.user.tenantId,
        })
        .returning();

      // Audit log
      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "party.created",
        details: { partyId: party.id, type: party.type, name: party.name },
      });

      return party;
    });

    return NextResponse.json(result, { status: 201 });
  },
  { roles: ["admin"] }
);
