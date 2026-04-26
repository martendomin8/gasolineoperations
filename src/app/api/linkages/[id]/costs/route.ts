import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkageCosts, linkages, auditLogs } from "@/lib/db/schema";
import { createLinkageCostSchema } from "@/lib/types/linkage-cost";
import { and, eq, asc } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/linkages/:id/costs — list every cost line for this linkage.
export const GET = withAuth(async (_req, ctx, session) => {
  const { id } = await (ctx as RouteContext).params;

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    return db
      .select()
      .from(linkageCosts)
      .where(
        and(
          eq(linkageCosts.linkageId, id),
          eq(linkageCosts.tenantId, session.user.tenantId)
        )
      )
      .orderBy(asc(linkageCosts.sortOrder), asc(linkageCosts.createdAt));
  });

  return NextResponse.json({ costs: result });
});

// POST /api/linkages/:id/costs — add a new cost line.
export const POST = withAuth(
  async (req, ctx, session) => {
    const { id } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = createLinkageCostSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }
    const data = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // Confirm the linkage belongs to the tenant before letting any insert
      // happen — a missing tenant gate here would be a multi-tenant leak.
      const [linkage] = await db
        .select({ id: linkages.id })
        .from(linkages)
        .where(
          and(
            eq(linkages.id, id),
            eq(linkages.tenantId, session.user.tenantId)
          )
        )
        .limit(1);
      if (!linkage) {
        return { error: "linkage_not_found" as const };
      }

      const [created] = await db
        .insert(linkageCosts)
        .values({
          tenantId: session.user.tenantId,
          linkageId: id,
          category: data.category,
          description: data.description ?? null,
          estimatedAmount: data.estimatedAmount ?? null,
          actualAmount: data.actualAmount ?? null,
          currency: data.currency ?? "USD",
          portName: data.portName ?? null,
          notes: data.notes ?? null,
          sortOrder: data.sortOrder ?? 0,
          createdBy: session.user.id,
        })
        .returning();

      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage_cost.created",
        details: {
          linkageId: id,
          linkageCostId: created.id,
          category: created.category,
        },
      });

      return { cost: created };
    });

    if ("error" in result) {
      return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
    }
    return NextResponse.json(result.cost, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
