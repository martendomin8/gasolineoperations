// Decides whether NEFGO is the charterer (i.e. the party that arranges +
// pays for the vessel) for a given linkage. The result drives whether the
// linkage's cost section renders the freight + address-commission +
// brokerage line and whether the calculator runs.
//
// Business rule (per Arne, 2026-04-26):
//   NEFGO charters when the linkage extends shipping responsibility from
//   one end of the chain to the other. Concretely:
//
//   - Sells C-type (CIF/CFR/DAP) AND no buy is a C-type → NEFGO ships out
//   - Buys F-type (FOB) AND no sell is an F-type        → NEFGO ships in
//
//   Back-to-back same-side combos (both C or both F) mean the upstream
//   supplier or downstream buyer arranges the vessel — NEFGO never charters.
//
// Tested mental matrix:
//   buy   sell   charterer?
//   --    CIF    yes  (sell out, no upstream supplier shipping)
//   FOB   --     yes  (buy in, no downstream taker)
//   FOB   CIF    yes  (canonical "FOB→CIF middleman")
//   CIF   CIF    no   (supplier ships through to our buyer)
//   FOB   FOB    no   (our buyer picks up at loadport directly)
//   CIF   FOB    no   (cargo handed off without us shipping)

const SHIPPER_INCOTERMS = new Set(["CIF", "CFR", "DAP"]);

interface DealSlim {
  direction: "buy" | "sell";
  incoterm: string;
}

export function isNefgoCharterer(deals: DealSlim[]): boolean {
  const buys = deals.filter((d) => d.direction === "buy");
  const sells = deals.filter((d) => d.direction === "sell");

  const sellsHaveShipper = sells.some((d) => SHIPPER_INCOTERMS.has(d.incoterm));
  const buysHaveShipper = buys.some((d) => SHIPPER_INCOTERMS.has(d.incoterm));
  const buysHaveFob = buys.some((d) => d.incoterm === "FOB");
  const sellsHaveFob = sells.some((d) => d.incoterm === "FOB");

  // Trigger 1: we're shipping out (sell C-type) AND no supplier already ships in
  if (sellsHaveShipper && !buysHaveShipper) return true;
  // Trigger 2: we're shipping in (buy FOB) AND no downstream taker handles it
  if (buysHaveFob && !sellsHaveFob) return true;

  return false;
}
