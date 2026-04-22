/**
 * Layer 3 — Identity cross-check.
 *
 * Compares the AIS-broadcast vessel identity against what we expect
 * from the linkage / Q88. Catches the "operator entered wrong MMSI"
 * class of errors that L1 validation can't see.
 *
 * Rules:
 *   - **Name mismatch:** AIS ShipName ≠ linkage.vesselName (after
 *     normalisation — upper-case, trim, strip MT/MV prefix). 'warn'
 *     because vessels DO get renamed between Q88 updates and crews
 *     occasionally mistype the AIS destination field.
 *   - **IMO mismatch:** AIS IMO ≠ linkage.vesselImo. 'warn' for the
 *     same reason — re-flagging changes MMSI but not IMO, and a
 *     mismatch is a strong signal of a wrong-MMSI configuration
 *     error by the operator.
 *   - **Dimension mismatch:** AIS LOA/beam differs from Q88 by
 *     > 10%. 'info' because AIS dimensions are entered imprecisely
 *     by crew (often rounded to the metre), but a > 10% gap implies
 *     we're tracking a totally different vessel class.
 */

import type { Flag, FlagType, FlagSeverity } from "./types";

export interface IdentityInput {
  /** From the AIS ShipStaticData we just received. */
  ais: {
    name: string | null;
    imo: string | null;
    lengthM: number | null;
    beamM: number | null;
  };
  /** From the linkage (and its Q88, if parsed). */
  expected: {
    name: string | null;
    imo: string | null;
    lengthM: number | null;
    beamM: number | null;
  };
  /** Audit context — what time was the AIS message received? */
  messageReceivedAt: Date;
}

const DIMENSION_TOLERANCE = 0.10; // 10% — AIS dims rounded to metres

export function checkIdentity(input: IdentityInput): Flag[] {
  const flags: Flag[] = [];
  const { ais, expected, messageReceivedAt } = input;

  // Only flag if BOTH sides have a value — if the linkage doesn't
  // yet have a vessel name, we can't expect a mismatch.
  if (
    ais.name !== null &&
    expected.name !== null &&
    !namesMatch(ais.name, expected.name)
  ) {
    flags.push(makeFlag("name_mismatch", "warn", {
      aisName: ais.name,
      expectedName: expected.name,
    }, messageReceivedAt));
  }

  if (
    ais.imo !== null &&
    expected.imo !== null &&
    ais.imo.replace(/\D/g, "") !== expected.imo.replace(/\D/g, "")
  ) {
    flags.push(makeFlag("imo_mismatch", "warn", {
      aisImo: ais.imo,
      expectedImo: expected.imo,
    }, messageReceivedAt));
  }

  // Dimensions — only flag when BOTH AIS and Q88 give us a number.
  // Reporting a mismatch against Q88 "unknown" is a false positive.
  if (
    ais.lengthM !== null &&
    expected.lengthM !== null &&
    ais.lengthM > 0 &&
    expected.lengthM > 0 &&
    outsideTolerance(ais.lengthM, expected.lengthM, DIMENSION_TOLERANCE)
  ) {
    flags.push(makeFlag("dimension_mismatch", "info", {
      dimension: "length",
      aisLengthM: ais.lengthM,
      expectedLengthM: expected.lengthM,
    }, messageReceivedAt));
  }
  if (
    ais.beamM !== null &&
    expected.beamM !== null &&
    ais.beamM > 0 &&
    expected.beamM > 0 &&
    outsideTolerance(ais.beamM, expected.beamM, DIMENSION_TOLERANCE)
  ) {
    flags.push(makeFlag("dimension_mismatch", "info", {
      dimension: "beam",
      aisBeamM: ais.beamM,
      expectedBeamM: expected.beamM,
    }, messageReceivedAt));
  }

  return flags;
}

// ---- Helpers -----------------------------------------------------

/**
 * Name comparison that tolerates the small stylistic variation
 * commodity traders enter into Q88 vs what the crew punches into
 * the AIS transponder:
 *   - case differences ("Nordic Star" vs "NORDIC STAR")
 *   - `MT` / `M/V` / `M.V.` prefixes on one side only
 *   - extra whitespace / AIS padding spaces
 *   - punctuation differences (hyphen vs space vs none)
 */
export function namesMatch(a: string, b: string): boolean {
  return normaliseName(a) === normaliseName(b);
}

function normaliseName(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/^M[\s\.\/]?[TV][\s\.]?/u, "")  // MT, M/V, M.T., M.V.
    .replace(/[^A-Z0-9]/g, "");              // drop spaces, hyphens, dots
}

function outsideTolerance(a: number, b: number, fraction: number): boolean {
  if (a === 0 || b === 0) return false;
  const ratio = Math.abs(a - b) / Math.max(a, b);
  return ratio > fraction;
}

function makeFlag(
  type: FlagType,
  severity: FlagSeverity,
  details: Record<string, unknown>,
  messageReceivedAt: Date,
): Flag {
  return { layer: "identity", type, severity, details, messageReceivedAt };
}
