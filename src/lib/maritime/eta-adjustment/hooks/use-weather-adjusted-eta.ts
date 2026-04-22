"use client";

/**
 * `useWeatherAdjustedEta` — React hook that computes the Kwon-adjusted
 * ETA for a given route + ship + commanded speed, using climatology
 * for every segment.
 *
 * V1 intentionally uses climatology only (no live-forecast sampling).
 * Rationale:
 *   - Kwon compute needs to re-run whenever the operator tweaks speed
 *     in the planner — synchronous + fast wins.
 *   - Forecast frames are PNG-encoded; sampling them client-side
 *     requires loading + decoding each frame, which is async and
 *     would force a Suspense boundary around the blue box.
 *   - Climatology covers the full 16-day (or longer) voyage with
 *     reasonable accuracy — better than "ignore weather entirely"
 *     which is the current calm-water planner behaviour.
 *
 * V1.5 upgrade path: swap the sampler below for one that hits the
 * forecast provider for the first ~5 days and falls back to
 * climatology after. The public API stays the same.
 */

import { useMemo } from "react";
import { climatologyAt } from "../climatology";
import { calculateSpeedLoss } from "../kwon";
import type {
  ShipParams,
  VoyageEtaResult,
  VoyageSegment,
} from "../types";

export interface UseWeatherAdjustedEtaArgs {
  /** Ordered [lat, lon] polyline from start to destination. Null when
   *  the planner has no route yet — hook returns null in that case. */
  route: Array<[number, number]> | null;
  /** UTC time at which the vessel is at `route[0]`. Typically `now`
   *  for LIVE/DEAD_RECK tracked vessels, or the laycan start for
   *  not-yet-departed ones. */
  startTime: Date;
  /** Ship identity + loading. When null, falls back to a generic
   *  loaded tanker at 12 kn — produces a baseline estimate suitable
   *  for demo voyages that aren't tied to a specific Q88 yet. */
  ship: ShipParams | null;
  /** Commanded speed from the planner's "Speed (knots)" input. */
  commandedSpeedKn: number;
  /** When false (e.g. operator hasn't opened any vessel / planner),
   *  the hook skips the compute to avoid unnecessary work. */
  enabled?: boolean;
}

export interface UseWeatherAdjustedEtaResult {
  /** Null until the first compute completes. */
  data: VoyageEtaResult | null;
  /** Delta in hours: adjusted - calm. Positive = later than planner says. */
  delayH: number | null;
}

const DEFAULT_SHIP: ShipParams = {
  type: "tanker",
  dwt: 45000,
  loa: 183,
  loadingState: "loaded",
  serviceSpeedKn: 12,
};

export function useWeatherAdjustedEta({
  route,
  startTime,
  ship,
  commandedSpeedKn,
  enabled = true,
}: UseWeatherAdjustedEtaArgs): UseWeatherAdjustedEtaResult {
  return useMemo(() => {
    if (!enabled || route === null || route.length < 2 || commandedSpeedKn <= 0) {
      return { data: null, delayH: null };
    }
    return computeSync(
      route,
      startTime,
      ship ?? DEFAULT_SHIP,
      commandedSpeedKn,
    );
  }, [enabled, route, startTime, ship, commandedSpeedKn]);
}

// ---------------------------------------------------------------
// Synchronous integrator for the climatology-only MVP path.
//
// Mirrors voyage-integrator.ts but without the async weather sampler
// indirection — works because `climatologyAt` is a pure lookup.
// When we add forecast sampling (V1.5), `integrateVoyage()` stays
// async and this function becomes the fast climatology-only path
// wrapped behind a single sampler abstraction.
// ---------------------------------------------------------------

function computeSync(
  route: Array<[number, number]>,
  startTime: Date,
  ship: ShipParams,
  commandedSpeedKn: number,
): UseWeatherAdjustedEtaResult {
  if (route.length < 2) return { data: null, delayH: null };

  const segments: VoyageSegment[] = [];
  let tCursor = startTime;
  let totalNm = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const [lat0, lon0] = route[i];
    const [lat1, lon1] = route[i + 1];

    const segNm = haversineNm(lat0, lon0, lat1, lon1);
    const heading = initialBearingDeg(lat0, lon0, lat1, lon1);
    totalNm += segNm;

    const condition = climatologyAt(lat0, lon0, tCursor);
    const kwon = calculateSpeedLoss({
      ship,
      state: { headingDeg: heading, commandedSpeedKn },
      weather: condition,
    });
    const effSpeed = Math.max(kwon.effectiveSpeedKn, 0.5);
    const hours = segNm / effSpeed;
    const tEnd = new Date(tCursor.getTime() + hours * 3_600_000);

    segments.push({
      tStart: tCursor,
      tEnd,
      lat: lat0,
      lon: lon0,
      distanceNm: segNm,
      effectiveSpeedKn: kwon.effectiveSpeedKn,
      kwon,
      weatherSource: "climatology",
    });
    tCursor = tEnd;
  }

  const calmH = commandedSpeedKn > 0 ? totalNm / commandedSpeedKn : 0;
  const adjustedH = segments.reduce(
    (sum, s) => sum + (s.tEnd.getTime() - s.tStart.getTime()) / 3_600_000,
    0,
  );

  return {
    data: {
      totalDistanceNm: totalNm,
      calmEtaH: calmH,
      adjustedEtaH: adjustedH,
      segments,
      forecastHours: 0,
      climatologyHours: adjustedH,
    },
    delayH: adjustedH - calmH,
  };
}

// ---- inlined spherical geo (same as voyage-integrator.ts) --------

const EARTH_RADIUS_NM = 3440.065;

function haversineNm(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

function initialBearingDeg(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
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
