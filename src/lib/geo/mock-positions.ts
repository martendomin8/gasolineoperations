/**
 * Mock vessel position generator for the Fleet Map prototype.
 *
 * Given a linkage status and load/discharge port coordinates, computes a
 * plausible vessel position. Uses deterministic offsets (seeded by a hash)
 * so markers don't jump on every re-render.
 *
 * Phase 2: Replace with real AIS data from aisstream.io or MarineTraffic.
 */

import type { PortCoordinates } from "./ports";

export interface VesselPosition {
  lat: number;
  lng: number;
  heading: number; // degrees, 0 = north, clockwise
}

/** Simple string hash for deterministic offsets */
function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic offset in range [-max, +max] based on a seed */
function seededOffset(seed: string, max: number): number {
  const h = hashCode(seed);
  return ((h % 1000) / 1000 - 0.5) * 2 * max;
}

/** Linear interpolation between two values */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute a mock vessel position based on linkage status and port coordinates.
 *
 * @param status    - Linkage status: active, loading, sailing, discharging, completed
 * @param seed      - Unique seed for deterministic offsets (e.g. vessel name + linkage ID)
 * @param loadCoords - Loadport coordinates (null if unknown)
 * @param dischCoords - Discharge port coordinates (null if unknown)
 * @returns VesselPosition or null if no coordinates available
 */
export function computeMockPosition(
  status: string,
  seed: string,
  loadCoords: PortCoordinates | null,
  dischCoords: PortCoordinates | null
): VesselPosition | null {
  // Need at least one known port
  if (!loadCoords && !dischCoords) return null;

  const offset = 0.03; // ~3km offset for at-port jitter

  switch (status) {
    case "active":
    case "loading": {
      const base = loadCoords ?? dischCoords!;
      return {
        lat: base.lat + seededOffset(seed + "-lat", offset),
        lng: base.lng + seededOffset(seed + "-lng", offset),
        heading: seededOffset(seed + "-hdg", 180) + 180, // random heading at port
      };
    }

    case "sailing": {
      if (loadCoords && dischCoords) {
        // Interpolate between ports at ~45% of the journey
        const t = 0.35 + seededOffset(seed + "-t", 0.15); // 20-50%
        const lat = lerp(loadCoords.lat, dischCoords.lat, t);
        const lng = lerp(loadCoords.lng, dischCoords.lng, t);
        // Heading from load to discharge
        const dlat = dischCoords.lat - loadCoords.lat;
        const dlng = dischCoords.lng - loadCoords.lng;
        const heading = (Math.atan2(dlng, dlat) * 180) / Math.PI;
        return {
          lat: lat + seededOffset(seed + "-jlat", 0.5), // some route variation
          lng: lng + seededOffset(seed + "-jlng", 0.5),
          heading: heading < 0 ? heading + 360 : heading,
        };
      }
      // Only one port known — place nearby
      const base = loadCoords ?? dischCoords!;
      return {
        lat: base.lat + seededOffset(seed + "-lat", 2),
        lng: base.lng + seededOffset(seed + "-lng", 2),
        heading: seededOffset(seed + "-hdg", 180) + 180,
      };
    }

    case "discharging": {
      const base = dischCoords ?? loadCoords!;
      return {
        lat: base.lat + seededOffset(seed + "-lat", offset),
        lng: base.lng + seededOffset(seed + "-lng", offset),
        heading: seededOffset(seed + "-hdg", 180) + 180,
      };
    }

    case "completed": {
      const base = dischCoords ?? loadCoords!;
      return { lat: base.lat, lng: base.lng, heading: 0 };
    }

    default: {
      const base = loadCoords ?? dischCoords!;
      return {
        lat: base.lat + seededOffset(seed + "-lat", offset),
        lng: base.lng + seededOffset(seed + "-lng", offset),
        heading: 0,
      };
    }
  }
}
