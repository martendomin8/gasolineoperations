"use client";

/**
 * `useWeatherAdjustedEta` — React hook that computes the Kwon-adjusted
 * ETA for a given route + ship + commanded speed.
 *
 * Async now that we hit the forecast provider for per-segment
 * weather. Workflow:
 *   1. Operator changes planner speed, route, or ship.
 *   2. Hook kicks off a new integration — `loading = true`.
 *   3. `integrateVoyage` walks the route, sampling weather from
 *      the forecast provider (falls back to climatology beyond
 *      the ~5-day horizon or on sampler errors).
 *   4. Result lands in state, `loading = false`.
 *
 * First sample over a new region takes a few seconds (PNG frames
 * download). After that the browser cache hits every subsequent
 * sample — speed tweaks re-run the integrator in < 100 ms because
 * no frame downloads are required.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { integrateVoyage } from "../voyage-integrator";
import { createForecastSampler } from "../forecast-sampler";
import type { WeatherProvider } from "@/lib/maritime/weather/provider";
import type { ShipParams, VoyageEtaResult } from "../types";

export interface UseWeatherAdjustedEtaArgs {
  /** Ordered [lat, lon] polyline from start to destination. Null when
   *  the planner has no route yet — hook returns null in that case. */
  route: Array<[number, number]> | null;
  /** UTC time at which the vessel is at `route[0]`. */
  startTime: Date;
  /** Ship identity + loading. Null = fall back to a generic loaded
   *  tanker (Kwon still produces reasonable numbers). */
  ship: ShipParams | null;
  /** Commanded speed from the planner's "Speed (knots)" input. */
  commandedSpeedKn: number;
  /** Weather provider — source for forecast frames. */
  weatherProvider: WeatherProvider;
  /** When false (planner not open, no route yet), skip compute. */
  enabled?: boolean;
  /** Optional authoritative total distance (nm) from the planner's
   *  distance API. When supplied we rescale the integrator output so
   *  `calmEtaH` / `adjustedEtaH` match the planner's reported total,
   *  not a slightly-off polyline-haversine sum. */
  expectedTotalDistanceNm?: number;
}

export interface UseWeatherAdjustedEtaResult {
  /** Null until the first compute completes. */
  data: VoyageEtaResult | null;
  /** Delta in hours: adjusted - calm. Positive = later than planner says. */
  delayH: number | null;
  /** True while an async compute is in flight. */
  loading: boolean;
  /** Non-null if compute errored (shown as a subtle failure note). */
  error: string | null;
}

const DEFAULT_SHIP: ShipParams = {
  type: "tanker",
  dwt: 45000,
  loa: 183,
  loadingState: "loaded",
  serviceSpeedKn: 12,
};

export function useWeatherAdjustedEta({
  route,
  startTime,
  ship,
  commandedSpeedKn,
  weatherProvider,
  enabled = true,
  expectedTotalDistanceNm,
}: UseWeatherAdjustedEtaArgs): UseWeatherAdjustedEtaResult {
  const [state, setState] = useState<UseWeatherAdjustedEtaResult>({
    data: null,
    delayH: null,
    loading: false,
    error: null,
  });

  // Used to ignore stale completions — if the operator tweaks speed
  // while an earlier compute is still decoding frames, we drop the
  // older result when the newer one lands.
  const runIdRef = useRef(0);

  // Stable dependency signature. The caller's `route`, `startTime`, and
  // `ship` are almost always FRESH REFERENCES on every render — the
  // Fleet page derives `selectedVessel` via `vessels.find(...)` on a
  // freshly-built `vessels` array, so `useMemo`s downstream of it are
  // not stable either. Referencing those objects directly in the effect
  // deps would loop: setState(loading=true) → re-render → new refs →
  // effect fires → setState again. Collapsing them into a primitive
  // key means the effect only re-runs when the underlying VALUES
  // actually change.
  //
  // We hash route endpoints + length (not every waypoint — the planner
  // route is deterministic for given ports, so endpoint drift implies
  // a genuine route change).
  const depsKey = useMemo(() => {
    if (
      !enabled ||
      route === null ||
      route.length < 2 ||
      commandedSpeedKn <= 0
    ) {
      return "disabled";
    }
    const first = route[0];
    const last = route[route.length - 1];
    const s = ship ?? DEFAULT_SHIP;
    return [
      "active",
      first[0].toFixed(4),
      first[1].toFixed(4),
      last[0].toFixed(4),
      last[1].toFixed(4),
      route.length,
      startTime.getTime(),
      s.type,
      s.dwt,
      s.loa,
      s.beam ?? "",
      s.loadingState,
      s.serviceSpeedKn,
      commandedSpeedKn,
      // Distance normalisation target. Two voyages with identical
      // polylines but different planner-reported totals (e.g. the
      // planner re-routed via a channel chain) should re-run so the
      // normalised calmEtaH reflects the new total.
      expectedTotalDistanceNm ?? "",
    ].join("|");
  }, [enabled, route, startTime, ship, commandedSpeedKn, expectedTotalDistanceNm]);

  // Hold the latest props in a ref so the effect body can read them
  // without adding them to the dep array (they're already factored
  // into `depsKey`).
  const latestArgsRef = useRef({
    route,
    startTime,
    ship,
    commandedSpeedKn,
    weatherProvider,
    expectedTotalDistanceNm,
  });
  latestArgsRef.current = {
    route,
    startTime,
    ship,
    commandedSpeedKn,
    weatherProvider,
    expectedTotalDistanceNm,
  };

  useEffect(() => {
    if (depsKey === "disabled") {
      setState({ data: null, delayH: null, loading: false, error: null });
      return;
    }

    const {
      route: curRoute,
      startTime: curStart,
      ship: curShip,
      commandedSpeedKn: curSpeed,
      weatherProvider: curProvider,
      expectedTotalDistanceNm: curExpected,
    } = latestArgsRef.current;
    // Should be impossible given depsKey != "disabled", but narrow for TS.
    if (curRoute === null || curRoute.length < 2) return;

    const myRunId = ++runIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const sampler = createForecastSampler(curProvider);
    integrateVoyage({
      route: curRoute,
      startTime: curStart,
      ship: curShip ?? DEFAULT_SHIP,
      commandedSpeedKn: curSpeed,
      weather: sampler,
      expectedTotalDistanceNm: curExpected,
    })
      .then((data) => {
        if (runIdRef.current !== myRunId) return;
        setState({
          data,
          delayH: data.adjustedEtaH - data.calmEtaH,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (runIdRef.current !== myRunId) return;
        console.error("[kwon-eta]", err);
        setState({
          data: null,
          delayH: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [depsKey]);

  return state;
}
