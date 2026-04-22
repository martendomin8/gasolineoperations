/**
 * Layer 5 — NEFGO-specific domain rules.
 *
 * These are the "trader cares about this" checks — they're not about
 * AIS data quality, they're about whether the voyage is on track.
 * Most of them fire at `info` severity, feed alerts, and never block
 * position storage.
 *
 * Rules:
 *   - **Speed below CP:** vessel's SOG is chronically below the CP
 *     speed (Q88 or charter party). Demurrage / laycan risk signal.
 *   - **Off-route:** position more than `OFF_ROUTE_NM_THRESHOLD`
 *     nautical miles from the great-circle path loadport → discharge
 *     port. Either the vessel has deviated (weather, STS, divert)
 *     or our ocean-routing ignored a channel the vessel actually
 *     took. Either way, trader wants to know.
 *   - **ETA drift:** AIS-broadcast ETA differs from laycan-end by
 *     more than `ETA_DRIFT_HOURS`. Usually the crew just forgot to
 *     update the ETA field, but an accurate ETA drift IS the
 *     laycan-miss signal.
 *
 * This layer is called WITH rich context — speed, route, laycan —
 * so it's only meaningful for positions tied to a specific linkage.
 * Messages with no linkage context skip this layer via the
 * orchestrator (`ValidationContext.business = null`).
 */

import type { Flag, FlagType, FlagSeverity } from "./types";
import { haversineNm } from "./temporal";

export interface BusinessInput {
  current: {
    lat: number;
    lon: number;
    sog: number | null;
    receivedAt: Date;
  };
  /** Charter party speed from Q88, knots. Null = skip speed checks. */
  cpSpeedKn: number | null;
  /** Rolling SOG average over last N positions, if available. Null
   *  means we only have the spot reading — skip the chronic-slow check. */
  avgSogRecentKn: number | null;
  /** Great-circle reference path, for off-route detection. */
  route: {
    loadportLat: number;
    loadportLon: number;
    dischargeLat: number;
    dischargeLon: number;
  } | null;
  /** AIS-broadcast ETA (from ShipStaticData), or null if not known. */
  aisEta: Date | null;
  /** Contractual laycan end date — from the linkage / its deals. */
  laycanEnd: Date | null;
}

const CP_SPEED_TOLERANCE = 0.85;       // Below 85% of CP = chronic-slow signal.
const OFF_ROUTE_NM_THRESHOLD = 30;     // 30 nm off the great-circle line.
const ETA_DRIFT_MS = 24 * 60 * 60 * 1000; // 24-hour drift vs laycan.

export function checkBusiness(input: BusinessInput): Flag[] {
  const flags: Flag[] = [];
  const { current, cpSpeedKn, avgSogRecentKn, route, aisEta, laycanEnd } = input;

  // Speed below CP — use the rolling average when available, fall back
  // to the single reading (less reliable, so only flag on a bigger gap).
  if (cpSpeedKn !== null && cpSpeedKn > 0) {
    const sample = avgSogRecentKn ?? current.sog;
    if (sample !== null && sample > 0) {
      const threshold = cpSpeedKn * CP_SPEED_TOLERANCE;
      if (sample < threshold) {
        flags.push(makeFlag("speed_below_cp", "info", {
          cpSpeedKn,
          observedKn: sample,
          threshold: round(threshold, 2),
          source: avgSogRecentKn !== null ? "avg" : "spot",
        }, current.receivedAt));
      }
    }
  }

  // Off-route — distance from the current position to the great-circle
  // line between loadport and discharge. Approximate via cross-track
  // distance. Same caveat as spec §5: near chokepoints (canals,
  // straits) a vessel legitimately deviates kilometres off the GC line,
  // so the threshold is intentionally generous.
  if (route !== null) {
    const crossTrackNm = crossTrackDistanceNm(
      current.lat, current.lon,
      route.loadportLat, route.loadportLon,
      route.dischargeLat, route.dischargeLon,
    );
    if (crossTrackNm > OFF_ROUTE_NM_THRESHOLD) {
      flags.push(makeFlag("off_route", "info", {
        crossTrackNm: round(crossTrackNm, 2),
        thresholdNm: OFF_ROUTE_NM_THRESHOLD,
        currentLat: current.lat,
        currentLon: current.lon,
      }, current.receivedAt));
    }
  }

  // ETA drift — only meaningful if both values are known.
  if (aisEta !== null && laycanEnd !== null) {
    const driftMs = Math.abs(aisEta.getTime() - laycanEnd.getTime());
    if (driftMs > ETA_DRIFT_MS) {
      flags.push(makeFlag("eta_drift", "info", {
        aisEta: aisEta.toISOString(),
        laycanEnd: laycanEnd.toISOString(),
        driftHours: round(driftMs / 3_600_000, 1),
      }, current.receivedAt));
    }
  }

  return flags;
}

// ---- Helpers -----------------------------------------------------

/**
 * Cross-track distance from a point to the great-circle through two
 * other points. Standard aviation/marine formula; adequate for the
 * 30-nm-ish threshold we use here.
 */
export function crossTrackDistanceNm(
  lat: number, lon: number,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3440.065; // nm
  const d13 = haversineNm(lat1, lon1, lat, lon) / R;
  const bearing13 = initialBearing(lat1, lon1, lat, lon);
  const bearing12 = initialBearing(lat1, lon1, lat2, lon2);
  const xt = Math.asin(Math.sin(d13) * Math.sin(bearing13 - bearing12));
  return Math.abs(xt * R);
}

function initialBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return Math.atan2(y, x);
}

function makeFlag(
  type: FlagType,
  severity: FlagSeverity,
  details: Record<string, unknown>,
  messageReceivedAt: Date,
): Flag {
  return { layer: "business", type, severity, details, messageReceivedAt };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
