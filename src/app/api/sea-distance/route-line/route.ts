import { NextRequest, NextResponse } from "next/server";
import { findPort, getPortCoords, getSeaRoutePath } from "@/lib/sea-distance";

/**
 * GET /api/sea-distance/route-line?ports=Amsterdam|Augusta|Lagos
 *
 * Returns an array of [lat, lon] coordinate arrays — one per leg —
 * that can be drawn as Leaflet polylines. Uses our pre-computed
 * ocean routing paths (0.1° water grid, land-free) so routes never
 * cross over continents.
 */
export async function GET(req: NextRequest) {
  const portsParam = req.nextUrl.searchParams.get("ports");
  if (!portsParam) {
    return NextResponse.json({ error: "Provide ?ports=A|B|C" }, { status: 400 });
  }

  const portNames = portsParam.split("|").map((p) => p.trim()).filter(Boolean);
  if (portNames.length < 2) {
    return NextResponse.json({ error: "Need at least 2 ports" }, { status: 400 });
  }

  // Resolve port names to canonical form
  const resolved: Array<{ name: string; lat: number; lon: number }> = [];
  for (const p of portNames) {
    const canonical = findPort(p);
    if (!canonical) continue;
    const coords = getPortCoords(canonical);
    if (!coords) continue;
    resolved.push({ name: canonical, lat: coords.lat, lon: coords.lon });
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

    // Use our pre-computed ocean routing path — never crosses land
    const path = getSeaRoutePath(from.name, to.name);

    // Fallback: straight line (only if the pair is not in our distance table)
    const coords: [number, number][] = path ?? [
      [from.lat, from.lon],
      [to.lat, to.lon],
    ];

    legs.push({
      from: from.name,
      to: to.name,
      coordinates: coords,
    });
  }

  return NextResponse.json({ legs });
}
