"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Trash2 } from "lucide-react";

interface DealRow {
  id: string;
  externalRef: string | null;
  linkageCode: string | null;
  linkageId: string | null;
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
  voyOrders: string | null;
  disOrders: string | null;
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
  { key: "voyOrders", label: "VOY ORDERS", width: "100px" },
  { key: "disOrders", label: "DIS ORDERS", width: "100px" },
  { key: "vesselNomination", label: "VESSEL NOMINATION", width: "130px" },
  { key: "supervision", label: "SUPERVISION (LP/DP)", width: "140px" },
  { key: "coaToTraders", label: "COA to Traders", width: "110px" },
  { key: "dischargeNom", label: "Discharge Nom(our terminal)", width: "160px" },
  { key: "outturn", label: "Outturn", width: "80px" },
  { key: "freightInvoice", label: "Freight invoice", width: "100px" },
  { key: "tax", label: "TAX", width: "60px" },
  { key: "invoiceToCp", label: "INVOICE TO CP", width: "110px" },
];

// Columns that are grayed out (not applicable) in the Internal / Terminal Operations section
const INTERNAL_GRAYED_KEYS = new Set(["coaToTraders", "outturn", "tax", "invoiceToCp"]);

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

  const isDone = value === "Done" || value === "DONE" || value === "done";
  const bgColor = isDone ? "bg-green-800/40" : "";

  return (
    <td className={`${EDITABLE_CELL_IDLE} ${bgColor}`}>
      <select
        value={isDone ? "Done" : ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className={`bg-transparent text-xs cursor-pointer w-full outline-none appearance-none ${isDone ? "text-[var(--color-success)] font-medium" : ""}`}
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

type SectionVariant = "purchase" | "sale" | "linked" | "internal";

const SECTION_COLORS: Record<SectionVariant, { bg: string; text: string; border: string }> = {
  purchase: { bg: "bg-blue-900/20", text: "text-blue-200", border: "border-t-2 border-t-blue-700" },
  sale:     { bg: "bg-amber-900/20", text: "text-amber-200", border: "border-t-2 border-t-amber-700" },
  linked:   { bg: "bg-emerald-900/20", text: "text-emerald-200", border: "border-t-2 border-t-emerald-700" },
  internal: { bg: "bg-amber-900/30", text: "text-amber-200", border: "border-t-2 border-t-amber-700" },
};

function SectionHeader({ title, variant = "purchase" }: { title: string; variant?: SectionVariant }) {
  const c = SECTION_COLORS[variant];
  return (
    <tr>
      <td
        colSpan={COLUMNS.length}
        className={`${c.bg} ${c.border} px-3 py-2 text-sm font-bold ${c.text} uppercase tracking-wide border-b border-[var(--color-border-subtle)]`}
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

function DealRowComponent({ deal, onUpdate, onDelete }: { deal: DealRow; onUpdate: () => void; onDelete: (deal: DealRow) => void }) {
  return (
    <tr className="hover:bg-[var(--color-surface-2)] transition-colors group relative">
      {/* Locked cells — system-populated, read-only */}
      <LockedCell className="font-mono whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(deal); }}
            title="Delete this deal"
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-[var(--color-danger)] transition-all flex-shrink-0 p-0.5 -ml-1 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <Link href={`/deals/${deal.id}`} className="text-[var(--color-accent-text)] hover:underline">
            {formatLaycan(deal)}
          </Link>
        </div>
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
      <EditableStatusCell value={deal.voyOrders} dealId={deal.id} fieldName="voyOrders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.disOrders} dealId={deal.id} fieldName="disOrders" onUpdate={onUpdate} />
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
  return <SectionHeader title="Internal / Terminal Operations" variant="internal" />;
}

function InternalColumnHeaders() {
  return (
    <tr>
      {COLUMNS.map((col) => (
        <th
          key={col.key}
          className={`px-2 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider border-b border-r border-[var(--color-border-subtle)] whitespace-nowrap ${
            INTERNAL_GRAYED_KEYS.has(col.key)
              ? "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] opacity-40"
              : "bg-amber-900/15 text-[var(--color-text-secondary)]"
          }`}
          style={{ minWidth: col.width }}
        >
          {col.label}
        </th>
      ))}
    </tr>
  );
}

function GrayedCell() {
  return <td className="px-2 py-1.5 text-xs border-b border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] opacity-30" />;
}

function InternalDealRowComponent({ deal, onUpdate, onDelete }: { deal: DealRow; onUpdate: () => void; onDelete: (deal: DealRow) => void }) {
  return (
    <tr className="hover:bg-[var(--color-surface-2)] transition-colors group relative">
      {/* Same columns as main table — grayed out where not applicable */}
      <LockedCell className="font-mono whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(deal); }}
            title="Delete this deal"
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-[var(--color-danger)] transition-all flex-shrink-0 p-0.5 -ml-1 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <Link href={`/deals/${deal.id}`} className="text-[var(--color-accent-text)] hover:underline">
            {formatLaycan(deal)}
          </Link>
        </div>
      </LockedCell>
      <LockedCell>{deal.counterparty}</LockedCell>
      <LockedCell className="font-mono">{deal.vesselName || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.linkageCode || "\u2014"}</LockedCell>
      <LockedCell className="font-mono">{deal.externalRef || "\u2014"}</LockedCell>
      <LockedCell>{formatOps(deal)}</LockedCell>
      <PricingCell deal={deal} onUpdate={onUpdate} />
      <LockedCell>{formatBLFigures(deal)}</LockedCell>
      <EditableStatusCell value={deal.docInstructions} dealId={deal.id} fieldName="docInstructions" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.voyOrders} dealId={deal.id} fieldName="voyOrders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.disOrders} dealId={deal.id} fieldName="disOrders" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.vesselNomination} dealId={deal.id} fieldName="vesselNomination" onUpdate={onUpdate} />
      <EditableStatusCell value={deal.supervision} dealId={deal.id} fieldName="supervision" onUpdate={onUpdate} />
      {/* Grayed out — not applicable for terminal operations */}
      <GrayedCell />
      <EditableStatusCell value={deal.dischargeNomination} dealId={deal.id} fieldName="dischargeNomination" onUpdate={onUpdate} />
      <GrayedCell />
      <EditableStatusCell value={deal.freightInvoice} dealId={deal.id} fieldName="freightInvoice" onUpdate={onUpdate} />
      <GrayedCell />
      <GrayedCell />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// ExportDropdown — triggers file download for CSV, Excel, PDF, Word
// ---------------------------------------------------------------------------

function ExportDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleExport(format: "csv" | "xlsx" | "pdf" | "docx") {
    setOpen(false);
    const url = `/api/deals/export?format=${format}&perPage=100`;
    if (format === "pdf") {
      // PDF opens in a new tab for print dialog
      window.open(url, "_blank");
    } else {
      // Other formats trigger download via hidden link
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export
        <span className="text-[0.5rem]">{"\u25BE"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] shadow-lg py-1 min-w-[140px]">
          <button
            onClick={() => handleExport("csv")}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            Excel (.xlsx)
          </button>
          <button
            onClick={() => handleExport("pdf")}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            PDF
          </button>
          <button
            onClick={() => handleExport("docx")}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
          >
            Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ExcelPage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ongoing" | "completed">("ongoing");
  const [dealToDelete, setDealToDelete] = useState<DealRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDeals = useCallback(() => {
    // Cache-bust to ensure we get fresh data after inline edits
    fetch(`/api/deals?perPage=100&_t=${Date.now()}`)
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

  // Auto-refetch when the page becomes visible again (e.g. operator returns
  // from the linkage view after renaming a linkage). Without this, the Excel
  // view shows the old linkage codes until a manual refresh.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchDeals();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", fetchDeals);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", fetchDeals);
    };
  }, [fetchDeals]);

  const refreshData = useCallback(() => {
    fetchDeals();
  }, [fetchDeals]);

  const requestDelete = useCallback((deal: DealRow) => {
    setDealToDelete(deal);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleting) return;
    setDealToDelete(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!dealToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/deals/${dealToDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Deal deleted");
        setDealToDelete(null);
        fetchDeals();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete deal");
      }
    } catch {
      toast.error("Failed to delete deal");
    } finally {
      setDeleting(false);
    }
  }, [dealToDelete, fetchDeals]);

  const ongoing = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
  const completed = deals.filter((d) => d.status === "completed");

  // Separate regular deals from terminal operation deals.
  // CRITICAL: All grouping below uses `linkageId` (UUID FK), NEVER `linkageCode` (string).
  // The linkage_code is volatile — renaming a linkage cascades to deals async, so a
  // string-based grouping splits a single voyage across two cards. linkage_id is stable.
  const mainDeals = ongoing.filter((d) => d.dealType !== "terminal_operation");
  const terminalDeals = ongoing.filter((d) => d.dealType === "terminal_operation");

  // Find linkage IDs that have at least one regular deal
  const linkageIdsWithRegular = new Set<string>();
  mainDeals.forEach((d) => {
    if (d.linkageId) linkageIdsWithRegular.add(d.linkageId);
  });

  // Internal section: terminal deals whose linkage has NO regular deals
  const internalDeals = terminalDeals.filter(
    (d) => !d.linkageId || !linkageIdsWithRegular.has(d.linkageId)
  );

  // Linked: linkage IDs that contain BOTH a buy and a sell among mainDeals
  const linkedIds = new Set<string>();
  mainDeals.forEach((d) => {
    if (d.linkageId) {
      const hasBuy = mainDeals.some((x) => x.linkageId === d.linkageId && x.direction === "buy");
      const hasSell = mainDeals.some((x) => x.linkageId === d.linkageId && x.direction === "sell");
      if (hasBuy && hasSell) linkedIds.add(d.linkageId);
    }
  });

  // Standalone purchases: buys whose linkage is NOT in the linked set
  const purchases = mainDeals.filter(
    (d) => d.direction === "buy" && (!d.linkageId || !linkedIds.has(d.linkageId))
  );
  // Standalone sales: sells whose linkage is NOT in the linked set
  const sales = mainDeals.filter(
    (d) => d.direction === "sell" && (!d.linkageId || !linkedIds.has(d.linkageId))
  );

  const linked = Array.from(linkedIds).map((linkageId) => {
    const groupDeals = mainDeals
      .filter((d) => d.linkageId === linkageId)
      .sort((a, b) => (a.direction === "buy" ? -1 : 1));
    return {
      linkageId,
      code: groupDeals[0]?.linkageCode ?? null,
      deals: groupDeals,
    };
  });

  // Terminal ops attached to a regular linkage render in the INTERNAL section
  // alongside the standalone terminal-only linkages. This way the operator sees
  // own-terminal moves grouped together regardless of which linkage they're in.
  const linkedTerminalOps = terminalDeals.filter(
    (d) => d.linkageId && linkageIdsWithRegular.has(d.linkageId)
  );
  const allInternalDeals = [...internalDeals, ...linkedTerminalOps];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Gasoline Vessels List</h1>
        <div className="flex items-center gap-3">
        <ExportDropdown />
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
                  <SectionHeader title="PURCHASE" variant="purchase" />
                  <ColumnHeaders />
                  {purchases.length > 0 ? (
                    purchases.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone purchases</td></tr>
                  )}

                  {/* SALE section */}
                  <SectionHeader title="SALE" variant="sale" />
                  <ColumnHeaders />
                  {sales.length > 0 ? (
                    sales.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone sales</td></tr>
                  )}

                  {/* PURCHASE + SALE section */}
                  <SectionHeader title="PURCHASE + SALE" variant="linked" />
                  <ColumnHeaders />
                  {linked.length > 0 ? (
                    linked.map((group) => (
                      group.deals.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} />)
                    ))
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No linked deals</td></tr>
                  )}
                </tbody>

                {/* INTERNAL / TERMINAL OPERATIONS — separate table body for different column count */}
                <tbody>
                  <InternalSectionHeader />
                  <InternalColumnHeaders />
                  {allInternalDeals.length > 0 ? (
                    allInternalDeals.map((d) => <InternalDealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No internal operations</td></tr>
                  )}
                </tbody>
              </>
            ) : (
              <tbody>
                <ColumnHeaders />
                {completed.length > 0 ? (
                  completed.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} />)
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No completed deals</td></tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {dealToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={cancelDelete}
        >
          <div
            className="bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-lg)] p-5 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
              Delete this deal?
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">
              This will permanently remove the deal and all of its workflow steps,
              email drafts, and change history. This cannot be undone.
            </p>
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2 text-xs mb-4">
              <div className="font-medium text-[var(--color-text-primary)]">
                {dealToDelete.counterparty} — {dealToDelete.direction.toUpperCase()} {dealToDelete.product}
              </div>
              <div className="font-mono text-[var(--color-text-tertiary)] mt-0.5">
                {Number(dealToDelete.quantityMt).toLocaleString()} MT · {dealToDelete.incoterm} · {dealToDelete.loadport} · {dealToDelete.linkageCode || "—"}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={cancelDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[var(--color-danger)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Deal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
