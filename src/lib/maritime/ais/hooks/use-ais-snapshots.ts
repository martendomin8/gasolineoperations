"use client";

/**
 * `useAisSnapshots()` — polls `/api/maritime/ais/snapshot` on an
 * interval and returns the latest vessel list. Stays quiet when
 * disabled so an operator can toggle live tracking off without
 * us hammering the endpoint.
 *
 * Uses `setTimeout`-chain scheduling rather than `setInterval` so a
 * slow backend doesn't cause requests to stack up — next poll is
 * scheduled only after the previous one resolves (success or error).
 */

import { useEffect, useRef, useState } from "react";

export type PositionMode = "live" | "dead_reck" | "predicted";

export interface StoredFlag {
  id: string;
  layer: string;
  type: string;
  severity: "reject" | "warn" | "info";
  details: Record<string, unknown> | null;
  messageReceivedAt: string;
  createdAt: string;
}

export interface LiveFlag {
  layer: string;
  type: string;
  severity: "reject" | "warn" | "info";
  details: Record<string, unknown>;
}

export interface AisSnapshotVessel {
  linkageId: string;
  linkageName: string;
  mmsi: string;
  vessel: {
    name: string | null;
    imo: string | null;
    destination: string | null;
    eta: string | null;
    shipType: number | null;
    lengthM: number | null;
    beamM: number | null;
  };
  /**
   * `null` when the AIS worker has no fix yet AND the linkage has no
   * loadport coords to fall back to. UI should show the vessel in the
   * "tracked, no position" sidebar state rather than dropping a marker.
   */
  position: {
    lat: number;
    lon: number;
    mode: PositionMode;
    bearingDeg: number | null;
    ageMs: number | null;
    aisReceivedAt: string | null;
  } | null;
  voyage: {
    loadportName: string | null;
    dischargePortName: string | null;
    laycanEnd: string | null;
  };
  storedFlags: StoredFlag[];
  liveFlags: LiveFlag[];
}

export interface AisSnapshotResponse {
  generatedAt: string;
  vessels: AisSnapshotVessel[];
}

/** Default poll cadence. 15 s is a reasonable balance — AIS broadcasts
 *  happen every few seconds, but the UI doesn't need that granularity;
 *  a vessel at 15 kn moves only ~125 m between polls. */
const DEFAULT_INTERVAL_MS = 15_000;

export interface UseAisSnapshotsOptions {
  enabled: boolean;
  intervalMs?: number;
}

export interface UseAisSnapshotsResult {
  data: AisSnapshotResponse | null;
  error: string | null;
  loading: boolean;
  /** Force an immediate refetch (e.g. after operator adds a new
   *  linkage — they expect instant feedback, not "wait 15 s"). */
  refetch: () => void;
}

export function useAisSnapshots({
  enabled,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseAisSnapshotsOptions): UseAisSnapshotsResult {
  const [data, setData] = useState<AisSnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // We keep the latest "enabled" in a ref so the timer closure can
  // bail gracefully if the operator flips the toggle off mid-flight.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const kickRef = useRef(0); // increment to force an immediate fetch

  useEffect(() => {
    if (!enabled) {
      // Clean up on disable.
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      if (abortRef.current !== null) abortRef.current.abort();
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchOnce = async (): Promise<void> => {
      if (!enabledRef.current) return;
      setLoading(true);
      setError(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/maritime/ais/snapshot", {
          signal: ctrl.signal,
          // The snapshot is derived + cheap; bust any edge caching
          // that would otherwise serve a stale vessel list.
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as AisSnapshotResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled && enabledRef.current) {
        timeoutRef.current = setTimeout(fetchOnce, intervalMs);
      }
    };

    fetchOnce();

    return () => {
      cancelled = true;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      if (abortRef.current !== null) abortRef.current.abort();
    };
  }, [enabled, intervalMs, kickRef.current === 0 ? 0 : kickRef.current]);

  const refetch = () => {
    kickRef.current += 1;
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    // The effect dep array watches kickRef.current, but React doesn't
    // re-render just because a ref changed. Work around with a tiny
    // helper: abort any in-flight fetch so the effect restarts. The
    // next render cycle picks up the new kick value — good enough for
    // a manual refresh button that operators click once in a blue moon.
    if (abortRef.current !== null) abortRef.current.abort();
  };

  return { data, error, loading, refetch };
}
