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
  laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  loadport: z.string(),
  dischargePort: z.string().nullable().optional(),
  excludeDealId: z.string().uuid().optional(),
});

// POST /api/deals/check-duplicates
//
// Returns two parallel lists:
//   - duplicates       — same-direction matches. The classic "did you
//                        already enter this same buy/sell?" suggestion
//                        the duplicate-prevention modal shows.
//   - oppositeMatches  — opposite-direction matches with same product +
//                        compatible quantity + port overlap. These are
//                        likely back-to-back candidates: operator just
//                        parsed a SALE that pairs with an existing
//                        PURCHASE, or vice versa. The parser modal asks
//                        whether to link them under the same linkage.
//                        Per Arne 2026-04-27: never auto-link — always
//                        prompt, because coincidences happen and getting
//                        it wrong corrupts a different cargo's chain.
export const POST = withAuth(async (req, _ctx, session) => {
  const body = await req.json();
  const parseResult = checkDuplicatesSchema.safeParse(body);
  if (!parseResult.success) {
    const first = parseResult.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Validation failed", issues: parseResult.error.issues },
      { status: 400 }
    );
  }
  const input = parseResult.data;
  const opposite = input.direction === "buy" ? "sell" : "buy";

  const result = await withTenantDb(session.user.tenantId, async (db) => {
    const baseSelect = {
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
      linkageCode: deals.linkageCode,
      linkageId: deals.linkageId,
    };

    const sameDirConditions = [
      eq(deals.tenantId, session.user.tenantId),
      ne(deals.status, "cancelled"),
      ilike(deals.counterparty, `%${input.counterparty}%`),
      eq(deals.direction, input.direction),
      // Laycan within ±3 days
      sql`ABS(${deals.laycanStart}::date - ${input.laycanStart}::date) <= 3`,
      // Quantity within ±10%
      sql`ABS(${deals.quantityMt}::numeric - ${input.quantityMt}) / GREATEST(${deals.quantityMt}::numeric, 1) <= 0.1`,
      // Port match (either loadport or discharge port)
      input.dischargePort
        ? sql`(${ilike(deals.loadport, `%${input.loadport}%`)} OR ${ilike(deals.dischargePort, `%${input.dischargePort}%`)})`
        : ilike(deals.loadport, `%${input.loadport}%`),
    ];
    if (input.excludeDealId) {
      sameDirConditions.push(ne(deals.id, input.excludeDealId));
    }

    // Opposite-direction (back-to-back) match: don't constrain by
    // counterparty (different party on the other side of the trade) and
    // don't require both ports to overlap (the existing buy might have
    // only loadport set if its disport hadn't been chosen yet). Keep the
    // strict bits: same product, qty within ±10%, laycan within ±5 days
    // (a touch wider since the buy + sell laycans for the same cargo
    // typically share start but the sale's window can extend further).
    const oppositeConditions = [
      eq(deals.tenantId, session.user.tenantId),
      ne(deals.status, "cancelled"),
      eq(deals.direction, opposite),
      ilike(deals.product, `%${input.product}%`),
      sql`ABS(${deals.laycanStart}::date - ${input.laycanStart}::date) <= 5`,
      sql`ABS(${deals.quantityMt}::numeric - ${input.quantityMt}) / GREATEST(${deals.quantityMt}::numeric, 1) <= 0.1`,
    ];
    if (input.excludeDealId) {
      oppositeConditions.push(ne(deals.id, input.excludeDealId));
    }

    const [duplicates, oppositeMatches] = await Promise.all([
      db.select(baseSelect).from(deals).where(and(...sameDirConditions)).limit(10),
      db.select(baseSelect).from(deals).where(and(...oppositeConditions)).limit(10),
    ]);
    return { duplicates, oppositeMatches };
  });

  return NextResponse.json(result);
});
