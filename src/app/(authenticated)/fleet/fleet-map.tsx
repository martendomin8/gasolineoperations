"use client";

/**
 * Fleet map inner component — rendered client-side only via dynamic import.
 * Contains all Leaflet/react-leaflet usage (which requires `window`).
 *
 * Design critique fixes applied:
 * - Filled circular markers with glow halos (not stroke-only SVGs)
 * - Pulsing red ring for urgent vessels (laycan ≤3 days)
 * - Dashed route polylines from loadport → dischargePort
 * - Permanent vessel name labels
 * - On-map status legend
 * - Memoized icons (rounded heading → cache key)
 */

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker, Polyline } from "react-leaflet";
import L from "leaflet";
import { useMemo } from "react";
import { CORE_TERMINALS, findPortCoordinates } from "@/lib/geo/ports";

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
  isUrgent: boolean;
}

// ── Status colors (from globals.css --color-status-*) ────────

export const STATUS_COLORS: Record<string, string> = {
  active: "#3b82f6",
  loading: "#e5983e",
  sailing: "#6366f1",
  discharging: "#a855f7",
  completed: "#22c55e",
};

export const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  loading: "Loading",
  sailing: "Sailing",
  discharging: "Discharging",
  completed: "Completed",
};

// ── Ship icon — filled circle with glow ──────────────────────

const iconCache = new Map<string, L.DivIcon>();

function getShipIcon(color: string, heading: number, isUrgent: boolean, isSelected: boolean): L.DivIcon {
  // Round heading to nearest 30° for cache efficiency
  const roundedHeading = Math.round(heading / 30) * 30;
  const key = `${color}-${roundedHeading}-${isUrgent}-${isSelected}`;

  if (iconCache.has(key)) return iconCache.get(key)!;

  const size = 40;
  const displayColor = isSelected ? "#FFB000" : color;
  const glowColor = isUrgent ? "#ef4444" : displayColor;
  const pulseClass = isUrgent ? "fleet-pulse" : "";
  const ringSize = isSelected ? 3 : 2;

  const icon = L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="${pulseClass}" style="
      width: ${size}px; height: ${size}px;
      position: relative;
      display: flex; align-items: center; justify-content: center;
    ">
      <!-- Glow ring -->
      <div style="
        position: absolute; inset: 0;
        border-radius: 50%;
        background: ${glowColor}18;
        box-shadow: 0 0 ${isUrgent ? 16 : 10}px ${glowColor}40;
        border: ${ringSize}px solid ${glowColor}60;
      "></div>
      <!-- Inner filled circle -->
      <div style="
        width: 24px; height: 24px;
        border-radius: 50%;
        background: ${displayColor};
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        position: relative; z-index: 1;
      ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none"
          style="transform: rotate(${roundedHeading}deg);">
          <polygon points="12,2 20,20 12,16 4,20" />
        </svg>
      </div>
    </div>`,
  });

  iconCache.set(key, icon);
  return icon;
}

// ── Route arc helper ─────────────────────────────────────────

function computeRouteArc(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): [number, number][] {
  // Simple curved arc via midpoint offset
  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const dist = Math.sqrt((to.lat - from.lat) ** 2 + (to.lng - from.lng) ** 2);
  // Perpendicular offset for curve
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const offsetLat = midLat + (-dx * 0.1);
  const offsetLng = midLng + (dy * 0.1);

  const points: [number, number][] = [];
  const steps = Math.max(20, Math.floor(dist * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic bezier: P = (1-t)²·A + 2(1-t)t·M + t²·B
    const lat = (1 - t) ** 2 * from.lat + 2 * (1 - t) * t * offsetLat + t ** 2 * to.lat;
    const lng = (1 - t) ** 2 * from.lng + 2 * (1 - t) * t * offsetLng + t ** 2 * to.lng;
    points.push([lat, lng]);
  }
  return points;
}

// ── Component ────────────────────────────────────────────────

interface FleetMapProps {
  vessels: FleetVessel[];
  selectedVesselId: string | null;
  onSelectVessel: (id: string | null) => void;
}

export function FleetMapInner({ vessels, selectedVesselId, onSelectVessel }: FleetMapProps) {
  // Compute route lines for vessels with both ports
  const routes = useMemo(() => {
    return vessels
      .filter((v) => v.loadport && v.dischargePort)
      .map((v) => {
        const from = findPortCoordinates(v.loadport);
        const to = findPortCoordinates(v.dischargePort);
        if (!from || !to) return null;
        return {
          id: v.id,
          color: STATUS_COLORS[v.status] ?? "#6B7280",
          points: computeRouteArc(from, to),
          isSelected: v.id === selectedVesselId,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        color: string;
        points: [number, number][];
        isSelected: boolean;
      }>;
  }, [vessels, selectedVesselId]);

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

      {/* Route polylines — drawn UNDER markers */}
      {routes.map((r) => (
        <Polyline
          key={`route-${r.id}`}
          positions={r.points}
          pathOptions={{
            color: r.isSelected ? "#FFB000" : r.color,
            weight: r.isSelected ? 2 : 1.5,
            opacity: r.isSelected ? 0.6 : 0.25,
            dashArray: "6 8",
            lineCap: "round",
          }}
        />
      ))}

      {/* Core terminal markers — always visible */}
      {CORE_TERMINALS.map((t) => (
        <CircleMarker
          key={t.label}
          center={[t.lat, t.lng]}
          radius={5}
          pathOptions={{
            color: "#FFB00060",
            fillColor: "#FFB000",
            fillOpacity: 0.2,
            weight: 1,
          }}
        >
          <Tooltip permanent direction="right" offset={[10, 0]}>
            <span style={{ fontSize: "10px", color: "#FFB000", fontWeight: 500, letterSpacing: "0.5px" }}>
              {t.label.toUpperCase()}
            </span>
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
            icon={getShipIcon(color, v.heading, v.isUrgent, isSelected)}
            eventHandlers={{
              click: () => onSelectVessel(v.id === selectedVesselId ? null : v.id),
            }}
          >
            {/* Permanent label */}
            <Tooltip permanent direction="right" offset={[20, 0]}>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: isSelected ? "#FFB000" : "#FAFAF7" }}>
                  {v.vesselName}
                </div>
                <div style={{ fontSize: "9px", color: color, fontFamily: "JetBrains Mono, monospace" }}>
                  {v.linkageCode}
                </div>
              </div>
            </Tooltip>
          </Marker>
        );
      })}

      {/* Status legend — bottom-right corner */}
      <div className="leaflet-bottom leaflet-right" style={{ pointerEvents: "none" }}>
        <div style={{
          background: "rgba(15, 17, 21, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid #272d3a",
          borderRadius: "8px",
          padding: "8px 12px",
          margin: "0 10px 28px 0",
          pointerEvents: "auto",
        }}>
          {Object.entries(STATUS_COLORS).filter(([k]) => k !== "completed").map(([status, color]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 0" }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: color, boxShadow: `0 0 6px ${color}60`,
              }} />
              <span style={{ fontSize: "10px", color: "#9aa0ad", textTransform: "capitalize" }}>
                {STATUS_LABELS[status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </MapContainer>
  );
}
