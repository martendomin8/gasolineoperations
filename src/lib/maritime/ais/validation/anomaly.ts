/**
 * Layer 4 — Behavioural anomaly detection.
 *
 * "Anomaly" here does NOT mean "bad data to reject" — it means
 * **operationally interesting** behaviour an operator should see.
 * Most flags from this layer are `info` severity and feed the
 * intelligence overlay on the Fleet page, not a warning banner.
 *
 * Rules:
 *   - **AIS-off near sanctioned port:** last known position inside a
 *     zone + silence > 45 min. Classic dark-fleet pattern.
 *   - **AIS-off mid-voyage:** silence > 24 h while presumed at sea
 *     (not near any port). Could be a transponder fault OR a
 *     deliberate disappearance; operator decides.
 *
 * This layer is called WITH a `prior` position and the wall-clock
 * time — it's really a "did we stop hearing from this vessel?"
 * check, evaluated per MMSI on a timer by the worker, NOT per
 * incoming message. (See spec §9a — L4 is the one layer that's
 * not driven by a new message arriving.)
 */

import type { Flag, FlagType, FlagSeverity } from "./types";
import { zoneContaining, type SanctionedZone } from "./zones";

export interface AnomalyInput {
  /** Last known good position. If null, we can't decide where the
   *  vessel went silent, so no anomaly is raised. */
  lastKnown: {
    lat: number;
    lon: number;
    receivedAt: Date;
  } | null;
  /** Current wall-clock — used to measure silence duration. */
  now: Date;
}

const SANCTIONED_SILENCE_MS = 45 * 60 * 1000;         // 45 minutes
const MIDVOYAGE_SILENCE_MS = 24 * 60 * 60 * 1000;      // 24 hours

export function checkAnomaly(input: AnomalyInput): Flag[] {
  const flags: Flag[] = [];
  const { lastKnown, now } = input;
  if (lastKnown === null) return flags;

  const silenceMs = now.getTime() - lastKnown.receivedAt.getTime();
  if (silenceMs <= 0) return flags;

  const zone = zoneContaining(lastKnown.lat, lastKnown.lon);

  if (zone !== null) {
    if (silenceMs >= SANCTIONED_SILENCE_MS) {
      flags.push(makeFlag("ais_off_sanctioned", "info", {
        zoneCode: zone.code,
        zoneName: zone.name,
        reason: zone.reason,
        silenceSeconds: Math.floor(silenceMs / 1000),
        lastLat: lastKnown.lat,
        lastLon: lastKnown.lon,
      }, lastKnown.receivedAt));
    }
  } else if (silenceMs >= MIDVOYAGE_SILENCE_MS) {
    flags.push(makeFlag("ais_off_midvoyage", "info", {
      silenceHours: round(silenceMs / 3_600_000, 1),
      lastLat: lastKnown.lat,
      lastLon: lastKnown.lon,
    }, lastKnown.receivedAt));
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
  return { layer: "anomaly", type, severity, details, messageReceivedAt };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export type { SanctionedZone };
export { SANCTIONED_ZONES, zoneContaining } from "./zones";
