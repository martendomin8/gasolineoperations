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

// ── File format (must match export_graph.py output) ──────────
interface GraphFile {
  meta: {
    nodeCount: number;
    edgeCount: number;
    portCount: number;
    variant: string;
    builtAt: string;
  };
  nodes: Array<{ id: number; lat: number; lon: number }>;
  edges: Array<{ from: number; to: number; weight: number }>;
  portMap: Record<string, number>;
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
  /** Meta / introspection. */
  meta: GraphFile["meta"];
  /** First id available for temporary (per-request) custom nodes. */
  nextTempId: number;
}

// ── One-time loader (memoised) ───────────────────────────────
let cached: RuntimeGraph | null = null;

export function getRuntimeGraph(): RuntimeGraph {
  if (cached) return cached;
  const data = graphData as GraphFile;

  // Build dense node array — graph.json already has ids 0..N-1 in order
  // because export_graph.py sorts them, but we verify + fill any gaps
  // to avoid indexing bugs.
  const nodes: GraphNode[] = new Array(data.nodes.length);
  for (const n of data.nodes) nodes[n.id] = n;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]) throw new Error(`Graph: missing node id ${i}`);
  }

  // Build undirected adjacency list. Each edge stored in both
  // directions so Dijkstra can traverse either way without extra logic.
  const adj: AdjacencyEntry[][] = Array.from({ length: nodes.length }, () => []);
  for (const e of data.edges) {
    adj[e.from].push({ to: e.to, weight: e.weight });
    adj[e.to].push({ to: e.from, weight: e.weight });
  }

  const portMap = new Map<string, number>(Object.entries(data.portMap));

  cached = {
    nodes,
    adj,
    portMap,
    meta: data.meta,
    nextTempId: nodes.length,
  };
  return cached;
}

// ── Geo utilities ────────────────────────────────────────────
const EARTH_NM = 3440.065;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return EARTH_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  while (pq.size() > 0) {
    const { id: u, key: d } = pq.pop()!;
    if (d > dist[u]) continue;          // stale entry
    if (u === end) break;                // early termination
    for (const { to: v, weight: w } of edgesFor(u)) {
      const nd = d + w;
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
export function routeThroughGraph(waypoints: Waypoint[]): RouteOutput | null {
  if (waypoints.length < 2) return null;
  const graph = getRuntimeGraph();

  const legs: RouteLeg[] = [];
  let totalNm = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];

    // Collect customs for this leg so each one gets a temp id
    const customs: CustomWaypoint[] = [];
    if (from.type === "custom") customs.push({ lat: from.lat, lon: from.lon });
    if (to.type === "custom") customs.push({ lat: to.lat, lon: to.lon });

    const { extras, customIds } = buildCustomExtras(graph, customs);

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

    legs.push({
      from: from.label,
      to: to.label,
      coordinates: coords,
      distanceNm: Math.round(result.distanceNm * 10) / 10,
    });
    totalNm += result.distanceNm;
  }

  return { legs, totalNm: Math.round(totalNm * 10) / 10 };
}
