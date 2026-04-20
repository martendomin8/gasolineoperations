/**
 * Load + validate `weather/manifest.json` from the CDN.
 *
 * Zod schema mirrors the Python writer in
 * `scripts/weather-pipeline/update_manifest.py`. Any divergence is a
 * bug — keep both ends synced.
 */

import { z } from "zod";

import type { WeatherManifest, WeatherRun, WeatherType } from "../../types";
import {
  MANIFEST_TTL_MS,
  WEATHER_CDN_BASE_URL,
  manifestUrl,
} from "./config";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Expected ISO-8601 datetime",
});

// Frame URLs are either absolute (`https://.../weather/…` from Vercel
// Blob) or root-relative paths (`/weather/…` from the `--local` pipeline
// mode writing into Next.js `public/`). `z.string().url()` rejects the
// latter — we refine manually instead.
const urlOrAbsolutePath = z.string().refine(
  (s) => s.startsWith("/") || /^https?:\/\//i.test(s),
  { message: "Expected an https:// URL or a root-relative path" },
);

const frameSchema = z.object({
  forecastHour: z.number().int().nonnegative(),
  validTime: isoDate,
  pngUrl: urlOrAbsolutePath,
  jsonUrl: urlOrAbsolutePath,
});

const runSchema = z.object({
  runId: z.string().regex(/^\d{10}$/, "runId must be YYYYMMDDHH"),
  cycleTime: isoDate,
  generatedAt: isoDate,
  frames: z.record(z.string(), z.array(frameSchema)).default({}),
});

const manifestSchema = z.object({
  version: z.number().int().min(1),
  latest: z.string().nullable(),
  runs: z.array(runSchema).default([]),
});

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** The weather types we recognise on the client. Anything else in the
 *  manifest is ignored — lets the pipeline publish experimental types
 *  without breaking older clients. */
const KNOWN_TYPES: readonly WeatherType[] = ["wind", "waves", "temperature"];

function decodeRun(raw: z.infer<typeof runSchema>): WeatherRun {
  const frames: WeatherRun["frames"] = {};
  for (const type of KNOWN_TYPES) {
    const entries = raw.frames[type];
    if (!entries) continue;
    frames[type] = entries.map((f) => ({
      forecastHour: f.forecastHour,
      validTime: new Date(f.validTime),
      pngUrl: f.pngUrl,
      jsonUrl: f.jsonUrl,
    }));
  }
  return {
    runId: raw.runId,
    cycleTime: new Date(raw.cycleTime),
    generatedAt: new Date(raw.generatedAt),
    frames,
  };
}

function decodeManifest(raw: z.infer<typeof manifestSchema>): WeatherManifest {
  return {
    version: raw.version,
    latest: raw.latest,
    runs: raw.runs.map(decodeRun),
  };
}

// ---------------------------------------------------------------------------
// Fetcher with TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  manifest: WeatherManifest;
  fetchedAt: number;
}

let cached: CacheEntry | null = null;

/** Expose for tests and for the Admin UI "refresh" button. */
export function clearManifestCache(): void {
  cached = null;
}

export async function loadManifest(
  options: { baseUrl?: string; force?: boolean } = {},
): Promise<WeatherManifest> {
  const now = Date.now();
  if (
    !options.force &&
    cached !== null &&
    now - cached.fetchedAt < MANIFEST_TTL_MS
  ) {
    return cached.manifest;
  }

  const url = manifestUrl(options.baseUrl ?? WEATHER_CDN_BASE_URL);
  const response = await fetch(url, {
    // Browsers cache aggressively — force a conditional revalidation so
    // we actually see new manifests within TTL_MS rather than stale ones.
    cache: "no-cache",
  });

  if (response.status === 404) {
    // No manifest yet = pipeline has never run. Return an empty manifest
    // so the UI can render a "no forecast available" state without
    // treating this as an error.
    const empty: WeatherManifest = { version: 1, latest: null, runs: [] };
    cached = { manifest: empty, fetchedAt: now };
    return empty;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch weather manifest (${response.status} ${response.statusText}) from ${url}`,
    );
  }

  const parsed = manifestSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Weather manifest at ${url} failed schema validation: ${parsed.error.message}`,
    );
  }

  const manifest = decodeManifest(parsed.data);
  cached = { manifest, fetchedAt: now };
  return manifest;
}
