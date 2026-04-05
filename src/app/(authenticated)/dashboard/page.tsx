"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Ship, Plus, Package, Anchor, AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

// ────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────

interface DealItem {
  id: string;
  externalRef: string | null;
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
}

interface LinkageRow {
  id: string;
  linkageNumber: string | null;
  tempName: string | null;
  status: string;
  dealCount: number;
}

interface LinkageCard {
  id: string;
  displayName: string;
  status: string;
  vessel: string | null;
  product: string | null;
  buys: DealItem[];
  sells: DealItem[];
  earliestLaycan: string | null;
  firstDealId: string | null;
  category: "sell_only" | "buy_only" | "purchase_sell" | "own_terminal" | "empty";
}

// ────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────

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
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${s.getDate().toString().padStart(2, "0")}-${e.getDate().toString().padStart(2, "0")} ${months[s.getMonth()]}`;
}

function formatQty(deal: DealItem): string {
  const qty = deal.nominatedQty ?? deal.contractedQty ?? `${deal.quantityMt}`;
  // Strip trailing ".00" etc
  const num = parseFloat(qty);
  if (isNaN(num)) return qty;
  return num >= 1000 ? `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k MT` : `${num} MT`;
}

type StatusVariant = "muted" | "active" | "loading" | "sailing" | "accent" | "completed" | "cancelled";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: StatusVariant }> = {
    draft: { label: "Draft", variant: "muted" },
    active: { label: "Active", variant: "active" },
    loading: { label: "Loading", variant: "loading" },
    sailing: { label: "Sailing", variant: "sailing" },
    discharging: { label: "Dischg", variant: "accent" },
    completed: { label: "Done", variant: "completed" },
    cancelled: { label: "Cancelled", variant: "cancelled" },
  };
  const s = map[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={s.variant} className="text-[0.6rem] px-1.5 py-0">{s.label}</Badge>;
}

// ────────────────────────────────────────────────────
// Build linkage cards from API data
// ────────────────────────────────────────────────────

function buildLinkageCards(linkageRows: LinkageRow[], allDeals: DealItem[]): LinkageCard[] {
  // Group deals by linkageId, then by linkageCode as fallback
  const dealsByLinkageId = new Map<string, DealItem[]>();
  const dealsByLinkageCode = new Map<string, DealItem[]>();
  const orphanDeals: DealItem[] = [];

  for (const d of allDeals) {
    if (d.linkageId) {
      const arr = dealsByLinkageId.get(d.linkageId) ?? [];
      arr.push(d);
      dealsByLinkageId.set(d.linkageId, arr);
    } else if (d.linkageCode) {
      const arr = dealsByLinkageCode.get(d.linkageCode) ?? [];
      arr.push(d);
      dealsByLinkageCode.set(d.linkageCode, arr);
    } else {
      orphanDeals.push(d);
    }
  }

  const cards: LinkageCard[] = [];

  for (const row of linkageRows) {
    // Match deals: prefer linkageId, fallback to linkageCode
    let deals = dealsByLinkageId.get(row.id) ?? [];
    if (deals.length === 0 && row.linkageNumber) {
      deals = dealsByLinkageCode.get(row.linkageNumber) ?? [];
    }

    const buys = deals.filter((d) => d.direction === "buy");
    const sells = deals.filter((d) => d.direction === "sell");
    const vessel = deals.find((d) => d.vesselName)?.vesselName ?? null;
    const product = deals[0]?.product ?? null;

    // Earliest laycan
    const laycans = deals.map((d) => d.laycanStart).filter(Boolean).sort();
    const earliestLaycan = laycans[0] ?? null;

    // First deal for navigation
    const firstDealId = deals[0]?.id ?? null;

    // Categorize
    const hasTerminalOps = deals.some((d) => d.dealType === "terminal_operation");
    let category: LinkageCard["category"];
    if (deals.length === 0) {
      category = "empty";
    } else if (hasTerminalOps && buys.length === 0 && sells.length === 0) {
      category = "own_terminal";
    } else if (buys.length > 0 && sells.length > 0) {
      category = "purchase_sell";
    } else if (buys.length > 0) {
      category = "buy_only";
    } else if (sells.length > 0) {
      category = "sell_only";
    } else {
      category = "own_terminal";
    }

    cards.push({
      id: row.id,
      displayName: row.linkageNumber ?? row.tempName ?? "Unnamed",
      status: row.status,
      vessel,
      product,
      buys,
      sells,
      earliestLaycan,
      firstDealId,
      category,
    });
  }

  // Orphan deals (no linkageId or linkageCode) — create virtual cards for each
  for (const d of orphanDeals) {
    const category = d.direction === "buy" ? "buy_only" as const : "sell_only" as const;
    cards.push({
      id: `orphan-${d.id}`,
      displayName: d.externalRef || d.counterparty,
      status: "active",
      vessel: d.vesselName,
      product: d.product,
      buys: d.direction === "buy" ? [d] : [],
      sells: d.direction === "sell" ? [d] : [],
      earliestLaycan: d.laycanStart,
      firstDealId: d.id,
      category,
    });
  }

  // Also create cards for deals grouped by linkageCode that don't have a linkage row
  for (const [code, codeDeals] of dealsByLinkageCode) {
    // Skip if already matched to a linkage row
    if (cards.some((c) => c.displayName === code)) continue;
    const buys = codeDeals.filter((d) => d.direction === "buy");
    const sells = codeDeals.filter((d) => d.direction === "sell");
    const vessel = codeDeals.find((d) => d.vesselName)?.vesselName ?? null;
    const laycans = codeDeals.map((d) => d.laycanStart).filter(Boolean).sort();
    let category: LinkageCard["category"];
    if (buys.length > 0 && sells.length > 0) category = "purchase_sell";
    else if (buys.length > 0) category = "buy_only";
    else category = "sell_only";

    cards.push({
      id: `code-${code}`,
      displayName: code,
      status: "active",
      vessel,
      product: codeDeals[0]?.product ?? null,
      buys,
      sells,
      earliestLaycan: laycans[0] ?? null,
      firstDealId: codeDeals[0]?.id ?? null,
      category,
    });
  }

  // Sort by earliest laycan (nulls last)
  cards.sort((a, b) => {
    if (!a.earliestLaycan && !b.earliestLaycan) return 0;
    if (!a.earliestLaycan) return 1;
    if (!b.earliestLaycan) return -1;
    return a.earliestLaycan.localeCompare(b.earliestLaycan);
  });

  return cards;
}

// ────────────────────────────────────────────────────
// Linkage card component
// ────────────────────────────────────────────────────

function LinkageCardItem({ card, onClick }: { card: LinkageCard; onClick: () => void }) {
  const days = card.earliestLaycan ? daysUntil(card.earliestLaycan) : null;
  const isUrgent = days !== null && days <= 3 && days >= 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] p-3 hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)] transition-all cursor-pointer group"
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        {isUrgent && (
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${days! <= 1 ? "bg-[var(--color-danger)] animate-pulse" : "bg-[var(--color-warning,#c8972e)]"}`} />
        )}
        <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
          {card.displayName}
        </span>
        <StatusBadge status={card.status} />
      </div>

      {/* Vessel + product */}
      {(card.vessel || card.product) && (
        <div className="flex items-center gap-1.5 mb-1">
          {card.vessel && (
            <span className="flex items-center gap-1 text-[0.6875rem] text-[var(--color-text-secondary)]">
              <Ship className="h-3 w-3 flex-shrink-0" />
              {card.vessel}
            </span>
          )}
          {card.product && (
            <span className="text-[0.6875rem] text-[var(--color-text-tertiary)] truncate">
              {card.vessel ? " \u00b7 " : ""}{card.product}
            </span>
          )}
        </div>
      )}

      {/* Deal summary lines */}
      {card.buys.length > 0 && (
        <div className="text-[0.6875rem] text-[var(--color-text-secondary)] truncate">
          <span className="text-[var(--color-info)] font-medium">Buy:</span>{" "}
          {card.buys.map((d) => `${d.counterparty} ${formatQty(d)}`).join(", ")}
        </div>
      )}
      {card.sells.length > 0 && (
        <div className="text-[0.6875rem] text-[var(--color-text-secondary)] truncate">
          <span className="text-[var(--color-accent-text)] font-medium">Sell:</span>{" "}
          {card.sells.map((d) => `${d.counterparty} ${formatQty(d)}`).join(", ")}
        </div>
      )}

      {/* Empty state */}
      {card.buys.length === 0 && card.sells.length === 0 && (
        <div className="text-[0.6875rem] text-[var(--color-text-tertiary)] italic">No deals yet</div>
      )}

      {/* Laycan */}
      {card.earliestLaycan && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[0.625rem] text-[var(--color-text-tertiary)]">
          <span className="font-mono">
            LC {formatLaycanShort(card.earliestLaycan, card.sells[0]?.laycanEnd ?? card.buys[0]?.laycanEnd ?? card.earliestLaycan)}
          </span>
          {isUrgent && (
            <span className={`font-bold ${days! <= 1 ? "text-[var(--color-danger)]" : "text-[var(--color-warning,#c8972e)]"}`}>
              {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}d`}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────
// Column component
// ────────────────────────────────────────────────────

function Column({ title, cards, onCardClick }: { title: string; cards: LinkageCard[]; onCardClick: (card: LinkageCard) => void }) {
  return (
    <div className="min-w-[280px] w-[280px] flex-shrink-0 flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          {title}
        </h2>
        <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded">
          {cards.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-220px)] pr-1">
        {cards.length === 0 ? (
          <div className="text-xs text-[var(--color-text-tertiary)] text-center py-8 italic">
            None
          </div>
        ) : (
          cards.map((card) => (
            <LinkageCardItem key={card.id} card={card} onClick={() => onCardClick(card)} />
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Pricing alerts section
// ────────────────────────────────────────────────────

function PricingAlerts({ deals }: { deals: DealItem[] }) {
  const approaching = deals.filter((d) => {
    if (!d.pricingEstimatedDate) return false;
    const days = daysUntil(d.pricingEstimatedDate);
    return days >= 0 && days <= 5;
  });

  if (approaching.length === 0) return null;

  return (
    <div className="bg-[var(--color-warning-muted)] border border-[var(--color-warning)] rounded-[var(--radius-md)] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
        <span className="text-xs font-semibold text-[var(--color-warning)]">Pricing Approaching</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {approaching.map((d) => (
          <span key={d.id} className="text-[0.6875rem] text-[var(--color-text-secondary)]">
            {d.counterparty} ({d.pricingType} {d.pricingFormula}) &mdash; {daysUntil(d.pricingEstimatedDate!)}d
          </span>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [linkageRows, setLinkageRows] = useState<LinkageRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/linkages?status=active&_t=${Date.now()}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load linkages");
        return r.json() as Promise<LinkageRow[]>;
      }),
      fetch(`/api/deals?perPage=100&_t=${Date.now()}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load deals");
        return r.json() as Promise<{ items: DealItem[] }>;
      }),
    ])
      .then(([linkageData, dealsData]) => {
        setLinkageRows(linkageData);
        // Exclude completed/cancelled deals from dashboard
        setAllDeals(
          (dealsData.items ?? []).filter(
            (d) => d.status !== "completed" && d.status !== "cancelled"
          )
        );
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load data");
      })
      .finally(() => setLoading(false));
  }, []);

  // Build cards
  const cards = buildLinkageCards(linkageRows, allDeals);

  // Split into columns
  const sellOnly = cards.filter((c) => c.category === "sell_only");
  const buyOnly = cards.filter((c) => c.category === "buy_only");
  const purchaseSell = cards.filter((c) => c.category === "purchase_sell");
  const ownTerminal = cards.filter((c) => c.category === "own_terminal");
  const empty = cards.filter((c) => c.category === "empty");

  // Stats
  const totalLinkages = cards.length;
  const activeDeals = allDeals.length;

  const name = session?.user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Navigate to a linkage's first deal, or just to the linkage itself
  function handleCardClick(card: LinkageCard) {
    if (card.firstDealId) {
      router.push(`/deals/${card.firstDealId}`);
    } else {
      // Empty linkage — navigate to new deal page with linkage context
      router.push(`/deals/new?linkageId=${card.id}`);
    }
  }

  async function handleNewLinkage() {
    setCreating(true);
    try {
      const res = await fetch("/api/linkages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to create linkage");
      }
      const created = (await res.json()) as { id: string };
      router.push(`/deals/new?linkageId=${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create linkage");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {greeting}, {name}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {loading ? "Loading..." : `${totalLinkages} linkage${totalLinkages !== 1 ? "s" : ""} \u00b7 ${activeDeals} active deal${activeDeals !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={handleNewLinkage}
          disabled={creating}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-md)] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          {creating ? "Creating..." : "New Linkage"}
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-2)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
          <Anchor className="h-3.5 w-3.5" />
          {totalLinkages} linkages
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-2)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)]">
          <Package className="h-3.5 w-3.5" />
          {activeDeals} active deals
        </div>
        {allDeals.filter((d) => daysUntil(d.laycanStart) <= 3 && daysUntil(d.laycanStart) >= 0).length > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[var(--color-danger-muted,#3d1515)] rounded-[var(--radius-md)] text-[var(--color-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {allDeals.filter((d) => daysUntil(d.laycanStart) <= 3 && daysUntil(d.laycanStart) >= 0).length} laycan &le;3d
          </div>
        )}
      </div>

      {/* Pricing alerts */}
      <PricingAlerts deals={allDeals} />

      {/* Column layout */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        </div>
      ) : cards.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center mb-4">
              <Anchor className="h-6 w-6 text-[var(--color-text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">No active linkages</p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1 mb-4">
              Create a linkage to get started
            </p>
            <button
              onClick={handleNewLinkage}
              disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-md)] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Linkage
            </button>
          </div>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          <Column title="Sell Only" cards={sellOnly} onCardClick={handleCardClick} />
          <Column title="Buy Only" cards={buyOnly} onCardClick={handleCardClick} />
          <Column title="Purchase + Sell" cards={purchaseSell} onCardClick={handleCardClick} />
          <Column title="Own Terminal" cards={ownTerminal} onCardClick={handleCardClick} />
          <Column title="Empty" cards={empty} onCardClick={handleCardClick} />
        </div>
      )}
    </div>
  );
}
