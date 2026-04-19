/**
 * Runtime ocean-graph loader + Dijkstra.
 *
 * Loads the V2 land-safe graph (exported by
 * `scripts/ocean-routing/export_graph.py` as graph.json) into an
 * in-memory adjacency map at module init. Exposes:
 *
 *   - `getRuntimeGraph()`      — memoised graph accessor
 *   - `dijkstra()`             — shortest-path with support for
 *                                temporary extra nodes/edges
 *   - `routeWithCustomWaypoints()` — composes multi-leg voyages where
 *                                any leg endpoint may be a custom
 *                                (lat, lon) click-anywhere waypoint
 *
 * Custom-waypoint strategy: for each custom (lat, lon), we find the
 * k nearest graph nodes by haversine, build temporary edges custom→
 * neighbour (and back) with haversine weights, and run Dijkstra with
 * those injected. We do NOT mutate the shared graph — each request
 * passes its temporary additions through the Dijkstra call's `extras`
 * parameter, so concurrent requests can't corrupt each other and
 * we don't need to "clean up" after.
 *
 * Land-safety: the graph's native edges are already filtered against
 * GSHHG by the Python pipeline. The *injected* edges (custom →
 * nearest graph node) are drawn straight-line across water and
 * *may* cross a small island if the custom waypoint is close to
 * a coast with a peninsula. We currently accept this as a minor
 * issue — if it surfaces in practice, add a turf-based coast
 * intersection check here.
 *
 * Memory: graph.json is ~1 MB on disk, ~5–10 MB as in-memory adj
 * map + node array. Loaded once per serverless-function container,
 * so cold-start cost (~20–50 ms parse) is one-time. Dijkstra over
 * 10k nodes / 17k edges runs in ~30–50 ms with a binary-heap PQ.
 */

// Import the graph as a JSON module so Next.js / Vercel bundles it
// into the serverless function at build time. This is how every
// other JSON payload in the provider is loaded (see ./index.ts) —
// keeps runtime file-system access out of the hot path.
import graphData from "./graph.json";
// Operator-curated forbidden / navigable zones. Shipped as a static
// JSON import so the runtime has them without a round trip. Pipeline
// also reads the same file for consistency.
import zonesData from "../../../../../../scripts/ocean-routing/zones.json";
// Hand-curated channel chains (Turkish Straits, Izmit feeders, etc.).
// Pipeline NO LONGER bakes these into graph.json — the runtime is
// authoritative. Edits saved via the Channel Editor push the new
// chains into this module's override slot and take effect on the
// next route calculation, no pipeline rebuild needed.
import channelChainsData from "../../../../../../scripts/ocean-routing/channel_chains.json";
// Natural Earth 1:50m land polygons. Used by isArcClearOfLand() to
// decide whether a direct great-circle between two points is safe
// to skip the graph with. 1.6 MB on disk, loaded once per serverless
// container at first use and kept in memory alongside an RBush
// spatial index for O(log n) bbox rejection. Source:
// github.com/nvkelso/natural-earth-vector, ne_50m_land.geojson.
import landData from "./land-50m.json";
import RBush from "rbush";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

// ── File format (must match export_graph.py output) ──────────
interface GraphFile {
  meta: {
    nodeCount: number;
    edgeCount: number;
    portCount: number;
    chainNodeCount?: number;
    variant: string;
    builtAt: string;
  };
  nodes: Array<{ id: number; lat: number; lon: number }>;
  edges: Array<{ from: number; to: number; weight: number }>;
  portMap: Record<string, number>;
  /** Nodes that belong to hand-curated channel chains. Intra-chain
   * edges (both endpoints ∈ this set) get a weight discount in
   * Dijkstra so the chain dominates nearby coastal shortcuts. */
  chainNodeIds?: number[];
}

interface GraphNode {
  id: number;
  lat: number;
  lon: number;
}

interface AdjacencyEntry {
  to: number;
  weight: number;
}

export interface RuntimeGraph {
  /** Node lookup by id — index into this array == node id (dense). */
  nodes: GraphNode[];
  /** Adjacency list — idx = node id, value = neighbours with edge weights. */
  adj: AdjacencyEntry[][];
  /** Port canonical name → node id. */
  portMap: Map<string, number>;
  /**
   * Set of node ids that represent ports. Used by Dijkstra to block
   * transit through ports that aren't the source/destination of the
   * current leg — otherwise a port's 5 "connect-to-nearest" edges
   * create a cheap shortcut through the port itself, and Dijkstra
   * happily detours via Monrovia/Santa Cruz/etc. en route to
   * elsewhere. Ports are endpoints, not transit nodes.
   */
  portNodeIds: Set<number>;
  /**
   * Set of node ids that belong to a hand-curated channel chain.
   * The runtime Dijkstra multiplies the weight of any edge whose
   * BOTH endpoints sit in this set by `CHAIN_WEIGHT_DISCOUNT` — so
   * chains appear artificially attractive and Dijkstra chooses them
   * over nearby coastal shortcuts that are shorter in real NM.
   * Reported distance is recomputed from the path coordinates using
   * true haversine, so the operator still sees accurate mileage.
   */
  chainNodeIds: Set<number>;
  /**
   * Per-chain node sets — populated only for chains injected at
   * runtime (channel_chains.json). Enables the Planner's "Avoid
   * <chain>" toggles to block an individual passage (e.g. Kiel
   * Canal for Panamax-only tankers) without touching other
   * chains. Empty for legacy graphs that baked chains in.
   */
  chainNodesByChainId: Map<string, Set<number>>;
  /**
   * Nodes whose chain has `sticky !== false` — i.e. the subset of
   * chain nodes that should benefit from the CHAIN_WEIGHT_DISCOUNT
   * in Dijkstra's edge evaluation. Split out from the general
   * chainNodeIds so "optional" chains (like Kiel Canal) can exist
   * in the graph as navigable paths without Dijkstra artificially
   * preferring them over graph alternatives. If BOTH endpoints of
   * an intra-chain edge are in this set, the discount applies;
   * otherwise the edge runs at full haversine weight.
   */
  stickyChainNodeIds: Set<number>;
  /**
   * Set of node ids sitting inside any `blocksRouting=true` zone
   * (operator-drawn forbidden polygons, persisted in zones.json).
   * Any edge whose target is in this set gets its weight multiplied
   * by FORBIDDEN_WEIGHT_PENALTY, making Dijkstra avoid these regions
   * unless no alternative exists.
   */
  forbiddenNodeIds: Set<number>;
  /**
   * Set of node ids sitting inside any `hardBlock=true` zone. Treated
   * exactly like the avoidSuez / avoidPanama bbox filter: Dijkstra
   * skips every edge whose target is in this set, so the region is
   * completely off-limits (no matter how much longer the alternative
   * is). Use for NSR, active war zones, etc. — places where a 10×
   * penalty would still be crossed if the alternative is very long.
   */
  hardBlockedNodeIds: Set<number>;
  /** Meta / introspection. */
  meta: GraphFile["meta"];
  /** First id available for temporary (per-request) custom nodes. */
  nextTempId: number;
}

// ── One-time loader (memoised) ───────────────────────────────
let cached: RuntimeGraph | null = null;

/**
 * Runtime override for zones — if set, takes precedence over the
 * bundled zones.json. Used by the dev editor to make save-and-see
 * instant: after POSTing new zones, the editor calls
 * `invalidateRuntimeGraph({ zonesOverride })` and the next route
 * computation honours the operator's edits without a dev-server
 * restart. Cleared by passing `null` or omitting the field.
 */
let zonesOverride: Array<{
  blocksRouting?: boolean;
  hardBlock?: boolean;
  polygon?: Array<[number, number]>;
}> | null = null;

/**
 * Runtime override for channel chains — mirrors zonesOverride. When
 * set, getRuntimeGraph injects these chains instead of the bundled
 * channel_chains.json. Channel Editor flips this on every Save so
 * the next Planner / vessel-route lookup sees fresh chains.
 */
let chainsOverride: Array<{
  id: string;
  waypoints: Array<[number, number]>;
  sticky?: boolean;
}> | null = null;

/**
 * Drop the cached graph (and any live overrides) so the next call
 * to `getRuntimeGraph()` rebuilds from current JSON + any passed
 * overrides. Call after:
 *   - zone edits in the dev editor (pass the in-memory list as
 *     `opts.zones`)
 *   - channel chain edits in the dev editor (`opts.channelChains`)
 *   - manual zones.json / channel_chains.json replacement
 * Also flushes any downstream caches (the ocean-routing provider's
 * per-request route memo lives there — we let it import our export
 * and flush on its own).
 */
export function invalidateRuntimeGraph(opts?: {
  zones?: Array<{
    blocksRouting?: boolean;
    hardBlock?: boolean;
    polygon?: Array<[number, number]>;
  }> | null;
  channelChains?: Array<{
    id: string;
    waypoints: Array<[number, number]>;
    sticky?: boolean;
  }> | null;
}): void {
  if (opts && "zones" in opts) {
    zonesOverride = opts.zones ?? null;
  }
  if (opts && "channelChains" in opts) {
    chainsOverride = opts.channelChains ?? null;
  }
  cached = null;
}

export function getRuntimeGraph(): RuntimeGraph {
  if (cached) return cached;
  const data = graphData as GraphFile;

  // Remap original node IDs to a dense 0..N-1 sequence.
  //
  // The Python pipeline preserves each node's original ID through the
  // export, but bathymetry / land-safety filters can drop searoute
  // nodes mid-build and leave gaps in the ID space. Internal numpy
  // code in Python handles this fine (dict-keyed), but our Node.js
  // runtime wants contiguous IDs so dist/prev can live in flat
  // typed arrays. We rebuild indices here and translate the edge +
  // port-map references in one pass.
  const idMap = new Map<number, number>();
  const nodes: GraphNode[] = data.nodes.map((n, i) => {
    idMap.set(n.id, i);
    return { id: i, lat: n.lat, lon: n.lon };
  });

  // Build undirected adjacency list. Each edge stored in both
  // directions so Dijkstra can traverse either way without extra logic.
  const adj: AdjacencyEntry[][] = Array.from({ length: nodes.length }, () => []);
  for (const e of data.edges) {
    const fromIdx = idMap.get(e.from);
    const toIdx = idMap.get(e.to);
    // Skip edges that reference a dropped node (shouldn't happen if the
    // Python pipeline ran cleanly, but guards against future mismatches).
    if (fromIdx === undefined || toIdx === undefined) continue;
    adj[fromIdx].push({ to: toIdx, weight: e.weight });
    adj[toIdx].push({ to: fromIdx, weight: e.weight });
  }

  // Translate port-map (name → original-id) to dense-index references.
  const portMap = new Map<string, number>();
  for (const [name, origId] of Object.entries(data.portMap)) {
    const idx = idMap.get(origId);
    if (idx !== undefined) portMap.set(name, idx);
  }

  const portNodeIds = new Set<number>(portMap.values());

  // Chain nodes come from TWO possible sources:
  //   1. Legacy: graph.json baked them in (pipeline ≤ commit e9ee3e6).
  //      Their original IDs land in `data.chainNodeIds`.
  //   2. New: channel_chains.json is injected live below. The runtime
  //      is authoritative — edits via the Channel Editor take effect
  //      on the next invalidation without a pipeline rebuild.
  // Both sources feed into the same Set<number>; downstream Dijkstra
  // only sees dense ids and doesn't care where they came from.
  const chainNodeIds = new Set<number>();
  const stickyChainNodeIds = new Set<number>();
  for (const origId of data.chainNodeIds ?? []) {
    const idx = idMap.get(origId);
    if (idx !== undefined) {
      chainNodeIds.add(idx);
      // Legacy baked-in chains always get the discount (there was no
      // sticky flag when they were exported — behaviour stays
      // unchanged).
      stickyChainNodeIds.add(idx);
    }
  }

  // INJECTION: read channel chains from override (fresh editor state)
  // or the bundled JSON, then extend the graph with chain waypoints
  // as new nodes + intra-chain edges + nearest-k hooks into the base
  // graph. baseNodeCount locks in the "is a base node" cutoff so
  // later nearest-neighbour lookups don't pick already-added chain
  // nodes as connection targets.
  const baseNodeCount = nodes.length;
  const chainsSource = chainsOverride ?? collectBundledChains();
  const chainNodesByChainId = new Map<string, Set<number>>();
  for (const chain of chainsSource) {
    if (!Array.isArray(chain.waypoints) || chain.waypoints.length < 2) {
      continue;
    }
    // `sticky` defaults to true so pre-flag chains keep their
    // Dijkstra-preference behaviour. A chain marked sticky=false
    // still gets its nodes + edges injected (and stays toggle-able
    // via avoidedChainIds) but loses the 0.3× weight discount so
    // Dijkstra only follows it when it's actually the organic
    // shortest path.
    const isSticky = chain.sticky !== false;
    const perChainSet = new Set<number>();
    const chainIds: number[] = [];
    for (const [lat, lon] of chain.waypoints) {
      const id = nodes.length;
      nodes.push({ id, lat, lon });
      adj.push([]);
      chainIds.push(id);
      chainNodeIds.add(id);
      if (isSticky) stickyChainNodeIds.add(id);
      perChainSet.add(id);
    }
    chainNodesByChainId.set(chain.id, perChainSet);
    // Intra-chain edges — consecutive waypoints, no land check
    // (chain is expert-vetted, same trust model as Python pipeline).
    for (let i = 0; i < chainIds.length - 1; i++) {
      const a = chainIds[i];
      const b = chainIds[i + 1];
      const [aLat, aLon] = chain.waypoints[i];
      const [bLat, bLon] = chain.waypoints[i + 1];
      const d = haversineNm(aLat, aLon, bLat, bLon);
      adj[a].push({ to: b, weight: d });
      adj[b].push({ to: a, weight: d });
    }
    // Per-waypoint hooks — connect each chain node to ≤2 nearest
    // BASE nodes (id < baseNodeCount) within 30 NM. Same bounds as
    // the Python add_channel_chains to keep behaviour symmetric.
    for (let i = 0; i < chainIds.length; i++) {
      const chainId = chainIds[i];
      const [cpLat, cpLon] = chain.waypoints[i];
      const nearest = findNearestBaseNodes(
        nodes,
        baseNodeCount,
        cpLat,
        cpLon,
        5
      );
      let connected = 0;
      for (const { id: baseId, distanceNm } of nearest) {
        if (connected >= 2) break;
        // Was 30 NM — too tight when chain endpoints land in
        // narrower seas (Baltic via Danish Straits, where the
        // nearest 1.5° grid node can be 40+ NM east of Bornholm).
        // 60 NM still feels like "local" bridge, lets the chain
        // reach the first open-water grid node.
        if (distanceNm > 60) continue;
        adj[chainId].push({ to: baseId, weight: distanceNm });
        adj[baseId].push({ to: chainId, weight: distanceNm });
        connected++;
      }
    }
  }

  // Forbidden zones: walk every node once, checking soft polygons
  // (10× weight penalty) and hard polygons (full skip) in the same
  // pass. Cost: ~O(N·Z·V) where Z = number of zones (few) and V =
  // avg vertices per zone (10-40), so ~a few ms on graph init. We
  // do it once, cache the sets, and hot-path Dijkstra reads them
  // in O(1). A node can technically sit in both a soft and a hard
  // polygon; we put it in both sets and Dijkstra sees the hard
  // skip first (which wins — the edge is dropped).
  const forbiddenNodeIds = new Set<number>();
  const hardBlockedNodeIds = new Set<number>();
  const { soft: softPolygons, hard: hardPolygons } = collectZonePolygons();
  if (softPolygons.length > 0 || hardPolygons.length > 0) {
    for (const n of nodes) {
      for (const poly of softPolygons) {
        if (pointInPolygon(n.lat, n.lon, poly)) {
          forbiddenNodeIds.add(n.id);
          break;
        }
      }
      for (const poly of hardPolygons) {
        if (pointInPolygon(n.lat, n.lon, poly)) {
          hardBlockedNodeIds.add(n.id);
          break;
        }
      }
    }
  }

  cached = {
    nodes,
    adj,
    portMap,
    portNodeIds,
    chainNodeIds,
    chainNodesByChainId,
    stickyChainNodeIds,
    forbiddenNodeIds,
    hardBlockedNodeIds,
    meta: data.meta,
    nextTempId: nodes.length,
  };
  return cached;
}

// ── Geo utilities ────────────────────────────────────────────
const EARTH_NM = 3440.065;

interface ZonesFile {
  zones?: Array<{
    blocksRouting?: boolean;
    hardBlock?: boolean;
    polygon?: Array<[number, number]>;
  }>;
}

interface ChainsFile {
  chains?: Array<{
    id?: string;
    waypoints?: Array<[number, number]>;
    sticky?: boolean;
  }>;
}

/**
 * Extract the hand-curated chains from the bundled JSON. Used when
 * the editor hasn't pushed an override (cold page load).
 */
function collectBundledChains(): Array<{
  id: string;
  waypoints: Array<[number, number]>;
  sticky?: boolean;
}> {
  const raw = channelChainsData as unknown as ChainsFile;
  const out: Array<{
    id: string;
    waypoints: Array<[number, number]>;
    sticky?: boolean;
  }> = [];
  for (const c of raw.chains ?? []) {
    if (!c.id || !c.waypoints || c.waypoints.length < 2) continue;
    out.push({ id: c.id, waypoints: c.waypoints, sticky: c.sticky });
  }
  return out;
}

/**
 * Find the k nearest nodes from the base graph (ids 0..baseCount-1),
 * sorted by haversine. O(baseCount) scan, no allocations per edge.
 * Deliberately excludes already-injected chain nodes so consecutive
 * chains don't hook into each other — every chain hooks directly
 * into the searoute backbone.
 */
function findNearestBaseNodes(
  allNodes: GraphNode[],
  baseCount: number,
  lat: number,
  lon: number,
  k: number
): Array<{ id: number; distanceNm: number }> {
  const scored: Array<{ id: number; distanceNm: number }> = [];
  for (let i = 0; i < baseCount; i++) {
    const n = allNodes[i];
    scored.push({ id: i, distanceNm: haversineNm(lat, lon, n.lat, n.lon) });
  }
  scored.sort((a, b) => a.distanceNm - b.distanceNm);
  return scored.slice(0, k);
}

/**
 * Extract blocking polygons from either the live editor override or
 * the bundled zones JSON. Returns two buckets:
 *   - `soft`  → `blocksRouting=true, hardBlock=false` — edges into
 *               these nodes get 10× weight penalty (avoidable but
 *               crossable if no alternative exists).
 *   - `hard`  → `hardBlock=true` — edges into these nodes are skipped
 *               entirely, same mechanism as avoidSuez/avoidPanama.
 * A zone marked `hardBlock=true` implies `blocksRouting=true` (the UI
 * keeps those in sync), but we still gate on the actual flag here in
 * case a hand-edited JSON ships with a stale combination.
 */
function collectZonePolygons(): {
  soft: Array<Array<[number, number]>>;
  hard: Array<Array<[number, number]>>;
} {
  const source: Array<{
    blocksRouting?: boolean;
    hardBlock?: boolean;
    polygon?: Array<[number, number]>;
  }> =
    zonesOverride ?? ((zonesData as unknown as ZonesFile).zones ?? []);
  const soft: Array<Array<[number, number]>> = [];
  const hard: Array<Array<[number, number]>> = [];
  for (const z of source) {
    if (!z.polygon || z.polygon.length < 3) continue;
    if (z.hardBlock) {
      hard.push(z.polygon);
      continue;
    }
    if (z.blocksRouting) soft.push(z.polygon);
  }
  return { soft, hard };
}

/**
 * Standard ray-casting point-in-polygon in the (lat, lon) plane.
 * Close enough for ships — our forbidden polygons are regional
 * bounding rings, not geodesic arcs, so flat-earth math matches how
 * the polygon was drawn. Handles the ±180° antimeridian sanely as
 * long as the polygon itself doesn't wrap (none of ours do).
 */
function pointInPolygon(
  lat: number,
  lon: number,
  poly: Array<[number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Two tiers of chain-edge preference:
 *
 *   - STICKY chains (default) — applied via CHAIN_WEIGHT_DISCOUNT.
 *     0.3 means the chain "looks" 3.3× cheaper than its real NM,
 *     so Dijkstra picks it over nearby coastal / sparse-anchor
 *     shortcuts even when the alternative is a few NM shorter.
 *     Use for chains that ARE the natural path through a region
 *     (Turkish Straits, Panama, Suez, las-palmas-fix).
 *
 *   - REGULAR chains (sticky: false) — applied via
 *     CHAIN_REGULAR_DISCOUNT. 0.9 means the chain "looks" 10%
 *     cheaper, so Dijkstra prefers it in near-tie cases (a 100 NM
 *     chain vs a 105 NM anchor zigzag wins) but doesn't overrule
 *     a clearly shorter alternative (Kiel Canal 637 NM vs Skagen
 *     513 NM → Skagen wins regardless). Use for chains that
 *     represent a valid option but shouldn't auto-win as the
 *     generic default (Kiel Canal for MR-class tankers, any chain
 *     marked "optional" by the operator).
 *
 * The reported distance stays honest — we always recompute true
 * haversine from the chosen path coords after Dijkstra decides.
 * The discount only lives inside the search.
 */
const CHAIN_WEIGHT_DISCOUNT = 0.3;
const CHAIN_REGULAR_DISCOUNT = 0.9;

/**
 * Mirror of the chain discount but INVERTED — edges whose target
 * sits inside a forbidden zone get their weight multiplied by this
 * factor, so Dijkstra treats transit through the zone as 10× more
 * expensive than it really is. The zone stays reachable (no hard
 * filter) for degenerate cases where no alternative exists, but any
 * route with an out-of-zone alternative takes it automatically.
 * The reported distance is still the true haversine — inflation
 * only lives in the search weights.
 */
const FORBIDDEN_WEIGHT_PENALTY = 10;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return EARTH_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Land-safety check (Option A — direct-first routing) ─────
/**
 * The graph-based Dijkstra guarantees land-safe paths by construction
 * (pipeline filters every edge against GSHHG), but it hops through a
 * 3°×6° anchor grid that causes visible zigzags and distance inflation
 * for open-ocean legs where a direct great-circle would be fine. This
 * helper provides the missing piece: given two points, decide whether
 * the great-circle between them is water-only. If yes, the caller
 * (routeThroughGraph etc.) uses the direct arc — no zigzag, no graph
 * hops. If no, fall back to the graph routing which knows how to
 * detour around land.
 *
 * Data: Natural Earth 1:50m land polygons (~4k features, 1.6 MB).
 * Resolution is enough for tanker routing — catches every continent
 * and island > ~5 NM wide, misses only tiny atolls / rocks which
 * tankers avoid visually anyway (and wouldn't route through by
 * accident on 100+ NM great-circle segments).
 *
 * Performance: RBush bbox index rejects most polygons per sample
 * (typical: 0-3 candidates). Point-in-polygon only runs on survivors.
 * Target: ~0.5 ms per sample, ~10 ms for a 20-sample arc check. A
 * multi-leg voyage with 15 legs is ~150 ms overhead — acceptable for
 * the "cold Dijkstra is 50 ms" baseline.
 */
interface LandBboxItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Index into landData.features — retrieved at point-in-polygon time. */
  idx: number;
}

/**
 * Lazy-built land index. Initialised on first isArcClearOfLand() call
 * (adds ~40 ms one-time to the first request in a container). Shared
 * across all subsequent calls and survives until the container recycles.
 */
let landIndex: RBush<LandBboxItem> | null = null;

function buildLandIndex(): RBush<LandBboxItem> {
  const tree = new RBush<LandBboxItem>();
  const items: LandBboxItem[] = [];
  // `landData` is a Feature / FeatureCollection depending on source —
  // we expect FeatureCollection from ne_50m_land.geojson but guard
  // defensively anyway.
  const features = (landData as { features?: GeoJsonFeature[] }).features ?? [];
  for (let i = 0; i < features.length; i++) {
    const bbox = geometryBbox(features[i].geometry);
    if (!bbox) continue;
    items.push({
      minX: bbox[0],
      minY: bbox[1],
      maxX: bbox[2],
      maxY: bbox[3],
      idx: i,
    });
  }
  tree.load(items);
  return tree;
}

interface GeoJsonFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties?: Record<string, unknown>;
}

/** Flat scan over a polygon/multipolygon ring to get its bbox. */
function geometryBbox(
  geom: GeoJsonFeature["geometry"]
): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const walk = (coords: number[][]) => {
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates as number[][][]) walk(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as number[][][][])
      for (const ring of poly) walk(ring);
  } else {
    return null;
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

/** Is a single (lat, lon) point inside any land polygon? */
function pointIsLand(lat: number, lon: number): boolean {
  const tree = landIndex ?? (landIndex = buildLandIndex());
  const hits = tree.search({ minX: lon, minY: lat, maxX: lon, maxY: lat });
  if (hits.length === 0) return false;
  const features = (landData as { features: GeoJsonFeature[] }).features;
  // turf.booleanPointInPolygon expects [lon, lat] — GeoJSON convention.
  for (const hit of hits) {
    const feat = features[hit.idx];
    if (booleanPointInPolygon([lon, lat], feat as never)) return true;
  }
  return false;
}

/**
 * Interpolate a point on the great-circle arc from (lat1,lon1) to
 * (lat2,lon2) at fractional distance f ∈ [0,1]. Spherical slerp
 * formula — handles antimeridian crossings naturally because it
 * operates in 3D Cartesian and projects back at the end.
 */
function greatCircleInterp(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  f: number
): [number, number] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const lam1 = lon1 * toRad;
  const phi2 = lat2 * toRad;
  const lam2 = lon2 * toRad;
  // Angular distance between the two endpoints.
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
      )
    );
  if (d < 1e-10) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x =
    A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
  const y =
    A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
  const z = A * Math.sin(phi1) + B * Math.sin(phi2);
  const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lam = Math.atan2(y, x);
  return [phi * toDeg, lam * toDeg];
}

/**
 * Is the great-circle arc between two points water-only?
 * Samples the arc at `samples` points and rejects any hit on land.
 * Endpoints are NOT tested — the caller is expected to pass water
 * coords (ports via pilot stations, custom waypoints on click-safe
 * surfaces); testing them would false-reject legitimate queries
 * when the port coord sits inside a polygon that nominally outlines
 * the port city (Natural Earth treats coastal cities as land).
 *
 * Sample density targets ~5 NM spacing along the arc so narrow
 * peninsulas (e.g. Calabria's tip between Tyrrhenian and Ionian
 * Sea, < 40 NM wide) can't slip between samples. RBush-backed bbox
 * rejection makes open-ocean samples effectively free — a 2000 NM
 * trans-Med arc with 400 samples is ~40 ms even if every sample
 * did a full point-in-polygon (which it doesn't, most have zero
 * bbox hits).
 *
 * Earlier version used dist/100 → 13 samples for a 1366 NM arc =
 * ~105 NM spacing, which happily skipped over Sicily + Calabria
 * and let Dijkstra declare a land-crossing arc "safe". The new
 * floor catches every feature visible at Natural Earth 1:50m
 * resolution.
 */
export function isArcClearOfLand(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): boolean {
  const dist = haversineNm(lat1, lon1, lat2, lon2);
  // Target ~5 NM between samples; cap at 600 so we don't blow up
  // on trans-Pacific pairs. 600 samples × 0.05 ms/rbush-miss ≈
  // 30 ms worst case on open ocean; coastal arcs may hit more
  // full point-in-polygon tests but still finish under 150 ms.
  const samples = Math.min(600, Math.max(30, Math.ceil(dist / 5)));
  for (let i = 1; i < samples; i++) {
    const f = i / samples;
    const [lat, lon] = greatCircleInterp(lat1, lon1, lat2, lon2, f);
    if (pointIsLand(lat, lon)) return false;
  }
  return true;
}

// ── Nearest-node lookup ──────────────────────────────────────
/**
 * Return the k nearest graph-node ids to (lat, lon), sorted by
 * haversine distance ascending. O(N) scan — fine for N=10k.
 *
 * If this becomes a hot path with many concurrent custom waypoints,
 * switch to a kd-tree (would need a WASM or pure-JS impl — leaflet's
 * built-in RBush is for bounding boxes, not nearest-k).
 */
export function findNearestNodes(
  graph: RuntimeGraph,
  lat: number,
  lon: number,
  k: number
): Array<{ id: number; distanceNm: number }> {
  const scored: Array<{ id: number; distanceNm: number }> = [];
  for (const node of graph.nodes) {
    const d = haversineNm(lat, lon, node.lat, node.lon);
    scored.push({ id: node.id, distanceNm: d });
  }
  scored.sort((a, b) => a.distanceNm - b.distanceNm);
  return scored.slice(0, k);
}

// ── Min-heap priority queue (binary) ─────────────────────────
// Minimal typed impl — no deps, fast enough for 10k-node Dijkstra.

class MinHeap {
  private data: Array<{ id: number; key: number }> = [];

  size(): number {
    return this.data.length;
  }

  push(id: number, key: number): void {
    this.data.push({ id, key });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): { id: number; key: number } | undefined {
    const n = this.data.length;
    if (n === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (n > 1) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].key <= this.data[i].key) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let min = i;
      if (l < n && this.data[l].key < this.data[min].key) min = l;
      if (r < n && this.data[r].key < this.data[min].key) min = r;
      if (min === i) break;
      [this.data[min], this.data[i]] = [this.data[i], this.data[min]];
      i = min;
    }
  }
}

// ── Dijkstra ─────────────────────────────────────────────────

export interface DijkstraExtras {
  /**
   * Temporary nodes present only for this single Dijkstra call.
   * Their ids MUST start from graph.nextTempId and increment upward.
   */
  extraNodes?: Map<number, { lat: number; lon: number }>;
  /**
   * Temporary undirected edges, by node id on either side.
   * Used to wire custom waypoints into the graph without mutating
   * the shared adjacency list.
   */
  extraEdges?: Map<number, AdjacencyEntry[]>;
  /**
   * Set of node ids that this run is not allowed to traverse. Used to
   * implement avoid-Suez / avoid-Panama at runtime: compute the set
   * of nodes sitting inside each avoided passage's bbox once per
   * request, pass it in, and the Dijkstra will route around them.
   * Start / end ids are never blocked regardless of this set.
   */
  blockedNodeIds?: Set<number>;
}

// Passage bounding boxes — identical to the ones the Python pipeline
// used to filter edges out when building the avoid-Suez / avoid-Panama
// variant JSONs. Kept in sync: any node sitting inside one of these
// is excluded from that variant's routing.
const AVOID_BBOX_SUEZ: [number, number, number, number] = [
  29.50, 31.50, 32.00, 33.00,
];
const AVOID_BBOX_PANAMA: [number, number, number, number] = [
  8.70, 9.50, -80.40, -79.20,
];

/**
 * Compute the set of graph nodes sitting inside the requested avoid
 * bboxes. Cheap: one pass over all nodes, no allocations per edge.
 */
function buildBlockedSet(
  graph: RuntimeGraph,
  opts: { avoidSuez?: boolean; avoidPanama?: boolean }
): Set<number> | undefined {
  const boxes: Array<[number, number, number, number]> = [];
  if (opts.avoidSuez) boxes.push(AVOID_BBOX_SUEZ);
  if (opts.avoidPanama) boxes.push(AVOID_BBOX_PANAMA);
  if (boxes.length === 0) return undefined;
  const blocked = new Set<number>();
  for (const n of graph.nodes) {
    for (const [minLat, maxLat, minLon, maxLon] of boxes) {
      if (
        n.lat >= minLat &&
        n.lat <= maxLat &&
        n.lon >= minLon &&
        n.lon <= maxLon
      ) {
        blocked.add(n.id);
        break;
      }
    }
  }
  return blocked;
}

/**
 * Standard Dijkstra. Returns the shortest path from `start` to `end`
 * as a list of node ids + the total distance in nautical miles, or
 * null if `end` is unreachable.
 *
 * Extras map lets us inject per-request temporary nodes/edges
 * (used for custom click-anywhere waypoints). They're read-only
 * and only visible inside this call.
 */
export function dijkstra(
  graph: RuntimeGraph,
  start: number,
  end: number,
  extras?: DijkstraExtras
): { path: number[]; distanceNm: number } | null {
  // Total node count = base + any temporary injected ids. Since temp
  // ids are contiguous starting at graph.nextTempId, we can size
  // distance / prev arrays to the high-water mark + 1.
  let maxId = graph.nodes.length - 1;
  if (extras?.extraNodes) {
    for (const id of extras.extraNodes.keys()) {
      if (id > maxId) maxId = id;
    }
  }
  const size = maxId + 1;
  const dist = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  dist[start] = 0;

  const pq = new MinHeap();
  pq.push(start, 0);

  const edgesFor = (id: number): AdjacencyEntry[] => {
    // Merge base + extras if the id has entries in both
    const base = id < graph.adj.length ? graph.adj[id] : undefined;
    const extra = extras?.extraEdges?.get(id);
    if (base && extra) return base.concat(extra);
    return base ?? extra ?? [];
  };

  // Merge per-request blocks (avoidSuez/avoidPanama/avoidChains) with
  // the graph-wide hard-block set (NSR, war zones) so Dijkstra skips
  // both via the same edge filter below. We build a fresh Set only
  // when there's something to merge — keeps the hot path allocation-
  // free for most requests. If start or end happens to sit inside a
  // hard-block zone (operator plotted a route into a forbidden
  // region), we honour that and let them through — they're the
  // endpoints, not transit nodes.
  let blocked = extras?.blockedNodeIds;
  const hardBlocked = graph.hardBlockedNodeIds;
  if (hardBlocked.size > 0) {
    const merged = new Set<number>(blocked ?? []);
    for (const id of hardBlocked) {
      if (id === start || id === end) continue;
      merged.add(id);
    }
    blocked = merged;
  }
  // Two chain-preference tiers:
  //   stickyChains  — 0.3× discount (strong preference, e.g. Turkish
  //                   Straits, Panama, Suez, las-palmas-fix)
  //   allChains     — 0.9× discount (regular / fallback preference for
  //                   non-sticky chains like Kiel Canal; Dijkstra tips
  //                   toward the chain in near-ties but doesn't
  //                   overrule a clearly shorter graph alternative)
  // The check below tries stickyChains first; if not both sticky, it
  // falls back to the regular-chain check against the union set.
  const stickyChains = graph.stickyChainNodeIds;
  const allChains = graph.chainNodeIds;
  const forbidden = graph.forbiddenNodeIds;
  while (pq.size() > 0) {
    const { id: u, key: d } = pq.pop()!;
    if (d > dist[u]) continue;          // stale entry
    if (u === end) break;                // early termination
    // Ports are endpoints, not transit nodes. A port's 5 "connect-to-
    // nearest-base-node" edges create a tight triangle that Dijkstra
    // happily treats as a shortcut — which is how Monrovia / Santa
    // Cruz / etc. end up in the middle of routes that never intended
    // to visit them. Blocking transit through non-endpoint ports
    // forces the path to stay on the searoute transit network,
    // which is what we actually want.
    if (u !== start && graph.portNodeIds.has(u)) continue;
    const uIsSticky = stickyChains.has(u);
    const uIsAnyChain = allChains.has(u);
    for (const { to: v, weight: w } of edgesFor(u)) {
      // Avoid-Suez / avoid-Panama: skip edges whose target is inside
      // the blocked region. The start / end are never in this set
      // (they're always ports outside the bbox), so legitimate
      // routing through the passage is still possible if needed —
      // we just prevent *transit* through the avoided bbox.
      if (blocked && v !== end && blocked.has(v)) continue;
      // Intra-chain edge discount. Two tiers:
      //   sticky + sticky  →  0.3× (strong preference, default)
      //   chain  + chain   →  0.9× (mild preference — enough to pick
      //                       the hand-drawn path over a ~5-10%-longer
      //                       graph zigzag, but not enough to win
      //                       against a clearly shorter alternative)
      // True distance is recomputed from the reconstructed path
      // coords, so the operator still sees the real haversine total.
      let searchWeight = w;
      if (uIsSticky && stickyChains.has(v)) {
        searchWeight = w * CHAIN_WEIGHT_DISCOUNT;
      } else if (uIsAnyChain && allChains.has(v)) {
        searchWeight = w * CHAIN_REGULAR_DISCOUNT;
      }
      // Forbidden-zone "stickiness" (inverse of the chain trick):
      // any edge whose target sits inside an operator-drawn
      // forbidden polygon looks 10× further than it really is, so
      // Dijkstra takes the long way around. Zones are never hard-
      // blocked — if no alternative exists, the route can still
      // cross at the expense of a much higher cumulative weight.
      if (forbidden.size > 0 && v !== end && forbidden.has(v)) {
        searchWeight *= FORBIDDEN_WEIGHT_PENALTY;
      }
      const nd = d + searchWeight;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        pq.push(v, nd);
      }
    }
  }

  if (!Number.isFinite(dist[end])) return null;

  // Reconstruct path end → start, then reverse.
  const path: number[] = [];
  for (let u: number = end; u !== -1; u = prev[u]) {
    path.push(u);
    if (u === start) break;
  }
  path.reverse();
  return { path, distanceNm: dist[end] };
}

// ── Custom-waypoint injection helpers ────────────────────────

const CUSTOM_NEAREST_K = 5;  // connect custom waypoint to 5 nearest graph nodes

export interface CustomWaypoint {
  lat: number;
  lon: number;
}

/**
 * Build Dijkstra extras for a set of custom waypoints. Assigns each
 * custom waypoint a temporary id (graph.nextTempId + offset) and
 * connects it to k nearest graph nodes via straight haversine edges.
 * Also allows custom waypoints to connect to each other directly (so
 * "A → custom1 → custom2 → B" works without an intermediate graph node).
 */
export function buildCustomExtras(
  graph: RuntimeGraph,
  customs: CustomWaypoint[]
): { extras: DijkstraExtras; customIds: number[] } {
  const extraNodes = new Map<number, { lat: number; lon: number }>();
  const extraEdges = new Map<number, AdjacencyEntry[]>();
  const customIds: number[] = [];

  const addEdge = (a: number, b: number, weight: number) => {
    const aArr = extraEdges.get(a) ?? [];
    aArr.push({ to: b, weight });
    extraEdges.set(a, aArr);
    const bArr = extraEdges.get(b) ?? [];
    bArr.push({ to: a, weight });
    extraEdges.set(b, bArr);
  };

  let nextId = graph.nextTempId;
  for (const c of customs) {
    const id = nextId++;
    customIds.push(id);
    extraNodes.set(id, { lat: c.lat, lon: c.lon });

    // Wire custom → k nearest base-graph nodes
    const nearest = findNearestNodes(graph, c.lat, c.lon, CUSTOM_NEAREST_K);
    for (const { id: nearId, distanceNm } of nearest) {
      addEdge(id, nearId, distanceNm);
    }
  }

  // NOTE: we intentionally do NOT add direct custom↔custom edges.
  // Earlier version did — rationale was "let Dijkstra chain customs
  // without bouncing off a base node between them" — but that
  // reintroduced the exact bug this whole module was built to fix:
  // haversine-shortest is straight-line, so Dijkstra would always
  // pick the direct custom-A→custom-B edge over the (longer) via-
  // graph path, even when the direct edge crosses continents.
  // Every custom-to-custom leg MUST be forced through base graph
  // nodes to guarantee land-safety. If two customs happen to sit
  // next to each other in open ocean, they'll still meet at a
  // nearby base node and the via-graph detour is ≤ ~100 NM.

  return { extras: { extraNodes, extraEdges }, customIds };
}

// ── High-level helper — route a multi-waypoint voyage ────────

export interface Waypoint {
  /** "port" = resolvable through graph.portMap; "custom" = lat/lon click-anywhere. */
  type: "port" | "custom";
  /** For ports: canonical name. For customs: display label. */
  label: string;
  lat: number;
  lon: number;
  /** For ports only — the canonical graph key. */
  portName?: string;
}

export interface RouteLeg {
  from: string;
  to: string;
  /** Polyline geometry as [lat, lon] pairs. */
  coordinates: Array<[number, number]>;
  distanceNm: number;
}

export interface RouteOutput {
  legs: RouteLeg[];
  totalNm: number;
}

/**
 * Compute a multi-leg route where any waypoint may be either a named
 * port or a custom (lat, lon) click-anywhere. For each leg we inject
 * only the two endpoints' custom waypoints (if any) into the Dijkstra
 * extras — that keeps the temporary graph small and isolates legs
 * from each other (no accidental cross-wiring between custom points
 * on different legs).
 *
 * Returns per-leg coordinates (for polyline rendering) + distance,
 * plus the total voyage distance.
 *
 * Throws if a port name isn't in graph.portMap or if a leg is
 * unreachable (should never happen on a connected graph — every port
 * is wired in by connect_ports in the Python pipeline).
 */
export interface RouteThroughGraphOptions {
  avoidSuez?: boolean;
  avoidPanama?: boolean;
  /** Chain IDs (from channel_chains.json) whose nodes should be
   * treated as blocked for this route. Used when the vessel can't
   * fit through a specific passage (Kiel Canal for post-Panamax,
   * Panama locks for >366m LOA, etc.). */
  avoidedChainIds?: string[];
}

export function routeThroughGraph(
  waypoints: Waypoint[],
  opts?: RouteThroughGraphOptions
): RouteOutput | null {
  if (waypoints.length < 2) return null;
  const graph = getRuntimeGraph();
  // Avoid-set computed once per call — reused across every leg so
  // we don't re-scan all ~10k nodes for each hop.
  const blockedNodeIds = buildBlockedSet(graph, opts ?? {}) ?? new Set<number>();
  // Fold in chain-specific avoidance: every node that belongs to
  // an avoided chain (e.g. "kiel-canal") goes into the same set.
  for (const cid of opts?.avoidedChainIds ?? []) {
    const perChain = graph.chainNodesByChainId.get(cid);
    if (perChain) {
      for (const n of perChain) blockedNodeIds.add(n);
    }
  }
  const effectiveBlocked =
    blockedNodeIds.size > 0 ? blockedNodeIds : undefined;

  const legs: RouteLeg[] = [];
  let totalNm = 0;

  // Resolve the real lat/lon for a waypoint. Port callers sometimes
  // pass { lat: 0, lon: 0 } as a placeholder (see computeRoute in
  // ./index.ts) since they identify the endpoint by portName — look
  // up the actual coord in the graph when that happens.
  const coordFor = (wp: Waypoint): { lat: number; lon: number } | null => {
    if (wp.type === "custom") return { lat: wp.lat, lon: wp.lon };
    const nid = graph.portMap.get(wp.portName ?? wp.label);
    if (nid === undefined) return null;
    const n = graph.nodes[nid];
    return { lat: n.lat, lon: n.lon };
  };

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];

    // Option A — direct-first routing. If the great-circle between the
    // two waypoints doesn't cross land, we take the straight path and
    // skip Dijkstra entirely. This solves two classes of problem at
    // once:
    //   - open-ocean custom-waypoint zigzags (path was forced through
    //     base graph nodes because direct custom↔custom edges were
    //     disabled to avoid straight-line-across-continent bugs)
    //   - port-to-port legs where our 3°×6° anchor grid doesn't line
    //     up with the ideal great-circle (Las Palmas→Dakar, etc.)
    // The land check uses Natural Earth 1:50m and an RBush index so
    // it's ~5-10 ms per leg. Any avoid-passage or avoided-chain flag
    // disqualifies the direct shortcut (the whole point of those
    // toggles is to FORCE a graph detour), so we drop to Dijkstra in
    // that case without testing.
    const usingAvoidance =
      (opts?.avoidSuez || opts?.avoidPanama || (opts?.avoidedChainIds?.length ?? 0) > 0);
    const fromCoord = coordFor(from);
    const toCoord = coordFor(to);
    if (
      !usingAvoidance &&
      fromCoord &&
      toCoord &&
      isArcClearOfLand(fromCoord.lat, fromCoord.lon, toCoord.lat, toCoord.lon)
    ) {
      const directDist = haversineNm(
        fromCoord.lat,
        fromCoord.lon,
        toCoord.lat,
        toCoord.lon
      );
      legs.push({
        from: from.label,
        to: to.label,
        coordinates: [
          [fromCoord.lat, fromCoord.lon],
          [toCoord.lat, toCoord.lon],
        ],
        distanceNm: Math.round(directDist * 10) / 10,
      });
      totalNm += directDist;
      continue;
    }

    // Collect customs for this leg so each one gets a temp id
    const customs: CustomWaypoint[] = [];
    if (from.type === "custom") customs.push({ lat: from.lat, lon: from.lon });
    if (to.type === "custom") customs.push({ lat: to.lat, lon: to.lon });

    const { extras, customIds } = buildCustomExtras(graph, customs);
    // Thread the blocked-node set into the per-leg extras so the same
    // Dijkstra sees it without any other call-site changes.
    if (effectiveBlocked) extras.blockedNodeIds = effectiveBlocked;

    // Map port/custom to actual ids (port via portMap, custom via injected)
    let customCursor = 0;
    const idFor = (wp: Waypoint): number => {
      if (wp.type === "port") {
        const id = graph.portMap.get(wp.portName ?? wp.label);
        if (id === undefined) throw new Error(`Unknown port: ${wp.portName ?? wp.label}`);
        return id;
      }
      return customIds[customCursor++];
    };
    const fromId = idFor(from);
    const toId = idFor(to);

    const result = dijkstra(graph, fromId, toId, extras);
    if (!result) return null;  // unreachable — shouldn't happen on connected graph

    // Hydrate path ids to [lat, lon] coords. Temporary custom nodes
    // live in extras.extraNodes; base nodes live in graph.nodes.
    const coords: Array<[number, number]> = result.path.map((id) => {
      if (id < graph.nodes.length) {
        const n = graph.nodes[id];
        return [n.lat, n.lon];
      }
      const temp = extras.extraNodes?.get(id);
      if (!temp) throw new Error(`Dangling node id in path: ${id}`);
      return [temp.lat, temp.lon];
    });

    // Recompute the leg length from the ACTUAL chosen path — the
    // dijkstra cumulative is computed with chain weights discounted,
    // so it would underreport. Real haversine sum is the source of
    // truth once we know the path.
    let legDistance = 0;
    for (let k = 0; k < coords.length - 1; k++) {
      legDistance += haversineNm(
        coords[k][0],
        coords[k][1],
        coords[k + 1][0],
        coords[k + 1][1]
      );
    }

    legs.push({
      from: from.label,
      to: to.label,
      coordinates: coords,
      distanceNm: Math.round(legDistance * 10) / 10,
    });
    totalNm += legDistance;
  }

  return { legs, totalNm: Math.round(totalNm * 10) / 10 };
}
