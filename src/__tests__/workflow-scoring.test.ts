/**
 * Tests for workflow template scoring algorithm.
 *
 * PRD requirements covered:
 * REQ-WF1: Auto-match by (incoterm, direction, region)
 * REQ-WF2: Scoring algorithm with region pattern bonus
 * REQ-WF3: Incoterm + direction as required match criteria
 * REQ-WF5: Exact region match scores higher
 */

import { describe, it, expect } from "vitest";
import { scoreTemplate } from "@/lib/workflow-engine";
import type { WorkflowTemplate, Deal } from "@/lib/db/schema";

// ── Helpers ─────────────────────────────────────────────────

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    tenantId: "tenant-1",
    externalRef: null,
    linkageCode: null,
    linkageId: null,
    dealType: "regular",
    counterparty: "Shell",
    direction: "sell",
    product: "EBOB",
    quantityMt: "30000",
    contractedQty: null,
    nominatedQty: null,
    incoterm: "CIF",
    loadport: "Amsterdam",
    dischargePort: "New York",
    laycanStart: "2026-04-05",
    laycanEnd: "2026-04-07",
    vesselName: null,
    vesselImo: null,
    vesselCleared: false,
    docInstructionsReceived: false,
    status: "active",
    assignedOperatorId: null,
    secondaryOperatorId: null,
    pricingFormula: null,
    pricingType: null,
    pricingEstimatedDate: null,
    pricingPeriodType: null,
    pricingPeriodValue: null,
    pricingConfirmed: false,
    estimatedBlNorDate: null,
    loadedQuantityMt: null,
    specialInstructions: null,
    sourceRawText: null,
    excelStatuses: null,
    createdBy: "user-1",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Deal;
}

function makeTemplate(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: "tmpl-1",
    tenantId: "tenant-1",
    name: "Test Template",
    incoterm: null,
    direction: null,
    regionPattern: null,
    steps: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WorkflowTemplate;
}

// ── Tests ───────────────────────────────────────────────────

describe("scoreTemplate — incoterm + direction matching", () => {
  it("returns -1 when incoterm doesn't match", () => {
    const tmpl = makeTemplate({ incoterm: "FOB", direction: "sell" });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(-1);
  });

  it("returns -1 when direction doesn't match", () => {
    const tmpl = makeTemplate({ incoterm: "CIF", direction: "buy" });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(-1);
  });

  it("scores 5 for exact incoterm+direction match (3+2)", () => {
    const tmpl = makeTemplate({ incoterm: "CIF", direction: "sell" });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(5);
  });

  it("scores 3 for incoterm-only match (no direction on template)", () => {
    const tmpl = makeTemplate({ incoterm: "CIF", direction: null });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(3);
  });

  it("scores 2 for direction-only match (no incoterm on template)", () => {
    const tmpl = makeTemplate({ incoterm: null, direction: "sell" });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(2);
  });

  it("scores 0 for wildcard template (null incoterm, null direction)", () => {
    const tmpl = makeTemplate({ incoterm: null, direction: null });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(0);
  });
});

describe("scoreTemplate — region pattern bonus", () => {
  it("adds 2 points when region matches loadport", () => {
    const tmpl = makeTemplate({
      incoterm: "CIF",
      direction: "sell",
      regionPattern: "Amsterdam|Antwerp|Rotterdam",
    });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell", loadport: "Amsterdam" });
    expect(scoreTemplate(tmpl, deal)).toBe(7); // 3+2+2
  });

  it("no bonus when region doesn't match", () => {
    const tmpl = makeTemplate({
      incoterm: "CIF",
      direction: "sell",
      regionPattern: "Lavera|Lav",
    });
    const deal = makeDeal({ incoterm: "CIF", direction: "sell", loadport: "Amsterdam" });
    expect(scoreTemplate(tmpl, deal)).toBe(5); // 3+2, no region bonus
  });

  it("matches case-insensitively", () => {
    const tmpl = makeTemplate({
      incoterm: "FOB",
      direction: "buy",
      regionPattern: "Lavera|Lav",
    });
    const deal = makeDeal({ incoterm: "FOB", direction: "buy", loadport: "LAVERA" });
    expect(scoreTemplate(tmpl, deal)).toBe(7);
  });
});

describe("scoreTemplate — CFR and DAP incoterms", () => {
  it("matches CFR sell template to CFR sell deal", () => {
    const tmpl = makeTemplate({ incoterm: "CFR", direction: "sell" });
    const deal = makeDeal({ incoterm: "CFR", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(5);
  });

  it("does NOT match CIF template to CFR deal", () => {
    const tmpl = makeTemplate({ incoterm: "CIF", direction: "sell" });
    const deal = makeDeal({ incoterm: "CFR", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(-1);
  });

  it("matches DAP sell template to DAP sell deal", () => {
    const tmpl = makeTemplate({ incoterm: "DAP", direction: "sell" });
    const deal = makeDeal({ incoterm: "DAP", direction: "sell" });
    expect(scoreTemplate(tmpl, deal)).toBe(5);
  });
});
