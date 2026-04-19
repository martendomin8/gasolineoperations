"use client";

/**
 * Fleet map — MapLibre GL JS variant.
 *
 * Replaces the Leaflet-based fleet-map.tsx so we can:
 *  1. Switch between 2D Mercator and 3D globe projection with a
 *     single `projection` prop (MapLibre v5+ native feature).
 *  2. Run per-pixel WebGL shading for weather overlays later
 *     (wind particles, wave tiles) — impossible with Leaflet SVG.
 *
 * Keeps the same exported shape (FleetVessel, PlannerRouteLeg,
 * STATUS_COLORS, STATUS_LABELS, FleetMapInner) so page.tsx only
 * needs its import path changed when we swap.
 *
 * Coordinate convention note: MapLibre uses [lon, lat] pairs
 * everywhere (GeoJSON standard), while Leaflet used [lat, lon].
 * All GeoJSON we emit here is [lon, lat]; our input prop arrays
 * (e.g. PlannerRouteLeg.coordinates: [[lat, lon], ...]) stay as
 * before and we swap when building the GeoJSON.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MapLibreMap,
  Source,
  Layer,
  Marker,
  Popup,
  NavigationControl,
  AttributionControl,
  useMap,
} from "react-map-gl/maplibre";
import type {
  LayerProps,
  MapLayerMouseEvent,
  MapRef,
  ProjectionSpecification,
} from "react-map-gl/maplibre";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import greatCircle from "@turf/great-circle";
// @ts-expect-error — @turf/helpers ships types but doesn't expose them via package.json "exports"
import { point as turfPoint } from "@turf/helpers";

import { findPortCoordinates } from "@/lib/geo/ports";
import { getAllPorts, getSeaRoutePath, findPort } from "@/lib/maritime/sea-distance";
import {
  EMISSION_ZONES,
  ECA_FILL_STYLE,
  ECA_BOUNDARY_STYLE,
} from "@/lib/maritime/emission-zones";
import {
  RISK_ZONES,
  RISK_STYLES,
  RISK_TYPE_LABELS,
} from "@/lib/maritime/risk-zones";

// ── Exported types (same shape as the Leaflet fleet-map) ─────

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
  etaHours: number | null;
}

export interface PortMarker {
  name: string;
  port: string;
  type: string;
  lat: number;
  lng: number;
}

export interface PlannerRouteLeg {
  from: string;
  to: string;
  coordinates: [number, number][]; // [lat, lon] pairs (matches API shape)
  color?: string;
}

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

// ── Basemap style — CARTO dark (MapLibre-compatible vector) ──

// CARTO publishes a gl-style.json mirror of the dark_all raster we
// used with Leaflet. Using their hosted style means attribution,
// sprites and tiles all come from one CDN with no setup.
const BASEMAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// ── Geodesic helper (still needed for route arc curves) ──────

/**
 * Turn a multi-point path into a dense great-circle polyline so
 * transatlantic legs bulge poleward the way a real ship sails.
 * Same implementation as the Leaflet version — only coordinate
 * convention differs: we return [lon, lat] pairs here to match
 * MapLibre GeoJSON.
 */
function toGeodesicGeoJson(
  path: Array<[number, number]>,
  pointsPerSegment = 20
): Array<[number, number]> {
  if (path.length < 2) return path.map(([lat, lon]) => [lon, lat]);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = turfPoint([path[i][1], path[i][0]]);
    const to = turfPoint([path[i + 1][1], path[i + 1][0]]);
    try {
      const arc = greatCircle(from, to, { npoints: pointsPerSegment });
      const geom = arc.geometry;
      const rings: number[][][] =
        geom.type === "MultiLineString"
          ? (geom.coordinates as number[][][])
          : [geom.coordinates as number[][]];
      for (const ring of rings) {
        for (let j = 0; j < ring.length; j++) {
          if (out.length > 0 && j === 0) continue;
          out.push([ring[j][0], ring[j][1]]); // [lon, lat]
        }
      }
    } catch {
      out.push([path[i][1], path[i][0]]);
      out.push([path[i + 1][1], path[i + 1][0]]);
    }
  }
  return out;
}

// ── Reference ports set ──────────────────────────────────────

const REFERENCE_PORTS = getAllPorts();
const LABEL_MIN_ZOOM = 5;

// ── Route-arc helper (mock vessel positions → curved line) ───

function computeRouteArc(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Array<[number, number]> {
  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const dist = Math.sqrt((to.lat - from.lat) ** 2 + (to.lng - from.lng) ** 2);
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const offsetLat = midLat + -dx * 0.1;
  const offsetLng = midLng + dy * 0.1;
  const pts: Array<[number, number]> = [];
  const steps = Math.max(20, Math.floor(dist * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat =
      (1 - t) ** 2 * from.lat + 2 * (1 - t) * t * offsetLat + t ** 2 * to.lat;
    const lng =
      (1 - t) ** 2 * from.lng + 2 * (1 - t) * t * offsetLng + t ** 2 * to.lng;
    pts.push([lng, lat]);
  }
  return pts;
}

// Keep the arc helper reachable (currently unused while we finish
// migrating — route arcs now come from the pre-computed ocean graph,
// not this quadratic-bezier fallback). Suppress the TS unused-var
// warning without deleting the code so we can revisit later.
void computeRouteArc;

// ── Component ────────────────────────────────────────────────

interface FleetMapProps {
  vessels: FleetVessel[];
  portMarkers: PortMarker[];
  selectedVesselId: string | null;
  onSelectVessel: (id: string | null) => void;
  plannerRouteLegs?: PlannerRouteLeg[];
  plannerWaypoints?: Array<{ name: string; lat: number; lon: number; color?: string }>;
  showEmissionZones?: boolean;
  showRiskZones?: boolean;
  onPortClick?: (port: { name: string; lat: number; lon: number }) => void;
  onMapClick?: (coords: { lat: number; lon: number }) => void;
  /** 2D Mercator or 3D globe — toggled from the planner header. */
  projection?: "mercator" | "globe";
}

// ID constants for GeoJSON sources/layers. MapLibre requires stable
// string ids; collect them in one place so we can reference them
// from handlers without typos.
const SRC_REFERENCE_PORTS = "src-ref-ports";
const LYR_REFERENCE_PORTS = "lyr-ref-ports";
const LYR_REFERENCE_PORTS_LABEL = "lyr-ref-ports-label";
const SRC_VESSEL_ROUTES = "src-vessel-routes";
const LYR_VESSEL_ROUTES = "lyr-vessel-routes";
const SRC_PLANNER_ROUTES = "src-planner-routes";
const LYR_PLANNER_ROUTES = "lyr-planner-routes";
const SRC_ECA_FILL = "src-eca-fill";
const LYR_ECA_FILL = "lyr-eca-fill";
const SRC_ECA_BOUNDARY = "src-eca-boundary";
const LYR_ECA_BOUNDARY = "lyr-eca-boundary";
const SRC_RISK = "src-risk";
const LYR_RISK_FILL = "lyr-risk-fill";
const LYR_RISK_BORDER = "lyr-risk-border";

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
  projection = "mercator",
}: FleetMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [hoveredZone, setHoveredZone] = useState<{
    kind: "eca" | "risk";
    id: string;
    lon: number;
    lat: number;
  } | null>(null);

  // ── Reference ports GeoJSON (static, memoised) ────────────
  const referencePortsGeoJson = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: REFERENCE_PORTS.map((p) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [p.lon, p.lat],
        },
        properties: {
          name: p.name,
          shortName: p.name.split(",")[0],
        },
      })),
    };
  }, []);

  // ── Vessel route lines GeoJSON ────────────────────────────
  const vesselRoutesGeoJson = useMemo(() => {
    const features = vessels
      .filter((v) => v.loadport && v.dischargePort)
      .map((v) => {
        const from = findPortCoordinates(v.loadport);
        const to = findPortCoordinates(v.dischargePort);
        if (!from || !to) return null;

        const fromCanon = v.loadport ? findPort(v.loadport) : null;
        const toCanon = v.dischargePort ? findPort(v.dischargePort) : null;
        let points: Array<[number, number]> | null = null;
        if (fromCanon && toCanon) {
          points = getSeaRoutePath(fromCanon, toCanon);
        }
        if (!points) {
          points = [
            [from.lat, from.lng],
            [to.lat, to.lng],
          ];
        }
        const lonLat = toGeodesicGeoJson(points);
        return {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: lonLat,
          },
          properties: {
            vesselId: v.id,
            color: STATUS_COLORS[v.status] ?? "#6B7280",
            isSelected: v.id === selectedVesselId,
          },
        };
      })
      .filter(Boolean);
    return {
      type: "FeatureCollection" as const,
      features: features as GeoJSON.Feature[],
    };
  }, [vessels, selectedVesselId]);

  // ── Planner route lines GeoJSON ───────────────────────────
  const plannerRoutesGeoJson = useMemo(() => {
    const features = plannerRouteLegs.map((leg, i) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: toGeodesicGeoJson(leg.coordinates),
      },
      properties: {
        legIdx: i,
        color: leg.color ?? "#22d3ee",
      },
    }));
    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [plannerRouteLegs]);

  // ── ECA/SECA polygons GeoJSON ─────────────────────────────
  const ecaFillGeoJson = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: EMISSION_ZONES.map((z) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          // MapLibre wants [lon, lat] pairs. Our source data is [lat, lon].
          coordinates: [z.fillPolygon.map(([lat, lon]) => [lon, lat])],
        },
        properties: {
          id: z.id,
          name: z.name,
          type: z.type,
          effective: z.effective,
        },
      })),
    };
  }, []);

  const ecaBoundaryGeoJson = useMemo(() => {
    const features = EMISSION_ZONES.flatMap((z) =>
      z.boundaries.map((line, i) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: line.map(([lat, lon]) => [lon, lat]),
        },
        properties: { zoneId: z.id, lineIdx: i },
      }))
    );
    return { type: "FeatureCollection" as const, features };
  }, []);

  // ── Risk zones GeoJSON ────────────────────────────────────
  const riskGeoJson = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: RISK_ZONES.map((z) => {
        const s = RISK_STYLES[z.type];
        return {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [z.fillPolygon.map(([lat, lon]) => [lon, lat])],
          },
          properties: {
            id: z.id,
            name: z.name,
            type: z.type,
            since: z.since,
            note: z.note,
            fillColor: s.fillColor,
            fillOpacity: s.fillOpacity,
            borderColor: s.borderColor,
            borderOpacity: s.borderOpacity,
            weight: s.weight,
          },
        };
      }),
    };
  }, []);

  // ── Layer style specs ─────────────────────────────────────
  const referencePortsCircleLayer: LayerProps = useMemo(
    () => ({
      id: LYR_REFERENCE_PORTS,
      type: "circle",
      source: SRC_REFERENCE_PORTS,
      paint: {
        "circle-radius": onPortClick ? 4 : 2,
        "circle-color": onPortClick ? "#22d3ee" : "#94a3b8",
        "circle-opacity": onPortClick ? 0.8 : 0.55,
      },
    }),
    [onPortClick]
  );

  const referencePortsLabelLayer: LayerProps = useMemo(
    () => ({
      id: LYR_REFERENCE_PORTS_LABEL,
      type: "symbol",
      source: SRC_REFERENCE_PORTS,
      minzoom: LABEL_MIN_ZOOM,
      layout: {
        "text-field": ["get", "shortName"],
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-size": 10,
        "text-anchor": "left",
        "text-offset": [0.6, 0],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#cbd5e1",
        "text-opacity": 0.75,
      },
    }),
    []
  );

  const vesselRoutesLayer: LayerProps = {
    id: LYR_VESSEL_ROUTES,
    type: "line",
    source: SRC_VESSEL_ROUTES,
    paint: {
      "line-color": [
        "case",
        ["get", "isSelected"],
        "#FFB000",
        ["get", "color"],
      ] as unknown as string,
      "line-width": [
        "case",
        ["get", "isSelected"],
        2,
        1.5,
      ] as unknown as number,
      "line-opacity": [
        "case",
        ["get", "isSelected"],
        0.6,
        0.25,
      ] as unknown as number,
      "line-dasharray": [2, 2.5],
    },
    layout: { "line-cap": "round" },
  };

  const plannerRoutesLayer: LayerProps = {
    id: LYR_PLANNER_ROUTES,
    type: "line",
    source: SRC_PLANNER_ROUTES,
    paint: {
      "line-color": ["get", "color"] as unknown as string,
      "line-width": 3,
      "line-opacity": 0.8,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  };

  const ecaFillLayer: LayerProps = {
    id: LYR_ECA_FILL,
    type: "fill",
    source: SRC_ECA_FILL,
    paint: {
      "fill-color": ECA_FILL_STYLE.fillColor,
      "fill-opacity": ECA_FILL_STYLE.fillOpacity,
    },
  };

  const ecaBoundaryLayer: LayerProps = {
    id: LYR_ECA_BOUNDARY,
    type: "line",
    source: SRC_ECA_BOUNDARY,
    paint: {
      "line-color": ECA_BOUNDARY_STYLE.color,
      "line-width": ECA_BOUNDARY_STYLE.weight,
      "line-opacity": ECA_BOUNDARY_STYLE.opacity,
    },
    layout: { "line-cap": "round" },
  };

  const riskFillLayer: LayerProps = {
    id: LYR_RISK_FILL,
    type: "fill",
    source: SRC_RISK,
    paint: {
      "fill-color": ["get", "fillColor"] as unknown as string,
      "fill-opacity": ["get", "fillOpacity"] as unknown as number,
    },
  };

  const riskBorderLayer: LayerProps = {
    id: LYR_RISK_BORDER,
    type: "line",
    source: SRC_RISK,
    paint: {
      "line-color": ["get", "borderColor"] as unknown as string,
      "line-opacity": ["get", "borderOpacity"] as unknown as number,
      "line-width": ["get", "weight"] as unknown as number,
    },
    layout: { "line-cap": "round" },
  };

  // ── Layers that should respond to hover/click ─────────────
  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [];
    if (onPortClick) ids.push(LYR_REFERENCE_PORTS);
    if (showEmissionZones) ids.push(LYR_ECA_FILL);
    if (showRiskZones) ids.push(LYR_RISK_FILL);
    return ids;
  }, [onPortClick, showEmissionZones, showRiskZones]);

  // ── Map click handler (port clicks + click-anywhere water) ─
  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const features = e.features ?? [];
      // Port-click first — if the top feature under cursor is a
      // reference-port dot, route to onPortClick with its data.
      const portHit = features.find((f) => f.layer.id === LYR_REFERENCE_PORTS);
      if (portHit && onPortClick) {
        const props = portHit.properties as { name: string };
        const [lon, lat] = (portHit.geometry as GeoJSON.Point).coordinates;
        onPortClick({ name: props.name, lat, lon });
        return;
      }
      // Otherwise treat as a water click — fire onMapClick.
      if (onMapClick) {
        onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      }
    },
    [onPortClick, onMapClick]
  );

  // ── Hover popups for zone overlays ────────────────────────
  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features ?? [];
    const eca = features.find((f) => f.layer.id === LYR_ECA_FILL);
    const risk = features.find((f) => f.layer.id === LYR_RISK_FILL);
    if (eca) {
      const p = eca.properties as { id: string };
      setHoveredZone({ kind: "eca", id: p.id, lon: e.lngLat.lng, lat: e.lngLat.lat });
    } else if (risk) {
      const p = risk.properties as { id: string };
      setHoveredZone({ kind: "risk", id: p.id, lon: e.lngLat.lng, lat: e.lngLat.lat });
    } else if (hoveredZone) {
      setHoveredZone(null);
    }
  }, [hoveredZone]);

  // ── Imperative projection switch (mercator ↔ globe) ───────
  // MapLibre's projection is a style-level setting. Setting it via
  // the declarative prop on <Map> doesn't always re-render cleanly,
  // so we call setProjection on the underlying instance when the
  // prop changes.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const spec: ProjectionSpecification = { type: projection };
    try {
      map.setProjection(spec);
    } catch {
      // Older MapLibre versions don't have the method — silently ignore.
    }
  }, [projection]);

  return (
    <MapLibreMap
      ref={mapRef}
      initialViewState={{
        longitude: 10,
        latitude: 42,
        zoom: 3,
      }}
      minZoom={1.5}
      mapStyle={BASEMAP_STYLE_URL}
      style={{ width: "100%", height: "100%", background: "#0a0c10" }}
      attributionControl={false}
      interactiveLayerIds={interactiveLayerIds}
      onClick={handleMapClick}
      onMouseMove={handleMouseMove}
      // Cursor feedback when hovering a clickable port or zone.
      cursor={interactiveLayerIds.length > 0 && hoveredZone ? "pointer" : undefined}
    >
      <NavigationControl position="top-left" showCompass={false} />
      <AttributionControl
        position="bottom-right"
        compact
        customAttribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
      />

      {/* ── ECA/SECA fill + boundaries (below routes so ships stay on top) ── */}
      {showEmissionZones && (
        <>
          <Source id={SRC_ECA_FILL} type="geojson" data={ecaFillGeoJson}>
            <Layer {...ecaFillLayer} />
          </Source>
          <Source id={SRC_ECA_BOUNDARY} type="geojson" data={ecaBoundaryGeoJson}>
            <Layer {...ecaBoundaryLayer} />
          </Source>
        </>
      )}

      {/* ── Risk zones (war/piracy/tension) ── */}
      {showRiskZones && (
        <Source id={SRC_RISK} type="geojson" data={riskGeoJson}>
          <Layer {...riskFillLayer} />
          <Layer {...riskBorderLayer} />
        </Source>
      )}

      {/* ── Reference-port dots (always on) ── */}
      <Source id={SRC_REFERENCE_PORTS} type="geojson" data={referencePortsGeoJson}>
        <Layer {...referencePortsCircleLayer} />
        <Layer {...referencePortsLabelLayer} />
      </Source>

      {/* ── Vessel route lines (dashed, faint) ── */}
      <Source id={SRC_VESSEL_ROUTES} type="geojson" data={vesselRoutesGeoJson}>
        <Layer {...vesselRoutesLayer} />
      </Source>

      {/* ── Planner route lines (solid cyan or magenta for compare-B) ── */}
      <Source id={SRC_PLANNER_ROUTES} type="geojson" data={plannerRoutesGeoJson}>
        <Layer {...plannerRoutesLayer} />
      </Source>

      {/* ── Party port markers (terminals/agents/inspectors) ── */}
      {portMarkers.map((p) => (
        <Marker key={`${p.port}-${p.type}`} longitude={p.lng} latitude={p.lat} anchor="center">
          <div
            title={`${p.name} (${p.type})`}
            style={{
              width: p.type === "terminal" ? 12 : 10,
              height: p.type === "terminal" ? 12 : 10,
              borderRadius: "50%",
              background:
                p.type === "terminal"
                  ? "rgba(255,176,0,0.3)"
                  : "rgba(59,130,246,0.2)",
              border: `1px solid ${
                p.type === "terminal" ? "#FFB00060" : "#3b82f660"
              }`,
            }}
          />
        </Marker>
      ))}

      {/* ── Vessel ship markers (HTML w/ rotation + glow) ── */}
      {vessels.map((v) => {
        const color = STATUS_COLORS[v.status] ?? "#6B7280";
        const isSelected = v.id === selectedVesselId;
        const glowColor = v.isUrgent ? "#ef4444" : isSelected ? "#FFB000" : color;
        const innerColor = isSelected ? "#FFB000" : color;
        const ringSize = isSelected ? 3 : 2;
        const roundedHeading = Math.round(v.heading / 30) * 30;
        return (
          <Marker
            key={v.id}
            longitude={v.position.lng}
            latitude={v.position.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onSelectVessel(v.id === selectedVesselId ? null : v.id);
            }}
          >
            <div
              className={v.isUrgent ? "fleet-pulse" : ""}
              style={{
                width: 40,
                height: 40,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {/* Glow ring */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: `${glowColor}18`,
                  boxShadow: `0 0 ${v.isUrgent ? 16 : 10}px ${glowColor}40`,
                  border: `${ringSize}px solid ${glowColor}60`,
                }}
              />
              {/* Inner filled circle with heading arrow */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: innerColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="white"
                  stroke="none"
                  style={{ transform: `rotate(${roundedHeading}deg)` }}
                >
                  <polygon points="12,2 20,20 12,16 4,20" />
                </svg>
              </div>
              {/* Permanent vessel name label */}
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% + 8px)",
                  top: "50%",
                  transform: "translateY(-50%)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: isSelected ? "#FFB000" : "#FAFAF7",
                    textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                  }}
                >
                  {v.vesselName}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color,
                    fontFamily: "JetBrains Mono, monospace",
                    textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                  }}
                >
                  {v.linkageCode}
                </div>
              </div>
            </div>
          </Marker>
        );
      })}

      {/* ── Planner waypoint numbered markers ── */}
      {plannerWaypoints.map((wp, i) => {
        const isCustom = wp.name.startsWith("@");
        const color = wp.color ?? "#22d3ee";
        return (
          <Marker
            key={`planner-wp-${i}`}
            longitude={wp.lon}
            latitude={wp.lat}
            anchor="center"
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: isCustom ? "#1e293b" : "#0e1117",
                border: `2.5px ${isCustom ? "dashed" : "solid"} ${color}`,
                boxShadow: `0 0 6px ${color}60`,
                position: "relative",
                cursor: "default",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                  fontSize: 9,
                  fontWeight: 700,
                  color,
                  textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                  pointerEvents: "none",
                }}
              >
                {isCustom
                  ? wp.name.replace(/^@\s*/, "").toUpperCase()
                  : wp.name.split(",")[0].toUpperCase()}
              </div>
            </div>
          </Marker>
        );
      })}

      {/* ── Zone hover popup ── */}
      {hoveredZone && (
        <Popup
          longitude={hoveredZone.lon}
          latitude={hoveredZone.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={10}
          className="fleet-zone-popup"
        >
          {hoveredZone.kind === "eca"
            ? (() => {
                const z = EMISSION_ZONES.find((x) => x.id === hoveredZone.id);
                if (!z) return null;
                return (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f97316" }}>
                      {z.name}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#fbbf24",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {z.type} · {z.effective}
                    </div>
                  </div>
                );
              })()
            : (() => {
                const z = RISK_ZONES.find((x) => x.id === hoveredZone.id);
                if (!z) return null;
                const s = RISK_STYLES[z.type];
                return (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: s.borderColor }}>
                      {z.name}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#fca5a5",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {RISK_TYPE_LABELS[z.type]} · since {z.since}
                    </div>
                    <div style={{ fontSize: 9, color: "#9aa0ad", marginTop: 2 }}>
                      {z.note}
                    </div>
                  </div>
                );
              })()}
        </Popup>
      )}

      {/* ── Status legend (fixed HTML overlay, not a map feature) ── */}
      <StatusLegend />
    </MapLibreMap>
  );
}

function StatusLegend() {
  // `useMap` hooks us into the MapLibre instance — we don't need it
  // here but leaving the import live for future DOM-measuring needs
  // (e.g. positioning the legend relative to the map viewport).
  void useMap;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 28,
        right: 10,
        pointerEvents: "auto",
        background: "rgba(15, 17, 21, 0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid #272d3a",
        borderRadius: 8,
        padding: "8px 12px",
        zIndex: 1,
      }}
    >
      {Object.entries(STATUS_COLORS)
        .filter(([k]) => k !== "completed")
        .map(([status, color]) => (
          <div
            key={status}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 0",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 6px ${color}60`,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: "#9aa0ad",
                textTransform: "capitalize",
              }}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
        ))}
    </div>
  );
}
