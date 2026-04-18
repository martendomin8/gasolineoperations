import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { portCosts } from "@/lib/db/schema";

/**
 * Per-port costs entered by ops — canal tolls, port dues, agency,
 * pilotage, etc. Keyed by (port, year, costType) within a tenant,
 * so one port-year can carry multiple cost-type rows simultaneously.
 *
 * Values are what ops actually paid / were quoted — we don't try to
 * maintain a global pricing feed. Unlike Worldscale rates, where the
 * source is a published book, port costs vary per vessel size, cargo,
 * and season, so the `notes` field is heavily used in practice.
 */

const costTypeEnum = z.enum(["canal_toll", "port_dues", "agency", "pilotage", "other"]);

const listFilterSchema = z.object({
  port: z.string().min(1).optional(),
});

const upsertSchema = z.object({
  port: z.string().min(1).max(120),
  year: z.number().int().min(1970).max(2100),
  costType: costTypeEnum,
  amountUsd: z.number().min(0).max(9999999999),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/port-costs?port=Rotterdam, NL
// Returns all saved cost rows for the given port (or all the tenant's
// rows if no port filter), ordered by year ascending, then cost_type.
export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const parsed = listFilterSchema.safeParse({
    port: url.searchParams.get("port") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad filter" },
      { status: 400 }
    );
  }
  const { port } = parsed.data;

  const rows = await withTenantDb(session.user.tenantId, async (db) => {
    const conds = [eq(portCosts.tenantId, session.user.tenantId)];
    if (port) conds.push(eq(portCosts.port, port));
    return db
      .select()
      .from(portCosts)
      .where(and(...conds))
      .orderBy(asc(portCosts.year), asc(portCosts.costType));
  });

  return NextResponse.json({ costs: rows });
});

// POST /api/port-costs
// Upsert a cost row for (tenant, port, year, costType).
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
  const { port, year, costType, amountUsd, notes } = parsed.data;

  const saved = await withTenantDb(session.user.tenantId, async (db) => {
    const [row] = await db
      .insert(portCosts)
      .values({
        tenantId: session.user.tenantId,
        port,
        year,
        costType,
        amountUsd: amountUsd.toString(),
        notes: notes ?? null,
        createdBy: session.user.id,
      })
      .onConflictDoUpdate({
        target: [
          portCosts.tenantId,
          portCosts.port,
          portCosts.year,
          portCosts.costType,
        ],
        set: {
          amountUsd: amountUsd.toString(),
          notes: notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });

  return NextResponse.json({ cost: saved }, { status: 201 });
});
