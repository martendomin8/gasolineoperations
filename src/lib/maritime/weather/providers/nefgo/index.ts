/**
 * NEFGO weather provider — our own NOAA-GFS-powered implementation.
 *
 * Reads the manifest + per-frame PNG/JSON pairs produced by the Python
 * pipeline in `scripts/weather-pipeline/`. Clients who want a polished
 * commercial forecast feed instead can swap in the (future)
 * WindyWeatherProvider with a single env var.
 */

import type { WeatherProvider } from "../../provider";
import type {
  BracketFrames,
  TimeRange,
  WeatherFrame,
  WeatherFrameManifest,
  WeatherManifest,
  WeatherType,
} from "../../types";
import { loadFrame } from "./frame-fetcher";
import { loadManifest } from "./manifest-loader";

export class NefgoWeatherProvider implements WeatherProvider {
  readonly name = "nefgo";

  async getLatestCycleTime(): Promise<Date | null> {
    const manifest = await loadManifest();
    if (manifest.runs.length === 0) return null;
    // `add_run` keeps runs sorted oldest → newest on the Python side,
    // so the last entry is the freshest cycle.
    return manifest.runs[manifest.runs.length - 1].cycleTime;
  }

  async getAvailableRange(type: WeatherType): Promise<TimeRange> {
    const frames = await this.listFrames(type);
    if (frames.length === 0) {
      throw new Error(
        `No ${type} forecast frames available yet. The pipeline may not ` +
          `have run for the first time.`,
      );
    }
    return {
      start: frames[0].validTime,
      end: frames[frames.length - 1].validTime,
    };
  }

  async getFrameTimes(type: WeatherType): Promise<Date[]> {
    const frames = await this.listFrames(type);
    return frames.map((f) => f.validTime);
  }

  async getFrame(type: WeatherType, time: Date): Promise<WeatherFrame> {
    const frames = await this.listFrames(type);
    const closest = pickClosest(frames, time);
    if (closest === null) {
      throw new Error(`No ${type} frames available to serve time ${time.toISOString()}`);
    }
    return loadFrame(closest.pngUrl, closest.jsonUrl);
  }

  async getBracketingFrames(
    type: WeatherType,
    time: Date,
  ): Promise<BracketFrames> {
    const frames = await this.listFrames(type);
    const bracket = pickBracket(frames, time);
    if (bracket === null) {
      throw new Error(
        `No ${type} frames bracket time ${time.toISOString()}. The time ` +
          `may be outside the forecast horizon.`,
      );
    }
    const [before, after, weight] = bracket;
    const [beforeFrame, afterFrame] = await Promise.all([
      loadFrame(before.pngUrl, before.jsonUrl),
      loadFrame(after.pngUrl, after.jsonUrl),
    ]);
    return { before: beforeFrame, after: afterFrame, weight };
  }

  async preload(type: WeatherType, window: TimeRange): Promise<void> {
    const frames = await this.listFrames(type);
    const inWindow = frames.filter(
      (f) => f.validTime >= window.start && f.validTime <= window.end,
    );
    // Fire-and-forget; loadFrame caches internally so duplicate calls
    // are cheap.
    await Promise.all(inWindow.map((f) => loadFrame(f.pngUrl, f.jsonUrl)));
  }

  // -- helpers ---------------------------------------------------------

  /**
   * Flatten the manifest into a chronological list of frames for one
   * weather type. Spans runs so the slider stays smooth across cycle
   * boundaries — if the newest run doesn't yet cover the slider's
   * position, we fall back to the previous run's frames.
   */
  private async listFrames(
    type: WeatherType,
  ): Promise<WeatherFrameManifest[]> {
    const manifest = await loadManifest();
    return mergeFramesByType(manifest, type);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function mergeFramesByType(
  manifest: WeatherManifest,
  type: WeatherType,
): WeatherFrameManifest[] {
  const byTime = new Map<number, WeatherFrameManifest>();
  // Walk runs oldest → newest so later runs overwrite earlier entries at
  // the same valid time. This biases toward the freshest forecast while
  // still letting us read older frames for times the newest run hasn't
  // reached yet.
  for (const run of manifest.runs) {
    const frames = run.frames[type] ?? [];
    for (const frame of frames) {
      byTime.set(frame.validTime.getTime(), frame);
    }
  }
  return Array.from(byTime.values()).sort(
    (a, b) => a.validTime.getTime() - b.validTime.getTime(),
  );
}

export function pickClosest(
  frames: WeatherFrameManifest[],
  time: Date,
): WeatherFrameManifest | null {
  if (frames.length === 0) return null;
  const target = time.getTime();
  let best = frames[0];
  let bestDelta = Math.abs(best.validTime.getTime() - target);
  for (let i = 1; i < frames.length; i += 1) {
    const delta = Math.abs(frames[i].validTime.getTime() - target);
    if (delta < bestDelta) {
      best = frames[i];
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Return (before, after, weight) where `before.validTime <= time <= after.validTime`.
 * If `time` equals a frame exactly, before == after and weight == 0.
 * Returns null if `time` is outside the covered range.
 */
export function pickBracket(
  frames: WeatherFrameManifest[],
  time: Date,
): [WeatherFrameManifest, WeatherFrameManifest, number] | null {
  if (frames.length === 0) return null;
  const target = time.getTime();
  if (target < frames[0].validTime.getTime()) return null;
  if (target > frames[frames.length - 1].validTime.getTime()) return null;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    const aT = a.validTime.getTime();
    const bT = b.validTime.getTime();
    if (target >= aT && target <= bT) {
      const span = bT - aT;
      const weight = span === 0 ? 0 : (target - aT) / span;
      return [a, b, weight];
    }
  }
  // Exact match on the last frame.
  const last = frames[frames.length - 1];
  return [last, last, 0];
}
