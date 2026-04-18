/**
 * AtoBviaC provider — STUB (not yet implemented).
 *
 * AtoBviaC (https://atobviac.com) is a commercial maritime distance
 * service with ~3,800 hand-curated ports and routes updated weekly from
 * Admiralty Notices to Mariners. To enable, a tenant needs:
 *
 *   - AtoBviaC API credentials (contract with weilbach.com)
 *   - `tenant.settings.distance_provider = "atobviac"`
 *   - `tenant.settings.atobviac_api_key = "..."`
 *
 * Until implemented, the config layer falls back to ocean_routing for
 * tenants that request this provider. The stub below keeps the import
 * graph intact.
 */

import type { DistanceProvider } from "../../provider";

export const atobviacProvider: DistanceProvider = {
  name: "atobviac",

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
