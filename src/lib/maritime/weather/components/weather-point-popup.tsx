"use client";

/**
 * `<WeatherPointPopup />` — ephemeral card anchored to the lat/lon
 * the operator clicked on the map. Pairs with the future ship-
 * weather popup; both drive off `sampleFrame()`, differing only in
 * where the point comes from (click vs vessel position).
 *
 * Uses react-map-gl's `Popup` so the card is anchored to the click
 * coordinate (not a fixed screen corner) and pans / zooms with the
 * map — matches the Windy-style "callout over the clicked spot"
 * interaction operators are already used to.
 *
 * MUST render inside the `<FleetMapInner>` children slot so it has
 * the MapLibre map context react-map-gl needs.
 */

import { useEffect, useState } from "react";
import { Popup } from "react-map-gl/maplibre";
import { X } from "lucide-react";

import type { WeatherProvider } from "../provider";
import type { WeatherType } from "../types";
import { sampleFrame, type SampledValue } from "../sampler";

interface WeatherPointPopupProps {
  provider: WeatherProvider;
  /** Only the layers the operator has toggled on — popup shows one
   *  row per type and skips rest. Passing an empty array renders an
   *  informational empty state. */
  types: WeatherType[];
  time: Date;
  lat: number;
  lon: number;
  onClose: () => void;
}

interface LayerSample {
  type: WeatherType;
  status: "loading" | "ok" | "nodata" | "error";
  sample?: SampledValue;
}

export function WeatherPointPopup({
  provider,
  types,
  time,
  lat,
  lon,
  onClose,
}: WeatherPointPopupProps) {
  const [samples, setSamples] = useState<LayerSample[]>(() =>
    types.map((t) => ({ type: t, status: "loading" as const })),
  );

  useEffect(() => {
    let cancelled = false;
    setSamples(types.map((t) => ({ type: t, status: "loading" as const })));

    (async () => {
      const results = await Promise.all(
        types.map(async (type): Promise<LayerSample> => {
          try {
            const frame = await provider.getFrame(type, time);
            const s = await sampleFrame(frame, lat, lon);
            if (s === null) return { type, status: "nodata" };
            return { type, status: "ok", sample: s };
          } catch (err) {
            if (process.env.NODE_ENV !== "production") {
              // Visible in the browser console while debugging — the
              // popup itself shows a discreet "error" pill so ops
              // know the cell is broken without seeing the stack.
              console.warn(`[WeatherPointPopup] sample ${type} failed:`, err);
            }
            return { type, status: "error" };
          }
        }),
      );
      if (!cancelled) setSamples(results);
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, types, time, lat, lon]);

  return (
    <Popup
      longitude={lon}
      latitude={lat}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={14}
      className="weather-point-popup"
      maxWidth="none"
    >
      <div className="w-56">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="leading-tight">
            <div className="font-mono text-[0.7rem] font-semibold text-[var(--color-text-primary)]">
              {formatLatLon(lat, lon)}
            </div>
            <div className="font-mono text-[0.6rem] text-[var(--color-text-tertiary)]">
              {formatTime(time)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
            title="Close"
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <div className="space-y-1 border-t border-[var(--color-border)] pt-2">
          {types.length === 0 ? (
            <div className="text-[0.65rem] text-[var(--color-text-tertiary)]">
              Turn on a weather layer to see values here.
            </div>
          ) : (
            samples.map((s) => <SampleRow key={s.type} sample={s} />)
          )}
        </div>
      </div>
    </Popup>
  );
}

function SampleRow({ sample }: { sample: LayerSample }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[0.7rem]">
      <span className="uppercase tracking-wide text-[0.6rem] text-[var(--color-text-tertiary)]">
        {sample.type}
      </span>
      <span className={`font-mono ${statusColor(sample.status)}`}>
        {formatStatusValue(sample)}
      </span>
    </div>
  );
}

function statusColor(status: LayerSample["status"]): string {
  switch (status) {
    case "ok":
      return "text-[var(--color-text-primary)]";
    case "loading":
      return "text-[var(--color-text-tertiary)]";
    case "nodata":
      return "text-[var(--color-text-tertiary)]";
    case "error":
      return "text-red-400";
  }
}

function formatStatusValue(s: LayerSample): string {
  if (s.status === "loading") return "…";
  if (s.status === "nodata") return "— no data";
  if (s.status === "error") return "error";
  if (s.sample === undefined) return "—";
  return formatSample(s.type, s.sample);
}

function formatSample(type: WeatherType, sample: SampledValue): string {
  if (sample.vector !== undefined) {
    const { magnitude, directionDeg } = sample.vector;
    if (type === "wind") {
      // Wind: "12.3 m/s from SW" — meteorological "from" convention
      // feels natural when the popup is over a vessel.
      const fromDeg = (directionDeg + 180) % 360;
      return `${magnitude.toFixed(1)} m/s from ${compass(fromDeg)}`;
    }
    if (type === "waves") {
      // Waves: "3.4 m from WSW" — same convention as how operators
      // read wave reports from weather routers.
      const fromDeg = (directionDeg + 180) % 360;
      return `${magnitude.toFixed(1)} m from ${compass(fromDeg)}`;
    }
  }
  if (sample.scalar !== undefined) {
    const { value } = sample.scalar;
    if (type === "temperature") {
      const c = value - 273.15; // pipeline stores Kelvin
      return `${c.toFixed(1)} °C`;
    }
    return value.toFixed(1);
  }
  return "—";
}

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}   ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function formatTime(t: Date): string {
  const day = t.getUTCDate().toString().padStart(2, "0");
  const month = t.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = t.getUTCHours().toString().padStart(2, "0");
  const mm = t.getUTCMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${hh}:${mm} UTC`;
}
