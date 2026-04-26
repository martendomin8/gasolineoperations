// Derives the vessel's effective state from voyage-timeline events at a
// given instant. Replaces the legacy `linkage.status` stepper (Active →
// Loading → Sailing → Discharging → Completed) which the operator had to
// click manually — the system can now figure out where in the voyage the
// vessel is purely from arrival/departure timestamps.
//
// The output drives:
//   - The Fleet map vessel marker (at port vs interpolated mid-route)
//   - The VoyageSchematicBar in the linkage view (which segment is "past",
//     where the vessel marker sits, which segments are "future")

import type { ResolvedPort } from "./resolver";

export type VoyagePhase =
  | "pre_voyage"   // No timestamps yet — vessel hasn't even arrived at first port
  | "at_port"      // Currently at a port (now ∈ [arrival, departure] of some stop)
  | "sailing"      // Underway between two stops
  | "completed";   // Past the final stop's departure

export interface VoyageState {
  phase: VoyagePhase;
  /**
   * Index of the stop the vessel is AT (when phase = "at_port" or
   * "pre_voyage" / "completed") OR the stop the vessel just LEFT
   * (when phase = "sailing"). Null when no stops exist.
   */
  atStopIdx: number | null;
  /**
   * For "sailing" phase: index of the stop the vessel is heading TO.
   * Null otherwise.
   */
  nextStopIdx: number | null;
  /**
   * For "sailing" phase: progress along the current leg, 0..1 (clamped).
   * 0 = just left previous port; 1 = just arrived at next port.
   * Null otherwise.
   */
  legProgress: number | null;
  /**
   * Human-readable label for the operator: "Loading at Bayonne",
   * "Sailing to Gdansk", "Discharging at Gdansk", "Completed", etc.
   * Used in the progress-bar caption + the Fleet map status pill.
   */
  label: string;
}

/**
 * Walk the resolved timeline and figure out where the vessel is at `now`.
 *
 * Decision tree:
 *   - No stops at all → pre_voyage, label "No voyage data"
 *   - now < first arrival → pre_voyage at stop 0, label "Awaiting arrival at <port>"
 *   - now ∈ [arrival, departure] of stop i → at_port at stop i,
 *       label "Loading at <port>" / "Discharging at <port>"
 *   - now between stop i's departure and stop i+1's arrival → sailing,
 *       label "Sailing to <port[i+1]>"
 *   - now > final departure → completed, label "Completed"
 */
export function deriveVoyageState(
  stops: ResolvedPort[],
  now: Date = new Date()
): VoyageState {
  if (stops.length === 0) {
    return {
      phase: "pre_voyage",
      atStopIdx: null,
      nextStopIdx: null,
      legProgress: null,
      label: "No voyage data",
    };
  }

  const nowMs = now.getTime();

  // Pre-voyage: no first arrival or arrival is in the future
  const first = stops[0];
  if (first.arrivalAt === null || nowMs < first.arrivalAt.getTime()) {
    return {
      phase: "pre_voyage",
      atStopIdx: 0,
      nextStopIdx: null,
      legProgress: null,
      label: `Awaiting arrival at ${first.port}`,
    };
  }

  // Walk stops in order. We split each iteration into two checks:
  //   (a) is the vessel AT this stop (now ∈ [arrival, departure])?
  //   (b) is the vessel STILL EN ROUTE to this stop (prev departed, this not arrived)?
  // Skipping the iteration when arrivalAt is missing produced false
  // "completed" labels for any voyage where a downstream port lacked an
  // operator ETA — the resolver cascade couldn't fill it in (distance
  // lookup unavailable in the progress-bar context). Now we treat a known
  // prev-departure as enough evidence that the vessel is sailing, even if
  // the destination ETA is unknown.
  let lastKnownDeparture: { idx: number; at: Date } | null = null;

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const arrMs = s.arrivalAt?.getTime();
    const depMs = s.departureAt?.getTime();

    // (a) AT this port — covered when arrival exists and now is in the
    //     port-stay window (or arrival is in the past with no departure
    //     yet, meaning vessel is still loading/discharging).
    if (arrMs !== undefined && nowMs >= arrMs) {
      if (depMs === undefined || nowMs <= depMs) {
        return {
          phase: "at_port",
          atStopIdx: i,
          nextStopIdx: i + 1 < stops.length ? i + 1 : null,
          legProgress: null,
          label: `${s.role === "load" ? "Loading" : "Discharging"} at ${s.port}`,
        };
      }
      // Past this port — record its departure for sailing-leg detection
      // and continue.
      if (depMs !== undefined) {
        lastKnownDeparture = { idx: i, at: new Date(depMs) };
      }
      continue;
    }

    // (b) BEFORE this port — vessel hasn't arrived yet. If we know the
    //     previous stop's departure, vessel is sailing this leg.
    if (lastKnownDeparture !== null) {
      const legStartMs = lastKnownDeparture.at.getTime();
      let progress: number;
      if (arrMs !== undefined && arrMs > legStartMs) {
        progress = Math.max(0, Math.min(1, (nowMs - legStartMs) / (arrMs - legStartMs)));
      } else {
        // No destination ETA — show progress 0.5 as a visual placeholder.
        progress = 0.5;
      }
      return {
        phase: "sailing",
        atStopIdx: lastKnownDeparture.idx,
        nextStopIdx: i,
        legProgress: progress,
        label: `Sailing to ${s.port}`,
      };
    }

    // No prior departure recorded — pre-voyage phase, awaiting first arrival.
    return {
      phase: "pre_voyage",
      atStopIdx: i,
      nextStopIdx: null,
      legProgress: null,
      label: `Awaiting arrival at ${s.port}`,
    };
  }

  // Walked past the final stop's window — voyage is done.
  const last = stops[stops.length - 1];
  return {
    phase: "completed",
    atStopIdx: stops.length - 1,
    nextStopIdx: null,
    legProgress: null,
    label: `Completed at ${last.port}`,
  };
}

/**
 * Convenience wrapper: derive state and additionally compute a global
 * progress value 0..1 across the entire voyage, useful for a single
 * progress-bar fill or the Fleet map marker positioning.
 *
 * Math: progress = (legs already completed + current leg progress) / total legs.
 * For "at_port" phase the current segment is the port stay itself, treated
 * as occupying its own slot for visual purposes.
 */
export function deriveVoyageStateWithGlobalProgress(
  stops: ResolvedPort[],
  now: Date = new Date()
): VoyageState & { globalProgress: number } {
  const state = deriveVoyageState(stops, now);
  if (stops.length === 0) return { ...state, globalProgress: 0 };

  // Use stops as nodes (N nodes, N-1 legs). Global progress positions each
  // node evenly across [0, 1]. The vessel sits AT a node (port stay) or
  // between two nodes (sailing leg).
  const N = stops.length;
  const slot = N === 1 ? 1 : 1 / (N - 1);

  if (state.phase === "pre_voyage") {
    return { ...state, globalProgress: 0 };
  }
  if (state.phase === "completed") {
    return { ...state, globalProgress: 1 };
  }
  if (state.phase === "at_port" && state.atStopIdx !== null) {
    return { ...state, globalProgress: state.atStopIdx * slot };
  }
  if (
    state.phase === "sailing" &&
    state.atStopIdx !== null &&
    state.legProgress !== null
  ) {
    return {
      ...state,
      globalProgress: state.atStopIdx * slot + state.legProgress * slot,
    };
  }
  return { ...state, globalProgress: 0 };
}
