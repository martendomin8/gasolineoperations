"use client";

// Wrapper that adapts the dashboard's deal payload into the VoyageSchematicBar
// inputs. Lives next to the bar component itself so the linkage page only
// imports a single component.
//
// Responsibilities:
//   - Build VoyageDealInput[] from buy/sell deals
//   - Fetch the loadport→dischargePort distance (single shot, cached)
//   - Resolve CP speed via the resolver chain (cp_clause > q88 > manual > 12)
//   - Run the timeline + state derivation
//   - Compose VoyageHeaderInfo (voyageRef, vessel, product label, laycan range)
//   - Render the bar with a "Mark voyage completed" button slotted into the header
//   - Tick every minute so the vessel marker advances without an external refetch

import { useEffect, useMemo, useState, useCallback } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import VoyageSchematicBar, {
  type PortSavePayload,
} from "./voyage-schematic-bar";
import {
  resolveVoyageTimeline,
  type VoyageDealInput,
} from "@/lib/maritime/voyage-timeline/resolver";
import { deriveVoyageStateWithGlobalProgress } from "@/lib/maritime/voyage-timeline/state";
import { formatInPortTime } from "@/lib/maritime/voyage-timeline/port-timezones";
import { resolveCpSpeed } from "@/lib/maritime/voyage-timeline/cp-speed";
import { formatVesselName } from "@/lib/utils/vessel-display";

export interface VoyageSchematicBarDeal {
  id: string;
  direction: "buy" | "sell";
  loadport: string;
  dischargePort: string | null;
  product: string;
  quantityMt: string;
  laycanStart: string;        // YYYY-MM-DD
  laycanEnd: string;          // YYYY-MM-DD
  arrivalAt: string | null;
  arrivalIsActual: boolean;
  departureOverride: string | null;
  /** Threaded through so per-port popover edits can pass an optimistic-lock
   *  version back to PUT /api/deals/:id without an extra fetch. */
  version: number;
  /** Per-parcel breakdown for multi-grade deals (>=2 parcels). Undefined or
   *  empty → render the deal-level product/quantity summary. With >=2
   *  parcels the label code emits one "qty MT grade" per parcel — never
   *  summed/joined per the multi-parcel display rule. */
  parcels?: { parcelNo: number; product: string; quantityMt: string }[];
}

interface Props {
  linkageId: string;
  linkageNumber: string | null;
  linkageTempName: string;
  linkageStatus: string;
  vesselName: string | null;
  cpSpeedKn: number | string | null;
  cpSpeedSource: string | null;
  vesselParticulars: { serviceSpeedLadenKn?: number | null } | null;
  buyDeals: VoyageSchematicBarDeal[];
  sellDeals: VoyageSchematicBarDeal[];
  canEdit: boolean;
  onUpdated: () => void;
}

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatLaycanRange(buyDeals: VoyageSchematicBarDeal[]): string {
  if (buyDeals.length === 0) return "—";
  // Earliest start to latest end across all loadport deals.
  const starts = buyDeals.map((d) => d.laycanStart).filter(Boolean).sort();
  const ends = buyDeals.map((d) => d.laycanEnd).filter(Boolean).sort();
  const start = starts[0];
  const end = ends[ends.length - 1];
  if (!start || !end) return "—";
  // YYYY-MM-DD → "23–27 APR"
  const sd = parseInt(start.slice(8, 10), 10);
  const ed = parseInt(end.slice(8, 10), 10);
  const sm = parseInt(start.slice(5, 7), 10) - 1;
  const em = parseInt(end.slice(5, 7), 10) - 1;
  if (sm === em) {
    return `${sd}–${ed} ${MONTHS[em]}`;
  }
  // Cross-month window (rare but possible) — render both
  return `${sd} ${MONTHS[sm]} – ${ed} ${MONTHS[em]}`;
}

function formatProductLabel(buyDeals: VoyageSchematicBarDeal[]): string {
  if (buyDeals.length === 0) return "—";
  // Multi-parcel rule (per Arne 2026-04-26 + memory feedback): never collapse
  // multi-grade quantities into a sum + joined grade list. Each parcel keeps
  // its own qty + grade so "ISOMERATE + REFORMATE" doesn't read as one
  // shared 5,000 MT pile when it's actually two 2,500 MT parcels.
  const segments: string[] = [];
  for (const d of buyDeals) {
    const hasParcels = (d.parcels?.length ?? 0) > 1;
    if (hasParcels) {
      for (const p of d.parcels!) {
        const q = Math.round(parseFloat(p.quantityMt) || 0).toLocaleString();
        segments.push(`${q} MT ${p.product}`);
      }
    } else {
      const q = Math.round(parseFloat(d.quantityMt) || 0).toLocaleString();
      segments.push(`${q} MT ${d.product}`);
    }
  }
  return segments.join(" + ") || "—";
}

function keyForPair(a: string, b: string): string {
  return `${a.toUpperCase().trim()}|${b.toUpperCase().trim()}`;
}

export function VoyageSchematicBarWrapper({
  linkageId,
  linkageNumber,
  linkageTempName,
  linkageStatus,
  vesselName,
  cpSpeedKn,
  cpSpeedSource,
  vesselParticulars,
  buyDeals,
  sellDeals,
  canEdit,
  onUpdated,
}: Props) {
  // Tick every 60 s so the vessel marker advances visibly without the parent
  // having to refetch on a timer. The timeline math is pure JS — cheap.
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

  const { buyInputs, sellInputs, primaryLoadport, primaryDischport } = useMemo(() => {
    const b = buyDeals.map<VoyageDealInput>((d) => ({
      id: d.id,
      direction: "buy",
      port: d.loadport,
      quantityMt: parseFloat(d.quantityMt) || 0,
      arrivalAt: d.arrivalAt ? new Date(d.arrivalAt) : null,
      arrivalIsActual: d.arrivalIsActual,
      departureOverride: d.departureOverride ? new Date(d.departureOverride) : null,
    }));
    const s = sellDeals
      .filter((d) => Boolean(d.dischargePort))
      .map<VoyageDealInput>((d) => ({
        id: d.id,
        direction: "sell",
        port: d.dischargePort!,
        quantityMt: parseFloat(d.quantityMt) || 0,
        arrivalAt: d.arrivalAt ? new Date(d.arrivalAt) : null,
        arrivalIsActual: d.arrivalIsActual,
        departureOverride: d.departureOverride ? new Date(d.departureOverride) : null,
      }));
    return {
      buyInputs: b,
      sellInputs: s,
      primaryLoadport: b[0]?.port ?? null,
      primaryDischport: s[s.length - 1]?.port ?? null,
    };
  }, [buyDeals, sellDeals]);

  // Fetch the total NM between primary load and primary disch. Single shot per
  // pair; cached via fetch's force-cache so re-renders don't re-hit the API.
  const [totalDistanceNm, setTotalDistanceNm] = useState<number | null>(null);
  useEffect(() => {
    if (!primaryLoadport || !primaryDischport) {
      setTotalDistanceNm(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/maritime/sea-distance?from=${encodeURIComponent(primaryLoadport)}&to=${encodeURIComponent(primaryDischport)}`,
      { cache: "force-cache" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const nm =
          typeof data?.totalNm === "number"
            ? data.totalNm
            : typeof data?.distanceNm === "number"
              ? data.distanceNm
              : null;
        setTotalDistanceNm(nm);
      })
      .catch(() => {
        if (!cancelled) setTotalDistanceNm(null);
      });
    return () => {
      cancelled = true;
    };
    // Track only port identity — recompute key avoids repeated fetches when a
    // sibling field re-renders the wrapper.
  }, [primaryLoadport, primaryDischport]);

  const distanceCache = useMemo(() => {
    const m = new Map<string, number | null>();
    if (primaryLoadport && primaryDischport && totalDistanceNm != null) {
      m.set(keyForPair(primaryLoadport, primaryDischport), totalDistanceNm);
    }
    return m;
  }, [primaryLoadport, primaryDischport, totalDistanceNm]);

  const stops = useMemo(
    () =>
      resolveVoyageTimeline({
        buyDeals: buyInputs,
        sellDeals: sellInputs,
        cpSpeedKn: speedKn,
        getDistanceNm: (a, b) => distanceCache.get(keyForPair(a, b)) ?? null,
      }),
    [buyInputs, sellInputs, speedKn, distanceCache],
  );

  const state = useMemo(
    () => deriveVoyageStateWithGlobalProgress(stops, new Date(nowTick)),
    [stops, nowTick],
  );

  const isCompleted = linkageStatus === "completed";

  const [marking, setMarking] = useState(false);
  const toggleCompleted = async () => {
    if (!canEdit || marking) return;
    setMarking(true);
    try {
      const r = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isCompleted ? "active" : "completed" }),
      });
      if (r.ok) onUpdated();
    } finally {
      setMarking(false);
    }
  };

  if (stops.length === 0) return null;

  // Disport laycan end → drives SPEED NEEDED + LAYCAN MARGIN math. Prefer
  // the sell-side window (the disport's contractual discharge cutoff);
  // fall back to the buy-side or the dummy first laycan if no sell exists.
  const laycanEnd = (() => {
    const candidates = sellDeals.length > 0 ? sellDeals : buyDeals;
    const ends = candidates.map((d) => d.laycanEnd).filter(Boolean).sort();
    const last = ends[ends.length - 1];
    if (!last) return null;
    // Treat the laycan end as end-of-day UTC — the operator gives a date,
    // not a time. Same convention as the resolver elsewhere.
    return new Date(`${last}T23:59:59Z`);
  })();

  const header = {
    voyageRef: linkageNumber || linkageTempName,
    vesselName: formatVesselName(vesselName),
    productLabel: formatProductLabel(buyDeals),
    laycanRange: formatLaycanRange(buyDeals),
    cpSpeedKn: speedKn,
    totalDistanceNm: totalDistanceNm ?? 0,
    laycanEnd,
  };

  // Override the derived state phase when the operator has manually marked
  // the voyage completed — that wins as an archive flag regardless of where
  // the timeline math thinks the vessel is.
  const effectiveState = isCompleted
    ? { ...state, phase: "completed" as const, globalProgress: 1, label: "Completed" }
    : state;

  // Per-port save: the popover passes us the dealId from stop.dealIds[0]
  // and a partial PortSavePayload; we look the version up from buyDeals/
  // sellDeals (kept fresh by the parent's fetchData ticking after onUpdated).
  const dealVersionMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of [...buyDeals, ...sellDeals]) m.set(d.id, d.version);
    return m;
  }, [buyDeals, sellDeals]);

  const handleSavePort = useCallback(
    async (dealId: string, payload: PortSavePayload) => {
      const version = dealVersionMap.get(dealId);
      if (version === undefined) return;
      const r = await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, version }),
      });
      if (r.ok) {
        onUpdated();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("deal:updated", { detail: { dealId } }));
        }
      }
    },
    [dealVersionMap, onUpdated],
  );

  const handleChangeCpSpeed = useCallback(
    async (knots: number) => {
      const r = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpSpeedKn: knots, cpSpeedSource: "manual" }),
      });
      if (r.ok) onUpdated();
    },
    [linkageId, onUpdated],
  );

  return (
    <VoyageSchematicBar
      header={header}
      stops={stops}
      state={effectiveState}
      formatInPortTime={formatInPortTime}
      onSavePort={handleSavePort}
      onChangeCpSpeed={handleChangeCpSpeed}
      canEdit={canEdit}
      headerActionSlot={
        canEdit ? (
          <button
            type="button"
            onClick={toggleCompleted}
            disabled={marking}
            className={`flex items-center gap-1 font-mono text-[10px] tracking-[0.2em] uppercase border px-3 py-1.5 transition-colors ${
              isCompleted
                ? "border-[var(--color-border-subtle)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-tertiary)] hover:border-emerald-500/60 hover:text-emerald-400"
            }`}
            title={isCompleted ? "Reopen voyage" : "Archive this voyage"}
          >
            {isCompleted ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            {marking ? "Saving…" : isCompleted ? "Reopen" : "Mark completed"}
          </button>
        ) : null
      }
    />
  );
}
