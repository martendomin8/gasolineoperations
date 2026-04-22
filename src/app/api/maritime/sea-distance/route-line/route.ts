import { NextRequest, NextResponse } from "next/server";
import {
  findPort,
  getPortCoords,
  getSeaRoutePath,
  type RouteOptions,
} from "@/lib/maritime/sea-distance";
import { parseWaypoint, formatCustomLabel } from "@/lib/maritime/sea-distance/waypoints";
import { routeThroughGraph, type Waypoint } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";

function parseAvoid(params: URLSearchParams): RouteOptions {
  const raw = (params.get("avoid") ?? "").toLowerCase();
  const list = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  // Per-chain avoidance: `?avoidChains=kiel-canal,turkish-straits`. Parses
  // the same way the distance endpoint does (keep these in lockstep — the
  // Planner fires both URLs with the same query string, so any divergence
  // gives the operator a working number but a misleading polyline, which
  // is exactly the "avoid Kiel Canal ei tööta" symptom we just hit).
  const chainsRaw = params.get("avoidChains") ?? "";
  const avoidedChainIds = chainsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    avoidSuez: list.has("suez") || params.get("avoidSuez") === "1",
    avoidPanama: list.has("panama") || params.get("avoidPanama") === "1",
    avoidedChainIds: avoidedChainIds.length > 0 ? avoidedChainIds : undefined,
  };
}

/**
 * GET /api/maritime/sea-distance/route-line?ports=Amsterdam|Augusta|Lagos
 *
 * Returns per-leg [lat, lon] polylines for map rendering. Two modes:
 *   - All named ports → precomputed paths.json (honors avoid variants)
 *   - Any custom @lat,lon waypoint → runtime Dijkstra over the V2 land-safe
 *     graph so the returned polyline is actually water-only instead of
 *     a straight great-circle that crosses land.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const portsParam = params.get("ports");
  if (!portsParam) {
    return NextResponse.json({ error: "Provide ?ports=A|B|C" }, { status: 400 });
  }

  const rawEntries = portsParam.split("|").map((p) => p.trim()).filter(Boolean);
  if (rawEntries.length < 2) {
    return NextResponse.json({ error: "Need at least 2 ports" }, { status: 400 });
  }

  const opts = parseAvoid(params);
  const hasCustom = rawEntries.some((e) => e.startsWith("@"));

  // Custom-waypoint mode: runtime graph provides the full path.
  // avoidSuez / avoidPanama are forwarded — graph-runtime.ts applies
  // them as bbox filters (AVOID_BBOX_SUEZ / AVOID_BBOX_PANAMA), so
  // Dijkstra reroutes around whichever passage is blocked. No
  // per-variant graph.json needed.
  if (hasCustom) {
    const waypoints: Waypoint[] = [];
    for (const entry of rawEntries) {
      const parsed = parseWaypoint(entry);
      if (!parsed) continue;
      if (parsed.type === "custom") {
        waypoints.push({
          type: "custom",
          label: formatCustomLabel(parsed.lat, parsed.lon),
          lat: parsed.lat,
          lon: parsed.lon,
        });
      } else {
        const canonical = findPort(parsed.raw);
        if (!canonical) continue;
        const coords = getPortCoords(canonical);
        if (!coords) continue;
        waypoints.push({
          type: "port",
          label: canonical,
          lat: coords.lat,
          lon: coords.lon,
          portName: canonical,
        });
      }
    }
    if (waypoints.length < 2) {
      return NextResponse.json({ legs: [] });
    }

    try {
      const routed = routeThroughGraph(waypoints, {
        avoidSuez: opts.avoidSuez,
        avoidPanama: opts.avoidPanama,
        avoidedChainIds: opts.avoidedChainIds,
      });
      if (!routed) return NextResponse.json({ legs: [] });
      return NextResponse.json({
        legs: routed.legs.map((l) => ({
          from: l.from,
          to: l.to,
          coordinates: l.coordinates,
        })),
      });
    } catch (err) {
      console.error("[sea-distance/route-line] runtime graph failed:", err);
      return NextResponse.json({ legs: [] });
    }
  }

  // All named ports — precomputed-path path.
  type Resolved = { label: string; lat: number; lon: number; portName: string };
  const resolved: Resolved[] = [];
  for (const entry of rawEntries) {
    const canonical = findPort(entry);
    if (!canonical) continue;
    const coords = getPortCoords(canonical);
    if (!coords) continue;
    resolved.push({
      label: canonical,
      lat: coords.lat,
      lon: coords.lon,
      portName: canonical,
    });
  }
  if (resolved.length < 2) {
    return NextResponse.json({ legs: [] });
  }

  const legs: Array<{ from: string; to: string; coordinates: [number, number][] }> = [];
  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i];
    const to = resolved[i + 1];
    const path = getSeaRoutePath(from.portName, to.portName, opts);
    const coords: [number, number][] = path ?? [[from.lat, from.lon], [to.lat, to.lon]];
    legs.push({ from: from.label, to: to.label, coordinates: coords });
  }
  return NextResponse.json({ legs });
}
