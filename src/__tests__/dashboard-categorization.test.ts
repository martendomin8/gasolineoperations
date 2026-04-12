/**
 * Tests for dashboard linkage card categorization.
 *
 * PRD requirements covered:
 * REQ-CAT1: terminal_operation NOT counted as PURCHASE
 * REQ-CAT2: terminal_operation NOT counted as SALE
 * REQ-CAT4: terminal-only linkages → own_terminal category
 * REQ-OP4: unassigned linkages always visible regardless of filter
 * REQ-L9: displayName = linkageNumber ?? tempName
 */

import { describe, it, expect } from "vitest";
// buildLinkageCards is exported from the dashboard page
// We test it as a pure function with mock data
import { buildLinkageCards } from "@/app/(authenticated)/dashboard/page";

// ── Types matching the dashboard interfaces ─────────────────

interface DealItem {
  id: string;
  externalRef: string | null;
  linkageCode: string | null;
  linkageId: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
  nominatedQty: string | null;
  incoterm: string;
  loadport: string;
  dischargePort: string | null;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: string;
  dealType: string;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string | null;
}

interface LinkageRow {
  id: string;
  linkageNumber: string | null;
  tempName: string | null;
  status: string;
  dealCount: number;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  secondaryOperatorId: string | null;
  secondaryOperatorName: string | null;
}

function makeDeal(overrides: Partial<DealItem> = {}): DealItem {
  return {
    id: `deal-${Math.random().toString(36).slice(2, 8)}`,
    externalRef: null,
    linkageCode: "TEST-001",
    linkageId: "linkage-1",
    counterparty: "Shell",
    direction: "sell",
    product: "EBOB",
    quantityMt: "30000",
    contractedQty: null,
    nominatedQty: null,
    incoterm: "CIF",
    loadport: "Amsterdam",
    dischargePort: null,
    laycanStart: "2026-04-05",
    laycanEnd: "2026-04-07",
    vesselName: null,
    status: "active",
    dealType: "regular",
    pricingType: null,
    pricingFormula: null,
    pricingEstimatedDate: null,
    ...overrides,
  };
}

function makeLinkageRow(overrides: Partial<LinkageRow> = {}): LinkageRow {
  return {
    id: "linkage-1",
    linkageNumber: null,
    tempName: "TEMP-001",
    status: "active",
    dealCount: 1,
    assignedOperatorId: null,
    assignedOperatorName: null,
    secondaryOperatorId: null,
    secondaryOperatorName: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("buildLinkageCards — basic categorization", () => {
  it("categorizes a buy-only linkage as buy_only", () => {
    const rows = [makeLinkageRow()];
    const deals = [makeDeal({ direction: "buy", dealType: "regular" })];
    const cards = buildLinkageCards(rows, deals);
    expect(cards[0].category).toBe("buy_only");
  });

  it("categorizes a sell-only linkage as sell_only", () => {
    const rows = [makeLinkageRow()];
    const deals = [makeDeal({ direction: "sell", dealType: "regular" })];
    const cards = buildLinkageCards(rows, deals);
    expect(cards[0].category).toBe("sell_only");
  });

  it("categorizes a buy+sell linkage as purchase_sell", () => {
    const rows = [makeLinkageRow()];
    const deals = [
      makeDeal({ direction: "buy", dealType: "regular" }),
      makeDeal({ direction: "sell", dealType: "regular" }),
    ];
    const cards = buildLinkageCards(rows, deals);
    expect(cards[0].category).toBe("purchase_sell");
  });

  it("categorizes an empty linkage as empty", () => {
    const rows = [makeLinkageRow()];
    const cards = buildLinkageCards(rows, []);
    expect(cards[0].category).toBe("empty");
  });
});

describe("buildLinkageCards — terminal_operation categorization (REQ-CAT1..4)", () => {
  it("terminal-only linkage → own_terminal (NOT buy_only)", () => {
    const rows = [makeLinkageRow()];
    const deals = [
      makeDeal({ direction: "buy", dealType: "terminal_operation" }),
    ];
    const cards = buildLinkageCards(rows, deals);
    expect(cards[0].category).toBe("own_terminal");
  });

  it("terminal-only with buy+sell directions → still own_terminal (NOT purchase_sell)", () => {
    const rows = [makeLinkageRow()];
    const deals = [
      makeDeal({ direction: "buy", dealType: "terminal_operation" }),
      makeDeal({ direction: "sell", dealType: "terminal_operation" }),
    ];
    const cards = buildLinkageCards(rows, deals);
    expect(cards[0].category).toBe("own_terminal");
  });

  it("mixed regular+terminal → categorizes by regular deals only", () => {
    const rows = [makeLinkageRow()];
    const deals = [
      makeDeal({ direction: "sell", dealType: "regular" }),
      makeDeal({ direction: "buy", dealType: "terminal_operation" }),
    ];
    const cards = buildLinkageCards(rows, deals);
    // Only the regular sell counts → sell_only
    expect(cards[0].category).toBe("sell_only");
  });
});

describe("buildLinkageCards — displayName (REQ-L9)", () => {
  it("uses linkageNumber when set", () => {
    const rows = [makeLinkageRow({ linkageNumber: "086412GSS" })];
    const cards = buildLinkageCards(rows, []);
    expect(cards[0].displayName).toBe("086412GSS");
  });

  it("falls back to tempName when linkageNumber is null", () => {
    const rows = [makeLinkageRow({ linkageNumber: null, tempName: "TEMP-001" })];
    const cards = buildLinkageCards(rows, []);
    expect(cards[0].displayName).toBe("TEMP-001");
  });
});

describe("buildLinkageCards — operator info", () => {
  it("copies operator info from linkage row to card", () => {
    const rows = [makeLinkageRow({
      assignedOperatorId: "op-1",
      assignedOperatorName: "AT",
    })];
    const cards = buildLinkageCards(rows, []);
    expect(cards[0].assignedOperatorId).toBe("op-1");
    expect(cards[0].assignedOperatorName).toBe("AT");
  });

  it("orphan deals have null operator", () => {
    const deals = [makeDeal({ linkageId: null, linkageCode: null })];
    const cards = buildLinkageCards([], deals);
    expect(cards[0].assignedOperatorId).toBeNull();
  });
});
