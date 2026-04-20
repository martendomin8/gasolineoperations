/**
 * Ship-at-time interpolation helpers.
 *
 * These are pure functions, not React hooks — the `use-` prefix in the
 * filename is about grouping by purpose (time-sync helpers) rather
 * than React lifecycle. Consumers memoise at the call site.
 *
 * Feature contract: given a vessel's current position + the route
 * geometry ahead of it + a target time, return where that vessel
 * WOULD be if it continued along the route at the assumed speed.
 *
 * This is the ship side of the unified time-slider: the WeatherLayer
 * consumes the same `t` on the GPU side and blends forecast frames.
 */

import { haversineNm } from "../../sea-distance/waypoints";

/**
 * Fallback cruise speed for tanker vessels when we don't have a
 * measured value. 14 knots is the Worldscale standard assumption and
 * matches what ops typically quotes for MR / LR1 tankers.
 */
export const DEFAULT_SPEED_KNOTS = 14;

export type LatLon = [lat: number, lon: number];

/**
 * Walk `distanceNm` along `path` starting at `path[0]`. Returns the
 * interpolated `[lat, lon]` point. If the distance exceeds the total
 * path length, returns the last point (ship has arrived).
 *
 * Segments are interpolated linearly in lat/lon. For typical shipping
 * leg lengths (5–200 NM per segment between anchors) this is visually
 * indistinguishable from a great-circle slerp — and we're only
 * producing a marker position, not a rendered arc.
 */
export function interpolateAlongPath(
  path: readonly LatLon[],
  distanceNm: number,
): LatLon {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return [...path[0]];
  if (distanceNm <= 0) return [...path[0]];

  let remaining = distanceNm;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [lat1, lon1] = path[i];
    const [lat2, lon2] = path[i + 1];
    const segLen = haversineNm(lat1, lon1, lat2, lon2);
    if (segLen >= remaining) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return [lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)];
    }
    remaining -= segLen;
  }
  return [...path[path.length - 1]];
}

/**
 * Predict where a vessel will be at a future time.
 *
 * `currentPos` is where the vessel is right now. `routeAhead` is the
 * ordered sequence of `[lat, lon]` waypoints from the vessel's next
 * waypoint through to the discharge port — the caller is expected to
 * pass the SAME geometry used to render the vessel's route on the
 * map, so the marker tracks the drawn line exactly.
 *
 * `hoursFromNow` can be negative, in which case we just return the
 * current position (the ship hasn't sailed yet from the slider's
 * perspective — we don't rewind AIS history in this iteration).
 */
export function shipPositionAtTime(
  currentPos: LatLon,
  routeAhead: readonly LatLon[],
  hoursFromNow: number,
  speedKnots: number = DEFAULT_SPEED_KNOTS,
): LatLon {
  if (hoursFromNow <= 0) return [...currentPos];
  const path: LatLon[] = [currentPos, ...routeAhead];
  const distance = hoursFromNow * speedKnots;
  return interpolateAlongPath(path, distance);
}

/**
 * Estimate the heading (compass bearing, 0–360°) at a point on a path.
 * Uses the direction of the segment the point sits on — so a ship in
 * the middle of a route shows the bearing of its current leg, not its
 * straight-line bearing to the destination.
 *
 * Returns 0 if there's no meaningful direction (empty or single-point
 * path). Useful for rotating vessel marker icons.
 */
export function headingAtDistance(
  path: readonly LatLon[],
  distanceNm: number,
): number {
  if (path.length < 2) return 0;
  let remaining = Math.max(0, distanceNm);
  for (let i = 0; i < path.length - 1; i += 1) {
    const [lat1, lon1] = path[i];
    const [lat2, lon2] = path[i + 1];
    const segLen = haversineNm(lat1, lon1, lat2, lon2);
    if (segLen >= remaining) {
      return bearing(lat1, lon1, lat2, lon2);
    }
    remaining -= segLen;
  }
  const [lat1, lon1] = path[path.length - 2];
  const [lat2, lon2] = path[path.length - 1];
  return bearing(lat1, lon1, lat2, lon2);
}

/** Initial-bearing formula from Chris Veness' geodesy notes. Returns 0–360. */
function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}
