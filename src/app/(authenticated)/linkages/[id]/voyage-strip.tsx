"use client";

// VoyageStrip — operator-facing voyage timeline for the linkage page.
// Shows one row per port stop in the order LOAD → LOAD → ... → DISCH.
// Lets the operator type ETA (becomes ATA via the actual checkbox) and
// optionally pin a manual ETS that overrides the qty / port-rate auto-calc.
// Disport ETAs are operator-overridable too — the resolver back-computes
// implied speed and flags > 14 kn as unrealistic.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Anchor, Ship, AlertTriangle, Edit2, Check, X } from "lucide-react";
import {
  resolveVoyageTimeline,
  type VoyageDealInput,
  type ResolvedPort,
} from "@/lib/maritime/voyage-timeline/resolver";
import {
  formatInPortTime,
  toPortLocalInputValue,
  fromPortLocalInputValue,
} from "@/lib/maritime/voyage-timeline/port-timezones";
import {
  LOAD_RATE_MT_PER_HOUR,
  DISCHARGE_RATE_MT_PER_HOUR,
} from "@/lib/maritime/voyage-timeline/constants";
import {
  resolveCpSpeed,
  type CpSpeedSource,
} from "@/lib/maritime/voyage-timeline/cp-speed";

export interface VoyageStripDeal {
  id: string;
  direction: "buy" | "sell";
  loadport: string;
  dischargePort: string | null;
  quantityMt: string;
  arrivalAt: string | null;
  arrivalIsActual: boolean;
  departureOverride: string | null;
  version: number;
}

interface VesselParticularsLite {
  serviceSpeedLadenKn?: number | null;
}

interface VoyageStripProps {
  linkageId: string;
  cpSpeedKn: number | string | null;
  cpSpeedSource: string | null;
  vesselParticulars: VesselParticularsLite | null;
  buyDeals: VoyageStripDeal[];
  sellDeals: VoyageStripDeal[];
  canEdit: boolean;
  onUpdated: () => void;
}

export function VoyageStrip({
  linkageId,
  cpSpeedKn,
  cpSpeedSource,
  vesselParticulars,
  buyDeals,
  sellDeals,
  canEdit,
  onUpdated,
}: VoyageStripProps) {
  // ── Resolve CP speed ────────────────────────────────────────────
  const { speedKn, source: speedSource } = resolveCpSpeed({
    linkageCpSpeedKn: cpSpeedKn,
    linkageCpSpeedSource: cpSpeedSource,
    q88SpeedKn: vesselParticulars?.serviceSpeedLadenKn ?? null,
  });

  // ── Build resolver inputs ───────────────────────────────────────
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

  // ── Distance pre-fetch ──────────────────────────────────────────
  const portPairs = useMemo(() => {
    const all = [...buyInputs, ...sellInputs];
    const pairs: Array<[string, string]> = [];
    for (let i = 1; i < all.length; i++) {
      pairs.push([all[i - 1].port, all[i].port]);
    }
    return pairs;
  }, [buyInputs, sellInputs]);

  const [distances, setDistances] = useState<Map<string, number | null>>(new Map());
  const fetchedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pendingKeys = portPairs
      .map(([a, b]) => keyForPair(a, b))
      .filter((k) => !fetchedKeysRef.current.has(k));
    if (pendingKeys.length === 0) return;

    pendingKeys.forEach((k) => fetchedKeysRef.current.add(k));
    Promise.all(
      portPairs
        .filter(([a, b]) => pendingKeys.includes(keyForPair(a, b)))
        .map(async ([a, b]) => {
          try {
            const res = await fetch(
              `/api/maritime/sea-distance?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}`,
              { cache: "force-cache" }
            );
            if (!res.ok) return [keyForPair(a, b), null] as const;
            const data = await res.json();
            const nm =
              typeof data.totalNm === "number"
                ? data.totalNm
                : typeof data.distanceNm === "number"
                  ? data.distanceNm
                  : null;
            return [keyForPair(a, b), nm] as const;
          } catch {
            return [keyForPair(a, b), null] as const;
          }
        })
    ).then((entries) => {
      setDistances((prev) => {
        const next = new Map(prev);
        for (const [k, v] of entries) next.set(k, v);
        return next;
      });
    });
  }, [portPairs]);

  // ── Resolve timeline ────────────────────────────────────────────
  const stops = useMemo(
    () =>
      resolveVoyageTimeline({
        buyDeals: buyInputs,
        sellDeals: sellInputs,
        cpSpeedKn: speedKn,
        getDistanceNm: (a, b) => distances.get(keyForPair(a, b)) ?? null,
      }),
    [buyInputs, sellInputs, speedKn, distances]
  );

  // ── Save handlers ───────────────────────────────────────────────
  // The resolver uses a SHARED port stop for same-port consecutive deals,
  // but storage is per-deal. When the operator edits the merged stop, push
  // the new value to the FIRST deal in the group; the others keep their
  // current values (typically null) and the resolver reads the first one
  // via its dedup pass on the next render.
  const dealMap = useMemo(() => {
    const m = new Map<string, VoyageStripDeal>();
    for (const d of [...buyDeals, ...sellDeals]) m.set(d.id, d);
    return m;
  }, [buyDeals, sellDeals]);

  const saveDealField = useCallback(
    async (
      dealId: string,
      payload: Partial<{
        arrivalAt: string | null;
        arrivalIsActual: boolean;
        departureOverride: string | null;
      }>
    ) => {
      const deal = dealMap.get(dealId);
      if (!deal) return;
      try {
        const res = await fetch(`/api/deals/${dealId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: deal.version }),
        });
        if (res.ok) {
          onUpdated();
          // Notify other open tabs/pages (e.g. the Fleet map's vessel
          // marker) that voyage-timeline data changed so they refetch
          // instead of holding the pre-edit position.
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("deal:updated", { detail: { dealId } })
            );
          }
        }
      } catch (err) {
        console.error("[voyage-strip] save failed:", err);
      }
    },
    [dealMap, onUpdated]
  );

  if (stops.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden text-xs">
      <div className="flex items-center justify-between gap-3 px-3 py-1 bg-[var(--color-surface-2)] border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <Ship className="h-3 w-3 text-[var(--color-text-secondary)]" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Voyage Timeline
          </h3>
        </div>
        <CpSpeedBadge
          linkageId={linkageId}
          speedKn={speedKn}
          source={speedSource}
          canEdit={canEdit}
          onUpdated={onUpdated}
        />
      </div>
      <div className="divide-y divide-[var(--color-border-subtle)]">
        {stops.map((stop, idx) => (
          <PortRow
            key={`${stop.port}-${idx}-${stop.dealIds.join("|")}`}
            stop={stop}
            isFirst={idx === 0}
            cpSpeedKn={speedKn}
            canEdit={canEdit}
            onArrivalChange={(date) =>
              saveDealField(stop.dealIds[0], {
                arrivalAt: date ? date.toISOString() : null,
              })
            }
            onActualToggle={(actual) =>
              saveDealField(stop.dealIds[0], { arrivalIsActual: actual })
            }
            onDepartureChange={(date) =>
              saveDealField(stop.dealIds[0], {
                departureOverride: date ? date.toISOString() : null,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── Port row ─────────────────────────────────────────────────────

function PortRow({
  stop,
  isFirst,
  cpSpeedKn,
  canEdit,
  onArrivalChange,
  onActualToggle,
  onDepartureChange,
}: {
  stop: ResolvedPort;
  isFirst: boolean;
  cpSpeedKn: number;
  canEdit: boolean;
  onArrivalChange: (d: Date | null) => void;
  onActualToggle: (b: boolean) => void;
  onDepartureChange: (d: Date | null) => void;
}) {
  const [editingArrival, setEditingArrival] = useState(false);
  const [editingDeparture, setEditingDeparture] = useState(false);
  const [arrivalDraft, setArrivalDraft] = useState("");
  const [departureDraft, setDepartureDraft] = useState("");

  const rate =
    stop.role === "load" ? LOAD_RATE_MT_PER_HOUR : DISCHARGE_RATE_MT_PER_HOUR;
  const portStayLabel =
    stop.totalQuantityMt > 0
      ? `${stop.totalQuantityMt.toLocaleString()} MT @ ${rate}/h = ${stop.portStayHours.toFixed(1)}h`
      : `min ${stop.portStayHours.toFixed(0)}h berth setup`;

  const arrivalLabel =
    stop.arrivalAt === null
      ? "—"
      : formatInPortTime(stop.arrivalAt, stop.port);
  const arrivalKind = stop.arrivalIsActual ? "ATA" : "ETA";
  const departureLabel =
    stop.departureAt === null
      ? "—"
      : formatInPortTime(stop.departureAt, stop.port);
  const arrivalIsInferred = stop.arrivalSource === "inferred";
  const departureIsInferred = stop.departureSource === "inferred";

  const startArrivalEdit = () => {
    if (!canEdit) return;
    setArrivalDraft(toPortLocalInputValue(stop.arrivalAt, stop.port));
    setEditingArrival(true);
  };
  const commitArrival = () => {
    const parsed = arrivalDraft.trim()
      ? fromPortLocalInputValue(arrivalDraft, stop.port)
      : null;
    onArrivalChange(parsed);
    setEditingArrival(false);
  };

  const startDepartureEdit = () => {
    if (!canEdit) return;
    setDepartureDraft(toPortLocalInputValue(stop.departureAt, stop.port));
    setEditingDeparture(true);
  };
  const commitDeparture = () => {
    const parsed = departureDraft.trim()
      ? fromPortLocalInputValue(departureDraft, stop.port)
      : null;
    onDepartureChange(parsed);
    setEditingDeparture(false);
  };

  const showActualCheckbox = stop.arrivalAt !== null && canEdit;
  const hasSpeedNote =
    stop.impliedSpeedKn !== null &&
    !Number.isNaN(stop.impliedSpeedKn);

  return (
    <div className="px-3 py-1 flex items-center gap-3 text-[11px]">
      {/* Badge + port name */}
      <div className="flex items-center gap-1.5 min-w-[180px] flex-shrink-0">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded ${
            stop.role === "load"
              ? "bg-blue-500/15 text-blue-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {stop.role === "load" ? "LOAD" : "DISCH"}
        </span>
        <span className="font-medium text-[var(--color-text-primary)] truncate">
          {stop.port}
        </span>
      </div>

      {/* Arrival */}
      {editingArrival ? (
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            value={arrivalDraft}
            onChange={(e) => setArrivalDraft(e.target.value)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-1.5 py-0.5 text-[11px]"
            autoFocus
          />
          <button
            type="button"
            onClick={commitArrival}
            className="p-0.5 text-green-400 hover:bg-[var(--color-surface-2)] rounded"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setEditingArrival(false)}
            className="p-0.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)] rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startArrivalEdit}
          disabled={!canEdit}
          className={`group flex items-baseline gap-1 ${
            canEdit ? "hover:text-[var(--color-text-primary)]" : ""
          } ${
            arrivalIsInferred
              ? "text-[var(--color-text-tertiary)] italic"
              : "text-[var(--color-text-secondary)]"
          }`}
          title={arrivalIsInferred ? "Auto-computed" : "Operator-entered"}
        >
          <span className="font-mono text-[9px] uppercase opacity-60">
            {stop.arrivalAt === null ? "ETA" : arrivalKind}
          </span>
          <span>{arrivalLabel}</span>
          {arrivalIsInferred && stop.arrivalAt !== null && (
            <span className="text-[9px] opacity-60">(auto)</span>
          )}
        </button>
      )}

      {/* Actual checkbox — only when ETA set */}
      {showActualCheckbox && (
        <label className="flex items-center gap-1 text-[9px] text-[var(--color-text-tertiary)] cursor-pointer">
          <input
            type="checkbox"
            checked={stop.arrivalIsActual}
            onChange={(e) => onActualToggle(e.target.checked)}
            className="h-2.5 w-2.5"
          />
          actual
        </label>
      )}

      {/* Departure */}
      {editingDeparture ? (
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            value={departureDraft}
            onChange={(e) => setDepartureDraft(e.target.value)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-1.5 py-0.5 text-[11px]"
            autoFocus
          />
          <button
            type="button"
            onClick={commitDeparture}
            className="p-0.5 text-green-400 hover:bg-[var(--color-surface-2)] rounded"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setEditingDeparture(false)}
            className="p-0.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)] rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startDepartureEdit}
          disabled={!canEdit}
          className={`group flex items-baseline gap-1 ${
            canEdit ? "hover:text-[var(--color-text-primary)]" : ""
          } ${
            departureIsInferred
              ? "text-[var(--color-text-tertiary)] italic"
              : "text-[var(--color-text-secondary)]"
          }`}
          title={departureIsInferred ? "Auto-computed from arrival + port stay" : "Operator-pinned"}
        >
          <span className="font-mono text-[9px] uppercase opacity-60">ETS</span>
          <span>{departureLabel}</span>
          {departureIsInferred && stop.departureAt !== null && (
            <span className="text-[9px] opacity-60">(auto)</span>
          )}
        </button>
      )}

      {/* Port stay + warnings — pushed right */}
      <div className="ml-auto flex items-center gap-3 text-[var(--color-text-tertiary)] text-[10px]">
        {stop.unrealisticSpeed && stop.impliedSpeedKn !== null ? (
          <span
            className="flex items-center gap-1 text-red-400"
            title={`Unrealistic — assumes ${stop.impliedSpeedKn.toFixed(1)} kn (CP ${cpSpeedKn} kn). Recheck.`}
          >
            <AlertTriangle className="h-3 w-3" />
            {stop.impliedSpeedKn.toFixed(1)} kn — recheck
          </span>
        ) : (
          hasSpeedNote && stop.impliedSpeedKn !== null && (
            <span>~{stop.impliedSpeedKn.toFixed(1)} kn implied</span>
          )
        )}
        <span title={portStayLabel}>{stop.portStayHours.toFixed(1)}h stay</span>
      </div>
    </div>
  );
}

// ── CP speed badge / inline editor ───────────────────────────────

function CpSpeedBadge({
  linkageId,
  speedKn,
  source,
  canEdit,
  onUpdated,
}: {
  linkageId: string;
  speedKn: number;
  source: CpSpeedSource;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(speedKn));

  const sourceLabel =
    source === "cp_clause"
      ? "from CP recap"
      : source === "q88"
        ? "from Q88"
        : source === "manual"
          ? "manual"
          : "default";

  const save = async () => {
    const parsed = parseFloat(draft);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > 25) {
      setEditing(false);
      return;
    }
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpSpeedKn: parsed, cpSpeedSource: "manual" }),
      });
      if (res.ok) onUpdated();
    } catch (err) {
      console.error("[voyage-strip] save cp speed failed:", err);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          min="6"
          max="25"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded px-2 py-0.5 text-xs"
          autoFocus
        />
        <span className="text-[10px] text-[var(--color-text-tertiary)]">kn</span>
        <button
          type="button"
          onClick={save}
          className="p-1 text-green-400 hover:bg-[var(--color-surface-1)] rounded"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-1)] rounded"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!canEdit) return;
        setDraft(String(speedKn));
        setEditing(true);
      }}
      disabled={!canEdit}
      className={`group flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${
        canEdit ? "hover:bg-[var(--color-surface-1)]" : ""
      } ${source === "default" ? "text-[var(--color-text-tertiary)] italic" : "text-[var(--color-text-secondary)]"}`}
      title="Click to override"
    >
      <span className="font-mono">{speedKn} kn</span>
      <span className="text-[10px] opacity-70">— {sourceLabel}</span>
      {canEdit && <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50" />}
    </button>
  );
}

function keyForPair(a: string, b: string): string {
  return `${a.toUpperCase().trim()}|${b.toUpperCase().trim()}`;
}
