import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { importDealSchema } from "@/lib/types/deal";
import { eq, and, ne, sql, ilike } from "drizzle-orm";
import { z } from "zod";

const importPayloadSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  mapping: z.record(z.string(), z.string()),
});

/**
 * Parse P(FOB ALIAGA 10-15 APR) or S(CIF AMSTERDAM 1-5 MAY 2026) format.
 * Extracts direction, incoterm, loadport, laycan dates.
 */
function parseLaycanCell(value: string): Record<string, string> | null {
  const match = value.match(
    /^([PS])\s*\(\s*(\w+)\s+(.+?)\s+(\d{1,2})\s*-\s*(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?\s*\)/i
  );
  if (!match) {
    // Simpler: just P or S direction
    const dirMatch = value.match(/^([PS])\s*\(/i);
    if (dirMatch) {
      return { direction: dirMatch[1].toUpperCase() === "P" ? "buy" : "sell" };
    }
    return null;
  }

  const [, dir, incoterm, port, dayStart, dayEnd, monthStr, yearStr] = match;
  const direction = dir.toUpperCase() === "P" ? "buy" : "sell";

  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const month = months[monthStr.toUpperCase()] ?? "01";
  const year = yearStr ?? new Date().getFullYear().toString();
  const startDay = dayStart.padStart(2, "0");
  const endDay = dayEnd.padStart(2, "0");

  return {
    direction,
    incoterm: incoterm.toUpperCase(),
    loadport: port.charAt(0).toUpperCase() + port.slice(1).toLowerCase(),
    laycanStart: `${year}-${month}-${startDay}`,
    laycanEnd: `${year}-${month}-${endDay}`,
  };
}

/**
 * Parse B/L figures like "37000MT +/-10%" or "37,000 MT" → numeric quantity string.
 */
function parseBlFigures(value: string): string | null {
  const cleaned = String(value).replace(/,/g, "").replace(/\s/g, "");
  const match = cleaned.match(/([\d.]+)\s*(?:MT|mt)?/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0) return String(num);
  }
  return null;
}

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
      // Map columns — handle virtual fields (_laycanCell, _blFigures)
      const mapped: Record<string, unknown> = {};
      for (const [excelCol, dealField] of Object.entries(mapping)) {
        if (!dealField || raw[excelCol] === undefined) continue;

        const cellValue = String(raw[excelCol] ?? "").trim();
        if (!cellValue) continue;

        if (dealField === "_laycanCell") {
          // Parse P(FOB ALIAGA 10-15 APR) format into multiple fields
          const parsed = parseLaycanCell(cellValue);
          if (parsed) {
            // Only set fields that aren't already mapped by other columns
            for (const [k, v] of Object.entries(parsed)) {
              if (!mapped[k]) mapped[k] = v;
            }
          }
        } else if (dealField === "_blFigures") {
          // Parse "37000MT +/-10%" → quantityMt + contractedQty
          const qty = parseBlFigures(cellValue);
          if (qty && !mapped["quantityMt"]) mapped["quantityMt"] = qty;
          // Store the original text as contractedQty (preserves tolerance info)
          if (!mapped["contractedQty"]) mapped["contractedQty"] = cellValue;
        } else {
          mapped[dealField] = raw[excelCol];
        }
      }

      // Try to validate (importDealSchema: product optional, empty strings → null)
      const result = importDealSchema.safeParse(mapped);
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
