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

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Ship, X, ExternalLink, MapPin, AlertTriangle, Anchor, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildLinkageCards } from "@/app/(authenticated)/dashboard/page";
import { findPortCoordinates } from "@/lib/geo/ports";
import { computeMockPosition } from "@/lib/geo/mock-positions";
import { STATUS_COLORS, STATUS_LABELS } from "./fleet-map";
import type { FleetVessel } from "./fleet-map";

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

  // Port markers from parties (terminals, agents, inspectors, brokers)
  const [portMarkers, setPortMarkers] = useState<Array<{ name: string; port: string; type: string; lat: number; lng: number }>>([]);

  const fetchData = useCallback(() => {
    const t = Date.now();
    Promise.all([
      fetch(`/api/linkages?status=ongoing&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<LinkageRow[]>) : []
      ),
      fetch(`/api/deals?perPage=200&_t=${t}`, { cache: "no-store" }).then((r) =>
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

    const position = computeMockPosition(card.status, card.vessel + card.id, loadCoords, dischCoords);
    if (!position) { unlocated.push(card.vessel); continue; }

    const linkageRow = linkageRows.find((r) => r.id === card.id);
    const laycanEnds = allCardDeals.map((d) => (d as DealItem).laycanEnd).filter(Boolean).sort();

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

  // Stats — computed before demo injection so demo vessels also count
  const statusCounts: Record<string, number> = {};

  // Inject demo fleet for prototype — but match against real linkages by
  // vessel name so "Open Linkage" navigates to the actual DB linkage, not
  // a fake "demo-X" ID. Skip any demo vessel that already resolved from
  // real data (prevents duplicates).
  if (!loading) {
    const realVesselNames = new Set(vessels.map((v) => v.vesselName.toLowerCase()));

    // Build a lookup: vessel name → real linkage ID from the API data
    const vesselToLinkage = new Map<string, { id: string; code: string }>();
    for (const row of linkageRows) {
      if (row.vesselName) {
        vesselToLinkage.set(row.vesselName.toLowerCase(), {
          id: row.id,
          code: row.linkageNumber ?? row.tempName ?? "—",
        });
      }
    }

    const demoFleet: Array<Omit<FleetVessel, "id" | "linkageCode">> = [
      { vesselName: "MT Hafnia Polar", vesselImo: "9786543", status: "sailing", position: { lat: 39.5, lng: 3.2 }, heading: 225, loadport: "Lavera", dischargePort: "Barcelona", buys: [{ counterparty: "SOCAR", quantityMt: "37000", product: "Reformate" }], sells: [{ counterparty: "Shell", quantityMt: "30000", product: "EBOB" }], earliestLaycan: "2026-04-18", latestLaycanEnd: "2026-04-20", assignedOperatorName: "AT", product: "Reformate", isUrgent: true, etaHours: 18 },
      { vesselName: "MT West Africa Star", vesselImo: "9654321", status: "loading", position: { lat: 43.39, lng: 4.98 }, heading: 180, loadport: "Lavera", dischargePort: "New York", buys: [{ counterparty: "Total Energies", quantityMt: "7000", product: "Gasoline" }], sells: [], earliestLaycan: "2026-04-04", latestLaycanEnd: "2026-04-06", assignedOperatorName: "KK", product: "Gasoline", isUrgent: false, etaHours: null },
      { vesselName: "MT Nordic Breeze", vesselImo: "9812345", status: "sailing", position: { lat: 48.2, lng: -12.5 }, heading: 260, loadport: "Antwerp", dischargePort: "Houston", buys: [{ counterparty: "Holborn", quantityMt: "11438", product: "Gasoline" }], sells: [{ counterparty: "NNPC", quantityMt: "11438", product: "Gasoline" }], earliestLaycan: "2026-04-20", latestLaycanEnd: "2026-04-25", assignedOperatorName: "MK", product: "Gasoline", isUrgent: false, etaHours: 192 },
      { vesselName: "MT Besiktas Canakkale", vesselImo: "9543211", status: "active", position: { lat: 51.96, lng: 4.05 }, heading: 90, loadport: "Rotterdam", dischargePort: "Thessaloniki", buys: [{ counterparty: "Vitol", quantityMt: "25000", product: "EBOB" }], sells: [{ counterparty: "Repsol", quantityMt: "25000", product: "EBOB" }], earliestLaycan: "2026-04-22", latestLaycanEnd: "2026-04-24", assignedOperatorName: "AT", product: "EBOB", isUrgent: false, etaHours: null },
      { vesselName: "MT Nordic Ruth", vesselImo: "9234567", status: "discharging", position: { lat: 41.36, lng: 2.17 }, heading: 0, loadport: "Amsterdam", dischargePort: "Barcelona", buys: [], sells: [{ counterparty: "Cepsa", quantityMt: "15000", product: "Gasoline" }], earliestLaycan: "2026-04-15", latestLaycanEnd: "2026-04-17", assignedOperatorName: "KK", product: "Gasoline", isUrgent: true, etaHours: null },
      { vesselName: "MT Ardmore Seatrader", vesselImo: "9678901", status: "sailing", position: { lat: 36.8, lng: 14.5 }, heading: 135, loadport: "Lavera", dischargePort: "Augusta", buys: [{ counterparty: "Litasco", quantityMt: "12000", product: "Naphtha" }], sells: [{ counterparty: "Saras", quantityMt: "12000", product: "Naphtha" }], earliestLaycan: "2026-04-25", latestLaycanEnd: "2026-04-27", assignedOperatorName: "MK", product: "Naphtha", isUrgent: false, etaHours: 42 },
    ];

    for (const d of demoFleet) {
      // Skip if this vessel already resolved from real API data
      if (realVesselNames.has(d.vesselName.toLowerCase())) continue;

      // Try to match to a real linkage by vessel name
      const match = vesselToLinkage.get(d.vesselName.toLowerCase());
      const id = match?.id ?? `demo-${d.vesselName.replace(/\s+/g, "-").toLowerCase()}`;
      const linkageCode = match?.code ?? d.vesselName;

      vessels.push({ ...d, id, linkageCode } as FleetVessel);
      statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
    }
  }

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? null;

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
            />
          )}
        </div>

        {/* Right-side detail panel */}
        <div className={`
          flex-shrink-0 bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)]
          transition-all duration-300 overflow-hidden
          ${selectedVessel ? "w-80" : "w-0"}
        `}>
          {selectedVessel && (
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
