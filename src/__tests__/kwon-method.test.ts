/**
 * Unit tests for the Kwon speed-loss calculator.
 *
 * Goals:
 *   - Lock in the Beaufort-to-CU lookup table (don't let refactors
 *     silently shift numbers).
 *   - Lock in the directional coefficient curve (head/beam/following).
 *   - Sanity-check the composite formula across realistic scenarios
 *     (tanker in Biscay storm, bulker in calm Med, container in ballast).
 *   - Verify ship-type classification from free-text Q88 strings.
 *
 * Tests are intentionally coarse — ± 1-2% tolerance on speed loss is
 * fine. Kwon itself isn't that accurate.
 */

import { describe, it, expect } from "vitest";
import {
  calculateSpeedLoss,
  cuForBeaufort,
  directionCoefficient,
  windSpeedToBeaufort,
} from "@/lib/maritime/eta-adjustment/kwon";
import {
  classifyShipType,
  getShipProfile,
} from "@/lib/maritime/eta-adjustment/ship-profiles";
import {
  climatologyAt,
  zoneFor,
} from "@/lib/maritime/eta-adjustment/climatology";
import type { KwonInput } from "@/lib/maritime/eta-adjustment/types";

// ---- Beaufort scale -----------------------------------------------

describe("windSpeedToBeaufort", () => {
  it.each([
    [0.5, 0],
    [2, 1],
    [5, 2],
    [8, 3],
    [14, 4],
    [20, 5],
    [25, 6],
    [32, 7],
    [38, 8],
    [45, 9],
    [50, 10],
    [60, 11],
    [80, 12],
  ])("%s kn → BN %s", (kn, expected) => {
    expect(windSpeedToBeaufort(kn)).toBe(expected);
  });
});

// ---- CU table -----------------------------------------------------

describe("cuForBeaufort", () => {
  it("returns 0 for calm-to-light winds (BN 0-2)", () => {
    expect(cuForBeaufort(0)).toBe(0);
    expect(cuForBeaufort(2)).toBe(0);
  });

  it("monotonically increases with BN", () => {
    for (let bn = 0; bn < 12; bn++) {
      expect(cuForBeaufort(bn + 1)).toBeGreaterThanOrEqual(cuForBeaufort(bn));
    }
  });

  it("returns extreme but bounded values at hurricane", () => {
    const cu12 = cuForBeaufort(12);
    expect(cu12).toBeGreaterThan(0.5);
    expect(cu12).toBeLessThan(1);
  });
});

// ---- Direction coefficient ----------------------------------------

describe("directionCoefficient", () => {
  it("peaks at head seas (0°)", () => {
    expect(directionCoefficient(0)).toBeCloseTo(1.0, 2);
  });

  it("falls to ~0.55 at beam (90°)", () => {
    expect(directionCoefficient(90)).toBeCloseTo(0.55, 1);
  });

  it("bottoms out at following seas (180°)", () => {
    expect(directionCoefficient(180)).toBeCloseTo(0, 2);
  });

  it("is symmetric — +45° and -45° yield same coefficient", () => {
    expect(directionCoefficient(45)).toBeCloseTo(
      directionCoefficient(-45),
      3,
    );
  });

  it("handles >360° input cleanly", () => {
    expect(directionCoefficient(360)).toBeCloseTo(
      directionCoefficient(0),
      3,
    );
  });
});

// ---- Ship profiles ------------------------------------------------

describe("ship profiles", () => {
  it("ballast always has higher coefficient than loaded", () => {
    const types = ["tanker", "bulker", "container", "lng", "general"] as const;
    for (const t of types) {
      expect(getShipProfile(t, "ballast").baselineCoefficient).toBeGreaterThan(
        getShipProfile(t, "loaded").baselineCoefficient,
      );
    }
  });

  it("LNG is fastest through weather, bulker slowest (among laden)", () => {
    const lng = getShipProfile("lng", "loaded").baselineCoefficient;
    const tanker = getShipProfile("tanker", "loaded").baselineCoefficient;
    const bulker = getShipProfile("bulker", "loaded").baselineCoefficient;
    expect(lng).toBeLessThan(tanker);
    expect(tanker).toBeLessThan(bulker);
  });
});

describe("classifyShipType", () => {
  it.each([
    ["MT Adiyaman", "tanker"],
    ["VLCC Crude Carrier", "tanker"],
    ["Chemical Tanker", "tanker"],
    ["Product Carrier", "tanker"],
    ["Bulk Carrier", "bulker"],
    ["Capesize Ore Carrier", "bulker"],
    ["Container Ship", "container"],
    ["Feeder Boxship", "container"],
    ["LNG Carrier", "lng"],
    ["LPG Gas Carrier", "lng"],
    ["General Cargo", "general"],
    [null, "general"],
    ["", "general"],
  ] as const)("classifies %s as %s", (input, expected) => {
    expect(classifyShipType(input)).toBe(expected);
  });
});

// ---- Full Kwon scenarios -----------------------------------------

function tanker(loaded: boolean, speedKn = 12): KwonInput["ship"] {
  return {
    type: "tanker",
    dwt: 45000,
    loa: 183,
    beam: 32,
    loadingState: loaded ? "loaded" : "ballast",
    serviceSpeedKn: speedKn,
  };
}

describe("calculateSpeedLoss — realistic scenarios", () => {
  it("calm weather → near-zero loss", () => {
    const r = calculateSpeedLoss({
      ship: tanker(true),
      state: { headingDeg: 0, commandedSpeedKn: 12 },
      weather: { windSpeedKn: 3, windDirDeg: 0, waveHeightM: 0.3, waveDirDeg: 0 },
    });
    expect(r.speedLossFraction).toBeLessThan(0.02);
    expect(r.effectiveSpeedKn).toBeCloseTo(12, 0);
  });

  // Convention reminder: `waveDirDeg` = where the waves are COMING
  // FROM (meteorological standard). Head seas means the ship is
  // pointed AT the wave source, so ship heading === waveDirDeg.

  it("Biscay winter storm, tanker laden into head seas", () => {
    // Ship heading east (90°), waves from east (90°) → head seas.
    const r = calculateSpeedLoss({
      ship: tanker(true),
      state: { headingDeg: 90, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 32,   // BN 7
        windDirDeg: 90,
        waveHeightM: 4.5,
        waveDirDeg: 90,    // head seas
      },
    });
    expect(r.speedLossFraction).toBeGreaterThan(0.10);
    expect(r.speedLossFraction).toBeLessThan(0.25);
    expect(r.beaufortNumber).toBe(7);
    expect(r.relativeWaveAngleDeg).toBeLessThan(5);
  });

  it("following seas — waves chasing from astern, much less loss", () => {
    // Ship heading west (270°), waves from east (90°) → waves behind.
    const r = calculateSpeedLoss({
      ship: tanker(true),
      state: { headingDeg: 270, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 32,
        windDirDeg: 90,
        waveHeightM: 4.5,
        waveDirDeg: 90,    // ship moves away from wave source → following
      },
    });
    expect(r.speedLossFraction).toBeLessThan(0.03);
    expect(r.relativeWaveAngleDeg).toBeGreaterThan(170);
  });

  it("beam seas — partial loss, somewhere between head and following", () => {
    // Ship heading north (0°), waves from east (90°) → beam seas.
    const r = calculateSpeedLoss({
      ship: tanker(true),
      state: { headingDeg: 0, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 32,
        windDirDeg: 90,
        waveHeightM: 4.5,
        waveDirDeg: 90,
      },
    });
    // Beam Cβ ≈ 0.55, CU(BN7)=0.16 → ~9% loss for loaded tanker
    expect(r.speedLossFraction).toBeGreaterThan(0.05);
    expect(r.speedLossFraction).toBeLessThan(0.12);
    expect(r.relativeWaveAngleDeg).toBeCloseTo(90, 0);
  });

  it("ballast tanker loses more than laden in same weather", () => {
    // Head seas (heading === waveDirDeg) so Cβ is maxed and any ship-
    // profile difference between loaded/ballast actually shows up.
    const heavy = {
      state: { headingDeg: 0, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 25,
        windDirDeg: 0,
        waveHeightM: 3,
        waveDirDeg: 0,
      },
    };
    const loadedLoss = calculateSpeedLoss({
      ship: tanker(true),
      ...heavy,
    }).speedLossFraction;
    const ballastLoss = calculateSpeedLoss({
      ship: tanker(false),
      ...heavy,
    }).speedLossFraction;
    expect(ballastLoss).toBeGreaterThan(loadedLoss);
  });

  it("hurricane head seas — clamped at 95%", () => {
    const r = calculateSpeedLoss({
      ship: { ...tanker(false), type: "bulker" },
      state: { headingDeg: 0, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 80,      // BN 12
        windDirDeg: 180,
        waveHeightM: 12,
        waveDirDeg: 180,
      },
    });
    expect(r.speedLossFraction).toBeLessThanOrEqual(0.95);
    expect(r.effectiveSpeedKn).toBeGreaterThanOrEqual(0.5);
  });

  it("note string contains direction and BN", () => {
    const r = calculateSpeedLoss({
      ship: tanker(true),
      state: { headingDeg: 270, commandedSpeedKn: 12 },
      weather: {
        windSpeedKn: 25,
        windDirDeg: 90,
        waveHeightM: 3,
        waveDirDeg: 90,
      },
    });
    expect(r.note).toContain("BN 6");
    expect(r.note).toMatch(/head|bow|beam|stern|following/);
  });
});

// ---- Climatology --------------------------------------------------

describe("climatology", () => {
  it("recognises Biscay", () => {
    expect(zoneFor(46, -6).code).toBe("biscay");
  });

  it("recognises Mediterranean", () => {
    expect(zoneFor(40, 15).code).toBe("mediterranean");
  });

  it("falls back to default_ocean when outside named zones", () => {
    // Southern Pacific — no specific zone
    expect(zoneFor(-40, -150).code).toBe("default_ocean");
  });

  it("Biscay is rougher in winter than summer", () => {
    const jan = climatologyAt(46, -6, new Date("2026-01-15"));
    const jul = climatologyAt(46, -6, new Date("2026-07-15"));
    expect(jan.waveHeightM).toBeGreaterThan(jul.waveHeightM);
    expect(jan.windSpeedKn).toBeGreaterThan(jul.windSpeedKn);
  });

  it("Med is calmer than North Atlantic in the same month", () => {
    const med = climatologyAt(40, 15, new Date("2026-01-15"));
    const nAtl = climatologyAt(50, -30, new Date("2026-01-15"));
    expect(med.waveHeightM).toBeLessThan(nAtl.waveHeightM);
  });
});
