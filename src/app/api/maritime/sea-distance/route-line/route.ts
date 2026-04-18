import { NextRequest, NextResponse } from "next/server";
import {
  findPort,
  getPortCoords,
  getSeaRoutePath,
  type RouteOptions,
} from "@/lib/maritime/sea-distance";
import { parseWaypoint, formatCustomLabel } from "@/lib/maritime/sea-distance/waypoints";

function parseAvoid(params: URLSearchParams): RouteOptions {
  const raw = (params.get("avoid") ?? "").toLowerCase();
  const list = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return {
    avoidSuez: list.has("suez") || params.get("avoidSuez") === "1",
    avoidPanama: list.has("panama") || params.get("avoidPanama") === "1",
  };
}

/**
 * GET /api/sea-distance/route-line?ports=Amsterdam|Augusta|Lagos
 *
 * Returns an array of [lat, lon] coordinate arrays — one per leg —
 * that can be drawn as Leaflet polylines. Uses our pre-computed
 * ocean routing paths (0.1° water grid, land-free) so routes never
 * cross over continents.
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

  // Resolve each entry — named ports go through findPort/getPortCoords,
  // `@lat,lon` entries are custom waypoints (click-anywhere) and
  // carry their coords directly. isCustom lets us pick the right
  // rendering strategy per leg below.
  type Resolved = { label: string; lat: number; lon: number; isCustom: boolean; portName: string | null };
  const resolved: Resolved[] = [];
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
    return NextResponse.json({ legs: [] });
  }

  const legs: Array<{
    from: string;
    to: string;
    coordinates: [number, number][];
  }> = [];

  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i];
    const to = resolved[i + 1];

    let coords: [number, number][];
    if (!from.isCustom && !to.isCustom && from.portName && to.portName) {
      // Both are named ports — use pre-computed land-safe ocean path.
      const path = getSeaRoutePath(from.portName, to.portName, opts);
      coords = path ?? [[from.lat, from.lon], [to.lat, to.lon]];
    } else {
      // Custom waypoint on at least one end. Two-point straight segment;
      // the frontend expands it into a great-circle arc via turf before
      // rendering, so it still looks curved on Mercator.
      coords = [[from.lat, from.lon], [to.lat, to.lon]];
    }

    legs.push({
      from: from.label,
      to: to.label,
      coordinates: coords,
    });
  }

  return NextResponse.json({ legs });
}
