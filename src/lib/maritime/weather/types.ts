/**
 * Shared weather-module types.
 *
 * The schema here mirrors what `scripts/weather-pipeline/` produces.
 * Change either end in lock-step — and run the pipeline locally
 * (`run_pipeline.py --dry-run`) to confirm the JSON shape still parses
 * against the Zod schemas in `providers/nefgo/manifest-loader.ts` and
 * `providers/nefgo/frame-fetcher.ts`.
 */

/** Logical weather layer types exposed to the UI. */
export type WeatherType = "wind" | "waves" | "temperature";

/** Shape of the field: directional (wind, wave direction) vs magnitude-only. */
export type ImageType = "VECTOR" | "SCALAR";

/**
 * A single forecast frame as seen by the UI.
 *
 * Keep this **provider-agnostic**: the URL is opaque (for the
 * NefgoWeatherProvider it lives on Vercel Blob; another provider might
 * serve it from their own CDN). `weather-layer.tsx` calls
 * `loadTextureData(pngUrl)` from weatherlayers-gl at render time —
 * the library handles caching.
 *
 * `metadata.imageUnscale` is the `[min, max]` pair the shader uses to
 * recover real-world units from the 0..255 PNG channels. For symmetric
 * wind encoding (our convention) this is `[-vmax, +vmax]`.
 */
export interface WeatherFrame {
  pngUrl: string;
  bounds: [west: number, south: number, east: number, north: number];
  validTime: Date;
  metadata: {
    imageType: ImageType;
    /** Shared range for scaling PNG channels back to real-world units. */
    imageUnscale?: [min: number, max: number];
    unit?: string; // "m/s" | "K" | "m" | ...
  };
}

/**
 * Two frames bracketing a target time, plus the 0..1 weight for the
 * GPU-side mix between them.
 *
 * This is THE primitive that makes the unified time-slider possible:
 * the same `t` that drives `useShipAtTime(route, t)` also drives this
 * weight, and `weatherlayers-gl` blends the two frames in the shader.
 */
export interface BracketFrames {
  before: WeatherFrame;
  after: WeatherFrame;
  /** 0 = at `before`, 1 = at `after`. */
  weight: number;
}

/** One forecast cycle's published frames, grouped by weather type. */
export interface WeatherRun {
  runId: string; // YYYYMMDDHH
  cycleTime: Date;
  generatedAt: Date;
  frames: Partial<Record<WeatherType, WeatherFrameManifest[]>>;
}

/**
 * A manifest entry for one frame — what the pipeline wrote into
 * `manifest.json`. The heavy-weight decoded `WeatherFrame` is
 * produced on demand by `frame-fetcher.ts`.
 */
export interface WeatherFrameManifest {
  forecastHour: number;
  validTime: Date;
  pngUrl: string;
  jsonUrl: string;
}

/** The index of all currently available runs. */
export interface WeatherManifest {
  version: number;
  latest: string | null; // most recent runId, or null if no runs yet
  runs: WeatherRun[];
}

/** The sidecar JSON written next to each PNG frame. */
export interface FrameSidecar {
  width: number;
  height: number;
  validTime: Date;
  cycleTime?: Date;
  forecastHour?: number;
  variable: string;
  bounds: [west: number, south: number, east: number, north: number];
  imageType: ImageType;
  imageUnscale?: [min: number, max: number];
  unit?: string;
  // Per-channel debug values (the pipeline emits them; the renderer
  // ignores them). Kept to help diagnose "why does the PNG look wrong"
  // without re-running the pipeline.
  uMin?: number;
  uMax?: number;
  vMin?: number;
  vMax?: number;
}

/** Generic time range used by `getAvailableRange`. */
export interface TimeRange {
  start: Date;
  end: Date;
}
