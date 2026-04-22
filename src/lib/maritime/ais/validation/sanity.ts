/**
 * Layer 1 — Sanity checks.
 *
 * Per-message, stateless, cheap. Catches the "physically impossible"
 * or "obvious receiver error" cases that make it through AISStream
 * without any server-side cleaning:
 *   - NULL island (lat=0, lon=0) — GPS fault
 *   - Bounds violations
 *   - Impossible / negative speeds
 *
 * Every rejection is a 'reject' severity — the message is dropped
 * entirely. If we ever need to store "bad data for analysis", we
 * flip the severity in one place; the message still lands in the
 * DB, just flagged.
 */

import type { Flag, FlagType } from "./types";

export interface SanityInput {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  receivedAt: Date;
}

const MAX_VESSEL_SPEED_KN = 50; // Nothing commercial exceeds this; passenger ferries top out ~45.

/**
 * Run every L1 check and return flags. Caller aggregates with other
 * layers. Multiple rules can fire at once — e.g. a message at
 * (91.0, -200.0) would trigger both `lat_out_of_range` and
 * `lon_out_of_range`, and we want to log both.
 */
export function checkSanity(input: SanityInput): Flag[] {
  const flags: Flag[] = [];

  // NULL island — lat and lon both exactly 0. Not technically
  // impossible (there's water off the coast of Ghana there), but
  // empirically it's always a GPS fault or a default/zeroed field.
  if (input.lat === 0 && input.lon === 0) {
    flags.push(
      reject("null_island", { lat: input.lat, lon: input.lon }, input.receivedAt),
    );
  }

  if (input.lat < -90 || input.lat > 90) {
    flags.push(reject("lat_out_of_range", { lat: input.lat }, input.receivedAt));
  }
  if (input.lon < -180 || input.lon > 180) {
    flags.push(reject("lon_out_of_range", { lon: input.lon }, input.receivedAt));
  }

  if (input.sog !== null) {
    if (input.sog < 0) {
      flags.push(reject("sog_negative", { sog: input.sog }, input.receivedAt));
    } else if (input.sog > MAX_VESSEL_SPEED_KN) {
      flags.push(
        reject(
          "sog_impossible",
          { sog: input.sog, max: MAX_VESSEL_SPEED_KN },
          input.receivedAt,
        ),
      );
    }
  }

  if (input.cog !== null && (input.cog < 0 || input.cog > 360)) {
    // This is a WARN not REJECT — we can still plot the position,
    // we just shouldn't use the bearing. UI falls back to heading
    // or hides the rotation.
    flags.push({
      layer: "sanity",
      type: "cog_out_of_range",
      severity: "warn",
      details: { cog: input.cog },
      messageReceivedAt: input.receivedAt,
    });
  }

  return flags;
}

/** Helper so every reject in this file reads the same. */
function reject(
  type: FlagType,
  details: Record<string, unknown>,
  messageReceivedAt: Date,
): Flag {
  return {
    layer: "sanity",
    type,
    severity: "reject",
    details,
    messageReceivedAt,
  };
}
