/**
 * Ship-type coefficients for the Kwon speed-loss formula.
 *
 * Derived from Kwon (1981, updated 2008) and later BIMCO weather
 * clause practice. Values are deliberately coarse — we publish
 * "roughly how much weather slows this ship down", not naval-
 * architecture precision. Per-vessel tuning happens later when we
 * have enough AIS-vs-forecast history to back-calibrate.
 *
 * How to read the numbers:
 *   - `baselineCoefficient` — dimensionless multiplier. 1.0 = "Kwon
 *     reference tanker loaded". Higher = loses more speed in same
 *     weather. Lower = cuts through weather better.
 *   - Ballast state adds windage (greater freeboard → more wind
 *     resistance on hull + deck). So ballast coefficients are always
 *     > loaded for the same ship type.
 *
 * Cross-references you can check these against:
 *   - Kwon 1981 tables (IMO technical annex)
 *   - StormGeo / NAPA public whitepapers — similar numbers
 *   - BIMCO Seaboard weather warranty template — matches magnitudes
 */

import type { LoadingState, ShipType } from "./types";

export interface ShipProfile {
  /** Bigger number = more weather drag. Reference value 1.0 = tanker
   *  loaded at service speed. Applied multiplicatively in kwon.ts. */
  baselineCoefficient: number;
  /** Coarse description for debug logs / UI tooltips. */
  description: string;
}

const PROFILES: Record<ShipType, Record<LoadingState, ShipProfile>> = {
  tanker: {
    loaded: {
      baselineCoefficient: 1.0,
      description: "Tanker, loaded — Kwon reference class.",
    },
    ballast: {
      // Ballast tankers sit high in the water: ~8-10 m freeboard vs 4-5
      // laden. Much more wind projected area, hull less efficient →
      // ~30% more weather loss for the same Beaufort.
      baselineCoefficient: 1.3,
      description: "Tanker, ballast — extra windage at high freeboard.",
    },
  },
  bulker: {
    loaded: {
      // Bulkers are broad-beam, slower-hulled vs tankers. Slightly
      // more sensitive to head seas.
      baselineCoefficient: 1.1,
      description: "Bulk carrier, loaded.",
    },
    ballast: {
      baselineCoefficient: 1.35,
      description: "Bulk carrier, ballast — high freeboard.",
    },
  },
  container: {
    loaded: {
      // Containers cut through weather better because of finer hull
      // form and higher Froude number (higher service speeds).
      baselineCoefficient: 0.9,
      description: "Container, loaded — fine hull cuts through seas.",
    },
    ballast: {
      // Container "ballast" is empty-of-boxes rather than water ballast
      // — still a tall hull with high windage.
      baselineCoefficient: 1.15,
      description: "Container, ballast / empty.",
    },
  },
  lng: {
    loaded: {
      // LNG carriers are typically shape-optimised for Froude and very
      // rounded at the bow — less pitching, less involuntary loss.
      baselineCoefficient: 0.85,
      description: "LNG carrier, loaded — rounded bow.",
    },
    ballast: {
      baselineCoefficient: 1.1,
      description: "LNG carrier, ballast.",
    },
  },
  general: {
    loaded: {
      baselineCoefficient: 1.0,
      description: "Generic vessel, loaded (fallback profile).",
    },
    ballast: {
      baselineCoefficient: 1.25,
      description: "Generic vessel, ballast (fallback profile).",
    },
  },
};

/** Look up the profile for a given ship type + loading. */
export function getShipProfile(
  type: ShipType,
  loading: LoadingState,
): ShipProfile {
  return PROFILES[type]?.[loading] ?? PROFILES.general[loading];
}

/** Infer ShipType from free-text Q88 vessel type strings. Best-effort;
 *  falls back to "general" when the string is empty or unrecognised. */
export function classifyShipType(vesselTypeText: string | null): ShipType {
  if (!vesselTypeText) return "general";
  const s = vesselTypeText.toLowerCase();
  if (s.includes("lng") || s.includes("lpg")) return "lng";
  if (s.includes("container") || s.includes("boxship")) return "container";
  if (s.includes("bulk") || s.includes("ore")) return "bulker";
  if (
    s.includes("tank") ||
    /\bmt\b/.test(s) ||    // MT prefix (Motor Tanker)
    /\bmr\b/.test(s) ||    // MR (Medium Range)
    s.includes("lr1") ||
    s.includes("lr2") ||
    s.includes("vlcc") ||
    s.includes("chemical") ||
    s.includes("product") ||
    s.includes("oil")
  ) {
    return "tanker";
  }
  return "general";
}

/** Expose for unit tests. */
export const _profiles = PROFILES;
