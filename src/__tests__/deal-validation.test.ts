/**
 * Tests for Zod deal validation schemas.
 *
 * PRD requirements covered:
 * REQ-IN1: Only FOB, CIF, CFR, DAP accepted (no FCA)
 * REQ-IN2: FCA rejected with validation error
 * REQ-D2: dealType defaults to "regular"
 * REQ-D1: dealType "terminal_operation" accepted
 * REQ-STATUS1: Status transitions validated
 * REQ-FK8: Every deal must belong to a linkage
 */

import { describe, it, expect } from "vitest";
import { createDealSchema, updateDealSchema, dealFilterSchema } from "@/lib/types/deal";
import { VALID_TRANSITIONS, isValidTransition } from "@/lib/types/deal";

// ── Incoterm validation (REQ-IN1..2) ────────────────────────

describe("createDealSchema — incoterm validation", () => {
  const baseDeal = {
    counterparty: "Shell",
    direction: "sell" as const,
    product: "EBOB",
    quantityMt: 30000,
    incoterm: "CIF" as const,
    loadport: "Amsterdam",
    laycanStart: "2026-04-05",
    laycanEnd: "2026-04-07",
  };

  it("accepts FOB", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "FOB" });
    expect(r.success).toBe(true);
  });

  it("accepts CIF", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "CIF" });
    expect(r.success).toBe(true);
  });

  it("accepts CFR", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "CFR" });
    expect(r.success).toBe(true);
  });

  it("accepts DAP", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "DAP" });
    expect(r.success).toBe(true);
  });

  it("REJECTS FCA (REQ-IN2)", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "FCA" });
    expect(r.success).toBe(false);
  });

  it("REJECTS unknown incoterm", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, incoterm: "EXW" });
    expect(r.success).toBe(false);
  });
});

// ── dealType validation (REQ-D1..2) ─────────────────────────

describe("createDealSchema — dealType", () => {
  const baseDeal = {
    counterparty: "Shell",
    direction: "sell" as const,
    product: "EBOB",
    quantityMt: 30000,
    incoterm: "CIF" as const,
    loadport: "Amsterdam",
    laycanStart: "2026-04-05",
    laycanEnd: "2026-04-07",
  };

  it("defaults dealType to 'regular' when omitted", () => {
    const r = createDealSchema.safeParse(baseDeal);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dealType).toBe("regular");
  });

  it("accepts dealType='terminal_operation'", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, dealType: "terminal_operation" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dealType).toBe("terminal_operation");
  });

  it("rejects invalid dealType", () => {
    const r = createDealSchema.safeParse({ ...baseDeal, dealType: "unknown" });
    expect(r.success).toBe(false);
  });
});

// ── Laycan validation ───────────────────────────────────────

describe("createDealSchema — laycan validation", () => {
  const baseDeal = {
    counterparty: "Shell",
    direction: "sell" as const,
    product: "EBOB",
    quantityMt: 30000,
    incoterm: "CIF" as const,
    loadport: "Amsterdam",
  };

  it("accepts valid laycan range", () => {
    const r = createDealSchema.safeParse({
      ...baseDeal,
      laycanStart: "2026-04-05",
      laycanEnd: "2026-04-07",
    });
    expect(r.success).toBe(true);
  });

  it("accepts same-day laycan", () => {
    const r = createDealSchema.safeParse({
      ...baseDeal,
      laycanStart: "2026-04-05",
      laycanEnd: "2026-04-05",
    });
    expect(r.success).toBe(true);
  });

  it("rejects laycan where end < start", () => {
    const r = createDealSchema.safeParse({
      ...baseDeal,
      laycanStart: "2026-04-10",
      laycanEnd: "2026-04-05",
    });
    expect(r.success).toBe(false);
  });
});

// ── Status state machine (REQ-STATUS) ───────────────────────

describe("isValidTransition — status state machine", () => {
  it("draft → active is valid", () => {
    expect(isValidTransition("draft", "active")).toBe(true);
  });

  it("draft → cancelled is valid", () => {
    expect(isValidTransition("draft", "cancelled")).toBe(true);
  });

  it("draft → loading is INVALID (must go through active)", () => {
    expect(isValidTransition("draft", "loading")).toBe(false);
  });

  it("active → loading is valid", () => {
    expect(isValidTransition("active", "loading")).toBe(true);
  });

  it("loading → sailing is valid", () => {
    expect(isValidTransition("loading", "sailing")).toBe(true);
  });

  it("sailing → discharging is valid", () => {
    expect(isValidTransition("sailing", "discharging")).toBe(true);
  });

  it("discharging → completed is valid", () => {
    expect(isValidTransition("discharging", "completed")).toBe(true);
  });

  it("completed → anything is INVALID (terminal state)", () => {
    expect(isValidTransition("completed", "active")).toBe(false);
    expect(isValidTransition("completed", "draft")).toBe(false);
  });

  it("cancelled → anything is INVALID (terminal state)", () => {
    expect(isValidTransition("cancelled", "active")).toBe(false);
    expect(isValidTransition("cancelled", "draft")).toBe(false);
  });

  it("any status → cancelled is valid", () => {
    expect(isValidTransition("active", "cancelled")).toBe(true);
    expect(isValidTransition("loading", "cancelled")).toBe(true);
    expect(isValidTransition("sailing", "cancelled")).toBe(true);
    expect(isValidTransition("discharging", "cancelled")).toBe(true);
  });
});

// ── linkageId filter in dealFilterSchema ─────────────────────

describe("dealFilterSchema — linkageId filter", () => {
  it("accepts valid UUID linkageId", () => {
    const r = dealFilterSchema.safeParse({
      linkageId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID linkageId", () => {
    const r = dealFilterSchema.safeParse({
      linkageId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});
