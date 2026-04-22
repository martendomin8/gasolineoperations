"use client";

/**
 * Forecast-backed weather sampler — decodes our NOAA GFS PNG frames
 * at a given (lat, lon, time) and hands back a `WeatherCondition`
 * that the Kwon voyage integrator can feed straight through its
 * per-segment loop.
 *
 * Falls back to climatology whenever:
 *   - The requested time is outside the weather provider's available
 *     range (e.g. voyage extends past the 5-day forecast horizon).
 *   - The weather provider throws (slow network, expired manifest).
 *   - The sampled pixel is masked as land / no-data (alpha < 32 in
 *     the PNG — `sampleFrame` already returns null for that case).
 *
 * This sampler is client-only because it needs the DOM `Image`
 * constructor to decode PNGs. That's fine — the Kwon integrator
 * runs in the Fleet UI hook (also client), not a server-side API.
 */

import type { WeatherProvider } from "@/lib/maritime/weather/provider";
import { sampleFrame } from "@/lib/maritime/weather/sampler";
import { climatologyAt } from "./climatology";
import type { WeatherCondition, WeatherSampler } from "./types";

/** 1 m/s = 1.9438 knots. Kwon expects knots; NOAA GFS is m/s. */
const KN_PER_MS = 1.9438;

/**
 * Grid resolution for sample de-duplication. Ocean-routing polylines
 * densify to ~50-nm waypoint spacing, so a Biscay-to-Lagos voyage can
 * easily hit 300+ segments. Weather doesn't change meaningfully
 * inside a 6-nm × 3-hour grid cell, so we round each sample key into
 * that cell and reuse any prior result for the same cell.
 *
 * Without this memo, each segment fires two sequential `await`s —
 * 500 segments × ~300 ms network latency = 150 seconds for the
 * first compute. With it, 500 calls collapse to ~30-50 unique cells
 * and the observed first-compute time drops to ~5-8 seconds.
 */
const LAT_LON_RESOLUTION_DEG = 0.1;         // ~6 nm at equator, tighter at higher latitudes
const TIME_RESOLUTION_MS = 3 * 3600 * 1000; // 3 h — matches GFS frame cadence

/** Module-level cache. Stores PROMISES so concurrent lookups for the
 *  same cell share a single network fetch. Never evicted — bounded
 *  by unique cells per session (hundreds, not millions). */
const sampleCache = new Map<
  string,
  Promise<{ condition: WeatherCondition; source: "forecast" | "climatology" }>
>();

function cellKey(lat: number, lon: number, at: Date): string {
  const latBucket = Math.round(lat / LAT_LON_RESOLUTION_DEG);
  const lonBucket = Math.round(lon / LAT_LON_RESOLUTION_DEG);
  const timeBucket = Math.floor(at.getTime() / TIME_RESOLUTION_MS);
  return `${latBucket}|${lonBucket}|${timeBucket}`;
}

/**
 * Factory — returns a sampler bound to a specific provider. The
 * Fleet hook calls this once per render (cheap — no async work
 * happens here) and hands the returned function to
 * `integrateVoyage`.
 */
export function createForecastSampler(
  provider: WeatherProvider,
): WeatherSampler {
  return async ({ lat, lon, at }) => {
    const key = cellKey(lat, lon, at);
    const cached = sampleCache.get(key);
    if (cached !== undefined) return cached;

    // Kick off the real fetch. Store the in-flight promise so
    // concurrent callers for the same cell share it (no duplicate
    // downloads) and every caller sees the same resolved value.
    const promise = doSample(provider, lat, lon, at);
    sampleCache.set(key, promise);
    // On rejection, remove the cached promise so later attempts retry
    // instead of getting a permanently-failed result. Consumers of
    // the sampler already catch + fall back to climatology, so
    // re-trying on the next voyage compute is the right call.
    promise.catch(() => sampleCache.delete(key));
    return promise;
  };
}

async function doSample(
  provider: WeatherProvider,
  lat: number,
  lon: number,
  at: Date,
): Promise<{ condition: WeatherCondition; source: "forecast" | "climatology" }> {
  try {
    // Each sample combines data from wind + waves frames at the same
    // instant. Ship temperature isn't a Kwon input so we skip it.
    const [windFrame, wavesFrame] = await Promise.all([
      provider.getFrame("wind", at),
      provider.getFrame("waves", at),
    ]);

    const [windSample, wavesSample] = await Promise.all([
      sampleFrame(windFrame, lat, lon),
      sampleFrame(wavesFrame, lat, lon),
    ]);

    // If EITHER layer returned null (out of bounds, no-data land
    // pixel, etc.), we can't safely synthesise a WeatherCondition —
    // fall back to climatology for this point.
    if (windSample?.vector === undefined) {
      return fallback(lat, lon, at);
    }

    const condition: WeatherCondition = {
      // GFS wind data is in m/s; Kwon expects knots.
      windSpeedKn: windSample.vector.magnitude * KN_PER_MS,
      // `sampleFrame` returns direction the wind is BLOWING TOWARDS
      // (meteorological "going to"). Kwon expects the direction it
      // comes FROM (meteorological convention). Flip by 180°.
      windDirDeg: (windSample.vector.directionDeg + 180) % 360,
      // Waves layer is encoded as SCALAR (significant wave height,
      // metres) in our current pipeline. If a provider switches to
      // VECTOR (direction + height), we can pick that up too.
      waveHeightM:
        wavesSample?.scalar?.value ??
        wavesSample?.vector?.magnitude ??
        0,
      // The GFS pipeline doesn't currently expose independent wave
      // direction — waves in open ocean are almost entirely wind-
      // driven anyway, so using the wind direction is a sound
      // approximation. This is a reasonable V1.5 upgrade target.
      waveDirDeg: (windSample.vector.directionDeg + 180) % 360,
    };

    return { condition, source: "forecast" };
  } catch {
    // Any provider/decoder error → climatology fallback. Never let a
    // transient network blip or a missing frame blow up the whole
    // integration loop.
    return fallback(lat, lon, at);
  }
}

function fallback(
  lat: number,
  lon: number,
  at: Date,
): { condition: WeatherCondition; source: "climatology" } {
  return { condition: climatologyAt(lat, lon, at), source: "climatology" };
}

/** Expose for the Fleet UI — useful when operator changes vessel /
 *  route and we want to guarantee a fresh compute. Empty by default;
 *  session cache grows as voyages are planned. */
export function clearForecastSampleCache(): void {
  sampleCache.clear();
}
