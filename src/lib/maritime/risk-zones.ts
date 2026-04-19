/**
 * Shipping risk zones + forbidden routing zones + navigable whitelists.
 *
 * This module is a thin TypeScript view over the canonical JSON file
 * at `scripts/ocean-routing/zones.json`. Do NOT hand-edit zone data
 * here — use the Fleet dev-tools Zone Editor. Changes flow:
 *   editor → POST /api/maritime/zones → scripts/ocean-routing/zones.json
 *   → imported here (static bundle) → rendered on map + consumed by
 *     Python routing pipeline on the next rebuild.
 *
 * Zone categories:
 *   war / piracy / tension = visible overlays (today's risk-zone pills)
 *   forbidden              = routing-blocking (may be visible or hidden)
 *   navigable              = override GSHHG land check (narrow straits)
 *
 * Sources for the visible zones — all public industry guidance:
 *   - Indian Ocean HRA → BMP5 (Best Management Practices v5)
 *   - Gulf of Guinea → IMB PRC / MDAT-GoG reporting area
 *   - Red Sea / Bab el-Mandeb → JWC (Joint War Committee) listed area
 *   - Black Sea → JWC listed area since Feb 2022 (Russia-Ukraine)
 *   - Strait of Hormuz / Persian Gulf → US 5th Fleet AOI
 *   - Sulu / Celebes Seas → ReCAAP + Philippine coast guard warnings
 *
 * Boundaries are simplified for on-map display, NOT legal definitions.
 * Operators must check current advisories (UKMTO, MDAT-GoG, MSC-HOA)
 * before transit.
 */

import zonesRaw from "../../../scripts/ocean-routing/zones.json";

export type ZoneCategory =
  | "war"
  | "piracy"
  | "tension"
  | "forbidden"
  | "navigable";

export interface Zone {
  id: string;
  label: string;
  category: ZoneCategory;
  visible: boolean;
  blocksRouting: boolean;
  navigable: boolean;
  note?: string;
  since?: string;
  polygon: Array<[number, number]>;
}

interface ZonesFile {
  _meta?: Record<string, unknown>;
  zones: Zone[];
}

// TS can't infer that the JSON's `category` strings narrow to our
// literal union. Two-step cast via `unknown` is the idiomatic way to
// tell it we trust the shape — the runtime JSON is validated by the
// API POST schema (scripts/api/maritime/zones) so what ends up in
// zones.json always matches the interface.
const zonesFile = zonesRaw as unknown as ZonesFile;

/** Every zone — used by the dev editor to see both visible + hidden. */
export const ALL_ZONES: Zone[] = zonesFile.zones;

/**
 * Backwards-compatible export: the map's risk-overlay layer used to
 * import `RISK_ZONES` directly from this file. Keep the shape stable
 * so the map can keep rendering without touching that component.
 *
 * Only `visible: true` zones with the three "visual" categories are
 * part of the risk overlay. Forbidden / navigable zones live in the
 * dev editor only (unless manually flipped to visible).
 */
export interface RiskZone {
  id: string;
  name: string;
  type: "war" | "piracy" | "tension";
  fillPolygon: Array<[number, number]>;
  note: string;
  since: string;
  labelAnchor: [number, number];
}

/** Rough polygon centroid for label anchor placement. */
function polygonCentroid(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0];
  let latSum = 0;
  let lonSum = 0;
  for (const [lat, lon] of polygon) {
    latSum += lat;
    lonSum += lon;
  }
  return [latSum / polygon.length, lonSum / polygon.length];
}

export const RISK_ZONES: RiskZone[] = ALL_ZONES
  .filter(
    (z) =>
      z.visible &&
      (z.category === "war" || z.category === "piracy" || z.category === "tension")
  )
  .map((z) => ({
    id: z.id,
    name: z.label,
    type: z.category as "war" | "piracy" | "tension",
    fillPolygon: z.polygon,
    note: z.note ?? "",
    since: z.since ?? "",
    labelAnchor: polygonCentroid(z.polygon),
  }));

/**
 * Color + opacity per risk type. All danger zones are red — piracy
 * and active war look the same severity visually, with slight
 * intensity differences so an overlap (e.g. Red Sea where Houthi
 * missile risk and piracy co-exist) stays readable. Tension zones
 * (political, not kinetic) use amber so they're clearly a lower
 * severity tier.
 */
export const RISK_STYLES: Record<
  RiskZone["type"],
  { fillColor: string; fillOpacity: number; borderColor: string; borderOpacity: number; weight: number }
> = {
  war: {
    fillColor: "#b91c1c",
    fillOpacity: 0.16,
    borderColor: "#dc2626",
    borderOpacity: 0.95,
    weight: 2,
  },
  piracy: {
    fillColor: "#dc2626",
    fillOpacity: 0.13,
    borderColor: "#ef4444",
    borderOpacity: 0.9,
    weight: 2,
  },
  tension: {
    fillColor: "#f59e0b",
    fillOpacity: 0.08,
    borderColor: "#f59e0b",
    borderOpacity: 0.8,
    weight: 1.5,
  },
};

export const RISK_TYPE_LABELS: Record<RiskZone["type"], string> = {
  war: "WAR RISK",
  piracy: "PIRACY",
  tension: "TENSION",
};

/**
 * Style for forbidden / navigable zones in the dev editor. Distinct
 * from risk styles so you don't confuse "ops forbidden" with
 * "industry war risk".
 */
export const ZONE_STYLES: Record<
  "forbidden" | "navigable",
  { fillColor: string; fillOpacity: number; borderColor: string; borderOpacity: number; weight: number }
> = {
  forbidden: {
    fillColor: "#a855f7", // purple — clearly "ops rule", not piracy
    fillOpacity: 0.18,
    borderColor: "#c084fc",
    borderOpacity: 0.95,
    weight: 2,
  },
  navigable: {
    fillColor: "#22d3ee", // cyan — "known passage"
    fillOpacity: 0.1,
    borderColor: "#67e8f9",
    borderOpacity: 0.8,
    weight: 1.5,
  },
};
