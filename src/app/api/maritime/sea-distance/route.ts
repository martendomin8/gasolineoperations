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
import { parseWaypoint, haversineNm, formatCustomLabel } from "@/lib/maritime/sea-distance/waypoints";

function parseAvoid(params: URLSearchParams): RouteOptions {
  // Accept either ?avoid=suez,panama or ?avoidSuez=1&avoidPanama=1
  const raw = (params.get("avoid") ?? "").toLowerCase();
  const list = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return {
    avoidSuez: list.has("suez") || params.get("avoidSuez") === "1",
    avoidPanama: list.has("panama") || params.get("avoidPanama") === "1",
  };
}

// GET /api/sea-distance?from=Amsterdam&to=Augusta&speed=12
// GET /api/sea-distance?ports=Amsterdam|Augusta|Lagos&speed=12&avoid=suez
// GET /api/sea-distance?search=amster
// GET /api/sea-distance?check=Barcelona  (ambiguity check)
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

  // Multi-stop mode (pipe-separated to avoid clashing with commas in port names).
  // Entries starting with `@` are custom coord waypoints, e.g. `@45.2,-12.3`.
  // Legs that touch a custom waypoint fall back to haversine + great-circle
  // rendering — see src/lib/sea-distance/waypoints.ts for the rationale.
  const portsParam = params.get("ports");
  if (portsParam) {
    const rawEntries = portsParam.split("|").map((p) => p.trim()).filter(Boolean);
    if (rawEntries.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 ports" },
        { status: 400 }
      );
    }
    const speed = parseFloat(params.get("speed") ?? "12") || 12;

    // Fast path: no custom waypoints → existing provider logic verbatim.
    const hasCustom = rawEntries.some((e) => e.startsWith("@"));
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

    // Mixed path: resolve each entry to (label, lat, lon). Named ports go
    // through findPort/getPortCoords; custom entries are parsed directly.
    // Then for each consecutive pair we either defer to the provider
    // (both named) or haversine locally (at least one custom).
    const resolved: Array<{ label: string; lat: number; lon: number; isCustom: boolean; portName: string | null }> = [];
    for (const entry of rawEntries) {
      const parsed = parseWaypoint(entry);
      if (!parsed) continue;
      if (parsed.type === "custom") {
        resolved.push({
          label: formatCustomLabel(parsed.lat, parsed.lon),
          lat: parsed.lat,
          lon: parsed.lon,
          isCustom: true,
          portName: null,
        });
      } else {
        const canonical = findPort(parsed.raw);
        if (!canonical) continue;
        const coords = getPortCoords(canonical);
        if (!coords) continue;
        resolved.push({
          label: canonical,
          lat: coords.lat,
          lon: coords.lon,
          isCustom: false,
          portName: canonical,
        });
      }
    }

    if (resolved.length < 2) {
      return NextResponse.json({ error: "Could not resolve waypoints" }, { status: 400 });
    }

    const legs: Array<{ from: string; to: string; distanceNm: number }> = [];
    let totalNm = 0;
    for (let i = 0; i < resolved.length - 1; i++) {
      const from = resolved[i];
      const to = resolved[i + 1];
      let distanceNm: number;
      if (!from.isCustom && !to.isCustom && from.portName && to.portName) {
        // Both named ports — use the graph-based distance so the leg
        // respects avoid-passage variants and land-safe routing.
        const legResult = getSeaDistance(from.portName, to.portName, opts);
        distanceNm = legResult.totalNm;
      } else {
        // At least one endpoint is a custom waypoint. Haversine is the
        // honest fallback — we can't route through arbitrary coords.
        distanceNm = haversineNm(from.lat, from.lon, to.lat, to.lon);
      }
      legs.push({ from: from.label, to: to.label, distanceNm: Math.round(distanceNm * 10) / 10 });
      totalNm += distanceNm;
    }
    totalNm = Math.round(totalNm * 10) / 10;

    return NextResponse.json({
      totalNm,
      legs,
      source: "ocean_routing+custom",
      speedKnots: speed,
      etaDays: calculateETA(totalNm, speed),
      etaDisplay: formatETA(calculateETA(totalNm, speed)),
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
