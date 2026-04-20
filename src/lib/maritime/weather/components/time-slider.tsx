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
      onChange(range.start);
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
  const rangeMs = useMemo(() => {
    if (range === null) return null;
    return { min: range.start.getTime(), max: range.end.getTime() };
  }, [range]);

  const currentMs = time?.getTime() ?? rangeMs?.min ?? 0;

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
    <div className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2">
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
      <input
        type="range"
        min={rangeMs.min}
        max={rangeMs.max}
        value={currentMs}
        step={15 * 60 * 1000 /* 15-minute resolution */}
        onChange={handleSliderInput}
        className="h-1 flex-1 cursor-pointer accent-sky-500"
      />
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
