"use client";

/**
 * Fleet map inner component — rendered client-side only via dynamic import.
 * Contains all Leaflet/react-leaflet usage (which requires `window`).
 */

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker } from "react-leaflet";
import L from "leaflet";
import { CORE_TERMINALS } from "@/lib/geo/ports";

// ── Types ────────────────────────────────────────────────────

export interface FleetVessel {
  id: string;
  vesselName: string;
  vesselImo: string | null;
  linkageCode: string;
  status: string;
  position: { lat: number; lng: number };
  heading: number;
  loadport: string | null;
  dischargePort: string | null;
  buys: Array<{ counterparty: string; quantityMt: string; product: string }>;
  sells: Array<{ counterparty: string; quantityMt: string; product: string }>;
  earliestLaycan: string | null;
  latestLaycanEnd: string | null;
  assignedOperatorName: string | null;
  product: string | null;
}

// ── Status colors (matching globals.css) ─────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "#3b82f6",
  loading: "#e5983e",
  sailing: "#6366f1",
  discharging: "#a855f7",
  completed: "#22c55e",
};

// ── Ship icon SVG ────────────────────────────────────────────

function createShipIcon(color: string, heading: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      transform: rotate(${heading}deg);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
    ">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
        <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/>
        <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
        <path d="M12 10V3"/>
        <path d="M12 3h4"/>
      </svg>
    </div>`,
  });
}

// ── Component ────────────────────────────────────────────────

interface FleetMapProps {
  vessels: FleetVessel[];
  selectedVesselId: string | null;
  onSelectVessel: (id: string | null) => void;
}

export function FleetMapInner({ vessels, selectedVesselId, onSelectVessel }: FleetMapProps) {
  return (
    <MapContainer
      center={[46, 8]}
      zoom={4}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com">CARTO</a>'
        url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {/* Core terminal markers — always visible */}
      {CORE_TERMINALS.map((t) => (
        <CircleMarker
          key={t.label}
          center={[t.lat, t.lng]}
          radius={4}
          pathOptions={{
            color: "#6B7280",
            fillColor: "#6B7280",
            fillOpacity: 0.6,
            weight: 1,
          }}
        >
          <Tooltip permanent direction="right" offset={[8, 0]}>
            <span style={{ fontSize: "10px", color: "#9aa0ad" }}>{t.label}</span>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Vessel markers */}
      {vessels.map((v) => {
        const color = STATUS_COLORS[v.status] ?? "#6B7280";
        const isSelected = v.id === selectedVesselId;

        return (
          <Marker
            key={v.id}
            position={[v.position.lat, v.position.lng]}
            icon={createShipIcon(isSelected ? "#FFB000" : color, v.heading)}
            eventHandlers={{
              click: () => onSelectVessel(v.id === selectedVesselId ? null : v.id),
            }}
          >
            <Tooltip direction="top" offset={[0, -16]}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{v.vesselName}</div>
              <div style={{ fontSize: "10px", color: color, textTransform: "capitalize" }}>{v.status}</div>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
