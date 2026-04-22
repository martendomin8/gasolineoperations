/**
 * Shared types for the AIS live-tracking subsystem.
 *
 * Two conceptual entities:
 *   - `VesselStatic`  — identity & particulars (name, IMO, dimensions,
 *     destination). Broadcast ~every 6 minutes per vessel.
 *   - `VesselPosition` — lat/lon/course/speed/heading/nav-status.
 *     Broadcast every few seconds while underway.
 *
 * These are the domain types. AISStream's raw JSON is translated into
 * these shapes in the `aisstream` provider; other providers
 * (MarineTraffic etc.) do the same translation from their own formats.
 *
 * See `docs/AIS-LIVE-TRACKING-SPEC.md` for the broader design.
 */

export type MMSI = number;

/** Snapshot of a vessel's identity / static data. */
export interface VesselStatic {
  mmsi: MMSI;
  imo: number | null;               // may be absent for very small craft
  name: string;                     // trimmed; AIS pads with trailing spaces
  callSign: string | null;
  shipType: number | null;          // AIS type code; 80–89 = tankers
  lengthM: number | null;           // dim.A + dim.B
  beamM: number | null;             // dim.C + dim.D
  draughtM: number | null;          // maximum static draught
  destination: string | null;
  eta: Date | null;                 // best-effort — AIS ETA has no year,
                                    // so we infer (next occurrence rule)
  staticUpdatedAt: Date;            // when we received this static packet
}

/** A single lat/lon report for a vessel. */
export interface VesselPosition {
  mmsi: MMSI;
  lat: number;
  lon: number;
  cog: number | null;               // course over ground, 0–360°
  sog: number | null;               // speed over ground, knots
  heading: number | null;           // 0–359; null when AIS says "unknown" (511)
  navStatus: NavStatus | null;
  receivedAt: Date;
}

/** AIS navigational status code (ITU-R M.1371). */
export enum NavStatus {
  UnderwayUsingEngine = 0,
  AtAnchor = 1,
  NotUnderCommand = 2,
  RestrictedManoeuvrability = 3,
  ConstrainedByDraught = 4,
  Moored = 5,
  Aground = 6,
  EngagedInFishing = 7,
  UnderwaySailing = 8,
  AisSartActive = 14,
  Undefined = 15,
}

/** Combined view used by the UI — a vessel with its latest position. */
export interface VesselSnapshot {
  static: VesselStatic;
  position: VesselPosition;
  /** Milliseconds since the last position update. UI uses this for the
   *  stale-data visual (faded marker after ~10 min). */
  ageMs: number;
}

/** Subscription scope for providers that support it. */
export interface AisSubscription {
  /** Watchlist of specific vessels. If given, only these are returned. */
  mmsis?: MMSI[];
  /** Geographic filter — `[[latMin, lonMin], [latMax, lonMax]]`. */
  bbox?: [[number, number], [number, number]];
}

/**
 * How confident we are about where a vessel is right now — the three
 * modes of the hybrid position strategy. See spec §9 and
 * `position-resolver.ts`.
 */
export type PositionMode = "live" | "dead_reck" | "predicted";

/** The output of the position resolver — where to draw the marker. */
export interface ResolvedPosition {
  lat: number;
  lon: number;
  mode: PositionMode;
  /** When the underlying AIS fix was received. Null if we've never
   *  seen an AIS packet for this vessel (pure PREDICTED mode). */
  aisReceivedAt: Date | null;
  /** Milliseconds since the last AIS fix. `Infinity` if no AIS. Drives
   *  the UI's "last seen 3h 12m ago" label. */
  ageMs: number;
  /** Course to render the marker rotation at. Degrees, 0–360. For LIVE
   *  this is the AIS heading/cog; for DEAD_RECK / PREDICTED it's the
   *  current great-circle bearing along the projected track. */
  bearingDeg: number | null;
}
