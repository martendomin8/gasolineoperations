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
import type maplibregl from "maplibre-gl";
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

// ── Basemap styles — Mercator uses CARTO dark, Globe uses NASA ──

// CARTO publishes a gl-style.json mirror of the dark_all raster we
// used with Leaflet. Using their hosted style means attribution,
// sprites and tiles all come from one CDN with no setup.
const MERCATOR_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Satellite basemap — EOX Sentinel-2 Cloudless.
 *
 * Works with either Mercator or globe projection; user picks via
 * the floating basemap toggle on the top-left of the map.
 *
 * Source choice rationale (2026-04-19):
 *  - Started with NASA GIBS Blue Marble (500m/px, cloud-free but
 *    soft at close zoom) + MODIS Terra daily (250m/px, higher res
 *    BUT has orbital-swath black stripes and daily cloud cover that
 *    obscures vessel routes). MODIS looked broken, Blue Marble alone
 *    was too low-res when zoomed in. Both dropped.
 *  - Settled on EOX Sentinel-2 Cloudless: a pre-processed global
 *    cloud-free composite built from a year of Sentinel-2
 *    observations. 10m/px native, seamless (no orbital stripes),
 *    no clouds, no signup / no API key.
 *  - License: Copernicus Data License + CC BY 4.0 on the
 *    composite — commercial use allowed with attribution.
 *
 * FUTURE UPGRADE PATH (when we want submeter sharp at close zoom):
 *   Swap the source below for Mapbox Satellite or MapTiler Satellite.
 *   Both need a free API key (~15 min signup) and have free tiers
 *   covering ~50k-500k loads/mo. Above that: $5-40/mo for the
 *   whole company, not per-user. At 5000 active users it's still
 *   well under 1% of SaaS revenue — safe to upgrade whenever a
 *   customer asks for "nicer satellite imagery".
 *
 *   Mapbox swap example (when ready, with MAPBOX_TOKEN in env):
 *     mapStyle = "mapbox://styles/mapbox/satellite-streets-v12"
 *     // + add accessToken={MAPBOX_TOKEN} on <Map>
 *
 * raster-resampling: "nearest" keeps pixels crisp rather than
 * smearing during zoom — sharper look on retina screens.
 */
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "Earth — Sentinel-2 Cloudless",
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "s2-cloudless": {
      type: "raster",
      // EOX hosts the Sentinel-2 Cloudless composite on a public
      // WMTS endpoint — no API key, commercial use permitted under
      // the Copernicus Data License. The "2023_3857" slug picks
      // the 2023 vintage in EPSG:3857 (Web Mercator), which is
      // the freshest currently published.
      tiles: [
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
      maxzoom: 15,
      attribution:
        'Sentinel-2 Cloudless &copy; <a href="https://s2maps.eu" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2023)',
    },
  },
  layers: [
    {
      // Pitch-black background shows through around the globe when
      // the projection leaves empty canvas — gives a space feel.
      id: "space-background",
      type: "background",
      paint: { "background-color": "#000000" },
    },
    {
      id: "s2-cloudless",
      type: "raster",
      source: "s2-cloudless",
      paint: {
        // "nearest" keeps pixels crisp at zoom transitions rather
        // than the default "linear" which smears mid-zoom.
        "raster-resampling": "nearest",
      },
    },
  ],
  sky: {
    // Atmospheric haze around the globe silhouette. Subtle blue
    // tint + horizon blend for the "Earth from orbit" look.
    "sky-color": "#0b1020",
    "sky-horizon-blend": 0.5,
    "horizon-color": "#0a1a3a",
    "horizon-fog-blend": 0.6,
    "fog-color": "#0b0f1a",
    "fog-ground-blend": 0.2,
  },
};

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
      // Antimeridian handling: turf.greatCircle splits arcs that cross
      // ±180° into two rings (one ending at ≈-180, the next starting at
      // ≈+180). If we concat them naively the polyline snaps from -180
      // straight to +180 — MapLibre reads that as "travel 357° east
      // around the world" and draws a horizontal line across every
      // continent. Fix: unwrap each successive ring's longitudes into
      // the same continuous window as the previous ring (−360 or +360
      // shift). MapLibre's built-in antimeridian wrap handles the
      // continuous coords correctly.
      let lonShift = 0;
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        if (r > 0 && ring.length > 0 && out.length > 0) {
          const prevLon = out[out.length - 1][0];
          const firstLon = ring[0][0];
          // Expected delta is ~0 (continuous); anything > 180° means
          // turf wrapped. Shift by whichever multiple of 360 minimises
          // the gap.
          const rawDelta = firstLon - prevLon;
          if (Math.abs(rawDelta) > 180) {
            lonShift = rawDelta > 0 ? -360 : 360;
          } else {
            lonShift = 0;
          }
        }
        for (let j = 0; j < ring.length; j++) {
          if (out.length > 0 && j === 0) continue;
          out.push([ring[j][0] + lonShift, ring[j][1]]); // [lon, lat]
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
  /** 2D Mercator or 3D globe — controlled from the Fleet page header. */
  projection?: "mercator" | "globe";
  /** `dark` = CARTO dark flat style, `satellite` = EOX Sentinel-2. */
  basemap?: "dark" | "satellite";
  /**
   * Dev-only: channel chains shown/edited on the map.
   * When `activeChainId` is set, the map:
   *   - routes map clicks to `onChannelClick` (appending a waypoint)
   *   - renders waypoint markers as draggable
   *   - routes double-clicks on markers to `onChannelDeleteWaypoint`
   *   - routes shift+clicks on segments to `onChannelInsertWaypoint`
   */
  channelChains?: Array<{ id: string; label: string; waypoints: Array<[number, number]> }>;
  activeChainId?: string | null;
  onChannelClick?: (coords: { lat: number; lon: number }) => void;
  onChannelMoveWaypoint?: (idx: number, coords: { lat: number; lon: number }) => void;
  onChannelDeleteWaypoint?: (idx: number) => void;
  onChannelInsertWaypoint?: (afterIdx: number, coords: { lat: number; lon: number }) => void;
  /**
   * Dev-only: zones shown/edited on the map. Same interaction pattern
   * as chains but with polygons instead of polylines.
   */
  devZones?: Array<{
    id: string;
    label: string;
    category: "war" | "piracy" | "tension" | "forbidden" | "navigable";
    visible: boolean;
    blocksRouting: boolean;
    navigable: boolean;
    polygon: Array<[number, number]>;
  }>;
  activeZoneId?: string | null;
  onZoneClick?: (coords: { lat: number; lon: number }) => void;
  onZoneMoveVertex?: (idx: number, coords: { lat: number; lon: number }) => void;
  onZoneDeleteVertex?: (idx: number) => void;
  onZoneInsertVertex?: (afterIdx: number, coords: { lat: number; lon: number }) => void;
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
  basemap = "dark",
  channelChains = [],
  activeChainId = null,
  onChannelClick,
  onChannelMoveWaypoint,
  onChannelDeleteWaypoint,
  onChannelInsertWaypoint,
  devZones = [],
  activeZoneId = null,
  onZoneClick,
  onZoneMoveVertex,
  onZoneDeleteVertex,
  onZoneInsertVertex,
}: FleetMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [hoveredZone, setHoveredZone] = useState<{
    kind: "eca" | "risk";
    id: string;
    lon: number;
    lat: number;
  } | null>(null);

  // ── Reference ports GeoJSON (static, memoised) ────────────
  // Feature `id` is required for setFeatureState-based hover glow.
  // Using the array index gives us stable ids across renders (the
  // port list is static, order never changes mid-session).
  const referencePortsGeoJson = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: REFERENCE_PORTS.map((p, i) => ({
        type: "Feature" as const,
        id: i,
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

  // ── Channel chain polylines GeoJSON (dev tool) ───────────
  // Active chain renders amber + bolder; inactive chains render in
  // a dim amber so the operator can still see existing chains for
  // context without mistaking them for editable.
  const channelChainsGeoJson = useMemo(() => {
    const features = channelChains.flatMap((chain) => {
      if (chain.waypoints.length < 2) return [];
      const lonLat: Array<[number, number]> = chain.waypoints.map(
        ([lat, lon]) => [lon, lat]
      );
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            // Channel chains are DENSE by design — the hand-drawn
            // waypoints already trace the actual channel centerline,
            // so we do NOT run toGeodesicGeoJson here: it would
            // smooth the polyline into great-circle arcs and subtly
            // push the line outside the narrow strait.
            coordinates: lonLat,
          },
          properties: {
            chainId: chain.id,
            active: chain.id === activeChainId,
          },
        },
      ];
    });
    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [channelChains, activeChainId]);

  const activeChain = channelChains.find((c) => c.id === activeChainId);

  // ── Dev Zone polygons GeoJSON ─────────────────────────────
  // Every zone becomes a Polygon feature (MapLibre closes the ring
  // automatically) so fill + border come for free. Properties carry
  // the flags the style expression keys off: active / category /
  // blocksRouting. Non-dev zones are already rendered by the regular
  // `risk-zones` overlay below — this layer is strictly for editor
  // preview, so we also render "hidden" (visible=false) zones here
  // when the dev mode is on.
  const devZonesGeoJson = useMemo(() => {
    const features = devZones
      .filter((z) => z.polygon.length >= 3)
      .map((z) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            z.polygon.map(([lat, lon]) => [lon, lat] as [number, number]),
          ],
        },
        properties: {
          zoneId: z.id,
          active: z.id === activeZoneId,
          category: z.category,
          blocksRouting: z.blocksRouting,
          navigable: z.navigable,
          visible: z.visible,
        },
      }));
    return { type: "FeatureCollection" as const, features };
  }, [devZones, activeZoneId]);

  const activeZone = devZones.find((z) => z.id === activeZoneId);

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
  // Two-layer strategy for port dots:
  //   - `hit` is a 12-px transparent circle that captures clicks with
  //     a forgiving tolerance (small visible dot was hard to hit at
  //     the scale ops work on).
  //   - `visible` is the tiny pretty circle the user sees. Hover
  //     glow on this one uses feature-state to brighten the active
  //     port — gives instant "yes this is clickable" feedback.
  const referencePortsHitLayer: LayerProps = useMemo(
    () => ({
      id: LYR_REFERENCE_PORTS,
      type: "circle",
      source: SRC_REFERENCE_PORTS,
      paint: {
        "circle-radius": onPortClick ? 12 : 2,
        "circle-color": "#000",
        // Fully transparent but still hit-tests as interactive.
        "circle-opacity": 0.001,
      },
    }),
    [onPortClick]
  );

  const referencePortsVisibleLayer: LayerProps = useMemo(
    () => ({
      id: "lyr-ref-ports-visible",
      type: "circle",
      source: SRC_REFERENCE_PORTS,
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          6,
          onPortClick ? 4 : 2,
        ] as unknown as number,
        "circle-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#FFB000", // amber halo on hover — "clickable" affordance
          onPortClick ? "#22d3ee" : "#94a3b8",
        ] as unknown as string,
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1,
          onPortClick ? 0.8 : 0.55,
        ] as unknown as number,
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2,
          0,
        ] as unknown as number,
        "circle-stroke-color": "#fef3c7",
      },
    }),
    [onPortClick]
  );

  // Regular label layer — zoom-gated + collision-aware. Same as the
  // original pre-hover design except for amber color on feature-state
  // hover (paint-level, always works).
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
        "text-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#FFB000",
          "#cbd5e1",
        ] as unknown as string,
        "text-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1,
          0.75,
        ] as unknown as number,
      },
    }),
    []
  );

  // Dedicated hover-only label layer — always rendered, opacity 0
  // unless the feature is hovered. This wins over the normal label
  // layer's zoom gate: hovering a port at any zoom reveals its
  // name in larger amber text with a halo for contrast.
  const referencePortsHoverLabelLayer: LayerProps = useMemo(
    () => ({
      id: "lyr-ref-ports-hover-label",
      type: "symbol",
      source: SRC_REFERENCE_PORTS,
      layout: {
        "text-field": ["get", "shortName"],
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-size": 15,
        "text-anchor": "left",
        "text-offset": [0.6, 0],
        // Defeat collision — we only ever show one hovered label at
        // a time, so it shouldn't be hidden by a neighbour's zoom-
        // layer label.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#FFB000",
        "text-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1,
          0,
        ] as unknown as number,
        "text-halo-color": "#000",
        "text-halo-width": 1.8,
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

  // Dev-editor zones — fill coloured per category. Blocking zones
  // get a purple hue distinct from risk overlays; navigable zones
  // cyan (known-passage hint). Active zone is brighter.
  const devZonesFillLayer: LayerProps = {
    id: "lyr-dev-zones-fill",
    type: "fill",
    source: "src-dev-zones",
    paint: {
      "fill-color": [
        "match",
        ["get", "category"],
        "forbidden",
        "#a855f7",
        "navigable",
        "#22d3ee",
        "piracy",
        "#dc2626",
        "war",
        "#b91c1c",
        "tension",
        "#f59e0b",
        /* default */ "#6b7280",
      ] as unknown as string,
      "fill-opacity": [
        "case",
        ["get", "active"],
        0.28,
        0.12,
      ] as unknown as number,
    },
  };

  const devZonesBorderLayer: LayerProps = {
    id: "lyr-dev-zones-border",
    type: "line",
    source: "src-dev-zones",
    paint: {
      "line-color": [
        "match",
        ["get", "category"],
        "forbidden",
        "#c084fc",
        "navigable",
        "#67e8f9",
        "piracy",
        "#ef4444",
        "war",
        "#dc2626",
        "tension",
        "#f59e0b",
        /* default */ "#9ca3af",
      ] as unknown as string,
      "line-width": [
        "case",
        ["get", "active"],
        3,
        1.5,
      ] as unknown as number,
      "line-opacity": 0.95,
      "line-dasharray": [
        "case",
        ["get", "active"],
        ["literal", [1, 0]],
        ["literal", [4, 3]],
      ] as unknown as number[],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  };

  // Channel chains: active = solid amber, inactive = dimmed dashed.
  const channelChainsLayer: LayerProps = {
    id: "lyr-channel-chains",
    type: "line",
    source: "src-channel-chains",
    paint: {
      "line-color": [
        "case",
        ["get", "active"],
        "#f59e0b", // amber-500
        "#78350f", // amber-900 — muted for inactive chains
      ] as unknown as string,
      "line-width": [
        "case",
        ["get", "active"],
        3,
        1.5,
      ] as unknown as number,
      "line-opacity": [
        "case",
        ["get", "active"],
        0.95,
        0.55,
      ] as unknown as number,
      "line-dasharray": [
        "case",
        ["get", "active"],
        ["literal", [1, 0]],
        ["literal", [4, 3]],
      ] as unknown as number[],
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
  // Port hit-layer is always in the interactive set so the hover
  // glow works even when the planner is closed — makes the "this
  // dot is clickable" affordance permanent. Actual click is still
  // only meaningful when onPortClick is provided.
  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [LYR_REFERENCE_PORTS];
    if (showEmissionZones) ids.push(LYR_ECA_FILL);
    if (showRiskZones) ids.push(LYR_RISK_FILL);
    return ids;
  }, [showEmissionZones, showRiskZones]);

  // ── Map click handler (port clicks + click-anywhere water) ─
  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const features = e.features ?? [];
      const clickLat = e.lngLat.lat;
      const clickLon = e.lngLat.lng;
      const shift =
        (e.originalEvent as MouseEvent | undefined)?.shiftKey ?? false;
      // Zone editor takes priority when a zone is active — same shape
      // of logic as chains (append on plain click, insert-on-edge on
      // shift+click) but over polygon vertices instead of polyline
      // waypoints.
      if (activeZoneId && (onZoneClick || onZoneInsertVertex)) {
        const zone = devZones.find((z) => z.id === activeZoneId);
        const poly = zone?.polygon ?? [];
        if (shift && poly.length >= 2 && onZoneInsertVertex) {
          // Find nearest edge in the polygon (closed ring — also
          // consider the wrap-around edge from last → first).
          let bestIdx = 0;
          let bestDist = Infinity;
          const n = poly.length;
          for (let i = 0; i < n; i++) {
            const [la, lo] = poly[i];
            const [lb, lob] = poly[(i + 1) % n];
            const dx = lob - lo;
            const dy = lb - la;
            const denom = dx * dx + dy * dy;
            let t = 0.5;
            if (denom > 1e-9) {
              t = ((clickLon - lo) * dx + (clickLat - la) * dy) / denom;
              t = Math.max(0, Math.min(1, t));
            }
            const projLat = la + t * dy;
            const projLon = lo + t * dx;
            const d =
              (projLat - clickLat) * (projLat - clickLat) +
              (projLon - clickLon) * (projLon - clickLon);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          onZoneInsertVertex(bestIdx, { lat: clickLat, lon: clickLon });
          return;
        }
        if (onZoneClick) {
          onZoneClick({ lat: clickLat, lon: clickLon });
        }
        return;
      }
      // Channel editor takes priority when a chain is active. Ports get
      // ignored here so a click near a port doesn't spawn a waypoint
      // mid-harbour; the editor wants pure-water clicks.
      if (activeChainId && (onChannelClick || onChannelInsertWaypoint)) {
        const chain = channelChains.find((c) => c.id === activeChainId);
        const wps = chain?.waypoints ?? [];
        // Shift+click with at least one existing segment → insert the
        // new waypoint between the two endpoints of whichever segment
        // sits closest to the click. Falls back to append if the chain
        // has fewer than 2 waypoints (no segment exists yet).
        if (shift && wps.length >= 2 && onChannelInsertWaypoint) {
          // Find the segment whose closest-point-to-click is nearest.
          // Distance is computed in flat-plane degrees — fine for the
          // 1-100 km segments a chain typically has, and avoids
          // pulling in turf just for this one calculation.
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < wps.length - 1; i++) {
            const [la, lo] = wps[i];
            const [lb, lob] = wps[i + 1];
            const dx = lob - lo;
            const dy = lb - la;
            const denom = dx * dx + dy * dy;
            let t = 0.5;
            if (denom > 1e-9) {
              t = ((clickLon - lo) * dx + (clickLat - la) * dy) / denom;
              t = Math.max(0, Math.min(1, t));
            }
            const projLat = la + t * dy;
            const projLon = lo + t * dx;
            const d =
              (projLat - clickLat) * (projLat - clickLat) +
              (projLon - clickLon) * (projLon - clickLon);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          onChannelInsertWaypoint(bestIdx, { lat: clickLat, lon: clickLon });
          return;
        }
        if (onChannelClick) {
          onChannelClick({ lat: clickLat, lon: clickLon });
        }
        return;
      }
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
    [
      onPortClick,
      onMapClick,
      activeChainId,
      onChannelClick,
      onChannelInsertWaypoint,
      channelChains,
      activeZoneId,
      onZoneClick,
      onZoneInsertVertex,
      devZones,
    ]
  );

  // ── Hover popups for zone overlays + port hover glow ──────
  // Port hover uses MapLibre feature-state so the dot+label light up
  // amber the moment the cursor enters the (generous 12-px) hit
  // zone. Ref tracks the currently-lit feature so we can clear it
  // when the mouse leaves; a tiny paired boolean state drives the
  // cursor re-render (setFeatureState alone doesn't force React to
  // re-evaluate the `cursor` prop).
  const hoveredPortIdRef = useRef<number | null>(null);
  const [isPortHovered, setIsPortHovered] = useState(false);
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
    // Port hover glow — driven by the (much larger) hit layer so a
    // near-miss still lights up the dot. Declared dep on
    // isPortHovered so the closure reads the fresh value without
    // needing a stale-closure workaround on every mousemove.
    void isPortHovered;
    const portHit = features.find((f) => f.layer.id === LYR_REFERENCE_PORTS);
    const map = mapRef.current?.getMap();
    if (map) {
      const nextId =
        portHit && typeof portHit.id === "number" ? portHit.id : null;
      const prevId = hoveredPortIdRef.current;
      if (prevId !== nextId) {
        if (prevId !== null) {
          map.setFeatureState(
            { source: SRC_REFERENCE_PORTS, id: prevId },
            { hover: false }
          );
        }
        if (nextId !== null) {
          map.setFeatureState(
            { source: SRC_REFERENCE_PORTS, id: nextId },
            { hover: true }
          );
        }
        hoveredPortIdRef.current = nextId;
        // Cursor re-render driver — only flips on enter/leave, not
        // on every pixel of cursor motion within the dot.
        const nowHovered = nextId !== null;
        if (nowHovered !== isPortHovered) setIsPortHovered(nowHovered);
      }
    }
  }, [hoveredZone, isPortHovered]);

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
      // Swap basemap style based on the `basemap` prop (dark CARTO
      // vs EOX satellite). The `projection` prop is applied
      // imperatively via setProjection in a separate useEffect so
      // the two toggles (basemap, projection) can be combined
      // freely. MapLibre re-loads the style when this prop changes;
      // react-map-gl re-adds our Source + Layer components
      // automatically, so all overlays come back intact.
      mapStyle={basemap === "satellite" ? SATELLITE_STYLE : MERCATOR_STYLE_URL}
      style={{ width: "100%", height: "100%", background: "#0a0c10" }}
      attributionControl={false}
      interactiveLayerIds={interactiveLayerIds}
      onClick={handleMapClick}
      onMouseMove={handleMouseMove}
      // Cursor feedback — pointer when hovering a port dot (click-
      // to-add-to-planner) or a zone (hover popup).
      cursor={hoveredZone || isPortHovered ? "pointer" : undefined}
      // Disable Shift+drag area-zoom and double-click zoom when the
      // channel editor has an active chain. Both interactions eat the
      // click event before our handler sees it — boxZoom is MapLibre's
      // Shift+drag zoom rectangle, which swallows Shift+click too.
      // Without this, the operator can't insert waypoints mid-chain.
      boxZoom={!activeChainId && !activeZoneId}
      doubleClickZoom={!activeChainId && !activeZoneId}
    >
      <NavigationControl position="top-left" showCompass={false} />

      {/* Map chrome (basemap + projection toggles) lives in the Fleet
          page header — not as floating overlays on the map — because
          Arne prefers them visible alongside the Fleet title. The
          page renders the buttons and passes `projection` + `basemap`
          down here as props. */}
      {/* Attribution stays ALWAYS VISIBLE (compact={false}) so we're
          covered legally on the commercial license of every data
          source: MapLibre itself, OpenStreetMap (CARTO dark vector),
          CARTO (tiles), and — when the satellite basemap is active —
          EOX Sentinel-2 Cloudless / Copernicus. MapLibre auto-merges
          the active style's source attributions with `customAttribution`
          so toggling Dark ↔ Satellite swaps which imagery credit
          appears without our having to manage it explicitly. */}
      <AttributionControl
        position="bottom-right"
        compact={false}
        customAttribution='<a href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre</a> | &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
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
      {/* Features carry top-level `id` (see referencePortsGeoJson
          above), so MapLibre's feature-state API works out of the
          box — no promoteId needed. */}
      <Source
        id={SRC_REFERENCE_PORTS}
        type="geojson"
        data={referencePortsGeoJson}
      >
        {/* Visible dot first (draws below), then transparent hit
            layer on top so clicks are caught by the wide target. */}
        <Layer {...referencePortsVisibleLayer} />
        <Layer {...referencePortsHitLayer} />
        <Layer {...referencePortsLabelLayer} />
        <Layer {...referencePortsHoverLabelLayer} />
      </Source>

      {/* ── Vessel route lines (dashed, faint) ── */}
      <Source id={SRC_VESSEL_ROUTES} type="geojson" data={vesselRoutesGeoJson}>
        <Layer {...vesselRoutesLayer} />
      </Source>

      {/* ── Planner route lines (solid cyan or magenta for compare-B) ── */}
      <Source id={SRC_PLANNER_ROUTES} type="geojson" data={plannerRoutesGeoJson}>
        <Layer {...plannerRoutesLayer} />
      </Source>

      {/* ── Dev editor zones — polygon fill + border ────────────── */}
      <Source id="src-dev-zones" type="geojson" data={devZonesGeoJson}>
        <Layer {...devZonesFillLayer} />
        <Layer {...devZonesBorderLayer} />
      </Source>

      {/* ── Dev zone vertex markers — draggable on active zone ───── */}
      {activeZone?.polygon.map(([lat, lon], idx) => (
        <Marker
          key={`${activeZone.id}-vx-${idx}`}
          longitude={lon}
          latitude={lat}
          anchor="center"
          draggable
          onDragEnd={(e) => {
            if (onZoneMoveVertex) {
              onZoneMoveVertex(idx, {
                lat: e.lngLat.lat,
                lon: e.lngLat.lng,
              });
            }
          }}
        >
          <div
            title={`Vertex ${idx + 1} of ${activeZone.polygon.length} · (${lat.toFixed(4)}, ${lon.toFixed(4)}) — drag to move, right-click to delete`}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onZoneDeleteVertex) onZoneDeleteVertex(idx);
            }}
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: "#a855f7",
              border: "2px solid #fff7ed",
              boxShadow: "0 0 6px #a855f790",
              cursor: "grab",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: 8,
                lineHeight: 1,
                fontWeight: 700,
                color: "#1c1917",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {idx + 1}
            </span>
          </div>
        </Marker>
      ))}

      {/* ── Channel chains (dev editor) — amber polylines ─────────── */}
      <Source id="src-channel-chains" type="geojson" data={channelChainsGeoJson}>
        <Layer {...channelChainsLayer} />
      </Source>

      {/* ── Channel chain waypoint markers — draggable on active chain ─ */}
      {activeChain?.waypoints.map(([lat, lon], idx) => (
        <Marker
          key={`${activeChain.id}-wp-${idx}`}
          longitude={lon}
          latitude={lat}
          anchor="center"
          draggable
          onDragEnd={(e) => {
            if (onChannelMoveWaypoint) {
              onChannelMoveWaypoint(idx, {
                lat: e.lngLat.lat,
                lon: e.lngLat.lng,
              });
            }
          }}
        >
          {/* Right-click (contextmenu) to delete — double-click would
              clash with the map's built-in double-click-to-zoom and
              fired inconsistently. Click on the number badge shows
              a confirmation in the title tooltip. */}
          <div
            title={`#${idx + 1} of ${activeChain.waypoints.length} · (${lat.toFixed(4)}, ${lon.toFixed(4)}) — drag to move, right-click to delete`}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onChannelDeleteWaypoint) onChannelDeleteWaypoint(idx);
            }}
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#f59e0b",
              border: "2px solid #fff7ed",
              boxShadow: "0 0 6px #f59e0b90",
              cursor: "grab",
              position: "relative",
            }}
          >
            {/* Sequence number — helps the operator see the chain's
                direction and spot out-of-order mid-click insertions. */}
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: 9,
                lineHeight: 1,
                fontWeight: 700,
                color: "#1c1917",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {idx + 1}
            </span>
          </div>
        </Marker>
      ))}

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
