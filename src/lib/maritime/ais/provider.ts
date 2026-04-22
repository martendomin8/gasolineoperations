/**
 * Abstract `AisProvider` interface.
 *
 * Every concrete implementation (AISStream WebSocket, MarineTraffic REST,
 * a mock test provider) implements this same surface so the Fleet UI
 * never knows which one it's talking to. Choice is made at bootstrap
 * via `useAisProvider()`, driven by `NEXT_PUBLIC_AIS_PROVIDER`.
 *
 * Same pattern as `WeatherProvider` and `parseRecap()` — swappable
 * backend, single UI, per-deployment choice.
 *
 * The UI consumes this interface; it does NOT talk to the ingest worker
 * directly. The worker writes into Postgres; providers read from there
 * (aisstream) or from a live API (marinetraffic).
 */

import type {
  AisSubscription,
  MMSI,
  VesselPosition,
  VesselSnapshot,
  VesselStatic,
} from "./types";

export interface AisProvider {
  /** Name shown in diagnostics / admin — e.g. "aisstream", "marinetraffic". */
  readonly name: string;

  /**
   * Latest known snapshot per vessel in the subscription. Typically one
   * row per MMSI. Used by the Fleet map's `Live AIS` layer to draw markers.
   */
  getSnapshots(sub: AisSubscription): Promise<VesselSnapshot[]>;

  /**
   * Fetch static particulars (name, IMO, dimensions) for a single MMSI.
   * Returns null if the provider has never seen this vessel.
   */
  getStatic(mmsi: MMSI): Promise<VesselStatic | null>;

  /**
   * Historical track for a vessel over a time window. Used by the
   * optional track-replay feature (V2 — not MVP). Providers may cap
   * the number of points returned; see implementation notes.
   */
  getTrack(mmsi: MMSI, from: Date, to: Date): Promise<VesselPosition[]>;
}
