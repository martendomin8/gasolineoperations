/**
 * Provider selection for the sea-distance module.
 *
 * V1 policy: the provider is chosen from the env var DISTANCE_PROVIDER
 * (defaults to "ocean_routing"). Unimplemented providers fall back to
 * ocean_routing with a console warning.
 *
 * V2 policy (when we onboard a paying customer for AtoBviaC/Netpas):
 * select per-request from `tenant.settings.distance_provider` and their
 * API credentials. The interface stays the same — only this config
 * layer changes.
 */

import type { DistanceProvider } from "./provider";
import { oceanRoutingProvider } from "./providers/ocean-routing";
import { atobviacProvider } from "./providers/atobviac";
import { netpasProvider } from "./providers/netpas";

type ProviderId = "ocean_routing" | "atobviac" | "netpas";

const PROVIDERS: Record<ProviderId, DistanceProvider> = {
  ocean_routing: oceanRoutingProvider,
  atobviac: atobviacProvider,
  netpas: netpasProvider,
};

/** The currently active DistanceProvider, resolved once at module load. */
let activeProvider: DistanceProvider | null = null;

function resolveProvider(): DistanceProvider {
  const configured = (process.env.DISTANCE_PROVIDER ?? "ocean_routing") as ProviderId;
  const provider = PROVIDERS[configured];

  if (!provider) {
    console.warn(
      `[sea-distance] Unknown DISTANCE_PROVIDER='${configured}', falling back to ocean_routing`
    );
    return oceanRoutingProvider;
  }

  // Unimplemented stubs return "not_found" / empty arrays. Detect by
  // checking getAllPorts() length at startup — if the provider has no
  // ports, assume it's not wired up and fall back to ocean_routing so
  // the UI still works.
  if (provider.name !== "ocean_routing" && provider.getAllPorts().length === 0) {
    console.warn(
      `[sea-distance] Provider '${configured}' has no ports — likely not yet implemented, falling back to ocean_routing`
    );
    return oceanRoutingProvider;
  }

  return provider;
}

export function getActiveProvider(): DistanceProvider {
  if (!activeProvider) activeProvider = resolveProvider();
  return activeProvider;
}

/** Test-only: reset the cached provider so a different env can take effect. */
export function __resetProviderForTests(): void {
  activeProvider = null;
}
