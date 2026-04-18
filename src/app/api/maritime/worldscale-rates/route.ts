import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { worldscaleRates } from "@/lib/db/schema";

/**
 * Worldscale flat-rate storage for the Distance Planner.
 *
 * Operators enter the published WS100 flat rate (USD/MT) for a
 * specific (load port, discharge port, year) triple. Unique constraint
 * on those four columns (tenant + triple) means POST on an existing
 * row is an upsert — updating the stored rate + notes. Historical
 * rows are always preserved; deleting requires the DELETE endpoint.
 */

const listFilterSchema = z.object({
  loadPort: z.string().min(1).optional(),
  dischargePort: z.string().min(1).optional(),
});

const upsertSchema = z.object({
  loadPort: z.string().min(1).max(120),
  dischargePort: z.string().min(1).max(120),
  year: z.number().int().min(1970).max(2100),
  flatRateUsdMt: z.number().positive().max(9999999),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/worldscale-rates?loadPort=Rotterdam, NL&dischargePort=Houston, US
// Returns all years for the given (load, discharge) pair, oldest first,
// so the planner can show a historical strip. Without the filter,
// returns every row for the tenant (useful for an admin "all rates"
// view we haven't built yet — cheap to support).
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const parsed = listFilterSchema.safeParse({
    loadPort: url.searchParams.get("loadPort") ?? undefined,
    dischargePort: url.searchParams.get("dischargePort") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad filter" },
      { status: 400 }
    );
  }
  const { loadPort, dischargePort } = parsed.data;

  const rows = await withTenantDb(session.user.tenantId, async (db) => {
    const conds = [eq(worldscaleRates.tenantId, session.user.tenantId)];
    if (loadPort) conds.push(eq(worldscaleRates.loadPort, loadPort));
    if (dischargePort) conds.push(eq(worldscaleRates.dischargePort, dischargePort));
    return db
      .select()
      .from(worldscaleRates)
      .where(and(...conds))
      .orderBy(asc(worldscaleRates.year));
  });

  return NextResponse.json({ rates: rows });
});

// POST /api/worldscale-rates
// Upsert a rate for (tenant, loadPort, dischargePort, year). Body:
//   { loadPort, dischargePort, year, flatRateUsdMt, notes? }
export const POST = withAuth(async (req, _ctx, session) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { loadPort, dischargePort, year, flatRateUsdMt, notes } = parsed.data;

  const saved = await withTenantDb(session.user.tenantId, async (db) => {
    // Conflict target matches the unique index on (tenant, load, discharge, year)
    const [row] = await db
      .insert(worldscaleRates)
      .values({
        tenantId: session.user.tenantId,
        loadPort,
        dischargePort,
        year,
        flatRateUsdMt: flatRateUsdMt.toString(),
        notes: notes ?? null,
        createdBy: session.user.id,
      })
      .onConflictDoUpdate({
        target: [
          worldscaleRates.tenantId,
          worldscaleRates.loadPort,
          worldscaleRates.dischargePort,
          worldscaleRates.year,
        ],
        set: {
          flatRateUsdMt: flatRateUsdMt.toString(),
          notes: notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });

  return NextResponse.json({ rate: saved }, { status: 201 });
});
