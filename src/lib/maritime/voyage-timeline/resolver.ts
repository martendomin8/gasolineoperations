// Voyage timeline resolver — turns a linkage's deal list into an ordered
// sequence of port events with arrival / departure timestamps, port-stay
// durations, and implied-speed warnings. Pure function; no DB or fetch
// access. Caller passes a distance lookup so the resolver stays sync.
//
// Design follows feature_ets_ats_sailing_time.md:
//   - Each deal contributes one port stop (loadport for buys, dischargePort
//     for sells). The same-port-consecutive rule collapses adjacent stops at
//     the same port (e.g. two BUY deals both at Bayonne) into a single
//     event with summed quantity.
//   - Port-stay duration scales with cargo: max(MIN_BERTH_SETUP_HOURS,
//     qty / port-rate). LOAD_RATE_MT_PER_HOUR for buys, DISCHARGE_RATE for
//     sells.
//   - Auto-fill cascade: when arrivalAt is missing on a port, infer from
//     previous port's departure + sailing time at cpSpeedKn. Inferred
//     values aren't persisted — they recompute on every render.
//   - Implied speed: when the operator overrides a downstream arrival
//     (e.g. types a manual disport ETA), the resolver back-computes the
//     speed needed to make the leg. Anything > UNREALISTIC_SPEED_KN gets
//     flagged for the UI to render in red.

import {
  LOAD_RATE_MT_PER_HOUR,
  DISCHARGE_RATE_MT_PER_HOUR,
  BERTH_SETUP_HOURS,
  UNREALISTIC_SPEED_KN,
} from "./constants";

export type PortRole = "load" | "discharge";

export interface VoyageDealInput {
  id: string;
  direction: "buy" | "sell";
  port: string;
  /** MT total for this deal (sum of parcels for multi-parcel). */
  quantityMt: number;
  /** Operator-set ETA / ATA at this port. Null for "not yet entered". */
  arrivalAt: Date | null;
  /** True when the operator confirmed actual arrival; visual flag only. */
  arrivalIsActual: boolean;
  /** Manual ETS pin. Null falls back to arrivalAt + portStay. */
  departureOverride: Date | null;
}

export type EventSource = "manual" | "inferred" | null;

export interface ResolvedPort {
  /** Canonical port name (after dedup). */
  port: string;
  role: PortRole;
  /** All deals contributing to this port stop (≥1, >1 only when same-port collapse). */
  dealIds: string[];
  /** Combined cargo at this stop. Drives port-stay math. */
  totalQuantityMt: number;
  /** True when ANY contributing deal has arrivalIsActual=true. */
  arrivalIsActual: boolean;

  arrivalAt: Date | null;
  arrivalSource: EventSource;
  departureAt: Date | null;
  departureSource: EventSource;
  /** Port-stay duration in hours used to derive departure when not overridden. */
  portStayHours: number;

  /** NM from the previous port (null at index 0 or when distance unknown). */
  legDistanceNm: number | null;
  /**
   * Speed in knots implied by the gap between previous departure and this
   * arrival, when both are non-inferred (i.e. one of them is a manual
   * override). Null when the gap is purely inferred from cpSpeed.
   */
  impliedSpeedKn: number | null;
  /** True when impliedSpeedKn > UNREALISTIC_SPEED_KN. */
  unrealisticSpeed: boolean;
}

export interface ResolveOpts {
  buyDeals: VoyageDealInput[];
  sellDeals: VoyageDealInput[];
  cpSpeedKn: number;
  /**
   * NM between two ports. Caller supplies. May return null for unknown
   * pairs — resolver then can't auto-fill subsequent arrivals from this
   * leg, but won't throw. Distance is treated as static (operator can't
   * make the vessel longer or shorter).
   */
  getDistanceNm: (a: string, b: string) => number | null;
}

const HOURS_PER_MS = 1 / 3_600_000;

/**
 * Drive the timeline. Walks the buys then sells in order, dedups adjacent
 * same-port deals, then runs three passes: (1) compute port-stay durations
 * from quantity, (2) forward-fill missing arrivals/departures from previous
 * stop + cpSpeed, (3) compute implied-speed warnings on manual overrides.
 *
 * Always returns a result — no throws — so the UI can render even when the
 * operator hasn't entered any timestamps yet.
 */
export function resolveVoyageTimeline(opts: ResolveOpts): ResolvedPort[] {
  const stops = collapseSamePort([
    ...opts.buyDeals.map((d) => ({ ...d, role: "load" as const })),
    ...opts.sellDeals.map((d) => ({ ...d, role: "discharge" as const })),
  ]);

  if (stops.length === 0) return [];

  // Pass 1 — port stays from quantity. Berth setup is ADDITIVE, not a
  // floor: every port call carries the same NOR + mooring + sample + BL
  // overhead regardless of cargo size, and pumping time stacks on top.
  for (const s of stops) {
    const rate = s.role === "load" ? LOAD_RATE_MT_PER_HOUR : DISCHARGE_RATE_MT_PER_HOUR;
    s.portStayHours = BERTH_SETUP_HOURS + s.totalQuantityMt / rate;
  }

  // Pass 2 — leg distances.
  for (let i = 0; i < stops.length; i++) {
    if (i === 0) {
      stops[i].legDistanceNm = null;
      continue;
    }
    stops[i].legDistanceNm = opts.getDistanceNm(stops[i - 1].port, stops[i].port);
  }

  // Pass 3 — forward-fill arrival/departure cascade.
  for (let i = 0; i < stops.length; i++) {
    const cur = stops[i];

    // Departure derives from arrival + portStay unless operator pinned it.
    const finishDeparture = () => {
      if (cur.departureAt !== null) return; // already set by override
      if (cur.arrivalAt !== null) {
        cur.departureAt = addHours(cur.arrivalAt, cur.portStayHours);
        cur.departureSource = cur.arrivalSource ?? "inferred";
      }
    };

    if (i === 0) {
      // First port: arrival must be operator-supplied (or stays null).
      finishDeparture();
      continue;
    }

    const prev = stops[i - 1];
    if (cur.arrivalAt === null && prev.departureAt !== null && cur.legDistanceNm !== null) {
      const sailHours = cur.legDistanceNm / opts.cpSpeedKn;
      cur.arrivalAt = addHours(prev.departureAt, sailHours);
      cur.arrivalSource = "inferred";
    }
    finishDeparture();
  }

  // Pass 4 — implied speed on legs where any endpoint is manual.
  for (let i = 1; i < stops.length; i++) {
    const cur = stops[i];
    const prev = stops[i - 1];
    if (
      prev.departureAt !== null &&
      cur.arrivalAt !== null &&
      cur.legDistanceNm !== null
    ) {
      const sailHours = (cur.arrivalAt.getTime() - prev.departureAt.getTime()) * HOURS_PER_MS;
      // Only meaningful if at least one endpoint is operator-supplied.
      const hasManual =
        prev.departureSource === "manual" ||
        prev.arrivalSource === "manual" ||
        cur.arrivalSource === "manual";
      if (hasManual && sailHours > 0) {
        cur.impliedSpeedKn = cur.legDistanceNm / sailHours;
        cur.unrealisticSpeed = cur.impliedSpeedKn > UNREALISTIC_SPEED_KN;
      }
    }
  }

  // Pass 5 — refresh portStayHours to reflect the *actual* arrival→departure
  // gap once both endpoints are known. Pass 1 seeded a quantity-based
  // estimate so the cascade had something to add when computing inferred
  // departures; that estimate becomes wrong (and confusing) the moment the
  // operator pins a manual ETS that doesn't match qty/rate. Recomputing
  // here keeps the "X.Xh stay" UI label honest.
  for (const s of stops) {
    if (s.arrivalAt !== null && s.departureAt !== null) {
      const gapHours = (s.departureAt.getTime() - s.arrivalAt.getTime()) * HOURS_PER_MS;
      if (gapHours > 0) s.portStayHours = gapHours;
    }
  }

  return stops;
}

// ── Helpers ───────────────────────────────────────────────────

function collapseSamePort(
  inputs: Array<VoyageDealInput & { role: PortRole }>
): ResolvedPort[] {
  const stops: ResolvedPort[] = [];
  for (const d of inputs) {
    const last = stops[stops.length - 1];
    if (last && last.role === d.role && portKey(last.port) === portKey(d.port)) {
      // Same port consecutive — merge.
      last.dealIds.push(d.id);
      last.totalQuantityMt += d.quantityMt;
      // Earliest non-null arrival wins (operator's first entry).
      if (last.arrivalAt === null && d.arrivalAt !== null) {
        last.arrivalAt = d.arrivalAt;
        last.arrivalSource = "manual";
      }
      if (d.arrivalIsActual) last.arrivalIsActual = true;
      if (last.departureAt === null && d.departureOverride !== null) {
        last.departureAt = d.departureOverride;
        last.departureSource = "manual";
      }
      continue;
    }
    stops.push({
      port: d.port,
      role: d.role,
      dealIds: [d.id],
      totalQuantityMt: d.quantityMt,
      arrivalIsActual: d.arrivalIsActual,
      arrivalAt: d.arrivalAt,
      arrivalSource: d.arrivalAt !== null ? "manual" : null,
      departureAt: d.departureOverride,
      departureSource: d.departureOverride !== null ? "manual" : null,
      portStayHours: 0,
      legDistanceNm: null,
      impliedSpeedKn: null,
      unrealisticSpeed: false,
    });
  }
  return stops;
}

function portKey(port: string): string {
  return port.toUpperCase().split(/[,/;]/)[0].trim();
}

function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}
