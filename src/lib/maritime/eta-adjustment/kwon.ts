/**
 * Kwon's method — involuntary speed loss in heavy weather.
 *
 * Published by Y.J. Kwon in 1981, revised 2008. The industry-standard
 * "good enough" empirical model for how much weather slows a moving
 * hull down. Used in BIMCO weather warranties, ISO 15016 speed-trial
 * corrections, and the baseline layer of most commercial voyage
 * optimisation tools (StormGeo, DTN, NAPA).
 *
 * Simplification vs the original paper:
 *
 *   - We use a lookup-table form of Kwon's Cu (Beaufort) function
 *     instead of the polynomial in Froude number. Our ship data
 *     doesn't include Froude (we'd need wetted-surface area + block
 *     coefficient), and for our use case — commercial tanker cruise
 *     speeds around 12 kn — the polynomial is almost linear with BN,
 *     so the table loses nothing material.
 *
 *   - Directional coefficient Cβ is a piecewise fit to the original
 *     figure (Kwon 1981, Fig. 2): max at head seas (β=0°), falls
 *     through beam (~0.5) and goes slightly negative at following
 *     seas (the ship can actually gain a small push from a stern-
 *     quarter wave train). We clamp the negative to zero so
 *     `effectiveSpeed` never exceeds commanded speed — that would
 *     encode "ocean speeds you up" into the UI, which is more
 *     confusing than useful.
 *
 *   - Ship form coefficient is a single number per vessel class +
 *     loading state (see `ship-profiles.ts`) rather than Kwon's
 *     piecewise function of displacement and block coefficient.
 *     Again: we don't have that data reliably, and V1.5 calibration
 *     will learn per-vessel corrections from AIS anyway.
 *
 * Math reference formulae:
 *
 *   ΔV / V = 0.5 × Cβ × CU × CShip        (eq. 1, Kwon)
 *
 * Where:
 *   ΔV = speed loss (m/s)
 *   V  = commanded (calm-water) speed (m/s)
 *   Cβ = wave-direction coefficient (0 - 2.0)
 *   CU = speed-reduction coefficient (function of Beaufort)
 *   CShip = ship-type / loading coefficient
 *
 * The 0.5 factor is carried by `CU` in our lookup table (pre-multiplied)
 * so `speedLossFraction = Cβ * CU * CShip`. Stays within [0, 1] clamped.
 */

import { getShipProfile } from "./ship-profiles";
import type { KwonInput, KwonResult } from "./types";

// ---- Beaufort lookup ----------------------------------------------

/**
 * Wind speed (knots) → Beaufort number. Standard Beaufort scale
 * (WMO / Admiralty). Boundaries are the MAX of each band.
 */
export function windSpeedToBeaufort(kn: number): number {
  if (kn < 1) return 0;
  if (kn < 4) return 1;
  if (kn < 7) return 2;
  if (kn < 11) return 3;
  if (kn < 17) return 4;
  if (kn < 22) return 5;
  if (kn < 28) return 6;
  if (kn < 34) return 7;
  if (kn < 41) return 8;
  if (kn < 48) return 9;
  if (kn < 56) return 10;
  if (kn < 64) return 11;
  return 12;
}

/**
 * Kwon's CU (speed-reduction coefficient) as a function of Beaufort
 * number — baseline loss fraction for a reference tanker in head
 * seas before any ship/direction multipliers.
 *
 * Lookup values are calibrated against Kwon's Fig. 3 for tankers at
 * Froude ≈ 0.17 (typical 12 kn on MR hull), then scaled to cover
 * "commercial tanker at service speed" use case.
 */
const CU_BY_BEAUFORT: Record<number, number> = {
  0: 0.00,
  1: 0.00,
  2: 0.00,
  3: 0.01,   // 1% loss at Beaufort 3 — barely measurable
  4: 0.03,   // 3% at BN4 — light chop
  5: 0.06,   // 6% at BN5 — fresh breeze
  6: 0.10,   // 10% at BN6 — strong breeze, white caps
  7: 0.16,   // 16% at BN7 — near gale
  8: 0.24,   // 24% at BN8 — gale
  9: 0.32,   // 32% at BN9 — strong gale
  10: 0.42,  // 42% at BN10 — storm
  11: 0.55,  // 55% at BN11 — violent storm
  12: 0.70,  // 70% at BN12 — hurricane (vessel usually hove-to anyway)
};

export function cuForBeaufort(bn: number): number {
  return CU_BY_BEAUFORT[bn] ?? 0;
}

// ---- Directional coefficient --------------------------------------

/**
 * `relAngleDeg` is the angle between the ship's heading and the wave
 * DIRECTION (where waves are going, not where they come from). 0 =
 * head seas, 180 = following. Returns Cβ scaled 0 – 1.0.
 *
 * Curve fit from Kwon's Fig. 2:
 *   0°   (head)          → 1.00
 *   45°  (bow quarter)   → 0.85
 *   90°  (beam)          → 0.55
 *   135° (stern quarter) → 0.20
 *   180° (following)     → 0.00
 */
export function directionCoefficient(relAngleDeg: number): number {
  const a = Math.abs(normalizeAngle(relAngleDeg));
  if (a <= 45) {
    // 0° → 1.0, 45° → 0.85
    return 1.0 - (a / 45) * 0.15;
  }
  if (a <= 90) {
    // 45° → 0.85, 90° → 0.55
    return 0.85 - ((a - 45) / 45) * 0.30;
  }
  if (a <= 135) {
    // 90° → 0.55, 135° → 0.20
    return 0.55 - ((a - 90) / 45) * 0.35;
  }
  // 135° → 0.20, 180° → 0.0
  return 0.20 - ((a - 135) / 45) * 0.20;
}

/** Normalise any angle into [-180, 180]. */
function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

// ---- The main entry point ----------------------------------------

/**
 * Evaluate Kwon's formula once. Given a ship state + weather at a
 * point in time, how much speed does the vessel lose?
 */
export function calculateSpeedLoss(input: KwonInput): KwonResult {
  const { ship, state, weather } = input;
  const profile = getShipProfile(ship.type, ship.loadingState);

  const bn = windSpeedToBeaufort(weather.windSpeedKn);
  const cu = cuForBeaufort(bn);

  // `waveDirDeg` is "where waves COME FROM" (meteorological convention).
  // Head seas = the ship is pointed AT the wave source — i.e. the ship
  // heading and the wave-from-direction are aligned. Picture standing
  // on deck facing the wave front; looking forward, you see the waves
  // rolling toward you from ahead.
  //   headingDeg = 90 (east), waveDirDeg = 90 (from east) → head seas
  //   headingDeg = 90 (east), waveDirDeg = 270 (from west) → following
  // Pure subtraction, no +/-180 flip.
  const rawRel = normalizeAngle(state.headingDeg - weather.waveDirDeg);
  // For Cβ we only care about the magnitude — port and starboard seas
  // slow you down equally. Only the head/beam/following axis matters.
  const relAngle = Math.abs(rawRel);

  const cBeta = directionCoefficient(relAngle);
  const cShip = profile.baselineCoefficient;

  // ΔV/V = Cβ × CU × CShip, clamped to [0, 0.95]. We never let the
  // vessel drop below 5% of commanded speed — anything lower is
  // effectively "hove-to" territory where Kwon breaks down and the
  // captain is making route decisions Kwon can't model.
  const rawLoss = cBeta * cu * cShip;
  const speedLossFraction = Math.max(0, Math.min(0.95, rawLoss));

  const effectiveSpeedKn = state.commandedSpeedKn * (1 - speedLossFraction);

  return {
    speedLossFraction,
    effectiveSpeedKn,
    beaufortNumber: bn,
    relativeWaveAngleDeg: relAngle,
    note: explainResult(bn, relAngle, speedLossFraction, profile.description),
  };
}

/** Human-readable summary for popups / debug logs. */
function explainResult(
  bn: number,
  relAngle: number,
  loss: number,
  profileDesc: string,
): string {
  const direction =
    relAngle < 45
      ? "head seas"
      : relAngle < 90
        ? "bow quarter"
        : relAngle < 135
          ? "beam seas"
          : relAngle < 180
            ? "stern quarter"
            : "following seas";
  const pct = (loss * 100).toFixed(1);
  return `BN ${bn}, ${direction}: ${pct}% speed loss (${profileDesc})`;
}
