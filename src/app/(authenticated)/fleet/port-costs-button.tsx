"use client";

/**
 * Port-costs dropdown button — sits on each waypoint row in the
 * planner, opens a small popover listing saved costs for that port
 * and lets ops add/edit per (port, year, cost_type) entries.
 *
 * Cost types follow the `port_cost_type` Postgres enum
 * (src/lib/db/schema.ts): canal_toll | port_dues | agency | pilotage | other.
 *
 * Endpoint contract (src/app/api/maritime/port-costs/):
 *   GET  /api/maritime/port-costs?port=Rotterdam, NL
 *   POST /api/maritime/port-costs { port, year, costType, amountUsd, notes? }
 */

import { useEffect, useRef, useState } from "react";
import { DollarSign, Plus, Save, X } from "lucide-react";

type CostType = "canal_toll" | "port_dues" | "agency" | "pilotage" | "other";

const COST_TYPE_LABELS: Record<CostType, string> = {
  canal_toll: "Canal toll",
  port_dues: "Port dues",
  agency: "Agency",
  pilotage: "Pilotage",
  other: "Other",
};

interface PortCost {
  id: string;
  port: string;
  year: number;
  costType: CostType;
  amountUsd: string;
  notes: string | null;
  updatedAt: string;
}

interface Props {
  /** Port name in canonical form ("Rotterdam, NL") or a custom waypoint label. */
  portName: string;
}

export function PortCostsButton({ portName }: Props) {
  const [open, setOpen] = useState(false);
  const [costs, setCosts] = useState<PortCost[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newYear, setNewYear] = useState<string>(String(new Date().getFullYear()));
  const [newType, setNewType] = useState<CostType>("port_dues");
  const [newAmount, setNewAmount] = useState<string>("");
  const [newNotes, setNewNotes] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Custom waypoints (names start with "@") can't have port costs —
  // they aren't real ports. Render nothing for those rows.
  const isCustom = portName.startsWith("@");

  // Outside-click dismissal is handled directly by the modal
  // backdrop's onClick now that the popover is a fixed-position
  // overlay — clicking anywhere outside the white card fires
  // setOpen(false).

  // Fetch on open — not on mount — so we don't pound the API for
  // every waypoint row that's just sitting there.
  useEffect(() => {
    if (!open || isCustom) return;
    setLoading(true);
    const qs = new URLSearchParams({ port: portName }).toString();
    fetch(`/api/maritime/port-costs?${qs}`)
      .then((r) => (r.ok ? r.json() : { costs: [] }))
      .then((data: { costs: PortCost[] }) => setCosts(data.costs ?? []))
      .catch(() => setCosts([]))
      .finally(() => setLoading(false));
  }, [open, portName, isCustom]);

  if (isCustom) return null;

  async function handleSave() {
    setSaveError(null);
    const year = parseInt(newYear, 10);
    const amount = parseFloat(newAmount);
    if (!Number.isFinite(year) || year < 1970 || year > 2100) {
      setSaveError("Year must be between 1970 and 2100");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setSaveError("Amount must be a non-negative number");
      return;
    }

    const res = await fetch(`/api/maritime/port-costs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        port: portName,
        year,
        costType: newType,
        amountUsd: amount,
        notes: newNotes.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Save failed");
      return;
    }
    const data = (await res.json()) as { cost: PortCost };
    // Upsert client-side: replace matching (year, type) or insert new.
    setCosts((prev) => {
      const idx = prev.findIndex(
        (c) => c.year === data.cost.year && c.costType === data.cost.costType
      );
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = data.cost;
        return next;
      }
      return [...prev, data.cost].sort(
        (a, b) => a.year - b.year || a.costType.localeCompare(b.costType)
      );
    });
    setAdding(false);
    setNewAmount("");
    setNewNotes("");
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65rem] font-semibold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 cursor-pointer transition-colors"
        title={`Port costs for ${portName.split(",")[0]}`}
      >
        <DollarSign className="h-3 w-3" />
        Add port costs
      </button>

      {open && (
        <div
          // Fixed-position modal overlay — centered on screen so it
          // never slides off the sidebar edge. Earlier inline
          // popover sat next to the $ button and got cut off when
          // the planner panel was flush against the right edge.
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
        <div
          ref={popoverRef}
          className="w-[380px] max-w-[90vw] rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] shadow-2xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[0.65rem] font-bold text-amber-400 uppercase tracking-wider">
              Port costs — {portName.split(",")[0]}
            </span>
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="p-0.5 rounded text-amber-400/70 hover:text-amber-400 cursor-pointer"
                title="Add cost"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-[0.65rem] text-[var(--color-text-tertiary)] italic py-2">
              Loading…
            </div>
          ) : costs.length === 0 && !adding ? (
            <div className="text-[0.65rem] text-[var(--color-text-tertiary)] italic py-2">
              No costs saved yet.
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {costs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-surface-2)]"
                  title={c.notes ?? undefined}
                >
                  <span className="text-[0.65rem] font-mono text-amber-400 w-9 flex-shrink-0">
                    {c.year}
                  </span>
                  <span className="text-[0.65rem] text-[var(--color-text-secondary)] w-18 flex-shrink-0">
                    {COST_TYPE_LABELS[c.costType]}
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-primary)] ml-auto">
                    ${parseFloat(c.amountUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {adding && (
            <div className="mt-2 p-2 rounded bg-[var(--color-surface-2)] border border-amber-500/30 space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Year"
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  min={1970}
                  max={2100}
                  className="w-20 px-2 py-1 text-xs font-mono rounded bg-[var(--color-surface-3)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-amber-500/50"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CostType)}
                  className="flex-1 px-2 py-1 text-xs rounded bg-[var(--color-surface-3)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-amber-500/50"
                >
                  {Object.entries(COST_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="number"
                placeholder="Amount USD"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                step="0.01"
                min={0}
                className="w-full px-2 py-1 text-xs font-mono rounded bg-[var(--color-surface-3)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-amber-500/50"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                maxLength={500}
                className="w-full px-2 py-1 text-[0.7rem] rounded bg-[var(--color-surface-3)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-amber-500/50"
              />
              {saveError && (
                <div className="text-[0.65rem] text-[var(--color-danger)]">{saveError}</div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-2 py-1 text-[0.7rem] font-semibold rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 cursor-pointer"
                >
                  <Save className="h-3 w-3" />
                  Save
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setSaveError(null);
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[0.7rem] rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      )}
    </>
  );
}
