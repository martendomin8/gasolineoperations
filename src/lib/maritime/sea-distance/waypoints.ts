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
    const rawLon = parseFloat(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(rawLon)) return null;
    if (lat < -90 || lat > 90) return null;
    // Normalize longitude into -180..180 instead of rejecting. The
    // map UI used to occasionally send clicks from a "second copy"
    // of the globe (values like 203° or -247°) — this used to drop
    // the waypoint silently and break the route. We now wrap it at
    // the API boundary too, so a client that hasn't been updated
    // (or a hand-crafted URL) still produces a valid route instead
    // of a silently missing leg.
    const lon = ((rawLon + 180) % 360 + 360) % 360 - 180;
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
  // Normalize lon to -180..180 before formatting — waypoints created
  // pre-normalization (or via hand-crafted URLs) may carry values
  // outside the standard range, and "211.54°W" is nonsense to a
  // ship's navigator. Wrapping here keeps the label clean regardless
  // of how the waypoint was constructed upstream.
  const normLon = ((lon + 180) % 360 + 360) % 360 - 180;
  const nsSuffix = lat >= 0 ? "N" : "S";
  const ewSuffix = normLon >= 0 ? "E" : "W";
  return `@ ${Math.abs(lat).toFixed(2)}°${nsSuffix} ${Math.abs(normLon).toFixed(2)}°${ewSuffix}`;
}
