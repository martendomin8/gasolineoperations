"use client";

/**
 * `<WeatherControls />` — on/off toggles for each weather layer.
 *
 * Week 3: wind only. Waves and temperature rows are wired up but
 * disabled until their respective encoders ship (Week 5).
 *
 * The component is state-lifted — the parent owns the on/off booleans
 * so it can mirror them to `<WeatherLayer>` props. Keeping this
 * component dumb makes the Week 4 TimeSlider integration trivial
 * (the slider becomes a sibling, not a parent).
 */

import type { WeatherType } from "../types";

export type WeatherLayerVisibility = Record<WeatherType, boolean>;

export const DEFAULT_WEATHER_VISIBILITY: WeatherLayerVisibility = {
  wind: false,
  waves: false,
  temperature: false,
};

interface WeatherControlsProps {
  visibility: WeatherLayerVisibility;
  onChange: (next: WeatherLayerVisibility) => void;
  /** When true, disable rows whose encoders aren't shipped yet. */
  disabled?: Partial<Record<WeatherType, boolean>>;
}

const ROWS: Array<{ type: WeatherType; label: string; hint?: string }> = [
  { type: "wind", label: "Wind" },
  { type: "waves", label: "Waves" },
  { type: "temperature", label: "Temperature", hint: "coming later" },
];

export function WeatherControls({
  visibility,
  onChange,
  disabled = { temperature: true },
}: WeatherControlsProps) {
  const toggle = (type: WeatherType) => {
    onChange({ ...visibility, [type]: !visibility[type] });
  };

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[0.625rem] font-bold uppercase tracking-wider text-sky-400">
          Weather
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {ROWS.map(({ type, label, hint }) => {
          const isDisabled = disabled[type] === true;
          return (
            <label
              key={type}
              className={`flex items-center gap-2 rounded px-1.5 py-1 text-[0.7rem] ${
                isDisabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <input
                type="checkbox"
                checked={visibility[type]}
                disabled={isDisabled}
                onChange={() => toggle(type)}
                className="h-3 w-3 cursor-pointer accent-sky-500"
              />
              <span className="font-medium text-[var(--color-text-primary)]">
                {label}
              </span>
              {hint !== undefined && (
                <span className="ml-auto text-[0.6rem] italic text-[var(--color-text-tertiary)]">
                  {hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
