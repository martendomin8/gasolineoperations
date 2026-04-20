"use client";

/**
 * `<WeatherLayer />` — drops a `weatherlayers-gl` ParticleLayer onto
 * the active MapLibre map via a `@deck.gl/mapbox` overlay.
 *
 * Week 3 scope: static display of the latest frame. No time slider,
 * no frame interpolation. Week 4 wires this up to the unified
 * TimeSlider and starts passing `image2` + `imageWeight`.
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
// Values are in the unscaled field's units (m/s for wind, metres for
// waves). Transparent at 0 so calm areas fade into the basemap
// instead of producing a coloured flood.
// ---------------------------------------------------------------------------
const WIND_PALETTE: Palette = [
  [0, [0, 0, 0, 0]],            // calm — transparent
  [5, [50, 136, 189, 255]],     // light breeze — blue
  [10, [102, 194, 165, 255]],   // moderate — teal
  [15, [171, 221, 164, 255]],   // fresh — green
  [20, [230, 245, 152, 255]],   // strong — pale yellow
  [25, [254, 224, 139, 255]],   // near-gale — yellow
  [30, [253, 174, 97, 255]],    // gale — orange
  [35, [244, 109, 67, 255]],    // severe gale — red-orange
  [40, [213, 62, 79, 255]],     // storm — red
];

// Wave palette — values are wave heights in metres. Transparent under
// 0.5 m (calm water visually irrelevant), cool blues for small/typical
// swell, warm colours for dangerous heights (≥ 5 m is demurrage
// territory; ≥ 8 m is where tanker insurers start asking questions).
const WAVE_PALETTE: Palette = [
  [0, [0, 0, 0, 0]],
  [0.5, [13, 59, 102, 255]],
  [1, [30, 136, 229, 255]],
  [2, [79, 195, 247, 255]],
  [3, [38, 166, 154, 255]],
  [4, [156, 204, 101, 255]],
  [5, [253, 216, 53, 255]],
  [6, [251, 140, 0, 255]],
  [8, [229, 57, 53, 255]],
  [10, [142, 36, 170, 255]],
];

// Per-type render defaults. Tweak these to adjust "feel" — higher
// speedFactor = faster particles; higher maxAge = longer trails;
// higher numParticles = denser field.
const LAYER_DEFAULTS: Record<
  WeatherType,
  {
    palette: Palette;
    numParticles: number;
    maxAge: number;
    speedFactor: number;
    width: number;
  }
> = {
  wind: {
    palette: WIND_PALETTE,
    numParticles: 5000,
    maxAge: 60,
    speedFactor: 10,
    width: 2,
  },
  waves: {
    palette: WAVE_PALETTE,
    // Fewer, longer-lived particles read as slower, heavier swell;
    // a good visual contrast with wind's busier fast trails.
    numParticles: 2500,
    maxAge: 120,
    speedFactor: 6,
    width: 2.5,
  },
  temperature: {
    // Temperature is scalar — ParticleLayer won't render anything
    // sensible. Temperature rendering goes through a RasterLayer in
    // a later iteration; the defaults here make the ParticleLayer a
    // silent no-op if someone toggles it on by mistake.
    palette: WIND_PALETTE,
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
      const particleLayer = new ParticleLayer({
        id: `weather-${type}`,
        image: bracket.beforeTexture,
        // When image2 is the same as image (static case), GPU still
        // does the mix but with weight=0 it's a no-op.
        image2: bracket.afterTexture,
        imageWeight: bracket.weight,
        imageType: ImageType.VECTOR,
        imageUnscale: bracket.before.metadata.imageUnscale ?? null,
        bounds: bracket.before.bounds,
        numParticles: resolved.numParticles,
        maxAge: resolved.maxAge,
        speedFactor: resolved.speedFactor,
        width: resolved.width,
        palette: resolved.palette,
        animate: true,
      });
      layers.push(particleLayer);
    }
    overlay.setProps({ layers });
  }, [overlay, enabled, bracket, type, resolved]);

  return null;
}
