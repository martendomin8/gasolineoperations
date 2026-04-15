"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Trash2, Pencil } from "lucide-react";

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
  version: number;
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

// ---------------------------------------------------------------------------
// Save helpers — used by the editable Reference / Linkage / B/L Figures cells
// Both endpoints cascade changes to deal and linkage detail pages automatically
// via the usual fetchData() refresh triggered by onUpdate().
// ---------------------------------------------------------------------------

async function saveDealField(
  dealId: string,
  field: "externalRef" | "contractedQty",
  value: string,
  version: number,
  onUpdate: () => void
): Promise<boolean> {
  try {
    const payload: Record<string, string | number | null> = {
      [field]: value.trim() === "" ? null : value.trim(),
      version,
    };
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || `Failed to update ${field}`);
      return false;
    }
    onUpdate();
    return true;
  } catch {
    toast.error("Network error");
    return false;
  }
}

async function saveLinkageNumber(
  linkageId: string | null,
  value: string,
  onUpdate: () => void
): Promise<boolean> {
  if (!linkageId) {
    toast.error("This deal is not attached to a linkage");
    return false;
  }
  try {
    const res = await fetch(`/api/linkages/${linkageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkageNumber: value.trim() === "" ? null : value.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to update linkage number");
      return false;
    }
    onUpdate();
    return true;
  } catch {
    toast.error("Network error");
    return false;
  }
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

function LockedCell({ children, className = "", rowSpan }: { children: React.ReactNode; className?: string; rowSpan?: number }) {
  return (
    <td className={`${LOCKED_CELL} ${className}`} rowSpan={rowSpan}>
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

  const normalized = value?.toLowerCase() ?? "";
  const isDone = normalized === "done";
  const isNA = normalized === "n/a" || normalized === "na";
  const isGreen = isDone || isNA;
  const bgColor = isGreen ? "bg-green-800/40" : "";
  const selectValue = isDone ? "Done" : isNA ? "N/A" : "";

  return (
    <td className={`${EDITABLE_CELL_IDLE} ${bgColor}`}>
      <select
        value={selectValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className={`bg-transparent text-xs cursor-pointer w-full outline-none appearance-none ${isGreen ? "text-[var(--color-success)] font-medium" : ""}`}
      >
        <option value="">{"\u2014"}</option>
        <option value="Done">Done</option>
        <option value="N/A">N/A</option>
      </select>
      {/* Dropdown arrow indicator on hover */}
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[0.5rem] text-[var(--color-text-tertiary)] opacity-0 group-hover/cell:opacity-100 pointer-events-none select-none">
        {"\u25BE"}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// DragScrollContainer — horizontal scroll wrapper with click-and-drag panning
// and an oversized, always-visible scrollbar. Ignores drags that start on
// interactive controls (select, input, textarea, button, a, [contenteditable])
// so cell edits keep working.
// ---------------------------------------------------------------------------

function DragScrollContainer({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    // ---- Sync thumb position + size to container scroll ----
    const sync = () => {
      const visible = el.clientWidth;
      const total = el.scrollWidth;
      const trackW = track.clientWidth;
      if (total <= visible) {
        thumb.style.width = "0px";
        return;
      }
      const thumbW = Math.max(60, (visible / total) * trackW);
      const maxThumbLeft = trackW - thumbW;
      const thumbLeft = (el.scrollLeft / (total - visible)) * maxThumbLeft;
      thumb.style.width = `${thumbW}px`;
      thumb.style.transform = `translateX(${thumbLeft}px)`;
    };
    sync();

    el.addEventListener("scroll", sync, { passive: true });
    const resizeObs = new ResizeObserver(sync);
    resizeObs.observe(el);
    if (el.firstElementChild) resizeObs.observe(el.firstElementChild);

    // ---- Drag-to-pan on the content area ----
    let panning = false;
    let panStartX = 0;
    let panStartScroll = 0;
    let panMoved = false;
    const INTERACTIVE = "select, input, textarea, button, a, [contenteditable='true']";

    const onContentDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE)) return;
      panning = true;
      panMoved = false;
      panStartX = e.pageX;
      panStartScroll = el.scrollLeft;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
    };
    const onContentMove = (e: MouseEvent) => {
      if (!panning) return;
      const dx = e.pageX - panStartX;
      if (Math.abs(dx) > 3) panMoved = true;
      el.scrollLeft = panStartScroll - dx;
    };
    const onContentUp = () => {
      if (!panning) return;
      panning = false;
      el.style.cursor = "";
      el.style.userSelect = "";
    };
    const onContentClick = (e: MouseEvent) => {
      if (panMoved) { e.stopPropagation(); e.preventDefault(); panMoved = false; }
    };

    el.addEventListener("mousedown", onContentDown);
    window.addEventListener("mousemove", onContentMove);
    window.addEventListener("mouseup", onContentUp);
    el.addEventListener("click", onContentClick, true);

    // ---- Custom scrollbar: drag the thumb ----
    let thumbDown = false;
    let thumbStartX = 0;
    let thumbStartScroll = 0;

    const onThumbDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      thumbDown = true;
      thumbStartX = e.pageX;
      thumbStartScroll = el.scrollLeft;
      document.body.style.userSelect = "none";
    };
    const onThumbMove = (e: MouseEvent) => {
      if (!thumbDown) return;
      const dx = e.pageX - thumbStartX;
      const trackW = track.clientWidth;
      const thumbW = thumb.clientWidth;
      const scrollable = el.scrollWidth - el.clientWidth;
      const maxThumbLeft = trackW - thumbW;
      if (maxThumbLeft <= 0) return;
      el.scrollLeft = thumbStartScroll + (dx / maxThumbLeft) * scrollable;
    };
    const onThumbUp = () => {
      thumbDown = false;
      document.body.style.userSelect = "";
    };

    thumb.addEventListener("mousedown", onThumbDown);
    window.addEventListener("mousemove", onThumbMove);
    window.addEventListener("mouseup", onThumbUp);

    // ---- Click on track to jump ----
    const onTrackDown = (e: MouseEvent) => {
      if (e.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const thumbW = thumb.clientWidth;
      const trackW = track.clientWidth;
      const scrollable = el.scrollWidth - el.clientWidth;
      const targetThumbLeft = Math.max(0, Math.min(trackW - thumbW, clickX - thumbW / 2));
      el.scrollLeft = (targetThumbLeft / (trackW - thumbW)) * scrollable;
    };
    track.addEventListener("mousedown", onTrackDown);

    return () => {
      el.removeEventListener("scroll", sync);
      resizeObs.disconnect();
      el.removeEventListener("mousedown", onContentDown);
      window.removeEventListener("mousemove", onContentMove);
      window.removeEventListener("mouseup", onContentUp);
      el.removeEventListener("click", onContentClick, true);
      thumb.removeEventListener("mousedown", onThumbDown);
      window.removeEventListener("mousemove", onThumbMove);
      window.removeEventListener("mouseup", onThumbUp);
      track.removeEventListener("mousedown", onTrackDown);
    };
  }, []);

  return (
    <div className="border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] overflow-hidden">
      <style jsx>{`
        .drag-scroll {
          cursor: grab;
          overflow-x: scroll;
          scrollbar-width: none;
        }
        .drag-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div ref={scrollRef} className="drag-scroll">
        {children}
      </div>
      {/* Custom fat scrollbar */}
      <div
        ref={trackRef}
        className="relative h-7 bg-[var(--color-surface-2)] border-t border-[var(--color-border-subtle)] cursor-pointer select-none"
      >
        <div
          ref={thumbRef}
          className="absolute top-1 bottom-1 left-0 rounded-full bg-[var(--color-border-default,#6b7280)] hover:bg-[var(--color-accent,#888)] transition-colors cursor-grab active:cursor-grabbing"
          style={{ width: 0 }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableChoiceCell — dropdown with a caller-provided list of options.
// Green background when any non-empty value is selected. Used for Tax (T1/T2).
// ---------------------------------------------------------------------------

function EditableChoiceCell({
  value,
  dealId,
  fieldName,
  options,
  onUpdate,
}: {
  value: string | null;
  dealId: string;
  fieldName: string;
  options: string[];
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
        toast.error(err.error || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
      onUpdate();
    }
  };

  const hasValue = !!value && options.includes(value);
  const bgColor = hasValue ? "bg-green-800/40" : "";

  return (
    <td className={`${EDITABLE_CELL_IDLE} ${bgColor}`}>
      <select
        value={hasValue ? value! : ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className={`bg-transparent text-xs cursor-pointer w-full outline-none appearance-none ${hasValue ? "text-[var(--color-success)] font-medium" : ""}`}
      >
        <option value="">{"\u2014"}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[0.5rem] text-[var(--color-text-tertiary)] opacity-0 group-hover/cell:opacity-100 pointer-events-none select-none">
        {"\u25BE"}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// EditableTextCell — inline text editor with click-to-edit, Enter to save, Esc to cancel
// ---------------------------------------------------------------------------

function EditableTextCell({
  value,
  onSave,
  className = "",
  rowSpan,
  placeholder = "\u2014",
  monospace = false,
  title,
}: {
  value: string | null;
  onSave: (newValue: string) => Promise<boolean>;
  className?: string;
  rowSpan?: number;
  placeholder?: string;
  monospace?: boolean;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(value ?? "");
    setEditing(true);
  };

  const commit = async () => {
    const next = draft.trim();
    const prev = value ?? "";
    if (next === prev) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const baseClass = `${CELL_BASE} group/cell relative cursor-text ${monospace ? "font-mono" : ""} ${className}`;

  if (editing) {
    return (
      <td className={baseClass} rowSpan={rowSpan}>
        <input
          type="text"
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          className={`w-full bg-[var(--color-surface-1)] border border-[var(--color-accent)] rounded px-1 py-0 text-xs outline-none ${monospace ? "font-mono" : ""}`}
        />
      </td>
    );
  }

  return (
    <td className={baseClass} rowSpan={rowSpan} onClick={startEdit} title={title ?? "Click to edit"}>
      <span className={value ? "" : "text-[var(--color-text-tertiary)]"}>
        {value || placeholder}
      </span>
      {/* Pencil indicator on hover */}
      <Pencil className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-[var(--color-text-tertiary)] opacity-0 group-hover/cell:opacity-60 pointer-events-none" />
    </td>
  );
}

// ---------------------------------------------------------------------------
// EditableOpsCell — click to assign primary + secondary operator (linkage-level)
// Opens an inline popover with two dropdowns.
// ---------------------------------------------------------------------------

function EditableOpsCell({
  deal,
  operators,
  className = "",
  rowSpan,
  onUpdate,
}: {
  deal: DealRow;
  operators: Array<{ id: string; name: string }>;
  className?: string;
  rowSpan?: number;
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [primaryDraft, setPrimaryDraft] = useState(deal.assignedOperatorId ?? "");
  const [secondaryDraft, setSecondaryDraft] = useState(deal.secondaryOperatorId ?? "");
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const startEdit = () => {
    setPrimaryDraft(deal.assignedOperatorId ?? "");
    setSecondaryDraft(deal.secondaryOperatorId ?? "");
    setOpen(true);
  };

  const save = async () => {
    if (!deal.linkageId) {
      toast.error("Deal has no linkage — cannot assign operators");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/linkages/${deal.linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedOperatorId: primaryDraft || null,
          secondaryOperatorId: secondaryDraft || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to assign operators");
      } else {
        setOpen(false);
        onUpdate();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const display = formatOps(deal);

  return (
    <td className={`${CELL_BASE} group/cell relative cursor-pointer ${className}`} rowSpan={rowSpan} onClick={startEdit} title="Click to assign operators">
      <span className={display === "\u2014" ? "text-[var(--color-text-tertiary)]" : ""}>{display}</span>
      <Pencil className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-[var(--color-text-tertiary)] opacity-0 group-hover/cell:opacity-60 pointer-events-none" />

      {open && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 top-full left-0 mt-1 w-56 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-1)] shadow-lg p-2 space-y-2 text-left cursor-default"
        >
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-0.5">Primary</label>
            <select
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              disabled={saving}
              className="w-full text-xs px-1.5 py-1 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none"
            >
              <option value="">— None —</option>
              {operators.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-0.5">Secondary</label>
            <select
              value={secondaryDraft}
              onChange={(e) => setSecondaryDraft(e.target.value)}
              disabled={saving}
              className="w-full text-xs px-1.5 py-1 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none"
            >
              <option value="">— None —</option>
              {operators.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              onClick={() => setOpen(false)}
              disabled={saving}
              className="text-[0.65rem] px-2 py-0.5 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-[0.65rem] px-2 py-0.5 rounded bg-[var(--color-accent)] text-[var(--color-text-inverse)] font-medium cursor-pointer disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </td>
  );
}

// ---------------------------------------------------------------------------
// PricingCell — pricing period display with confirm and date
// ---------------------------------------------------------------------------

function PricingCell({ deal, onUpdate }: { deal: DealRow; onUpdate: () => void }) {
  const [savingDate, setSavingDate] = useState(false);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const periodType = deal.pricingPeriodType;
  const periodValue = deal.pricingPeriodValue;
  const confirmed = deal.pricingConfirmed;

  // Color logic
  let bgColor = "";
  if (periodType === "Fixed" || periodType === "EFP") {
    bgColor = "bg-green-900/30";
  } else if (periodType === "BL" || periodType === "NOR") {
    bgColor = confirmed ? "bg-green-900/30" : "bg-yellow-400/60";
  }

  const displayText =
    periodType === "Fixed"
      ? periodValue ? `Fixed: ${periodValue}` : "Fixed"
      : periodType === "EFP"
      ? periodValue ? `EFP: ${periodValue}` : "EFP"
      : periodType && periodValue
      ? `${periodType} ${periodValue}`
      : periodType || "\u2014";

  // Format date as "4 Feb" (no year)
  const formatShortDate = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

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

  const handleToggleConfirm = async () => {
    setSavingConfirm(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/status-field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "pricingConfirmed", value: confirmed ? "false" : "true" }),
      });
      if (!res.ok) toast.error("Failed to update pricing");
    } catch {
      toast.error("Network error");
    } finally {
      setSavingConfirm(false);
      onUpdate();
    }
  };

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    // showPicker() is the modern, reliable way to open the native date picker
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  const formattedDate = formatShortDate(deal.estimatedBlNorDate);

  const showDateControls = periodType === "BL" || periodType === "NOR";
  const needsAttention = (periodType === "BL" || periodType === "NOR") && !confirmed;

  return (
    <td className={`${CELL_BASE} ${bgColor}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono">{displayText}</span>
        {showDateControls && (
          <>
            <button
              type="button"
              onClick={openDatePicker}
              disabled={savingDate}
              className={`text-[0.65rem] px-1 py-0 rounded cursor-pointer disabled:opacity-50 transition-colors ${
                needsAttention
                  ? "text-red-700 font-semibold hover:bg-red-900/20"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
              }`}
              title="Click to set estimated BL/NOR date"
            >
              {formattedDate || "set date"}
            </button>
            {/* Hidden native date input driven by the button above */}
            <input
              ref={dateInputRef}
              type="date"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              value={deal.estimatedBlNorDate || ""}
              onChange={(e) => handleDateChange(e.target.value)}
            />
            <button
              onClick={handleToggleConfirm}
              disabled={savingConfirm}
              className={`text-[0.6rem] px-1 py-0 rounded cursor-pointer disabled:opacity-50 transition-colors ${
                confirmed
                  ? "text-green-300 hover:bg-green-800/40"
                  : "text-black font-semibold hover:bg-black/10"
              }`}
              title={confirmed ? "Click to un-confirm pricing" : "Click to confirm pricing settled"}
            >
              {confirmed ? "\u2713" : "confirm"}
            </button>
          </>
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
  sale:     { bg: "bg-blue-900/20", text: "text-blue-200", border: "border-t-2 border-t-blue-700" },
  linked:   { bg: "bg-blue-900/20", text: "text-blue-200", border: "border-t-2 border-t-blue-700" },
  internal: { bg: "bg-blue-900/20", text: "text-blue-200", border: "border-t-2 border-t-blue-700" },
};

function SectionHeader({ title, variant = "purchase", first = false }: { title: string; variant?: SectionVariant; first?: boolean }) {
  const c = SECTION_COLORS[variant];
  return (
    <>
      {!first && (
        <tr>
          <td colSpan={COLUMNS.length} className="h-8 bg-transparent border-none" />
        </tr>
      )}
      <tr>
        <td
          colSpan={COLUMNS.length}
          className={`${c.bg} ${c.border} px-3 py-2 text-sm font-bold ${c.text} uppercase tracking-wide border-b border-[var(--color-border-subtle)]`}
        >
          {title}
        </td>
      </tr>
    </>
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

// Stable color for each linkage — cycles through pairs of border + background tints
const LINKAGE_TINTS: Array<{ border: string; bg: string }> = [
  { border: "border-l-emerald-500/50", bg: "bg-emerald-500/[0.04]" },
  { border: "border-l-blue-500/50",    bg: "bg-blue-500/[0.04]" },
  { border: "border-l-purple-500/50",  bg: "bg-purple-500/[0.06]" },
  { border: "border-l-pink-500/50",    bg: "bg-pink-500/[0.04]" },
  { border: "border-l-cyan-500/50",    bg: "bg-cyan-500/[0.04]" },
  { border: "border-l-orange-500/50",  bg: "bg-orange-500/[0.05]" },
];

function linkageTint(linkageId: string | null): { border: string; bg: string } {
  if (!linkageId) return { border: "", bg: "" };
  // Simple hash → index
  let hash = 0;
  for (let i = 0; i < linkageId.length; i++) hash = (hash * 31 + linkageId.charCodeAt(i)) | 0;
  return LINKAGE_TINTS[Math.abs(hash) % LINKAGE_TINTS.length];
}

/** Annotate a list of deals with linkage group info for rowSpan merging */
function withGroupInfo(deals: DealRow[]): Array<DealRow & { isFirstInGroup: boolean; groupSize: number }> {
  const result: Array<DealRow & { isFirstInGroup: boolean; groupSize: number }> = [];
  const seen = new Map<string, number>(); // linkageId → index of first deal in result

  for (const deal of deals) {
    const key = deal.linkageId;
    if (key && seen.has(key)) {
      // Not first in group — increment groupSize on the first deal
      result[seen.get(key)!].groupSize++;
      result.push({ ...deal, isFirstInGroup: false, groupSize: 1 });
    } else {
      if (key) seen.set(key, result.length);
      result.push({ ...deal, isFirstInGroup: true, groupSize: 1 });
    }
  }
  return result;
}

function DealRowComponent({
  deal,
  onUpdate,
  onDelete,
  operators,
  isFirstInGroup = true,
  groupSize = 1,
}: {
  deal: DealRow;
  onUpdate: () => void;
  onDelete: (deal: DealRow) => void;
  operators: Array<{ id: string; name: string }>;
  isFirstInGroup?: boolean;
  groupSize?: number;
}) {
  const tint = linkageTint(deal.linkageId);
  const spanProps = groupSize > 1 ? { rowSpan: groupSize } : {};
  const spanCellClass = groupSize > 1 ? "align-middle border-b-2 border-b-[var(--color-border-default)]" : "";

  return (
    <tr className={`hover:bg-[var(--color-surface-2)] transition-colors group relative ${tint.border ? `border-l-[3px] ${tint.border}` : ""} ${tint.bg}`}>
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

      {/* Linkage-level columns: vessel, linkage code, OPS — merged across rows */}
      {isFirstInGroup && (
        <>
          <LockedCell className={`font-mono ${spanCellClass}`} {...spanProps}>{deal.vesselName || "\u2014"}</LockedCell>
          <EditableTextCell
            value={deal.linkageCode}
            monospace
            className={spanCellClass}
            rowSpan={groupSize > 1 ? groupSize : undefined}
            title="Edit linkage number (syncs to all deals in linkage)"
            onSave={async (next) => saveLinkageNumber(deal.linkageId, next, onUpdate)}
          />
        </>
      )}

      <EditableTextCell
        value={deal.externalRef}
        monospace
        title="Edit reference (external_ref)"
        onSave={async (next) => saveDealField(deal.id, "externalRef", next, deal.version, onUpdate)}
      />

      {/* OPS — linkage-level, merged, click to assign */}
      {isFirstInGroup && (
        <EditableOpsCell
          deal={deal}
          operators={operators}
          className={spanCellClass}
          rowSpan={groupSize > 1 ? groupSize : undefined}
          onUpdate={onUpdate}
        />
      )}

      {/* Pricing — special interactive cell */}
      <PricingCell deal={deal} onUpdate={onUpdate} />

      {/* B/L Figures — editable contracted qty text */}
      <EditableTextCell
        value={deal.contractedQty || formatBLFigures(deal)}
        title="Edit B/L figures (contracted qty)"
        onSave={async (next) => saveDealField(deal.id, "contractedQty", next, deal.version, onUpdate)}
      />

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

      {/* Tax — operator picks T1 or T2 */}
      <EditableChoiceCell value={deal.tax} dealId={deal.id} fieldName="tax" options={["T1", "T2"]} onUpdate={onUpdate} />

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
              : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
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

function InternalDealRowComponent({
  deal,
  onUpdate,
  onDelete,
  operators,
  isFirstInGroup = true,
  groupSize = 1,
}: {
  deal: DealRow;
  onUpdate: () => void;
  onDelete: (deal: DealRow) => void;
  operators: Array<{ id: string; name: string }>;
  isFirstInGroup?: boolean;
  groupSize?: number;
}) {
  const tint = linkageTint(deal.linkageId);
  const spanProps = groupSize > 1 ? { rowSpan: groupSize } : {};
  const spanCellClass = groupSize > 1 ? "align-middle border-b-2 border-b-[var(--color-border-default)]" : "";

  return (
    <tr className={`hover:bg-[var(--color-surface-2)] transition-colors group relative ${tint.border ? `border-l-[3px] ${tint.border}` : ""} ${tint.bg}`}>
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

      {/* Linkage-level columns — merged across rows */}
      {isFirstInGroup && (
        <>
          <LockedCell className={`font-mono ${spanCellClass}`} {...spanProps}>{deal.vesselName || "\u2014"}</LockedCell>
          <EditableTextCell
            value={deal.linkageCode}
            monospace
            className={spanCellClass}
            rowSpan={groupSize > 1 ? groupSize : undefined}
            title="Edit linkage number (syncs to all deals in linkage)"
            onSave={async (next) => saveLinkageNumber(deal.linkageId, next, onUpdate)}
          />
        </>
      )}

      <EditableTextCell
        value={deal.externalRef}
        monospace
        title="Edit reference (external_ref)"
        onSave={async (next) => saveDealField(deal.id, "externalRef", next, deal.version, onUpdate)}
      />

      {isFirstInGroup && (
        <EditableOpsCell
          deal={deal}
          operators={operators}
          className={spanCellClass}
          rowSpan={groupSize > 1 ? groupSize : undefined}
          onUpdate={onUpdate}
        />
      )}

      <PricingCell deal={deal} onUpdate={onUpdate} />
      <EditableTextCell
        value={deal.contractedQty || formatBLFigures(deal)}
        title="Edit B/L figures (contracted qty)"
        onSave={async (next) => saveDealField(deal.id, "contractedQty", next, deal.version, onUpdate)}
      />
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
  const [allOperators, setAllOperators] = useState<Array<{ id: string; name: string }>>([]);

  // Fetch list of all operators once — used by the inline OPS cell editor
  useEffect(() => {
    fetch("/api/users?role=operator")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => {
        const list: Array<{ id: string; name: string; role: string }> = Array.isArray(data)
          ? data
          : data.users ?? data.items ?? [];
        setAllOperators(
          list
            .filter((u) => u.role === "operator" || u.role === "admin")
            .map((u) => ({ id: u.id, name: u.name }))
        );
      })
      .catch(() => { /* non-fatal: ops cell falls back to read-only */ });
  }, []);

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

  // Operator filter state — null = show all
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);

  // Extract unique operators for the dropdown (from deal data)
  const operatorOptions = Array.from(
    new Map(
      deals
        .filter((d) => d.assignedOperatorId && d.operatorName)
        .map((d) => [d.assignedOperatorId!, d.operatorName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const ongoing = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
  const completed = deals.filter((d) => d.status === "completed");

  // Apply operator filter. CRITICAL SAFETY RULE: deals with NO operator
  // assigned must ALWAYS show regardless of which filter is active.
  const filteredOngoing = operatorFilter
    ? ongoing.filter((d) => !d.assignedOperatorId || d.assignedOperatorId === operatorFilter)
    : ongoing;
  const filteredCompleted = operatorFilter
    ? completed.filter((d) => !d.assignedOperatorId || d.assignedOperatorId === operatorFilter)
    : completed;

  // Separate regular deals from terminal operation deals.
  // CRITICAL: All grouping below uses `linkageId` (UUID FK), NEVER `linkageCode` (string).
  // The linkage_code is volatile — renaming a linkage cascades to deals async, so a
  // string-based grouping splits a single voyage across two cards. linkage_id is stable.
  const mainDeals = filteredOngoing.filter((d) => d.dealType !== "terminal_operation");
  const terminalDeals = filteredOngoing.filter((d) => d.dealType === "terminal_operation");

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
        {/* Operator filter */}
        {operatorOptions.length > 0 && (
          <select
            value={operatorFilter ?? ""}
            onChange={(e) => setOperatorFilter(e.target.value || null)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] outline-none cursor-pointer hover:border-[var(--color-border-strong)] transition-colors"
          >
            <option value="">All operators</option>
            {operatorOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
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
        <DragScrollContainer>
          <table className="w-full border-collapse">
            {activeTab === "ongoing" ? (
              <>
                <tbody>
                  {/* PURCHASE section */}
                  <SectionHeader title="PURCHASE" variant="purchase" first />
                  <ColumnHeaders />
                  {purchases.length > 0 ? (
                    withGroupInfo(purchases).map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} operators={allOperators} isFirstInGroup={d.isFirstInGroup} groupSize={d.groupSize} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone purchases</td></tr>
                  )}

                  {/* SALE section */}
                  <SectionHeader title="SALE" variant="sale" />
                  <ColumnHeaders />
                  {sales.length > 0 ? (
                    withGroupInfo(sales).map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} operators={allOperators} isFirstInGroup={d.isFirstInGroup} groupSize={d.groupSize} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)]">No standalone sales</td></tr>
                  )}

                  {/* PURCHASE + SALE section */}
                  <SectionHeader title="PURCHASE + SALE" variant="linked" />
                  <ColumnHeaders />
                  {linked.length > 0 ? (
                    linked.map((group) => {
                      const annotated = withGroupInfo(group.deals);
                      return annotated.map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} operators={allOperators} isFirstInGroup={d.isFirstInGroup} groupSize={d.groupSize} />);
                    })
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No linked deals</td></tr>
                  )}
                </tbody>

                {/* INTERNAL / TERMINAL OPERATIONS — separate table body for different column count */}
                <tbody>
                  <InternalSectionHeader />
                  <InternalColumnHeaders />
                  {allInternalDeals.length > 0 ? (
                    withGroupInfo(allInternalDeals).map((d) => <InternalDealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} operators={allOperators} isFirstInGroup={d.isFirstInGroup} groupSize={d.groupSize} />)
                  ) : (
                    <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No internal operations</td></tr>
                  )}
                </tbody>
              </>
            ) : (
              <tbody>
                <ColumnHeaders />
                {filteredCompleted.length > 0 ? (
                  withGroupInfo(filteredCompleted).map((d) => <DealRowComponent key={d.id} deal={d} onUpdate={refreshData} onDelete={requestDelete} operators={allOperators} isFirstInGroup={d.isFirstInGroup} groupSize={d.groupSize} />)
                ) : (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-4 text-xs text-center text-[var(--color-text-tertiary)]">No completed deals</td></tr>
                )}
              </tbody>
            )}
          </table>
        </DragScrollContainer>
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
