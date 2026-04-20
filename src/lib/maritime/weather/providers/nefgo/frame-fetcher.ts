/**
 * Decode a single frame's sidecar JSON and bundle it with its PNG URL.
 *
 * We deliberately do NOT decode the PNG here. `weatherlayers-gl`
 * provides `loadTextureData(url)` which handles the fetch + pixel
 * decode + internal caching in one go. Our job is just to hand the
 * `WeatherLayer` component a bundle of `{pngUrl, bounds, metadata}`
 * ready for that library call.
 *
 * Sidecar fetching IS memoised here though (by jsonUrl) since the
 * sidecar is small, immutable, and re-fetched for every bracket
 * computation.
 */

import { z } from "zod";

import type { FrameSidecar, ImageType, WeatherFrame } from "../../types";

const MAX_CACHED_SIDECARS = 128;

// ---------------------------------------------------------------------------
// Zod — sidecar JSON validation
// ---------------------------------------------------------------------------

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Expected ISO-8601 datetime",
});

const imageTypeSchema = z.enum(["VECTOR", "SCALAR"]);

const sidecarSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  validTime: isoDate,
  cycleTime: isoDate.optional(),
  forecastHour: z.number().int().nonnegative().optional(),
  variable: z.string().min(1),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  imageType: imageTypeSchema.default("VECTOR"),
  imageUnscale: z.tuple([z.number(), z.number()]).optional(),
  unit: z.string().optional(),
  uMin: z.number().optional(),
  uMax: z.number().optional(),
  vMin: z.number().optional(),
  vMax: z.number().optional(),
});

// ---------------------------------------------------------------------------
// LRU-ish sidecar cache
// ---------------------------------------------------------------------------

const sidecarCache = new Map<string, Promise<FrameSidecar>>();

function cacheGet(key: string): Promise<FrameSidecar> | undefined {
  const hit = sidecarCache.get(key);
  if (hit === undefined) return undefined;
  sidecarCache.delete(key);
  sidecarCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Promise<FrameSidecar>): void {
  sidecarCache.set(key, value);
  while (sidecarCache.size > MAX_CACHED_SIDECARS) {
    const oldest = sidecarCache.keys().next().value;
    if (oldest === undefined) break;
    sidecarCache.delete(oldest);
  }
}

export function clearFrameCache(): void {
  sidecarCache.clear();
}

// ---------------------------------------------------------------------------
// Sidecar loader
// ---------------------------------------------------------------------------

function fetchSidecar(jsonUrl: string): Promise<FrameSidecar> {
  const hit = cacheGet(jsonUrl);
  if (hit !== undefined) return hit;

  const promise = (async () => {
    const response = await fetch(jsonUrl, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(
        `Failed to load weather sidecar (${response.status}) from ${jsonUrl}`,
      );
    }
    const parsed = sidecarSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `Sidecar at ${jsonUrl} failed schema validation: ${parsed.error.message}`,
      );
    }
    const sidecar: FrameSidecar = {
      ...parsed.data,
      validTime: new Date(parsed.data.validTime),
      cycleTime:
        parsed.data.cycleTime !== undefined
          ? new Date(parsed.data.cycleTime)
          : undefined,
      imageType: parsed.data.imageType as ImageType,
    };
    return sidecar;
  })();

  // Evict on failure so transient errors don't poison the cache.
  promise.catch(() => {
    if (sidecarCache.get(jsonUrl) === promise) {
      sidecarCache.delete(jsonUrl);
    }
  });

  cacheSet(jsonUrl, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Frame loader
// ---------------------------------------------------------------------------

/**
 * Load one frame's metadata + prepare the `WeatherFrame` bundle.
 * Pixel decoding of the PNG is deferred — `weather-layer.tsx` calls
 * `loadTextureData(pngUrl)` from `weatherlayers-gl` when actually
 * rendering.
 */
export async function loadFrame(
  pngUrl: string,
  jsonUrl: string,
): Promise<WeatherFrame> {
  const sidecar = await fetchSidecar(jsonUrl);
  return {
    pngUrl,
    bounds: sidecar.bounds,
    validTime: sidecar.validTime,
    metadata: {
      imageType: sidecar.imageType,
      imageUnscale: sidecar.imageUnscale,
      unit: sidecar.unit,
    },
  };
}
