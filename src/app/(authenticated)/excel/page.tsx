"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface DealRow {
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
  pricingEstimatedDate: string | null;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  operatorName: string | null;
  secondaryOperatorName: string | null;
  // Workflow step statuses (program-managed)
  docInstructions: string | null;
  voyDisOrders: string | null;
  vesselNomination: string | null;
  supervision: string | null;
  dischargeNomination: string | null;
  // Operator-managed columns
  coaToTraders: string | null;
  outturn: string | null;
  freightInvoice: string | null;
  tax: string | null;
  invoiceToCp: string | null;
}

// Column definitions matching Arne's Excel exactly
const COLUMNS = [
  { key: "laycan", label: "P/S(LAYCAN)", width: "180px" },
  { key: "counterparty", label: "Counterparty", width: "120px" },
  { key: "vessel", label: "Vessel", width: "130px" },
  { key: "linkage", label: "Linkage", width: "100px" },
  { key: "reference", label: "Reference", width: "90px" },
  { key: "ops", label: "OPS(name)", width: "80px" },
  { key: "pricing", label: "PRICING", width: "130px" },
  { key: "blFigures", label: "B/L FIGURES", width: "140px" },
  { key: "docInstructions", label: "DOC INSTRUCTIONS", width: "130px" },
  { key: "voyDisOrders", label: "VOY/DIS ORDERS", width: "120px" },
  { key: "vesselNomination", label: "VESSEL NOMINATION", width: "130px" },
  { key: "supervision", label: "SUPERVISION (LP/DP)", width: "140px" },
  { key: "coaToTraders", label: "COA to Traders", width: "110px" },
  { key: "dischargeNom", label: "Discharge Nom(our terminal)", width: "160px" },
  { key: "outturn", label: "Outturn", width: "80px" },
  { key: "freightInvoice", label: "Freight invoice", width: "100px" },
  { key: "tax", label: "TAX", width: "60px" },
  { key: "invoiceToCp", label: "INVOICE TO CP", width: "110px" },
];

function formatLaycan(deal: DealRow): string {
  const dir = deal.direction === "buy" ? "P" : "S";
  const start = new Date(deal.laycanStart);
  const end = new Date(deal.laycanEnd);
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const startDay = start.getDate().toString().padStart(2, "0");
  const endDay = end.getDate().toString().padStart(2, "0");
  const month = months[start.getMonth()];
  return `${dir}(${deal.incoterm} ${(deal.loadport || "TBD").toUpperCase()} ${startDay}-${endDay} ${month})`;
}

function formatPricing(deal: DealRow): string {
  const parts: string[] = [];
  if (deal.pricingType) parts.push(deal.pricingType);
  if (deal.pricingFormula) parts.push(deal.pricingFormula);
  if (deal.pricingEstimatedDate) {
    const d = new Date(deal.pricingEstimatedDate);
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    parts.push(`= ${day}/${month}?`);
  }
  return parts.join(" ") || deal.pricingFormula || "—";
}

function formatBLFigures(deal: DealRow): string {
  return deal.contractedQty || `${deal.quantityMt} MT`;
}

function formatOps(deal: DealRow): string {
  const primary = deal.operatorName || "—";
  const secondary = deal.secondaryOperatorName || "";
  return secondary ? `${primary}/${secondary}` : primary;
}

function StatusCell({ value }: { value: string | null }) {
  if (!value || value === "—") return <span className="text-[var(--color-text-tertiary)]">—</span>;
  const colors: Record<string, string> = {
    DONE: "text-[var(--color-success)] font-medium",
    SENT: "text-[var(--color-info)] font-medium",
    RECEIVED: "text-[var(--color-accent)] font-medium",
    "N/A": "text-[var(--color-text-tertiary)]",
    CANCELLED: "text-[var(--color-danger)] line-through",
    "NEEDS UPDATE": "text-[var(--color-danger)] font-bold",
    "DRAFT READY": "text-[var(--color-accent)]",
  };
  const cls = colors[value] || "text-[var(--color-text-secondary)]";
  return <span className={cls}>{value}</span>;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={COLUMNS.length}
        className="bg-[var(--color-surface-3)] px-3 py-2 text-sm font-bold text-[var(--color-text-primary)] uppercase tracking-wide border-b border-[var(--color-border-subtle)]"
      >
        {title}
      </td>
    </tr>
  );
}

function ColumnHeaders() {
  return (
    <tr>
      {COLUMNS.map((col) => (
        <th
          key={col.key}
          className="bg-[var(--color-surface-2)] px-2 py-1.5 text-[0.625rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider border-b border-r border-[var(--color-border-subtle)] whitespace-nowrap"
          style={{ minWidth: col.width }}
        >
          {col.label}
        </th>
      ))}
    </tr>
  );
}

function DealRow({ deal }: { deal: DealRow }) {
  return (
    <tr className="hover:bg-[var(--color-surface-2)] transition-colors group">
      <td className="px-2 py-1.5 text-xs font-mono border-b border-r border-[var(--color-border-subtle)] whitespace-nowrap">
        <Link href={`/deals/${deal.id}`} className="text-[var(--color-accent-text)] hover:underline">
          {formatLaycan(deal)}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]">{deal.counterparty}</td>
      <td className="px-2 py-1.5 text-xs font-mono border-b border-r border-[var(--color-border-subtle)]">{deal.vesselName || "—"}</td>
      <td className="px-2 py-1.5 text-xs font-mono border-b border-r border-[var(--color-border-subtle)]">{deal.linkageCode || "—"}</td>
      <td className="px-2 py-1.5 text-xs font-mono border-b border-r border-[var(--color-border-subtle)]">{deal.externalRef || "—"}</td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]">{formatOps(deal)}</td>
      <td className="px-2 py-1.5 text-xs font-mono border-b border-r border-[var(--color-border-subtle)]">{formatPricing(deal)}</td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]">{formatBLFigures(deal)}</td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.docInstructions} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.voyDisOrders} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.vesselNomination} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.supervision} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.coaToTraders} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.dischargeNomination} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.outturn} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]"><StatusCell value={deal.freightInvoice} /></td>
      <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]">{deal.tax || "—"}</td>
      <td className="px-2 py-1.5 text-xs border-b border-[var(--color-border-subtle)]"><StatusCell value={deal.invoiceToCp} /></td>
    </tr>
  );
}

export default function ExcelPage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ongoing" | "completed">("ongoing");

  useEffect(() => {
    fetch("/api/deals?perPage=100")
      .then((r) => r.json())
      .then((data) => {
        setDeals(data.items ?? []);
        setLoading(false);
      })
      .catch((err) => { console.error("Excel page fetch failed:", err); setLoading(false); });
  }, []);

  const ongoing = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
  const completed = deals.filter((d) => d.status === "completed");

  // Group ongoing into sections
  const purchases = ongoing.filter((d) => d.direction === "buy" && !ongoing.some((s) => s.direction === "sell" && s.linkageCode && s.linkageCode === d.linkageCode));
  const sales = ongoing.filter((d) => d.direction === "sell" && !ongoing.some((p) => p.direction === "buy" && p.linkageCode && p.linkageCode === d.linkageCode));

  // Linked: find linkage codes that have both buy and sell
  const linkedCodes = new Set<string>();
  ongoing.forEach((d) => {
    if (d.linkageCode) {
      const hasBuy = ongoing.some((x) => x.linkageCode === d.linkageCode && x.direction === "buy");
      const hasSell = ongoing.some((x) => x.linkageCode === d.linkageCode && x.direction === "sell");
      if (hasBuy && hasSell) linkedCodes.add(d.linkageCode);
    }
  });
  const linked = Array.from(linkedCodes).map((code) => ({
    code,
    deals: ongoing.filter((d) => d.linkageCode === code).sort((a, b) => (a.direction === "buy" ? -1 : 1)),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Gasoline Vessels List</h1>
        <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] p-0.5">
          <button
            onClick={() => setActiveTab("ongoing")}
            className={`px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              activeTab === "ongoing"
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            ONGOING
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`px-3 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              activeTab === "completed"
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            COMPLETED
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto border border-[var(--color-border-subtle)] rounded-[var(--radius-md)]">
          <table className="w-full border-collapse">
            {activeTab === "ongoing" ? (
              <tbody>
                {/* PURCHASE section */}
                <SectionHeader title="PURCHASE" />
                <ColumnHeaders />
                {purchases.length > 0 ? (
                  purchases.map((d) => <DealRow key={d.id} deal={d} />)
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone purchases</td></tr>
                )}

                {/* SALE section */}
                <SectionHeader title="SALE" />
                <ColumnHeaders />
                {sales.length > 0 ? (
                  sales.map((d) => <DealRow key={d.id} deal={d} />)
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone sales</td></tr>
                )}

                {/* PURCHASE + SALE section */}
                <SectionHeader title="PURCHASE + SALE" />
                <ColumnHeaders />
                {linked.length > 0 ? (
                  linked.map((group) => (
                    group.deals.map((d, i) => <DealRow key={d.id} deal={d} />)
                  ))
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No linked deals</td></tr>
                )}
              </tbody>
            ) : (
              <tbody>
                <ColumnHeaders />
                {completed.length > 0 ? (
                  completed.map((d) => <DealRow key={d.id} deal={d} />)
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No completed deals</td></tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
