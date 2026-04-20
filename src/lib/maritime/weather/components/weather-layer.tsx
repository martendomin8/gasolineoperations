"use client";

/**
 * `<WeatherLayer />` — drops a weather visualisation onto the active
 * MapLibre map via a `@deck.gl/mapbox` overlay.
 *
 * Branches on the frame's `imageType`:
 *   - `VECTOR` (wind, waves) → animated `ParticleLayer`
 *   - `SCALAR` (temperature)  → colour-mapped `RasterLayer`
 *
 * Both use the same bracket-frames + imageWeight primitive, so the
 * TimeSlider interpolates across forecast steps uniformly.
 *
 * Rendered as a child of `<Map>` from `react-map-gl/maplibre` — it
 * uses `useControl` to attach a single shared deck.gl overlay to the
 * map and keep its layer list in sync with the React props.
 */

import type { Layer } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useEffect, useMemo, useState } from "react";
import { useControl } from "react-map-gl/maplibre";
import {
  ImageType,
  ParticleLayer,
  RasterLayer,
  loadTextureData,
  type Palette,
  type TextureData,
} from "weatherlayers-gl";

import type { WeatherProvider } from "../provider";
import type { BracketFrames, WeatherFrame, WeatherType } from "../types";

// ---------------------------------------------------------------------------
// Palette presets — constructed directly as `Palette` (array of [value,
// [r, g, b, a]]) so we sidestep cpt2js' string parser entirely. The
// string format it expects is the GMT CPT file format; easy to get
// subtly wrong, easy to avoid.
//
// Each VECTOR type has TWO palettes: a RasterLayer palette (for the
// colour overlay under the particles) and a ParticleLayer palette
// (for the particle colour itself). Windy uses this two-layer idiom
// — coloured raster carries the magnitude, particles carry the
// direction. Particles over a coloured raster are typically white or
// high-contrast so they stay legible regardless of raster colour.
//
// Values are in the unscaled field's units (m/s for wind, metres for
// waves, Kelvin for temperature). Transparent at 0 so calm areas
// fade into the basemap instead of producing a coloured flood.
// ---------------------------------------------------------------------------

// Wind raster — magnitude in m/s. Pink → red → magenta, matching
// Windy's heat-ramp look for wind speed. 0–5 m/s transparent (calm
// areas shouldn't flood the map); gale+ saturates deep magenta.
const WIND_RASTER_PALETTE: Palette = [
  [0, [0, 0, 0, 0]],
  [5, [252, 193, 219, 120]],     // soft pink — light breeze
  [10, [247, 104, 161, 170]],    // pink — moderate
  [15, [221, 52, 151, 200]],     // magenta — fresh
  [20, [174, 1, 126, 220]],      // deep magenta — strong
  [25, [122, 1, 119, 240]],      // violet — near gale
  [30, [73, 0, 106, 250]],       // dark violet — gale
  [40, [49, 0, 66, 255]],        // near-black — storm
];

// Wave raster — Hs in metres. Green → yellow → orange → red →
// magenta, same gradient ops use for sea-state charts.
const WAVE_RASTER_PALETTE: Palette = [
  [0, [0, 0, 0, 0]],
  [0.5, [200, 230, 201, 100]],   // very pale green — glass-flat
  [1, [165, 214, 167, 150]],     // pale green — light chop
  [2, [102, 187, 106, 180]],     // green — typical open ocean
  [3, [205, 220, 57, 200]],      // yellow-green — moderate swell
  [4, [255, 235, 59, 220]],      // yellow — caution (late-arrival risk rises)
  [5, [255, 152, 0, 230]],       // orange — significant seas
  [6, [244, 67, 54, 240]],       // red — large waves
  [8, [194, 24, 91, 250]],       // magenta — very large
  [10, [136, 14, 79, 255]],      // deep magenta — extreme
];

// Wind particle palette — ParticleLayer colours the animated trails.
// We want them WHITE over the coloured raster so direction reads
// clearly without fighting the underlying colour. Near-transparent
// in calm zones (no distracting clutter where there's no wind).
const WIND_PARTICLE_PALETTE: Palette = [
  [0, [255, 255, 255, 0]],
  [3, [255, 255, 255, 120]],
  [10, [255, 255, 255, 200]],
  [40, [255, 255, 255, 255]],
];

// Wave particle palette — same white-on-raster philosophy, but
// slightly dimmer since wave raster has more red saturation and we
// don't want the particles to look like spray.
const WAVE_PARTICLE_PALETTE: Palette = [
  [0, [255, 255, 255, 0]],
  [1, [255, 255, 255, 100]],
  [4, [255, 255, 255, 180]],
  [10, [255, 255, 255, 220]],
];

// Temperature palette — values are Kelvin, same convention as the
// encoder's `imageUnscale`. Covers realistic Earth t2m from deep
// Antarctic winter (-50 °C ≈ 223 K) to extreme desert summer
// (+50 °C ≈ 323 K). Blue → white → red gradient, matching the
// industry-standard meteorological ramp Windy uses.
const TEMPERATURE_PALETTE: Palette = [
  [223, [13, 8, 135, 200]],       // -50 °C — deep blue
  [243, [75, 3, 161, 200]],       // -30 °C — purple
  [263, [0, 92, 175, 200]],       // -10 °C — navy blue
  [273, [52, 152, 219, 200]],     //   0 °C — sky blue (freezing point)
  [283, [144, 202, 249, 200]],    // +10 °C — pale blue
  [288, [232, 245, 233, 180]],    // +15 °C — near-white (mid-temperate)
  [293, [197, 225, 165, 200]],    // +20 °C — light green
  [298, [255, 235, 59, 220]],     // +25 °C — yellow
  [303, [255, 152, 0, 230]],      // +30 °C — orange
  [313, [244, 67, 54, 240]],      // +40 °C — red
  [323, [136, 14, 79, 250]],      // +50 °C — deep magenta
];

// Per-type render defaults. `rasterPalette` colours the magnitude
// overlay; `particlePalette` colours the animated particles on top
// (SCALAR types like temperature ignore `particlePalette`).
const LAYER_DEFAULTS: Record<
  WeatherType,
  {
    rasterPalette: Palette;
    rasterOpacity: number;
    particlePalette: Palette;
    numParticles: number;
    maxAge: number;
    speedFactor: number;
    width: number;
  }
> = {
  wind: {
    rasterPalette: WIND_RASTER_PALETTE,
    rasterOpacity: 1.0, // already alpha-encoded in the palette
    particlePalette: WIND_PARTICLE_PALETTE,
    numParticles: 5000,
    maxAge: 60,
    speedFactor: 10,
    width: 1.5,
  },
  waves: {
    rasterPalette: WAVE_RASTER_PALETTE,
    rasterOpacity: 1.0,
    particlePalette: WAVE_PARTICLE_PALETTE,
    // Fewer, longer-lived particles read as slower, heavier swell;
    // a good visual contrast with wind's busier fast trails.
    numParticles: 2500,
    maxAge: 120,
    speedFactor: 6,
    width: 2,
  },
  temperature: {
    rasterPalette: TEMPERATURE_PALETTE,
    rasterOpacity: 0.55, // keep coastline + borders readable underneath
    // Temperature is a scalar — the particle fields below are unused
    // but kept populated so the defaults record stays uniform.
    particlePalette: TEMPERATURE_PALETTE,
    numParticles: 0,
    maxAge: 0,
    speedFactor: 0,
    width: 0,
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WeatherLayerProps {
  provider: WeatherProvider;
  type: WeatherType;
  /**
   * The time to display. If null, show the newest frame the provider
   * knows about. Week 3 wiring only uses null; Week 4's TimeSlider
   * passes a Date.
   */
  time?: Date | null;
  /** Hide the layer without unmounting. */
  enabled?: boolean;
  /** Overrides for the presets above — handy for per-deployment tuning. */
  overrides?: Partial<(typeof LAYER_DEFAULTS)[WeatherType]>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LoadedBracket {
  before: WeatherFrame;
  after: WeatherFrame;
  beforeTexture: TextureData;
  afterTexture: TextureData;
  weight: number;
}

export function WeatherLayer({
  provider,
  type,
  time = null,
  enabled = true,
  overrides,
}: WeatherLayerProps) {
  const [bracket, setBracket] = useState<LoadedBracket | null>(null);

  // --- Fetch bracketing frames + decode their PNGs -----------------------
  // One effect covers both steps so that an intermediate render never
  // shows a stale `before` with a fresh `after` (or vice versa). The
  // cancellation guard means rapid slider scrubs don't race.
  useEffect(() => {
    if (!enabled) {
      setBracket(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Pre-check: silently no-op when this weather type has no
        // published frames at all (e.g. pipeline ran with --types=wind
        // only; a waves toggle then has no data). Without this guard
        // every slider scrub would spam a console error.
        const frameTimes = await provider.getFrameTimes(type);
        if (frameTimes.length === 0) {
          if (!cancelled) setBracket(null);
          return;
        }

        let bracketFrames: BracketFrames;
        if (time === null) {
          // No explicit time yet → show the newest frame as a single
          // static image. We still fit it into the bracket shape with
          // weight=0 and both slots pointing at the same frame so the
          // render path stays one code path.
          const range = await provider.getAvailableRange(type);
          const frame = await provider.getFrame(type, range.start);
          bracketFrames = { before: frame, after: frame, weight: 0 };
        } else {
          bracketFrames = await provider.getBracketingFrames(type, time);
        }
        if (cancelled) return;

        const [beforeTexture, afterTexture] = await Promise.all([
          loadTextureData(bracketFrames.before.pngUrl),
          // If the bracket collapses (weight=0, same frame both sides)
          // we can reuse the same texture load. `loadTextureData` is
          // cached so this short-circuits anyway, but short-circuit
          // explicitly to keep the common case allocation-free.
          bracketFrames.before.pngUrl === bracketFrames.after.pngUrl
            ? loadTextureData(bracketFrames.before.pngUrl)
            : loadTextureData(bracketFrames.after.pngUrl),
        ]);
        if (cancelled) return;

        setBracket({
          before: bracketFrames.before,
          after: bracketFrames.after,
          beforeTexture,
          afterTexture,
          weight: bracketFrames.weight,
        });
      } catch (err) {
        if (!cancelled) {
          setBracket(null);
          // eslint-disable-next-line no-console -- surface to dev tools
          console.warn("[WeatherLayer] failed to load frames", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, type, time, enabled]);

  // --- deck.gl overlay mount (one per map) -------------------------------
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        // `interleaved: false` draws the deck.gl canvas OVER the
        // MapLibre canvas as an overlay. This is the safer default:
        // interleaved mode requires MapLibre's custom-layer API and
        // has patchy interactions with MapLibre GL JS v5 that can
        // silently swallow the particle render. Trade-off: labels
        // and attribution sit BELOW the particles. Acceptable for
        // v1 demo — we can revisit interleaved once the render path
        // is proven stable.
        interleaved: false,
        layers: [],
      }),
  );

  // --- Rebuild layers when inputs change --------------------------------
  const defaults = LAYER_DEFAULTS[type];
  const resolved = useMemo(
    () => ({ ...defaults, ...(overrides ?? {}) }),
    [defaults, overrides],
  );

  useEffect(() => {
    if (overlay === null) return;
    const layers: Layer[] = [];
    if (enabled && bracket !== null) {
      // The before-bounds are authoritative — both frames from the
      // same provider + type must share bounds, so using either is
      // fine. Use `before` for stable keying.
      const frameImageType = bracket.before.metadata.imageType;
      const commonImageProps = {
        image: bracket.beforeTexture,
        // When image2 is the same as image (static case), GPU still
        // does the mix but with weight=0 it's a no-op.
        image2: bracket.afterTexture,
        imageWeight: bracket.weight,
        imageUnscale: bracket.before.metadata.imageUnscale ?? null,
        bounds: bracket.before.bounds,
      };

      if (frameImageType === "SCALAR") {
        // Temperature + future scalar products — just the colour-
        // mapped raster. No animation layer on top.
        layers.push(
          new RasterLayer({
            ...commonImageProps,
            id: `weather-${type}-raster`,
            imageType: ImageType.SCALAR,
            palette: resolved.rasterPalette,
            opacity: resolved.rasterOpacity,
          }),
        );
      } else {
        // Wind, waves — Windy-style stacked pair: a magnitude raster
        // underneath carries the colour (sqrt(u² + v²) computed on
        // the GPU), animated particles on top carry the direction.
        // Order matters: raster pushed first, particles pushed second
        // so particles draw ON TOP.
        layers.push(
          new RasterLayer({
            ...commonImageProps,
            id: `weather-${type}-raster`,
            imageType: ImageType.VECTOR,
            palette: resolved.rasterPalette,
            opacity: resolved.rasterOpacity,
          }),
        );
        layers.push(
          new ParticleLayer({
            ...commonImageProps,
            id: `weather-${type}-particles`,
            imageType: ImageType.VECTOR,
            palette: resolved.particlePalette,
            numParticles: resolved.numParticles,
            maxAge: resolved.maxAge,
            speedFactor: resolved.speedFactor,
            width: resolved.width,
            animate: true,
          }),
        );
      }
    }
    overlay.setProps({ layers });
  }, [overlay, enabled, bracket, type, resolved]);

  return null;
}
