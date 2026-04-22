/**
 * Regional climatological averages — the fallback weather source used
 * when the voyage extends beyond our NOAA GFS forecast horizon
 * (currently 5 days ahead; will extend when Marten restores the 16-day
 * pipeline).
 *
 * Values are month-dependent mean Beaufort + typical significant wave
 * heights for major shipping regions. Sources:
 *   - UK Met Office pilot charts (North Atlantic, Pacific)
 *   - Admiralty Routing Charts
 *   - Open-source ocean atlas data (IFREMER, NOAA Climate Atlas)
 *
 * Granularity is deliberately coarse — one row per ocean region per
 * season — because:
 *   1. Kwon is only order-of-magnitude accurate anyway.
 *   2. Forecast uncertainty beyond 5 days is > 50%, so sub-regional
 *      climatology precision adds no real information.
 *   3. Hard-coded values stay version-controlled and testable, no
 *      runtime fetch latency.
 *
 * Format of each entry: `beaufort` is the monthly mean BN (0-12 scale);
 * `waveHeightM` is the associated typical significant wave height.
 * Wind direction is the prevailing direction for that season; wave
 * direction follows it closely in open ocean (wind-driven seas).
 */

import type { WeatherCondition } from "./types";

export interface ClimateZone {
  code: string;
  /** [[latMin, lonMin], [latMax, lonMax]]. Overlaps OK — we pick first
   *  match in order declared below, so more specific zones go first. */
  bbox: [[number, number], [number, number]];
  /** 12-entry array: [jan, feb, ..., dec]. Monthly mean conditions. */
  monthly: Array<{
    beaufort: number;
    waveHeightM: number;
    windDirDeg: number;
  }>;
}

/**
 * Zones listed in order of specificity — smaller / more enclosed seas
 * before their parent oceans. `zoneFor` picks the first bbox that
 * contains the query point.
 */
export const CLIMATE_ZONES: ClimateZone[] = [
  // ---- Enclosed / semi-enclosed seas -----------------------------
  {
    code: "mediterranean",
    bbox: [[30.0, -5.5], [46.0, 36.0]],
    // Med is calmer than open ocean year-round; worst in winter (Mistral,
    // Sirocco). BF 4-5 typical winter, BF 2-3 summer.
    monthly: [
      { beaufort: 5, waveHeightM: 2.0, windDirDeg: 300 }, // Jan
      { beaufort: 5, waveHeightM: 1.9, windDirDeg: 300 }, // Feb
      { beaufort: 4, waveHeightM: 1.6, windDirDeg: 290 }, // Mar
      { beaufort: 4, waveHeightM: 1.3, windDirDeg: 270 }, // Apr
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 260 }, // May
      { beaufort: 3, waveHeightM: 0.9, windDirDeg: 250 }, // Jun
      { beaufort: 3, waveHeightM: 0.9, windDirDeg: 240 }, // Jul
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 250 }, // Aug
      { beaufort: 4, waveHeightM: 1.2, windDirDeg: 270 }, // Sep
      { beaufort: 4, waveHeightM: 1.5, windDirDeg: 290 }, // Oct
      { beaufort: 5, waveHeightM: 1.8, windDirDeg: 300 }, // Nov
      { beaufort: 5, waveHeightM: 2.0, windDirDeg: 300 }, // Dec
    ],
  },
  {
    code: "baltic",
    bbox: [[54.0, 9.0], [66.0, 30.0]],
    monthly: [
      { beaufort: 5, waveHeightM: 2.0, windDirDeg: 240 }, // Jan
      { beaufort: 5, waveHeightM: 1.9, windDirDeg: 240 }, // Feb
      { beaufort: 4, waveHeightM: 1.6, windDirDeg: 240 }, // Mar
      { beaufort: 4, waveHeightM: 1.4, windDirDeg: 230 }, // Apr
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 220 }, // May
      { beaufort: 3, waveHeightM: 0.9, windDirDeg: 220 }, // Jun
      { beaufort: 3, waveHeightM: 0.9, windDirDeg: 230 }, // Jul
      { beaufort: 4, waveHeightM: 1.1, windDirDeg: 230 }, // Aug
      { beaufort: 4, waveHeightM: 1.4, windDirDeg: 240 }, // Sep
      { beaufort: 5, waveHeightM: 1.8, windDirDeg: 240 }, // Oct
      { beaufort: 5, waveHeightM: 2.0, windDirDeg: 240 }, // Nov
      { beaufort: 5, waveHeightM: 2.1, windDirDeg: 240 }, // Dec
    ],
  },
  {
    code: "north_sea",
    bbox: [[51.0, -4.0], [62.0, 12.0]],
    monthly: [
      { beaufort: 6, waveHeightM: 3.5, windDirDeg: 240 }, // Jan
      { beaufort: 6, waveHeightM: 3.2, windDirDeg: 240 }, // Feb
      { beaufort: 5, waveHeightM: 2.6, windDirDeg: 240 }, // Mar
      { beaufort: 4, waveHeightM: 2.0, windDirDeg: 240 }, // Apr
      { beaufort: 4, waveHeightM: 1.6, windDirDeg: 240 }, // May
      { beaufort: 4, waveHeightM: 1.5, windDirDeg: 240 }, // Jun
      { beaufort: 4, waveHeightM: 1.5, windDirDeg: 240 }, // Jul
      { beaufort: 4, waveHeightM: 1.7, windDirDeg: 240 }, // Aug
      { beaufort: 5, waveHeightM: 2.2, windDirDeg: 240 }, // Sep
      { beaufort: 5, waveHeightM: 2.7, windDirDeg: 240 }, // Oct
      { beaufort: 6, waveHeightM: 3.2, windDirDeg: 240 }, // Nov
      { beaufort: 6, waveHeightM: 3.5, windDirDeg: 240 }, // Dec
    ],
  },
  {
    code: "biscay",
    bbox: [[43.0, -12.0], [49.0, -1.0]],
    monthly: [
      { beaufort: 6, waveHeightM: 4.0, windDirDeg: 260 }, // Jan
      { beaufort: 6, waveHeightM: 3.8, windDirDeg: 260 }, // Feb
      { beaufort: 5, waveHeightM: 3.0, windDirDeg: 260 }, // Mar
      { beaufort: 5, waveHeightM: 2.5, windDirDeg: 260 }, // Apr
      { beaufort: 4, waveHeightM: 2.0, windDirDeg: 270 }, // May
      { beaufort: 4, waveHeightM: 1.6, windDirDeg: 280 }, // Jun
      { beaufort: 3, waveHeightM: 1.4, windDirDeg: 280 }, // Jul
      { beaufort: 4, waveHeightM: 1.6, windDirDeg: 270 }, // Aug
      { beaufort: 5, waveHeightM: 2.3, windDirDeg: 260 }, // Sep
      { beaufort: 5, waveHeightM: 3.0, windDirDeg: 260 }, // Oct
      { beaufort: 6, waveHeightM: 3.6, windDirDeg: 260 }, // Nov
      { beaufort: 6, waveHeightM: 4.0, windDirDeg: 260 }, // Dec
    ],
  },
  // ---- Open ocean regions (lower priority catch-alls) ------------
  {
    code: "north_atlantic",
    bbox: [[25.0, -75.0], [65.0, 0.0]],
    monthly: [
      { beaufort: 7, waveHeightM: 4.5, windDirDeg: 250 }, // Jan
      { beaufort: 7, waveHeightM: 4.3, windDirDeg: 250 }, // Feb
      { beaufort: 6, waveHeightM: 3.5, windDirDeg: 250 }, // Mar
      { beaufort: 5, waveHeightM: 2.8, windDirDeg: 250 }, // Apr
      { beaufort: 4, waveHeightM: 2.2, windDirDeg: 250 }, // May
      { beaufort: 4, waveHeightM: 2.0, windDirDeg: 250 }, // Jun
      { beaufort: 4, waveHeightM: 1.9, windDirDeg: 250 }, // Jul
      { beaufort: 4, waveHeightM: 2.0, windDirDeg: 250 }, // Aug
      { beaufort: 5, waveHeightM: 2.6, windDirDeg: 250 }, // Sep
      { beaufort: 6, waveHeightM: 3.3, windDirDeg: 250 }, // Oct
      { beaufort: 6, waveHeightM: 4.0, windDirDeg: 250 }, // Nov
      { beaufort: 7, waveHeightM: 4.4, windDirDeg: 250 }, // Dec
    ],
  },
  {
    code: "arabian_sea",
    bbox: [[0.0, 45.0], [30.0, 75.0]],
    // Dominated by monsoon cycle — SW monsoon Jun-Sep = heavy seas.
    monthly: [
      { beaufort: 3, waveHeightM: 1.2, windDirDeg: 30 },  // Jan (NE)
      { beaufort: 3, waveHeightM: 1.2, windDirDeg: 30 },  // Feb
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 30 },  // Mar
      { beaufort: 2, waveHeightM: 0.8, windDirDeg: 0 },   // Apr
      { beaufort: 4, waveHeightM: 1.5, windDirDeg: 240 }, // May (pre-monsoon)
      { beaufort: 7, waveHeightM: 3.5, windDirDeg: 240 }, // Jun SW monsoon
      { beaufort: 7, waveHeightM: 4.0, windDirDeg: 240 }, // Jul
      { beaufort: 7, waveHeightM: 3.8, windDirDeg: 240 }, // Aug
      { beaufort: 5, waveHeightM: 2.5, windDirDeg: 240 }, // Sep
      { beaufort: 3, waveHeightM: 1.2, windDirDeg: 30 },  // Oct
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 30 },  // Nov
      { beaufort: 3, waveHeightM: 1.0, windDirDeg: 30 },  // Dec
    ],
  },
  {
    code: "default_ocean",
    bbox: [[-90, -180], [90, 180]],
    // Global "decent weather" fallback — used for anywhere not covered
    // by a more specific zone. BF 4 + 2m is a very plausible average.
    monthly: Array.from({ length: 12 }, () => ({
      beaufort: 4,
      waveHeightM: 2.0,
      windDirDeg: 240,
    })),
  },
];

/** Find the best-matching climate zone for a point. Falls through to
 *  `default_ocean` so callers never get null. */
export function zoneFor(lat: number, lon: number): ClimateZone {
  for (const zone of CLIMATE_ZONES) {
    const [[latMin, lonMin], [latMax, lonMax]] = zone.bbox;
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
      return zone;
    }
  }
  return CLIMATE_ZONES[CLIMATE_ZONES.length - 1];
}

/** Beaufort → wind speed (knots) midpoint lookup. Used by climatology
 *  to produce a WeatherCondition from a stored BN value. */
const BEAUFORT_KN: Record<number, number> = {
  0: 0, 1: 2, 2: 5, 3: 8.5, 4: 13.5, 5: 19, 6: 24.5,
  7: 30.5, 8: 37, 9: 44, 10: 52, 11: 60, 12: 68,
};

/** Translate a zone's monthly entry into a WeatherCondition. */
export function climatologyAt(
  lat: number,
  lon: number,
  when: Date,
): WeatherCondition {
  const zone = zoneFor(lat, lon);
  const month = when.getUTCMonth(); // 0-11
  const entry = zone.monthly[month];
  return {
    windSpeedKn: BEAUFORT_KN[entry.beaufort] ?? 13.5,
    windDirDeg: entry.windDirDeg,
    waveHeightM: entry.waveHeightM,
    // Seas in open ocean are mostly wind-driven; assume wave direction
    // tracks wind. Fine for Kwon (we only care about relative angle
    // to ship heading, not absolute accuracy).
    waveDirDeg: entry.windDirDeg,
  };
}
