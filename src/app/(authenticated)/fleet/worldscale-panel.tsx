"use client";

/**
 * Worldscale flat-rate panel for the Distance Planner.
 *
 * Shown under the voyage results when the planner has a resolvable
 * (loadPort, dischargePort) pair. Ops types the WS100 flat rate from
 * the Worldscale book once per (route, year) and it's saved to the
 * `worldscale_rates` table.
 *
 * Endpoint contract (see src/app/api/maritime/worldscale-rates/):
 *   GET  /api/maritime/worldscale-rates?loadPort=X&dischargePort=Y
 *   POST /api/maritime/worldscale-rates { loadPort, dischargePort, year, flatRateUsdMt, notes? }
 *   DELETE /api/maritime/worldscale-rates/:id
 *
 * Lives in the Fleet page folder because it's specific to the planner
 * UX. If this gets reused elsewhere (e.g. in a freight-calc section),
 * lift to src/lib/maritime/components/.
 */

import { useEffect, useState } from "react";
import { BookText, Plus, Trash2, Save, X } from "lucide-react";

interface WorldscaleRate {
  id: string;
  loadPort: string;
  dischargePort: string;
  year: number;
  flatRateUsdMt: string; // decimal comes back as string from Postgres
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  /** Full canonical port names (e.g. "Rotterdam, NL"). Null hides the panel. */
  loadPort: string | null;
  dischargePort: string | null;
}

export function WorldscalePanel({ loadPort, dischargePort }: Props) {
  const [rates, setRates] = useState<WorldscaleRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newYear, setNewYear] = useState<string>(String(new Date().getFullYear()));
  const [newRate, setNewRate] = useState<string>("");
  const [newNotes, setNewNotes] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch when the (load, discharge) pair is known. Refetches on
  // pair change (e.g. operator drags a new port to start of route).
  useEffect(() => {
    if (!loadPort || !dischargePort) {
      setRates([]);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({ loadPort, dischargePort }).toString();
    fetch(`/api/maritime/worldscale-rates?${qs}`)
      .then((r) => (r.ok ? r.json() : { rates: [] }))
      .then((data: { rates: WorldscaleRate[] }) => setRates(data.rates ?? []))
      .catch(() => setRates([]))
      .finally(() => setLoading(false));
  }, [loadPort, dischargePort]);

  // Hide entirely when no pair — the panel only makes sense in the
  // context of a specific voyage's endpoints.
  if (!loadPort || !dischargePort) return null;

  async function handleSave() {
    setSaveError(null);
    const year = parseInt(newYear, 10);
    const rate = parseFloat(newRate);
    if (!Number.isFinite(year) || year < 1970 || year > 2100) {
      setSaveError("Year must be between 1970 and 2100");
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setSaveError("Rate must be a positive number");
      return;
    }

    const res = await fetch(`/api/maritime/worldscale-rates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        loadPort,
        dischargePort,
        year,
        flatRateUsdMt: rate,
        notes: newNotes.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Save failed");
      return;
    }
    const data = (await res.json()) as { rate: WorldscaleRate };
    // Upsert: either replace existing year or insert new — merge in.
    setRates((prev) => {
      const idx = prev.findIndex((r) => r.year === data.rate.year);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = data.rate;
        return next;
      }
      return [...prev, data.rate].sort((a, b) => a.year - b.year);
    });
    setAdding(false);
    setNewYear(String(new Date().getFullYear()));
    setNewRate("");
    setNewNotes("");
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/maritime/worldscale-rates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRates((prev) => prev.filter((r) => r.id !== id));
    }
  }

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BookText className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-[0.625rem] font-bold text-amber-400 uppercase tracking-wider">
            Worldscale flat rates
          </span>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="p-0.5 rounded text-amber-400/70 hover:text-amber-400 transition-colors cursor-pointer"
            title="Add rate"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Route caption — makes the (load, discharge) pair explicit so
          ops knows exactly which row they're editing. */}
      <div className="text-[0.65rem] text-[var(--color-text-tertiary)] mb-2 font-mono truncate">
        {loadPort.split(",")[0]} → {dischargePort.split(",")[0]}
      </div>

      {loading ? (
        <div className="text-[0.65rem] text-[var(--color-text-tertiary)] italic py-2">
          Loading rates…
        </div>
      ) : rates.length === 0 && !adding ? (
        <div className="text-[0.65rem] text-[var(--color-text-tertiary)] italic py-2">
          No saved rates for this route yet.
        </div>
      ) : (
        <div className="space-y-1">
          {rates.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-surface-2)] group"
            >
              <span className="text-[0.65rem] font-mono font-bold text-amber-400 w-10 flex-shrink-0">
                {r.year}
              </span>
              <span className="text-xs font-mono text-[var(--color-text-primary)] flex-1 min-w-0">
                ${parseFloat(r.flatRateUsdMt).toFixed(2)}/MT
              </span>
              {r.notes && (
                <span
                  className="text-[0.6rem] text-[var(--color-text-tertiary)] truncate max-w-[100px]"
                  title={r.notes}
                >
                  {r.notes}
                </span>
              )}
              <button
                onClick={() => handleDelete(r.id)}
                className="p-0.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Delete rate"
              >
                <Trash2 className="h-3 w-3" />
              </button>
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
            <input
              type="number"
              placeholder="$/MT"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              step="0.01"
              min={0}
              className="flex-1 px-2 py-1 text-xs font-mono rounded bg-[var(--color-surface-3)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-amber-500/50"
            />
          </div>
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
              className="flex items-center gap-1 px-2 py-1 text-[0.7rem] font-semibold rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors cursor-pointer"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setSaveError(null);
              }}
              className="flex items-center gap-1 px-2 py-1 text-[0.7rem] rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
