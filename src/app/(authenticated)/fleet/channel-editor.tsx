"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, AlertTriangle, Check } from "lucide-react";
import { invalidateRuntimeGraph } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";
import { flushRouteCache } from "@/lib/maritime/sea-distance/providers/ocean-routing";

/**
 * Channel Editor — dev-only tool for hand-curating the dense waypoint
 * chains that guide routing through narrow waterways (Turkish Straits,
 * Greek archipelago, etc.).
 *
 * UX: operator toggles "Dev" mode in the Fleet header, this panel
 * replaces the normal planner sidebar. From here they can:
 *   - see all existing chains (reading scripts/ocean-routing/channel_chains.json)
 *   - create a new chain, name it
 *   - select a chain to edit (becomes "active" on the map)
 *   - while active: every click on the map adds a waypoint
 *   - waypoints are drag-to-move, double-click to delete
 *   - Save → POST to /api/maritime/channel-chains (writes JSON)
 *
 * The JSON file is git-committed: after Save, the operator still has
 * to `git commit && push` to share with the team + trigger CI / run
 * the pipeline to rebuild the routing graph. The panel surfaces this
 * reminder after every save.
 *
 * Only the LIST/CREATE/DELETE operations live in this component. Map
 * click/drag handling is wired in page.tsx → fleet-map-maplibre.tsx so
 * the same map instance can switch between dev editing and normal
 * planner use without rendering two maps.
 */

export interface ChannelChain {
  id: string;
  label: string;
  notes?: string | null;
  waypoints: Array<[number, number]>;
  /**
   * If true, the Planner exposes an "Avoid [chain]" toggle.
   * Useful for size-restricted passages (Kiel Canal only fits up
   * to Panamax, Panama locks have beam limits, etc.) so the
   * operator can mark a chain off-limits for larger tankers
   * without removing it from the graph entirely.
   */
  avoidable?: boolean;
  /**
   * Sticky (default true) = Dijkstra gets a 3.3× weight discount on
   * intra-chain edges so it prefers the hand-curated path over sparse
   * anchor shortcuts. Use for narrow passages where the chain IS the
   * obvious natural route (Turkish Straits, Panama, Suez, fixes like
   * las-palmas-fix).
   *
   * Sticky false = chain is available as a navigable alternative but
   * Dijkstra doesn't get a preference — the organic shortest graph
   * path wins. Use for chains where the passage is one option of
   * several and the default routing should match what a generic
   * tanker actually sails (Kiel Canal = around Skagen by default for
   * MR-class tankers that don't fit the canal). Missing field is
   * treated as true for backward compatibility.
   */
  sticky?: boolean;
}

interface ChannelEditorProps {
  chains: ChannelChain[];
  setChains: (chains: ChannelChain[]) => void;
  activeChainId: string | null;
  setActiveChainId: (id: string | null) => void;
  dirty: boolean;
  setDirty: (d: boolean) => void;
}

export function ChannelEditor({
  chains,
  setChains,
  activeChainId,
  setActiveChainId,
  dirty,
  setDirty,
}: ChannelEditorProps) {
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<
    { ok: true; hint: string } | { ok: false; error: string } | null
  >(null);

  // Load the current chains on mount. We don't pass them as props
  // from page.tsx because the editor owns its own fetch lifecycle —
  // this way the editor can be opened/closed freely.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/maritime/channel-chains")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { chains: ChannelChain[] }) => {
        if (cancelled) return;
        setChains(data.chains ?? []);
        setDirty(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Channel chains load failed:", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slugify = (label: string) =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  const addChain = useCallback(() => {
    if (!newLabel.trim()) return;
    const baseId = slugify(newLabel);
    if (!baseId) return;
    // Collision-free id: append -2, -3, ... if already taken.
    let id = baseId;
    let n = 2;
    const taken = new Set(chains.map((c) => c.id));
    while (taken.has(id)) id = `${baseId}-${n++}`;
    const fresh: ChannelChain = {
      id,
      label: newLabel.trim(),
      waypoints: [],
    };
    setChains([...chains, fresh]);
    setActiveChainId(id);
    setNewLabel("");
    setDirty(true);
  }, [newLabel, chains, setChains, setActiveChainId, setDirty]);

  const deleteChain = useCallback(
    (id: string) => {
      if (!confirm("Delete this chain? The change is local until you Save.")) return;
      setChains(chains.filter((c) => c.id !== id));
      if (activeChainId === id) setActiveChainId(null);
      setDirty(true);
    },
    [chains, setChains, activeChainId, setActiveChainId, setDirty]
  );

  const saveAll = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/maritime/channel-chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chains }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({
          ok: false,
          error:
            (Array.isArray(data.issues) && data.issues[0]?.message) ||
            data.error ||
            `HTTP ${res.status}`,
        });
      } else {
        setSaveMsg({ ok: true, hint: data.hint ?? "Saved." });
        setDirty(false);
        // Instant effect: push the in-memory chain list into the
        // runtime override slot and drop cached routes. Next route
        // computation (Planner, vessel overlay, etc.) sees the fresh
        // chains without a dev-server restart.
        invalidateRuntimeGraph({
          channelChains: chains.map((c) => ({
            id: c.id,
            waypoints: c.waypoints,
            sticky: c.sticky,
          })),
        });
        flushRouteCache();
      }
    } catch (err) {
      setSaveMsg({ ok: false, error: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }, [chains, setDirty]);

  const activeChain = chains.find((c) => c.id === activeChainId);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* New chain input */}
      <div className="px-4 py-3 border-b border-[var(--color-border-default)]">
        <div className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
          New Chain
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="e.g. Greek Archipelago North"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addChain();
            }}
            className="flex-1 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-strong)]"
          />
          <button
            onClick={addChain}
            disabled={!newLabel.trim()}
            className="p-1.5 rounded-[var(--radius-md)] bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chains list */}
      <div className="flex-1 overflow-y-auto">
        {chains.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--color-text-tertiary)] text-center">
            No chains yet. Add one above.
          </div>
        ) : (
          <div className="py-2">
            {chains.map((chain) => {
              const active = chain.id === activeChainId;
              return (
                <div
                  key={chain.id}
                  className={`px-4 py-2.5 border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors ${
                    active
                      ? "bg-amber-500/10"
                      : "hover:bg-[var(--color-surface-2)]"
                  }`}
                  onClick={() =>
                    setActiveChainId(active ? null : chain.id)
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${
                          active
                            ? "text-amber-400"
                            : "text-[var(--color-text-primary)]"
                        }`}
                      >
                        {chain.label}
                      </div>
                      <div className="text-[0.6875rem] text-[var(--color-text-tertiary)] mt-0.5">
                        {chain.waypoints.length} waypoints · {chain.id}
                      </div>
                      <div className="mt-1 flex flex-col gap-0.5">
                        <label
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)]"
                        >
                          <input
                            type="checkbox"
                            checked={!!chain.avoidable}
                            onChange={(e) => {
                              setChains(chains.map((c) =>
                                c.id === chain.id
                                  ? { ...c, avoidable: e.target.checked }
                                  : c
                              ));
                              setDirty(true);
                            }}
                            className="h-3 w-3 cursor-pointer"
                          />
                          <span>Planner can avoid (size-restricted passage)</span>
                        </label>
                        <label
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)]"
                          title="When checked, Dijkstra prefers this chain (0.3× weight discount). Uncheck for 'regular route' — chain is available but not preferred over shorter graph alternatives (e.g. Kiel Canal should NOT be preferred for MR tankers)."
                        >
                          <input
                            type="checkbox"
                            checked={chain.sticky !== false}
                            onChange={(e) => {
                              setChains(chains.map((c) =>
                                c.id === chain.id
                                  ? { ...c, sticky: e.target.checked }
                                  : c
                              ));
                              setDirty(true);
                            }}
                            className="h-3 w-3 cursor-pointer"
                          />
                          <span>Dijkstra prefers (sticky shortcut)</span>
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChain(chain.id);
                      }}
                      className="p-1 rounded hover:bg-[var(--color-danger)]/15 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active chain help + save */}
      {activeChain && (
        <div className="px-4 py-3 border-t border-[var(--color-border-default)] bg-[var(--color-surface-2)]/50">
          <div className="text-[0.6875rem] uppercase tracking-wider text-amber-400 font-semibold mb-1.5">
            Editing: {activeChain.label}
          </div>
          <ul className="text-[0.75rem] text-[var(--color-text-secondary)] space-y-0.5 list-disc list-inside">
            <li>
              <b>Click</b> on map → add waypoint to end of chain
            </li>
            <li>
              <b>Shift+click</b> near a segment → insert between the two
              closest waypoints (what you want most of the time)
            </li>
            <li>
              <b>Drag</b> a marker → move that waypoint
            </li>
            <li>
              <b>Right-click</b> a marker → delete that waypoint
            </li>
            <li>
              Numbers on markers show the chain order (1 = start,
              last = end)
            </li>
          </ul>
        </div>
      )}

      {/* Footer — save button + hint */}
      <div className="px-4 py-3 border-t border-[var(--color-border-default)]">
        {saveMsg && (
          <div
            className={`mb-2 px-2.5 py-1.5 rounded-[var(--radius-md)] text-[0.75rem] flex items-start gap-2 ${
              saveMsg.ok
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30"
            }`}
          >
            {saveMsg.ok ? (
              <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            )}
            <span>
              {saveMsg.ok
                ? "Saved. " + saveMsg.hint
                : "Error: " + saveMsg.error}
            </span>
          </div>
        )}
        <button
          onClick={saveAll}
          disabled={saving || !dirty}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : dirty ? "Save all chains" : "No changes"}
        </button>
      </div>
    </div>
  );
}
