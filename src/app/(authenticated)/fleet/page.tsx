"use client";

/**
 * /fleet — Fleet Map showing vessel positions on a dark world map.
 *
 * Design critique improvements:
 * - Right-side detail panel instead of floating bottom-left card
 * - Route polylines from loadport → dischargePort
 * - Filled markers with glow halos + pulse for urgent vessels
 * - Permanent vessel name labels
 * - On-map status legend
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Ship, X, ExternalLink, MapPin, AlertTriangle, Anchor, ArrowRight, Route, Trash2, GripVertical, Plus, ChevronRight, GitCompareArrows, Globe, Map as MapIcon, Satellite, Moon, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildLinkageCards } from "@/app/(authenticated)/dashboard/page";
import { findPortCoordinates } from "@/lib/geo/ports";
import { computeMockPosition } from "@/lib/geo/mock-positions";
import { findPort, getSeaRoutePath, getSeaDistance } from "@/lib/maritime/sea-distance";
import { STATUS_COLORS, STATUS_LABELS } from "./fleet-map-maplibre";
import type { FleetVessel, PlannerRouteLeg } from "./fleet-map-maplibre";
import { WorldscalePanel } from "./worldscale-panel";
import { PortCostsButton } from "./port-costs-button";
import { type ChannelChain } from "./channel-editor";
import { DevPanel, type DevTab } from "./dev-panel";
import { type Zone } from "./zone-editor";
import { useWeatherProvider } from "@/lib/maritime/weather/hooks/use-weather-provider";
import {
  DEFAULT_WEATHER_VISIBILITY,
  WeatherControls,
  type WeatherLayerVisibility,
} from "@/lib/maritime/weather/components/weather-controls";
import { WeatherPointPopup } from "@/lib/maritime/weather/components/weather-point-popup";
import { shipPositionAtTime } from "@/lib/maritime/weather/hooks/use-ship-at-time";
import type { WeatherType } from "@/lib/maritime/weather/types";
import { cn } from "@/lib/utils/cn";
import { useAisSnapshots } from "@/lib/maritime/ais/hooks/use-ais-snapshots";
import { AisControls } from "@/lib/maritime/ais/components/ais-controls";
import { formatAisAge } from "@/lib/maritime/ais/position-resolver";
import { useWeatherAdjustedEta } from "@/lib/maritime/eta-adjustment/hooks/use-weather-adjusted-eta";
import { classifyShipType } from "@/lib/maritime/eta-adjustment";
import type { ShipParams } from "@/lib/maritime/eta-adjustment";

// Dev-tools gate: enabled only when this env flag is set AND the
// app is actually using our in-house ocean_routing provider. If a
// customer has switched to Netpas or AtoBviaC (via NEXT_PUBLIC_
// DISTANCE_PROVIDER), the channel + zone editors would be editing
// data their active provider ignores — so we hide them entirely.
// This keeps the maritime module genuinely swappable: tellija
// valib Netpasi, meie dev-tools kaovad vaateväljast.
const DEV_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_DEV_TOOLS === "true" &&
  (process.env.NEXT_PUBLIC_DISTANCE_PROVIDER ?? "ocean_routing") ===
    "ocean_routing";

// Dynamic import — weatherlayers-gl / deck.gl pull in WebGL + Image
// APIs that explode under SSR. Same pattern as FleetMapInner below.
const WeatherLayer = dynamic(
  () =>
    import("@/lib/maritime/weather/components/weather-layer").then(
      (m) => m.WeatherLayer,
    ),
  { ssr: false },
);

// TimeSlider is lighter (no WebGL) but keeps the pattern uniform and
// defers loading until the fleet route is actually visited.
const TimeSlider = dynamic(
  () =>
    import("@/lib/maritime/weather/components/time-slider").then(
      (m) => m.TimeSlider,
    ),
  { ssr: false },
);

// Dynamic import — Leaflet requires `window`
const FleetMapInner = dynamic(
  () => import("./fleet-map-maplibre").then((m) => m.FleetMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[var(--color-surface-0)]">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    ),
  }
);

// ── Types ────────────────────────────────────────────────────

interface DealItem {
  id: string;
  linkageCode: string | null;
  linkageId: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
  nominatedQty: string | null;
  incoterm: string;
  loadport: string;
  dischargePort: string | null;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: string;
  dealType: string;
  sortOrder: number;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string | null;
  externalRef: string | null;
}

interface LinkageRow {
  id: string;
  linkageNumber: string | null;
  tempName: string | null;
  status: string;
  dealCount: number;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  secondaryOperatorId: string | null;
  secondaryOperatorName: string | null;
  vesselName?: string | null;
  vesselImo?: string | null;
  /** Q88-parsed particulars. Null until a Q88 has been uploaded + the
   *  operator has accepted the parse results. Fleet planner uses the
   *  shape keys it cares about (dwt, loa, vesselType) for Kwon. */
  vesselParticulars?: Record<string, unknown> | null;
}

// ── Geo helpers ──────────────────────────────────────────────

/** Haversine distance in nautical miles */
function distanceNM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const TANKER_SPEED_KN = 13; // typical MR tanker cruising speed

// ── Helpers ──────────────────────────────────────────────────

/**
 * Given a planned route (loadport → ... → discharge) and the vessel's
 * current position (AIS), return a new polyline consisting of the AIS
 * position + every waypoint AFTER the route point nearest to it.
 *
 * Drawing just this trimmed line on the map communicates "here is
 * where the vessel still has to go" without the distracting dead
 * geometry behind it. Passing the same trimmed line to
 * `shipPositionAtTime` also fixes a bug where scrubbing the
 * time-slider forward on an AIS vessel would walk it back to the
 * loadport first (because the projection was prepending AIS to the
 * FULL route). Now the projection only sees waypoints ahead.
 *
 * Nearest-waypoint choice is deliberately coarse: ocean-routing
 * polylines are densified to ~60-200 nm per segment, so the vessel's
 * actual position is always close to ONE of the route waypoints;
 * slicing at the nearest is visually indistinguishable from a more
 * expensive foot-of-perpendicular projection onto segments.
 */
function trimRouteFromNearest(
  plannedRoute: [number, number][],
  currentPos: [number, number],
): [number, number][] {
  if (plannedRoute.length === 0) return [currentPos];
  let nearestIdx = 0;
  let nearestDistNm = Infinity;
  for (let i = 0; i < plannedRoute.length; i++) {
    const [lat, lon] = plannedRoute[i];
    const dNm = distanceNM(lat, lon, currentPos[0], currentPos[1]);
    if (dNm < nearestDistNm) {
      nearestDistNm = dNm;
      nearestIdx = i;
    }
  }
  // Start the remaining route at the AIS position itself, then
  // everything AFTER the nearest waypoint. Even if the vessel has
  // already passed the nearest waypoint (common mid-leg), this still
  // produces a clean "vessel → next unvisited waypoint → ... →
  // discharge" polyline.
  return [currentPos, ...plannedRoute.slice(nearestIdx + 1)];
}

/** Format a signed/positive hour duration as "+Xd Yh" or "+Xh". */
function formatDelayHours(hours: number): string {
  if (hours < 1) return `+${Math.round(hours * 60)}m`;
  if (hours < 24) return `+${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h === 0 ? `+${d}d` : `+${d}d ${h}h`;
}

/** Format an unsigned hour duration as "Xd Yh" (matches planner etaDisplay). */
function formatDurationH(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

/**
 * Format a Date as a compact "DD Mon HH:MM" for the AIS ETA display in
 * the planner blue box. UTC-based because AIS ETA is a UTC timestamp
 * and the rest of the Fleet maritime UI labels timestamps in UTC
 * (prevents "vessel arrives 23:00 GMT but your slider says 20:00 local"
 * confusion).
 */
function formatEtaShort(d: Date): string {
  const day = d.getUTCDate().toString().padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${hh}:${mm}`;
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatQty(qty: string): string {
  const num = parseFloat(qty.replace(/,/g, ""));
  if (isNaN(num)) return qty;
  return num >= 1000 ? `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k` : `${num}`;
}

// ── Page ─────────────────────────────────────────────────────

export default function FleetPage() {
  const router = useRouter();
  const [linkageRows, setLinkageRows] = useState<LinkageRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null);

  // Planner Mode state
  const [plannerMode, setPlannerMode] = useState(false);
  const [plannerPorts, setPlannerPorts] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [plannerSearch, setPlannerSearch] = useState("");
  const [plannerResults, setPlannerResults] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [plannerSpeed, setPlannerSpeed] = useState(12);
  const [plannerDistance, setPlannerDistance] = useState<{
    totalNm: number;
    legs: Array<{ from: string; to: string; distanceNm: number }>;
    etaDays: number;
    etaDisplay: string;
  } | null>(null);
  const [plannerSearching, setPlannerSearching] = useState(false);
  const [plannerRouteLegs, setPlannerRouteLegs] = useState<PlannerRouteLeg[]>([]);
  // Passage-avoidance toggles — switches route variants on the fly.
  const [avoidSuez, setAvoidSuez] = useState(false);
  const [avoidPanama, setAvoidPanama] = useState(false);
  // Avoidable channel chains — the editor marks specific chains as
  // "size-restricted" (Kiel Canal, etc.). The Planner surfaces a
  // checkbox per avoidable chain so the operator can toggle the
  // passage off for vessels too large to fit. Fetched once on
  // mount; refreshed when the editor saves.
  const [avoidableChains, setAvoidableChains] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [avoidedChainIds, setAvoidedChainIds] = useState<Set<string>>(new Set());

  // Fetch avoidable chains on mount. Only pulls chains marked
  // `avoidable: true` in channel_chains.json. Silent fail if the
  // endpoint is disabled (production builds without dev tools).
  useEffect(() => {
    fetch("/api/maritime/channel-chains")
      .then((r) => (r.ok ? r.json() : { chains: [] }))
      .then(
        (data: {
          chains: Array<{ id: string; label: string; avoidable?: boolean }>;
        }) => {
          setAvoidableChains(
            (data.chains ?? [])
              .filter((c) => c.avoidable)
              .map((c) => ({ id: c.id, label: c.label }))
          );
        }
      )
      .catch(() => setAvoidableChains([]));
  }, []);
  // Map projection — 2D Mercator or 3D globe. Toggled from the
  // floating overlay control on the top-left of the map.
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  // Basemap — dark CARTO vector or EOX Sentinel-2 satellite imagery.
  // Independent of projection; any combination (dark flat, dark
  // globe, satellite flat, satellite globe) is valid and each has
  // its own look + use case.
  const [basemap, setBasemap] = useState<"dark" | "satellite">("dark");
  // ECA/SECA overlay — purely visual, does not influence routing.
  const [showEmissionZones, setShowEmissionZones] = useState(false);
  // Piracy / war-risk / tension overlay — also purely visual. If an
  // operator needs to actually route around the Red Sea, they use the
  // existing "Avoid Suez" passage toggle.
  const [showRiskZones, setShowRiskZones] = useState(false);

  // Collapsible section state for Avoid Passages + Map Overlays.
  // Persisted in localStorage so refreshes don't re-collapse a
  // section the operator left open. Initial state defaults to
  // collapsed — these sections have high UI surface area but are
  // tweaked rarely after a voyage is planned.
  const [avoidOpen, setAvoidOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fleet.avoidOpen") === "1";
  });
  const [overlaysOpen, setOverlaysOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fleet.overlaysOpen") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("fleet.avoidOpen", avoidOpen ? "1" : "0");
  }, [avoidOpen]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("fleet.overlaysOpen", overlaysOpen ? "1" : "0");
  }, [overlaysOpen]);
  // Weather layers — wind particles in Week 3, waves + temperature in
  // later weeks. Visibility state lives here so multiple consumers
  // (layer + controls + future time slider) stay in sync.
  const [weatherVisibility, setWeatherVisibility] =
    useState<WeatherLayerVisibility>(DEFAULT_WEATHER_VISIBILITY);
  const weatherProvider = useWeatherProvider();

  // Ephemeral "click anywhere on the map to see the weather at that
  // point" popup. Only active when the planner is OFF (otherwise
  // clicks insert custom waypoints) AND at least one weather layer
  // is visible (otherwise the popup has nothing to show).
  const [weatherPopup, setWeatherPopup] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  // Live AIS tracking. When enabled, polls `/api/maritime/ais/snapshot`
  // every 15 s; the hook goes idle the moment the toggle flips off so
  // we don't burn server cycles when operators aren't looking.
  const [aisEnabled, setAisEnabled] = useState(false);
  const aisState = useAisSnapshots({ enabled: aisEnabled });
  const aisVessels = aisState.data?.vessels ?? [];
  const aisFlagCount = aisVessels.reduce(
    (n, v) => n + v.storedFlags.length + v.liveFlags.length,
    0,
  );

  // Unified time axis. `weatherTime` is what the slider shows; the
  // WeatherLayer consumes it directly for GPU frame blending, and we
  // project vessel positions forward from `weatherBaseline` (captured
  // on the first slider init) using the same value. One t → two
  // effects, in lock-step.
  const [weatherTime, setWeatherTime] = useState<Date | null>(null);
  const weatherBaselineRef = useRef<Date | null>(null);
  const anyWeatherOn =
    weatherVisibility.wind ||
    weatherVisibility.waves ||
    weatherVisibility.temperature;
  const handleWeatherTimeChange = useCallback((t: Date) => {
    if (weatherBaselineRef.current === null) {
      weatherBaselineRef.current = t;
    }
    setWeatherTime(t);
  }, []);
  // Drag-and-drop state for reordering planner waypoints. `draggedIdx`
  // is the source row's index (null when not dragging); `dragOverIdx`
  // is the hovered drop target so we can render an insertion indicator.
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Channel Editor (dev tools) ────────────────────────────
  // Only rendered when NEXT_PUBLIC_DEV_TOOLS=true. Chains are loaded
  // on open (ChannelEditor does its own fetch) and kept in this parent
  // state so the map + editor stay in sync: editor lists them, map
  // renders their polylines + waypoint markers, both read/write via
  // the same setChannelChains setter.
  const [devMode, setDevMode] = useState(false);
  const [devTab, setDevTab] = useState<DevTab>("chains");
  const [channelChains, setChannelChains] = useState<ChannelChain[]>([]);
  const [activeChainId, setActiveChainId] = useState<string | null>(null);
  const [channelsDirty, setChannelsDirty] = useState(false);
  // Zone editor state — mirrors chain state so both editors look the
  // same to the page shell. DevPanel picks which one is "active" based
  // on the tab; the map sees both and renders as appropriate.
  const [zones, setZones] = useState<Zone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zonesDirty, setZonesDirty] = useState(false);

  // Helpers for mutating the active chain — closed over
  // setChannelChains so the editor + map callbacks stay thin.
  const updateActiveChain = useCallback(
    (mutate: (waypoints: Array<[number, number]>) => Array<[number, number]>) => {
      if (!activeChainId) return;
      setChannelChains((cur) =>
        cur.map((c) =>
          c.id === activeChainId ? { ...c, waypoints: mutate(c.waypoints) } : c
        )
      );
      setChannelsDirty(true);
    },
    [activeChainId]
  );

  const handleChannelClick = useCallback(
    ({ lat, lon }: { lat: number; lon: number }) => {
      updateActiveChain((wps) => [...wps, [lat, lon]]);
    },
    [updateActiveChain]
  );

  const handleChannelMoveWaypoint = useCallback(
    (idx: number, { lat, lon }: { lat: number; lon: number }) => {
      updateActiveChain((wps) =>
        wps.map((wp, i) => (i === idx ? [lat, lon] : wp))
      );
    },
    [updateActiveChain]
  );

  const handleChannelDeleteWaypoint = useCallback(
    (idx: number) => {
      updateActiveChain((wps) => wps.filter((_, i) => i !== idx));
    },
    [updateActiveChain]
  );

  const handleChannelInsertWaypoint = useCallback(
    (afterIdx: number, { lat, lon }: { lat: number; lon: number }) => {
      // Insert a new waypoint immediately after `afterIdx` so it lives
      // between existing waypoints i and i+1 (which is the segment the
      // user clicked with shift). Keeps the chain's logical order intact.
      updateActiveChain((wps) => {
        const out = wps.slice();
        out.splice(afterIdx + 1, 0, [lat, lon]);
        return out;
      });
    },
    [updateActiveChain]
  );

  // ── Zone editor callbacks ─────────────────────────────────
  const updateActiveZone = useCallback(
    (mutate: (polygon: Array<[number, number]>) => Array<[number, number]>) => {
      if (!activeZoneId) return;
      setZones((cur) =>
        cur.map((z) =>
          z.id === activeZoneId ? { ...z, polygon: mutate(z.polygon) } : z
        )
      );
      setZonesDirty(true);
    },
    [activeZoneId]
  );

  const handleZoneClick = useCallback(
    ({ lat, lon }: { lat: number; lon: number }) => {
      updateActiveZone((poly) => [...poly, [lat, lon]]);
    },
    [updateActiveZone]
  );

  const handleZoneMoveVertex = useCallback(
    (idx: number, { lat, lon }: { lat: number; lon: number }) => {
      updateActiveZone((poly) =>
        poly.map((p, i) => (i === idx ? [lat, lon] : p))
      );
    },
    [updateActiveZone]
  );

  const handleZoneDeleteVertex = useCallback(
    (idx: number) => {
      updateActiveZone((poly) => poly.filter((_, i) => i !== idx));
    },
    [updateActiveZone]
  );

  const handleZoneInsertVertex = useCallback(
    (afterIdx: number, { lat, lon }: { lat: number; lon: number }) => {
      updateActiveZone((poly) => {
        const out = poly.slice();
        out.splice(afterIdx + 1, 0, [lat, lon]);
        return out;
      });
    },
    [updateActiveZone]
  );

  // ── Compare-routes state ────────────────────────────────
  // When on, a second route is edited + rendered in parallel with the
  // first. Used for "deviation cost" analysis — e.g. "Rotterdam →
  // Houston direct vs. Rotterdam → Amsterdam → Houston: how much
  // extra in miles and days?".
  const [compareMode, setCompareMode] = useState(false);
  const [plannerPortsB, setPlannerPortsB] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [plannerDistanceB, setPlannerDistanceB] = useState<{
    totalNm: number;
    legs: Array<{ from: string; to: string; distanceNm: number }>;
    etaDays: number;
    etaDisplay: string;
  } | null>(null);
  const [plannerRouteLegsB, setPlannerRouteLegsB] = useState<PlannerRouteLeg[]>([]);
  // Which route port-adds, drag-reorders, and waypoint-list edits
  // target. Always "A" when compareMode is off.
  const [activeRoute, setActiveRoute] = useState<"A" | "B">("A");

  // Derived active-route state — all existing "add port", "drag",
  // "remove" handlers read/write through these so we don't need to
  // branch at every call site. When compareMode is off this is
  // always the A route (preserves pre-compare behaviour).
  const activePorts = activeRoute === "B" ? plannerPortsB : plannerPorts;
  const setActivePorts = activeRoute === "B" ? setPlannerPortsB : setPlannerPorts;

  // Port markers from parties (terminals, agents, inspectors, brokers)
  const [portMarkers, setPortMarkers] = useState<Array<{ name: string; port: string; type: string; lat: number; lng: number }>>([]);

  const fetchData = useCallback(() => {
    const t = Date.now();
    Promise.all([
      fetch(`/api/linkages?status=ongoing&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<LinkageRow[]>) : []
      ),
      fetch(`/api/deals?perPage=100&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<{ items: DealItem[] }>) : { items: [] }
      ),
      fetch(`/api/parties?_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([lr, dd, partiesData]) => {
        setLinkageRows(lr as LinkageRow[]);
        setAllDeals(
          ((dd as { items: DealItem[] }).items ?? []).filter(
            (d) => d.status !== "completed" && d.status !== "cancelled"
          )
        );
        // Resolve party ports to coordinates
        const rawParties: Array<{ name: string; port: string | null; type: string }> =
          Array.isArray(partiesData) ? partiesData : [...(partiesData.matched ?? []), ...(partiesData.rest ?? [])];
        const resolved: typeof portMarkers = [];
        const seen = new Set<string>();
        for (const p of rawParties) {
          if (!p.port) continue;
          const key = p.port.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const coords = findPortCoordinates(p.port);
          if (coords) {
            resolved.push({ name: p.name, port: p.port, type: p.type, lat: coords.lat, lng: coords.lng });
          }
        }
        setPortMarkers(resolved);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Planner: search ports as user types
  useEffect(() => {
    if (!plannerSearch.trim() || plannerSearch.length < 2) {
      setPlannerResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setPlannerSearching(true);
      fetch(`/api/maritime/sea-distance?search=${encodeURIComponent(plannerSearch)}`)
        .then((r) => r.json())
        .then((data: { ports: Array<{ name: string; lat: number; lon: number }> }) => {
          setPlannerResults(data.ports ?? []);
        })
        .finally(() => setPlannerSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [plannerSearch]);

  // Planner: recalculate distance whenever ports, speed, or passage
  // avoidance toggles change. When compareMode is on, computes Route B
  // in parallel under the same speed + avoid settings (the whole point
  // of compare-mode is "same conditions, different waypoint list").
  useEffect(() => {
    const avoids: string[] = [];
    if (avoidSuez) avoids.push("suez");
    if (avoidPanama) avoids.push("panama");
    const avoidParam = avoids.length ? `&avoid=${avoids.join(",")}` : "";
    const chainsParam = avoidedChainIds.size > 0
      ? `&avoidChains=${Array.from(avoidedChainIds).join(",")}`
      : "";

    // Shared helper to call both APIs for a given route's waypoint list.
    const computeRoute = async (ports: Array<{ name: string; lat: number; lon: number }>) => {
      if (ports.length < 2) return null;
      const portNames = ports
        .map((p) => (p.name.startsWith("@") ? `@${p.lat},${p.lon}` : p.name))
        .join("|");
      const [distData, routeData] = await Promise.all([
        fetch(`/api/maritime/sea-distance?ports=${encodeURIComponent(portNames)}&speed=${plannerSpeed}${avoidParam}${chainsParam}`)
          .then((r) => r.json()),
        fetch(`/api/maritime/sea-distance/route-line?ports=${encodeURIComponent(portNames)}${avoidParam}${chainsParam}`)
          .then((r) => r.json()),
      ]);
      return {
        distance: {
          totalNm: distData.totalNm ?? 0,
          legs: distData.legs ?? [],
          etaDays: distData.etaDays ?? 0,
          etaDisplay: distData.etaDisplay ?? "—",
        },
        legs: (routeData.legs ?? []) as PlannerRouteLeg[],
      };
    };

    // Route A
    computeRoute(plannerPorts).then((res) => {
      if (res) {
        setPlannerDistance(res.distance);
        setPlannerRouteLegs(res.legs);
      } else {
        setPlannerDistance(null);
        setPlannerRouteLegs([]);
      }
    });

    // Route B — only when compare mode is active
    if (compareMode) {
      computeRoute(plannerPortsB).then((res) => {
        if (res) {
          setPlannerDistanceB(res.distance);
          setPlannerRouteLegsB(res.legs);
        } else {
          setPlannerDistanceB(null);
          setPlannerRouteLegsB([]);
        }
      });
    } else {
      setPlannerDistanceB(null);
      setPlannerRouteLegsB([]);
    }
  }, [plannerPorts, plannerPortsB, plannerSpeed, avoidSuez, avoidPanama, compareMode, avoidedChainIds]);

  const cards = buildLinkageCards(linkageRows as any, allDeals as any);

  const filteredCards = operatorFilter
    ? cards.filter((c) => !c.assignedOperatorId || c.assignedOperatorId === operatorFilter)
    : cards;

  // Build FleetVessel array
  const vessels: FleetVessel[] = [];
  // Parallel map of vesselId → pre-computed ocean route. Kept separate
  // from FleetVessel (not every consumer needs the polyline) so we can
  // use it for the unified time-slider's ship-projection without
  // inflating the props FleetMapInner receives.
  const vesselRoutesById = new Map<string, [number, number][]>();
  const unlocated: string[] = [];

  for (const card of filteredCards) {
    if (!card.vessel) continue;

    const allCardDeals = [...card.buys, ...card.sells];
    const loadport = allCardDeals.find((d) => d.loadport)?.loadport ?? null;
    const dischargePort = allCardDeals.find((d) => d.dischargePort)?.dischargePort ?? null;
    const loadCoords = findPortCoordinates(loadport);
    const dischCoords = findPortCoordinates(dischargePort);

    // Look up the pre-computed ocean route + distance for time-based
    // sailing interpolation along the real route geometry.
    let routePath: [number, number][] | null = null;
    let totalDistanceNm: number | null = null;
    if (loadport && dischargePort) {
      const fromCanon = findPort(loadport);
      const toCanon = findPort(dischargePort);
      if (fromCanon && toCanon) {
        routePath = getSeaRoutePath(fromCanon, toCanon);
        const dist = getSeaDistance(fromCanon, toCanon);
        totalDistanceNm = dist.totalNm > 0 ? dist.totalNm : null;
      }
    }

    // Departure date estimate = latest laycan_end across the card's deals.
    const laycanEnds = allCardDeals.map((d) => (d as DealItem).laycanEnd).filter(Boolean).sort();
    const estimatedDeparture = laycanEnds[laycanEnds.length - 1] ?? null;

    const position = computeMockPosition(
      card.status,
      card.vessel + card.id,
      loadCoords,
      dischCoords,
      routePath,
      estimatedDeparture,
      totalDistanceNm,
    );
    if (!position) { unlocated.push(card.vessel); continue; }

    const linkageRow = linkageRows.find((r) => r.id === card.id);

    // Urgency: laycan ≤3 days
    const isUrgent = card.earliestLaycan ? daysUntil(card.earliestLaycan) >= 0 && daysUntil(card.earliestLaycan) <= 3 : false;

    if (routePath !== null) {
      vesselRoutesById.set(card.id, routePath);
    }
    vessels.push({
      id: card.id,
      vesselName: card.vessel,
      vesselImo: (linkageRow as LinkageRow)?.vesselImo ?? null,
      linkageCode: card.displayName,
      status: card.status,
      position: { lat: position.lat, lng: position.lng },
      heading: position.heading,
      loadport, dischargePort,
      buys: card.buys.map((d) => ({ counterparty: d.counterparty, quantityMt: d.quantityMt, product: d.product })),
      sells: card.sells.map((d) => ({ counterparty: d.counterparty, quantityMt: d.quantityMt, product: d.product })),
      earliestLaycan: card.earliestLaycan,
      latestLaycanEnd: laycanEnds[laycanEnds.length - 1] ?? null,
      assignedOperatorName: card.assignedOperatorName,
      product: card.product,
      isUrgent,
      etaHours: (card.status === "sailing" && dischCoords)
        ? Math.round(distanceNM(position.lat, position.lng, dischCoords.lat, dischCoords.lng) / TANKER_SPEED_KN)
        : null,
      vesselParticulars: (linkageRow as LinkageRow)?.vesselParticulars ?? null,
    });
  }

  // Stats for status counts — populated from real vessels below
  const statusCounts: Record<string, number> = {};
  for (const v of vessels) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }

  // Order is important below:
  //
  //   1. `displayVessels` starts from the mock-position vessels.
  //   2. **AIS merge first** — override position + compute a
  //      `routeOverride` (remaining route from current AIS to the
  //      discharge port). AIS data is real, so it wins over the mock
  //      baseline; the routeOverride stops the map from still drawing
  //      the stale loadport-to-discharge plan for a vessel that's
  //      already halfway across the Atlantic.
  //   3. **Time projection afterwards** — whether a vessel has AIS or
  //      not, the TimeSlider's `weatherTime` walks the marker forward
  //      from its CURRENT position (AIS or mock) along whichever
  //      route is active (remaining for AIS vessels, full planned
  //      otherwise). Previously the projection ran before AIS merge,
  //      which meant AIS markers snapped back to real position after
  //      the slider had moved — jarring.
  let displayVessels: FleetVessel[] = vessels;

  if (aisEnabled && aisVessels.length > 0) {
    const aisByLinkageId = new Map(aisVessels.map((av) => [av.linkageId, av]));
    displayVessels = displayVessels.map((v) => {
      const ais = aisByLinkageId.get(v.id);
      if (ais === undefined) return v;

      // Compute the remaining-route override: for LIVE / DEAD_RECK
      // vessels, trim the planned polyline at whichever waypoint is
      // nearest to the current AIS position and prepend the AIS
      // point itself. PREDICTED vessels (no AIS message yet) stick
      // with the full planned route — we don't actually know where
      // they are, so "remaining" is meaningless.
      let routeOverride: [number, number][] | null = null;
      const plannedRoute = vesselRoutesById.get(v.id);
      const aisPos: [number, number] = [ais.position.lat, ais.position.lon];
      if (
        plannedRoute !== undefined &&
        plannedRoute.length >= 2 &&
        (ais.position.mode === "live" || ais.position.mode === "dead_reck")
      ) {
        routeOverride = trimRouteFromNearest(plannedRoute, aisPos);
        // Feed the trimmed route back into vesselRoutesById so the
        // time-slider projection below walks the right geometry.
        vesselRoutesById.set(v.id, routeOverride);
      }

      return {
        ...v,
        position: { lat: ais.position.lat, lng: ais.position.lon },
        heading: ais.position.bearingDeg ?? v.heading,
        aisMode: ais.position.mode,
        aisAgeMs: ais.position.ageMs,
        aisDestination: ais.vessel.destination ?? null,
        aisEta: ais.vessel.eta ? new Date(ais.vessel.eta) : null,
        routeOverride,
      };
    });
  }

  // Time-projected vessel positions. When the TimeSlider is past the
  // baseline, each vessel's marker walks forward along its route
  // (either the remaining-AIS override above or the full planned
  // route) at DEFAULT_SPEED_KNOTS. Same `weatherTime` that drives
  // the WeatherLayer's GPU frame blending drives this projection.
  if (weatherTime !== null && weatherBaselineRef.current !== null) {
    const hoursForward =
      (weatherTime.getTime() - weatherBaselineRef.current.getTime()) /
      (60 * 60 * 1000);
    if (hoursForward > 0) {
      displayVessels = displayVessels.map((v) => {
        const route = vesselRoutesById.get(v.id);
        if (route === undefined) return v;
        const [newLat, newLon] = shipPositionAtTime(
          [v.position.lat, v.position.lng],
          route,
          hoursForward,
        );
        return { ...v, position: { lat: newLat, lng: newLon } };
      });
    }
  }

  // Demo vessels were removed. Fleet now reflects only real linkages that
  // have a vessel attached (linkage.vessel_name). When AIS integration
  // is disabled, positions come from `computeMockPosition` with the
  // pre-computed ocean route + laycan dates — places sailing vessels on
  // their actual route (not a straight line through land) at time-based
  // progress from laycan_end. AIS wins whenever it's available.

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? null;

  // ── Weather-adjusted ETA ────────────────────────────────────
  // Concat all planner route-line segments into one polyline and
  // feed it into the Kwon integrator. Hook returns null until the
  // planner has at least two waypoints + a real route-line — no
  // cost beyond the useMemo comparison when planner is empty.
  const plannerRoutePolyline = useMemo<Array<[number, number]> | null>(() => {
    if (plannerRouteLegs.length === 0) return null;
    const pts: Array<[number, number]> = [];
    for (const leg of plannerRouteLegs) {
      for (const c of leg.coordinates) pts.push(c);
    }
    return pts.length >= 2 ? pts : null;
  }, [plannerRouteLegs]);

  // Build Kwon ShipParams from whatever the selected vessel has. When
  // a Q88 has been parsed onto the linkage, pick up its DWT/LOA/beam/
  // vessel-type string; otherwise fall back to a generic 45k MR tanker
  // profile which is still representative of our fleet baseline.
  //
  // Loading state is hardcoded "loaded" per product decision: vessels
  // sailing loadport → discharge are almost always fully loaded. The
  // rare ballast case can be handled later via an AIS nav_status
  // heuristic (nav_status 4 = "constrained by draught") if it matters.
  const kwonShip: ShipParams | null = useMemo(() => {
    if (!selectedVessel) return null;
    const p = selectedVessel.vesselParticulars ?? {};
    const getNum = (k: string): number | undefined => {
      const v = p[k];
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };
    const getStr = (k: string): string | null => {
      const v = p[k];
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    return {
      type: classifyShipType(getStr("vesselType")),
      dwt: getNum("dwt") ?? 45000,
      loa: getNum("loa") ?? 183,
      beam: getNum("beam"),
      loadingState: "loaded",
      serviceSpeedKn: plannerSpeed,
    };
  }, [selectedVessel, plannerSpeed]);

  // When to start the Kwon integration clock:
  //   - Vessel has LIVE / DEAD_RECK AIS  → the vessel is already moving,
  //     count from now.
  //   - Vessel hasn't departed yet        → count from the latest
  //     laycan end (the deadline by which the vessel must have loaded
  //     and departed). This is a better-than-`now` proxy for
  //     "estimated departure from loadport" until we have a richer
  //     voyage-timeline model (CP recap → actual ETD).
  // Fallback: use `now` when neither AIS nor laycan end is available.
  const kwonStartTime = useMemo(() => {
    if (selectedVessel?.aisMode === "live" || selectedVessel?.aisMode === "dead_reck") {
      return new Date();
    }
    if (selectedVessel?.latestLaycanEnd) {
      return new Date(selectedVessel.latestLaycanEnd);
    }
    return new Date();
  }, [selectedVessel?.aisMode, selectedVessel?.latestLaycanEnd]);

  const kwonEta = useWeatherAdjustedEta({
    route: plannerRoutePolyline,
    startTime: kwonStartTime,
    ship: kwonShip,
    commandedSpeedKn: plannerSpeed,
    weatherProvider,
    enabled: plannerMode && plannerRoutePolyline !== null,
    // Pin Kwon's calm + adjusted totals to the planner's authoritative
    // distance. Without this the top of the blue box ("18d 14h" from
    // the planner API) and the weather-adjusted block ("26d 11h from
    // Kwon's polyline-haversine sum) can disagree by many hours,
    // because the two calcs walk slightly different paths.
    expectedTotalDistanceNm: plannerDistance?.totalNm,
  });

  // Explicit action: load a vessel's route into the planner. Previously
  // this fired automatically whenever a vessel marker was clicked,
  // which meant "I want to see this vessel's details" got hijacked by
  // "let me open the planner". Now the marker click only opens the
  // detail panel, and the user triggers this via the "Open in Planner"
  // button in that panel — an explicit action, not a side effect.
  async function openPlannerForVessel(vesselId: string) {
    const v = vessels.find((vv) => vv.id === vesselId);
    if (!v) return;

    // Collect unique ports: loadport → discharge ports.
    const ports: string[] = [];
    if (v.loadport) ports.push(v.loadport);
    if (v.dischargePort && v.dischargePort !== v.loadport) ports.push(v.dischargePort);

    // Additional discharge ports from other sell deals in the same
    // linkage, ordered by sortOrder so the planner reflects the
    // operator's chosen sequence.
    const linkageDeals = allDeals
      .filter((d) => d.linkageId === v.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const d of linkageDeals) {
      if (d.dischargePort && !ports.includes(d.dischargePort)) {
        ports.push(d.dischargePort);
      }
    }

    // Close the detail panel and open the planner. We do both here so
    // state is mutually exclusive by construction — the panel
    // shuffle-bug was rooted in letting both be open at once.
    setSelectedVesselId(null);

    if (ports.length === 0) {
      setPlannerPorts([]);
      setPlannerMode(true);
      return;
    }

    const resolved = await Promise.all(
      ports.map((p) =>
        fetch(`/api/maritime/sea-distance?search=${encodeURIComponent(p)}`)
          .then((r) => r.json())
          .then((data: { ports: Array<{ name: string; lat: number; lon: number }> }) => {
            const match = data.ports?.[0];
            return match ?? { name: p, lat: 0, lon: 0 };
          })
          .catch(() => ({ name: p, lat: 0, lon: 0 })),
      ),
    );
    setPlannerPorts(resolved);
    setPlannerMode(true);
  }

  const operatorOptions = Array.from(
    new Map(
      linkageRows
        .filter((r) => r.assignedOperatorId && r.assignedOperatorName)
        .map((r) => [r.assignedOperatorId!, r.assignedOperatorName!])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Finalize stats from all vessels (real + demo)
  const urgentCount = vessels.filter((v) => v.isUrgent).length;
  for (const v of vessels) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }

  return (
    <div className="flex flex-col -m-6" style={{ height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] flex-shrink-0 z-[1100] relative">
        <div className="flex items-center gap-3">
          <Ship className="h-5 w-5 text-[var(--color-accent)]" />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">Fleet</h1>
            <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--color-text-tertiary)]">
              <span>{vessels.length} vessel{vessels.length !== 1 ? "s" : ""}</span>
              {Object.entries(statusCounts).map(([s, c]) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] ?? "#6B7280", boxShadow: `0 0 4px ${STATUS_COLORS[s] ?? "#6B7280"}60` }} />
                  <span>{c} {STATUS_LABELS[s] ?? s}</span>
                </span>
              ))}
            </div>
          </div>
          {/* Map chrome — lives next to the Fleet title so the header
              stays the single source of "what am I looking at" info.
              Both toggles are independent (any combination of
              mercator/globe + dark/satellite is valid). */}
          <button
            onClick={() =>
              setProjection(projection === "mercator" ? "globe" : "mercator")
            }
            title={
              projection === "mercator"
                ? "Switch to 3D globe view"
                : "Switch back to flat map"
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors cursor-pointer ${
              projection === "globe"
                ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            {projection === "mercator" ? (
              <Globe className="h-3.5 w-3.5" />
            ) : (
              <MapIcon className="h-3.5 w-3.5" />
            )}
            {projection === "mercator" ? "Globe" : "Map"}
          </button>
          <button
            onClick={() =>
              setBasemap(basemap === "dark" ? "satellite" : "dark")
            }
            title={
              basemap === "dark"
                ? "Switch to satellite imagery (EOX Sentinel-2)"
                : "Switch back to dark vector map"
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors cursor-pointer ${
              basemap === "satellite"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            {basemap === "dark" ? (
              <Satellite className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
            {basemap === "dark" ? "Satellite" : "Dark"}
          </button>
          {/* Dev tools — only rendered when NEXT_PUBLIC_DEV_TOOLS=true.
              Opens the Channel Editor sidebar so ops can hand-curate
              dense waypoint chains through narrow waterways. */}
          {DEV_TOOLS_ENABLED && (
            <button
              onClick={() => setDevMode(!devMode)}
              title="Dev tools: channel chain editor"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors cursor-pointer ${
                devMode
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              Dev
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setPlannerMode(!plannerMode);
              if (!plannerMode) setSelectedVesselId(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold transition-colors cursor-pointer ${
              plannerMode
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            <Route className="h-3.5 w-3.5" />
            Planner
          </button>
          {/* Projection + basemap toggles moved to the floating
              overlay control on the map itself (top-left, below
              the zoom buttons) — that's the idiomatic place for
              map-specific chrome in a web-map app, and keeps the
              header focused on fleet-status info. */}
          {urgentCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-[0.6875rem] font-semibold animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              {urgentCount} laycan critical
            </div>
          )}
          {unlocated.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-[0.6875rem] font-medium" title={unlocated.join(", ")}>
              <AlertTriangle className="h-3 w-3" />
              {unlocated.length} unlocated
            </div>
          )}
          {operatorOptions.length > 0 && (
            <select
              value={operatorFilter ?? ""}
              onChange={(e) => setOperatorFilter(e.target.value || null)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] outline-none cursor-pointer"
            >
              <option value="">All operators</option>
              {operatorOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Map + Side Panel */}
      <div className="flex-1 flex relative">
        {/* Map */}
        <div className={`flex-1 transition-all duration-300 ${selectedVessel ? "" : ""}`}>
          {loading ? (
            <div className="flex items-center justify-center h-full bg-[var(--color-surface-0)]">
              <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
            </div>
          ) : (
            <FleetMapInner
              vessels={displayVessels}
              portMarkers={portMarkers}
              selectedVesselId={selectedVesselId}
              onSelectVessel={setSelectedVesselId}
              // Combine both routes into a single legs array. Route A
              // stays default cyan, Route B is explicitly magenta so
              // compare-mode is visually obvious. Waypoints follow
              // the same convention so numbered markers match legs.
              plannerRouteLegs={[
                ...plannerRouteLegs.map((leg) => ({ ...leg, color: "#22d3ee" })),
                ...(compareMode
                  ? plannerRouteLegsB.map((leg) => ({ ...leg, color: "#f472b6" }))
                  : []),
              ]}
              plannerWaypoints={[
                ...plannerPorts.map((p) => ({ ...p, color: "#22d3ee" })),
                ...(compareMode
                  ? plannerPortsB.map((p) => ({ ...p, color: "#f472b6" }))
                  : []),
              ]}
              showEmissionZones={showEmissionZones}
              showRiskZones={showRiskZones}
              projection={projection}
              basemap={basemap}
              onPortClick={
                // Dev mode takes priority: channel/zone editor needs
                // pure-water clicks, so a port click while dev tools
                // are active should be ignored.
                devMode
                  ? undefined
                  : (port) => {
                      // If the planner isn't open yet, open it — the
                      // port click itself is the operator's "I want
                      // to plan a voyage" signal, no need to make
                      // them hunt for the Planner toggle first.
                      if (!plannerMode) setPlannerMode(true);
                      setActivePorts((prev) =>
                        // Dedup: don't re-add if already in the list.
                        prev.some((p) => p.name === port.name)
                          ? prev
                          : [...prev, port]
                      );
                    }
              }
              onMapClick={
                // Three modes:
                //   - Planner ON  → click inserts a custom @lat,lon
                //                   waypoint into the active route.
                //   - Planner OFF + any weather layer on → open the
                //                   WeatherPointPopup at the clicked
                //                   coordinate so ops can read wind /
                //                   waves / temp without a side panel.
                //   - Planner OFF + all weather off → no-op.
                plannerMode
                  ? ({ lat, lon }) => {
                      const nsSuffix = lat >= 0 ? "N" : "S";
                      const ewSuffix = lon >= 0 ? "E" : "W";
                      const label = `@ ${Math.abs(lat).toFixed(2)}°${nsSuffix} ${Math.abs(lon).toFixed(2)}°${ewSuffix}`;
                      setActivePorts((prev) => [
                        ...prev,
                        { name: label, lat, lon },
                      ]);
                    }
                  : anyWeatherOn
                    ? ({ lat, lon }) => setWeatherPopup({ lat, lon })
                    : undefined
              }
              channelChains={devMode && devTab === "chains" ? channelChains : []}
              activeChainId={devMode && devTab === "chains" ? activeChainId : null}
              onChannelClick={devMode && devTab === "chains" ? handleChannelClick : undefined}
              onChannelMoveWaypoint={devMode && devTab === "chains" ? handleChannelMoveWaypoint : undefined}
              onChannelDeleteWaypoint={devMode && devTab === "chains" ? handleChannelDeleteWaypoint : undefined}
              onChannelInsertWaypoint={devMode && devTab === "chains" ? handleChannelInsertWaypoint : undefined}
              devZones={devMode ? zones : []}
              activeZoneId={devMode && devTab === "zones" ? activeZoneId : null}
              onZoneClick={devMode && devTab === "zones" ? handleZoneClick : undefined}
              onZoneMoveVertex={devMode && devTab === "zones" ? handleZoneMoveVertex : undefined}
              onZoneDeleteVertex={devMode && devTab === "zones" ? handleZoneDeleteVertex : undefined}
              onZoneInsertVertex={devMode && devTab === "zones" ? handleZoneInsertVertex : undefined}
            >
              {/* Weather overlay. The component renders nothing to the
                  DOM but attaches a deck.gl ParticleLayer to the map
                  whenever `enabled` is true. Layers added here via
                  `children` can use `useMap` / `useControl` because
                  they render inside the react-map-gl <Map> boundary. */}
              <WeatherLayer
                provider={weatherProvider}
                type="wind"
                enabled={weatherVisibility.wind}
                time={weatherTime}
              />
              <WeatherLayer
                provider={weatherProvider}
                type="waves"
                enabled={weatherVisibility.waves}
                time={weatherTime}
              />
              <WeatherLayer
                provider={weatherProvider}
                type="temperature"
                enabled={weatherVisibility.temperature}
                time={weatherTime}
              />
              {/* Weather point popup lives INSIDE the map so react-
                  map-gl's Popup can anchor to lat/lon and pan with
                  the map instead of sitting in a fixed screen
                  corner. Conditions mirror the outside render we
                  used to do — planner OFF + any weather layer on. */}
              {weatherPopup !== null &&
                weatherTime !== null &&
                anyWeatherOn &&
                !plannerMode && (
                  <WeatherPointPopup
                    provider={weatherProvider}
                    types={
                      [
                        weatherVisibility.wind ? "wind" : null,
                        weatherVisibility.waves ? "waves" : null,
                        weatherVisibility.temperature
                          ? "temperature"
                          : null,
                      ].filter((t): t is WeatherType => t !== null)
                    }
                    time={weatherTime}
                    lat={weatherPopup.lat}
                    lon={weatherPopup.lon}
                    onClose={() => setWeatherPopup(null)}
                  />
                )}
              {/* Live AIS is wired into the existing fleet markers via
                  the `aisMode` / position override on each FleetVessel —
                  see the merge block above where we fold aisVessels in.
                  One marker per linkage, AIS quality = ring colour. */}
            </FleetMapInner>
          )}

          {/* Bottom-row chrome — weather controls on the left, time
              slider stretching through the middle/right. Earlier
              versions put the controls top-right, but the Planner
              panel then occluded them when the operator opened a
              voyage — bottom-left stays out of the way of every
              right-side sidebar. */}
          {!loading && (
            // `bottom-8` lifts the whole weather row clear of the
            // attribution bar at the very bottom of the map. Demo
            // Tour then floats higher still (see demo-tour.tsx) so
            // the three occupy three separate vertical bands
            // instead of piling into the same corner.
            <div className="pointer-events-none absolute inset-x-3 bottom-8 z-10 flex items-end gap-3">
              <div className="pointer-events-auto w-44 flex-shrink-0">
                <WeatherControls
                  visibility={weatherVisibility}
                  onChange={setWeatherVisibility}
                />
              </div>
              <div className="pointer-events-auto flex-shrink-0">
                <AisControls
                  enabled={aisEnabled}
                  onToggle={setAisEnabled}
                  vesselCount={aisVessels.length}
                  flagCount={aisFlagCount}
                  loading={aisState.loading}
                  error={aisState.error}
                />
              </div>
              {anyWeatherOn && (
                <div className="pointer-events-auto min-w-0 flex-1">
                  <TimeSlider
                    provider={weatherProvider}
                    type="wind"
                    time={weatherTime}
                    onChange={handleWeatherTimeChange}
                  />
                </div>
              )}
            </div>
          )}

        </div>

        {/* Dev Tools panel (chains + zones editor) — replaces the normal
            planner panel when dev mode is on. Only mounted when enabled
            so production bundles with the flag off ship none of this
            UI. */}
        {DEV_TOOLS_ENABLED && devMode && (
          <DevPanel
            activeTab={devTab}
            setActiveTab={setDevTab}
            onClose={() => setDevMode(false)}
            chains={channelChains}
            setChains={setChannelChains}
            activeChainId={activeChainId}
            setActiveChainId={setActiveChainId}
            chainsDirty={channelsDirty}
            setChainsDirty={setChannelsDirty}
            zones={zones}
            setZones={setZones}
            activeZoneId={activeZoneId}
            setActiveZoneId={setActiveZoneId}
            zonesDirty={zonesDirty}
            setZonesDirty={setZonesDirty}
          />
        )}

        {/* Right-side Planner panel */}
        <div className={`
          flex-shrink-0 bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)]
          transition-all duration-300 overflow-hidden
          ${plannerMode && !devMode ? "w-80" : "w-0"}
        `}>
          {plannerMode && (
            <div className="w-80 h-full overflow-y-auto">
              {/* Planner header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-bold text-[var(--color-text-primary)]">
                    Distance Planner
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Compare-routes toggle — seeds Route B from Route A
                      on first activation so comparing "+ interim port"
                      vs "direct" is a one-click mutation from that
                      starting state. */}
                  <button
                    onClick={() => {
                      if (!compareMode) {
                        // Seed B = A so the operator tweaks B from the
                        // existing route rather than building from zero
                        setPlannerPortsB(plannerPorts.map((p) => ({ ...p })));
                      }
                      setCompareMode(!compareMode);
                      setActiveRoute("A");
                    }}
                    title={compareMode ? "Exit compare mode" : "Compare two routes side-by-side"}
                    className={`flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] text-[0.65rem] font-semibold transition-colors cursor-pointer ${
                      compareMode
                        ? "bg-pink-500/20 text-pink-400 border border-pink-500/40"
                        : "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] border border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <GitCompareArrows className="h-3 w-3" />
                    Compare
                  </button>
                  <button
                    onClick={() => setPlannerMode(false)}
                    className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Port search */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search port..."
                    value={plannerSearch}
                    onChange={(e) => setPlannerSearch(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-cyan-500/50"
                  />
                  {plannerSearching && (
                    <div className="absolute right-2 top-2">
                      <div className="h-4 w-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    </div>
                  )}
                </div>
                {plannerResults.length > 0 && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-2)]">
                    {plannerResults.map((port) => {
                      // If the user's query matched an alias, show it
                      // explicitly so e.g. typing "Fos" surfaces as
                      // "Lavera, FR — same port area as Fos"; otherwise
                      // the suggestion looks like a silent substitution.
                      const alias = (port as { matchedAlias?: string | null }).matchedAlias;
                      return (
                        <button
                          key={port.name}
                          onClick={() => {
                            // Targets active route (A or B in compare-mode)
                            setActivePorts((prev) => [...prev, port]);
                            setPlannerSearch("");
                            setPlannerResults([]);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                        >
                          <Plus className="h-3 w-3 inline mr-1.5 text-cyan-400" />
                          {port.name}
                          {alias && (
                            <span className="ml-1.5 text-[var(--color-text-tertiary)] text-[0.6875rem]">
                              — same port area as {alias.replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Compare-mode route picker — shown only when compare
                  is on. Switches which route new adds/drags target. */}
              {compareMode && (
                <div className="px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Editing:
                    </span>
                    <div className="flex rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border-default)]">
                      <button
                        onClick={() => setActiveRoute("A")}
                        className={`px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                          activeRoute === "A"
                            ? "bg-cyan-500/20 text-cyan-400"
                            : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                        }`}
                      >
                        Route A
                      </button>
                      <button
                        onClick={() => setActiveRoute("B")}
                        className={`px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                          activeRoute === "B"
                            ? "bg-pink-500/20 text-pink-400"
                            : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                        }`}
                      >
                        Route B
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Waypoint list — renders the active route's waypoints
                  (or just Route A when compare is off). The `activeRoute`
                  color key (cyan for A, pink for B) matches what the map
                  renders, so ops can always trust the color association. */}
              {(() => {
                const activeDistance = activeRoute === "B" ? plannerDistanceB : plannerDistance;
                // Tailwind can't see dynamic ring-${color} classes at
                // build time, so we pre-select the full className string
                // based on the active route.
                const dropRingClass = activeRoute === "B"
                  ? "ring-2 ring-pink-400/60 ring-offset-1 ring-offset-[var(--color-surface-1)]"
                  : "ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-[var(--color-surface-1)]";
                return (
                  <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                    <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: activeRoute === "B" ? "#f472b6" : "#22d3ee" }}
                      />
                      {compareMode && `Route ${activeRoute} — `}
                      Waypoints ({activePorts.length})
                    </div>
                    {activePorts.length === 0 ? (
                      <div className="text-xs text-[var(--color-text-tertiary)] italic py-4 text-center">
                        Search + add, or click a port / empty sea on the map
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {activePorts.map((port, idx) => {
                          const isDragged = draggedIdx === idx;
                          const isDragTarget = dragOverIdx === idx && draggedIdx !== idx;
                          return (
                            <div
                              key={`${port.name}-${idx}`}
                              draggable
                              onDragStart={(e) => {
                                setDraggedIdx(idx);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", String(idx));
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                if (dragOverIdx !== idx) setDragOverIdx(idx);
                              }}
                              onDragLeave={() => {
                                if (dragOverIdx === idx) setDragOverIdx(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const from = draggedIdx;
                                const to = idx;
                                setDraggedIdx(null);
                                setDragOverIdx(null);
                                if (from === null || from === to) return;
                                setActivePorts((prev) => {
                                  const next = prev.slice();
                                  const [moved] = next.splice(from, 1);
                                  next.splice(to, 0, moved);
                                  return next;
                                });
                              }}
                              onDragEnd={() => {
                                setDraggedIdx(null);
                                setDragOverIdx(null);
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] group cursor-grab active:cursor-grabbing transition-opacity ${
                                isDragged ? "opacity-40" : ""
                              } ${isDragTarget ? dropRingClass : ""}`}
                            >
                              <GripVertical className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span
                                  className={`w-4 h-4 rounded-full text-[0.6rem] font-bold flex items-center justify-center flex-shrink-0 ${
                                    activeRoute === "B"
                                      ? "bg-pink-500/20 text-pink-400"
                                      : "bg-cyan-500/20 text-cyan-400"
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                                <span className="text-xs text-[var(--color-text-primary)] truncate">
                                  {port.name.startsWith("@")
                                    ? port.name
                                    : port.name.split(",")[0]}
                                </span>
                              </div>
                              {/* Leg distance from active route */}
                              {activeDistance && idx > 0 && activeDistance.legs[idx - 1] && (
                                <span className="text-[0.6rem] font-mono text-[var(--color-text-tertiary)] flex-shrink-0">
                                  {activeDistance.legs[idx - 1].distanceNm.toLocaleString()} NM
                                </span>
                              )}
                              {/* Port costs popover — hidden for custom
                                  waypoints (handled by PortCostsButton). */}
                              <PortCostsButton portName={port.name} />
                              <button
                                onClick={() => setActivePorts((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-0.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Speed input */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <label className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                  Speed (knots)
                  <input
                    type="number"
                    min={1}
                    max={25}
                    step={0.5}
                    value={plannerSpeed}
                    onChange={(e) => setPlannerSpeed(Number(e.target.value) || 12)}
                    className="mt-1 w-full px-3 py-1.5 text-sm font-mono font-bold rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] outline-none focus:border-cyan-500/50"
                  />
                </label>
              </div>

              {/* Passage-avoidance toggles — Suez (Red Sea), Panama.
                  Collapsed by default (operators rarely tweak after a
                  voyage is planned); click the header row to expand.
                  The (n) badge surfaces how many toggles are ACTIVE
                  when the section is closed — tells ops at a glance
                  "avoidance is affecting my route" without opening. */}
              <div className="border-b border-[var(--color-border-subtle)]">
                <button
                  type="button"
                  onClick={() => setAvoidOpen((o) => !o)}
                  className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-[var(--color-text-tertiary)] transition-transform",
                      avoidOpen && "rotate-90",
                    )}
                  />
                  <span className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Avoid passages
                  </span>
                  {(() => {
                    const activeCount =
                      (avoidSuez ? 1 : 0) +
                      (avoidPanama ? 1 : 0) +
                      avoidedChainIds.size;
                    return activeCount > 0 ? (
                      <span className="ml-auto text-[0.55rem] font-mono rounded-full bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5">
                        {activeCount} active
                      </span>
                    ) : null;
                  })()}
                </button>
                {avoidOpen && (
                  <div className="px-4 pb-3 -mt-1">
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={avoidSuez}
                        onChange={(e) => setAvoidSuez(e.target.checked)}
                        className="accent-cyan-500 cursor-pointer"
                      />
                      <span>Avoid Suez (Cape of Good Hope)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer mt-1.5">
                      <input
                        type="checkbox"
                        checked={avoidPanama}
                        onChange={(e) => setAvoidPanama(e.target.checked)}
                        className="accent-cyan-500 cursor-pointer"
                      />
                      <span>Avoid Panama</span>
                    </label>
                    {/* Per-chain avoidance — rendered only for chains
                        marked `avoidable: true` in channel_chains.json.
                        Useful for size-restricted passages (Kiel Canal
                        for post-Panamax etc.). */}
                    {avoidableChains.map((ch) => (
                      <label
                        key={ch.id}
                        className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer mt-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={avoidedChainIds.has(ch.id)}
                          onChange={(e) => {
                            setAvoidedChainIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(ch.id);
                              else next.delete(ch.id);
                              return next;
                            });
                          }}
                          className="accent-cyan-500 cursor-pointer"
                        />
                        <span>Avoid {ch.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Map overlays — purely visual, not tied to routing.
                  ECA/SECA = MARPOL Annex VI emission control areas where
                  low-sulphur / low-NOx fuel rules apply. Operators want
                  these visible while planning to anticipate fuel-switch
                  points. Not a legal substitute for official charts.
                  Same collapsible pattern as Avoid Passages. */}
              <div className="border-b border-[var(--color-border-subtle)]">
                <button
                  type="button"
                  onClick={() => setOverlaysOpen((o) => !o)}
                  className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-[var(--color-text-tertiary)] transition-transform",
                      overlaysOpen && "rotate-90",
                    )}
                  />
                  <span className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Map overlays
                  </span>
                  {(() => {
                    const activeCount =
                      (showEmissionZones ? 1 : 0) + (showRiskZones ? 1 : 0);
                    return activeCount > 0 ? (
                      <span className="ml-auto text-[0.55rem] font-mono rounded-full bg-orange-500/20 text-orange-300 px-1.5 py-0.5">
                        {activeCount} shown
                      </span>
                    ) : null;
                  })()}
                </button>
                {overlaysOpen && (
                  <div className="px-4 pb-3 -mt-1">
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showEmissionZones}
                        onChange={(e) => setShowEmissionZones(e.target.checked)}
                        className="accent-orange-500 cursor-pointer"
                      />
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{
                            // Outlined swatch matches the outline-only map style.
                            border: "2px solid #f97316",
                          }}
                        />
                        Emission zones (ECA/SECA)
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer mt-1.5">
                      <input
                        type="checkbox"
                        checked={showRiskZones}
                        onChange={(e) => setShowRiskZones(e.target.checked)}
                        className="accent-red-500 cursor-pointer"
                      />
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor: "rgba(220, 38, 38, 0.25)",
                            border: "2px solid #dc2626",
                          }}
                        />
                        Risk zones (piracy / war)
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Results — single card when compare is off; stacked
                  A + B cards + delta summary when compare is on. */}
              {plannerDistance && plannerPorts.length >= 2 && !compareMode && (
                <div className="px-4 py-4">
                  <div className="rounded-[var(--radius-md)] border border-cyan-500/30 bg-cyan-500/5 p-4">
                    {/* ETA — primary info */}
                    <div className="text-2xl font-mono font-bold text-[var(--color-text-primary)]">
                      {plannerDistance.etaDisplay}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-tertiary)]">
                      <span>@ {plannerSpeed} kn</span>
                      <span className="text-[var(--color-border-default)]">|</span>
                      <span className="font-mono">{plannerDistance.totalNm.toLocaleString()} NM</span>
                    </div>
                    {/* Leg breakdown */}
                    {plannerDistance.legs.length > 1 && (
                      <div className="mt-3 pt-3 border-t border-cyan-500/20 space-y-1">
                        {plannerDistance.legs.map((leg, i) => {
                          const legEtaDays = plannerSpeed > 0 ? leg.distanceNm / (plannerSpeed * 24) : 0;
                          const legD = Math.floor(legEtaDays);
                          const legH = Math.round((legEtaDays - legD) * 24);
                          const legEta = legD > 0 ? `${legD}d ${legH}h` : `${legH}h`;
                          return (
                            <div key={i} className="flex items-center gap-1.5 text-[0.65rem] text-[var(--color-text-tertiary)]">
                              <ChevronRight className="h-3 w-3 text-cyan-500/50" />
                              <span className="truncate">{leg.from.split(",")[0]}</span>
                              <span className="text-cyan-500/50">&rarr;</span>
                              <span className="truncate">{leg.to.split(",")[0]}</span>
                              <span className="ml-auto font-mono">{legEta}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Weather-adjusted ETA section. Loading while the
                        forecast sampler decodes PNG frames for the
                        route; filled-in once the compute lands. Amber
                        divider + storm icon distinguishes it from the
                        LIVE AIS block below (emerald). Includes a
                        forecast/climatology breakdown so ops knows how
                        much of the delay is anchored to real forecast
                        data vs the longer-horizon seasonal average. */}
                    {kwonEta.loading && (
                      <div className="mt-3 pt-3 border-t border-amber-500/30">
                        <div className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-amber-400">
                          <span className="inline-block h-2 w-2 rounded-full border border-amber-400 border-t-transparent animate-spin" />
                          Weather-adjusted
                          <span className="ml-auto font-mono text-[var(--color-text-tertiary)] normal-case">
                            computing…
                          </span>
                        </div>
                      </div>
                    )}
                    {!kwonEta.loading && kwonEta.data && kwonEta.delayH !== null && (
                      <div className="mt-3 pt-3 border-t border-amber-500/30 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-amber-400">
                          <span>⛈</span>
                          Weather-adjusted
                          <span className="ml-auto font-mono text-[var(--color-text-tertiary)] normal-case">
                            {kwonEta.data.forecastHours > 0 && kwonEta.data.climatologyHours > 0
                              ? "forecast + clim."
                              : kwonEta.data.forecastHours > 0
                                ? "forecast"
                                : "climatology"}
                          </span>
                        </div>
                        {kwonEta.delayH > 0.5 && (
                          <>
                            <div className="flex items-center gap-1.5 text-[0.7rem]">
                              <span className="text-amber-500/60">+</span>
                              <span className="text-[var(--color-text-tertiary)]">Delay</span>
                              <span className="ml-auto font-mono font-semibold text-amber-300">
                                {formatDelayHours(kwonEta.delayH)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[0.7rem]">
                              <span className="text-amber-500/60">=</span>
                              <span className="text-[var(--color-text-tertiary)]">Adjusted total</span>
                              <span className="ml-auto font-mono font-semibold text-[var(--color-text-primary)]">
                                {formatDurationH(kwonEta.data.adjustedEtaH)}
                              </span>
                            </div>
                          </>
                        )}
                        {kwonEta.delayH <= 0.5 && (
                          <div className="flex items-center gap-1.5 text-[0.7rem] text-[var(--color-text-tertiary)]">
                            <span className="text-amber-500/60">≈</span>
                            Calm conditions — no meaningful weather delay
                          </div>
                        )}
                        {kwonEta.data.climatologyHours > 0 && kwonEta.data.forecastHours > 0 && (
                          <div className="text-[0.55rem] text-[var(--color-text-tertiary)] italic leading-tight pt-0.5">
                            First {Math.round(kwonEta.data.forecastHours)}h from NOAA GFS forecast; remainder from regional climatology.
                          </div>
                        )}
                        {kwonEta.data.climatologyHours === 0 && kwonEta.data.forecastHours > 0 && (
                          <div className="text-[0.55rem] text-[var(--color-text-tertiary)] italic leading-tight pt-0.5">
                            Entire voyage within NOAA GFS forecast window.
                          </div>
                        )}
                      </div>
                    )}
                    {kwonEta.error !== null && (
                      <div className="mt-3 pt-3 border-t border-red-500/30 text-[0.6rem] text-red-400">
                        Weather-adjusted ETA failed: {kwonEta.error}
                      </div>
                    )}

                    {/* Live AIS section — only renders when a vessel is
                        selected AND it has a live snapshot. Emerald
                        divider + small broadcast icon sets it visually
                        apart from the planner's own numbers (which are
                        calm-weather estimates, not vessel-reported). */}
                    {selectedVessel?.aisMode &&
                      (selectedVessel.aisDestination || selectedVessel.aisEta) && (
                        <div className="mt-3 pt-3 border-t border-emerald-500/30 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-emerald-400">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-amber" />
                            Live AIS
                            <span className="ml-auto font-mono text-[var(--color-text-tertiary)] normal-case">
                              {formatAisAge(selectedVessel.aisAgeMs ?? null)}
                            </span>
                          </div>
                          {selectedVessel.aisDestination && (
                            <div className="flex items-center gap-1.5 text-[0.7rem]">
                              <span className="text-emerald-500/60">&rarr;</span>
                              <span className="text-[var(--color-text-tertiary)]">Destination</span>
                              <span className="ml-auto font-mono font-semibold text-[var(--color-text-primary)]">
                                {selectedVessel.aisDestination}
                              </span>
                            </div>
                          )}
                          {selectedVessel.aisEta && (
                            <div className="flex items-center gap-1.5 text-[0.7rem]">
                              <span className="text-emerald-500/60">⏱</span>
                              <span className="text-[var(--color-text-tertiary)]">ETA (AIS)</span>
                              <span className="ml-auto font-mono font-semibold text-[var(--color-text-primary)]">
                                {formatEtaShort(selectedVessel.aisEta)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Compare-mode results — two cards stacked + delta */}
              {compareMode && (
                <div className="px-4 py-4 space-y-3">
                  {/* Route A card */}
                  <div className="rounded-[var(--radius-md)] border border-cyan-500/30 bg-cyan-500/5 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-cyan-400" />
                      <span className="text-[0.65rem] font-bold text-cyan-400 uppercase tracking-wider">
                        Route A
                      </span>
                    </div>
                    {plannerDistance && plannerPorts.length >= 2 ? (
                      <div>
                        <div className="text-lg font-mono font-bold text-[var(--color-text-primary)]">
                          {plannerDistance.etaDisplay}
                          <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-2">
                            · {plannerDistance.totalNm.toLocaleString()} NM
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--color-text-tertiary)] italic">
                        Add at least 2 waypoints to Route A
                      </div>
                    )}
                  </div>

                  {/* Route B card */}
                  <div className="rounded-[var(--radius-md)] border border-pink-500/30 bg-pink-500/5 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-pink-400" />
                      <span className="text-[0.65rem] font-bold text-pink-400 uppercase tracking-wider">
                        Route B
                      </span>
                    </div>
                    {plannerDistanceB && plannerPortsB.length >= 2 ? (
                      <div>
                        <div className="text-lg font-mono font-bold text-[var(--color-text-primary)]">
                          {plannerDistanceB.etaDisplay}
                          <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-2">
                            · {plannerDistanceB.totalNm.toLocaleString()} NM
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--color-text-tertiary)] italic">
                        Add at least 2 waypoints to Route B
                      </div>
                    )}
                  </div>

                  {/* Delta — only when both routes computed */}
                  {plannerDistance && plannerDistanceB &&
                    plannerPorts.length >= 2 && plannerPortsB.length >= 2 && (() => {
                    const deltaNm = plannerDistanceB.totalNm - plannerDistance.totalNm;
                    const deltaDays = plannerDistanceB.etaDays - plannerDistance.etaDays;
                    const deltaPct = plannerDistance.totalNm > 0
                      ? (deltaNm / plannerDistance.totalNm) * 100
                      : 0;
                    const positive = deltaNm > 0;
                    const sign = deltaNm > 0 ? "+" : "";
                    // Absolute values for time display (we show sign separately).
                    const absDays = Math.abs(deltaDays);
                    const dD = Math.floor(absDays);
                    const dH = Math.round((absDays - dD) * 24);
                    const deltaTimeStr = dD > 0 ? `${dD}d ${dH}h` : `${dH}h`;
                    return (
                      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-2)] p-3">
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                          B − A (Deviation)
                        </div>
                        <div className="flex items-baseline gap-3">
                          <span className={`text-base font-mono font-bold ${
                            positive ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"
                          }`}>
                            {sign}{Math.round(deltaNm).toLocaleString()} NM
                          </span>
                          <span className={`text-xs font-mono ${
                            positive ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"
                          }`}>
                            ({sign}{deltaPct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className={`text-xs mt-1 ${
                          positive ? "text-[var(--color-warning)]/80" : "text-[var(--color-success)]/80"
                        }`}>
                          {sign}{deltaTimeStr} @ {plannerSpeed} kn
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Worldscale rates — shown for Route A's endpoints when
                  there are at least 2 waypoints. Always uses Route A
                  (the "main" route) even in compare mode, since WS
                  rates are per (load, discharge) pair not per variant. */}
              {plannerPorts.length >= 2 && (
                <WorldscalePanel
                  loadPort={plannerPorts[0]?.name ?? null}
                  dischargePort={plannerPorts[plannerPorts.length - 1]?.name ?? null}
                />
              )}

              {/* Clear all — clears both routes when compare is on */}
              {(plannerPorts.length > 0 || plannerPortsB.length > 0) && (
                <div className="px-4 pb-4">
                  <button
                    onClick={() => {
                      setPlannerPorts([]);
                      setPlannerDistance(null);
                      setPlannerRouteLegs([]);
                      setPlannerPortsB([]);
                      setPlannerDistanceB(null);
                      setPlannerRouteLegsB([]);
                    }}
                    className="w-full px-3 py-2 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--color-border-default)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
                  >
                    Clear {compareMode ? "both routes" : "all"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right-side detail panel */}
        <div className={`
          flex-shrink-0 bg-[var(--color-surface-1)] border-l border-[var(--color-border-default)]
          transition-all duration-300 overflow-hidden
          ${!plannerMode && selectedVessel ? "w-80" : "w-0"}
        `}>
          {!plannerMode && selectedVessel && (
            <div className="w-80 h-full overflow-y-auto">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[var(--color-text-primary)] truncate">
                    {selectedVessel.vesselName}
                  </div>
                  {selectedVessel.vesselImo && (
                    <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)]">
                      IMO {selectedVessel.vesselImo}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedVesselId(null)}
                  className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status + Linkage */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-[var(--color-accent-text)] tracking-wide">
                    {selectedVessel.linkageCode}
                  </span>
                  <Badge
                    variant={selectedVessel.status as any}
                    className="text-[0.625rem]"
                  >
                    {STATUS_LABELS[selectedVessel.status] ?? selectedVessel.status}
                  </Badge>
                </div>
                {selectedVessel.product && (
                  <div className="text-xs text-[var(--color-text-tertiary)]">{selectedVessel.product}</div>
                )}
              </div>

              {/* Route visualization */}
              {(selectedVessel.loadport || selectedVessel.dischargePort) && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Route</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <Anchor className="h-3 w-3 text-[var(--color-info)]" />
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">
                          {selectedVessel.loadport ?? "TBD"}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
                    <div className="flex-1 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">
                          {selectedVessel.dischargePort ?? "TBD"}
                        </span>
                        <MapPin className="h-3 w-3 text-[var(--color-accent-text)]" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ETA to destination */}
              {selectedVessel.etaHours != null && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">ETA to Destination</div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-bold text-[var(--color-text-primary)]">
                      {selectedVessel.etaHours < 24
                        ? `${selectedVessel.etaHours}h`
                        : `${Math.floor(selectedVessel.etaHours / 24)}d ${selectedVessel.etaHours % 24}h`}
                    </span>
                    <span className="text-[0.625rem] text-[var(--color-text-tertiary)]">
                      ~{Math.round(selectedVessel.etaHours * TANKER_SPEED_KN)} NM remaining
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(5, Math.min(95, 100 - (selectedVessel.etaHours / 240) * 100))}%`,
                        backgroundColor: STATUS_COLORS[selectedVessel.status] ?? "#6B7280",
                      }}
                    />
                  </div>
                </div>
              )}
              {selectedVessel.status !== "sailing" && selectedVessel.etaHours == null && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">ETA</div>
                  <span className="text-xs text-[var(--color-text-tertiary)] italic">
                    {selectedVessel.status === "loading" ? "At loadport — awaiting departure" :
                     selectedVessel.status === "discharging" ? "At discharge port" :
                     selectedVessel.status === "active" ? "Vessel not yet sailing" : "—"}
                  </span>
                </div>
              )}

              {/* Laycan */}
              {selectedVessel.earliestLaycan && (
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Laycan</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                      {new Date(selectedVessel.earliestLaycan).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      {selectedVessel.latestLaycanEnd && (
                        <> — {new Date(selectedVessel.latestLaycanEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</>
                      )}
                    </span>
                    {(() => {
                      const days = daysUntil(selectedVessel.earliestLaycan);
                      if (days < 0) return <span className="text-[0.625rem] text-[var(--color-text-tertiary)]">passed</span>;
                      const isUrgent = days <= 3;
                      return (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          isUrgent
                            ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                            : "text-[var(--color-text-tertiary)]"
                        }`}>
                          {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}d`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Cargo */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Cargo</div>
                <div className="space-y-1.5">
                  {selectedVessel.buys.map((d, i) => (
                    <div key={`buy-${i}`} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-info)] flex-shrink-0" />
                      <span className="text-[var(--color-text-secondary)]">
                        <span className="font-medium text-[var(--color-text-primary)]">{d.counterparty}</span>
                        {" "}{formatQty(d.quantityMt)} MT {d.product}
                      </span>
                    </div>
                  ))}
                  {selectedVessel.sells.map((d, i) => (
                    <div key={`sell-${i}`} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />
                      <span className="text-[var(--color-text-secondary)]">
                        <span className="font-medium text-[var(--color-text-primary)]">{d.counterparty}</span>
                        {" "}{formatQty(d.quantityMt)} MT {d.product}
                      </span>
                    </div>
                  ))}
                  {selectedVessel.buys.length === 0 && selectedVessel.sells.length === 0 && (
                    <div className="text-xs text-[var(--color-text-tertiary)] italic">No deals attached</div>
                  )}
                </div>
              </div>

              {/* Operator */}
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">Operator</div>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {selectedVessel.assignedOperatorName ?? "Unassigned"}
                </span>
              </div>

              {/* Action */}
              <div className="px-4 py-4 space-y-2">
                {selectedVessel.id.startsWith("demo-") ? (
                  <div className="text-xs text-center text-[var(--color-text-tertiary)] italic py-1">
                    Demo vessel — no linked cargo
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    onClick={() => router.push(`/linkages/${selectedVessel.id}`)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Linkage
                  </Button>
                )}
                {/* Explicit "load this vessel's route into the planner".
                    Replaces the old side-effect where marker clicks
                    auto-toggled Planner mode and hijacked the detail
                    view. Still lets operators go "see this ship? now
                    plan its voyage" in one deliberate click. */}
                {(selectedVessel.loadport || selectedVessel.dischargePort) && (
                  <Button
                    variant="secondary"
                    size="md"
                    className="w-full"
                    onClick={() => openPlannerForVessel(selectedVessel.id)}
                  >
                    Open in Planner
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
