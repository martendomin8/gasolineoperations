"use client";

// VoyageSchematicBar — single-row voyage progress visualisation, ~280 px
// tall. Built from the design produced by Claude Design (see
// CLAUDE DESIGN/voyage-schematic-bar.tsx + nefgo-voyage-schematic-bar-
// reference.png for the pixel target).
//
// Drop-in for the linkage page above the VoyageStrip data-entry table.
// Per the design handoff, action buttons (e.g. "Mark voyage completed")
// don't live inside the bar — they slot into the header via
// `headerActionSlot` so the visualisation stays presentation-only.

import type { ReactNode } from "react";
import { Anchor } from "lucide-react";
import clsx from "clsx";
import type { ResolvedPort } from "@/lib/maritime/voyage-timeline/resolver";
import type { VoyageState } from "@/lib/maritime/voyage-timeline/state";

interface VoyageHeaderInfo {
  voyageRef: string;       // e.g. "NOM-2541" or "Voyage 123"
  vesselName: string;      // e.g. "MV STENA PROVIDENCE"
  productLabel: string;    // e.g. "37,500 MT EBOB"
  laycanRange: string;     // e.g. "23–27 APR"
  cpSpeedKn: number;
  totalDistanceNm: number;
}

export interface VoyageSchematicBarProps {
  header: VoyageHeaderInfo;
  stops: ResolvedPort[];
  state: VoyageState & { globalProgress: number };
  formatInPortTime: (date: Date | null, portName: string) => string;
  /** Optional action slot rendered inside the header, next to the status pill. */
  headerActionSlot?: ReactNode;
}

// ── Helpers ──────────────────────────────────────────────────────

function shortDate(formatted: string): string {
  // formatInPortTime returns "30 Apr, 10:53 LT" (en-GB inserts a comma).
  // The header wants just "30 Apr" — slice the day + month, drop any
  // trailing punctuation the locale inserted.
  return formatted
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .replace(/[,.]$/, "");
}

function laycanMarginHours(eta: Date | null, laycanRange: string): number | null {
  // laycanRange shape: "23–27 APR". Pull the second day-of-month and assume
  // same month/year as ETA; if parsing fails, return null and the UI shows "—".
  if (!eta) return null;
  const m = laycanRange.match(/(\d{1,2})\s*[–-]\s*(\d{1,2})\s+([A-Z]{3})/i);
  if (!m) return null;
  const lastDay = parseInt(m[2], 10);
  const monthStr = m[3].toUpperCase();
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const month = months.indexOf(monthStr);
  if (month < 0) return null;
  const year = eta.getUTCFullYear();
  const laycanEnd = Date.UTC(year, month, lastDay, 23, 59, 59);
  return (laycanEnd - eta.getTime()) / 3_600_000;
}

// ── Component ────────────────────────────────────────────────────

export default function VoyageSchematicBar({
  header,
  stops,
  state,
  formatInPortTime,
  headerActionSlot,
}: VoyageSchematicBarProps) {
  const loadStop = stops[0];
  const dischStop = stops[stops.length - 1];

  // Marker position — clamped 2…98% so the diamond never sits on top of an
  // endpoint node and disappears.
  const pct = Math.max(2, Math.min(98, state.globalProgress * 100));

  const remainingNm = Math.max(
    0,
    Math.round(header.totalDistanceNm * (1 - state.globalProgress)),
  );

  const atd = loadStop?.departureAt ?? null;
  const eta = dischStop?.arrivalAt ?? null;

  // Implied speed for the *current* leg (next stop), if any.
  const impliedSpeed =
    state.nextStopIdx != null ? stops[state.nextStopIdx]?.impliedSpeedKn : null;

  const margin = laycanMarginHours(eta, header.laycanRange);
  const marginIsBlown = margin != null && margin < 0;

  // Status pill colors by phase
  const phaseStyles =
    state.phase === "completed"
      ? "border-emerald-500 text-emerald-400"
      : state.phase === "at_port"
        ? "border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
        : "border-[var(--color-accent)] text-[var(--color-accent)]";

  return (
    <section className="relative w-full bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] px-10 pt-8 pb-7">
      {/* Header */}
      <header className="grid grid-cols-[1fr_auto] items-end gap-5 mb-6">
        <div>
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-[var(--color-text-tertiary)] mb-1.5">
            VOYAGE · {header.voyageRef} · {header.totalDistanceNm.toLocaleString()} NM
          </div>
          <h2 className="font-sans text-[22px] font-medium tracking-[-0.005em] text-[var(--color-text-primary)] m-0">
            {header.vesselName}
            <span className="text-[var(--color-accent)] mx-1.5"> · </span>
            <span className="text-[var(--color-text-secondary)]">{header.productLabel}</span>
          </h2>
          <div className="font-mono text-[10.5px] tracking-[0.05em] text-[var(--color-text-tertiary)] mt-1.5">
            LAYCAN {header.laycanRange}
            {atd && <> · DEPARTED {shortDate(formatInPortTime(atd, loadStop.port))}</>}
            {eta && <> · ETA {shortDate(formatInPortTime(eta, dischStop.port))}</>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={clsx(
              "font-mono text-[10px] tracking-[0.2em] uppercase border px-3 py-1.5 whitespace-nowrap inline-flex items-center gap-2",
              phaseStyles,
            )}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            {state.label.toUpperCase()}
            {!marginIsBlown && state.phase !== "pre_voyage" && state.phase !== "completed" && " · ON LAYCAN"}
            {marginIsBlown && " · OFF LAYCAN"}
          </div>
          {headerActionSlot}
        </div>
      </header>

      {/* Track */}
      <div className="relative h-20 mt-16 mb-6">
        {/* Endpoint labels (top) */}
        <div className="absolute -top-9 left-0">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)]">
            LOAD PORT
          </div>
          <div className="font-sans text-base font-medium tracking-[-0.005em] text-[var(--color-text-primary)] mt-0.5">
            {loadStop?.port}
          </div>
        </div>
        <div className="absolute -top-9 right-0 text-right">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)]">
            DISCH PORT
          </div>
          <div className="font-sans text-base font-medium tracking-[-0.005em] text-[var(--color-text-primary)] mt-0.5">
            {dischStop?.port}
          </div>
        </div>

        {/* Axis: full track (background) */}
        <div className="absolute top-1/2 left-0 right-0 h-px border-t border-dashed border-[var(--color-border-subtle)]" />
        {/* Traveled portion (solid amber) */}
        <div
          className="absolute top-1/2 left-0 h-px bg-[var(--color-accent)] shadow-[0_0_8px_rgba(245,158,11,0.5)]"
          style={{ width: `${pct}%` }}
        />

        {/* Tick marks at 25/50/75% */}
        {[25, 50, 75].map((t) => (
          <div
            key={t}
            className="absolute top-[calc(50%-5px)] w-px h-2.5 bg-[var(--color-text-tertiary)] opacity-60"
            style={{ left: `${t}%` }}
          />
        ))}

        {/* Endpoint nodes */}
        <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-3 h-3 border border-[var(--color-accent)] bg-[var(--color-accent)]" />
        <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-3 h-3 border border-[var(--color-accent)] bg-[var(--color-surface-1)]" />

        {/* Vessel marker — `left` is the only inline style, per spec */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
          style={{ left: `${pct}%` }}
        >
          <div className="absolute w-9 h-9 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.45),transparent_70%)] blur-[2px] pointer-events-none" />
          <Anchor
            className="relative z-10 text-[var(--color-accent)] drop-shadow-[0_0_4px_var(--color-accent)]"
            size={16}
            strokeWidth={2.2}
          />
          <div className="absolute top-6 font-mono text-[10px] tracking-[0.15em] uppercase text-[var(--color-accent)] whitespace-nowrap">
            {header.cpSpeedKn} KN · {remainingNm.toLocaleString()} NM TO GO
          </div>
        </div>

        {/* Endpoint timestamps (bottom) */}
        <div className="absolute -bottom-8 left-0 font-mono text-[10.5px] tracking-[0.04em] text-[var(--color-text-primary)]">
          <div className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)] mb-0.5">
            ATD
          </div>
          {atd ? formatInPortTime(atd, loadStop.port) : "—"}
        </div>
        <div className="absolute -bottom-8 right-0 text-right font-mono text-[10.5px] tracking-[0.04em] text-[var(--color-text-primary)]">
          <div className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)] mb-0.5">
            ETA
          </div>
          {eta ? formatInPortTime(eta, dischStop.port) : "—"}
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-5 mt-14 pt-5 border-t border-[var(--color-border-subtle)]">
        <Metric label="PROGRESS" value={`${Math.round(state.globalProgress * 100)}`} unit="%" accent />
        <Metric label="SPEED · CURRENT" value={header.cpSpeedKn.toFixed(1)} unit="KN" />
        <Metric
          label="SPEED · IMPLIED"
          value={impliedSpeed != null ? impliedSpeed.toFixed(1) : "—"}
          unit={impliedSpeed != null ? "KN" : ""}
          alarm={!!stops[state.nextStopIdx ?? -1]?.unrealisticSpeed}
        />
        <Metric
          label="ETA"
          value={eta ? shortDate(formatInPortTime(eta, dischStop.port)) : "—"}
          unit={eta ? formatInPortTime(eta, dischStop.port).split(/\s+/).slice(2).join(" ") : ""}
        />
        <Metric
          label="LAYCAN MARGIN"
          value={margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}` : "—"}
          unit={margin != null ? "H" : ""}
          accent={margin != null && margin >= 0}
          alarm={marginIsBlown}
          last
        />
      </div>
    </section>
  );
}

// ── Metric tile ──────────────────────────────────────────────────

function Metric({
  label,
  value,
  unit,
  accent,
  alarm,
  last,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  alarm?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={clsx(
        "px-4 first:pl-0 border-r border-[var(--color-border-subtle)]",
        last && "border-r-0 pr-0",
      )}
    >
      <div className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-[var(--color-text-tertiary)] mb-1.5">
        {label}
      </div>
      <div
        className={clsx(
          "font-sans text-lg font-medium tracking-[-0.005em] tabular-nums",
          alarm
            ? "text-red-400"
            : accent
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-primary)]",
        )}
      >
        {value}
        {unit && <span className="text-xs text-[var(--color-text-tertiary)] font-normal tracking-[0.04em] ml-1">{unit}</span>}
      </div>
    </div>
  );
}
