/**
 * Sea-distance public API.
 *
 * This file is the single import point for the rest of the app:
 *
 *   import { getSeaDistance, findPort } from "@/lib/sea-distance";
 *
 * It re-exports the types and forwards each call to whichever
 * DistanceProvider is currently active (chosen in `./config.ts`).
 *
 * Switching providers (our ocean routing ↔ AtoBviaC ↔ Netpas ↔ future)
 * is a config change, not a code change — callers never import from
 * `./providers/*` directly.
 */

import { getActiveProvider } from "./config";

// Re-export types for consumers.
export type {
  PortInfo,
  RouteLeg,
  RouteResult,
  PortSearchResult,
  PortAmbiguityResult,
} from "./types";

export { calculateETA } from "./provider";

// Forward public methods to the active provider. We wrap each one in a
// function so the active provider is looked up lazily (server-side env
// vars may not be available at module-initialisation time in every
// runtime). The provider lookup is cached after first call.

export function findPort(query: string): string | null {
  return getActiveProvider().findPort(query);
}

export function searchPorts(query: string, limit?: number) {
  return getActiveProvider().searchPorts(query, limit);
}

export function getPortCoords(name: string) {
  return getActiveProvider().getPortCoords(name);
}

export function checkPortAmbiguity(query: string) {
  return getActiveProvider().checkPortAmbiguity(query);
}

export function getAllPorts() {
  return getActiveProvider().getAllPorts();
}

export function getSeaDistance(from: string, to: string) {
  return getActiveProvider().getSeaDistance(from, to);
}

export function getMultiStopDistance(portNames: string[]) {
  return getActiveProvider().getMultiStopDistance(portNames);
}

export function getSeaRoutePath(a: string, b: string): [number, number][] | null {
  return getActiveProvider().getRoutePath(a, b);
}

export function isHandDrawnRoute(a: string, b: string): boolean {
  return getActiveProvider().isHandDrawnRoute(a, b);
}

/** Introspection — which provider answered the last calls. */
export function getActiveProviderName(): string {
  return getActiveProvider().name;
}
