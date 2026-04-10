import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkages, deals } from "@/lib/db/schema";
import { createLinkageSchema } from "@/lib/types/linkage";
import { eq, and, desc, sql, like } from "drizzle-orm";

// GET /api/linkages — List all linkages for tenant (with deal counts)
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const conditions = [eq(linkages.tenantId, session.user.tenantId)];
    if (status === "active" || status === "completed") {
      conditions.push(eq(linkages.status, status));
    }

    const rows = await db
      .select({
        id: linkages.id,
        tenantId: linkages.tenantId,
        linkageNumber: linkages.linkageNumber,
        tempName: linkages.tempName,
        status: linkages.status,
        vesselName: linkages.vesselName,
        vesselImo: linkages.vesselImo,
        createdAt: linkages.createdAt,
        updatedAt: linkages.updatedAt,
        dealCount: sql<number>`count(${deals.id})::int`,
      })
      .from(linkages)
      .leftJoin(deals, eq(deals.linkageId, linkages.id))
      .where(and(...conditions))
      .groupBy(linkages.id)
      .orderBy(desc(linkages.createdAt));

    return rows;
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
});

// POST /api/linkages — Create a new linkage
export const POST = withAuth(async (req, _ctx, session) => {
  const body = await req.json();
  const parseResult = createLinkageSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parseResult.error.issues },
      { status: 400 }
    );
  }

  const data = parseResult.data;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    // Auto-generate temp_name as TEMP-001, TEMP-002, etc.
    const [lastTemp] = await db
      .select({ tempName: linkages.tempName })
      .from(linkages)
      .where(
        and(
          eq(linkages.tenantId, session.user.tenantId),
          like(linkages.tempName, "TEMP-%")
        )
      )
      .orderBy(desc(linkages.tempName))
      .limit(1);

    let nextNumber = 1;
    if (lastTemp?.tempName) {
      const match = lastTemp.tempName.match(/^TEMP-(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }
    const tempName = `TEMP-${String(nextNumber).padStart(3, "0")}`;

    const [created] = await db
      .insert(linkages)
      .values({
        tenantId: session.user.tenantId,
        linkageNumber: data.linkageNumber ?? null,
        tempName,
      })
      .returning();

    return created;
  });

  return NextResponse.json(result, { status: 201 });
});
