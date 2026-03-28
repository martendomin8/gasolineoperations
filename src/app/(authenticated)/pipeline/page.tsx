"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Ship,
  Package,
  ArrowRight,
  Anchor,
  Waves,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import type { DealStatus } from "@/lib/db/schema";

interface DealSummary {
  id: string;
  externalRef: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  incoterm: string;
  loadport: string;
  dischargePort: string;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: DealStatus;
  updatedAt: string;
}

const STATUS_COLUMNS: Array<{
  status: DealStatus;
  label: string;
  icon: React.ElementType;
  color: string;
  ring: string;
}> = [
  { status: "active",       label: "Active",       icon: CircleDot,   color: "text-[var(--color-info)]",    ring: "border-[var(--color-info)]" },
  { status: "loading",      label: "Loading",      icon: Package,     color: "text-[var(--color-accent)]",  ring: "border-[var(--color-accent)]" },
  { status: "sailing",      label: "Sailing",      icon: Ship,        color: "text-[var(--color-accent)]",  ring: "border-[var(--color-accent)]" },
  { status: "discharging",  label: "Discharging",  icon: Anchor,      color: "text-[var(--color-warning,#c8972e)]", ring: "border-[var(--color-warning,#c8972e)]" },
  { status: "completed",    label: "Completed",    icon: CheckCircle2, color: "text-[var(--color-success)]", ring: "border-[var(--color-success)]" },
];

function DealCard({ deal }: { deal: DealSummary }) {
  const laycanRange = `${deal.laycanStart} – ${deal.laycanEnd}`;
  return (
    <Link href={`/deals/${deal.id}`}>
      <div className="group rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)] transition-all p-3 cursor-pointer space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent-text)] transition-colors">
              {deal.counterparty}
            </p>
            {deal.externalRef && (
              <p className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] truncate">
                {deal.externalRef}
              </p>
            )}
          </div>
          <Badge variant={deal.direction === "buy" ? "info" : "accent"} className="flex-shrink-0">
            {deal.direction}
          </Badge>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Package className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
            <span className="text-xs text-[var(--color-text-secondary)] truncate">
              {deal.product} · {Number(deal.quantityMt).toLocaleString()} MT · {deal.incoterm}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowRight className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
            <span className="text-xs text-[var(--color-text-tertiary)] truncate">
              {deal.loadport} → {deal.dischargePort}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
            <span className="text-xs font-mono text-[var(--color-text-tertiary)]">{laycanRange}</span>
          </div>
        </div>

        {deal.vesselName && (
          <div className="flex items-center gap-1.5 pt-0.5 border-t border-[var(--color-border-subtle)]">
            <Ship className="h-3 w-3 text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-xs text-[var(--color-accent-text)] truncate font-medium">
              {deal.vesselName}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

export default function PipelinePage() {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelledCount, setCancelledCount] = useState(0);

  useEffect(() => {
    fetch("/api/deals?perPage=100")
      .then((r) => r.json())
      .then((data) => {
        const all: DealSummary[] = data.items ?? [];
        setDeals(all.filter((d) => d.status !== "draft" && d.status !== "cancelled"));
        setCancelledCount(all.filter((d) => d.status === "cancelled").length);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  const totalActive = deals.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Cargo Pipeline</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {totalActive} active cargo{totalActive !== 1 ? "es" : ""} in motion
            {cancelledCount > 0 && (
              <span className="text-[var(--color-text-tertiary)] ml-2">· {cancelledCount} cancelled</span>
            )}
          </p>
        </div>
        {/* Summary stats */}
        <div className="flex items-center gap-3">
          {STATUS_COLUMNS.map((col) => {
            const count = deals.filter((d) => d.status === col.status).length;
            if (count === 0) return null;
            const Icon = col.icon;
            return (
              <div key={col.status} className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${col.color}`} />
                <span className="text-sm font-bold text-[var(--color-text-primary)]">{count}</span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{col.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-5 gap-4 min-h-[500px]">
        {STATUS_COLUMNS.map((col) => {
          const colDeals = deals.filter((d) => d.status === col.status);
          const Icon = col.icon;
          return (
            <div key={col.status} className="flex flex-col gap-2">
              {/* Column header */}
              <div className={`flex items-center gap-2 pb-2 border-b-2 ${col.ring}`}>
                <Icon className={`h-4 w-4 ${col.color}`} />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {col.label}
                </span>
                <span className="ml-auto text-xs font-mono text-[var(--color-text-tertiary)] bg-[var(--color-surface-3)] px-1.5 py-0.5 rounded">
                  {colDeals.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 flex-1">
                {colDeals.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-center">
                    <p className="text-xs text-[var(--color-text-tertiary)]">No cargoes</p>
                  </div>
                ) : (
                  colDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancelled footnote */}
      {cancelledCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <XCircle className="h-3.5 w-3.5 text-[var(--color-danger)]" />
          <span>{cancelledCount} cancelled deal{cancelledCount !== 1 ? "s" : ""} hidden from pipeline view.</span>
          <Link href="/deals" className="text-[var(--color-accent-text)] hover:underline">View all deals →</Link>
        </div>
      )}
    </div>
  );
}
