/**
 * Audit how often Lauri's recaps mention loadport / disport / both.
 * One-shot diagnostic — informs whether deals.loadport needs to be
 * NULL-able or whether "TBD" placeholder is fine.
 *
 * Heuristic per Delivery line:
 *   FOB <port>                         → loadport only
 *   CIF/CFR/DAP <port>                 → disport only
 *   FOB <A> <B>                        → load (A) + disport (B)
 *   CIF/CFR/DAP <A> <B> (rare)         → probably region+port, disport only
 *   "loading X in Y" / "ex X"          → explicit loadport
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "Deal Recaps";

type Classification =
  | "loadport_only"
  | "disport_only"
  | "both"
  | "unclear"
  | "no_delivery_line";

interface Result {
  file: string;
  incoterm: string | null;
  deliveryLine: string | null;
  classification: Classification;
  detail: string;
}

function classify(file: string, body: string): Result {
  // Grab the Delivery: line (one or many spaces before colon).
  // Lauri's recaps use varying column widths.
  const deliveryMatch = body.match(/^Delivery\s*:\s*(.+)$/im);
  if (!deliveryMatch) {
    return {
      file,
      incoterm: null,
      deliveryLine: null,
      classification: "no_delivery_line",
      detail: "(no 'Delivery:' line — amendment file most likely)",
    };
  }
  const line = deliveryMatch[1].trim();
  const incoMatch = line.match(/\b(FOB|CIF|CFR|DAP)\b/);
  const incoterm = incoMatch?.[1] ?? null;

  // Remove the incoterm + common filler phrases to isolate port(s).
  let rest = line
    .replace(/\b(FOB|CIF|CFR|DAP)\b/, "")
    .replace(/\b(one safe berth|one safe port|1 SB 1 SP|safe berth|safe port)\b/gi, "")
    .replace(/,\s*delivery by sellers vessel.*$/i, "")
    .replace(/,\s*1 SB 1 SP\b/gi, "")
    .replace(/,?\s*delivery by.*$/i, "")
    .trim()
    .replace(/^,/, "")
    .trim();

  // Region prefixes like "Med", "ARA", "NWE", "USGC", "WAF".
  const regionPrefixRe = /^(Med|ARA|NWE|USGC|WAF)\b\s*/i;
  const hasRegionPrefix = regionPrefixRe.test(rest);
  if (hasRegionPrefix) rest = rest.replace(regionPrefixRe, "");

  // Split on whitespace → candidate port tokens.
  const tokens = rest
    .split(/\s+/)
    .map((t) => t.replace(/[,.;]/g, "").trim())
    .filter(Boolean);

  let loadport: string | null = null;
  let disport: string | null = null;

  if (incoterm === "FOB") {
    // FOB = seller delivers AT the load port → first port is always loadport.
    if (tokens.length >= 1) loadport = tokens[0];
    if (tokens.length >= 2) disport = tokens.slice(1).join(" ");
  } else if (incoterm === "CIF" || incoterm === "CFR" || incoterm === "DAP") {
    // CIF/CFR/DAP = seller delivers TO the disport → first port is disport.
    // Second token (if any) is usually a region qualifier we already stripped;
    // treat it as extra info, not a second port.
    if (tokens.length >= 1) disport = tokens[0];
    if (tokens.length >= 2) loadport = tokens.slice(1).join(" ");
  }

  // Also scan for "loading X in Y" (explicit loadport note).
  const loadingIn = body.match(/loading\b[^.\n]*?\bin\s+([A-Z][A-Za-z]+)/);
  if (loadingIn) loadport = loadport ?? loadingIn[1];

  const classification: Classification =
    loadport && disport
      ? "both"
      : loadport
        ? "loadport_only"
        : disport
          ? "disport_only"
          : "unclear";

  return {
    file,
    incoterm,
    deliveryLine: line,
    classification,
    detail: `incoterm=${incoterm} load=${loadport ?? "-"} disport=${disport ?? "-"}`,
  };
}

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".eml"));
  const results: Result[] = [];
  for (const f of files) {
    const body = readFileSync(join(DIR, f), "utf-8");
    results.push(classify(f, body));
  }
  const groups: Record<Classification, Result[]> = {
    loadport_only: [],
    disport_only: [],
    both: [],
    unclear: [],
    no_delivery_line: [],
  };
  for (const r of results) groups[r.classification].push(r);
  console.log("Total files:", results.length);
  for (const [k, v] of Object.entries(groups)) {
    console.log(`  ${k}: ${v.length}`);
  }
  console.log();
  console.log("--- LOADPORT_ONLY ---");
  for (const r of groups.loadport_only) console.log(`  ${r.file}: ${r.deliveryLine}`);
  console.log();
  console.log("--- DISPORT_ONLY ---");
  for (const r of groups.disport_only) console.log(`  ${r.file}: ${r.deliveryLine}`);
  console.log();
  console.log("--- BOTH ---");
  for (const r of groups.both) console.log(`  ${r.file}: ${r.deliveryLine}`);
  console.log();
  console.log("--- UNCLEAR (needs manual review) ---");
  for (const r of groups.unclear) console.log(`  ${r.file}: ${r.deliveryLine}`);
  console.log();
  console.log("--- NO_DELIVERY_LINE (amendments usually) ---");
  for (const r of groups.no_delivery_line) console.log(`  ${r.file}`);
}

main();
