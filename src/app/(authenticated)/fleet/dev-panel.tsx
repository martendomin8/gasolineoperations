"use client";

import { Wrench, X, Route, Shield } from "lucide-react";
import { ChannelEditor, type ChannelChain } from "./channel-editor";
import { ZoneEditor, type Zone } from "./zone-editor";

/**
 * Dev Panel — single wrapper for the channel + zone editors, tabbed
 * so the dev has one home for every hand-curation tool. Opened via
 * the "Dev" header button when NEXT_PUBLIC_DEV_TOOLS=true. Owned
 * state (chains + zones) lives up in page.tsx so the map can share
 * it without prop-drilling through two sibling components.
 */

export type DevTab = "chains" | "zones";

interface DevPanelProps {
  activeTab: DevTab;
  setActiveTab: (tab: DevTab) => void;
  onClose: () => void;

  chains: ChannelChain[];
  setChains: (chains: ChannelChain[]) => void;
  activeChainId: string | null;
  setActiveChainId: (id: string | null) => void;
  chainsDirty: boolean;
  setChainsDirty: (d: boolean) => void;

  zones: Zone[];
  setZones: (zones: Zone[]) => void;
  activeZoneId: string | null;
  setActiveZoneId: (id: string | null) => void;
  zonesDirty: boolean;
  setZonesDirty: (d: boolean) => void;
}

export function DevPanel({
  activeTab,
  setActiveTab,
  onClose,
  chains,
  setChains,
  activeChainId,
  setActiveChainId,
  chainsDirty,
  setChainsDirty,
  zones,
  setZones,
  activeZoneId,
  setActiveZoneId,
  zonesDirty,
  setZonesDirty,
}: DevPanelProps) {
  return (
    <div className="h-full flex flex-col bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)] w-[360px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold">Dev Tools</span>
          <span className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
            DEV
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border-default)]">
        <TabButton
          active={activeTab === "chains"}
          onClick={() => setActiveTab("chains")}
          icon={<Route className="h-3.5 w-3.5" />}
          label="Chains"
          dirty={chainsDirty}
        />
        <TabButton
          active={activeTab === "zones"}
          onClick={() => setActiveTab("zones")}
          icon={<Shield className="h-3.5 w-3.5" />}
          label="Zones"
          dirty={zonesDirty}
        />
      </div>

      {/* Body */}
      {activeTab === "chains" ? (
        <ChannelEditor
          chains={chains}
          setChains={setChains}
          activeChainId={activeChainId}
          setActiveChainId={setActiveChainId}
          dirty={chainsDirty}
          setDirty={setChainsDirty}
        />
      ) : (
        <ZoneEditor
          zones={zones}
          setZones={setZones}
          activeZoneId={activeZoneId}
          setActiveZoneId={setActiveZoneId}
          dirty={zonesDirty}
          setDirty={setZonesDirty}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  dirty,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  dirty: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "bg-amber-500/10 text-amber-400 border-b-2 border-amber-500"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] border-b-2 border-transparent"
      }`}
    >
      {icon}
      {label}
      {dirty && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
      )}
    </button>
  );
}
