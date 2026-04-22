/**
 * Emit a table with: file, NEFGO position (buy/sell/amendment),
 * counterparty, delivery line, ports detected.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "Deal Recaps";

interface Row {
  file: string;
  nefgoPos: "SELLER" | "BUYER" | "AMEND";
  counterparty: string;
  incoterm: string;
  delivery: string;
  loadport: string;
  disport: string;
}

function classifyDelivery(line: string, incoterm: string): { load: string; disc: string } {
  let rest = line
    .replace(/\b(FOB|CIF|CFR|DAP)\b/, "")
    .replace(/\b(one safe berth|one safe port|1 SB 1 SP|safe berth|safe port)\b/gi, "")
    .replace(/,\s*delivery.*$/i, "")
    .replace(/\brange\b/gi, "")
    .replace(/=\s*$/, "")
    .trim()
    .replace(/^,/, "")
    .trim();

  const regionPrefixRe = /^(Med|ARA|NWE|USGC|WAF)\b\s*/i;
  if (regionPrefixRe.test(rest)) rest = rest.replace(regionPrefixRe, "");

  // Strip trailing region qualifiers like "Amsterdam ARA" → "Amsterdam"
  rest = rest.replace(/\s+(ARA|Med|NWE|USGC|WAF)\b.*$/i, "");

  const tokens = rest
    .split(/\s+/)
    .map((t) => t.replace(/[,."']/g, "").trim())
    .filter((t) => t.length > 0 && !/^(TBN|TBA|TBD|TBC)$/i.test(t));

  if (incoterm === "FOB") {
    return {
      load: tokens[0] ?? "-",
      disc: tokens.slice(1).join(" ") || "-",
    };
  }
  // CIF / CFR / DAP: disport is the first mentioned port
  return {
    load: tokens.slice(1).join(" ") || "-",
    disc: tokens[0] ?? "-",
  };
}

function parse(file: string, body: string): Row {
  const sellerM = body.match(/^Seller\s*:\s*(.+)$/im);
  const buyerM = body.match(/^Buyer\s*:\s*(.+)$/im);
  const delivM = body.match(/^Delivery\s*:\s*(.+)$/im);

  if (!sellerM || !buyerM) {
    // Amendment file — figure out NEFGO position from filename.
    const n = file.toUpperCase();
    const nefgoFirst = /_NEFGO_[A-Z]/.test(n);
    return {
      file,
      nefgoPos: "AMEND",
      counterparty: nefgoFirst
        ? n.replace(/^\d+_AMENDMENT_NEFGO_/, "").replace(/\.EML$/, "").replace(/_/g, " ")
        : n.replace(/^\d+_AMENDMENT_/, "").replace(/_NEFGO\.EML$/, "").replace(/_/g, " "),
      incoterm: "",
      delivery: "(amendment)",
      loadport: "",
      disport: "",
    };
  }

  const seller = sellerM[1].trim();
  const buyer = buyerM[1].trim();
  const nefgoIsSeller = /NEFGO/i.test(seller);
  const nefgoIsBuyer = /NEFGO/i.test(buyer);
  const counterparty = nefgoIsSeller ? buyer : nefgoIsBuyer ? seller : `${seller} / ${buyer}`;

  const delivery = delivM ? delivM[1].trim() : "";
  const incoMatch = delivery.match(/\b(FOB|CIF|CFR|DAP)\b/);
  const incoterm = incoMatch?.[1] ?? "?";

  const { load, disc } = delivery ? classifyDelivery(delivery, incoterm) : { load: "-", disc: "-" };

  return {
    file,
    nefgoPos: nefgoIsSeller ? "SELLER" : nefgoIsBuyer ? "BUYER" : "?",
    counterparty,
    incoterm,
    delivery: delivery.slice(0, 55),
    loadport: load,
    disport: disc,
  };
}

function main() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".eml") && !f.startsWith("_"))
    .sort();
  const rows = files.map((f) => parse(f, readFileSync(join(DIR, f), "utf-8")));

  // Pretty-print
  const header = ["File", "NEFGO", "Counterparty", "INCO", "Load", "Disc"];
  const widths = header.map((h) => h.length);
  for (const r of rows) {
    widths[0] = Math.max(widths[0], r.file.length);
    widths[1] = Math.max(widths[1], r.nefgoPos.length);
    widths[2] = Math.max(widths[2], r.counterparty.length);
    widths[3] = Math.max(widths[3], r.incoterm.length);
    widths[4] = Math.max(widths[4], r.loadport.length);
    widths[5] = Math.max(widths[5], r.disport.length);
  }
  const pad = (s: string, w: number) => s.padEnd(w);
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(
      line([r.file, r.nefgoPos, r.counterparty, r.incoterm, r.loadport, r.disport]),
    );
  }

  // Summary
  const sell = rows.filter((r) => r.nefgoPos === "SELLER");
  const buy = rows.filter((r) => r.nefgoPos === "BUYER");
  const amend = rows.filter((r) => r.nefgoPos === "AMEND");
  console.log();
  console.log(`Total: ${rows.length}`);
  console.log(`  NEFGO sells: ${sell.length}`);
  console.log(`  NEFGO buys:  ${buy.length}`);
  console.log(`  Amendments:  ${amend.length}`);

  const sellTwoPorts = sell.filter(
    (r) => r.loadport !== "-" && r.disport !== "-" && r.loadport !== "" && r.disport !== "",
  );
  const buyTwoPorts = buy.filter(
    (r) => r.loadport !== "-" && r.disport !== "-" && r.loadport !== "" && r.disport !== "",
  );
  console.log();
  console.log(`NEFGO sells with both ports mentioned: ${sellTwoPorts.length}`);
  for (const r of sellTwoPorts) console.log(`  ${r.file}: ${r.incoterm} ${r.loadport} → ${r.disport}`);
  console.log();
  console.log(`NEFGO buys with both ports mentioned: ${buyTwoPorts.length}`);
  for (const r of buyTwoPorts) console.log(`  ${r.file}: ${r.incoterm} ${r.loadport} → ${r.disport}`);
}

main();
