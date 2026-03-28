import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, auditLogs } from "@/lib/db/schema";
import { createDealSchema } from "@/lib/types/deal";
import { z } from "zod";

const confirmSchema = z.object({
  deals: z.array(createDealSchema),
});

// POST /api/import/confirm — Commit validated deals
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const { deals: dealArray } = confirmSchema.parse(body);

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const created: string[] = [];

      for (const dealData of dealArray) {
        const [deal] = await db
          .insert(deals)
          .values({
            ...dealData,
            quantityMt: String(dealData.quantityMt),
            tenantId: session.user.tenantId,
            createdBy: session.user.id,
            status: "active", // Imported deals start as active
          })
          .returning({ id: deals.id });

        created.push(deal.id);

        await db.insert(auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: deal.id,
          userId: session.user.id,
          action: "deal.imported",
          details: { source: "excel_import" },
        });
      }

      return created;
    });

    return NextResponse.json({ imported: result.length, dealIds: result });
  },
  { roles: ["operator", "admin"] }
);
