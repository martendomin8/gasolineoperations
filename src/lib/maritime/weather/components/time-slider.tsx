"use client";

/**
 * `<TimeSlider />` — the unified time-axis that drives both the ship
 * marker and the weather layers in lock-step.
 *
 * Binds itself to the provider's available forecast range, so the
 * slider covers exactly the hours we have data for. Dragging the
 * slider calls `onChange(t)`; the parent broadcasts `t` to everyone
 * (WeatherLayer for frame blending, the vessel position helpers for
 * ship interpolation). Play/pause auto-advances at a tunable speed.
 */

import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WeatherProvider } from "../provider";
import type { TimeRange, WeatherType } from "../types";

const PLAYBACK_TICK_MS = 60;
// Minutes of simulated time advanced per real-world tick while playing.
// 20 min / tick @ 60 ms tick = ~20 simulated hours per real second.
const PLAYBACK_ADVANCE_MIN_PER_TICK = 20;

interface TimeSliderProps {
  provider: WeatherProvider;
  /** Which layer's time axis to use. All types share the same range
   *  in practice, but `wind` is the safest default for Week 4. */
  type?: WeatherType;
  time: Date | null;
  onChange: (t: Date) => void;
  /** Hide the slider entirely when the weather layer is off. */
  visible?: boolean;
}

export function TimeSlider({
  provider,
  type = "wind",
  time,
  onChange,
  visible = true,
}: TimeSliderProps) {
  const [range, setRange] = useState<TimeRange | null>(null);
  const [cycleTime, setCycleTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // ---- Fetch the range + cycle time once per provider+type ------------
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const [r, cycle] = await Promise.all([
          provider.getAvailableRange(type),
          provider.getLatestCycleTime(),
        ]);
        if (!cancelled) {
          setRange(r);
          setCycleTime(cycle);
        }
      } catch (err) {
        if (!cancelled) {
          setRange(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, type]);

  // ---- Snap `time` into the range when the range first arrives --------
  useEffect(() => {
    if (range === null) return;
    if (time === null) {
      // Operators open the map and want to see "now", not the
      // forecast cycle's analysis timestamp (which is up to 6 h
      // stale). Round the wall clock down to the current UTC hour
      // and clamp into the available forecast window.
      const now = new Date();
      now.setUTCMinutes(0, 0, 0);
      const t = now.getTime();
      const startMs = range.start.getTime();
      const endMs = range.end.getTime();
      const clamped =
        t < startMs ? range.start : t > endMs ? range.end : new Date(t);
      onChange(clamped);
      return;
    }
    if (time < range.start) onChange(range.start);
    if (time > range.end) onChange(range.end);
  }, [range, time, onChange]);

  // ---- Playback loop ----------------------------------------------------
  useEffect(() => {
    if (!playing || range === null || time === null) return;
    const interval = setInterval(() => {
      if (!playingRef.current) return;
      const nextMs = time.getTime() + PLAYBACK_ADVANCE_MIN_PER_TICK * 60_000;
      if (nextMs >= range.end.getTime()) {
        onChange(range.end);
        setPlaying(false); // stop at the end of forecast horizon
      } else {
        onChange(new Date(nextMs));
      }
    }, PLAYBACK_TICK_MS);
    return () => clearInterval(interval);
  }, [playing, range, time, onChange]);

  // ---- Derived values for the `<input type=range>` --------------------
  // The visible left edge of the slider is `max(range.start, now)` —
  // we hide already-elapsed forecast hours the same way windy.com
  // does. The forecast frames before "now" are still in the manifest
  // (the provider can sample backward if anything explicitly requests
  // a past time), but the slider track + day ticks always start at
  // the current UTC hour. Wall-clock recomputed every minute so the
  // edge marches forward as the operator stares at the screen — no
  // need for a useState since the change is purely visual.
  const [nowMs, setNowMs] = useState(() => {
    const d = new Date();
    d.setUTCMinutes(0, 0, 0);
    return d.getTime();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      d.setUTCMinutes(0, 0, 0);
      setNowMs(d.getTime());
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const rangeMs = useMemo(() => {
    if (range === null) return null;
    const rawMin = range.start.getTime();
    const rawMax = range.end.getTime();
    // Clamp the visible left edge to "now". If the entire manifest is
    // in the past (shouldn't happen in steady state, but defends
    // against a stale CDN), fall back to the original window so the
    // operator at least sees something.
    const visibleMin = nowMs < rawMax ? Math.max(rawMin, nowMs) : rawMin;
    return { min: visibleMin, max: rawMax };
  }, [range, nowMs]);

  const currentMs = time?.getTime() ?? rangeMs?.min ?? 0;

  // Day ticks for the axis — one label per UTC midnight inside the
  // range. Each tick gets a percentage position 0–100 so the caller
  // can absolute-position it under the slider track. We emit a short
  // "Tue 21" style label (weekday abbreviation + day-of-month) that
  // matches how Windy labels its axis — enough at-a-glance signal
  // without eating horizontal space.
  const dayTicks = useMemo(() => {
    if (rangeMs === null) return [];
    const span = rangeMs.max - rangeMs.min;
    if (span <= 0) return [];
    const ticks: Array<{ ts: number; label: string; pct: number }> = [];
    // First UTC midnight at or after range.start.
    const first = new Date(rangeMs.min);
    first.setUTCHours(0, 0, 0, 0);
    if (first.getTime() < rangeMs.min) {
      first.setUTCDate(first.getUTCDate() + 1);
    }
    for (let t = first.getTime(); t <= rangeMs.max; t += 86_400_000) {
      const d = new Date(t);
      const weekday = d.toLocaleString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      });
      const day = d.getUTCDate();
      ticks.push({
        ts: t,
        label: `${weekday} ${day}`,
        pct: ((t - rangeMs.min) / span) * 100,
      });
    }
    return ticks;
  }, [rangeMs]);

  // Percentage position of the thumb (0–100) — drives the hour
  // callout placement above the track.
  const thumbPct = useMemo(() => {
    if (rangeMs === null) return 0;
    const span = rangeMs.max - rangeMs.min;
    if (span <= 0) return 0;
    return ((currentMs - rangeMs.min) / span) * 100;
  }, [rangeMs, currentMs]);

  const handleSliderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(new Date(Number(e.target.value)));
    },
    [onChange],
  );

  if (!visible) return null;

  // ---- States ---------------------------------------------------------
  if (error !== null) {
    return (
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[0.7rem] text-[var(--color-text-tertiary)]">
        No forecast available yet. {error}
      </div>
    );
  }

  if (rangeMs === null || time === null) {
    return (
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[0.7rem] text-[var(--color-text-tertiary)]">
        Loading forecast range…
      </div>
    );
  }

  const hoursFromStart =
    (time.getTime() - rangeMs.min) / (60 * 60 * 1000);

  return (
    <div className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 pt-5 pb-6">
      <button
        onClick={() => setPlaying((p) => !p)}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-sky-500/20 text-sky-400 transition-colors hover:bg-sky-500/30"
        title={playing ? "Pause" : "Play"}
        type="button"
      >
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <button
        onClick={() => {
          setPlaying(false);
          onChange(new Date(rangeMs.min));
        }}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        title="Reset to forecast start"
        type="button"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <div className="relative flex-1">
        {/* Hour callout pinned above the thumb. `translateX(-50%)`
            centres it on the thumb; we clamp `thumbPct` into
            [0,100] via the inline style so it can't overflow the
            track visually at the extremes. `pointer-events-none`
            so it never swallows drag attempts. */}
        <div
          className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded bg-sky-500 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold text-white shadow-sm"
          style={{
            left: `${Math.max(0, Math.min(100, thumbPct))}%`,
            transform: "translateX(-50%)",
          }}
        >
          {formatHourCallout(time)}
        </div>
        <input
          type="range"
          min={rangeMs.min}
          max={rangeMs.max}
          value={currentMs}
          step={15 * 60 * 1000 /* 15-minute resolution */}
          onChange={handleSliderInput}
          className="h-1 w-full cursor-pointer accent-sky-500"
        />
        {/* Day ticks below the track — absolute-positioned so they
            don't affect row height / layout. Each tick renders two
            siblings stacked vertically: a short vertical stroke
            that reads as a "day separator" on the track (same idea
            Windy uses), and the weekday/day label centred under
            it. At the 16-day horizon, labels rarely overlap; if
            they ever do on a narrow screen we just let them pile
            up rather than add a ResizeObserver pass. */}
        <div className="pointer-events-none absolute left-0 right-0 top-full h-5">
          {dayTicks.map((tick) => (
            <span
              key={tick.ts}
              className="absolute top-0 flex flex-col items-center"
              style={{
                left: `${tick.pct}%`,
                transform: "translateX(-50%)",
              }}
            >
              <span className="h-1.5 w-px bg-[var(--color-text-tertiary)]/70" />
              <span className="mt-0.5 whitespace-nowrap font-mono text-[0.55rem] text-[var(--color-text-tertiary)]">
                {tick.label}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end leading-tight">
        <span className="font-mono text-[0.7rem] font-semibold text-[var(--color-text-primary)]">
          {formatTimeLabel(time)}
        </span>
        <span className="font-mono text-[0.6rem] text-[var(--color-text-tertiary)]">
          +{hoursFromStart.toFixed(1)}h
          {cycleTime !== null && (
            <>
              {" "}
              · issued {formatCycleTime(cycleTime)}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function formatHourCallout(t: Date): string {
  // "11:00" — UTC hour+minute. Matches the precision of the main
  // right-side label so the two never disagree on the same instant.
  const hh = t.getUTCHours().toString().padStart(2, "0");
  const mm = t.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatTimeLabel(t: Date): string {
  // "21 Apr 18:00 UTC" — compact and timezone-explicit so ops doesn't
  // guess whether the slider is showing local or vessel time.
  const day = t.getUTCDate().toString().padStart(2, "0");
  const month = t.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const hh = t.getUTCHours().toString().padStart(2, "0");
  const mm = t.getUTCMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${hh}:${mm} UTC`;
}

function formatCycleTime(t: Date): string {
  // Cycle times are always on the hour (00/06/12/18 UTC), so no
  // minutes needed. "20 Apr 12Z" style — same shorthand as NWS.
  const day = t.getUTCDate().toString().padStart(2, "0");
  const month = t.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const hh = t.getUTCHours().toString().padStart(2, "0");
  return `${day} ${month} ${hh}Z`;
}
