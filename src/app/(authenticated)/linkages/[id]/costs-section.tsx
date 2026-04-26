"use client";

// CostsSection — compact, collapsible voyage cost ledger inside the linkage
// page. Default collapsed since most voyages have zero cost rows (owner
// pays everything). Categories the operator can add come from
// LINKAGE_COST_CATEGORIES; freight + address-commission + brokerage live
// here too as a special block, computed live from deals + the linkage's
// freight_*_pct toggles when NEFGO is the charterer.
//
// Etapp 1 scope: manual CRUD on linkage_costs rows + the freight block UI
// shell. Demurrage and freight live calculations land in etapp 2 once
// Arne provides the formulas.

import { useEffect, useState } from "react";
import {
  DollarSign,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Calculator,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import {
  LINKAGE_COST_CATEGORIES,
  type LinkageCostCategory,
} from "@/lib/types/linkage-cost";
import { isNefgoCharterer } from "@/lib/maritime/costs/charterer";

const CATEGORY_LABELS: Record<LinkageCostCategory, string> = {
  demurrage: "Demurrage",
  freight: "Freight",
  full_speed: "Full speed",
  port_costs: "Port costs",
  agency: "Agency fees",
  inspector: "Inspector",
  superintendent: "Superintendent fee",
  custom: "Custom",
};

// Categories the operator can add via the "+" dropdown. Demurrage is
// handled as an always-present special row (not a catalog pick), and
// freight is rendered separately when NEFGO is the charterer — neither
// belongs in the picker.
const ADDABLE_CATEGORIES: LinkageCostCategory[] = [
  "full_speed",
  "port_costs",
  "agency",
  "inspector",
  "superintendent",
  "custom",
];

interface DealForCharterer {
  direction: "buy" | "sell";
  incoterm: string;
}

export interface LinkageCostRow {
  id: string;
  category: LinkageCostCategory;
  description: string | null;
  estimatedAmount: string | null;
  actualAmount: string | null;
  currency: string;
  portName: string | null;
  notes: string | null;
  sortOrder: number;
  version: number;
}

interface Props {
  linkageId: string;
  freightDeductAddressCommission: boolean;
  freightAddressCommissionPct: string | number;
  freightDeductBrokerage: boolean;
  freightBrokeragePct: string | number;
  deals: DealForCharterer[];
  canEdit: boolean;
  onUpdated: () => void;
}

function fmtUsd(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function CostsSection({
  linkageId,
  freightDeductAddressCommission,
  freightAddressCommissionPct,
  freightDeductBrokerage,
  freightBrokeragePct,
  deals,
  canEdit,
  onUpdated,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [costs, setCosts] = useState<LinkageCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<LinkageCostCategory | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const charterer = isNefgoCharterer(deals);

  const load = async () => {
    try {
      const r = await fetch(`/api/linkages/${linkageId}/costs?_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = await r.json();
      setCosts(data.costs ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkageId]);

  // ESC closes the modal — keeps the keyboard contract familiar without
  // depending on an external dialog primitive.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const totalActual = costs.reduce(
    (sum, c) => sum + (parseFloat(c.actualAmount ?? "") || 0),
    0,
  );
  const totalEstimated = costs.reduce(
    (sum, c) => sum + (parseFloat(c.estimatedAmount ?? "") || 0),
    0,
  );

  const addRow = async (category: LinkageCostCategory) => {
    if (!canEdit) return;
    setAdding(category);
    setPickerOpen(false);
    try {
      const r = await fetch(`/api/linkages/${linkageId}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description: CATEGORY_LABELS[category],
          currency: "USD",
        }),
      });
      if (r.ok) {
        await load();
        onUpdated();
      }
    } finally {
      setAdding(null);
    }
  };

  const deleteRow = async (costId: string) => {
    if (!canEdit) return;
    if (!confirm("Delete this cost line?")) return;
    const r = await fetch(`/api/linkages/${linkageId}/costs/${costId}`, {
      method: "DELETE",
    });
    if (r.ok) {
      await load();
      onUpdated();
    }
  };

  const lineCountLabel = costs.length === 0
    ? "no lines"
    : `${costs.length} line${costs.length === 1 ? "" : "s"}`;

  return (
    <>
      {/* Compact summary row in the linkage page — opens the modal on click. */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors text-left"
      >
        <DollarSign className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Costs
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">· {lineCountLabel}</span>
        {charterer && (
          <span className="text-[10px] text-[var(--color-accent)] uppercase tracking-wider">
            · freight payable
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
          <span>
            EST <span className="text-[var(--color-text-primary)] font-medium">{fmtUsd(totalEstimated)}</span>
          </span>
          <span>
            ACT <span className="text-[var(--color-text-primary)] font-medium">{fmtUsd(totalActual)}</span>
          </span>
          <ArrowRight className="h-3 w-3 opacity-60" />
        </span>
      </button>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 py-8"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Voyage costs"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] shadow-2xl"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[var(--color-accent)]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-primary)]">
                  Voyage costs
                </h3>
                <span className="text-[11px] text-[var(--color-text-tertiary)]">
                  EST {fmtUsd(totalEstimated)} · ACT {fmtUsd(totalActual)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div className="flex-1 overflow-y-auto">
              {/* Freight block (charterer-only) */}
              {charterer && (
                <FreightBlock
                  linkageId={linkageId}
                  deductAddress={freightDeductAddressCommission}
                  addressPct={freightAddressCommissionPct}
                  deductBrokerage={freightDeductBrokerage}
                  brokeragePct={freightBrokeragePct}
                  canEdit={canEdit}
                  onUpdated={onUpdated}
                />
              )}

              {/* Cost line items */}
              <div className="divide-y divide-[var(--color-border-subtle)]">
                {loading ? (
                  <div className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
                    Loading…
                  </div>
                ) : costs.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-[var(--color-text-tertiary)]">
                    No cost lines yet. {canEdit && "Use + Add cost below to track invoices, demurrage, full-speed bills, port-stay charges, etc."}
                  </div>
                ) : (
                  <div className="px-3 py-1.5 grid grid-cols-[100px_1fr_110px_110px_24px_24px] gap-2 text-[9px] uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--color-surface-2)]">
                    <span>Category</span>
                    <span>Description</span>
                    <span className="text-right">Estimated</span>
                    <span className="text-right">Actual</span>
                    <span />
                    <span />
                  </div>
                )}
                {!loading && costs.map((c) => (
                  <CostRow
                    key={c.id}
                    cost={c}
                    linkageId={linkageId}
                    canEdit={canEdit}
                    onChanged={() => {
                      load();
                      onUpdated();
                    }}
                    onDelete={() => deleteRow(c.id)}
                  />
                ))}
              </div>
            </div>

            {/* Modal footer — add cost picker */}
            {canEdit && (
              <div className="border-t border-[var(--color-border-subtle)] px-3 py-2 relative bg-[var(--color-surface-2)]">
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  disabled={!!adding}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {adding ? `Adding ${CATEGORY_LABELS[adding]}…` : "Add cost"}
                  {!adding && <ChevronDown className="h-3 w-3 opacity-60" />}
                </button>
                {pickerOpen && (
                  <div className="absolute left-3 bottom-full mb-1 z-20 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded shadow-lg py-1 min-w-[180px]">
                    {ADDABLE_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => addRow(cat)}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Single cost row ──────────────────────────────────────────────

function CostRow({
  cost,
  linkageId,
  canEdit,
  onChanged,
  onDelete,
}: {
  cost: LinkageCostRow;
  linkageId: string;
  canEdit: boolean;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    description: cost.description ?? "",
    estimatedAmount: cost.estimatedAmount ?? "",
    actualAmount: cost.actualAmount ?? "",
    notes: cost.notes ?? "",
  });

  const save = async () => {
    const r = await fetch(`/api/linkages/${linkageId}/costs/${cost.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: draft.description || null,
        estimatedAmount: draft.estimatedAmount || null,
        actualAmount: draft.actualAmount || null,
        notes: draft.notes || null,
        version: cost.version,
      }),
    });
    if (r.ok) {
      setEditing(false);
      onChanged();
    }
  };

  if (editing) {
    return (
      <div className="px-3 py-2 grid grid-cols-[100px_1fr_110px_110px_24px_24px] gap-2 items-center text-[11px]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {CATEGORY_LABELS[cost.category]}
        </span>
        <input
          type="text"
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="Description"
          className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-[11px]"
        />
        <input
          type="number"
          step="0.01"
          value={draft.estimatedAmount}
          onChange={(e) => setDraft((d) => ({ ...d, estimatedAmount: e.target.value }))}
          placeholder="Est. $"
          className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-[11px]"
        />
        <input
          type="number"
          step="0.01"
          value={draft.actualAmount}
          onChange={(e) => setDraft((d) => ({ ...d, actualAmount: e.target.value }))}
          placeholder="Act. $"
          className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-[11px]"
        />
        <button type="button" onClick={save} className="p-1 text-green-400 hover:bg-[var(--color-surface-2)] rounded">
          <Check className="h-3 w-3" />
        </button>
        <button type="button" onClick={() => setEditing(false)} className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)] rounded">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 grid grid-cols-[100px_1fr_110px_110px_24px_24px] gap-2 items-center text-[11px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {CATEGORY_LABELS[cost.category]}
      </span>
      <span className="text-[var(--color-text-primary)] truncate">
        {cost.description || <span className="text-[var(--color-text-tertiary)] italic">No description</span>}
      </span>
      <span className="text-[var(--color-text-secondary)] font-mono tabular-nums text-right">
        {fmtUsd(cost.estimatedAmount)}
      </span>
      <span className="text-[var(--color-text-primary)] font-mono tabular-nums text-right">
        {fmtUsd(cost.actualAmount)}
      </span>
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] rounded"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : (
        <span />
      )}
      {canEdit ? (
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-[var(--color-text-tertiary)] hover:text-red-400 hover:bg-[var(--color-surface-2)] rounded"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ── Freight + commission block (charterer-only) ──────────────────

function FreightBlock({
  linkageId,
  deductAddress,
  addressPct,
  deductBrokerage,
  brokeragePct,
  canEdit,
  onUpdated,
}: {
  linkageId: string;
  deductAddress: boolean;
  addressPct: string | number;
  deductBrokerage: boolean;
  brokeragePct: string | number;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const [savingFlag, setSavingFlag] = useState<string | null>(null);
  const [editingPct, setEditingPct] = useState<"address" | "broker" | null>(null);
  const [pctDraft, setPctDraft] = useState("");

  const save = async (payload: Record<string, unknown>) => {
    const r = await fetch(`/api/linkages/${linkageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) onUpdated();
  };

  const toggleAddress = async () => {
    setSavingFlag("address");
    try {
      await save({ freightDeductAddressCommission: !deductAddress });
    } finally {
      setSavingFlag(null);
    }
  };

  const toggleBrokerage = async () => {
    setSavingFlag("brokerage");
    try {
      await save({ freightDeductBrokerage: !deductBrokerage });
    } finally {
      setSavingFlag(null);
    }
  };

  const startPctEdit = (which: "address" | "broker") => {
    setPctDraft(which === "address" ? String(addressPct) : String(brokeragePct));
    setEditingPct(which);
  };

  const commitPct = async () => {
    if (!editingPct) return;
    const numeric = parseFloat(pctDraft);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      setEditingPct(null);
      return;
    }
    const key =
      editingPct === "address"
        ? "freightAddressCommissionPct"
        : "freightBrokeragePct";
    await save({ [key]: numeric.toFixed(2) });
    setEditingPct(null);
  };

  return (
    <div className="bg-[var(--color-surface-2)] border-b border-[var(--color-border-subtle)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2 mb-1.5">
        <Calculator className="h-3 w-3 text-[var(--color-accent)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          Freight (charterer)
        </span>
        <span className="text-[var(--color-text-tertiary)] text-[10px] italic">
          live calc — formula coming
        </span>
      </div>
      <div className="flex items-center gap-4 flex-wrap pl-5">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={deductAddress}
            onChange={toggleAddress}
            disabled={!canEdit || savingFlag === "address"}
            className="h-3 w-3"
          />
          <span className="text-[var(--color-text-secondary)]">Deduct address commission</span>
          {editingPct === "address" ? (
            <span className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={pctDraft}
                onChange={(e) => setPctDraft(e.target.value)}
                className="w-14 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded px-1 py-0.5 text-[11px]"
                autoFocus
              />
              <button type="button" onClick={commitPct} className="p-0.5 text-green-400">
                <Check className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => canEdit && startPctEdit("address")}
              disabled={!canEdit}
              className="font-mono text-[var(--color-text-primary)] hover:underline"
            >
              {Number(addressPct).toFixed(2)}%
            </button>
          )}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={deductBrokerage}
            onChange={toggleBrokerage}
            disabled={!canEdit || savingFlag === "brokerage"}
            className="h-3 w-3"
          />
          <span className="text-[var(--color-text-secondary)]">Deduct brokerage</span>
          {editingPct === "broker" ? (
            <span className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={pctDraft}
                onChange={(e) => setPctDraft(e.target.value)}
                className="w-14 bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded px-1 py-0.5 text-[11px]"
                autoFocus
              />
              <button type="button" onClick={commitPct} className="p-0.5 text-green-400">
                <Check className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => canEdit && startPctEdit("broker")}
              disabled={!canEdit}
              className="font-mono text-[var(--color-text-primary)] hover:underline"
            >
              {Number(brokeragePct).toFixed(2)}%
            </button>
          )}
        </label>
      </div>
    </div>
  );
}
