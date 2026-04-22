/**
 * Voyage integrator — walks a route, samples weather at each step,
 * applies Kwon's speed loss, and accumulates a weather-adjusted ETA.
 *
 * Keeps itself decoupled from any specific weather source: the caller
 * injects a `WeatherSampler` function. In production this sampler
 * reads the NEFGO forecast provider while we're inside the forecast
 * window, then falls back to regional climatology beyond. In tests
 * we inject a deterministic stub.
 *
 * The core loop is simple:
 *
 *   1. Start at the route's first point with now = `startTime`.
 *   2. Ask the sampler: what's the weather here, at this time?
 *   3. Kwon that weather + ship state → effective speed.
 *   4. Step along the route by one segment (distanceNm / effSpeed = hours).
 *   5. Advance time by those hours, advance position to the next waypoint.
 *   6. Repeat until we run out of route.
 *
 * Segmentation choice: one segment per pair of adjacent route points.
 * The ocean-routing graph already densifies the polyline (typically a
 * waypoint every 60-200 nm), which is the right granularity for
 * weather sampling — no point re-sampling mid-ocean where conditions
 * change slowly. If the route is very coarse (< 10 points for a
 * 3000-nm voyage), the caller should densify BEFORE calling us.
 */

import type {
  ShipParams,
  ShipState,
  VoyageSegment,
  VoyageEtaResult,
  WeatherSampler,
} from "./types";
import { calculateSpeedLoss } from "./kwon";

export interface IntegrateVoyageArgs {
  /** Ordered polyline of [lat, lon] points. First entry is the
   *  starting position, last is the destination. */
  route: Array<[number, number]>;
  /** UTC time at which the vessel is at `route[0]`. Typically the
   *  AIS receivedAt for LIVE/DEAD_RECK vessels, or `now` for
   *  not-yet-departed vessels. */
  startTime: Date;
  /** Ship identity + loading. */
  ship: ShipParams;
  /** Commanded speed, knots. Usually from the planner's "Speed (knots)"
   *  input. Kwon will scale this down per-segment based on weather. */
  commandedSpeedKn: number;
  /** Weather lookup function. Must return a source flag so we can
   *  later tell the UI how much of the ETA relies on forecast vs
   *  climatology. */
  weather: WeatherSampler;
  /** Optional authoritative total distance (nm) — usually the planner
   *  distance API's `totalNm`. When provided, we normalise the polyline
   *  segmentation to match it: every segment's hours is scaled by
   *  `expectedTotalDistanceNm / polylineTotalNm`, so the returned
   *  `calmEtaH` and `adjustedEtaH` line up exactly with what the planner
   *  shows as the route total. The per-segment speed loss RATIO is
   *  preserved — we're just re-basing the absolute hours.
   *
   *  Why: the Fleet planner shows three numbers side by side (calm ETA,
   *  weather delay, adjusted total). Before this flag they were derived
   *  from two different distance calcs — planner API on the top line,
   *  polyline-haversine-sum inside the integrator — and the two drifted
   *  (duplicated waypoints from leg-concat, slightly coarser vs denser
   *  path choices, etc.). Passing the planner's totalNm here pins all
   *  three numbers to the same baseline. */
  expectedTotalDistanceNm?: number;
}

/**
 * Walk the route and produce a voyage-level ETA + per-segment
 * breakdown. Async because the sampler typically hits a remote
 * forecast store.
 */
export async function integrateVoyage(
  args: IntegrateVoyageArgs,
): Promise<VoyageEtaResult> {
  const {
    route,
    startTime,
    ship,
    commandedSpeedKn,
    weather,
    expectedTotalDistanceNm,
  } = args;

  if (route.length < 2) {
    return {
      totalDistanceNm: 0,
      calmEtaH: 0,
      adjustedEtaH: 0,
      segments: [],
      forecastHours: 0,
      climatologyHours: 0,
    };
  }

  // First pass: compute per-segment weather, heading, effective speed,
  // and raw polyline distance. We collect raw hours here; the actual
  // time-cursor walk happens after we know the distance-scale factor
  // (so each segment's hours reflect the planner distance, not the
  // slightly-off polyline sum).
  interface RawSeg {
    lat: number;
    lon: number;
    distanceNm: number;
    headingDeg: number;
    effSpeed: number;
    kwon: ReturnType<typeof calculateSpeedLoss>;
    source: "forecast" | "climatology";
  }
  const raw: RawSeg[] = [];
  let polylineTotalNm = 0;

  // Use a pre-advanced time cursor for weather sampling so samples are
  // still taken at roughly the right time along the voyage. Correct
  // per-segment time boundaries get recomputed after scaling.
  let tSample = startTime;
  for (let i = 0; i < route.length - 1; i++) {
    const [lat0, lon0] = route[i];
    const [lat1, lon1] = route[i + 1];

    const segmentDistanceNm = haversineNm(lat0, lon0, lat1, lon1);
    const segmentHeadingDeg = initialBearingDeg(lat0, lon0, lat1, lon1);
    polylineTotalNm += segmentDistanceNm;

    // Sample weather at the START of the segment. Good enough for the
    // segment granularity we work at (60-200 nm steps, which at 12 kn
    // is 5-17 hours). Within that window we don't expect weather to
    // flip dramatically — GFS frames update every 3 h anyway.
    const sample = await weather({ lat: lat0, lon: lon0, at: tSample });

    const state: ShipState = {
      headingDeg: segmentHeadingDeg,
      commandedSpeedKn,
    };
    const kwon = calculateSpeedLoss({
      ship,
      state,
      weather: sample.condition,
    });

    // Clamp divisor so an extreme low-effective-speed outlier doesn't
    // produce Infinity and poison the accumulator.
    const effSpeed = Math.max(kwon.effectiveSpeedKn, 0.5);

    // Advance the sampling cursor by the UNSCALED hours estimate. Good
    // enough for weather-time lookup; final tStart/tEnd below will be
    // re-derived post-scaling.
    tSample = new Date(
      tSample.getTime() + (segmentDistanceNm / effSpeed) * 3_600_000,
    );

    raw.push({
      lat: lat0,
      lon: lon0,
      distanceNm: segmentDistanceNm,
      headingDeg: segmentHeadingDeg,
      effSpeed,
      kwon,
      source: sample.source,
    });
  }

  // Distance-scale factor. When the caller passes the planner's
  // authoritative totalNm we rescale every segment's absolute distance
  // by this ratio, so calm + adjusted numbers line up with what the
  // planner shows elsewhere. Speed loss RATIO per segment is untouched
  // (effSpeed / commandedSpeed is the same before and after scaling).
  const scale =
    expectedTotalDistanceNm !== undefined &&
    expectedTotalDistanceNm > 0 &&
    polylineTotalNm > 0
      ? expectedTotalDistanceNm / polylineTotalNm
      : 1;

  const segments: VoyageSegment[] = [];
  let tCursor = startTime;
  let totalDistanceNm = 0;
  let forecastHours = 0;
  let climatologyHours = 0;

  for (const r of raw) {
    const scaledDistance = r.distanceNm * scale;
    const hours = scaledDistance / r.effSpeed;
    const tEnd = new Date(tCursor.getTime() + hours * 3_600_000);

    segments.push({
      tStart: tCursor,
      tEnd,
      lat: r.lat,
      lon: r.lon,
      distanceNm: scaledDistance,
      effectiveSpeedKn: r.effSpeed,
      kwon: r.kwon,
      weatherSource: r.source,
    });

    if (r.source === "forecast") forecastHours += hours;
    else climatologyHours += hours;

    totalDistanceNm += scaledDistance;
    tCursor = tEnd;
  }

  const calmEtaH =
    commandedSpeedKn > 0 ? totalDistanceNm / commandedSpeedKn : 0;
  const adjustedEtaH = forecastHours + climatologyHours;

  // Opt-in debug dump. Enabled via `window.__kwonDebug = true` in the
  // browser console. Prints one row per segment: position, weather,
  // Beaufort, relative wave angle, speed loss fraction, effective
  // speed. Intentionally behind a flag — don't want this in the
  // normal console stream, but it's invaluable when a delay number
  // looks suspicious ("why did 84 nm of deviation add 4 hours?").
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { __kwonDebug?: boolean }).__kwonDebug === true
  ) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `[kwon] ${route.length - 1} segments · ${totalDistanceNm.toFixed(0)} nm · calm ${calmEtaH.toFixed(1)}h · adj ${adjustedEtaH.toFixed(1)}h · Δ ${(adjustedEtaH - calmEtaH).toFixed(1)}h`,
    );
    // eslint-disable-next-line no-console
    console.table(
      segments.map((s, i) => ({
        "#": i,
        at: s.tStart.toISOString().slice(5, 16),
        lat: s.lat.toFixed(2),
        lon: s.lon.toFixed(2),
        nm: Math.round(s.distanceNm),
        hdg: Math.round(s.kwon.relativeWaveAngleDeg),
        bn: s.kwon.beaufortNumber,
        eff: s.effectiveSpeedKn.toFixed(1),
        "loss%": (s.kwon.speedLossFraction * 100).toFixed(1),
        src: s.weatherSource,
      })),
    );
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  return {
    totalDistanceNm,
    calmEtaH,
    adjustedEtaH,
    segments,
    forecastHours,
    climatologyHours,
  };
}

// ---------------------------------------------------------------
// Spherical geometry — inlined to keep this module dep-free.
// ---------------------------------------------------------------

const EARTH_RADIUS_NM = 3440.065;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in nautical miles. Haversine formula. */
function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

/** Initial great-circle bearing from (lat1, lon1) to (lat2, lon2).
 *  Returns 0-360°. */
function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
