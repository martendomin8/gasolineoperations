/**
 * `useWeatherProvider` — pick the configured `WeatherProvider`.
 *
 * The concrete provider is chosen once per page load via
 * `NEXT_PUBLIC_WEATHER_PROVIDER`. Because the env var is a
 * `NEXT_PUBLIC_` value, Next.js inlines it at build time — there's no
 * runtime branching cost.
 *
 * This hook is intentionally thin: it constructs (and memoises) the
 * provider instance and returns it. No React state needed — the
 * provider itself has no per-render identity.
 */

import { useMemo } from "react";

import type { WeatherProvider } from "../provider";
import { NefgoWeatherProvider } from "../providers/nefgo";
import { WindyWeatherProvider } from "../providers/windy";

export type WeatherProviderName = "nefgo" | "windy";

const DEFAULT_PROVIDER: WeatherProviderName = "nefgo";

function resolveConfiguredName(): WeatherProviderName {
  const raw = process.env.NEXT_PUBLIC_WEATHER_PROVIDER;
  if (raw === "nefgo" || raw === "windy") return raw;
  return DEFAULT_PROVIDER;
}

function createProvider(name: WeatherProviderName): WeatherProvider {
  switch (name) {
    case "nefgo":
      return new NefgoWeatherProvider();
    case "windy":
      return new WindyWeatherProvider();
  }
}

// Module-level singleton. Safe because providers carry no
// per-component state — only caches that we want shared across the
// whole page.
let cachedProvider: WeatherProvider | null = null;
let cachedName: WeatherProviderName | null = null;

export function getWeatherProvider(): WeatherProvider {
  const name = resolveConfiguredName();
  if (cachedProvider === null || cachedName !== name) {
    cachedProvider = createProvider(name);
    cachedName = name;
  }
  return cachedProvider;
}

export function useWeatherProvider(): WeatherProvider {
  return useMemo(() => getWeatherProvider(), []);
}
