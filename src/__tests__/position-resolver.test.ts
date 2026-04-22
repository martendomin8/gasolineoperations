/**
 * Tests for `resolvePosition()` — the hybrid LIVE / DEAD_RECK / PREDICTED
 * selector at the heart of the AIS live-tracking feature.
 *
 * The resolver is pure, so every branch is deterministic:
 *   - LIVE         → AIS fix younger than 10 min
 *   - DEAD_RECK    → AIS fix 10 min – 2 h old, extrapolate cog/sog
 *   - PREDICTED    → AIS fix > 2 h old, or never, use route oracle
 *
 * These tests lock down the branch selection and the great-circle
 * extrapolation math so refactors can't silently shift the windows.
 */

import { describe, it, expect } from "vitest";
import {
  resolvePosition,
  LIVE_WINDOW_MS,
  DEAD_RECK_WINDOW_MS,
  DEFAULT_CP_SPEED_KN,
  formatAisAge,
  modeBadge,
  _test,
  type VoyagePlan,
} from "@/lib/maritime/ais/position-resolver";
import { NavStatus, type VesselPosition } from "@/lib/maritime/ais/types";

// ---- Fixtures ----------------------------------------------------

const NOW = new Date("2026-04-21T12:00:00Z");
const ROTTERDAM: [number, number] = [51.95, 4.14];   // loadport
const NEW_YORK: [number, number] = [40.67, -74.04];  // discharge

/** Build a VesselPosition with sane defaults. */
function fix(
  overrides: Partial<VesselPosition> & Pick<VesselPosition, "receivedAt">,
): VesselPosition {
  return {
    mmsi: 257964900,
    lat: 51.95,
    lon: 4.14,
    cog: 270,   // heading west
    sog: 12,    // knots
    heading: 270,
    navStatus: NavStatus.UnderwayUsingEngine,
    ...overrides,
  };
}

/** Minimal voyage plan with a stub route oracle. */
function voyage(overrides: Partial<VoyagePlan> = {}): VoyagePlan {
  return { ...buildVoyage(), ...overrides };
}

function buildVoyage(): VoyagePlan {
  return {
    loadportLat: ROTTERDAM[0],
    loadportLon: ROTTERDAM[1],
    dischargeLat: NEW_YORK[0],
    dischargeLon: NEW_YORK[1],
    cpSpeedKn: 14,
    voyageStart: new Date("2026-04-20T00:00:00Z"),
    routePredict: stubRoutePredict,
  };
}

/** A predictable route oracle — returns a fixed point regardless of inputs. */
const stubRoutePredict: NonNullable<VoyagePlan["routePredict"]> = () => ({
  lat: 45.0,
  lon: -35.0,
  bearingDeg: 260,
});

// ---- Branch 1: no AIS ever ---------------------------------------

describe("resolvePosition — no AIS history", () => {
  // Without AIS we plant at loadport — resolver does not call the route
  // oracle, no matter what voyage context is available. See the
  // comment on branch 1 in `position-resolver.ts` for the reasoning
  // (laycanStart ≠ actual departure).
  it("plants marker at loadport when no AIS ever", () => {
    const out = resolvePosition({ lastAis: null, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("predicted");
    expect(out.lat).toBe(ROTTERDAM[0]);
    expect(out.lon).toBe(ROTTERDAM[1]);
    expect(out.ageMs).toBe(Infinity);
    expect(out.aisReceivedAt).toBe(null);
  });

  it("does NOT call the route oracle when no AIS history", () => {
    let oracleCalled = false;
    resolvePosition({
      lastAis: null,
      now: NOW,
      voyage: voyage({
        routePredict: () => {
          oracleCalled = true;
          return { lat: 45.0, lon: -35.0, bearingDeg: 260 };
        },
      }),
    });
    expect(oracleCalled).toBe(false);
  });

  it("plants at loadport even with no route oracle / discharge", () => {
    const out = resolvePosition({
      lastAis: null,
      now: NOW,
      voyage: voyage({
        routePredict: null,
        dischargeLat: null,
        dischargeLon: null,
      }),
    });
    expect(out.mode).toBe("predicted");
    expect(out.lat).toBe(ROTTERDAM[0]);
    expect(out.lon).toBe(ROTTERDAM[1]);
  });
});

// ---- Branch 2: LIVE ---------------------------------------------

describe("resolvePosition — LIVE window", () => {
  it("returns the AIS fix verbatim when < 10 min old", () => {
    const receivedAt = new Date(NOW.getTime() - 5 * 60 * 1000);
    const ais = fix({ lat: 52.1, lon: 3.9, receivedAt });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("live");
    expect(out.lat).toBe(52.1);
    expect(out.lon).toBe(3.9);
    expect(out.ageMs).toBe(5 * 60 * 1000);
  });

  it("prefers heading over cog for bearing", () => {
    const ais = fix({
      receivedAt: new Date(NOW.getTime() - 30_000),
      cog: 180,
      heading: 275,
    });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.bearingDeg).toBe(275);
  });

  it("edge: exactly at LIVE_WINDOW_MS still counts as dead-reck (< not <=)", () => {
    const ais = fix({ receivedAt: new Date(NOW.getTime() - LIVE_WINDOW_MS) });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("dead_reck");
  });
});

// ---- Branch 3: DEAD RECKONING -----------------------------------

describe("resolvePosition — DEAD_RECK window", () => {
  it("extrapolates from AIS along cog at sog", () => {
    // 1 hour gap, vessel steaming due west (cog 270) at 12 knots.
    // Expected forward travel: 12 nm westward from starting point.
    const receivedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const ais = fix({ lat: 51.95, lon: 4.14, cog: 270, sog: 12, receivedAt });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("dead_reck");
    // At lat ~52°, 1 nm longitude ≈ 0.027°. 12 nm westward → ~0.32° west.
    expect(out.lon).toBeLessThan(ais.lon);
    expect(ais.lon - out.lon).toBeCloseTo(0.324, 1);
    // Latitude should barely change on a due-west heading.
    expect(out.lat).toBeCloseTo(ais.lat, 3);
  });

  it("stays put when sog is zero (at anchor)", () => {
    const receivedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const ais = fix({ sog: 0, receivedAt });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("dead_reck");
    expect(out.lat).toBe(ais.lat);
    expect(out.lon).toBe(ais.lon);
  });

  it("edge: exactly at DEAD_RECK_WINDOW_MS flips to predicted", () => {
    const ais = fix({ receivedAt: new Date(NOW.getTime() - DEAD_RECK_WINDOW_MS) });
    const out = resolvePosition({ lastAis: ais, now: NOW, voyage: voyage() });
    expect(out.mode).toBe("predicted");
  });
});

// ---- Branch 4: PREDICTED from last AIS ---------------------------

describe("resolvePosition — PREDICTED from last AIS anchor", () => {
  it("calls routePredict with last AIS as the anchor, not loadport", () => {
    const receivedAt = new Date(NOW.getTime() - 3 * 60 * 60 * 1000); // 3 h ago
    const ais = fix({ lat: 48.0, lon: -10.0, receivedAt });
    let captured: {
      fromLat: number;
      fromLon: number;
      since: Date;
      cpSpeedKn: number;
    } | null = null;
    const out = resolvePosition({
      lastAis: ais,
      now: NOW,
      voyage: voyage({
        routePredict: (args) => {
          captured = args;
          return { lat: 46.0, lon: -20.0, bearingDeg: 265 };
        },
      }),
    });
    expect(out.mode).toBe("predicted");
    expect(captured).not.toBeNull();
    expect(captured!.fromLat).toBe(48.0);
    expect(captured!.fromLon).toBe(-10.0);
    expect(captured!.since).toEqual(receivedAt);
    expect(captured!.cpSpeedKn).toBe(14);
  });

  it("uses DEFAULT_CP_SPEED_KN when cpSpeedKn is null", () => {
    const ais = fix({ receivedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) });
    let capturedSpeed = -1;
    resolvePosition({
      lastAis: ais,
      now: NOW,
      voyage: voyage({
        cpSpeedKn: null,
        routePredict: (args) => {
          capturedSpeed = args.cpSpeedKn;
          return { lat: 45.0, lon: -35.0, bearingDeg: 260 };
        },
      }),
    });
    expect(capturedSpeed).toBe(DEFAULT_CP_SPEED_KN);
  });

  it("plants marker at last AIS when routePredict returns null", () => {
    const ais = fix({
      lat: 49.5,
      lon: -15.0,
      receivedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    });
    const out = resolvePosition({
      lastAis: ais,
      now: NOW,
      voyage: voyage({ routePredict: () => null }),
    });
    expect(out.mode).toBe("predicted");
    expect(out.lat).toBe(49.5);
    expect(out.lon).toBe(-15.0);
  });
});

// ---- Great-circle math -----------------------------------------

describe("greatCircleForward", () => {
  it("travels roughly north-south with correct distance at equator", () => {
    // From (0, 0) due north 60 nm → should land near (1°, 0°) (60 nm ≈ 1°).
    const out = _test.greatCircleForward(0, 0, 0, 60);
    expect(out.lat).toBeCloseTo(1.0, 1);
    expect(out.lon).toBeCloseTo(0, 2);
  });

  it("wraps longitude correctly when crossing antimeridian", () => {
    // From (0, 179) heading east 120 nm → should wrap to ~(0, -179).
    const out = _test.greatCircleForward(0, 179, 90, 120);
    expect(out.lon).toBeLessThan(0);
    expect(out.lon).toBeGreaterThan(-180);
  });
});

// ---- UI helpers -----------------------------------------------

describe("formatAisAge", () => {
  it.each([
    [Infinity, "never"],
    [5_000, "5s ago"],
    [3 * 60_000, "3m ago"],
    [2 * 3_600_000, "2h ago"],
    [2 * 3_600_000 + 12 * 60_000, "2h 12m ago"],
    [3 * 86_400_000, "3d ago"],
  ])("formats %ims as '%s'", (ms, expected) => {
    expect(formatAisAge(ms)).toBe(expected);
  });
});

describe("modeBadge", () => {
  it("returns expected labels", () => {
    expect(modeBadge("live")).toBe("LIVE");
    expect(modeBadge("dead_reck")).toBe("LAST KNOWN");
    expect(modeBadge("predicted")).toBe("PREDICTED");
  });
});
