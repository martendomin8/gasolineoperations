/**
 * Waypoint parsing + math shared between API routes.
 *
 * The planner supports two kinds of waypoints in a single voyage:
 *
 *   1. Named ports   — resolved through the DistanceProvider, routed
 *                      through our ocean graph (land-safe, uses the
 *                      active avoid-passage variant).
 *   2. Custom coords — "click anywhere on the map to insert a point".
 *                      Encoded as `@LAT,LON` in the pipe-separated
 *                      `ports=` query string. Any leg that touches a
 *                      custom waypoint falls back to a straight
 *                      great-circle segment + haversine distance —
 *                      the graph can't route through arbitrary coords
 *                      without a runtime Dijkstra, and the whole point
 *                      of a custom waypoint is "force the route past
 *                      here", so a straight segment is the expected
 *                      behaviour.
 */

export type ParsedWaypoint =
  | { type: "port"; raw: string }
  | { type: "custom"; lat: number; lon: number; raw: string };

/**
 * Parse one entry from the pipe-separated `ports=` list. Returns null
 * on malformed custom-waypoint syntax.
 */
export function parseWaypoint(entry: string): ParsedWaypoint | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("@")) {
    const body = trimmed.slice(1);
    // Accept `@lat,lon` with optional whitespace and a sign prefix.
    const match = body.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { type: "custom", lat, lon, raw: trimmed };
  }
  return { type: "port", raw: trimmed };
}

/**
 * Great-circle distance between two points in nautical miles. Uses
 * the same Earth radius constant as the frontend helpers and the
 * Python pipeline so leg distances are consistent end-to-end.
 */
export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3440.065; // Earth mean radius in nautical miles
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Display-friendly label for a custom waypoint.
 * `@ 45.23°N 12.34°W` — compact, matches what the UI puts in the
 * waypoint list.
 */
export function formatCustomLabel(lat: number, lon: number): string {
  const nsSuffix = lat >= 0 ? "N" : "S";
  const ewSuffix = lon >= 0 ? "E" : "W";
  return `@ ${Math.abs(lat).toFixed(2)}°${nsSuffix} ${Math.abs(lon).toFixed(2)}°${ewSuffix}`;
}
