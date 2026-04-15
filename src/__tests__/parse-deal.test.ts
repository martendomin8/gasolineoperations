/**
 * Tests for the AI deal parser (regex fallback path).
 *
 * PRD requirements covered:
 * REQ-QTY1: contracted_qty extraction with tolerance
 * REQ-QTY2: quantity_mt as numeric middle value
 * REQ-QTY3: tolerance notation recognition (+/-5%, ±5%)
 * REQ-IN1: incoterm extraction (FOB, CIF, CFR, DAP — no FCA)
 * REQ-AI7: regex fallback parser tolerance support
 * REQ-AI8: both contracted_qty and quantity_mt populated
 * REQ-AI12: all output fields present
 */

import { describe, it, expect } from "vitest";
import { parseDealDemo } from "@/lib/ai/parse-deal";

// ── Helper ──────────────────────────────────────────────────

function parse(text: string) {
  return parseDealDemo(text);
}

// ── Incoterm extraction ─────────────────────────────────────

describe("parseDealDemo — incoterm extraction", () => {
  it("extracts FOB", () => {
    const r = parse("Sold 30000 MT EBOB FOB Rotterdam, laycan 5-7 April 2026");
    expect(r.fields.incoterm).toBe("FOB");
  });

  it("extracts CIF", () => {
    const r = parse("Sold 30000 MT EBOB CIF New York, laycan 5-7 April 2026");
    expect(r.fields.incoterm).toBe("CIF");
  });

  it("extracts CFR", () => {
    const r = parse("Sold 25000 MT CFR Barcelona, laycan 18-20 April 2026");
    expect(r.fields.incoterm).toBe("CFR");
  });

  it("extracts DAP", () => {
    const r = parse("Sold 28000 MT RBOB DAP Houston, laycan 15-17 April 2026");
    expect(r.fields.incoterm).toBe("DAP");
  });

  it("does NOT extract FCA (removed — REQ-IN1)", () => {
    const r = parse("Sold 30000 MT EBOB FCA Rotterdam, laycan 5-7 April 2026");
    expect(r.fields.incoterm).toBeNull();
  });
});

// ── Quantity + tolerance extraction ─────────────────────────

describe("parseDealDemo — quantity + tolerance (REQ-QTY1..3)", () => {
  it("extracts numeric quantity_mt from MT notation", () => {
    const r = parse("Sold 30,000 MT EBOB FOB Rotterdam");
    expect(r.fields.quantity_mt).toBe(30000);
    expect(r.confidenceScores.quantity_mt).toBeGreaterThan(0.5);
  });

  it("extracts numeric quantity_mt from KT notation", () => {
    const r = parse("Sold 37kt EBOB FOB Rotterdam");
    expect(r.fields.quantity_mt).toBe(37000);
  });

  it("extracts contracted_qty with +/-% tolerance", () => {
    const r = parse("Sold 18000 MT +/-10% EBOB FOB Rotterdam");
    expect(r.fields.contracted_qty).toContain("18000");
    expect(r.fields.contracted_qty).toContain("+/-10%");
    expect(r.fields.quantity_mt).toBe(18000);
  });

  it("extracts contracted_qty with +/- 5% tolerance (with spaces)", () => {
    const r = parse("Bought 37000 MT +/- 5% Reformate FOB Aliaga");
    expect(r.fields.contracted_qty).toContain("37000");
    expect(r.fields.contracted_qty).toContain("+/- 5%");
    expect(r.fields.quantity_mt).toBe(37000);
  });

  it("returns plain quantity string when no tolerance", () => {
    const r = parse("Sold 30,000 MT EBOB FOB Rotterdam");
    expect(r.fields.contracted_qty).toContain("30,000");
    expect(r.fields.contracted_qty).toContain("MT");
  });
});

// ── Direction extraction ────────────────────────────────────

describe("parseDealDemo — direction extraction", () => {
  it("detects 'sold' as sell", () => {
    const r = parse("Sold 30000 MT EBOB FOB Rotterdam");
    expect(r.fields.direction).toBe("sell");
  });

  it("detects 'bought' as buy", () => {
    const r = parse("Bought 15000 MT Reformate FOB Lavera");
    expect(r.fields.direction).toBe("buy");
  });

  it("detects 'purchase' as buy", () => {
    const r = parse("Confirmed purchase from Vitol: 15000 MT Reformate FOB Lavera");
    expect(r.fields.direction).toBe("buy");
  });

  it("detects Seller: label as sell", () => {
    const r = parse("Seller: EuroGas Trading\nBuyer: Shell\n30000 MT FOB");
    expect(r.fields.direction).toBe("sell");
  });
});

// ── Counterparty extraction ─────────────────────────────────

describe("parseDealDemo — counterparty extraction", () => {
  it("extracts from 'sold to X' pattern", () => {
    const r = parse("Sold 30000 MT EBOB to Shell Trading Rotterdam FOB Amsterdam");
    expect(r.fields.counterparty).toContain("Shell");
  });

  it("extracts from 'Buyer: X' label", () => {
    const r = parse("Buyer: Shell Trading Rotterdam\n30000 MT EBOB FOB Amsterdam");
    expect(r.fields.counterparty).toContain("Shell");
  });

  it("extracts from 'purchase from X' pattern", () => {
    const r = parse("Confirmed purchase from Vitol SA: 15000 MT Reformate FOB Lavera");
    expect(r.fields.counterparty).toContain("Vitol");
  });
});

// ── Pricing extraction ──────────────────────────────────────

describe("parseDealDemo — pricing extraction", () => {
  it("extracts BL shorthand (BL+5 → BL 0-0-5)", () => {
    const r = parse("Price: Platts FOB Baltic +$2.50/MT, BL+5");
    expect(r.fields.pricing_period_type).toBe("BL");
    expect(r.fields.pricing_period_value).toBe("0-0-5");
  });

  it("extracts BL full notation", () => {
    const r = parse("Pricing: BL 0-1-5");
    expect(r.fields.pricing_period_type).toBe("BL");
    expect(r.fields.pricing_period_value).toBe("0-1-5");
  });

  it("extracts NOR notation", () => {
    const r = parse("Pricing: NOR 3-1-3");
    expect(r.fields.pricing_period_type).toBe("NOR");
    expect(r.fields.pricing_period_value).toBe("3-1-3");
  });

  it("extracts EFP", () => {
    const r = parse("Pricing: EFP");
    expect(r.fields.pricing_period_type).toBe("EFP");
  });
});

// ── Laycan extraction ───────────────────────────────────────

describe("parseDealDemo — laycan extraction", () => {
  it("extracts 'Laycan: 5/7 April 2026'", () => {
    const r = parse("Laycan: 5/7 April 2026\nProduct: EBOB");
    expect(r.fields.laycan_start).toMatch(/2026-04-05/);
    expect(r.fields.laycan_end).toMatch(/2026-04-07/);
  });

  it("extracts 'Laycan 10-12 April 2026'", () => {
    const r = parse("Laycan 10-12 April 2026\nProduct: EBOB");
    expect(r.fields.laycan_start).toMatch(/2026-04-10/);
    expect(r.fields.laycan_end).toMatch(/2026-04-12/);
  });

  it("extracts 'first half April'", () => {
    const r = parse("Laycan: first half April\nProduct: EBOB");
    expect(r.fields.laycan_start).toMatch(/04-01$/);
    expect(r.fields.laycan_end).toMatch(/04-15$/);
  });
});

// ── Vessel extraction ───────────────────────────────────────

describe("parseDealDemo — vessel extraction", () => {
  it("extracts vessel name from 'Vessel: MT X'", () => {
    const r = parse("Vessel: MT Nordic Hawk\n30000 MT FOB");
    expect(r.fields.vessel_name).toBe("Nordic Hawk");
  });

  it("extracts IMO number", () => {
    const r = parse("Vessel: MT Nordic Hawk, IMO 9341298\n30000 MT FOB");
    expect(r.fields.vessel_imo).toBe("9341298");
  });

  it("sets vessel_name to null for TBN", () => {
    const r = parse("Vessel: TBN\n30000 MT FOB");
    expect(r.fields.vessel_name).toBeNull();
  });
});

// ── Full output structure (REQ-AI12) ────────────────────────

describe("parseDealDemo — output structure", () => {
  it("returns all required fields", () => {
    const r = parse("Sold 30000 MT EBOB CIF Amsterdam to Shell, laycan 5/7 April 2026, Vessel: MT Arrow IMO 9786543, Price: Platts CIF NWE -$5/MT, BL+5");
    const keys = Object.keys(r.fields);
    expect(keys).toContain("counterparty");
    expect(keys).toContain("direction");
    expect(keys).toContain("product");
    expect(keys).toContain("quantity_mt");
    expect(keys).toContain("contracted_qty");
    expect(keys).toContain("incoterm");
    expect(keys).toContain("loadport");
    expect(keys).toContain("discharge_port");
    expect(keys).toContain("laycan_start");
    expect(keys).toContain("laycan_end");
    expect(keys).toContain("vessel_name");
    expect(keys).toContain("vessel_imo");
    expect(keys).toContain("pricing_formula");
    expect(keys).toContain("pricing_period_type");
    expect(keys).toContain("pricing_period_value");
    expect(keys).toContain("special_instructions");
    expect(keys).toContain("external_ref");
  });

  it("returns confidence scores for all fields", () => {
    const r = parse("Sold 30000 MT EBOB CIF Amsterdam to Shell");
    const scoreKeys = Object.keys(r.confidenceScores);
    expect(scoreKeys).toContain("counterparty");
    expect(scoreKeys).toContain("direction");
    expect(scoreKeys).toContain("quantity_mt");
    expect(scoreKeys).toContain("contracted_qty");
    expect(scoreKeys).toContain("incoterm");
  });
});
