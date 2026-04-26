// CP speed extraction + resolver. Two callers:
//
//  1. POST /api/linkages/[id]/documents — when a CP recap uploads, run
//     `extractWarrantedSpeedFromText` on the document body and write the
//     result to `linkages.cp_speed_kn` with source 'cp_clause'.
//  2. Voyage-timeline resolver — `resolveCpSpeed` decides which value to
//     use at read time given the linkage record + Q88 particulars.
//
// The resolver chain:
//
//   manual override     (operator typed it directly into the voyage bar)
//   > cp_clause         (parser extracted from CP recap / addendum)
//   > q88               (parser extracted from Q88 vessel block)
//   > DEFAULT_CP_SPEED  (12 kn — every product/chemical tanker cruises ~12)
//
// CP clause beats Q88 because warranted-speed clauses in the CP override
// vessel-design speed for that voyage (e.g. "vessel shall maintain her full
// service speed of approximately 13.5 knots" in a Bro Distributor addendum
// supersedes the lower Q88 economic speed).

import { simpleParser } from "mailparser";
import path from "path";
import { DEFAULT_CP_SPEED_KN } from "./constants";

export type CpSpeedSource = "cp_clause" | "q88" | "manual" | "default";

// Realistic tanker laden speeds: 8 kn (very slow steaming) to 20 kn
// (LR2 design max). Anything outside this is a regex false positive
// (e.g. matching "8 KNOTS WIND" instead of "8 KNOTS LADEN").
const MIN_REALISTIC_KN = 8;
const MAX_REALISTIC_KN = 20;

// Patterns ordered by specificity. First match wins. Each capture group #1
// must be the speed numeric. Tested against our 10 fixture CP recaps + the
// Bro Distributor full-speed addendum.
const WARRANTED_SPEED_PATTERNS: ReadonlyArray<RegExp> = [
  // Our fixture format: "WARRANTED SPEED : ABOUT 12 KNOTS LADEN WSNP"
  /WARRANTED\s+SPEED\s*:?\s*(?:ABOUT\s+)?(\d+(?:\.\d+)?)\s*KN(?:OTS|TS)?(?:\s+LADEN)?/i,
  // "FULL SERVICE SPEED OF APPROXIMATELY 13.5 KNOTS" (Bro Distributor addendum)
  /(?:FULL\s+)?SERVICE\s+SPEED\s+(?:OF\s+)?(?:APPROXIMATELY\s+)?(\d+(?:\.\d+)?)\s*KN(?:OTS|TS)?/i,
  // "SPEED LADEN: 12 KN" / "LADEN SPEED 12 KNOTS"
  /(?:SPEED\s+LADEN|LADEN\s+SPEED)\s*:?\s*(?:ABOUT\s+)?(\d+(?:\.\d+)?)\s*KN(?:OTS|TS)?/i,
  // "shall maintain her full service speed of approximately 13.5 knots"
  /MAINTAIN(?:\s+\w+){1,8}?\s+(?:OF\s+)?(?:APPROXIMATELY\s+)?(\d+(?:\.\d+)?)\s*KN(?:OTS|TS)?/i,
];

/**
 * Scan recap text for a warranted-speed clause. Returns the laden speed in
 * knots if a recognised pattern matches and the value is within realistic
 * tanker range. Otherwise null.
 *
 * Pure function — call it on the recap body once at upload time and persist
 * the result. Don't re-run per request.
 */
export function extractWarrantedSpeedFromText(text: string): number | null {
  if (!text || text.length < 20) return null;
  for (const pattern of WARRANTED_SPEED_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const speed = parseFloat(match[1]);
    if (Number.isNaN(speed)) continue;
    if (speed < MIN_REALISTIC_KN || speed > MAX_REALISTIC_KN) continue;
    return speed;
  }
  return null;
}

/**
 * Extract plain-text body from a CP-recap document buffer for speed parsing.
 * Mirrors the format support of the upload route (.eml / .txt / .pdf / .doc
 * / .docx). Returns empty string for unsupported types so the speed regex
 * just no-ops — never throws on a parser failure, since CP-speed extraction
 * is best-effort and must never block the document upload itself.
 */
export async function extractCpRecapText(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  try {
    if (ext === ".txt") {
      return buffer.toString("utf8");
    }

    if (ext === ".eml") {
      const parsed = await simpleParser(buffer);
      return parsed.text ?? "";
    }

    if (ext === ".pdf" || ext === ".doc" || ext === ".docx") {
      const { extractQ88Text } = await import("@/lib/ai/parse-q88");
      return extractQ88Text(buffer, ext);
    }
  } catch (err) {
    console.error("[cp-speed] text extraction failed:", err);
  }

  return "";
}

/**
 * Resolver chain for the voyage timeline. Read-time decision: which speed
 * value should drive the math for this linkage right now?
 *
 * Inputs:
 *   - linkageCpSpeedKn / linkageCpSpeedSource: from `linkages` row.
 *   - q88SpeedKn: pulled from `linkages.vessel_particulars.serviceSpeedLadenKn`
 *     (populated when a Q88 parse extracts a speed). Pass null if absent.
 */
export function resolveCpSpeed(opts: {
  linkageCpSpeedKn: number | string | null | undefined;
  linkageCpSpeedSource: string | null | undefined;
  q88SpeedKn: number | null | undefined;
}): { speedKn: number; source: CpSpeedSource } {
  const dbSpeed = toNumber(opts.linkageCpSpeedKn);
  const dbSource = opts.linkageCpSpeedSource;

  // Manual override beats everything — the operator deliberately set it.
  if (dbSpeed !== null && dbSource === "manual") {
    return { speedKn: dbSpeed, source: "manual" };
  }
  // CP clause from the recap / addendum.
  if (dbSpeed !== null && dbSource === "cp_clause") {
    return { speedKn: dbSpeed, source: "cp_clause" };
  }
  // Q88 parser already wrote the dedicated column.
  if (dbSpeed !== null && dbSource === "q88") {
    return { speedKn: dbSpeed, source: "q88" };
  }
  // Q88 particulars carry a speed but the dedicated column wasn't backfilled.
  const q88 = toNumber(opts.q88SpeedKn);
  if (q88 !== null) {
    return { speedKn: q88, source: "q88" };
  }
  // Either the column has a value with an unknown source (treat as manual)
  // or we have nothing — fall through to default.
  if (dbSpeed !== null) {
    return { speedKn: dbSpeed, source: (dbSource as CpSpeedSource) ?? "manual" };
  }
  return { speedKn: DEFAULT_CP_SPEED_KN, source: "default" };
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
