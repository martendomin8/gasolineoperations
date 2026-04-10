import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { linkages, deals } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// === Request schema ===
const suggestSchema = z.object({
  counterparty: z.string().min(1),
  direction: z.enum(["buy", "sell"]),
  product: z.string().min(1),
  quantityMt: z.coerce.number().positive(),
  laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  vesselName: z.string().nullable().optional(),
  loadport: z.string().optional().default(""),
  dischargePort: z.string().nullable().optional(),
});

// === Response types ===
interface LinkageDealSummary {
  id: string;
  counterparty: string;
  direction: "buy" | "sell";
  quantityMt: number;
  product: string;
}

interface LinkageSuggestion {
  linkageId: string;
  displayName: string;
  score: number;
  reason: string;
  deals: LinkageDealSummary[];
}

// === Matching helpers ===

/** Case-insensitive fuzzy match: exact, substring, or token overlap. */
function vesselMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase().replace(/^(mt|m\/t|mv|m\/v)\s+/i, "");
  const nb = b.trim().toLowerCase().replace(/^(mt|m\/t|mv|m\/v)\s+/i, "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Token overlap: any shared token of length >= 4
  const ta = new Set(na.split(/\s+/).filter((t) => t.length >= 4));
  const tb = nb.split(/\s+/).filter((t) => t.length >= 4);
  return tb.some((t) => ta.has(t));
}

function counterpartyMatches(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring match for common shortenings (e.g. "Shell" vs "Shell Trading Rotterdam")
  return na.includes(nb) || nb.includes(na);
}

function productMatches(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

/** Inclusive date overlap of two [start, end] ranges. */
function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  if (Number.isNaN(as) || Number.isNaN(ae) || Number.isNaN(bs) || Number.isNaN(be)) {
    return false;
  }
  return as <= be && bs <= ae;
}

function quantityCompatible(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  const base = Math.max(a, b);
  return diff / base <= 0.2;
}

// === Handler ===

// POST /api/linkages/suggest
export const POST = withAuth(async (req, _ctx, session) => {
  const body = await req.json();
  const parseResult = suggestSchema.safeParse(body);
  if (!parseResult.success) {
    const first = parseResult.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Validation failed", issues: parseResult.error.issues },
      { status: 400 }
    );
  }
  const input = parseResult.data;

  const suggestions = await withTenantDb(session.user.tenantId, async (db) => {
    // Load all active linkages + their deals for this tenant
    const activeLinkages = await db
      .select({
        id: linkages.id,
        linkageNumber: linkages.linkageNumber,
        tempName: linkages.tempName,
        status: linkages.status,
      })
      .from(linkages)
      .where(
        and(
          eq(linkages.tenantId, session.user.tenantId),
          eq(linkages.status, "active")
        )
      );

    if (activeLinkages.length === 0) {
      return [] as LinkageSuggestion[];
    }

    const allDeals = await db
      .select({
        id: deals.id,
        linkageId: deals.linkageId,
        counterparty: deals.counterparty,
        direction: deals.direction,
        product: deals.product,
        quantityMt: deals.quantityMt,
        vesselName: deals.vesselName,
        laycanStart: deals.laycanStart,
        laycanEnd: deals.laycanEnd,
      })
      .from(deals)
      .where(eq(deals.tenantId, session.user.tenantId));

    // Group deals by linkageId
    const dealsByLinkage = new Map<string, typeof allDeals>();
    for (const d of allDeals) {
      if (!d.linkageId) continue;
      const existing = dealsByLinkage.get(d.linkageId);
      if (existing) {
        existing.push(d);
      } else {
        dealsByLinkage.set(d.linkageId, [d]);
      }
    }

    const oppositeDirection: "buy" | "sell" = input.direction === "buy" ? "sell" : "buy";
    const results: LinkageSuggestion[] = [];

    for (const linkage of activeLinkages) {
      const linkageDeals = dealsByLinkage.get(linkage.id) ?? [];

      // Empty linkages still get a minimal score of 0 — caller decides what to show.
      // We skip them here because there's nothing to compare against.
      if (linkageDeals.length === 0) continue;

      let score = 0;
      const reasons: string[] = [];

      // 1) Vessel match (+40) — case-insensitive, fuzzy
      if (input.vesselName) {
        const vesselHit = linkageDeals.some((d) =>
          vesselMatches(d.vesselName, input.vesselName ?? null)
        );
        if (vesselHit) {
          score += 40;
          reasons.push(`same vessel ${input.vesselName}`);
        }
      }

      // 2) Opposite direction, same counterparty (+20)
      const oppositeCpHit = linkageDeals.some(
        (d) =>
          d.direction === oppositeDirection &&
          counterpartyMatches(d.counterparty, input.counterparty)
      );
      if (oppositeCpHit) {
        score += 20;
        reasons.push(`opposite side of ${input.counterparty}`);
      }

      // 3) Date overlap (+20)
      const dateHit = linkageDeals.some((d) =>
        dateRangesOverlap(input.laycanStart, input.laycanEnd, d.laycanStart, d.laycanEnd)
      );
      if (dateHit) {
        score += 20;
        reasons.push("matching laycan");
      }

      // 4) Same product (+10)
      const productHit = linkageDeals.some((d) => productMatches(d.product, input.product));
      if (productHit) {
        score += 10;
        reasons.push("same product");
      }

      // 5) Compatible quantity (+10) — within 20%
      const qtyHit = linkageDeals.some((d) =>
        quantityCompatible(Number(d.quantityMt), input.quantityMt)
      );
      if (qtyHit) {
        score += 10;
        reasons.push("compatible quantity");
      }

      if (score >= 30) {
        results.push({
          linkageId: linkage.id,
          displayName: linkage.linkageNumber ?? linkage.tempName,
          score,
          reason: reasons.join(" · "),
          deals: linkageDeals.map((d) => ({
            id: d.id,
            counterparty: d.counterparty,
            direction: d.direction,
            quantityMt: Number(d.quantityMt),
            product: d.product,
          })),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 3);
  });

  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "no-store" } }
  );
});
