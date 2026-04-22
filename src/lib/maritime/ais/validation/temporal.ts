/**
 * Layer 2 — Temporal consistency.
 *
 * Needs the previous known good position for the same MMSI. Catches
 * receiver errors, satellite glitches, and stuck AIS transponders.
 *
 * Rules:
 *   - **Teleport:** position jumped farther than the vessel could
 *     physically travel in the elapsed time (fastest commercial
 *     vessel ≈ 50 kn). Treated as 'reject' — a single outlier
 *     surrounded by consistent fixes is almost always a receiver
 *     error, and mis-plotting it on the map is worse than dropping it.
 *   - **Speed jump:** SOG changed by more than 15 kn in under 60 s.
 *     A tanker doesn't accelerate that fast; this is almost always
 *     a sensor read error. 'warn' because the position might still
 *     be correct even if the speed is wrong.
 *   - **Nav/speed mismatch:** status says "at anchor" or "moored"
 *     but SOG > 2 kn. Crew forgot to switch state, or transponder
 *     lagged. 'info' because it's common and the position is fine.
 */

import type { Flag, FlagType, FlagSeverity } from "./types";
import { NavStatus } from "../types";

export interface TemporalInput {
  /** The incoming (not-yet-stored) position. */
  current: {
    lat: number;
    lon: number;
    sog: number | null;
    navStatus: number | null;
    receivedAt: Date;
  };
  /** The last good position on record for this MMSI, or null if none. */
  prior: {
    lat: number;
    lon: number;
    sog: number | null;
    receivedAt: Date;
  } | null;
}

const MAX_SPEED_KN = 50;              // Matches L1's MAX_VESSEL_SPEED_KN
const SPEED_JUMP_KN = 15;              // Delta that triggers `speed_jump`
const SPEED_JUMP_WINDOW_MS = 60_000;   // Only meaningful for rapid jumps
const ANCHOR_MAX_SOG_KN = 2;           // "At anchor" with SOG above this is a lie
const EARTH_RADIUS_NM = 3440.065;

export function checkTemporal(input: TemporalInput): Flag[] {
  const flags: Flag[] = [];
  const { current, prior } = input;

  if (prior !== null) {
    const elapsedMs = current.receivedAt.getTime() - prior.receivedAt.getTime();
    // If the "prior" is actually newer (out-of-order arrival), skip
    // temporal checks — we don't trust the ordering.
    if (elapsedMs > 0) {
      const distanceNm = haversineNm(
        prior.lat, prior.lon,
        current.lat, current.lon,
      );
      // Maximum physically possible distance at commercial speeds.
      const elapsedH = elapsedMs / 3_600_000;
      const maxPlausibleNm = MAX_SPEED_KN * elapsedH;
      // Small additive grace — receivers can be seconds out of sync, and
      // a dead-slow vessel can appear "static" across noisy GPS fixes.
      const teleportThresholdNm = maxPlausibleNm + 5;
      if (distanceNm > teleportThresholdNm) {
        flags.push({
          layer: "temporal",
          type: "teleport",
          severity: "reject",
          details: {
            distanceNm: round(distanceNm, 2),
            elapsedSeconds: Math.round(elapsedMs / 1000),
            maxPlausibleNm: round(maxPlausibleNm, 2),
            priorLat: prior.lat,
            priorLon: prior.lon,
          },
          messageReceivedAt: current.receivedAt,
        });
      }

      // Speed jump — only meaningful if we have SOG on both fixes and
      // they're less than 60 s apart. Longer gaps legitimately allow
      // a vessel to accel/decel across a full speed band.
      if (
        current.sog !== null &&
        prior.sog !== null &&
        elapsedMs < SPEED_JUMP_WINDOW_MS
      ) {
        const delta = Math.abs(current.sog - prior.sog);
        if (delta > SPEED_JUMP_KN) {
          flags.push(makeFlag("speed_jump", "warn", {
            priorSog: prior.sog,
            currentSog: current.sog,
            deltaKn: round(delta, 2),
            elapsedSeconds: Math.round(elapsedMs / 1000),
          }, current.receivedAt));
        }
      }
    }
  }

  // Nav/speed mismatch — independent of prior position. If the crew
  // set status to 'at anchor' or 'moored' but the vessel is moving,
  // flag it. Not a rejection because the position itself is fine.
  if (
    current.navStatus !== null &&
    current.sog !== null &&
    current.sog > ANCHOR_MAX_SOG_KN &&
    (current.navStatus === NavStatus.AtAnchor || current.navStatus === NavStatus.Moored)
  ) {
    flags.push(makeFlag("nav_speed_mismatch", "info", {
      navStatus: current.navStatus,
      sog: current.sog,
    }, current.receivedAt));
  }

  return flags;
}

// ---- Helpers -----------------------------------------------------

function makeFlag(
  type: FlagType,
  severity: FlagSeverity,
  details: Record<string, unknown>,
  messageReceivedAt: Date,
): Flag {
  return { layer: "temporal", type, severity, details, messageReceivedAt };
}

/**
 * Great-circle distance in nautical miles. Haversine formula — good
 * to ~0.5% across all latitudes, which is more than enough for
 * teleport detection (our threshold is order-of-magnitude, not metres).
 */
export function haversineNm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
