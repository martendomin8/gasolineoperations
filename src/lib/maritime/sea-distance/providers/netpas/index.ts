/**
 * Netpas provider — STUB (not yet implemented).
 *
 * Netpas Distance (https://netpas.net) offers ~12,000 ports, 72B
 * pre-computed distances, 150 routing waypoints and ECA/SECA bypass
 * distances. To enable, a tenant needs:
 *
 *   - Netpas integration contract and API credentials
 *   - `tenant.settings.distance_provider = "netpas"`
 *   - `tenant.settings.netpas_api_key = "..."`
 *
 * Until implemented, the config layer falls back to ocean_routing.
 */

import type { DistanceProvider } from "../../provider";

export const netpasProvider: DistanceProvider = {
  name: "netpas",

  findPort() { return null; },
  searchPorts() { return []; },
  getPortCoords() { return null; },
  checkPortAmbiguity(query: string) {
    return {
      query,
      isAmbiguous: false,
      candidates: [],
      resolved: null,
      isAlias: false,
      aliasTarget: null,
    };
  },
  getAllPorts() { return []; },
  getSeaDistance() { return { totalNm: 0, legs: [], source: "not_found" }; },
  getMultiStopDistance() { return { totalNm: 0, legs: [], source: "not_found" }; },
  getRoutePath() { return null; },
  isHandDrawnRoute() { return false; },
};
