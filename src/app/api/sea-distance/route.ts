import { NextRequest, NextResponse } from "next/server";
import {
  getSeaDistance,
  getMultiStopDistance,
  searchPorts,
  checkPortAmbiguity,
  calculateETA,
} from "@/lib/sea-distance";

// GET /api/sea-distance?from=Amsterdam&to=Augusta&speed=12
// GET /api/sea-distance?ports=Amsterdam|Augusta|Lagos&speed=12
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

  // Multi-stop mode (pipe-separated to avoid clashing with commas in port names)
  const portsParam = params.get("ports");
  if (portsParam) {
    const portNames = portsParam.split("|").map((p) => p.trim()).filter(Boolean);
    if (portNames.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 ports" },
        { status: 400 }
      );
    }
    const speed = parseFloat(params.get("speed") ?? "12") || 12;
    const result = getMultiStopDistance(portNames);
    return NextResponse.json({
      ...result,
      speedKnots: speed,
      etaDays: calculateETA(result.totalNm, speed),
      etaDisplay: formatETA(calculateETA(result.totalNm, speed)),
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
  const result = getSeaDistance(from, to);
  return NextResponse.json({
    ...result,
    speedKnots: speed,
    etaDays: calculateETA(result.totalNm, speed),
    etaDisplay: formatETA(calculateETA(result.totalNm, speed)),
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
