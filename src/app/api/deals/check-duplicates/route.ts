import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { eq, and, ne, sql, ilike } from "drizzle-orm";
import { z } from "zod";

const checkDuplicatesSchema = z.object({
  counterparty: z.string().min(1),
  direction: z.enum(["buy", "sell"]),
  product: z.string().min(1),
  quantityMt: z.coerce.number().positive(),
  laycanStart: z.string(),
  loadport: z.string(),
  dischargePort: z.string(),
  excludeDealId: z.string().uuid().optional(),
});

// POST /api/deals/check-duplicates
export const POST = withAuth(async (req, _ctx, session) => {
  const body = await req.json();
  const input = checkDuplicatesSchema.parse(body);

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const conditions = [
      eq(deals.tenantId, session.user.tenantId),
      ne(deals.status, "cancelled"),
      ilike(deals.counterparty, `%${input.counterparty}%`),
      eq(deals.direction, input.direction),
      // Laycan within ±3 days
      sql`ABS(${deals.laycanStart}::date - ${input.laycanStart}::date) <= 3`,
      // Quantity within ±10%
      sql`ABS(${deals.quantityMt}::numeric - ${input.quantityMt}) / GREATEST(${deals.quantityMt}::numeric, 1) <= 0.1`,
      // Port match (either loadport or discharge port)
      sql`(${ilike(deals.loadport, `%${input.loadport}%`)} OR ${ilike(deals.dischargePort, `%${input.dischargePort}%`)})`,
    ];

    if (input.excludeDealId) {
      conditions.push(ne(deals.id, input.excludeDealId));
    }

    return db
      .select({
        id: deals.id,
        externalRef: deals.externalRef,
        counterparty: deals.counterparty,
        direction: deals.direction,
        product: deals.product,
        quantityMt: deals.quantityMt,
        laycanStart: deals.laycanStart,
        laycanEnd: deals.laycanEnd,
        loadport: deals.loadport,
        dischargePort: deals.dischargePort,
        status: deals.status,
      })
      .from(deals)
      .where(and(...conditions))
      .limit(10);
  });

  return NextResponse.json({ duplicates: result });
});
