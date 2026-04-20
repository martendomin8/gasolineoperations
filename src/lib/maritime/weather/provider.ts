/**
 * Abstract `WeatherProvider` interface.
 *
 * Every concrete implementation (NEFGO's own NOAA pipeline, a Windy
 * API wrapper, a mock test provider) implements this same surface,
 * and the UI never knows which one it's talking to. The choice is
 * made at bootstrap via `useWeatherProvider()`, driven by the
 * `NEXT_PUBLIC_WEATHER_PROVIDER` env var.
 *
 * Same pattern as `parseRecap()` in CLAUDE.md — swappable backend,
 * single UI, per-deployment choice.
 */

import type {
  BracketFrames,
  TimeRange,
  WeatherFrame,
  WeatherType,
} from "./types";

export interface WeatherProvider {
  /** Name shown in diagnostics / admin — e.g. "nefgo", "windy", "mock". */
  readonly name: string;

  /**
   * The cycle time of the latest available forecast run — i.e. when
   * the underlying model was initialised. Used to surface a
   * "Forecast issued: 20 Apr 12 UTC" badge so operators know how
   * fresh the data they're looking at is. Returns null if no run is
   * available yet.
   */
  getLatestCycleTime(): Promise<Date | null>;

  /**
   * What time range does this provider have data for? Used by the
   * TimeSlider to know its valid minimum and maximum.
   */
  getAvailableRange(type: WeatherType): Promise<TimeRange>;

  /**
   * The discrete forecast times we have frames for. Callers interpolate
   * between these using `getBracketingFrames`.
   */
  getFrameTimes(type: WeatherType): Promise<Date[]>;

  /**
   * Fetch the single frame closest to `time`. Useful for static display
   * (no interpolation) and for debugging.
   */
  getFrame(type: WeatherType, time: Date): Promise<WeatherFrame>;

  /**
   * Fetch the two frames bracketing `time` plus the blend weight —
   * THE primitive that drives the unified time-slider feature. The
   * returned `weight` plugs directly into `weatherlayers-gl`'s
   * `imageWeight` prop.
   */
  getBracketingFrames(type: WeatherType, time: Date): Promise<BracketFrames>;

  /**
   * Optional: preload frames inside a window so the slider stays
   * smooth when the user scrubs. Providers that already cache
   * aggressively (e.g. Windy) can leave this as a no-op.
   */
  preload?(type: WeatherType, window: TimeRange): Promise<void>;
}
