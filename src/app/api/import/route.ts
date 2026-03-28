import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { createDealSchema } from "@/lib/types/deal";
import { eq, and, ne, sql, ilike } from "drizzle-orm";
import { z } from "zod";

const importPayloadSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  mapping: z.record(z.string(), z.string()),
});

// POST /api/import — Parse, validate, and deduplicate imported rows
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const { rows, mapping } = importPayloadSchema.parse(body);

    const valid: any[] = [];
    const invalid: any[] = [];
    const duplicateRows: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      // Map columns
      const mapped: Record<string, unknown> = {};
      for (const [excelCol, dealField] of Object.entries(mapping)) {
        if (dealField && raw[excelCol] !== undefined) {
          mapped[dealField] = raw[excelCol];
        }
      }

      // Try to validate
      const result = createDealSchema.safeParse(mapped);
      if (!result.success) {
        invalid.push({
          rowIndex: i,
          data: mapped,
          errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
        });
        continue;
      }

      // Check for duplicates
      const dupes = await withTenantDb(session.user.tenantId, async (db) => {
        return db
          .select({ id: deals.id, counterparty: deals.counterparty })
          .from(deals)
          .where(
            and(
              eq(deals.tenantId, session.user.tenantId),
              ne(deals.status, "cancelled"),
              ilike(deals.counterparty, `%${result.data.counterparty}%`),
              eq(deals.direction, result.data.direction as any),
              sql`ABS(${deals.laycanStart}::date - ${result.data.laycanStart}::date) <= 3`
            )
          )
          .limit(1);
      });

      if (dupes.length > 0) {
        duplicateRows.push({
          rowIndex: i,
          data: result.data,
          matchedDealId: dupes[0].id,
          matchedCounterparty: dupes[0].counterparty,
        });
      } else {
        valid.push({ rowIndex: i, data: result.data });
      }
    }

    return NextResponse.json({ valid, invalid, duplicates: duplicateRows });
  },
  { roles: ["operator", "admin"] }
);
