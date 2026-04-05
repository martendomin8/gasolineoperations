import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { parties, auditLogs } from "@/lib/db/schema";
import { createPartySchema, partyFilterSchema } from "@/lib/types/party";
import { eq, and, ilike, isNull, or, sql } from "drizzle-orm";

// GET /api/parties — List parties for tenant
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const parseResult = partyFilterSchema.safeParse({
    type: url.searchParams.get("type") || undefined,
    port: url.searchParams.get("port") || undefined,
    search: url.searchParams.get("search") || undefined,
  });
  if (!parseResult.success) {
    const first = parseResult.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Validation failed", issues: parseResult.error.issues },
      { status: 400 }
    );
  }
  const filters = parseResult.data;

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

    // When a port filter is provided, return region-matched parties first,
    // then all remaining parties of that type as fallback (operator is never blocked).
    if (filters.port) {
      const portLower = filters.port.toLowerCase();

      // Region-matched parties: regionTags array contains a tag matching the port (case-insensitive)
      const regionConditions = [
        ...conditions,
        sql`EXISTS (SELECT 1 FROM unnest(${parties.regionTags}) AS tag WHERE lower(tag) = ${portLower})`,
      ];

      const matched = await db
        .select()
        .from(parties)
        .where(and(...regionConditions))
        .orderBy(parties.type, parties.name);

      // All parties of that type (fallback / "show all")
      const all = await db
        .select()
        .from(parties)
        .where(and(...conditions))
        .orderBy(parties.type, parties.name);

      const matchedIds = new Set(matched.map((p) => p.id));
      const rest = all.filter((p) => !matchedIds.has(p.id));

      return { matched, rest };
    }

    const all = await db
      .select()
      .from(parties)
      .where(and(...conditions))
      .orderBy(parties.type, parties.name);

    // No port filter: return flat array for backward compatibility (parties list page)
    return all;
  });

  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  return response;
});

// POST /api/parties — Create party (admin only)
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const parseResult = createPartySchema.safeParse(body);
    if (!parseResult.success) {
      const first = parseResult.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const validated = parseResult.data;

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
