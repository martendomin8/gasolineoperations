/**
 * Weather-adjusted ETA — public API.
 *
 * Everything the UI and API routes need:
 *
 *   - `calculateSpeedLoss` — the raw Kwon formula for a single
 *     moment. Useful in UI tooltips ("2m beam seas → 4% loss here").
 *   - `integrateVoyage` — walks a full voyage, accumulates speed
 *     losses, returns calm vs adjusted ETA + segment breakdown.
 *   - `classifyShipType` — best-effort map from Q88 free-text to
 *     one of our ship profile classes.
 *   - `climatologyAt` — climatological weather for a point + time.
 *     Call it directly if you want "what's typical weather at 5°N
 *     80°E in August" without the full integrator.
 *
 * Types:
 *   - `ShipParams`, `ShipState`, `WeatherCondition`, `KwonInput`,
 *     `KwonResult`, `VoyageSegment`, `VoyageEtaResult`,
 *     `WeatherSampler`
 *
 * Everything else (Beaufort table, directional curve, internal ship
 * profiles) is intentionally not re-exported — use the higher-level
 * functions above.
 */

export { calculateSpeedLoss, windSpeedToBeaufort } from "./kwon";
export { integrateVoyage } from "./voyage-integrator";
export { classifyShipType, getShipProfile } from "./ship-profiles";
export { climatologyAt, zoneFor } from "./climatology";

export type {
  ShipType,
  LoadingState,
  ShipParams,
  ShipState,
  WeatherCondition,
  KwonInput,
  KwonResult,
  VoyageSegment,
  VoyageEtaResult,
  WeatherSampler,
} from "./types";
