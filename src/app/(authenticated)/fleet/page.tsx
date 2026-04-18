"use client";

/**
 * /fleet — Fleet Map showing vessel positions on a dark world map.
 *
 * Design critique improvements:
 * - Right-side detail panel instead of floating bottom-left card
 * - Route polylines from loadport → dischargePort
 * - Filled markers with glow halos + pulse for urgent vessels
 * - Permanent vessel name labels
 * - On-map status legend
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Ship, X, ExternalLink, MapPin, AlertTriangle, Anchor, ArrowRight, Route, Trash2, GripVertical, Plus, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildLinkageCards } from "@/app/(authenticated)/dashboard/page";
import { findPortCoordinates } from "@/lib/geo/ports";
import { computeMockPosition } from "@/lib/geo/mock-positions";
import { findPort, getSeaRoutePath, getSeaDistance } from "@/lib/sea-distance";
import { STATUS_COLORS, STATUS_LABELS } from "./fleet-map";
import type { FleetVessel, PlannerRouteLeg } from "./fleet-map";

// Dynamic import — Leaflet requires `window`
const FleetMapInner = dynamic(
  () => import("./fleet-map").then((m) => m.FleetMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-surface-0)]">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    ),
  }
);

// ── Types ────────────────────────────────────────────────────

interface DealItem {
  id: string;
  linkageCode: string | null;
  linkageId: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
  nominatedQty: string | null;
  incoterm: string;
  loadport: string;
  dischargePort: string | null;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: string;
  dealType: string;
  sortOrder: number;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string | null;
  externalRef: string | null;
}

interface LinkageRow {
  id: string;
  linkageNumber: string | null;
  tempName: string | null;
  status: string;
  dealCount: number;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  secondaryOperatorId: string | null;
  secondaryOperatorName: string | null;
  vesselName?: string | null;
  vesselImo?: string | null;
}

// ── Geo helpers ──────────────────────────────────────────────

/** Haversine distance in nautical miles */
function distanceNM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const TANKER_SPEED_KN = 13; // typical MR tanker cruising speed

// ── Helpers ──────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatQty(qty: string): string {
  const num = parseFloat(qty.replace(/,/g, ""));
  if (isNaN(num)) return qty;
  return num >= 1000 ? `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k` : `${num}`;
}

// ── Page ─────────────────────────────────────────────────────

export default function FleetPage() {
  const router = useRouter();
  const [linkageRows, setLinkageRows] = useState<LinkageRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);

  // Planner Mode state
  const [plannerMode, setPlannerMode] = useState(false);
  const [plannerPorts, setPlannerPorts] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [plannerSearch, setPlannerSearch] = useState("");
  const [plannerResults, setPlannerResults] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [plannerSpeed, setPlannerSpeed] = useState(12);
  const [plannerDistance, setPlannerDistance] = useState<{
    totalNm: number;
    legs: Array<{ from: string; to: string; distanceNm: number }>;
    etaDays: number;
    etaDisplay: string;
  } | null>(null);
  const [plannerSearching, setPlannerSearching] = useState(false);
  const [plannerRouteLegs, setPlannerRouteLegs] = useState<PlannerRouteLeg[]>([]);

  // Port markers from parties (terminals, agents, inspectors, brokers)
  const [portMarkers, setPortMarkers] = useState<Array<{ name: string; port: string; type: string; lat: number; lng: number }>>([]);

  const fetchData = useCallback(() => {
    const t = Date.now();
    Promise.all([
      fetch(`/api/linkages?status=ongoing&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<LinkageRow[]>) : []
      ),
      fetch(`/api/deals?perPage=100&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<{ items: DealItem[] }>) : { items: [] }
      ),
      fetch(`/api/parties?_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([lr, dd, partiesData]) => {
        setLinkageRows(lr as LinkageRow[]);
        setAllDeals(
          ((dd as { items: DealItem[] }).items ?? []).filter(
            (d) => d.status !== "completed" && d.status !== "cancelled"
          )
        );
        // Resolve party ports to coordinates
        const rawParties: Array<{ name: string; port: string | null; type: string }> =
          Array.isArray(partiesData) ? partiesData : [...(partiesData.matched ?? []), ...(partiesData.rest ?? [])];
        const resolved: typeof portMarkers = [];
        const seen = new Set<string>();
        for (const p of rawParties) {
          if (!p.port) continue;
          const key = p.port.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const coords = findPortCoordinates(p.port);
          if (coords) {
            resolved.push({ name: p.name, port: p.port, type: p.type, lat: coords.lat, lng: coords.lng });
          }
        }
        setPortMarkers(resolved);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Planner: search ports as user types
  useEffect(() => {
    if (!plannerSearch.trim() || plannerSearch.length < 2) {
      setPlannerResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setPlannerSearching(true);
      fetch(`/api/sea-distance?search=${encodeURIComponent(plannerSearch)}`)
        .then((r) => r.json())
        .then((data: { ports: Array<{ name: string; lat: number; lon: number }> }) => {
          setPlannerResults(data.ports ?? []);
        })
        .finally(() => setPlannerSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [plannerSearch]);

  // Planner: recalculate distance whenever ports or speed change
  useEffect(() => {
    if (plannerPorts.length < 2) {
      setPlannerDistance(null);
      setPlannerRouteLegs([]);
      return;
    }
    const portNames = plannerPorts.map((p) => p.name).join("|");

    // Fetch distance + route polyline in parallel
    Promise.all([
      fetch(`/api/sea-distance?ports=${encodeURIComponent(portNames)}&speed=${plannerSpeed}`)
        .then((r) => r.json()),
      fetch(`/api/sea-distance/route-line?ports=${encodeURIComponent(portNames)}`)
        .then((r) => r.json()),
    ]).then(([distData, routeData]) => {
      setPlannerDistance({
        totalNm: distData.totalNm ?? 0,
        legs: distData.legs ?? [],
        etaDays: distData.etaDays ?? 0,
        etaDisplay: distData.etaDisplay ?? "—",
      });
      setPlannerRouteLegs(routeData.legs ?? []);
    });
  }, [plannerPorts, plannerSpeed]);

  const cards = buildLinkageCards(linkageRows as any, allDeals as any);

  const filteredCards = operatorFilter
    ? cards.filter((c) => !c.assignedOperatorId || c.assignedOperatorId === operatorFilter)
    : cards;

  // Build FleetVessel array
  const vessels: FleetVessel[] = [];
  const unlocated: string[] = [];

  for (const card of filteredCards) {
    if (!card.vessel) continue;

    const allCardDeals = [...card.buys, ...card.sells];
    const loadport = allCardDeals.find((d) => d.loadport)?.loadport ?? null;
    const dischargePort = allCardDeals.find((d) => d.dischargePort)?.dischargePort ?? null;
    const loadCoords = findPortCoordinates(loadport);
    const dischCoords = findPortCoordinates(dischargePort);

    // Look up the pre-computed ocean route + distance for time-based
    // sailing interpolation along the real route geometry.
    let routePath: [number, number][] | null = null;
    let totalDistanceNm: number | null = null;
    if (loadport && dischargePort) {
      const fromCanon = findPort(loadport);
      const toCanon = findPort(dischargePort);
      if (fromCanon && toCanon) {
        routePath = getSeaRoutePath(fromCanon, toCanon);
        const dist = getSeaDistance(fromCanon, toCanon);
        totalDistanceNm = dist.totalNm > 0 ? dist.totalNm : null;
      }
    }

    // Departure date estimate = latest laycan_end across the card's deals.
    const laycanEnds = allCardDeals.map((d) => (d as DealItem).laycanEnd).filter(Boolean).sort();
    const estimatedDeparture = laycanEnds[laycanEnds.length - 1] ?? null;

    const position = computeMockPosition(
      card.status,
      card.vessel + card.id,
      loadCoords,
      dischCoords,
      routePath,
      estimatedDeparture,
      totalDistanceNm,
    );
    if (!position) { unlocated.push(card.vessel); continue; }

    const linkageRow = linkageRows.find((r) => r.id === card.id);

    // Urgency: laycan ≤3 days
    const isUrgent = card.earliestLaycan ? daysUntil(card.earliestLaycan) >= 0 && daysUntil(card.earliestLaycan) <= 3 : false;

    vessels.push({
      id: card.id,
      vesselName: card.vessel,
      vesselImo: (linkageRow as LinkageRow)?.vesselImo ?? null,
      linkageCode: card.displayName,
      status: card.status,
      position: { lat: position.lat, lng: position.lng },
      heading: position.heading,
      loadport, dischargePort,
      buys: card.buys.map((d) => ({ counterparty: d.counterparty, quantityMt: d.quantityMt, product: d.product })),
      sells: card.sells.map((d) => ({ counterparty: d.counterparty, quantityMt: d.quantityMt, product: d.product })),
      earliestLaycan: card.earliestLaycan,
      latestLaycanEnd: laycanEnds[laycanEnds.length - 1] ?? null,
      assignedOperatorName: card.assignedOperatorName,
      product: card.product,
      isUrgent,
      etaHours: (card.status === "sailing" && dischCoords)
        ? Math.round(distanceNM(position.lat, position.lng, dischCoords.lat, dischCoords.lng) / TANKER_SPEED_KN)
        : null,
    });
  }

  // Stats for status counts — populated from real vessels below
  const statusCounts: Record<string, number> = {};
  for (const v of vessels) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }

  // Demo vessels were removed. Fleet now reflects only real linkages that
  // have a vessel attached (linkage.vessel_name). For position we use
  // computeMockPosition with the pre-computed ocean route + laycan dates,
  // which places sailing vessels on their actual route (not a straight
  // line through land) at time-based progress from laycan_end. When real
  // AIS integration (Marine Traffic clone) lands, that becomes the source
  // of truth and this estimate becomes a fallback for missing broadcasts.

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? null;

  // When a vessel is selected, auto-populate planner with its ports
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedVesselId || selectedVesselId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedVesselId;

    const v = vessels.find((vv) => vv.id === selectedVesselId);
    if (!v) return;

    // Collect unique ports: loadport → discharge ports
    const ports: string[] = [];
    if (v.loadport) ports.push(v.loadport);
    if (v.dischargePort && v.dischargePort !== v.loadport) ports.push(v.dischargePort);

    // Also look for additional discharge ports from other sell deals in the same linkage.
    // Sorted by sortOrder so the fleet planner shows ports in the operator's chosen sequence.
    const linkageDeals = allDeals
      .filter((d) => d.linkageId === v.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const d of linkageDeals) {
      if (d.dischargePort && !ports.includes(d.dischargePort)) {
        ports.push(d.dischargePort);
      }
    }

    if (ports.length === 0) {
      // No ports — open planner empty (user can add manually)
      setPlannerMode(true);
      return;
    }

    // Resolve port names via search API and populate planner
    Promise.all(
      ports.map((p) =>
        fetch(`/api/sea-distance?search=${encodeURIComponent(p)}`)
          .then((r) => r.json())
          .then((data: { ports: Array<{ name: string; lat: number; lon: number }> }) => {
            const match = data.ports?.[0];
            return match ?? { name: p, lat: 0, lon: 0 };
          })
          .catch(() => ({ name: p, lat: 0, lon: 0 }))
      )
    ).then((resolved) => {
      setPlannerPorts(resolved);
      setPlannerMode(true);
    });
  }, [selectedVesselId, vessels, allDeals]);

  const operatorOptions = Array.from(
    new Map(
      linkageRows
        .filter((r) => r.assignedOperatorId && r.assignedOperatorName)
        .map((r) => [r.assignedOperatorId!, r.assignedOperatorName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Finalize stats from all vessels (real + demo)
  const urgentCount = vessels.filter((v) => v.isUrgent).length;
  for (const v of vessels) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }

  return (
    <div className="flex flex-col -m-6" style={{ height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] flex-shrink-0 z-[1100] relative">
        <div className="flex items-center gap-3">
          <Ship className="h-5 w-5 text-[var(--color-accent)]" />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">Fleet</h1>
            <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--color-text-tertiary)]">
              <span>{vessels.length} vessel{vessels.length !== 1 ? "s" : ""}</span>
              {Object.entries(statusCounts).map(([s, c]) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] ?? "#6B7280", boxShadow: `0 0 4px ${STATUS_COLORS[s] ?? "#6B7280"}60` }} />
                  <span>{c} {STATUS_LABELS[s] ?? s}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setPlannerMode(!plannerMode);
              if (!plannerMode) setSelectedVesselId(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors cursor-pointer ${
              plannerMode
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            <Route className="h-3.5 w-3.5" />
            Planner
          </button>
          {urgentCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-[0.6875rem] font-semibold animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              {urgentCount} laycan critical
            </div>
          )}
          {unlocated.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-[0.6875rem] font-medium" title={unlocated.join(", ")}>
              <AlertTriangle className="h-3 w-3" />
              {unlocated.length} unlocated
            </div>
          )}
          {operatorOptions.length > 0 && (
            <select
              value={operatorFilter ?? ""}
              onChange={(e) => setOperatorFilter(e.target.value || null)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] outline-none cursor-pointer"
            >
              <option value="">All operators</option>
              {operatorOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Map + Side Panel */}
      <div className="flex-1 flex relative">
        {/* Map */}
        <div className={`flex-1 transition-all duration-300 ${selectedVessel ? "" : ""}`}>
          {loading ? (
            <div className="flex items-center justify-center h-full bg-[var(--color-surface-0)]">
              <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
            </div>
          ) : (
            <FleetMapInner
              vessels={vessels}
              portMarkers={portMarkers}
              selectedVesselId={selectedVesselId}
              onSelectVessel={setSelectedVesselId}
              plannerRouteLegs={plannerRouteLegs}
              plannerWaypoints={plannerPorts}
            />
          )}
        </div>

        {/* Right-side Planner panel */}
        <div className={`
          flex-shrink-0 bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)]
          transition-all duration-300 overflow-hidden
          ${plannerMode ? "w-80" : "w-0"}
        `}>
          {plannerMode && (
            <div className="w-80 h-full overflow-y-auto">
              {/* Planner header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-bold text-[var(--color-text-primary)]">
                    Distance Planner
                  </span>
                </div>
                <button
                  onClick={() => setPlannerMode(false)}
                  className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Port search */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search port..."
                    value={plannerSearch}
                    onChange={(e) => setPlannerSearch(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-cyan-500/50"
                  />
                  {plannerSearching && (
                    <div className="absolute right-2 top-2">
                      <div className="h-4 w-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    </div>
                  )}
                </div>
                {plannerResults.length > 0 && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-2)]">
                    {plannerResults.map((port) => (
                      <button
                        key={port.name}
                        onClick={() => {
                          setPlannerPorts((prev) => [...prev, port]);
                          setPlannerSearch("");
                          setPlannerResults([]);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                      >
                        <Plus className="h-3 w-3 inline mr-1.5 text-cyan-400" />
                        {port.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Waypoint list */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                  Waypoints ({plannerPorts.length})
                </div>
                {plannerPorts.length === 0 ? (
                  <div className="text-xs text-[var(--color-text-tertiary)] italic py-4 text-center">
                    Search and add ports above
                  </div>
                ) : (
                  <div className="space-y-1">
                    {plannerPorts.map((port, idx) => (
                      <div
                        key={`${port.name}-${idx}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] group"
                      >
                        <GripVertical className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 text-[0.6rem] font-bold flex items-center justify-center flex-shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-xs text-[var(--color-text-primary)] truncate">
                            {port.name.split(",")[0]}
                          </span>
                        </div>
                        {/* Leg distance */}
                        {plannerDistance && idx > 0 && plannerDistance.legs[idx - 1] && (
                          <span className="text-[0.6rem] font-mono text-[var(--color-text-tertiary)] flex-shrink-0">
                            {plannerDistance.legs[idx - 1].distanceNm.toLocaleString()} NM
                          </span>
                        )}
                        <button
                          onClick={() => setPlannerPorts((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-0.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Speed input */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <label className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                  Speed (knots)
                  <input
                    type="number"
                    min={1}
                    max={25}
                    step={0.5}
                    value={plannerSpeed}
                    onChange={(e) => setPlannerSpeed(Number(e.target.value) || 12)}
                    className="mt-1 w-full px-3 py-1.5 text-sm font-mono font-bold rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-cyan-500/50"
                  />
                </label>
              </div>

              {/* Results */}
              {plannerDistance && plannerPorts.length >= 2 && (
                <div className="px-4 py-4">
                  <div className="rounded-[var(--radius-md)] border border-cyan-500/30 bg-cyan-500/5 p-4">
                    {/* ETA — primary info */}
                    <div className="text-2xl font-mono font-bold text-[var(--color-text-primary)]">
                      {plannerDistance.etaDisplay}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-tertiary)]">
                      <span>@ {plannerSpeed} kn</span>
                      <span className="text-[var(--color-border-default)]">|</span>
                      <span className="font-mono">{plannerDistance.totalNm.toLocaleString()} NM</span>
                    </div>
                    {/* Leg breakdown */}
                    {plannerDistance.legs.length > 1 && (
                      <div className="mt-3 pt-3 border-t border-cyan-500/20 space-y-1">
                        {plannerDistance.legs.map((leg, i) => {
                          const legEtaDays = plannerSpeed > 0 ? leg.distanceNm / (plannerSpeed * 24) : 0;
                          const legD = Math.floor(legEtaDays);
                          const legH = Math.round((legEtaDays - legD) * 24);
                          const legEta = legD > 0 ? `${legD}d ${legH}h` : `${legH}h`;
                          return (
                            <div key={i} className="flex items-center gap-1.5 text-[0.65rem] text-[var(--color-text-tertiary)]">
                              <ChevronRight className="h-3 w-3 text-cyan-500/50" />
                              <span className="truncate">{leg.from.split(",")[0]}</span>
                              <span className="text-cyan-500/50">&rarr;</span>
                              <span className="truncate">{leg.to.split(",")[0]}</span>
                              <span className="ml-auto font-mono">{legEta}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Clear all */}
              {plannerPorts.length > 0 && (
                <div className="px-4 pb-4">
                  <button
                    onClick={() => {
                      setPlannerPorts([]);
                      setPlannerDistance(null);
                      setPlannerRouteLegs([]);
                    }}
                    className="w-full px-3 py-2 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--color-border-default)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right-side detail panel */}
        <div className={`
          flex-shrink-0 bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)]
          transition-all duration-300 overflow-hidden
          ${!plannerMode && selectedVessel ? "w-80" : "w-0"}
        `}>
          {!plannerMode && selectedVessel && (
            <div className="w-80 h-full overflow-y-auto">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[var(--color-text-primary)] truncate">
                    {selectedVessel.vesselName}
                  </div>
                  {selectedVessel.vesselImo && (
                    <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)]">
                      IMO {selectedVessel.vesselImo}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedVesselId(null)}
                  className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status + Linkage */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-[var(--color-accent-text)] tracking-wide">
                    {selectedVessel.linkageCode}
                  </span>
                  <Badge
                    variant={selectedVessel.status as any}
                    className="text-[0.625rem]"
                  >
                    {STATUS_LABELS[selectedVessel.status] ?? selectedVessel.status}
                  </Badge>
                </div>
                {selectedVessel.product && (
                  <div className="text-xs text-[var(--color-text-tertiary)]">{selectedVessel.product}</div>
                )}
              </div>

              {/* Route visualization */}
              {(selectedVessel.loadport || selectedVessel.dischargePort) && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Route</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Anchor className="h-3 w-3 text-[var(--color-info)]" />
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">
                          {selectedVessel.loadport ?? "TBD"}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">
                          {selectedVessel.dischargePort ?? "TBD"}
                        </span>
                        <MapPin className="h-3 w-3 text-[var(--color-accent-text)]" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ETA to destination */}
              {selectedVessel.etaHours != null && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">ETA to Destination</div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-bold text-[var(--color-text-primary)]">
                      {selectedVessel.etaHours < 24
                        ? `${selectedVessel.etaHours}h`
                        : `${Math.floor(selectedVessel.etaHours / 24)}d ${selectedVessel.etaHours % 24}h`}
                    </span>
                    <span className="text-[0.625rem] text-[var(--color-text-tertiary)]">
                      ~{Math.round(selectedVessel.etaHours * TANKER_SPEED_KN)} NM remaining
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(5, Math.min(95, 100 - (selectedVessel.etaHours / 240) * 100))}%`,
                        backgroundColor: STATUS_COLORS[selectedVessel.status] ?? "#6B7280",
                      }}
                    />
                  </div>
                </div>
              )}
              {selectedVessel.status !== "sailing" && selectedVessel.etaHours == null && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">ETA</div>
                  <span className="text-xs text-[var(--color-text-tertiary)] italic">
                    {selectedVessel.status === "loading" ? "At loadport — awaiting departure" :
                     selectedVessel.status === "discharging" ? "At discharge port" :
                     selectedVessel.status === "active" ? "Vessel not yet sailing" : "—"}
                  </span>
                </div>
              )}

              {/* Laycan */}
              {selectedVessel.earliestLaycan && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Laycan</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                      {new Date(selectedVessel.earliestLaycan).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      {selectedVessel.latestLaycanEnd && (
                        <> — {new Date(selectedVessel.latestLaycanEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</>
                      )}
                    </span>
                    {(() => {
                      const days = daysUntil(selectedVessel.earliestLaycan);
                      if (days < 0) return <span className="text-[0.625rem] text-[var(--color-text-tertiary)]">passed</span>;
                      const isUrgent = days <= 3;
                      return (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          isUrgent
                            ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                            : "text-[var(--color-text-tertiary)]"
                        }`}>
                          {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}d`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Cargo */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Cargo</div>
                <div className="space-y-1.5">
                  {selectedVessel.buys.map((d, i) => (
                    <div key={`buy-${i}`} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-info)] flex-shrink-0" />
                      <span className="text-[var(--color-text-secondary)]">
                        <span className="font-medium text-[var(--color-text-primary)]">{d.counterparty}</span>
                        {" "}{formatQty(d.quantityMt)} MT {d.product}
                      </span>
                    </div>
                  ))}
                  {selectedVessel.sells.map((d, i) => (
                    <div key={`sell-${i}`} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />
                      <span className="text-[var(--color-text-secondary)]">
                        <span className="font-medium text-[var(--color-text-primary)]">{d.counterparty}</span>
                        {" "}{formatQty(d.quantityMt)} MT {d.product}
                      </span>
                    </div>
                  ))}
                  {selectedVessel.buys.length === 0 && selectedVessel.sells.length === 0 && (
                    <div className="text-xs text-[var(--color-text-tertiary)] italic">No deals attached</div>
                  )}
                </div>
              </div>

              {/* Operator */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">Operator</div>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {selectedVessel.assignedOperatorName ?? "Unassigned"}
                </span>
              </div>

              {/* Action */}
              <div className="px-4 py-4">
                {selectedVessel.id.startsWith("demo-") ? (
                <div className="text-xs text-center text-[var(--color-text-tertiary)] italic py-1">
                  Demo vessel — no linked cargo
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={() => router.push(`/linkages/${selectedVessel.id}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Linkage
                </Button>
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
