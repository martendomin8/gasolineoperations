"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Save,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  X as XIcon,
  AlertTriangle,
  Check,
  Pencil,
} from "lucide-react";
import { invalidateRuntimeGraph } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";
import { flushRouteCache } from "@/lib/maritime/sea-distance/providers/ocean-routing";

/**
 * Zone Editor — dev-only tool for editing operational zones.
 *
 * Three practical flavors backed by the same polygon + flag model:
 *   - Visible risk overlays (piracy, war, tension) — shown on the map
 *     whenever the "Risk zones" checkbox is on; informational only
 *     unless blocksRouting is flipped.
 *   - Hidden forbidden zones — not rendered on the normal map, but
 *     Dijkstra refuses to cross them (pipeline + runtime honour this
 *     on every route calculation).
 *   - Navigable whitelists — let routing through narrow straits where
 *     GSHHG says "land" but ships actually transit.
 *
 * UX philosophy mirrors the channel editor: a simple list, toggle
 * selection to activate, click on the map to add polygon vertices,
 * drag markers to move, right-click to delete. Persist with Save.
 */

export type ZoneCategory =
  | "war"
  | "piracy"
  | "tension"
  | "forbidden"
  | "navigable";

export interface Zone {
  id: string;
  label: string;
  category: ZoneCategory;
  visible: boolean;
  blocksRouting: boolean;
  navigable: boolean;
  note?: string | null;
  since?: string | null;
  polygon: Array<[number, number]>;
}

interface ZoneEditorProps {
  zones: Zone[];
  setZones: (zones: Zone[]) => void;
  activeZoneId: string | null;
  setActiveZoneId: (id: string | null) => void;
  dirty: boolean;
  setDirty: (d: boolean) => void;
}

// Category → palette + default flags. Used when creating a new zone;
// the operator can override any flag after.
const CATEGORY_PRESETS: Record<
  ZoneCategory,
  { color: string; label: string; defaults: { visible: boolean; blocksRouting: boolean; navigable: boolean } }
> = {
  piracy: {
    color: "#dc2626",
    label: "Piracy",
    defaults: { visible: true, blocksRouting: false, navigable: false },
  },
  war: {
    color: "#b91c1c",
    label: "War risk",
    defaults: { visible: true, blocksRouting: false, navigable: false },
  },
  tension: {
    color: "#f59e0b",
    label: "Tension",
    defaults: { visible: true, blocksRouting: false, navigable: false },
  },
  forbidden: {
    color: "#a855f7",
    label: "Forbidden",
    defaults: { visible: false, blocksRouting: true, navigable: false },
  },
  navigable: {
    color: "#22d3ee",
    label: "Navigable",
    defaults: { visible: false, blocksRouting: false, navigable: true },
  },
};

export function ZoneEditor({
  zones,
  setZones,
  activeZoneId,
  setActiveZoneId,
  dirty,
  setDirty,
}: ZoneEditorProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<ZoneCategory>("forbidden");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<
    { ok: true; hint: string } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/maritime/zones")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { zones: Zone[] }) => {
        if (cancelled) return;
        setZones(data.zones ?? []);
        setDirty(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Zones load failed:", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  const addZone = useCallback(() => {
    if (!newLabel.trim()) return;
    const baseId = slugify(newLabel);
    if (!baseId) return;
    let id = baseId;
    let n = 2;
    const taken = new Set(zones.map((z) => z.id));
    while (taken.has(id)) id = `${baseId}-${n++}`;
    const preset = CATEGORY_PRESETS[newCategory];
    const fresh: Zone = {
      id,
      label: newLabel.trim(),
      category: newCategory,
      visible: preset.defaults.visible,
      blocksRouting: preset.defaults.blocksRouting,
      navigable: preset.defaults.navigable,
      polygon: [],
    };
    setZones([...zones, fresh]);
    setActiveZoneId(id);
    setNewLabel("");
    setDirty(true);
  }, [newLabel, newCategory, zones, setZones, setActiveZoneId, setDirty]);

  const deleteZone = useCallback(
    (id: string) => {
      if (!confirm("Delete this zone? The change is local until you Save.")) return;
      setZones(zones.filter((z) => z.id !== id));
      if (activeZoneId === id) setActiveZoneId(null);
      setDirty(true);
    },
    [zones, setZones, activeZoneId, setActiveZoneId, setDirty]
  );

  const toggleFlag = useCallback(
    (id: string, flag: "visible" | "blocksRouting" | "navigable") => {
      setZones(
        zones.map((z) => (z.id === id ? { ...z, [flag]: !z[flag] } : z))
      );
      setDirty(true);
    },
    [zones, setZones, setDirty]
  );

  const saveAll = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/maritime/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zones }),
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
        // Make the save instantly effective: push the in-memory
        // zone state into the routing runtime's override slot and
        // drop any cached routes. Next route computation (the
        // Planner panel, ship overlays, etc.) honours these edits
        // without a dev-server restart.
        invalidateRuntimeGraph({
          zones: zones.map((z) => ({
            blocksRouting: z.blocksRouting,
            polygon: z.polygon,
          })),
        });
        flushRouteCache();
      }
    } catch (err) {
      setSaveMsg({ ok: false, error: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }, [zones, setDirty]);

  const activeZone = zones.find((z) => z.id === activeZoneId);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* New zone input */}
      <div className="px-4 py-3 border-b border-[var(--color-border-default)]">
        <div className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
          New Zone
        </div>
        <div className="flex gap-1.5 mb-1.5">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as ZoneCategory)}
            className="px-2 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[0.75rem] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-strong)]"
          >
            <option value="forbidden">Forbidden</option>
            <option value="navigable">Navigable</option>
            <option value="piracy">Piracy</option>
            <option value="war">War</option>
            <option value="tension">Tension</option>
          </select>
          <input
            type="text"
            placeholder="Zone label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addZone();
            }}
            className="flex-1 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-strong)]"
          />
          <button
            onClick={addZone}
            disabled={!newLabel.trim()}
            className="p-1.5 rounded-[var(--radius-md)] bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Zones list */}
      <div className="flex-1 overflow-y-auto">
        {zones.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--color-text-tertiary)] text-center">
            No zones yet. Add one above.
          </div>
        ) : (
          <div className="py-2">
            {zones.map((zone) => {
              const active = zone.id === activeZoneId;
              const color = CATEGORY_PRESETS[zone.category].color;
              return (
                <div
                  key={zone.id}
                  className={`px-4 py-2.5 border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors ${
                    active
                      ? "bg-amber-500/10"
                      : "hover:bg-[var(--color-surface-2)]"
                  }`}
                  onClick={() =>
                    setActiveZoneId(active ? null : zone.id)
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ background: color }}
                        />
                        <div
                          className={`text-sm font-medium truncate ${
                            active
                              ? "text-amber-400"
                              : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          {zone.label}
                        </div>
                      </div>
                      <div className="text-[0.6875rem] text-[var(--color-text-tertiary)] mt-0.5 ml-4">
                        {zone.polygon.length} vertices · {zone.category}
                      </div>
                      <div className="flex gap-1 mt-1 ml-4">
                        <FlagBadge
                          label="Visible"
                          active={zone.visible}
                          icon={zone.visible ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFlag(zone.id, "visible");
                          }}
                        />
                        <FlagBadge
                          label="Blocks"
                          active={zone.blocksRouting}
                          icon={<Shield className="h-2.5 w-2.5" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFlag(zone.id, "blocksRouting");
                          }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteZone(zone.id);
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

      {/* Active zone help */}
      {activeZone && (
        <div className="px-4 py-3 border-t border-[var(--color-border-default)] bg-[var(--color-surface-2)]/50">
          <div className="text-[0.6875rem] uppercase tracking-wider text-amber-400 font-semibold mb-1.5 flex items-center gap-1.5">
            <Pencil className="h-3 w-3" />
            Editing: {activeZone.label}
          </div>
          {activeZone.polygon.length < 3 ? (
            <div className="text-[0.75rem] text-amber-300">
              Polygon needs at least 3 vertices. Click on the map to add the
              first points.
            </div>
          ) : null}
          <ul className="text-[0.75rem] text-[var(--color-text-secondary)] space-y-0.5 list-disc list-inside">
            <li>
              <b>Click</b> on map → add vertex to end of polygon
            </li>
            <li>
              <b>Shift+click</b> near an edge → insert vertex there
            </li>
            <li>
              <b>Drag</b> a marker → move that vertex
            </li>
            <li>
              <b>Right-click</b> a marker → delete that vertex
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
          {saving ? "Saving..." : dirty ? "Save all zones" : "No changes"}
        </button>
      </div>
    </div>
  );
}

function FlagBadge({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Toggle ${label}`}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-medium transition-colors ${
        active
          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
          : "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] border border-[var(--color-border-default)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
