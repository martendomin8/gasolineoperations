"use client";

// VoyageProgressBar — horizontal voyage timeline visualisation.
//
// Replaces the legacy 5-step Active → Loading → Sailing → Discharging →
// Completed stepper that the operator had to click manually. The new bar
// derives the vessel's current state from arrival/departure timestamps:
// past port-stays render solid green, the current vessel position sits as
// a diamond on the leg it's traversing, future stops show greyed out.
//
// One "Mark voyage completed" button on the right end is the only
// surviving manual action — every other state transition happens
// automatically as the timeline events flow in.

import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, Anchor, Ship } from "lucide-react";
import { resolveVoyageTimeline, type VoyageDealInput } from "@/lib/maritime/voyage-timeline/resolver";
import { deriveVoyageStateWithGlobalProgress } from "@/lib/maritime/voyage-timeline/state";
import { formatInPortTime } from "@/lib/maritime/voyage-timeline/port-timezones";
import { resolveCpSpeed } from "@/lib/maritime/voyage-timeline/cp-speed";

export interface VoyageProgressBarDeal {
  id: string;
  direction: "buy" | "sell";
  loadport: string;
  dischargePort: string | null;
  quantityMt: string;
  arrivalAt: string | null;
  arrivalIsActual: boolean;
  departureOverride: string | null;
}

interface Props {
  linkageId: string;
  linkageStatus: string;
  cpSpeedKn: number | string | null;
  cpSpeedSource: string | null;
  vesselParticulars: { serviceSpeedLadenKn?: number | null } | null;
  buyDeals: VoyageProgressBarDeal[];
  sellDeals: VoyageProgressBarDeal[];
  canEdit: boolean;
  onUpdated: () => void;
}

export function VoyageProgressBar({
  linkageId,
  linkageStatus,
  cpSpeedKn,
  cpSpeedSource,
  vesselParticulars,
  buyDeals,
  sellDeals,
  canEdit,
  onUpdated,
}: Props) {
  // Tick a clock every minute so "now"-driven state stays fresh without a
  // page reload. Cheap because the resolver runs in pure JS over a small
  // array; no extra API call needed.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { speedKn } = resolveCpSpeed({
    linkageCpSpeedKn: cpSpeedKn,
    linkageCpSpeedSource: cpSpeedSource,
    q88SpeedKn: vesselParticulars?.serviceSpeedLadenKn ?? null,
  });

  const { buyInputs, sellInputs } = useMemo(() => {
    return {
      buyInputs: buyDeals.map<VoyageDealInput>((d) => ({
        id: d.id,
        direction: "buy",
        port: d.loadport,
        quantityMt: parseFloat(d.quantityMt) || 0,
        arrivalAt: d.arrivalAt ? new Date(d.arrivalAt) : null,
        arrivalIsActual: d.arrivalIsActual,
        departureOverride: d.departureOverride ? new Date(d.departureOverride) : null,
      })),
      sellInputs: sellDeals
        .filter((d) => Boolean(d.dischargePort))
        .map<VoyageDealInput>((d) => ({
          id: d.id,
          direction: "sell",
          port: d.dischargePort!,
          quantityMt: parseFloat(d.quantityMt) || 0,
          arrivalAt: d.arrivalAt ? new Date(d.arrivalAt) : null,
          arrivalIsActual: d.arrivalIsActual,
          departureOverride: d.departureOverride ? new Date(d.departureOverride) : null,
        })),
    };
  }, [buyDeals, sellDeals]);

  // Distance lookup is irrelevant for the bar's visual layout — the bar
  // spaces ports evenly. The resolver still needs *something* though;
  // we hand back null so port-stay durations come from the qty/rate
  // estimate, which is fine here because we only consume `arrivalAt` /
  // `departureAt` (already independent of distance).
  const stops = useMemo(
    () =>
      resolveVoyageTimeline({
        buyDeals: buyInputs,
        sellDeals: sellInputs,
        cpSpeedKn: speedKn,
        getDistanceNm: () => null,
      }),
    [buyInputs, sellInputs, speedKn]
  );

  const state = useMemo(
    () => deriveVoyageStateWithGlobalProgress(stops, new Date(nowTick)),
    [stops, nowTick]
  );

  const isCompleted = linkageStatus === "completed";
  const [marking, setMarking] = useState(false);

  const markCompleted = async () => {
    if (!canEdit || marking || isCompleted) return;
    setMarking(true);
    try {
      const r = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (r.ok) onUpdated();
    } finally {
      setMarking(false);
    }
  };

  const reopen = async () => {
    if (!canEdit || marking || !isCompleted) return;
    setMarking(true);
    try {
      const r = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (r.ok) onUpdated();
    } finally {
      setMarking(false);
    }
  };

  if (stops.length === 0) {
    return null;
  }

  const N = stops.length;
  // Each port node sits at evenly spaced positions along the bar. With N
  // nodes, the i-th sits at i / (N-1). Single port → centre.
  const nodeLeft = (i: number): string => {
    if (N === 1) return "50%";
    return `${(i / (N - 1)) * 100}%`;
  };

  // Vessel diamond position uses the global progress, but for "at_port"
  // we want the diamond ON the node (not just before it). The state helper
  // already gives globalProgress = atStopIdx * slot for that case.
  const diamondLeft = isCompleted ? "100%" : `${state.globalProgress * 100}%`;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Ship className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Voyage Progress
          </span>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              isCompleted
                ? "bg-green-900/30 text-green-400 border border-green-700/40"
                : state.phase === "sailing"
                  ? "bg-blue-500/15 text-blue-300 border border-blue-500/25"
                  : state.phase === "at_port"
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                    : state.phase === "pre_voyage"
                      ? "bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                      : "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
            }`}
          >
            {isCompleted ? "Completed" : state.label}
          </span>
        </div>
        {canEdit && (
          isCompleted ? (
            <button
              type="button"
              onClick={reopen}
              disabled={marking}
              className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              Reopen voyage
            </button>
          ) : (
            <button
              type="button"
              onClick={markCompleted}
              disabled={marking}
              className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)] hover:text-green-400 transition-colors"
              title="Archive this voyage"
            >
              <CheckCircle2 className="h-3 w-3" />
              {marking ? "Saving…" : "Mark voyage completed"}
            </button>
          )
        )}
      </div>

      {/* Bar */}
      <div className="relative pt-1 pb-10">
        {/* Track segments: one per leg between adjacent stops */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px flex">
          {Array.from({ length: Math.max(N - 1, 0) }).map((_, legIdx) => {
            const completedLeg =
              isCompleted ||
              (state.atStopIdx !== null && legIdx < state.atStopIdx) ||
              (state.phase === "sailing" && state.atStopIdx === legIdx);
            return (
              <div
                key={legIdx}
                className="flex-1 relative h-px"
                style={{
                  background: completedLeg
                    ? "rgba(74, 222, 128, 0.7)"
                    : "transparent",
                  borderTop: completedLeg
                    ? undefined
                    : "1px dashed rgba(255,255,255,0.18)",
                }}
              />
            );
          })}
        </div>

        {/* Port nodes */}
        {stops.map((stop, i) => {
          const isPast = !isCompleted && state.atStopIdx !== null && i < state.atStopIdx;
          const isCurrent = !isCompleted && state.atStopIdx === i && state.phase === "at_port";
          const arrLabel = stop.arrivalAt ? formatInPortTime(stop.arrivalAt, stop.port) : "—";
          const arrKind = stop.arrivalIsActual && stop.arrivalAt ? "ATS" : stop.arrivalAt ? "ETA" : "ETA";
          // ATS for first load (vessel sailed from there), ETA for everything else
          const tagText = i === 0 && stop.arrivalIsActual && stop.role === "load" ? "ATS" : arrKind;

          return (
            <div
              key={`${stop.port}-${i}`}
              className="absolute"
              style={{
                left: nodeLeft(i),
                top: "50%",
                transform: "translate(-50%, -50%)",
              }}
            >
              <div
                className={`flex flex-col items-center ${
                  isPast || isCurrent || isCompleted ? "opacity-100" : "opacity-60"
                }`}
              >
                <div
                  className={`h-3 w-3 rounded-full border-2 ${
                    isPast || isCompleted
                      ? "bg-green-500 border-green-500"
                      : isCurrent
                        ? "bg-amber-400 border-amber-400 ring-2 ring-amber-400/30"
                        : "bg-[var(--color-surface-2)] border-[var(--color-border-default)]"
                  }`}
                />
                <div
                  className="absolute top-5 flex flex-col items-center whitespace-nowrap"
                  style={{ minWidth: "max-content" }}
                >
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded ${
                      stop.role === "load"
                        ? "bg-blue-500/15 text-blue-300"
                        : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {stop.role === "load" ? "LOAD" : "DISCH"}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--color-text-primary)] mt-0.5">
                    {stop.port}
                  </span>
                  <span className="text-[9px] text-[var(--color-text-tertiary)] mt-px">
                    <span className="font-mono opacity-70">{tagText}</span> {arrLabel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Vessel diamond — only show when there's something to show */}
        {!isCompleted && state.phase !== "pre_voyage" && stops.length > 0 && (
          <div
            className="absolute pointer-events-none transition-[left] duration-700 ease-out"
            style={{
              left: diamondLeft,
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className="h-3.5 w-3.5 bg-[var(--color-text-primary)] border-2 border-[var(--color-surface-1)] shadow-md"
              style={{ transform: "rotate(45deg)" }}
              title={state.label}
            />
          </div>
        )}
      </div>
    </div>
  );
}
