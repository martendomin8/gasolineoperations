/**
 * Vessel position estimator for the Fleet Map.
 *
 * Until real AIS integration is wired in (Phase 2 — our Marine Traffic
 * clone), vessel positions are estimated from known deal data:
 *
 *   - active / loading    → at loadport (small offset so markers don't overlap)
 *   - sailing             → interpolated ALONG the pre-computed ocean route
 *                            based on time elapsed since laycan_end (departure)
 *                            at a standard tanker speed (12 knots)
 *   - discharging         → at discharge port
 *   - completed           → at discharge port (grey)
 *
 * Sailing interpolation walks the real route geometry from paths.json, so
 * a vessel mid-voyage appears on its actual ocean route, not on a straight
 * line through land. Heading is derived from the direction of the current
 * segment.
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

/** Haversine distance in nautical miles between two [lat, lng] points */
function haversineNm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3440.065; // Earth radius in NM
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Bearing (course) in degrees from point 1 to point 2 */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  const deg = (θ * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Interpolate a position along a route path at the given progress (0..1).
 * Returns position + heading (bearing of the current segment).
 */
function positionOnPath(
  path: [number, number][],
  progress: number,
): VesselPosition | null {
  if (!path || path.length < 2) return null;
  const t = Math.max(0, Math.min(1, progress));

  // Cumulative distance per segment
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineNm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    segLens.push(d);
    total += d;
  }
  if (total === 0) {
    return { lat: path[0][0], lng: path[0][1], heading: 0 };
  }

  const target = t * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const next = acc + segLens[i];
    if (target <= next) {
      const segT = segLens[i] > 0 ? (target - acc) / segLens[i] : 0;
      const a = path[i];
      const b = path[i + 1];
      const lat = a[0] + (b[0] - a[0]) * segT;
      const lng = a[1] + (b[1] - a[1]) * segT;
      const hdg = bearing(a[0], a[1], b[0], b[1]);
      return { lat, lng, heading: hdg };
    }
    acc = next;
  }

  // Fallback — end of path
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  return {
    lat: last[0],
    lng: last[1],
    heading: bearing(prev[0], prev[1], last[0], last[1]),
  };
}

/** Days between two ISO date strings (end - start). 0 or positive. */
function daysBetween(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(0, ms / 86_400_000);
}

/** Standard tanker cruise speed (NM per hour). */
const TANKER_SPEED_KN = 12;

/** Days in advance that loading typically completes before sailing starts. */
const LOADING_BUFFER_DAYS = 0; // assume vessel departs at laycan_end

/**
 * Estimate vessel position.
 *
 * For `sailing` status with a route and laycan_end: interpolates along the
 * real route geometry based on how many days have passed since presumed
 * departure (laycan_end). Falls back to straight-line interpolation if no
 * route is supplied.
 */
export function computeMockPosition(
  status: string,
  seed: string,
  loadCoords: PortCoordinates | null,
  dischCoords: PortCoordinates | null,
  route?: [number, number][] | null,
  laycanEnd?: string | null,
  totalDistanceNm?: number | null,
): VesselPosition | null {
  if (!loadCoords && !dischCoords) return null;

  const portOffset = 0.008; // ~800m offset so markers don't overlap exactly

  switch (status) {
    case "active":
    case "loading": {
      const base = loadCoords ?? dischCoords!;
      return {
        lat: base.lat + seededOffset(seed + "-lat", portOffset),
        lng: base.lng + seededOffset(seed + "-lng", portOffset),
        heading: seededOffset(seed + "-hdg", 180) + 180,
      };
    }

    case "sailing": {
      // Best case: we have a real route AND a laycan_end date → interpolate
      // along the actual ocean path using elapsed-time progress.
      if (route && route.length >= 2 && laycanEnd && totalDistanceNm) {
        const daysSinceDeparture = daysBetween(
          laycanEnd,
          new Date().toISOString(),
        ) - LOADING_BUFFER_DAYS;
        const sailingDays = totalDistanceNm / (TANKER_SPEED_KN * 24);
        const progress = sailingDays > 0
          ? Math.max(0.05, Math.min(0.95, daysSinceDeparture / sailingDays))
          : 0.5;
        const pos = positionOnPath(route, progress);
        if (pos) return pos;
      }

      // Second best: route but no dates → park at ~35-50% progress
      if (route && route.length >= 2) {
        const t = 0.35 + seededOffset(seed + "-t", 0.15);
        const pos = positionOnPath(route, t);
        if (pos) return pos;
      }

      // Fallback: straight-line lerp between ports (old behaviour)
      if (loadCoords && dischCoords) {
        const t = 0.35 + seededOffset(seed + "-t", 0.15);
        const lat = loadCoords.lat + (dischCoords.lat - loadCoords.lat) * t;
        const lng = loadCoords.lng + (dischCoords.lng - loadCoords.lng) * t;
        return {
          lat,
          lng,
          heading: bearing(
            loadCoords.lat, loadCoords.lng,
            dischCoords.lat, dischCoords.lng,
          ),
        };
      }

      // Worst case: only one port known
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
        lat: base.lat + seededOffset(seed + "-lat", portOffset),
        lng: base.lng + seededOffset(seed + "-lng", portOffset),
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
        lat: base.lat + seededOffset(seed + "-lat", portOffset),
        lng: base.lng + seededOffset(seed + "-lng", portOffset),
        heading: 0,
      };
    }
  }
}
