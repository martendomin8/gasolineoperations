"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

interface DealRow {
  id: string;
  externalRef: string | null;
  linkageCode: string | null;
  dealType: string;
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
  pricingPeriodType: string | null;
  pricingPeriodValue: string | null;
  pricingConfirmed: boolean;
  estimatedBlNorDate: string | null;
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
  demurrage: string | null;
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

// Reduced column set for Internal / Terminal Operations section
const INTERNAL_COLUMNS = [
  { key: "laycan", label: "P/S(LAYCAN)", width: "180px" },
  { key: "counterparty", label: "Counterparty", width: "120px" },
  { key: "vessel", label: "Vessel", width: "130px" },
  { key: "linkage", label: "Linkage", width: "100px" },
  { key: "reference", label: "Reference", width: "90px" },
  { key: "ops", label: "OPS(name)", width: "80px" },
  { key: "blFigures", label: "B/L FIGURES", width: "140px" },
  { key: "voyDisOrders", label: "VOY/DIS ORDERS", width: "120px" },
  { key: "vesselNomination", label: "TERMINAL NOMINATION", width: "130px" },
  { key: "supervision", label: "INSPECTION NOMINATION", width: "140px" },
  { key: "dischargeNom", label: "AGENCY NOMINATION", width: "140px" },
  { key: "demurrage", label: "Demurrage", width: "90px" },
  { key: "freightInvoice", label: "Freight invoice", width: "100px" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatBLFigures(deal: DealRow): string {
  return deal.contractedQty || `${deal.quantityMt} MT`;
}

function formatOps(deal: DealRow): string {
  const primary = deal.operatorName || "\u2014";
  const secondary = deal.secondaryOperatorName || "";
  return secondary ? `${primary}/${secondary}` : primary;
}

// ---------------------------------------------------------------------------
// Cell style constants
// ---------------------------------------------------------------------------

const CELL_BASE = "px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)]";
const LOCKED_CELL = `${CELL_BASE}`;
const EDITABLE_CELL_IDLE = `${CELL_BASE} group/cell relative`;

// ---------------------------------------------------------------------------
// LockedCell — read-only, no interaction
// ---------------------------------------------------------------------------

function LockedCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`${LOCKED_CELL} ${className}`}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// EditableStatusCell — dropdown with Done / empty
// ---------------------------------------------------------------------------

function EditableStatusCell({
  value,
  dealId,
  fieldName,
  onUpdate,
}: {
  value: string | null;
  dealId: string;
  fieldName: string;
  onUpdate: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (newValue: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/status-field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: fieldName, value: newValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update status");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
      onUpdate();
    }
  };

  const isDone = value === "Done" || value === "DONE";
  const bgColor = isDone ? "bg-green-900/30" : "";

  return (
    <td className={`${EDITABLE_CELL_IDLE} ${bgColor}`}>
      <select
        value={value || ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="bg-transparent text-xs cursor-pointer w-full outline-none appearance-none"
      >
        <option value="">{"\u2014"}</option>
        <option value="Done">Done</option>
      </select>
      {/* Dropdown arrow indicator on hover */}
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[0.5rem] text-[var(--color-text-tertiary)] opacity-0 group-hover/cell:opacity-100 pointer-events-none select-none">
        {"\u25BE"}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// PricingCell — pricing period display with confirm and date
// ---------------------------------------------------------------------------

function PricingCell({ deal, onUpdate }: { deal: DealRow; onUpdate: () => void }) {
  const [savingDate, setSavingDate] = useState(false);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const periodType = deal.pricingPeriodType;
  const periodValue = deal.pricingPeriodValue;
  const confirmed = deal.pricingConfirmed;

  // Color logic
  let bgColor = "";
  if (periodType === "Fixed" || periodType === "EFP") {
    bgColor = "bg-green-900/30";
  } else if (periodType === "BL" || periodType === "NOR") {
    bgColor = confirmed ? "bg-green-900/30" : "bg-yellow-900/30";
  }

  const displayText =
    periodType && periodValue
      ? `${periodType} ${periodValue}`
      : periodType || deal.pricingFormula || "\u2014";

  const handleDateChange = async (newDate: string) => {
    setSavingDate(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/status-field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "estimatedBlNorDate", value: newDate }),
      });
      if (!res.ok) toast.error("Failed to update date");
    } catch {
      toast.error("Network error");
    } finally {
      setSavingDate(false);
      onUpdate();
    }
  };

  const handleConfirm = async () => {
    setSavingConfirm(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/status-field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "pricingConfirmed", value: "true" }),
      });
      if (!res.ok) toast.error("Failed to confirm pricing");
    } catch {
      toast.error("Network error");
    } finally {
      setSavingConfirm(false);
      onUpdate();
    }
  };

  return (
    <td className={`${CELL_BASE} ${bgColor}`}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono">{displayText}</span>
        {(periodType === "BL" || periodType === "NOR") && (
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="bg-transparent text-[0.6rem] w-24 outline-none"
              value={deal.estimatedBlNorDate || ""}
              disabled={savingDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
            {!confirmed && (
              <button
                onClick={handleConfirm}
                disabled={savingConfirm}
                className="text-[0.5rem] px-1 bg-green-800/50 rounded text-green-300 hover:bg-green-700/50 cursor-pointer disabled:opacity-50"
              >
                {"\u2713"}
              </button>
            )}
          </div>
        )}
      </div>
    </td>
  );
}

// ---------------------------------------------------------------------------
// StatusCell — read-only display for workflow step statuses (used for locked cells)
// ---------------------------------------------------------------------------

function StatusCell({ value }: { value: string | null }) {
  if (!value || value === "\u2014") return <span className="text-[var(--color-text-tertiary)]">{"\u2014"}</span>;
  const colors: Record<string, string> = {
    DONE: "text-[var(--color-success)] font-medium",
    Done: "text-[var(--color-success)] font-medium",
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

// ---------------------------------------------------------------------------
// Section header and column headers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DealRow — the main row component with editable and locked cells
// ---------------------------------------------------------------------------

function DealRowComponent({ deal, onUpdate }: { deal: DealRow; onUpdate: () => void }) {
  return (
    <tr className="hover:bg-[var(--color-surface-2)] transition-colors group">
      {/* Locked cells — system-populated, read-only */}
      <LockedCell className="font-mono whitespace-nowrap">
        <Link href={`/deals/${deal.id}`} className="text-[var(--color-accent-text)] hover:underline">
          {formatLaycan(deal)}
        </Link>
      </LockedCell>
      <LockedCell>{deal.counterparty}</LockedCell>
      <LockedCell className="font-mono">{deal.vesselName || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.linkageCode || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.externalRef || "\u2014"}</LockedCell>
      <LockedCell>{formatOps(deal)}</LockedCell>

      {/* Pricing — special interactive cell */}
      <PricingCell deal={deal} onUpdate={onUpdate} />

      {/* B/L Figures — locked */}
      <LockedCell>{formatBLFigures(deal)}</LockedCell>

      {/* Editable workflow step cells */}
      <EditableStatusCell value={deal.docInstructions} dealId={deal.id} fieldName="docInstructions" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.voyDisOrders} dealId={deal.id} fieldName="voyDisOrders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.vesselNomination} dealId={deal.id} fieldName="vesselNomination" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.supervision} dealId={deal.id} fieldName="supervision" onUpdate={onUpdate} />

      {/* Editable operator-managed cells */}
      <EditableStatusCell value={deal.coaToTraders} dealId={deal.id} fieldName="coaToTraders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.dischargeNomination} dealId={deal.id} fieldName="dischargeNomination" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.outturn} dealId={deal.id} fieldName="outturn" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.freightInvoice} dealId={deal.id} fieldName="freightInvoice" onUpdate={onUpdate} />

      {/* Tax — locked (system-derived from region) */}
      <LockedCell>{deal.tax || "\u2014"}</LockedCell>

      {/* Invoice to CP — editable operator-managed */}
      <EditableStatusCell value={deal.invoiceToCp} dealId={deal.id} fieldName="invoiceToCp" onUpdate={onUpdate} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Internal / Terminal Operations section components
// ---------------------------------------------------------------------------

function InternalSectionHeader() {
  return (
    <tr>
      <td
        colSpan={INTERNAL_COLUMNS.length}
        className="bg-amber-900/30 px-3 py-2 text-sm font-bold text-amber-200 uppercase tracking-wide border-t-2 border-t-amber-700 border-b border-[var(--color-border-subtle)]"
      >
        Internal / Terminal Operations
      </td>
    </tr>
  );
}

function InternalColumnHeaders() {
  return (
    <tr>
      {INTERNAL_COLUMNS.map((col) => (
        <th
          key={col.key}
          className="bg-amber-900/15 px-2 py-1.5 text-[0.625rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider border-b border-r border-[var(--color-border-subtle)] whitespace-nowrap"
          style={{ minWidth: col.width }}
        >
          {col.label}
        </th>
      ))}
    </tr>
  );
}

function InternalDealRowComponent({ deal, onUpdate }: { deal: DealRow; onUpdate: () => void }) {
  return (
    <tr className="hover:bg-[var(--color-surface-2)] transition-colors group">
      <LockedCell className="font-mono whitespace-nowrap">
        <Link href={`/deals/${deal.id}`} className="text-[var(--color-accent-text)] hover:underline">
          {formatLaycan(deal)}
        </Link>
      </LockedCell>
      <LockedCell>{deal.counterparty}</LockedCell>
      <LockedCell className="font-mono">{deal.vesselName || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.linkageCode || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.externalRef || "\u2014"}</LockedCell>
      <LockedCell>{formatOps(deal)}</LockedCell>
      <LockedCell>{formatBLFigures(deal)}</LockedCell>
      <EditableStatusCell value={deal.voyDisOrders} dealId={deal.id} fieldName="voyDisOrders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.vesselNomination} dealId={deal.id} fieldName="vesselNomination" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.supervision} dealId={deal.id} fieldName="supervision" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.dischargeNomination} dealId={deal.id} fieldName="dischargeNomination" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.demurrage} dealId={deal.id} fieldName="demurrage" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.freightInvoice} dealId={deal.id} fieldName="freightInvoice" onUpdate={onUpdate} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ExcelPage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ongoing" | "completed">("ongoing");

  const fetchDeals = useCallback(() => {
    fetch("/api/deals?perPage=100")
      .then((r) => {
        if (!r.ok) {
          return r.json().catch(() => ({})).then((err: Record<string, string>) => {
            toast.error(err.error || "Failed to load deals");
            setLoading(false);
            return null;
          });
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setDeals(data.items ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Excel page fetch failed:", err);
        toast.error("Failed to load deals");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const refreshData = useCallback(() => {
    fetchDeals();
  }, [fetchDeals]);

  const ongoing = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
  const completed = deals.filter((d) => d.status === "completed");

  // Separate regular deals from terminal operation deals
  const mainDeals = ongoing.filter((d) => d.dealType !== "terminal_operation");
  const terminalDeals = ongoing.filter((d) => d.dealType === "terminal_operation");

  // Find linkage codes that have at least one regular deal
  const linkagesWithRegular = new Set<string>();
  mainDeals.forEach((d) => {
    if (d.linkageCode) linkagesWithRegular.add(d.linkageCode);
  });

  // Internal section: terminal deals whose linkage has NO regular deals
  const internalDeals = terminalDeals.filter(
    (d) => !d.linkageCode || !linkagesWithRegular.has(d.linkageCode)
  );

  // Group main ongoing into sections (same logic, but only mainDeals)
  const purchases = mainDeals.filter((d) => d.direction === "buy" && !mainDeals.some((s) => s.direction === "sell" && s.linkageCode && s.linkageCode === d.linkageCode));
  const sales = mainDeals.filter((d) => d.direction === "sell" && !mainDeals.some((p) => p.direction === "buy" && p.linkageCode && p.linkageCode === d.linkageCode));

  // Linked: find linkage codes that have both buy and sell
  const linkedCodes = new Set<string>();
  mainDeals.forEach((d) => {
    if (d.linkageCode) {
      const hasBuy = mainDeals.some((x) => x.linkageCode === d.linkageCode && x.direction === "buy");
      const hasSell = mainDeals.some((x) => x.linkageCode === d.linkageCode && x.direction === "sell");
      if (hasBuy && hasSell) linkedCodes.add(d.linkageCode);
    }
  });
  const linked = Array.from(linkedCodes).map((code) => ({
    code,
    deals: mainDeals.filter((d) => d.linkageCode === code).sort((a, b) => (a.direction === "buy" ? -1 : 1)),
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
              <>
                <tbody>
                  {/* PURCHASE section */}
                  <SectionHeader title="PURCHASE" />
                  <ColumnHeaders />
                  {purchases.length > 0 ? (
                    purchases.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone purchases</td></tr>
                  )}

                  {/* SALE section */}
                  <SectionHeader title="SALE" />
                  <ColumnHeaders />
                  {sales.length > 0 ? (
                    sales.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone sales</td></tr>
                  )}

                  {/* PURCHASE + SALE section */}
                  <SectionHeader title="PURCHASE + SALE" />
                  <ColumnHeaders />
                  {linked.length > 0 ? (
                    linked.map((group) => (
                      group.deals.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} />)
                    ))
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No linked deals</td></tr>
                  )}
                </tbody>

                {/* INTERNAL / TERMINAL OPERATIONS — separate table body for different column count */}
                <tbody>
                  <InternalSectionHeader />
                  <InternalColumnHeaders />
                  {internalDeals.length > 0 ? (
                    internalDeals.map((d) => <InternalDealRowComponent key={d.id} deal={d} onUpdate={refreshData} />)
                  ) : (
                    <tr><td colSpan={INTERNAL_COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No internal operations</td></tr>
                  )}
                </tbody>
              </>
            ) : (
              <tbody>
                <ColumnHeaders />
                {completed.length > 0 ? (
                  completed.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} />)
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
