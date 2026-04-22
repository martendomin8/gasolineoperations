/**
 * Shared types for the weather-adjusted ETA subsystem.
 *
 * All arithmetic lives in `kwon.ts` and `voyage-integrator.ts`; this
 * file is the contract between them and the UI / API layers.
 *
 * Design notes (from the Kwon'81 + later updates literature):
 *   - "Involuntary speed loss" only. Captain-driven speed changes
 *     (fuel save, storm avoidance routing) are NOT modelled here.
 *     We estimate what the vessel physically cannot do against the
 *     weather, not what a crew chooses to do.
 *   - Units: SI where possible. Wind/wave directions are true
 *     bearings (0°=North, clockwise). Speeds are knots. Distances
 *     are nautical miles. Times are milliseconds or hours as
 *     explicit in field names.
 */

/** AIS/Q88-aligned vessel type classes used for Kwon coefficients. */
export type ShipType =
  | "tanker"     // oil/product/chemical — covers our entire fleet
  | "bulker"     // dry-bulk carrier
  | "container"  // boxboat
  | "lng"        // LNG / LPG carrier
  | "general";   // fallback when classification unknown

export type LoadingState = "loaded" | "ballast";

/** Minimum vessel parameters Kwon needs. Comes from Q88 parse. */
export interface ShipParams {
  type: ShipType;
  /** Summer deadweight, metric tonnes. */
  dwt: number;
  /** Length overall, metres. */
  loa: number;
  /** Beam, metres. Currently unused in V1 but kept for V2 Holtrop upgrade. */
  beam?: number;
  loadingState: LoadingState;
  /** Calm-weather service speed, knots. Typically 12 for tankers on CP. */
  serviceSpeedKn: number;
}

/** Weather conditions sampled at a single point in time and space. */
export interface WeatherCondition {
  /** Wind speed at 10 m, knots. */
  windSpeedKn: number;
  /** True wind bearing — direction the wind is blowing FROM, degrees. */
  windDirDeg: number;
  /** Significant wave height, metres. */
  waveHeightM: number;
  /** Mean wave direction — where waves are coming FROM, degrees. */
  waveDirDeg: number;
}

/** Ship's instantaneous state — heading + commanded speed. */
export interface ShipState {
  /** True heading, 0-360°. Where the ship points. */
  headingDeg: number;
  /** Commanded speed (what operator typed in planner), knots.
   *  Kwon uses this as V0 baseline for the speed-loss calc. */
  commandedSpeedKn: number;
}

/** Inputs to a single Kwon evaluation — one vessel, one moment. */
export interface KwonInput {
  ship: ShipParams;
  state: ShipState;
  weather: WeatherCondition;
}

/** Result of a single Kwon evaluation. */
export interface KwonResult {
  /** 0.0 – 1.0 fraction of speed lost to weather. */
  speedLossFraction: number;
  /** Commanded speed × (1 - speedLossFraction). */
  effectiveSpeedKn: number;
  /** Derived Beaufort number (0-12). */
  beaufortNumber: number;
  /** Wave approach angle relative to ship heading, 0° = head seas,
   *  90° = beam, 180° = following. Used for directional coefficient. */
  relativeWaveAngleDeg: number;
  /** Qualitative summary of why speed was / wasn't lost. */
  note: string;
}

/** A single weather/position sample along a voyage integration. */
export interface VoyageSegment {
  /** UTC timestamp at start of segment. */
  tStart: Date;
  /** UTC timestamp at end of segment. */
  tEnd: Date;
  /** Position at start (lat, lon). */
  lat: number;
  lon: number;
  /** Distance covered in this segment, nm. */
  distanceNm: number;
  /** Effective speed during this segment, kn. */
  effectiveSpeedKn: number;
  /** Full Kwon result for this sample. */
  kwon: KwonResult;
  /** Whether weather was from live forecast or climatology fallback. */
  weatherSource: "forecast" | "climatology";
}

/** Aggregated voyage result — what the UI renders. */
export interface VoyageEtaResult {
  /** Total distance along the route, nm. */
  totalDistanceNm: number;
  /** Calm-weather ETA, hours. (distance / commanded speed, no weather) */
  calmEtaH: number;
  /** Weather-adjusted ETA, hours. Sum of segment durations with
   *  Kwon speed loss applied. */
  adjustedEtaH: number;
  /** Per-segment breakdown for UI detail views + future analysis. */
  segments: VoyageSegment[];
  /** How many hours of the voyage used forecast vs climatology. */
  forecastHours: number;
  climatologyHours: number;
}

/** Weather sampler — voyage-integrator calls this once per segment. */
export type WeatherSampler = (args: {
  lat: number;
  lon: number;
  at: Date;
}) => Promise<{
  condition: WeatherCondition;
  source: "forecast" | "climatology";
}>;
