import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkages, deals, auditLogs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const mergeSchema = z.object({
  sourceLinkageId: z.string().uuid(),
  keepNumber: z.enum(["target", "source"]),
});

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/linkages/:id/merge — Merge source linkage into target (this one)
export const POST = withAuth(
  async (req, ctx, session) => {
    const { id: targetId } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = mergeSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { sourceLinkageId, keepNumber } = parseResult.data;

    if (sourceLinkageId === targetId) {
      return NextResponse.json(
        { error: "Cannot merge a linkage into itself" },
        { status: 400 }
      );
    }

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // 1. Verify both linkages exist and belong to tenant
      const [target] = await db
        .select()
        .from(linkages)
        .where(
          and(eq(linkages.id, targetId), eq(linkages.tenantId, session.user.tenantId))
        )
        .limit(1);

      if (!target) {
        return { error: "Target linkage not found", status: 404 };
      }

      const [source] = await db
        .select()
        .from(linkages)
        .where(
          and(eq(linkages.id, sourceLinkageId), eq(linkages.tenantId, session.user.tenantId))
        )
        .limit(1);

      if (!source) {
        return { error: "Source linkage not found", status: 404 };
      }

      // 2. Move all deals from source to target
      const movedDeals = await db
        .update(deals)
        .set({
          linkageId: targetId,
          linkageCode: target.linkageNumber ?? target.tempName,
          updatedAt: new Date(),
        })
        .where(
          and(eq(deals.linkageId, sourceLinkageId), eq(deals.tenantId, session.user.tenantId))
        )
        .returning({ id: deals.id });

      // 3. If keepNumber is "source", copy source's linkageNumber to target
      if (keepNumber === "source" && source.linkageNumber) {
        await db
          .update(linkages)
          .set({
            linkageNumber: source.linkageNumber,
            updatedAt: new Date(),
          })
          .where(eq(linkages.id, targetId));

        // Also update linkageCode on all deals now in target
        await db
          .update(deals)
          .set({
            linkageCode: source.linkageNumber,
            updatedAt: new Date(),
          })
          .where(
            and(eq(deals.linkageId, targetId), eq(deals.tenantId, session.user.tenantId))
          );
      }

      // 4. Delete the now-empty source linkage
      await db
        .delete(linkages)
        .where(
          and(eq(linkages.id, sourceLinkageId), eq(linkages.tenantId, session.user.tenantId))
        );

      // 5. Audit log the merge
      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage_merge",
        details: {
          targetLinkageId: targetId,
          sourceLinkageId,
          keepNumber,
          movedDealIds: movedDeals.map((d) => d.id),
          sourceLinkageNumber: source.linkageNumber ?? source.tempName,
          targetLinkageNumber: target.linkageNumber ?? target.tempName,
        },
      });

      return { success: true, movedDealCount: movedDeals.length };
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(result);
  },
  { roles: ["operator", "admin"] }
);
