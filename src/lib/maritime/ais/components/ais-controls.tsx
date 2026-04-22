"use client";

/**
 * `<AisControls />` — the "Live AIS" toggle next to the weather
 * controls on the Fleet page. Deliberately small: one button, one
 * badge with the tracked-vessel count. Follows the same visual style
 * as `<WeatherControls />` so the two feel like siblings.
 */

import { Radio } from "lucide-react";

interface AisControlsProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  vesselCount: number;
  flagCount: number;
  loading: boolean;
  error: string | null;
}

export function AisControls({
  enabled,
  onToggle,
  vesselCount,
  flagCount,
  loading,
  error,
}: AisControlsProps) {
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1.5">
      <button
        onClick={() => onToggle(!enabled)}
        title={enabled ? "Disable live AIS" : "Enable live AIS"}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-[0.7rem] font-medium transition-colors ${
          enabled
            ? "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
            : "bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        }`}
        type="button"
      >
        <Radio
          className={`h-3.5 w-3.5 ${
            enabled && loading ? "animate-pulse" : ""
          }`}
        />
        Live AIS
      </button>
      {enabled && (
        <span className="font-mono text-[0.65rem] text-[var(--color-text-tertiary)]">
          {vesselCount} tracked
          {flagCount > 0 && (
            <>
              {" · "}
              <span className="text-amber-400">{flagCount} flag{flagCount === 1 ? "" : "s"}</span>
            </>
          )}
        </span>
      )}
      {error !== null && (
        <span
          className="font-mono text-[0.65rem] text-red-400"
          title={error}
        >
          error
        </span>
      )}
    </div>
  );
}
