/**
 * Shared types for the sea-distance module.
 *
 * These types are the public contract between the app and whatever
 * DistanceProvider is active. They must stay stable across providers
 * so `fleet-map`, `api/sea-distance`, and every other consumer can swap
 * between our home-grown ocean routing, AtoBviaC, Netpas, etc. without
 * code changes.
 */

export interface PortInfo {
  /** Display name with ISO country code, e.g. "Barcelona, ES" */
  name: string;
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lon: number;
}

export interface RouteLeg {
  from: string;
  to: string;
  distanceNm: number;
}

export interface RouteResult {
  /** Total distance in nautical miles */
  totalNm: number;
  /** Individual legs */
  legs: RouteLeg[];
  /**
   * Which provider answered. `"not_found"` means no provider could
   * resolve the route — the caller decides whether to surface an error
   * or fall back to a straight-line estimate.
   */
  source: string;
}

export interface PortSearchResult extends PortInfo {
  /** Reserved for providers that alias ports onto other ports. */
  routingVia: string | null;
}

export interface PortAmbiguityResult {
  query: string;
  isAmbiguous: boolean;
  candidates: PortInfo[];
  resolved: string | null;
  isAlias: boolean;
  aliasTarget: string | null;
}
