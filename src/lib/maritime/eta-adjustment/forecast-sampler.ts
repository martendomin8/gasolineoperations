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
  };
}

function fallback(
  lat: number,
  lon: number,
  at: Date,
): { condition: WeatherCondition; source: "climatology" } {
  return { condition: climatologyAt(lat, lon, at), source: "climatology" };
}

/** 1 m/s = 1.9438 knots. Kwon expects knots; NOAA GFS is m/s. */
const KN_PER_MS = 1.9438;
