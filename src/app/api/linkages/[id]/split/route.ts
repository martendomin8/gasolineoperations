import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkages, deals, auditLogs } from "@/lib/db/schema";
import { eq, and, desc, like, inArray } from "drizzle-orm";
import { z } from "zod";

const splitSchema = z.object({
  dealIds: z.array(z.string().uuid()).min(1, "At least one deal must be selected"),
});

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/linkages/:id/split — Split selected deals into a new linkage
export const POST = withAuth(
  async (req, ctx, session) => {
    const { id: sourceLinkageId } = await (ctx as RouteContext).params;
    const body = await req.json();
    const parseResult = splitSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { dealIds } = parseResult.data;

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      // 1. Verify source linkage exists
      const [sourceLinkage] = await db
        .select()
        .from(linkages)
        .where(
          and(eq(linkages.id, sourceLinkageId), eq(linkages.tenantId, session.user.tenantId))
        )
        .limit(1);

      if (!sourceLinkage) {
        return { error: "Linkage not found", status: 404 };
      }

      // 2. Verify all deals belong to this linkage and tenant
      const dealsToMove = await db
        .select({ id: deals.id })
        .from(deals)
        .where(
          and(
            inArray(deals.id, dealIds),
            eq(deals.linkageId, sourceLinkageId),
            eq(deals.tenantId, session.user.tenantId)
          )
        );

      if (dealsToMove.length !== dealIds.length) {
        return {
          error: "Some deals were not found in this linkage",
          status: 400,
        };
      }

      // 3. Check that at least one deal stays in the source linkage
      const allDealsInSource = await db
        .select({ id: deals.id })
        .from(deals)
        .where(
          and(eq(deals.linkageId, sourceLinkageId), eq(deals.tenantId, session.user.tenantId))
        );

      if (allDealsInSource.length === dealIds.length) {
        return {
          error: "Cannot split all deals out of a linkage. At least one deal must remain.",
          status: 400,
        };
      }

      // 4. Auto-generate TEMP name for the new linkage
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

      // 5. Create new linkage
      const [newLinkage] = await db
        .insert(linkages)
        .values({
          tenantId: session.user.tenantId,
          tempName,
        })
        .returning();

      // 6. Move deals to new linkage
      await db
        .update(deals)
        .set({
          linkageId: newLinkage.id,
          linkageCode: tempName,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(deals.id, dealIds),
            eq(deals.tenantId, session.user.tenantId)
          )
        );

      // 7. Audit log
      await db.insert(auditLogs).values({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "linkage_split",
        details: {
          sourceLinkageId,
          newLinkageId: newLinkage.id,
          newLinkageTempName: tempName,
          movedDealIds: dealIds,
        },
      });

      return {
        success: true,
        newLinkage: {
          id: newLinkage.id,
          tempName: newLinkage.tempName,
          linkageNumber: newLinkage.linkageNumber,
        },
        movedDealCount: dealIds.length,
      };
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(result, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
