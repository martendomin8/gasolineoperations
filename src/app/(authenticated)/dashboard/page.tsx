"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Ship, Plus, Package, Anchor,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface DealItem {
  id: string;
  externalRef: string | null;
  linkageCode: string | null;
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
  pricingType: string | null;
  pricingFormula: string | null;
  operatorName: string | null;
  secondaryOperatorName: string | null;
}

interface Linkage {
  code: string | null;
  vessel: string | null;
  buys: DealItem[];
  sells: DealItem[];
  earliestLaycan: string;
  latestLaycan: string;
  status: string;
  product: string;
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatLaycanShort(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${s.getDate().toString().padStart(2, "0")}-${e.getDate().toString().padStart(2, "0")} ${months[s.getMonth()]}`;
}

function formatOps(deal: DealItem): string {
  const primary = deal.operatorName || "—";
  const secondary = deal.secondaryOperatorName || "";
  return secondary ? `${primary}/${secondary}` : primary;
}

function UrgencyDot({ days }: { days: number }) {
  if (days <= 1) return <span className="h-2 w-2 rounded-full bg-[var(--color-danger)] animate-pulse flex-shrink-0" />;
  if (days <= 3) return <span className="h-2 w-2 rounded-full bg-[var(--color-warning,#c8972e)] flex-shrink-0" />;
  return null;
}

type StatusVariant = "muted" | "active" | "loading" | "sailing" | "accent" | "completed" | "cancelled";

function StatusLabel({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: StatusVariant }> = {
    draft: { label: "Draft", variant: "muted" },
    active: { label: "Active", variant: "active" },
    loading: { label: "Loading", variant: "loading" },
    sailing: { label: "Sailing", variant: "sailing" },
    discharging: { label: "Discharging", variant: "accent" },
    completed: { label: "Completed", variant: "completed" },
    cancelled: { label: "Cancelled", variant: "cancelled" },
  };
  const s = map[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function DealSide({ deal, side }: { deal: DealItem; side: "buy" | "sell" }) {
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="flex flex-col gap-1 p-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-3)] transition-colors group/deal cursor-pointer min-w-0"
    >
      <div className="flex items-center gap-2">
        <Badge variant={side === "buy" ? "info" : "accent"} dot>
          {side === "buy" ? "BUY" : "SELL"}
        </Badge>
        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {deal.counterparty}
        </span>
        <ChevronRight className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-0 group-hover/deal:opacity-100 transition-opacity flex-shrink-0 ml-auto" />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <span className="font-mono">{deal.incoterm}</span>
        <span className="text-[var(--color-text-tertiary)]">&middot;</span>
        <span>{deal.loadport}</span>
        {deal.dischargePort && (
          <>
            <span className="text-[var(--color-text-tertiary)]">&rarr;</span>
            <span>{deal.dischargePort}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
        <span className="font-mono">{formatLaycanShort(deal.laycanStart, deal.laycanEnd)}</span>
        <span>&middot;</span>
        <span>{deal.contractedQty || `${deal.quantityMt} MT`}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
        <span>OPS: {formatOps(deal)}</span>
        {deal.externalRef && (
          <>
            <span>&middot;</span>
            <span className="font-mono">{deal.externalRef}</span>
          </>
        )}
      </div>
    </Link>
  );
}

function LinkageCard({ linkage }: { linkage: Linkage }) {
  const days = daysUntil(linkage.earliestLaycan);
  const isLinked = linkage.buys.length > 0 && linkage.sells.length > 0;

  return (
    <Card padding="none">
      {/* Header: vessel + product + status */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="h-8 w-8 rounded-[var(--radius-md)] bg-[var(--color-surface-3)] flex items-center justify-center flex-shrink-0">
          <Ship className="h-4 w-4 text-[var(--color-text-secondary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <UrgencyDot days={days} />
            <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {linkage.vessel || "TBN"}
            </span>
            <StatusLabel status={linkage.status} />
            {linkage.code && (
              <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] tracking-wide ml-auto flex-shrink-0">
                {linkage.code}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[var(--color-text-secondary)]">{linkage.product}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">&middot;</span>
            <span className="text-xs font-mono text-[var(--color-text-tertiary)]">
              LC {formatLaycanShort(linkage.earliestLaycan, linkage.latestLaycan)}
            </span>
            {days <= 3 && days >= 0 && (
              <>
                <span className="text-xs text-[var(--color-text-tertiary)]">&middot;</span>
                <span className={`text-xs font-bold ${days <= 1 ? "text-[var(--color-danger)]" : "text-[var(--color-warning,#c8972e)]"}`}>
                  {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}d`}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body: buy side | sell side */}
      <div className={`grid ${isLinked ? "grid-cols-2 divide-x divide-[var(--color-border-subtle)]" : "grid-cols-1"}`}>
        {/* BUY side */}
        {linkage.buys.length > 0 && (
          <div className="p-1">
            {linkage.buys.map((d) => (
              <DealSide key={d.id} deal={d} side="buy" />
            ))}
          </div>
        )}

        {/* SELL side */}
        {linkage.sells.length > 0 ? (
          <div className="p-1">
            {linkage.sells.map((d) => (
              <DealSide key={d.id} deal={d} side="sell" />
            ))}
          </div>
        ) : linkage.buys.length > 0 ? (
          <div className="p-1 flex items-center justify-center">
            <div className="text-center py-4 px-2">
              <p className="text-xs text-[var(--color-text-tertiary)] mb-2">No sale linked</p>
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-text)] bg-[var(--color-accent-muted)] rounded-[var(--radius-md)] hover:bg-[var(--color-accent)] hover:text-white transition-colors cursor-pointer">
                <Plus className="h-3 w-3" />
                Add sale
              </button>
            </div>
          </div>
        ) : null}

        {/* Standalone sell (no buys) */}
        {linkage.buys.length === 0 && linkage.sells.length > 0 && (
          <div className="p-1">
            {linkage.sells.map((d) => (
              <DealSide key={d.id} deal={d} side="sell" />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function buildLinkages(deals: DealItem[]): Linkage[] {
  const linkageMap = new Map<string, DealItem[]>();
  const standalone: DealItem[] = [];

  deals.forEach((d) => {
    if (d.linkageCode) {
      const existing = linkageMap.get(d.linkageCode) || [];
      existing.push(d);
      linkageMap.set(d.linkageCode, existing);
    } else {
      standalone.push(d);
    }
  });

  const linkages: Linkage[] = [];

  // Grouped by linkage code
  linkageMap.forEach((items, code) => {
    const buys = items.filter((d) => d.direction === "buy");
    const sells = items.filter((d) => d.direction === "sell");
    const allDates = items.map((d) => d.laycanStart);
    const allEndDates = items.map((d) => d.laycanEnd);
    const vessel = items.find((d) => d.vesselName)?.vesselName ?? null;
    const product = items[0].product;
    // Overall status: pick the "most active" status
    const statusPriority = ["loading", "sailing", "discharging", "active", "draft"];
    const status = statusPriority.find((s) => items.some((d) => d.status === s)) || items[0].status;

    linkages.push({
      code,
      vessel,
      buys,
      sells,
      earliestLaycan: allDates.sort()[0],
      latestLaycan: allEndDates.sort().reverse()[0],
      status,
      product,
    });
  });

  // Standalone deals (no linkage code)
  standalone.forEach((d) => {
    linkages.push({
      code: null,
      vessel: d.vesselName,
      buys: d.direction === "buy" ? [d] : [],
      sells: d.direction === "sell" ? [d] : [],
      earliestLaycan: d.laycanStart,
      latestLaycan: d.laycanEnd,
      status: d.status,
      product: d.product,
    });
  });

  // Sort by earliest laycan
  linkages.sort((a, b) => a.earliestLaycan.localeCompare(b.earliestLaycan));

  return linkages;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);

  const name = session?.user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    fetch("/api/deals?perPage=100")
      .then((r) => r.json())
      .then((data) => {
        setDeals(data.items ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const active = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
  const linkages = buildLinkages(active);

  // Quick stats
  const totalActive = active.length;
  const urgentCount = active.filter((d) => daysUntil(d.laycanStart) <= 3).length;
  const sailingCount = active.filter((d) => d.status === "sailing" || d.status === "loading").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {greeting}, {name}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {loading
              ? "Loading..."
              : `${linkages.length} active voyage${linkages.length !== 1 ? "s" : ""}${urgentCount > 0 ? ` · ${urgentCount} approaching laycan` : ""}`
            }
          </p>
        </div>
        <Link
          href="/deals/parse"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-md)] hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          New Deal
        </Link>
      </div>

      {/* Quick stat pills */}
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-2)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
          <Package className="h-3.5 w-3.5" />
          {totalActive} active deals
        </div>
        {sailingCount > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-2)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
            <Ship className="h-3.5 w-3.5" />
            {sailingCount} en route
          </div>
        )}
        {urgentCount > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-danger-muted,#3d1515)] rounded-[var(--radius-md)] text-[var(--color-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {urgentCount} laycan &le;3d
          </div>
        )}
      </div>

      {/* Linkage cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        </div>
      ) : linkages.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center mb-4">
              <Anchor className="h-6 w-6 text-[var(--color-text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">No active voyages</p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              Parse a deal email to get started
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {linkages.map((linkage, i) => (
            <LinkageCard key={linkage.code ?? `standalone-${i}`} linkage={linkage} />
          ))}
        </div>
      )}
    </div>
  );
}
