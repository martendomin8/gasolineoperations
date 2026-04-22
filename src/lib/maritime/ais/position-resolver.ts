/**
 * `resolvePosition()` — the hybrid LIVE / DEAD_RECK / PREDICTED selector.
 *
 * One function, called once per vessel per render. Input: the latest
 * AIS fix (if any) plus the voyage plan. Output: a single `ResolvedPosition`
 * that tells the UI where to draw the marker and in which visual mode.
 *
 * This file is intentionally pure:
 *   - No DB calls, no fetches, no ocean-routing imports.
 *   - Callers (API routes, the UI hook) inject the `routePredict` fn.
 *   - Every branch is deterministic, so unit tests are trivial.
 *
 * See `docs/AIS-LIVE-TRACKING-SPEC.md` §9 for the design rationale.
 */

import type {
  PositionMode,
  ResolvedPosition,
  VesselPosition,
} from "./types";

// ---- Tunables (see spec §9) ----------------------------------------

/** LIVE if the last AIS fix arrived within this many ms. */
export const LIVE_WINDOW_MS = 10 * 60 * 1000;       // 10 minutes
/** DEAD_RECK if within this many ms. Beyond this, we switch to route-based PREDICTED. */
export const DEAD_RECK_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Fallback speed when we don't know the CP speed — typical MR tanker laden speed. */
export const DEFAULT_CP_SPEED_KN = 12;
/** Earth radius in nautical miles — used by the great-circle step. */
const EARTH_RADIUS_NM = 3440.065;

// ---- Inputs --------------------------------------------------------

export interface VoyagePlan {
  /** Anchor for PREDICTED mode when we've never seen AIS — e.g. loadport coords. */
  loadportLat: number;
  loadportLon: number;
  /** CP speed from Q88, knots. Falls back to `DEFAULT_CP_SPEED_KN`. */
  cpSpeedKn: number | null;
  /**
   * Oracle for "where along the ocean-routed path would the vessel be
   * at time `t`?". Caller injects the implementation so the resolver
   * can stay decoupled from the ocean-routing graph.
   *
   * Contract: given a target time, return the lat/lon the vessel
   * WOULD be at assuming it left `from` at `since` travelling at
   * `cpSpeedKn` along the great-circle / ocean-route path. Return
   * null if the oracle can't compute (e.g. no route known).
   */
  routePredict:
    | ((args: {
        fromLat: number;
        fromLon: number;
        toLat: number;
        toLon: number;
        since: Date;
        cpSpeedKn: number;
        at: Date;
      }) => { lat: number; lon: number; bearingDeg: number } | null)
    | null;
  /** Discharge port coords, used as the destination for `routePredict`. */
  dischargeLat: number | null;
  dischargeLon: number | null;
  /** When the voyage nominally began — defaults to laycanStart. Null =
   *  use AIS receivedAt (if any) or `now` as the start anchor. */
  voyageStart: Date | null;
}

export interface ResolveArgs {
  lastAis: VesselPosition | null;
  now: Date;
  voyage: VoyagePlan;
}

// ---- Entry point ---------------------------------------------------

/**
 * Pick the best-available position for a vessel at time `now`. The
 * returned `mode` tells the UI which marker style to use; the lat/lon
 * are where to draw it.
 *
 * Branches:
 *   1. No AIS ever → PREDICTED from loadport, or the loadport itself
 *      if `routePredict` is null.
 *   2. AIS age < 10 min → LIVE, use the AIS fix verbatim.
 *   3. AIS age < 2 h    → DEAD_RECK, extrapolate AIS cog+sog.
 *   4. AIS age ≥ 2 h    → PREDICTED from the last AIS anchor.
 */
export function resolvePosition({
  lastAis,
  now,
  voyage,
}: ResolveArgs): ResolvedPosition {
  const cpSpeed = voyage.cpSpeedKn ?? DEFAULT_CP_SPEED_KN;

  // --- Branch 1: never seen AIS ---
  // Plant the marker at the loadport — "we haven't detected the vessel
  // yet, here's the departure point as a placeholder". We deliberately
  // DO NOT project forward using CP speed + laycan start, because:
  //   - `laycanStart` is the contractual arrival window, not a real
  //     departure time. A vessel might arrive at loadport late, load
  //     for 1-3 days, then depart — easily days after laycanStart.
  //   - Projecting forward without that correction snapped markers to
  //     the discharge port once the contract had been open long enough
  //     for CP-speed-times-elapsed to exceed the route distance. Honest
  //     > optimistic: show the loadport until we have real data.
  // The moment the worker ingests its first `PositionReport` for this
  // MMSI, branch 2/3/4 takes over and the marker jumps to real data.
  if (lastAis === null) {
    return {
      lat: voyage.loadportLat,
      lon: voyage.loadportLon,
      mode: "predicted",
      aisReceivedAt: null,
      ageMs: Infinity,
      bearingDeg: null,
    };
  }

  const ageMs = now.getTime() - lastAis.receivedAt.getTime();

  // --- Branch 2: LIVE ---
  if (ageMs < LIVE_WINDOW_MS) {
    return {
      lat: lastAis.lat,
      lon: lastAis.lon,
      mode: "live",
      aisReceivedAt: lastAis.receivedAt,
      ageMs,
      bearingDeg: pickBearing(lastAis),
    };
  }

  // --- Branch 3: DEAD RECK ---
  if (ageMs < DEAD_RECK_WINDOW_MS) {
    const projected = deadReckon(lastAis, ageMs);
    return {
      lat: projected.lat,
      lon: projected.lon,
      mode: "dead_reck",
      aisReceivedAt: lastAis.receivedAt,
      ageMs,
      bearingDeg: pickBearing(lastAis),
    };
  }

  // --- Branch 4: PREDICTED from last AIS anchor ---
  return resolvePredicted({
    fromLat: lastAis.lat,
    fromLon: lastAis.lon,
    since: lastAis.receivedAt,
    cpSpeedKn: cpSpeed,
    voyage,
    now,
    aisReceivedAt: lastAis.receivedAt,
    ageMs,
    fallbackBearing: pickBearing(lastAis),
  });
}

// ---- PREDICTED branch helper -------------------------------------

interface PredictedArgs {
  fromLat: number;
  fromLon: number;
  since: Date;
  cpSpeedKn: number;
  voyage: VoyagePlan;
  now: Date;
  aisReceivedAt: Date | null;
  ageMs: number;
  fallbackBearing: number | null;
}

function resolvePredicted({
  fromLat,
  fromLon,
  since,
  cpSpeedKn,
  voyage,
  now,
  aisReceivedAt,
  ageMs,
  fallbackBearing,
}: PredictedArgs): ResolvedPosition {
  // If the voyage has no discharge port or no route oracle, we can't
  // project along a path. Plant the marker at the anchor — a sensible
  // "last known / departure point" so ops isn't looking at an empty map.
  if (
    voyage.dischargeLat === null ||
    voyage.dischargeLon === null ||
    voyage.routePredict === null
  ) {
    return {
      lat: fromLat,
      lon: fromLon,
      mode: "predicted",
      aisReceivedAt,
      ageMs,
      bearingDeg: fallbackBearing,
    };
  }

  const projected = voyage.routePredict({
    fromLat,
    fromLon,
    toLat: voyage.dischargeLat,
    toLon: voyage.dischargeLon,
    since,
    cpSpeedKn,
    at: now,
  });

  if (projected === null) {
    // Oracle bailed — same fallback as above.
    return {
      lat: fromLat,
      lon: fromLon,
      mode: "predicted",
      aisReceivedAt,
      ageMs,
      bearingDeg: fallbackBearing,
    };
  }

  return {
    lat: projected.lat,
    lon: projected.lon,
    mode: "predicted",
    aisReceivedAt,
    ageMs,
    bearingDeg: projected.bearingDeg,
  };
}

// ---- Helpers -----------------------------------------------------

/**
 * Dead-reckon a vessel from its last AIS fix along `cog` at `sog` for
 * `elapsedMs`. Straight great-circle step — good enough for gaps < 2 h
 * because the vessel doesn't change heading that fast on the open sea.
 */
function deadReckon(
  fix: VesselPosition,
  elapsedMs: number,
): { lat: number; lon: number } {
  // Fall back to 0 if AIS didn't report speed (anchored / moored).
  const sogKn = fix.sog ?? 0;
  if (sogKn <= 0) {
    return { lat: fix.lat, lon: fix.lon };
  }
  const distanceNm = sogKn * (elapsedMs / 3_600_000);
  const bearingDeg = fix.cog ?? fix.heading ?? 0;
  return greatCircleForward(fix.lat, fix.lon, bearingDeg, distanceNm);
}

/**
 * Step along a great circle. Standard aviation/marine formula — same
 * one Turf uses internally in `@turf/great-circle`, but rolled inline
 * so this file has zero runtime dependencies (important for Jest /
 * Vitest unit tests and for the worker process which doesn't bundle Turf).
 */
function greatCircleForward(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceNm: number,
): { lat: number; lon: number } {
  const lat1 = toRad(latDeg);
  const lon1 = toRad(lonDeg);
  const bearing = toRad(bearingDeg);
  const angDist = distanceNm / EARTH_RADIUS_NM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

function pickBearing(fix: VesselPosition): number | null {
  // Prefer true heading (from gyro) over course-over-ground. Fall back
  // to COG when heading is unavailable (AIS 511 → null by the time it
  // reaches this module).
  return fix.heading ?? fix.cog ?? null;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// ---- Exports for tests -------------------------------------------

/** @internal — exported only for unit tests. */
export const _test = {
  deadReckon,
  greatCircleForward,
  pickBearing,
};

/** Helper for UI code: a user-friendly "3h 12m ago" string. */
export function formatAisAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return "never";
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem === 0 ? `${h}h ago` : `${h}h ${rem}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Helper for UI code: the badge label to show next to the marker. */
export function modeBadge(mode: PositionMode): string {
  switch (mode) {
    case "live":
      return "LIVE";
    case "dead_reck":
      return "LAST KNOWN";
    case "predicted":
      return "PREDICTED";
  }
}
