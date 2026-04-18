import type {
  PortInfo,
  RouteResult,
  PortSearchResult,
  PortAmbiguityResult,
} from "./types";

/**
 * DistanceProvider — abstract interface for any maritime distance +
 * route-geometry source.
 *
 * The rest of the app depends only on this interface. Our home-grown
 * ocean-routing grid is one implementation. Future implementations will
 * wrap third-party APIs like AtoBviaC and Netpas Distance. A tenant can
 * be configured to use any of them via `src/lib/sea-distance/config.ts`.
 *
 * Design rules every implementation must obey:
 *   - Synchronous lookups where possible (UI latency matters).
 *   - `source` in RouteResult identifies which provider answered
 *     (e.g. "ocean_routing", "atobviac", "netpas"), or "not_found".
 *   - Ports returned by `getAllPorts()` / `searchPorts()` must use the
 *     canonical display-name format: "City, ISO2", e.g. "Lavera, FR".
 *   - Coordinates are decimal degrees, negative west/south.
 *   - Distances are nautical miles.
 */
export interface DistanceProvider {
  /** Human-readable provider id, used for logging + RouteResult.source. */
  readonly name: string;

  /** Resolve a free-text query to a canonical port name, or null. */
  findPort(query: string): string | null;

  /** Ranked fuzzy search for a port, capped at `limit` results. */
  searchPorts(query: string, limit?: number): PortSearchResult[];

  /** Decimal-degree coords for a canonical port name. */
  getPortCoords(name: string): { lat: number; lon: number } | null;

  /** Detect when a query matches multiple city-name candidates. */
  checkPortAmbiguity(query: string): PortAmbiguityResult;

  /** Every port the provider knows about — used by the map overlay. */
  getAllPorts(): PortInfo[];

  /** Distance between two ports. */
  getSeaDistance(from: string, to: string): RouteResult;

  /** Multi-stop voyage distance (sum of consecutive legs). */
  getMultiStopDistance(portNames: string[]): RouteResult;

  /**
   * Geometry of the route as a polyline of [lat, lon] pairs ordered from
   * `a` to `b`, or null if the provider has no geometry (distance-only).
   */
  getRoutePath(a: string, b: string): [number, number][] | null;

  /**
   * True if the route is known to come from a hand-curated override rather
   * than an algorithmic path. Providers without overrides should return
   * `false` unconditionally.
   */
  isHandDrawnRoute(a: string, b: string): boolean;
}

/** ETA in days for a given distance and cruise speed. */
export function calculateETA(distanceNm: number, speedKnots: number): number {
  if (speedKnots <= 0) return 0;
  return distanceNm / (speedKnots * 24);
}
