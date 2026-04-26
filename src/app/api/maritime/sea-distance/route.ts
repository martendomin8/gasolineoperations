import { NextRequest, NextResponse } from "next/server";
import {
  getSeaDistance,
  getMultiStopDistance,
  searchPorts,
  checkPortAmbiguity,
  calculateETA,
  findPort,
  getPortCoords,
  type RouteOptions,
} from "@/lib/maritime/sea-distance";
import { parseWaypoint, formatCustomLabel, haversineNm } from "@/lib/maritime/sea-distance/waypoints";
import { routeThroughGraph, type Waypoint } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";

function parseAvoid(params: URLSearchParams): RouteOptions {
  // Accept either ?avoid=suez,panama or ?avoidSuez=1&avoidPanama=1
  const raw = (params.get("avoid") ?? "").toLowerCase();
  const list = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  // Per-chain avoidance: ?avoidChains=kiel-canal,some-other-id
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

// GET /api/maritime/sea-distance?from=Amsterdam&to=Augusta&speed=12
// GET /api/maritime/sea-distance?ports=Amsterdam|Augusta|Lagos&speed=12&avoid=suez
// GET /api/maritime/sea-distance?search=amster
// GET /api/maritime/sea-distance?check=Barcelona  (ambiguity check)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Port ambiguity check mode
  const check = params.get("check");
  if (check) {
    const result = checkPortAmbiguity(check);
    return NextResponse.json(result);
  }

  // Port search mode
  const search = params.get("search");
  if (search) {
    const results = searchPorts(search, 20);
    return NextResponse.json({ ports: results });
  }

  const opts = parseAvoid(params);

  // Multi-stop mode. Entries starting with `@` are custom coord
  // waypoints (e.g. `@45.2,-12.3`). Both branches below end up in
  // runtime Dijkstra via graph-runtime.routeThroughGraph — there is
  // no precomputed-paths.json fast path anymore; the split just picks
  // a slightly different entry point (getMultiStopDistance vs direct
  // routeThroughGraph). Both honour all avoid flags (Suez, Panama,
  // per-chain bbox like Kiel Canal).
  const portsParam = params.get("ports");
  if (portsParam) {
    const rawEntries = portsParam.split("|").map((p) => p.trim()).filter(Boolean);
    if (rawEntries.length < 2) {
      return NextResponse.json({ error: "Need at least 2 ports" }, { status: 400 });
    }
    const speed = parseFloat(params.get("speed") ?? "12") || 12;

    const hasCustom = rawEntries.some((e) => e.startsWith("@"));

    // Fast path: all named ports → use precomputed paths + variants.
    if (!hasCustom) {
      const result = getMultiStopDistance(rawEntries, opts);
      return NextResponse.json({
        ...result,
        speedKnots: speed,
        etaDays: calculateETA(result.totalNm, speed),
        etaDisplay: formatETA(calculateETA(result.totalNm, speed)),
        avoid: opts,
      });
    }

    // Custom-waypoint path: resolve entries then route through the
    // runtime land-safe graph. The avoidSuez / avoidPanama flags are
    // forwarded to routeThroughGraph where graph-runtime.ts applies
    // them as bbox filters (AVOID_BBOX_SUEZ / AVOID_BBOX_PANAMA) —
    // Dijkstra skips any node whose coords fall inside an active box.
    // No precomputed variant files involved.
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
      return NextResponse.json({ error: "Could not resolve waypoints" }, { status: 400 });
    }

    try {
      const routed = routeThroughGraph(waypoints, {
        avoidSuez: opts.avoidSuez,
        avoidPanama: opts.avoidPanama,
        avoidedChainIds: opts.avoidedChainIds,
      });
      if (routed) {
        // Match the shape the client expects (from getMultiStopDistance
        // result) — totalNm + per-leg distance.
        return NextResponse.json({
          totalNm: routed.totalNm,
          legs: routed.legs.map((l) => ({
            from: l.from,
            to: l.to,
            distanceNm: l.distanceNm,
          })),
          source: "ocean_routing_runtime",
          speedKnots: speed,
          etaDays: calculateETA(routed.totalNm, speed),
          etaDisplay: formatETA(calculateETA(routed.totalNm, speed)),
          avoid: opts,
        });
      }
      // Fall through to haversine fallback below — see comment.
    } catch (err) {
      console.error("[sea-distance] runtime graph failed, falling back to haversine:", err);
      // Fall through to haversine fallback below.
    }

    // Haversine fallback — used when the ocean-routing graph can't reach
    // a custom waypoint (typically because the operator clicked a vessel
    // whose AIS position is at a port quay deep inside an estuary, e.g.
    // Antwerp on the Schelde, where every "nearest graph node" is the
    // wrong side of a peninsula). Returns straight great-circle distance
    // per leg with a flag the client can show as a "approximate" badge.
    // The polyline will cut across land but the total NM is still close
    // to the real ocean route for short hops, and far better than a 500.
    const hLegs = [];
    let hTotal = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      const d = haversineNm(a.lat, a.lon, b.lat, b.lon);
      hLegs.push({ from: a.label, to: b.label, distanceNm: Math.round(d * 10) / 10 });
      hTotal += d;
    }
    return NextResponse.json({
      totalNm: hTotal,
      legs: hLegs,
      source: "haversine_fallback",
      approximate: true,
      speedKnots: speed,
      etaDays: calculateETA(hTotal, speed),
      etaDisplay: formatETA(calculateETA(hTotal, speed)),
      avoid: opts,
    });
  }

  // Two-port mode
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) {
    return NextResponse.json(
      { error: "Provide ?from=X&to=Y or ?ports=A,B,C or ?search=X" },
      { status: 400 }
    );
  }

  const speed = parseFloat(params.get("speed") ?? "12") || 12;
  const result = getSeaDistance(from, to, opts);
  return NextResponse.json({
    ...result,
    speedKnots: speed,
    etaDays: calculateETA(result.totalNm, speed),
    etaDisplay: formatETA(calculateETA(result.totalNm, speed)),
    avoid: opts,
  });
}

function formatETA(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "—";
  const d = Math.floor(days);
  const h = Math.round((days - d) * 24);
  if (d === 0) return `${h}h`;
  if (h === 0) return `${d}d`;
  return `${d}d ${h}h`;
}
