/**
 * Shared types for the AIS data-validation stack.
 *
 * The stack has 6 layers (see `docs/AIS-LIVE-TRACKING-SPEC.md` §9a).
 * Each layer exports a pure `check*()` function that takes a message
 * (+ optional context) and returns zero or more `Flag`s. The
 * orchestrator (`index.ts`) runs them in order and aggregates the
 * results into a single `ValidationResult`.
 */

/** Which validation layer raised a flag. Kept as a string literal
 *  union so adding a new layer is a type-safe additive change. */
export type ValidationLayer =
  | "sanity"      // L1 — per-message static checks (lat/lon bounds, null island)
  | "temporal"    // L2 — consistency vs last known position
  | "identity"    // L3 — cross-check AIS vs linkage / Q88
  | "anomaly"     // L4 — behavioural flags (AIS off in sanctioned zones)
  | "business";   // L5 — NEFGO-specific domain rules

/** How seriously the UI should treat a flag. */
export type FlagSeverity =
  | "reject"      // Don't store the position. The AIS message is bad data.
  | "warn"        // Store but surface a warning badge on the vessel marker.
  | "info";       // Store as an intelligence signal (e.g. "AIS off near Primorsk").

/**
 * Fine-grained flag codes. Each layer owns its namespace; adding a
 * new code here is the one-line change needed to surface a new
 * validation rule. The UI looks these up to render a human-readable
 * message; the DB stores them verbatim for audit.
 *
 * NEVER rename or delete an existing code — doing so orphans historic
 * flags. If a rule changes behaviour, introduce a new code and
 * deprecate the old.
 */
export type FlagType =
  // L1 Sanity
  | "null_island"            // lat=0, lon=0
  | "lat_out_of_range"       // lat outside [-90, 90]
  | "lon_out_of_range"       // lon outside [-180, 180]
  | "sog_impossible"         // speed over ground > 50 kn
  | "sog_negative"           // speed < 0
  | "cog_out_of_range"       // course outside [0, 360]
  // L2 Temporal
  | "teleport"               // position jumped > threshold between msgs
  | "speed_jump"             // sog delta > threshold in < 60 s
  | "nav_speed_mismatch"     // "at anchor" status but sog > 2 kn
  // L3 Identity
  | "name_mismatch"          // AIS ShipName differs from linkage.vesselName
  | "imo_mismatch"           // AIS IMO differs from linkage.vesselImo
  | "dimension_mismatch"     // AIS dimensions don't match Q88 LOA/beam
  // L4 Anomaly
  | "ais_off_sanctioned"     // silent > threshold near sanctioned loadport
  | "ais_off_midvoyage"      // silent > 24h mid-voyage (non-sanctioned)
  // L5 Business
  | "speed_below_cp"         // sog < CP speed × 0.85, laycan at risk
  | "off_route"              // > 30 nm off the great-circle / ocean-route path
  | "eta_drift";             // AIS ETA diverges > 24h from laycan

/** A single flag raised by a validation layer. */
export interface Flag {
  layer: ValidationLayer;
  type: FlagType;
  severity: FlagSeverity;
  /** Structured context — old/new values, deltas — serialised to
   *  `ais_validation_flags.details` JSONB. Keep keys stable so operator
   *  dashboards can rely on the shape. */
  details: Record<string, unknown>;
  /** The AIS receipt timestamp of the flagged message. Used so we can
   *  retroactively validate historical data and keep the audit trail
   *  aligned with the original event time, not the validator run time. */
  messageReceivedAt: Date;
}

/** The aggregated decision from running the full stack. */
export interface ValidationResult {
  /** True iff NO flag has severity 'reject'. */
  accept: boolean;
  /** Every flag raised — rejects + warns + infos. */
  flags: Flag[];
}
