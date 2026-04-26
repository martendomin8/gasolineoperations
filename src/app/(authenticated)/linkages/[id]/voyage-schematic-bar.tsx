"use client";

// VoyageSchematicBar — single-row voyage progress visualisation, ~280 px
// tall. Built from the design produced by Claude Design (see
// CLAUDE DESIGN/voyage-schematic-bar.tsx + nefgo-voyage-schematic-bar-
// reference.png for the pixel target), then iterated to:
//   - render N port nodes (multi-port voyages — sketch from Arne 2026-04-26)
//   - per-port click-popover for editing ATA / ATD with actual flags
//   - SPEED NEEDED TO ARRIVE ON TIME tile (replaces the confusing IMPLIED)
//   - LAYCAN MARGIN tile with day+hour precision + alarm pulse when blown
//   - SPEED CURRENT tile now click-to-edit (replaces the deleted strip's
//     CP speed badge)
//
// Keeps the operator's edit affordances on the bar itself — the separate
// VoyageStrip data-entry table was removed because it duplicated every
// timestamp the bar already showed.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Anchor, Check, X, AlertTriangle, Pencil } from "lucide-react";
import clsx from "clsx";
import type { ResolvedPort } from "@/lib/maritime/voyage-timeline/resolver";
import type { VoyageState } from "@/lib/maritime/voyage-timeline/state";
import {
  toPortLocalInputValue,
  fromPortLocalInputValue,
} from "@/lib/maritime/voyage-timeline/port-timezones";
import { UNREALISTIC_SPEED_KN } from "@/lib/maritime/voyage-timeline/constants";

interface VoyageHeaderInfo {
  voyageRef: string;
  vesselName: string;
  productLabel: string;
  laycanRange: string;     // pretty-printed "23–27 APR" for header
  cpSpeedKn: number;
  totalDistanceNm: number;
  laycanEnd: Date | null;  // last day of disport laycan window for SPEED NEEDED + MARGIN
}

export interface PortSavePayload {
  arrivalAt?: string | null;
  arrivalIsActual?: boolean;
  departureOverride?: string | null;
}

export interface VoyageSchematicBarProps {
  header: VoyageHeaderInfo;
  stops: ResolvedPort[];
  state: VoyageState & { globalProgress: number };
  formatInPortTime: (date: Date | null, portName: string) => string;
  /** Saves an edit on a port stop. dealId comes from `stop.dealIds[0]`. */
  onSavePort: (dealId: string, payload: PortSavePayload) => Promise<void>;
  /** Persists a new CP speed value (already resolved → manual source). */
  onChangeCpSpeed: (knots: number) => Promise<void>;
  /** Slot rendered next to the status pill — typically the "Mark completed" button. */
  headerActionSlot?: ReactNode;
  canEdit: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function fmtMarginDH(hours: number | null): {
  label: string;
  prefix: "+" | "" | "";
} {
  if (hours === null || !Number.isFinite(hours)) return { label: "—", prefix: "" };
  const sign = hours >= 0 ? "+" : "";
  const abs = Math.abs(hours);
  const days = Math.floor(abs / 24);
  const remainHours = Math.round(abs - days * 24);
  if (days === 0) return { label: `${sign}${remainHours}h`, prefix: sign as "+" | "" };
  if (remainHours === 0) return { label: `${sign}${days}d`, prefix: sign as "+" | "" };
  return { label: `${sign}${days}d ${remainHours}h`, prefix: sign as "+" | "" };
}

function speedNeededKn(
  remainingNm: number,
  hoursToLaycanEnd: number | null,
): number | null {
  if (hoursToLaycanEnd === null || hoursToLaycanEnd <= 0) return null;
  if (remainingNm <= 0) return 0;
  return remainingNm / hoursToLaycanEnd;
}

// ── Component ────────────────────────────────────────────────────

export default function VoyageSchematicBar({
  header,
  stops,
  state,
  formatInPortTime,
  onSavePort,
  onChangeCpSpeed,
  headerActionSlot,
  canEdit,
}: VoyageSchematicBarProps) {
  const N = stops.length;
  const lastDisch = stops[stops.length - 1] ?? null;
  const eta = lastDisch?.role === "discharge" ? lastDisch.arrivalAt : null;

  // Derived numbers
  const remainingNm = useMemo(
    () => Math.max(0, Math.round(header.totalDistanceNm * (1 - state.globalProgress))),
    [header.totalDistanceNm, state.globalProgress],
  );
  const hoursToLaycanEnd = useMemo(() => {
    if (!header.laycanEnd) return null;
    return (header.laycanEnd.getTime() - Date.now()) / 3_600_000;
  }, [header.laycanEnd]);
  const marginHours = useMemo(() => {
    if (!eta || !header.laycanEnd) return null;
    return (header.laycanEnd.getTime() - eta.getTime()) / 3_600_000;
  }, [eta, header.laycanEnd]);
  const isBlown = marginHours !== null && marginHours < 0;
  const margin = fmtMarginDH(marginHours);
  const needed = speedNeededKn(remainingNm, hoursToLaycanEnd);
  const neededIsAlarm =
    needed !== null && (needed > UNREALISTIC_SPEED_KN || needed > header.cpSpeedKn * 1.2);

  // Marker position — clamp 2…98% so it never hides under an endpoint node.
  const pct = Math.max(2, Math.min(98, state.globalProgress * 100));

  // Status pill colors by phase
  const phaseStyles =
    state.phase === "completed"
      ? "border-emerald-500 text-emerald-400"
      : isBlown
        ? "border-red-500 text-red-400 animate-pulse"
        : state.phase === "at_port"
          ? "border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
          : "border-[var(--color-accent)] text-[var(--color-accent)]";

  // Per-port popover state — only one port editable at a time.
  const [openPortIdx, setOpenPortIdx] = useState<number | null>(null);

  return (
    <section className="relative w-full bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] px-10 pt-7 pb-7">
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
            {!isBlown && state.phase !== "pre_voyage" && state.phase !== "completed" && " · ON LAYCAN"}
            {isBlown && " · OFF LAYCAN"}
          </div>
          {headerActionSlot}
        </div>
      </header>

      {/* Track + N nodes — tall section because each node stacks ATA + ATD
          labels below the track on the LOAD side, and a stale `mb-12`
          collided with the metric tiles row beneath. */}
      <div className="relative mt-12 mb-24 h-2">
        {/* Axis: full track (background) */}
        <div className="absolute top-1/2 left-0 right-0 h-px border-t border-dashed border-[var(--color-border-subtle)]" />
        {/* Traveled portion (solid amber) */}
        <div
          className="absolute top-1/2 left-0 h-px bg-[var(--color-accent)] shadow-[0_0_8px_rgba(245,158,11,0.5)]"
          style={{ width: `${pct}%` }}
        />

        {/* Port nodes */}
        {stops.map((stop, idx) => {
          const left = N === 1 ? "50%" : `${(idx / (N - 1)) * 100}%`;
          return (
            <PortNode
              key={`${stop.port}-${idx}-${stop.dealIds.join("|")}`}
              stop={stop}
              idx={idx}
              total={N}
              leftPct={left}
              isPast={!isBlown && state.atStopIdx !== null && idx < state.atStopIdx}
              isCurrent={state.atStopIdx === idx && state.phase === "at_port"}
              formatInPortTime={formatInPortTime}
              canEdit={canEdit}
              isPopoverOpen={openPortIdx === idx}
              onToggleEdit={() => setOpenPortIdx((o) => (o === idx ? null : idx))}
              onSave={(payload) => onSavePort(stop.dealIds[0], payload)}
            />
          );
        })}

        {/* Vessel marker */}
        {state.phase !== "pre_voyage" && state.phase !== "completed" && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center pointer-events-none"
            style={{ left: `${pct}%` }}
          >
            <div className="absolute w-9 h-9 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.45),transparent_70%)] blur-[2px]" />
            <Anchor
              className="relative z-10 text-[var(--color-accent)] drop-shadow-[0_0_4px_var(--color-accent)]"
              size={16}
              strokeWidth={2.2}
            />
            <div className="absolute top-6 font-mono text-[10px] tracking-[0.15em] uppercase text-[var(--color-accent)] whitespace-nowrap">
              {header.cpSpeedKn} KN · {remainingNm.toLocaleString()} NM TO GO
            </div>
          </div>
        )}
      </div>

      {/* Metric tiles. Convention (per Arne 2026-04-26): tiles flagged
          `readonly` render italic + dimmed so the operator immediately
          reads them as "computed, don't try to click". The CP speed tile
          stays normal-styled with a persistent pencil icon to signal
          "editable" — it's the sole interactive tile in the row. */}
      <div className="grid grid-cols-5 mt-12 pt-5 border-t border-[var(--color-border-subtle)]">
        <Metric
          label="PROGRESS"
          value={`${Math.round(state.globalProgress * 100)}`}
          unit="%"
          accent
          readonly
        />
        <CpSpeedTile
          cpSpeedKn={header.cpSpeedKn}
          canEdit={canEdit}
          onChange={onChangeCpSpeed}
        />
        <Metric
          label="NEEDED TO ARRIVE"
          value={needed != null ? needed.toFixed(1) : "—"}
          unit={needed != null ? "KN" : ""}
          alarm={neededIsAlarm}
          readonly
        />
        <Metric
          label="ETA"
          value={eta ? formatInPortTime(eta, lastDisch?.port ?? "").split(/\s+/).slice(0, 2).join(" ").replace(/[,.]$/, "") : "—"}
          unit={eta ? formatInPortTime(eta, lastDisch?.port ?? "").split(/\s+/).slice(2).join(" ") : ""}
          readonly
        />
        <Metric
          label={isBlown ? "LATE BY" : "LAYCAN MARGIN"}
          value={margin.label}
          unit=""
          accent={!isBlown && margin.prefix === "+"}
          alarm={isBlown}
          loud={isBlown}
          readonly
          last
        />
      </div>
    </section>
  );
}

// ── Port node + popover ──────────────────────────────────────────

function PortNode({
  stop,
  idx,
  total,
  leftPct,
  isPast,
  isCurrent,
  formatInPortTime,
  canEdit,
  isPopoverOpen,
  onToggleEdit,
  onSave,
}: {
  stop: ResolvedPort;
  idx: number;
  total: number;
  leftPct: string;
  isPast: boolean;
  isCurrent: boolean;
  formatInPortTime: (d: Date | null, port: string) => string;
  canEdit: boolean;
  isPopoverOpen: boolean;
  onToggleEdit: () => void;
  onSave: (payload: PortSavePayload) => Promise<void>;
}) {
  const isFirst = idx === 0;
  const isLast = idx === total - 1;
  const isLoad = stop.role === "load";

  // Square node styling
  const nodeFill = isPast || isCurrent
    ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
    : isLast
      ? "bg-[var(--color-surface-1)] border-[var(--color-accent)]"
      : "bg-[var(--color-accent)] border-[var(--color-accent)]";

  const arrivalLabel = stop.arrivalAt ? formatInPortTime(stop.arrivalAt, stop.port) : "—";
  const departureLabel = stop.departureAt ? formatInPortTime(stop.departureAt, stop.port) : "—";
  const arrivalKind = stop.arrivalIsActual ? "ATA" : "ETA";
  const departureKind = stop.arrivalIsActual && stop.departureSource === "manual" ? "ATD" : "ETD";

  // Anchor each label aligned to the node.
  const labelAnchor = isFirst
    ? "left-0"
    : isLast
      ? "right-0 text-right"
      : "left-1/2 -translate-x-1/2 text-center";

  return (
    <div className="absolute top-0" style={{ left: leftPct, width: 0 }}>
      {/* Node square */}
      <div
        className={clsx(
          "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 border",
          nodeFill,
        )}
      />

      {/* Top-side port label (LOAD PORT / DISCH PORT + name) */}
      <div className={clsx("absolute -top-12", labelAnchor, "min-w-[140px]")}>
        <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)]">
          {isLoad ? "LOAD PORT" : "DISCH PORT"}
        </div>
        <div className="font-sans text-base font-medium tracking-[-0.005em] text-[var(--color-text-primary)] mt-0.5">
          {stop.port}
        </div>
      </div>

      {/* Bottom-side timestamps — clickable to edit */}
      <div className={clsx("absolute top-6", labelAnchor, "min-w-[150px]")}>
        <button
          type="button"
          onClick={() => canEdit && onToggleEdit()}
          disabled={!canEdit}
          className={clsx(
            "block font-mono text-[10.5px] tracking-[0.04em] text-left",
            isPopoverOpen
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-primary)] hover:text-[var(--color-accent)]",
            isLast && "ml-auto text-right",
          )}
        >
          <span className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)] block mb-0.5">
            {arrivalKind}
          </span>
          {arrivalLabel}
        </button>
        {!isFirst && stop.role === "discharge" && (
          // For discharge ports, ETA is read-only (computed). The button
          // above lets the operator mark it as actual via the popover.
          <span className="block font-mono text-[9px] text-[var(--color-text-tertiary)] mt-0.5 italic">
            {stop.arrivalSource === "inferred" ? "(computed)" : ""}
          </span>
        )}
        {isLoad && (
          <button
            type="button"
            onClick={() => canEdit && onToggleEdit()}
            disabled={!canEdit}
            className={clsx(
              "block font-mono text-[10.5px] tracking-[0.04em] text-left mt-1",
              "text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]",
              isLast && "ml-auto text-right",
            )}
          >
            <span className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)] block mb-0.5">
              {departureKind}
            </span>
            {departureLabel}
          </button>
        )}
      </div>

      {/* Popover */}
      {isPopoverOpen && (
        <PortEditPopover
          stop={stop}
          isFirst={isFirst}
          isLast={isLast}
          onClose={onToggleEdit}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function PortEditPopover({
  stop,
  isLast,
  onClose,
  onSave,
}: {
  stop: ResolvedPort;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onSave: (payload: PortSavePayload) => Promise<void>;
}) {
  const [arrivalDraft, setArrivalDraft] = useState(
    toPortLocalInputValue(stop.arrivalAt, stop.port),
  );
  const [arrivalIsActual, setArrivalIsActual] = useState(stop.arrivalIsActual);
  const [departureDraft, setDepartureDraft] = useState(
    stop.departureSource === "manual"
      ? toPortLocalInputValue(stop.departureAt, stop.port)
      : "",
  );
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside / ESC close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: PortSavePayload = {};
      const arrivalDate = arrivalDraft.trim()
        ? fromPortLocalInputValue(arrivalDraft, stop.port)
        : null;
      payload.arrivalAt = arrivalDate ? arrivalDate.toISOString() : null;
      payload.arrivalIsActual = arrivalIsActual;
      // Departure override only applies to load ports — disch ports compute
      // their own departure from arrival + port stay (and the operator
      // rarely cares about ETD on a discharge anyway).
      if (!isLast || stop.role === "load") {
        const depDate = departureDraft.trim()
          ? fromPortLocalInputValue(departureDraft, stop.port)
          : null;
        payload.departureOverride = depDate ? depDate.toISOString() : null;
      }
      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={ref}
      className={clsx(
        "absolute top-32 z-50 bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] shadow-2xl p-3 min-w-[280px]",
        isLast ? "right-0" : "left-1/2 -translate-x-1/2",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-text-tertiary)]">
            {stop.role === "load" ? "Load" : "Discharge"} ·
          </span>{" "}
          <span className="font-sans text-[12px] font-medium text-[var(--color-text-primary)]">
            {stop.port}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] rounded"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <label className="block text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
        Arrival ({arrivalIsActual ? "ATA — actual" : "ETA — estimated"})
      </label>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="datetime-local"
          value={arrivalDraft}
          onChange={(e) => setArrivalDraft(e.target.value)}
          className="bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-[11px] flex-1"
        />
        <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={arrivalIsActual}
            onChange={(e) => setArrivalIsActual(e.target.checked)}
            className="h-3 w-3"
          />
          Actual
        </label>
      </div>

      {stop.role === "load" && (
        <>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
            Departure (ATD / ETS — overrides auto-calc when set)
          </label>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="datetime-local"
              value={departureDraft}
              onChange={(e) => setDepartureDraft(e.target.value)}
              className="bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-[11px] flex-1"
            />
          </div>
        </>
      )}

      <div className="text-[9.5px] text-[var(--color-text-tertiary)] mb-2">
        Port stay: {stop.portStayHours.toFixed(1)} h
        {stop.totalQuantityMt > 0 && ` · ${stop.totalQuantityMt.toLocaleString()} MT`}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-accent)] border border-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] rounded inline-flex items-center gap-1"
        >
          <Check className="h-3 w-3" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Metric tile ──────────────────────────────────────────────────

function Metric({
  label,
  value,
  unit,
  accent,
  alarm,
  loud,
  readonly,
  last,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  alarm?: boolean;
  loud?: boolean;          // bigger number + pulsing ring when blown
  /** Italic + dimmed styling to signal "computed, not clickable". */
  readonly?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={clsx(
        "px-4 first:pl-0 border-r border-[var(--color-border-subtle)]",
        last && "border-r-0 pr-0",
        loud && "rounded bg-red-500/5 ring-1 ring-red-500/40 -my-1 py-1",
      )}
    >
      <div
        className={clsx(
          "font-mono text-[9.5px] tracking-[0.2em] uppercase mb-1.5",
          loud
            ? "text-red-400"
            : readonly
              ? "italic text-[var(--color-text-tertiary)] opacity-70"
              : "text-[var(--color-text-tertiary)]",
        )}
      >
        {loud && <AlertTriangle className="inline h-3 w-3 mr-1 -mt-0.5" />}
        {label}
      </div>
      <div
        className={clsx(
          "font-sans font-medium tracking-[-0.005em] tabular-nums",
          loud ? "text-[20px]" : "text-lg",
          alarm
            ? "text-red-400"
            : accent
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-primary)]",
          // Readonly numerics stay legible (no italic on the number itself
          // — italics on tabular-nums look skewed/awkward), but the unit
          // dims a touch.
        )}
      >
        {value}
        {unit && (
          <span
            className={clsx(
              "text-xs font-normal tracking-[0.04em] ml-1",
              readonly
                ? "italic text-[var(--color-text-tertiary)] opacity-70"
                : "text-[var(--color-text-tertiary)]",
            )}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// CP speed tile — click to edit. Replaces the CP speed badge that used to
// live in the (now-deleted) VoyageStrip header.
function CpSpeedTile({
  cpSpeedKn,
  canEdit,
  onChange,
}: {
  cpSpeedKn: number;
  canEdit: boolean;
  onChange: (knots: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(cpSpeedKn));
  useEffect(() => setDraft(String(cpSpeedKn)), [cpSpeedKn]);

  const save = async () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || v <= 0 || v > 25) {
      setEditing(false);
      return;
    }
    await onChange(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-4 first:pl-0 border-r border-[var(--color-border-subtle)]">
        <div className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-[var(--color-text-tertiary)] mb-1.5">
          SPEED · CURRENT
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-16 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-1.5 py-0.5 text-base font-medium tabular-nums"
            autoFocus
          />
          <span className="text-xs text-[var(--color-text-tertiary)]">KN</span>
          <button type="button" onClick={save} className="p-0.5 text-green-400">
            <Check className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => setEditing(false)} className="p-0.5 text-[var(--color-text-tertiary)]">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => canEdit && setEditing(true)}
      disabled={!canEdit}
      className="px-4 first:pl-0 border-r border-[var(--color-border-subtle)] text-left group"
    >
      <div className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-[var(--color-text-tertiary)] mb-1.5 inline-flex items-center gap-1">
        SPEED · CURRENT
        {canEdit && (
          // Persistent pencil signals "this tile is editable" so the operator
          // doesn't have to hover-hunt to find the lone clickable metric in
          // a row of computed values.
          <Pencil className="h-2.5 w-2.5 text-[var(--color-accent)] opacity-70 group-hover:opacity-100" />
        )}
      </div>
      <div className="font-sans text-lg font-medium tracking-[-0.005em] tabular-nums text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors">
        {cpSpeedKn.toFixed(1)}
        <span className="text-xs text-[var(--color-text-tertiary)] font-normal tracking-[0.04em] ml-1">KN</span>
      </div>
    </button>
  );
}
