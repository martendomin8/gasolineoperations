"use client";

/**
 * /fleet — Fleet Map showing vessel positions on a dark world map.
 *
 * Phase 1 (prototype): Mock positions computed from deal loadport/dischargePort
 * and linkage status. No real AIS data yet.
 *
 * Phase 2: Integrate aisstream.io (free) or MarineTraffic API (enterprise).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Ship, X, ExternalLink, MapPin, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildLinkageCards } from "@/app/(authenticated)/dashboard/page";
import { findPortCoordinates } from "@/lib/geo/ports";
import { computeMockPosition } from "@/lib/geo/mock-positions";
import type { FleetVessel } from "./fleet-map";

// Dynamic import with SSR disabled — Leaflet requires `window`
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

// ── Types matching dashboard interfaces ──────────────────────

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

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  loading: "Loading",
  sailing: "Sailing",
  discharging: "Discharging",
  completed: "Completed",
};

// ── Page ─────────────────────────────────────────────────────

export default function FleetPage() {
  const router = useRouter();
  const [linkageRows, setLinkageRows] = useState<LinkageRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    const t = Date.now();
    Promise.all([
      fetch(`/api/linkages?status=ongoing&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<LinkageRow[]>) : []
      ),
      fetch(`/api/deals?perPage=200&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<{ items: DealItem[] }>) : { items: [] }
      ),
    ])
      .then(([lr, dd]) => {
        setLinkageRows(lr as LinkageRow[]);
        setAllDeals(
          ((dd as { items: DealItem[] }).items ?? []).filter(
            (d) => d.status !== "completed" && d.status !== "cancelled"
          )
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build linkage cards using the same function as the dashboard
  const cards = buildLinkageCards(linkageRows as any, allDeals as any);

  // Apply operator filter
  const filteredCards = operatorFilter
    ? cards.filter((c) => !c.assignedOperatorId || c.assignedOperatorId === operatorFilter)
    : cards;

  // Build FleetVessel array from cards
  const vessels: FleetVessel[] = [];
  const unlocated: string[] = [];

  for (const card of filteredCards) {
    if (!card.vessel) continue;

    // Find representative loadport and dischargePort from deals
    const allCardDeals = [...card.buys, ...card.sells];
    const loadport = allCardDeals.find((d) => d.loadport)?.loadport ?? null;
    const dischargePort = allCardDeals.find((d) => d.dischargePort)?.dischargePort ?? null;

    const loadCoords = findPortCoordinates(loadport);
    const dischCoords = findPortCoordinates(dischargePort);

    const position = computeMockPosition(
      card.status,
      card.vessel + card.id,
      loadCoords,
      dischCoords
    );

    if (!position) {
      unlocated.push(card.vessel);
      continue;
    }

    // Get vessel IMO from linkage row
    const linkageRow = linkageRows.find((r) => r.id === card.id);

    // Find the latest laycan end across all deals
    const laycanEnds = allCardDeals
      .map((d) => (d as DealItem).laycanEnd)
      .filter(Boolean)
      .sort();

    vessels.push({
      id: card.id,
      vesselName: card.vessel,
      vesselImo: (linkageRow as LinkageRow)?.vesselImo ?? null,
      linkageCode: card.displayName,
      status: card.status,
      position: { lat: position.lat, lng: position.lng },
      heading: position.heading,
      loadport,
      dischargePort,
      buys: card.buys.map((d) => ({
        counterparty: d.counterparty,
        quantityMt: d.quantityMt,
        product: d.product,
      })),
      sells: card.sells.map((d) => ({
        counterparty: d.counterparty,
        quantityMt: d.quantityMt,
        product: d.product,
      })),
      earliestLaycan: card.earliestLaycan,
      latestLaycanEnd: laycanEnds[laycanEnds.length - 1] ?? null,
      assignedOperatorName: card.assignedOperatorName,
      product: card.product,
    });
  }

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? null;

  // Operator options
  const operatorOptions = Array.from(
    new Map(
      linkageRows
        .filter((r) => r.assignedOperatorId && r.assignedOperatorName)
        .map((r) => [r.assignedOperatorId!, r.assignedOperatorName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Stats
  const statusCounts: Record<string, number> = {};
  for (const v of vessels) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }

  return (
    <div className="flex flex-col -m-6 h-[calc(100vh-1px)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Ship className="h-5 w-5 text-[var(--color-accent)]" />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">Fleet</h1>
            <p className="text-[0.6875rem] text-[var(--color-text-tertiary)]">
              {vessels.length} vessel{vessels.length !== 1 ? "s" : ""}
              {Object.entries(statusCounts).map(([s, c]) => (
                <span key={s} className="ml-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5" style={{ backgroundColor: STATUS_COLORS[s] ?? "#6B7280" }} />
                  {c} {STATUS_LABELS[s] ?? s}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {unlocated.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-[0.6875rem] font-medium" title={`Cannot resolve port coordinates for: ${unlocated.join(", ")}`}>
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

      {/* Map */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="flex items-center justify-center h-full bg-[var(--color-surface-0)]">
            <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : (
          <FleetMapInner
            vessels={vessels}
            selectedVesselId={selectedVesselId}
            onSelectVessel={setSelectedVesselId}
          />
        )}

        {/* Vessel info card */}
        {selectedVessel && (
          <div className="absolute bottom-5 left-5 z-[1000] w-80 bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[var(--color-border-subtle)]">
              <div className="min-w-0">
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
                className="p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Linkage + status */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-subtle)]">
              <span className="text-xs font-mono font-semibold text-[var(--color-text-primary)]">
                {selectedVessel.linkageCode}
              </span>
              <Badge
                variant={selectedVessel.status as "active" | "loading" | "sailing" | "completed" | "cancelled" | "muted"}
                className="text-[0.6rem]"
              >
                {STATUS_LABELS[selectedVessel.status] ?? selectedVessel.status}
              </Badge>
            </div>

            {/* Deal summary */}
            <div className="px-4 py-2 space-y-1 border-b border-[var(--color-border-subtle)]">
              {selectedVessel.buys.map((d, i) => (
                <div key={`buy-${i}`} className="text-xs text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-info)] font-medium">Buy:</span>{" "}
                  {d.counterparty} — {formatQty(d.quantityMt)} MT {d.product}
                </div>
              ))}
              {selectedVessel.sells.map((d, i) => (
                <div key={`sell-${i}`} className="text-xs text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-accent-text)] font-medium">Sell:</span>{" "}
                  {d.counterparty} — {formatQty(d.quantityMt)} MT {d.product}
                </div>
              ))}
              {selectedVessel.buys.length === 0 && selectedVessel.sells.length === 0 && (
                <div className="text-xs text-[var(--color-text-tertiary)] italic">No deals</div>
              )}
            </div>

            {/* Route + Laycan */}
            <div className="px-4 py-2 space-y-1.5 border-b border-[var(--color-border-subtle)]">
              {(selectedVessel.loadport || selectedVessel.dischargePort) && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                  <MapPin className="h-3 w-3 text-[var(--color-text-tertiary)]" />
                  <span>{selectedVessel.loadport ?? "?"}</span>
                  <span className="text-[var(--color-text-tertiary)]">&rarr;</span>
                  <span>{selectedVessel.dischargePort ?? "?"}</span>
                </div>
              )}
              {selectedVessel.earliestLaycan && selectedVessel.latestLaycanEnd && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-tertiary)]">
                    Laycan: {new Date(selectedVessel.earliestLaycan).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    {" — "}
                    {new Date(selectedVessel.latestLaycanEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </span>
                  {(() => {
                    const days = daysUntil(selectedVessel.earliestLaycan);
                    if (days < 0) return null;
                    const isUrgent = days <= 3;
                    return (
                      <span className={`font-bold ${isUrgent ? "text-[var(--color-danger)]" : "text-[var(--color-text-tertiary)]"}`}>
                        {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}d`}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Operator + Action */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[0.6875rem] text-[var(--color-text-tertiary)]">
                {selectedVessel.assignedOperatorName ?? "Unassigned"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/linkages/${selectedVessel.id}`)}
              >
                <ExternalLink className="h-3 w-3" />
                Open Linkage
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Status colors for the header stats (duplicated from fleet-map for the header dots)
const STATUS_COLORS: Record<string, string> = {
  active: "#3b82f6",
  loading: "#e5983e",
  sailing: "#6366f1",
  discharging: "#a855f7",
  completed: "#22c55e",
};
