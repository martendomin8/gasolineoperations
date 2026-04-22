/**
 * Tests for the V1 great-circle route oracle.
 *
 * The oracle is the `routePredict` implementation that the position
 * resolver calls in its PREDICTED branch. We lock down the key
 * behaviours so future route-graph upgrades keep the contract.
 */

import { describe, it, expect } from "vitest";
import { predictGreatCircle } from "@/lib/maritime/ais/route-oracle";

const SINCE = new Date("2026-04-22T00:00:00Z");

describe("predictGreatCircle", () => {
  it("returns anchor point when elapsed <= 0", () => {
    const out = predictGreatCircle({
      fromLat: 52, fromLon: 4,
      toLat: 40, toLon: -70,
      since: SINCE,
      cpSpeedKn: 14,
      at: SINCE, // same moment
    });
    expect(out?.lat).toBe(52);
    expect(out?.lon).toBe(4);
  });

  it("returns destination when sailed >= total", () => {
    // 1 day at 14 kn = 336 nm, but GC distance < 336 for a 1-degree
    // separation — vessel would have arrived.
    const at = new Date(SINCE.getTime() + 24 * 3_600_000);
    const out = predictGreatCircle({
      fromLat: 52, fromLon: 4,
      toLat: 52.1, toLon: 4.1,  // ~7 nm away
      since: SINCE,
      cpSpeedKn: 14,
      at,
    });
    expect(out?.lat).toBeCloseTo(52.1, 5);
    expect(out?.lon).toBeCloseTo(4.1, 5);
  });

  it("interpolates a reasonable midway position", () => {
    // 10h at 12 kn = 120 nm. From (0,0) due east (bearing 90° on
    // equator) → should be roughly at (0, 2°) since 1° longitude at
    // equator is 60 nm.
    const at = new Date(SINCE.getTime() + 10 * 3_600_000);
    const out = predictGreatCircle({
      fromLat: 0, fromLon: 0,
      toLat: 0, toLon: 10,
      since: SINCE,
      cpSpeedKn: 12,
      at,
    });
    expect(out?.lat).toBeCloseTo(0, 2);
    expect(out?.lon).toBeCloseTo(2, 1);
    expect(out?.bearingDeg).toBeCloseTo(90, 0);
  });

  it("returns destination when from == to", () => {
    const out = predictGreatCircle({
      fromLat: 52, fromLon: 4,
      toLat: 52, toLon: 4,
      since: SINCE,
      cpSpeedKn: 12,
      at: new Date(SINCE.getTime() + 3_600_000),
    });
    expect(out?.lat).toBe(52);
    expect(out?.lon).toBe(4);
  });
});
