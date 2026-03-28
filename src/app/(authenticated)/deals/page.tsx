"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { DealStatus, DealDirection, DealIncoterm } from "@/lib/types";

interface DealListItem {
  id: string;
  externalRef: string | null;
  counterparty: string;
  direction: DealDirection;
  product: string;
  quantityMt: string;
  incoterm: DealIncoterm;
  loadport: string;
  dischargePort: string;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: DealStatus;
  assignedOperatorId: string | null;
  createdAt: string;
}

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "loading", label: "Loading" },
  { value: "sailing", label: "Sailing" },
  { value: "discharging", label: "Discharging" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const directionOptions = [
  { value: "", label: "All directions" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const incotermOptions = [
  { value: "", label: "All incoterms" },
  { value: "FOB", label: "FOB" },
  { value: "CIF", label: "CIF" },
  { value: "CFR", label: "CFR" },
  { value: "DAP", label: "DAP" },
  { value: "FCA", label: "FCA" },
];

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function formatQty(qty: string) {
  return `${Number(qty).toLocaleString("en", { maximumFractionDigits: 0 })} MT`;
}

export default function DealsPage() {
  const { data: session } = useSession();
  const [deals, setDeals] = useState<DealListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [incotermFilter, setIncotermFilter] = useState("");

  useEffect(() => {
    fetchDeals();
  }, [page, search, statusFilter, directionFilter, incotermFilter]);

  async function fetchDeals() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: "25" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (directionFilter) params.set("direction", directionFilter);
    if (incotermFilter) params.set("incoterm", incotermFilter);

    const res = await fetch(`/api/deals?${params}`);
    if (res.ok) {
      const data = await res.json();
      setDeals(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }

  const canCreate = session?.user?.role === "operator" || session?.user?.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Deals</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {total} deal{total !== 1 ? "s" : ""} total
          </p>
        </div>
        {canCreate && (
          <Link href="/deals/new">
            <Button size="md">
              <Plus className="h-4 w-4" />
              New Deal
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search deals..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-9 pl-9 pr-3 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] w-full focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-muted)] transition-colors"
          />
        </div>
        <Select options={statusOptions} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-36" />
        <Select options={directionOptions} value={directionFilter} onChange={(e) => { setDirectionFilter(e.target.value); setPage(1); }} className="w-36" />
        <Select options={incotermOptions} value={incotermFilter} onChange={(e) => { setIncotermFilter(e.target.value); setPage(1); }} className="w-36" />
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3">Ref</th>
                <th className="text-left px-4 py-3">Counterparty</th>
                <th className="text-left px-4 py-3">Dir</th>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-left px-4 py-3">Term</th>
                <th className="text-left px-4 py-3">Load</th>
                <th className="text-left px-4 py-3">Disch</th>
                <th className="text-left px-4 py-3">Laycan</th>
                <th className="text-left px-4 py-3">Vessel</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-sm text-[var(--color-text-tertiary)]">
                    Loading...
                  </td>
                </tr>
              ) : deals.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12">
                    <p className="text-sm text-[var(--color-text-secondary)]">No deals found</p>
                  </td>
                </tr>
              ) : (
                deals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                    onClick={() => window.location.href = `/deals/${deal.id}`}
                  >
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-tertiary)]">
                      {deal.externalRef || deal.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)]">
                      {deal.counterparty}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={deal.direction === "buy" ? "info" : "accent"}>
                        {deal.direction}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">
                      {deal.product}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)] text-right font-mono">
                      {formatQty(deal.quantityMt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="muted">{deal.incoterm}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">
                      {deal.loadport}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">
                      {deal.dischargePort}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-secondary)] font-mono whitespace-nowrap">
                      {formatDate(deal.laycanStart)}–{formatDate(deal.laycanEnd)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">
                      {deal.vesselName || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={deal.status as any} dot>
                        {deal.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border-subtle)]">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
