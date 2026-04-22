/**
 * Tests for the AIS validation stack (Layers 1–5).
 *
 * Each layer is a pure function, so tests just pin down the expected
 * flags for representative inputs. The goal is to lock in thresholds
 * so refactors can't silently shift them — not to exhaustively fuzz
 * the math (we'd never ship).
 */

import { describe, it, expect } from "vitest";
import { checkSanity } from "@/lib/maritime/ais/validation/sanity";
import { checkTemporal, haversineNm } from "@/lib/maritime/ais/validation/temporal";
import { checkIdentity, namesMatch } from "@/lib/maritime/ais/validation/identity";
import { checkAnomaly } from "@/lib/maritime/ais/validation/anomaly";
import {
  checkBusiness,
  crossTrackDistanceNm,
} from "@/lib/maritime/ais/validation/business-rules";
import {
  SANCTIONED_ZONES,
  zoneContaining,
} from "@/lib/maritime/ais/validation/zones";
import { validateMessage } from "@/lib/maritime/ais/validation";
import { NavStatus } from "@/lib/maritime/ais/types";
import { toFlagRow } from "@/lib/maritime/ais/validation/audit";

const NOW = new Date("2026-04-22T12:00:00Z");

// ==================================================================
// Layer 1 — Sanity
// ==================================================================

describe("checkSanity", () => {
  it("accepts a normal position with no flags", () => {
    const flags = checkSanity({
      lat: 51.9, lon: 4.1, sog: 12, cog: 90, receivedAt: NOW,
    });
    expect(flags).toHaveLength(0);
  });

  it("rejects null island", () => {
    const flags = checkSanity({
      lat: 0, lon: 0, sog: 0, cog: null, receivedAt: NOW,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("null_island");
    expect(flags[0].severity).toBe("reject");
  });

  it("rejects lat out of range", () => {
    const flags = checkSanity({
      lat: 91.5, lon: 4.1, sog: 12, cog: null, receivedAt: NOW,
    });
    expect(flags.map((f) => f.type)).toContain("lat_out_of_range");
  });

  it("rejects lon out of range", () => {
    const flags = checkSanity({
      lat: 51.9, lon: -200, sog: 12, cog: null, receivedAt: NOW,
    });
    expect(flags.map((f) => f.type)).toContain("lon_out_of_range");
  });

  it("rejects impossible speed", () => {
    const flags = checkSanity({
      lat: 51.9, lon: 4.1, sog: 87, cog: null, receivedAt: NOW,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("sog_impossible");
    expect(flags[0].severity).toBe("reject");
  });

  it("rejects negative speed", () => {
    const flags = checkSanity({
      lat: 51.9, lon: 4.1, sog: -1, cog: null, receivedAt: NOW,
    });
    expect(flags[0].type).toBe("sog_negative");
  });

  it("warns (not rejects) cog out of range", () => {
    const flags = checkSanity({
      lat: 51.9, lon: 4.1, sog: 12, cog: 400, receivedAt: NOW,
    });
    expect(flags[0].type).toBe("cog_out_of_range");
    expect(flags[0].severity).toBe("warn");
  });

  it("can raise multiple flags for one message", () => {
    const flags = checkSanity({
      lat: 91, lon: -200, sog: 99, cog: null, receivedAt: NOW,
    });
    expect(flags.map((f) => f.type).sort()).toEqual([
      "lat_out_of_range",
      "lon_out_of_range",
      "sog_impossible",
    ]);
  });
});

// ==================================================================
// Layer 2 — Temporal
// ==================================================================

describe("checkTemporal", () => {
  const baseCurrent = {
    lat: 55.0, lon: 15.0, sog: 12, navStatus: null, receivedAt: NOW,
  };
  const basePrior = {
    lat: 54.95, lon: 14.95, sog: 12, receivedAt: new Date(NOW.getTime() - 60_000),
  };

  it("accepts a plausible position change", () => {
    const flags = checkTemporal({ current: baseCurrent, prior: basePrior });
    expect(flags).toHaveLength(0);
  });

  it("rejects teleports (> 50 kn apparent speed)", () => {
    const prior = {
      lat: 0, lon: 0, sog: 12,
      receivedAt: new Date(NOW.getTime() - 60_000), // 1 minute ago
    };
    // Current position ~10000 km away = ~5400 nm in 1 min = wildly teleporty.
    const flags = checkTemporal({
      current: { ...baseCurrent, lat: 60, lon: 100 },
      prior,
    });
    expect(flags[0].type).toBe("teleport");
    expect(flags[0].severity).toBe("reject");
  });

  it("warns on speed jump > 15 kn within 60s", () => {
    const flags = checkTemporal({
      current: { ...baseCurrent, sog: 12 },
      prior: {
        lat: 54.95, lon: 14.95, sog: 28,
        receivedAt: new Date(NOW.getTime() - 30_000),
      },
    });
    expect(flags.some((f) => f.type === "speed_jump")).toBe(true);
  });

  it("does not flag speed jump outside the 60s window", () => {
    const flags = checkTemporal({
      current: { ...baseCurrent, sog: 12 },
      prior: {
        lat: 54.95, lon: 14.95, sog: 28,
        receivedAt: new Date(NOW.getTime() - 5 * 60_000),
      },
    });
    expect(flags.some((f) => f.type === "speed_jump")).toBe(false);
  });

  it("flags nav/speed mismatch (anchored with SOG > 2)", () => {
    const flags = checkTemporal({
      current: { ...baseCurrent, sog: 8, navStatus: NavStatus.AtAnchor },
      prior: null,
    });
    expect(flags[0].type).toBe("nav_speed_mismatch");
    expect(flags[0].severity).toBe("info");
  });

  it("no flags with no prior position", () => {
    const flags = checkTemporal({
      current: baseCurrent, prior: null,
    });
    expect(flags).toHaveLength(0);
  });
});

describe("haversineNm", () => {
  it("equator 1 degree ≈ 60 nm", () => {
    expect(haversineNm(0, 0, 0, 1)).toBeCloseTo(60, 0);
  });
  it("zero distance for identical points", () => {
    expect(haversineNm(45, -10, 45, -10)).toBe(0);
  });
});

// ==================================================================
// Layer 3 — Identity
// ==================================================================

describe("checkIdentity", () => {
  const messageReceivedAt = NOW;

  it("accepts a clean name match", () => {
    const flags = checkIdentity({
      ais: { name: "NORDIC STAR", imo: "9123456", lengthM: 183, beamM: 32 },
      expected: { name: "Nordic Star", imo: "9123456", lengthM: 183, beamM: 32 },
      messageReceivedAt,
    });
    expect(flags).toHaveLength(0);
  });

  it("ignores MT prefix when matching names", () => {
    const flags = checkIdentity({
      ais: { name: "NORDIC STAR", imo: null, lengthM: null, beamM: null },
      expected: { name: "MT Nordic Star", imo: null, lengthM: null, beamM: null },
      messageReceivedAt,
    });
    expect(flags).toHaveLength(0);
  });

  it("flags name mismatch", () => {
    const flags = checkIdentity({
      ais: { name: "OCEANIA", imo: null, lengthM: null, beamM: null },
      expected: { name: "NORDIC STAR", imo: null, lengthM: null, beamM: null },
      messageReceivedAt,
    });
    expect(flags[0].type).toBe("name_mismatch");
    expect(flags[0].severity).toBe("warn");
  });

  it("flags IMO mismatch", () => {
    const flags = checkIdentity({
      ais: { name: null, imo: "9123456", lengthM: null, beamM: null },
      expected: { name: null, imo: "9999999", lengthM: null, beamM: null },
      messageReceivedAt,
    });
    expect(flags[0].type).toBe("imo_mismatch");
  });

  it("flags dimension mismatch (length)", () => {
    const flags = checkIdentity({
      ais: { name: null, imo: null, lengthM: 183, beamM: null },
      expected: { name: null, imo: null, lengthM: 250, beamM: null },
      messageReceivedAt,
    });
    expect(flags[0].type).toBe("dimension_mismatch");
    expect(flags[0].severity).toBe("info");
    expect((flags[0].details as { dimension: string }).dimension).toBe("length");
  });

  it("tolerates 10% dimension variance (rounded AIS entry)", () => {
    const flags = checkIdentity({
      ais: { name: null, imo: null, lengthM: 183, beamM: null },
      expected: { name: null, imo: null, lengthM: 185, beamM: null },
      messageReceivedAt,
    });
    expect(flags).toHaveLength(0);
  });

  it("skips checks where linkage has no expected value", () => {
    const flags = checkIdentity({
      ais: { name: "WHATEVER", imo: "9123456", lengthM: 183, beamM: 32 },
      expected: { name: null, imo: null, lengthM: null, beamM: null },
      messageReceivedAt,
    });
    expect(flags).toHaveLength(0);
  });
});

describe("namesMatch", () => {
  it.each([
    ["NORDIC STAR", "Nordic Star", true],
    ["MT NORDIC STAR", "Nordic Star", true],
    ["M/V OCEANIA", "OCEANIA", true],
    ["Nordic-Star", "Nordic Star", true],
    ["NORDIC STAR", "OCEANIA", false],
  ])("%s ↔ %s → %s", (a, b, expected) => {
    expect(namesMatch(a, b)).toBe(expected);
  });
});

// ==================================================================
// Layer 4 — Anomaly
// ==================================================================

describe("zoneContaining", () => {
  it("recognises Primorsk", () => {
    // Primorsk terminal rough centre: 60.36°N, 28.65°E
    expect(zoneContaining(60.36, 28.65)?.code).toBe("primorsk");
  });
  it("returns null for open ocean", () => {
    expect(zoneContaining(0, 0)).toBeNull();
  });
});

describe("checkAnomaly", () => {
  it("flags AIS-off near sanctioned port after 45 min", () => {
    const flags = checkAnomaly({
      lastKnown: {
        lat: 60.36, lon: 28.65,
        receivedAt: new Date(NOW.getTime() - 60 * 60_000), // 60 min silence
      },
      now: NOW,
    });
    expect(flags[0].type).toBe("ais_off_sanctioned");
    expect(flags[0].severity).toBe("info");
    expect((flags[0].details as { zoneCode: string }).zoneCode).toBe("primorsk");
  });

  it("does not flag short silence near sanctioned port", () => {
    const flags = checkAnomaly({
      lastKnown: {
        lat: 60.36, lon: 28.65,
        receivedAt: new Date(NOW.getTime() - 10 * 60_000),
      },
      now: NOW,
    });
    expect(flags).toHaveLength(0);
  });

  it("flags mid-voyage silence > 24h", () => {
    const flags = checkAnomaly({
      lastKnown: {
        lat: 45, lon: -30, // Mid-Atlantic
        receivedAt: new Date(NOW.getTime() - 30 * 60 * 60_000), // 30h
      },
      now: NOW,
    });
    expect(flags[0].type).toBe("ais_off_midvoyage");
  });

  it("no flag for fresh mid-voyage position", () => {
    const flags = checkAnomaly({
      lastKnown: {
        lat: 45, lon: -30,
        receivedAt: new Date(NOW.getTime() - 60_000),
      },
      now: NOW,
    });
    expect(flags).toHaveLength(0);
  });

  it("no flag when lastKnown is null", () => {
    expect(checkAnomaly({ lastKnown: null, now: NOW })).toHaveLength(0);
  });

  it("sanctioned zones has expected entries", () => {
    const codes = SANCTIONED_ZONES.map((z) => z.code);
    expect(codes).toContain("primorsk");
    expect(codes).toContain("kozmino");
    expect(codes).toContain("kharg");
  });
});

// ==================================================================
// Layer 5 — Business rules
// ==================================================================

describe("checkBusiness", () => {
  const current = { lat: 50, lon: 0, sog: 10, receivedAt: NOW };

  it("flags chronic slow (avg below 85% of CP)", () => {
    const flags = checkBusiness({
      current,
      cpSpeedKn: 14,
      avgSogRecentKn: 10, // 71% of 14
      route: null,
      aisEta: null,
      laycanEnd: null,
    });
    expect(flags[0].type).toBe("speed_below_cp");
  });

  it("does not flag when close to CP speed", () => {
    const flags = checkBusiness({
      current,
      cpSpeedKn: 12,
      avgSogRecentKn: 11.5, // 96%
      route: null,
      aisEta: null,
      laycanEnd: null,
    });
    expect(flags).toHaveLength(0);
  });

  it("flags off-route (> 30 nm from GC line)", () => {
    const flags = checkBusiness({
      current: { lat: 45, lon: 0, sog: 12, receivedAt: NOW },
      cpSpeedKn: null,
      avgSogRecentKn: null,
      route: { loadportLat: 0, loadportLon: 0, dischargeLat: 0, dischargeLon: 90 },
      aisEta: null,
      laycanEnd: null,
    });
    expect(flags.some((f) => f.type === "off_route")).toBe(true);
  });

  it("flags ETA drift > 24h", () => {
    const flags = checkBusiness({
      current,
      cpSpeedKn: null,
      avgSogRecentKn: null,
      route: null,
      aisEta: new Date("2026-05-05T00:00:00Z"),
      laycanEnd: new Date("2026-05-01T00:00:00Z"),
    });
    expect(flags.some((f) => f.type === "eta_drift")).toBe(true);
  });

  it("no flag for ETA within 24h of laycan", () => {
    const flags = checkBusiness({
      current,
      cpSpeedKn: null,
      avgSogRecentKn: null,
      route: null,
      aisEta: new Date("2026-05-01T10:00:00Z"),
      laycanEnd: new Date("2026-05-01T00:00:00Z"),
    });
    expect(flags.some((f) => f.type === "eta_drift")).toBe(false);
  });
});

describe("crossTrackDistanceNm", () => {
  it("zero when point is on the line", () => {
    // Midpoint between (0,0) and (0,10°)
    const d = crossTrackDistanceNm(0, 5, 0, 0, 0, 10);
    expect(d).toBeCloseTo(0, 3);
  });
  it("positive when point is off the line", () => {
    const d = crossTrackDistanceNm(1, 5, 0, 0, 0, 10);
    expect(d).toBeGreaterThan(0);
    // 1° latitude ≈ 60 nm
    expect(d).toBeCloseTo(60, 0);
  });
});

// ==================================================================
// Orchestrator — validateMessage
// ==================================================================

describe("validateMessage", () => {
  it("returns accept=true with no flags for a clean message", () => {
    const result = validateMessage({
      sanity: { lat: 51.9, lon: 4.1, sog: 12, cog: 90, receivedAt: NOW },
      temporal: null,
      identity: null,
      anomaly: null,
      business: null,
    });
    expect(result.accept).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it("returns accept=false when a 'reject' flag is raised", () => {
    const result = validateMessage({
      sanity: { lat: 0, lon: 0, sog: 12, cog: null, receivedAt: NOW },
      temporal: null,
      identity: null,
      anomaly: null,
      business: null,
    });
    expect(result.accept).toBe(false);
    expect(result.flags[0].type).toBe("null_island");
  });

  it("still runs all layers even after a reject (complete audit trail)", () => {
    const result = validateMessage({
      sanity: { lat: 0, lon: 0, sog: 12, cog: null, receivedAt: NOW },   // rejects
      temporal: null,
      identity: {
        ais: { name: "WRONG", imo: null, lengthM: null, beamM: null },
        expected: { name: "RIGHT", imo: null, lengthM: null, beamM: null },
        messageReceivedAt: NOW,
      },
      anomaly: null,
      business: null,
    });
    expect(result.accept).toBe(false);
    // Both null_island and name_mismatch should be present.
    expect(result.flags.map((f) => f.type).sort()).toEqual([
      "name_mismatch",
      "null_island",
    ]);
  });
});

// ==================================================================
// Audit row shaping
// ==================================================================

describe("toFlagRow", () => {
  it("maps a flag to the DB insert row shape", () => {
    const row = toFlagRow("257964900", {
      layer: "sanity",
      type: "null_island",
      severity: "reject",
      details: { lat: 0, lon: 0 },
      messageReceivedAt: NOW,
    });
    expect(row).toEqual({
      mmsi: "257964900",
      layer: "sanity",
      flagType: "null_island",
      severity: "reject",
      details: { lat: 0, lon: 0 },
      messageReceivedAt: NOW,
    });
  });
});
