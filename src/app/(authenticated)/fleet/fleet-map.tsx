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
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker, Polyline, Polygon, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useMemo, useState } from "react";
import { findPortCoordinates } from "@/lib/geo/ports";
import { getAllPorts, getSeaRoutePath, findPort } from "@/lib/maritime/sea-distance";
import { EMISSION_ZONES, ECA_FILL_STYLE, ECA_BOUNDARY_STYLE } from "@/lib/maritime/emission-zones";
import { RISK_ZONES, RISK_STYLES, RISK_TYPE_LABELS } from "@/lib/maritime/risk-zones";
import greatCircle from "@turf/great-circle";
// @ts-expect-error — @turf/helpers ships types but doesn't expose them via package.json "exports"
import { point } from "@turf/helpers";

/**
 * Expand a polyline to follow great-circle arcs on Earth's surface.
 *
 * The map is flat but Earth is round — a straight line on a Mercator map
 * is a rhumb line, not what a ship actually sails. For each consecutive
 * pair of waypoints we interpolate a great-circle arc via turf, then
 * concatenate them into a single polyline.
 *
 * Short segments (<50 NM) stay nearly straight because great-circle ≈
 * rhumb at small scales; long segments (transatlantic etc.) curve poleward
 * the way a real ship would.
 */
function toGeodesic(path: [number, number][], pointsPerSegment = 20): [number, number][] {
  if (path.length < 2) return path;
  const result: [number, number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = point([path[i][1], path[i][0]]); // [lon, lat]
    const to = point([path[i + 1][1], path[i + 1][0]]);
    try {
      const arc = greatCircle(from, to, { npoints: pointsPerSegment });
      const geom = arc.geometry;
      // turf.greatCircle returns LineString or MultiLineString (when
      // crossing the antimeridian). Normalize both into a flat array.
      const rings: number[][][] =
        geom.type === "MultiLineString"
          ? (geom.coordinates as number[][][])
          : [geom.coordinates as number[][]];
      for (const ring of rings) {
        for (let j = 0; j < ring.length; j++) {
          if (result.length > 0 && j === 0) continue; // skip duplicate join
          result.push([ring[j][1], ring[j][0]]); // back to [lat, lon]
        }
      }
    } catch {
      // Fall back to straight segment if turf fails
      result.push(path[i]);
      result.push(path[i + 1]);
    }
  }
  return result;
}

// ── Map-click capture (invisible helper) ─────────────────────
// `useMapEvents` must be inside <MapContainer>, so we wrap it in a
// tiny component that renders nothing and just forwards clicks to
// the parent's onMapClick handler. When the handler is undefined
// (planner closed), clicks pass through untouched.
function MapClickCapture({
  onMapClick,
}: {
  onMapClick?: (coords: { lat: number; lon: number }) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (!onMapClick) return;
      onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

// ── Reference ports layer (all 106 curated ports) ────────────
// Dots are always visible, names appear only at higher zoom levels (like Netpas).
const REFERENCE_PORTS = getAllPorts();
const LABEL_MIN_ZOOM = 5;

function ReferencePortsLayer({
  excludedNames,
  onPortClick,
}: {
  /** Ports already drawn as terminal/agent markers — skip to avoid duplicates */
  excludedNames: Set<string>;
  /**
   * If provided, reference-port dots become clickable and fire this
   * callback with the port's canonical name + coords. Planner mode
   * wires this to append the port to the waypoint list. When absent,
   * dots are inert (hover-only visual reference).
   */
  onPortClick?: (port: { name: string; lat: number; lon: number }) => void;
}) {
  const [zoom, setZoom] = useState(4);

  useMapEvents({
    zoomend: (e) => setZoom(e.target.getZoom()),
  });

  const showLabels = zoom >= LABEL_MIN_ZOOM;
  const clickable = Boolean(onPortClick);

  return (
    <>
      {REFERENCE_PORTS.map((p) => {
        if (excludedNames.has(p.name.toLowerCase())) return null;
        return (
          <CircleMarker
            key={`ref-${p.name}`}
            center={[p.lat, p.lon]}
            // Slightly larger + brighter when clickable so operators
            // get visual affordance that they can tap a port to add it
            // to the planner. Otherwise these stay subtle (radius 2).
            radius={clickable ? 4 : 2}
            pathOptions={{
              color: clickable ? "#22d3ee" : "#94a3b8",
              fillColor: clickable ? "#22d3ee" : "#94a3b8",
              fillOpacity: clickable ? 0.75 : 0.55,
              weight: 0,
              // Leaflet uses this CSS cursor on the SVG path
              className: clickable ? "fleet-port-clickable" : undefined,
            }}
            eventHandlers={
              onPortClick
                ? { click: () => onPortClick({ name: p.name, lat: p.lat, lon: p.lon }) }
                : undefined
            }
          >
            {clickable ? (
              // Hover tooltip (not permanent) — shows full port name so
              // the operator can confirm before clicking.
              <Tooltip direction="top" offset={[0, -6]} className="fleet-port-label">
                <span style={{ fontSize: "10px", color: "#22d3ee", fontWeight: 600 }}>
                  + {p.name}
                </span>
              </Tooltip>
            ) : (
              showLabels && (
                <Tooltip
                  permanent
                  direction="right"
                  offset={[6, 0]}
                  className="fleet-port-label fleet-ref-label"
                >
                  <span style={{ fontSize: "9px", color: "#cbd5e1", fontWeight: 400, opacity: 0.75 }}>
                    {p.name.split(",")[0]}
                  </span>
                </Tooltip>
              )
            )}
          </CircleMarker>
        );
      })}
    </>
  );
}

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
  /** Estimated hours to discharge port (null if not sailing or no discharge coords) */
  etaHours: number | null;
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

export interface PortMarker {
  name: string;
  port: string;
  type: string; // terminal, agent, inspector, broker
  lat: number;
  lng: number;
}

export interface PlannerRouteLeg {
  from: string;
  to: string;
  coordinates: [number, number][];
  /** Optional per-leg color — used by compare-mode to tint Route B. */
  color?: string;
}

interface FleetMapProps {
  vessels: FleetVessel[];
  portMarkers: PortMarker[];
  selectedVesselId: string | null;
  onSelectVessel: (id: string | null) => void;
  /** Planner route legs to draw on the map */
  plannerRouteLegs?: PlannerRouteLeg[];
  /**
   * Port waypoints from the planner (shown as numbered markers).
   * Optional per-waypoint color so compare-mode can render Route A
   * waypoints in cyan and Route B waypoints in magenta.
   */
  plannerWaypoints?: Array<{ name: string; lat: number; lon: number; color?: string }>;
  /** Render the ECA/SECA emission-zone polygons as a translucent overlay. */
  showEmissionZones?: boolean;
  /** Render the piracy / war-risk / tension zones as a red-family overlay. */
  showRiskZones?: boolean;
  /**
   * When set, reference-port dots become clickable and invoke this with
   * the picked port's name + coords. Wired by the page to planner mode.
   */
  onPortClick?: (port: { name: string; lat: number; lon: number }) => void;
  /**
   * When set, clicking on empty water (not a port) fires this with the
   * click coordinates. Used by the planner to insert a custom waypoint.
   */
  onMapClick?: (coords: { lat: number; lon: number }) => void;
}

export function FleetMapInner({
  vessels,
  portMarkers,
  selectedVesselId,
  onSelectVessel,
  plannerRouteLegs = [],
  plannerWaypoints = [],
  showEmissionZones = false,
  showRiskZones = false,
  onPortClick,
  onMapClick,
}: FleetMapProps) {
  // Compute route lines for vessels using pre-computed ocean routing paths.
  // These paths come from our 0.1° water-grid Dijkstra — never cross land.
  const routes = useMemo(() => {
    return vessels
      .filter((v) => v.loadport && v.dischargePort)
      .map((v) => {
        const from = findPortCoordinates(v.loadport);
        const to = findPortCoordinates(v.dischargePort);
        if (!from || !to) return null;

        // Resolve canonical port names for our ocean routing lookup
        const fromCanonical = v.loadport ? findPort(v.loadport) : null;
        const toCanonical = v.dischargePort ? findPort(v.dischargePort) : null;

        let points: [number, number][] | null = null;
        if (fromCanonical && toCanonical) {
          points = getSeaRoutePath(fromCanonical, toCanonical);
        }

        // Fallback: direct straight segment
        if (!points) {
          points = [[from.lat, from.lng], [to.lat, to.lng]];
        }

        // Always render as great-circle arcs — map is Mercator but the
        // Earth is round. Each consecutive pair of waypoints becomes a
        // geodesic arc, producing the characteristic poleward bulge of a
        // real transatlantic route. Hand-drawn paths are designed with
        // sparse waypoints so the arcs blend smoothly without visible
        // kinks at the joins.
        const renderPoints = toGeodesic(points);

        return {
          id: v.id,
          color: STATUS_COLORS[v.status] ?? "#6B7280",
          points: renderPoints,
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
      center={[42, 10]}
      zoom={4}
      minZoom={2}
      worldCopyJump={true}
      style={{ width: "100%", height: "100%", background: "#0a0c10", zIndex: 0 }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer
        // Dual attribution — CARTO hosts + styles the tiles, OpenStreetMap
        // contributors provide the underlying map data. Both are legally
        // required (ODbL for OSM, CARTO free-tier terms for the basemap).
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
        url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        noWrap={false}
      />

      {/* ECA/SECA emission-zone overlay — Netpas-style rendering:
          (1) a soft orange fill over the full regulatory area, and
          (2) the straight regulatory boundary lines drawn on top.
          Coastal borders are not drawn — the basemap's own coastlines
          already mark where water ends, so extra lines there would be
          redundant. Pure visual: does not influence routing. */}
      {showEmissionZones && EMISSION_ZONES.map((zone) => (
        <Polygon
          key={`eca-fill-${zone.id}`}
          positions={zone.fillPolygon}
          pathOptions={ECA_FILL_STYLE}
        >
          <Tooltip direction="center" sticky className="fleet-port-label">
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#f97316" }}>
                {zone.name}
              </div>
              <div style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "JetBrains Mono, monospace" }}>
                {zone.type} · {zone.effective}
              </div>
            </div>
          </Tooltip>
        </Polygon>
      ))}
      {showEmissionZones && EMISSION_ZONES.flatMap((zone) =>
        zone.boundaries.map((line, i) => (
          <Polyline
            key={`eca-line-${zone.id}-${i}`}
            positions={line}
            pathOptions={ECA_BOUNDARY_STYLE}
          />
        ))
      )}

      {/* Risk-zone overlay — piracy / war / tension areas in red/amber.
          Rendered AFTER ECA so danger zones stay visible when an
          operator has both overlays enabled (e.g. Red Sea SECA + Houthi
          war risk co-exist and should both be legible). Same visual
          pattern: filled polygon + tooltip with hover info. No
          boundary polylines — the polygon stroke doubles as the
          boundary, and the shape is the information. */}
      {showRiskZones && RISK_ZONES.map((zone) => {
        const style = RISK_STYLES[zone.type];
        return (
          <Polygon
            key={`risk-${zone.id}`}
            positions={zone.fillPolygon}
            pathOptions={{
              color: style.borderColor,
              opacity: style.borderOpacity,
              weight: style.weight,
              fillColor: style.fillColor,
              fillOpacity: style.fillOpacity,
            }}
          >
            <Tooltip direction="center" sticky className="fleet-port-label">
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: style.borderColor }}>
                  {zone.name}
                </div>
                <div style={{ fontSize: "9px", color: "#fca5a5", fontFamily: "JetBrains Mono, monospace" }}>
                  {RISK_TYPE_LABELS[zone.type]} · since {zone.since}
                </div>
                <div style={{ fontSize: "9px", color: "#9aa0ad", marginTop: "2px" }}>
                  {zone.note}
                </div>
              </div>
            </Tooltip>
          </Polygon>
        );
      })}

      {/* Reference ports (all 190 curated ports) — small gray dots at
          every zoom, names appearing at zoom ≥5. When the planner is
          open, dots become cyan-highlighted and clickable (click = add
          port to waypoints). We no longer exclude core terminals or
          party ports since they're not drawn as separate markers
          anymore — reference dots are the single source of port
          visuals. */}
      <ReferencePortsLayer excludedNames={new Set<string>()} onPortClick={onPortClick} />

      {/* Map-click capture — fires only when the planner passes
          an onMapClick handler (so this is a no-op when the
          planner panel is closed). */}
      <MapClickCapture onMapClick={onMapClick} />

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

      {/* Party-port markers (core terminals, agents, inspectors, brokers)
          were previously drawn here as colored CircleMarkers — terminals
          in orange with permanent labels, others in blue/green/purple.
          Removed per operator feedback: the orange terminal labels didn't
          add value over the basemap city labels + the REFERENCE_PORTS dot
          layer, and they cluttered the map near ARA ports. Data is still
          fetched into `portMarkers` state (see page.tsx) in case we bring
          this back with a different visual treatment. */}

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
            {/* Permanent label — className forces dark theme even on permanent tooltips */}
            <Tooltip permanent direction="right" offset={[20, 0]} className="fleet-vessel-label">
              <div>
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

      {/* Planner route polylines — rendered as great-circle arcs so
          long-haul legs bulge poleward correctly on the Mercator base.
          Per-leg color lets compare-mode draw Route A (cyan) and
          Route B (magenta) distinctly on the same map. */}
      {plannerRouteLegs.map((leg, i) => (
        <Polyline
          key={`planner-leg-${i}`}
          positions={toGeodesic(leg.coordinates as [number, number][])}
          pathOptions={{
            color: leg.color ?? "#22d3ee",
            weight: 3,
            opacity: 0.8,
            dashArray: undefined,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      ))}

      {/* Planner waypoint markers — numbered cyan circles */}
      {plannerWaypoints.map((wp, i) => {
        // Custom waypoints (name starts with "@") render with a dashed
        // border + diamond-feel to visually distinguish them from real
        // ports. Label shows coordinates rather than a city name.
        // Per-waypoint `color` lets compare-mode tint Route B magenta.
        const isCustom = wp.name.startsWith("@");
        const color = wp.color ?? "#22d3ee";
        return (
          <CircleMarker
            key={`planner-wp-${i}`}
            center={[wp.lat, wp.lon]}
            radius={10}
            pathOptions={{
              color,
              fillColor: isCustom ? "#1e293b" : "#0e1117",
              fillOpacity: 0.9,
              weight: 2.5,
              dashArray: isCustom ? "3 3" : undefined,
            }}
          >
            <Tooltip permanent direction="bottom" offset={[0, 12]} className="fleet-port-label">
              <span style={{ fontSize: "9px", color, fontWeight: 700 }}>
                {isCustom
                  ? wp.name.replace(/^@\s*/, "").toUpperCase()
                  : wp.name.split(",")[0].toUpperCase()}
              </span>
            </Tooltip>
          </CircleMarker>
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
