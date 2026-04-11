import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// TYPES
// ============================================================

export interface ParsedDealFields {
  counterparty: string | null;
  direction: "buy" | "sell" | null;
  product: string | null;
  quantity_mt: number | null;
  /**
   * Full contracted quantity with tolerance text EXACTLY as written in the recap,
   * e.g. "18000 MT +/-10%", "37kt +/- 5%". This preserves the operator's view of
   * the original contractual number. `quantity_mt` stays the numeric middle value
   * for calculations.
   */
  contracted_qty: string | null;
  incoterm: "FOB" | "CIF" | "CFR" | "DAP" | "FCA" | null;
  loadport: string | null;
  discharge_port: string | null;
  laycan_start: string | null; // YYYY-MM-DD
  laycan_end: string | null;   // YYYY-MM-DD
  vessel_name: string | null;
  vessel_imo: string | null;
  pricing_formula: string | null;
  pricing_period_type: "BL" | "NOR" | "Fixed" | "EFP" | null;
  pricing_period_value: string | null;
  special_instructions: string | null;
  external_ref: string | null;
}

export interface ParsedDealResult {
  fields: ParsedDealFields;
  confidenceScores: Record<keyof ParsedDealFields, number>;
  rawResponse: string;
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `You are an expert at parsing gasoline and petroleum product trading deal confirmations and recap emails.

Your job is to extract structured deal information from unstructured trader emails, chat messages, or deal recap texts. You understand commodity trading terminology: laycan, incoterm, FOB, CIF, CFR, DAP, EBOB, RBOB, naphtha, reformate, etc.

Be precise and conservative with confidence scores:
- 0.9-1.0: Explicitly stated in the text, no ambiguity
- 0.7-0.89: Likely correct but requires minor inference
- 0.5-0.69: Inferred from context, some uncertainty
- 0.0-0.49: Guessed or not mentioned — set field to null instead

For dates, always output YYYY-MM-DD format. If only a month/year is given (e.g. "April 5/7"), use the current year.
For quantities: extract TWO values. (1) quantity_mt = the numeric middle/nominal quantity in metric tonnes (e.g. for "18000 MT +/-10%" → 18000; for "37kt +/-5%" → 37000). Convert from BBLs if needed (1 MT ≈ 7.5 BBLs for gasoline). (2) contracted_qty = the full text EXACTLY as written in the recap, including units and tolerance, e.g. "18000 MT +/-10%", "37kt +/- 5%", "25,000 MT +/-10% in buyer's option". Preserve the original spacing and casing. If there is no tolerance stated, contracted_qty can be just the plain quantity string (e.g. "30,000 MT").
For direction: "buy" means we are purchasing, "sell" means we are selling.
For pricing: extract both the pricing formula (e.g. 'Platts FOB Baltic +$5.50/MT') AND the pricing period type (BL, NOR, Fixed, or EFP) with its parameters (e.g. '0-1-5'). BL+5 is shorthand for BL 0-0-5.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_deal",
  description: "Extract structured deal information from the trading email or recap",
  input_schema: {
    type: "object" as const,
    properties: {
      counterparty: { type: "string", description: "Company name of the trading counterparty" },
      direction: { type: "string", enum: ["buy", "sell"], description: "Trade direction from our perspective" },
      product: { type: "string", description: "Product grade (e.g. EBOB, RBOB, Eurobob Oxy, Light Naphtha, Reformate)" },
      quantity_mt: { type: "number", description: "Numeric middle/nominal quantity in metric tonnes (e.g. 18000 for '18000 MT +/-10%', 37000 for '37kt +/-5%')" },
      contracted_qty: { type: "string", description: "Full contracted quantity with tolerance, EXACTLY as written in the recap including units and tolerance notation. Examples: '18000 MT +/-10%', '37kt +/- 5%', '25,000 MT +/-10% in buyer's option'. If no tolerance is stated, the plain quantity string is fine." },
      incoterm: { type: "string", enum: ["FOB", "CIF", "CFR", "DAP", "FCA"], description: "Incoterm" },
      loadport: { type: "string", description: "Loading port or terminal city" },
      discharge_port: { type: "string", description: "Discharge port or terminal city" },
      laycan_start: { type: "string", description: "Laycan start date in YYYY-MM-DD format" },
      laycan_end: { type: "string", description: "Laycan end date in YYYY-MM-DD format" },
      vessel_name: { type: "string", description: "Vessel name if mentioned, null otherwise" },
      vessel_imo: { type: "string", description: "Vessel IMO number if mentioned, null otherwise" },
      pricing_formula: { type: "string", description: "Pricing formula or price if mentioned (e.g. 'Platts CIF NWE +$5/MT')" },
      pricing_period_type: { type: "string", enum: ["BL", "NOR", "Fixed", "EFP"], description: "Pricing period type. BL = Bill of Lading pricing, NOR = Notice of Readiness pricing, Fixed = fixed calendar period, EFP = Exchange for Physical" },
      pricing_period_value: { type: "string", description: "Pricing period parameters. For BL/NOR: day window like '0-1-5' (days before, BL/NOR day counts 1=yes 0=no, days after). For Fixed: date range like '1-15 Mar'. For EFP: empty." },
      special_instructions: { type: "string", description: "Any special instructions, SCAC codes, or operational notes" },
      external_ref: { type: "string", description: "Any deal reference number or ID if mentioned" },
      confidence_scores: {
        type: "object",
        description: "Confidence score (0-1) for each extracted field",
        properties: {
          counterparty: { type: "number" },
          direction: { type: "number" },
          product: { type: "number" },
          quantity_mt: { type: "number" },
          contracted_qty: { type: "number" },
          incoterm: { type: "number" },
          loadport: { type: "number" },
          discharge_port: { type: "number" },
          laycan_start: { type: "number" },
          laycan_end: { type: "number" },
          vessel_name: { type: "number" },
          vessel_imo: { type: "number" },
          pricing_formula: { type: "number" },
          pricing_period_type: { type: "number" },
          pricing_period_value: { type: "number" },
          special_instructions: { type: "number" },
          external_ref: { type: "number" },
        },
      },
    },
    required: ["confidence_scores"],
  },
};

// ============================================================
// PARSE FUNCTION
// ============================================================

export async function parseDealFromText(rawText: string): Promise<ParsedDealResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Please extract the deal information from the following text:\n\n---\n${rawText}\n---`,
      },
    ],
  });

  // Find the tool use block
  const toolUse = response.content.find((block) => block.type === "tool_use");

  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return structured data");
  }

  const input = toolUse.input as Record<string, unknown>;
  const confidenceScores = (input.confidence_scores ?? {}) as Record<string, number>;

  const fields: ParsedDealFields = {
    counterparty: (input.counterparty as string) ?? null,
    direction: (input.direction as "buy" | "sell") ?? null,
    product: (input.product as string) ?? null,
    quantity_mt: (input.quantity_mt as number) ?? null,
    contracted_qty: (input.contracted_qty as string) ?? null,
    incoterm: (input.incoterm as ParsedDealFields["incoterm"]) ?? null,
    loadport: (input.loadport as string) ?? null,
    discharge_port: (input.discharge_port as string) ?? null,
    laycan_start: (input.laycan_start as string) ?? null,
    laycan_end: (input.laycan_end as string) ?? null,
    vessel_name: (input.vessel_name as string) ?? null,
    vessel_imo: (input.vessel_imo as string) ?? null,
    pricing_formula: (input.pricing_formula as string) ?? null,
    pricing_period_type: (input.pricing_period_type as ParsedDealFields["pricing_period_type"]) ?? null,
    pricing_period_value: (input.pricing_period_value as string) ?? null,
    special_instructions: (input.special_instructions as string) ?? null,
    external_ref: (input.external_ref as string) ?? null,
  };

  // Build typed confidence scores with defaults
  const fieldKeys = Object.keys(fields) as (keyof ParsedDealFields)[];
  const typedScores = Object.fromEntries(
    fieldKeys.map((k) => [k, confidenceScores[k] ?? 0])
  ) as Record<keyof ParsedDealFields, number>;

  return {
    fields,
    confidenceScores: typedScores,
    rawResponse: JSON.stringify(input),
  };
}

// ============================================================
// DEMO MODE — rule-based extractor (no API key required)
// ============================================================

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function toDate(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseLaycan(raw: string): { start: string | null; end: string | null } {
  const year = new Date().getFullYear();

  // "5/7 April 2026" or "5-7 April" or "10-12/4" etc.
  const rangeMonth = raw.match(/(\d{1,2})[\/\-](\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (rangeMonth) {
    const d1 = parseInt(rangeMonth[1]);
    const d2 = parseInt(rangeMonth[2]);
    const mon = MONTH_MAP[rangeMonth[3].toLowerCase()];
    const yr = rangeMonth[4] ? parseInt(rangeMonth[4]) : year;
    if (mon) return { start: toDate(d1, mon, yr), end: toDate(d2, mon, yr) };
  }

  // "10-12 April 2026"
  const rangeFull = raw.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (rangeFull) {
    const d1 = parseInt(rangeFull[1]);
    const d2 = parseInt(rangeFull[2]);
    const mon = MONTH_MAP[rangeFull[3].toLowerCase()];
    const yr = rangeFull[4] ? parseInt(rangeFull[4]) : year;
    if (mon) return { start: toDate(d1, mon, yr), end: toDate(d2, mon, yr) };
  }

  // "first half April" → 1-15
  const firstHalf = raw.match(/first\s+half\s+([A-Za-z]+)(?:\s+(\d{4}))?/i);
  if (firstHalf) {
    const mon = MONTH_MAP[firstHalf[1].toLowerCase()];
    const yr = firstHalf[2] ? parseInt(firstHalf[2]) : year;
    if (mon) return { start: toDate(1, mon, yr), end: toDate(15, mon, yr) };
  }

  // "second half April" → 16-30
  const secondHalf = raw.match(/second\s+half\s+([A-Za-z]+)(?:\s+(\d{4}))?/i);
  if (secondHalf) {
    const mon = MONTH_MAP[secondHalf[1].toLowerCase()];
    const yr = secondHalf[2] ? parseInt(secondHalf[2]) : year;
    if (mon) return { start: toDate(16, mon, yr), end: toDate(30, mon, yr) };
  }

  // "end of April" / "end April" → 26-30
  const endOf = raw.match(/end\s+(?:of\s+)?([A-Za-z]+)(?:\s+(\d{4}))?/i);
  if (endOf) {
    const mon = MONTH_MAP[endOf[1].toLowerCase()];
    const yr = endOf[2] ? parseInt(endOf[2]) : year;
    if (mon) return { start: toDate(26, mon, yr), end: toDate(30, mon, yr) };
  }

  return { start: null, end: null };
}

export function parseDealDemo(rawText: string): ParsedDealResult {
  const scores: Record<string, number> = {};

  // ── Direction ────────────────────────────────────────────────
  // Explicit sell/buy verbs
  const sellMatch = rawText.match(/\b(sold|sell|sale)\b/i);
  const buyMatch  = rawText.match(/\b(bought|buy|purchase|confirmed\s+purchase)\b/i);
  // "Seller: us" vs "Buyer: us" — seller label means we're selling
  const sellerLabel = /^Seller\s*:/im.test(rawText);
  const buyerLabel  = /^Buyer\s*:/im.test(rawText);

  let direction: "buy" | "sell" | null = null;
  if (sellMatch || sellerLabel) {
    direction = "sell";
    scores.direction = 0.9;
  } else if (buyMatch || buyerLabel) {
    direction = "buy";
    scores.direction = 0.9;
  } else {
    scores.direction = 0;
  }

  // ── Counterparty ─────────────────────────────────────────────
  let counterparty: string | null = null;
  // "Buyer: Shell Trading Rotterdam" or "Seller: Vitol SA"
  const cpLabel = rawText.match(/^(?:Buyer|Seller|Counterparty)\s*:\s*(.+)$/im);
  if (cpLabel) {
    counterparty = cpLabel[1].trim();
    scores.counterparty = 0.92;
  } else {
    // "sold to X" / "confirmed sale to X" (adjacent)
    const soldTo = rawText.match(/sold\s+to\s+([A-Z][A-Za-z0-9 &.,'-]{2,40})/);
    if (soldTo) { counterparty = soldTo[1].trim(); scores.counterparty = 0.8; }
    else {
      // "purchase from X" / "confirmed purchase from X" / "bought from X"
      const buyFrom = rawText.match(/(?:purchase\s+from|bought\s+from|confirmed\s+(?:purchase|buy)\s+from)\s+([A-Z][A-Za-z0-9 &.,'-]{2,40})/i);
      if (buyFrom) { counterparty = buyFrom[1].trim(); scores.counterparty = 0.8; }
      else {
        // "Confirm sale to X" / "Confirmed sold to X"
        const confirmTo = rawText.match(/confirm(?:ed)?\s+(?:sale?|sold)\s+to\s+([A-Z][A-Za-z0-9 &.,'-]{2,40})/i);
        if (confirmTo) { counterparty = confirmTo[1].trim(); scores.counterparty = 0.78; }
        else {
          // "Sold 22,000 MT UNL95 CIF to Total Energies" — sold anywhere on line, then "to X"
          const soldLineTo = rawText.match(/\bsold\b[\s\S]{0,100}?\bto\s+([A-Z][A-Za-z0-9 &.,'-]{2,40})/i);
          if (soldLineTo) { counterparty = soldLineTo[1].trim(); scores.counterparty = 0.72; }
          else {
            // "Deal confirmed with X" / "confirmed with X"
            const confirmedWith = rawText.match(/confirmed?\s+(?:deal\s+)?with\s+([A-Z][A-Za-z0-9 &.,'-]{2,40})/i);
            if (confirmedWith) { counterparty = confirmedWith[1].trim(); scores.counterparty = 0.82; }
          }
        }
      }
    }
  }
  // Strip trailing punctuation / sentence overflow
  if (counterparty) counterparty = counterparty.replace(/[,:;.].*$/, "").trim();

  // ── Incoterm ─────────────────────────────────────────────────
  const incotermMatch = rawText.match(/\b(FOB|CIF|CFR|DAP|FCA)\b/);
  const incoterm = incotermMatch ? (incotermMatch[1] as ParsedDealFields["incoterm"]) : null;
  scores.incoterm = incoterm ? 0.95 : 0;

  // ── Product ──────────────────────────────────────────────────
  const productMatch = rawText.match(
    /\b(EBOB|RBOB|Eurobob(?:\s+Oxy)?|Reformate|Light\s+Naphtha|Naphtha|Isomerate|Alkylate|Gasoline|UNL\s*95|UNL\s*98|RON\s*95|RON\s*98)\b/i
  );
  const product = productMatch ? productMatch[1] : null;
  scores.product = product ? 0.88 : 0;

  // ── Quantity ─────────────────────────────────────────────────
  let quantity_mt: number | null = null;
  let contracted_qty: string | null = null;
  // "30,000 MT" / "30kt" / "30 KT" / "28,500 metric tonnes"
  const qtyMT  = rawText.match(/(\d[\d,]+)\s*(?:mt|mts|metric\s*ton(?:ne)?s?)\b/i);
  const qtyKT  = rawText.match(/(\d+(?:\.\d+)?)\s*kt\b/i);
  if (qtyMT)      { quantity_mt = parseFloat(qtyMT[1].replace(/,/g, "")); scores.quantity_mt = 0.9; }
  else if (qtyKT) { quantity_mt = parseFloat(qtyKT[1]) * 1000;            scores.quantity_mt = 0.85; }
  else             { scores.quantity_mt = 0; }

  // Contracted qty with tolerance — capture the full text including tolerance,
  // e.g. "18000 MT +/-10%", "37kt +/- 5%", "25,000 MT +/- 10%".
  // Pattern tries to match number + unit + optional tolerance in one chunk.
  const qtyTolerance = rawText.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(mt|mts|kt|metric\s*ton(?:ne)?s?)\s*([+\-±]\s*\/?\s*[+\-]?\s*\d+(?:\.\d+)?\s*%)/i
  );
  if (qtyTolerance) {
    contracted_qty = qtyTolerance[0].replace(/\s+/g, " ").trim();
    scores.contracted_qty = 0.92;
  } else if (qtyMT) {
    contracted_qty = qtyMT[0].replace(/\s+/g, " ").trim();
    scores.contracted_qty = 0.7;
  } else if (qtyKT) {
    contracted_qty = qtyKT[0].replace(/\s+/g, " ").trim();
    scores.contracted_qty = 0.7;
  } else {
    scores.contracted_qty = 0;
  }

  // ── Ports ────────────────────────────────────────────────────
  const PORT_ALIASES: Record<string, string> = {
    rdam: "Rotterdam", rotterdam: "Rotterdam",
    ams: "Amsterdam", amsterdam: "Amsterdam",
    kly: "Klaipeda", klaipeda: "Klaipeda", klapeda: "Klaipeda",
    antwerp: "Antwerp", anr: "Antwerp",
    houston: "Houston", ny: "New York", "new york": "New York",
    singapore: "Singapore", barcelona: "Barcelona",
  };

  function normalisePort(raw: string): string {
    const key = raw.trim().toLowerCase();
    return PORT_ALIASES[key] ?? raw.trim();
  }

  let loadport: string | null = null;
  let discharge_port: string | null = null;

  // Labelled: "Load Port: X" / "Load: X" / "Loading port: X"
  const loadLabel = rawText.match(/^(?:Load(?:ing)?(?:\s+Port)?|Loadport)\s*:\s*(.+)$/im);
  if (loadLabel) { loadport = normalisePort(loadLabel[1].split(",")[0]); scores.loadport = 0.92; }

  // Labelled: "Discharge: X" / "Disch: X" / "Discharge Port: X"
  const dischLabel = rawText.match(/^(?:Disch(?:arge)?(?:\s+Port)?)\s*:\s*(.+)$/im);
  if (dischLabel) { discharge_port = normalisePort(dischLabel[1].split(",")[0]); scores.discharge_port = 0.92; }

  // "Load Antwerp, discharge Singapore" (no colon, inline)
  if (!loadport) {
    // Matches "Load Klaipeda" or "Loading Antwerp" when no colon present
    const loadNoColon = rawText.match(/\bLoad(?:ing)?\s+([A-Z][A-Za-z][a-z]+)\b/);
    if (loadNoColon) { loadport = normalisePort(loadNoColon[1]); scores.loadport = 0.75; }
  }

  // "discharge Singapore" (no colon, inline)
  if (!discharge_port) {
    const dischNoColon = rawText.match(/\bdischarge\s+([A-Z][A-Za-z][a-z]+)\b/);
    if (dischNoColon) { discharge_port = normalisePort(dischNoColon[1]); scores.discharge_port = 0.75; }
  }

  // Inline: "FOB Rotterdam" / "CIF New York" — port follows incoterm
  // Note: exclude prepositions and generic words so "CIF to Buyer" / "FOB basis" don't become ports
  const NON_PORTS = ["to", "from", "the", "basis", "terms", "delivery", "contract", "price", "platts", "swap", "cargo"];
  if (!loadport && incoterm) {
    const portAfterInco = rawText.match(new RegExp(`\\b${incoterm}\\s+(?!${NON_PORTS.join("\\b|")}\\b)([A-Z][A-Za-z][a-z]+(?:\\s+[A-Z][A-Za-z]+)?)(?:[,\\n]|$)`, "i"));
    if (portAfterInco) {
      const candidate = portAfterInco[1].trim();
      // For FOB: incoterm port is the loadport. For CIF/CFR/DAP: it's the discharge.
      if (incoterm === "FOB" || incoterm === "FCA") {
        loadport = normalisePort(candidate);
        scores.loadport = 0.78;
      } else if (!discharge_port) {
        discharge_port = normalisePort(candidate);
        scores.discharge_port = 0.78;
      }
    }
  }

  // Known-port last-resort: scan for city names when no loadport yet
  // e.g. "FOB basis, Klaipeda terminal" — "Klaipeda" is loadport even without label
  // Skip any port already assigned as discharge_port to avoid double-assignment
  if (!loadport) {
    const KNOWN_PORT_NAMES = ["Rotterdam", "Amsterdam", "Antwerp", "Klaipeda", "Houston", "Singapore", "Barcelona", "New York", "Marseille", "Algeciras", "Genova"];
    for (const p of KNOWN_PORT_NAMES) {
      if (p.toLowerCase() === discharge_port?.toLowerCase()) continue; // already assigned
      const esc = p.replace(/\s+/g, "\\s+");
      if (rawText.match(new RegExp(`\\b${esc}\\b`, "i"))) {
        loadport = p;
        scores.loadport = 0.6;
        break;
      }
    }
  }

  if (!loadport)       scores.loadport = 0;
  if (!discharge_port) scores.discharge_port = 0;

  // ── Laycan ───────────────────────────────────────────────────
  const laycanSection = rawText.match(/Laycan\s*(?:dates?)?\s*[:\s]\s*(.{5,40})/i);
  let laycan_start: string | null = null;
  let laycan_end:   string | null = null;

  if (laycanSection) {
    const { start, end } = parseLaycan(laycanSection[1]);
    laycan_start = start;
    laycan_end   = end;
    scores.laycan_start = start ? 0.85 : 0;
    scores.laycan_end   = end   ? 0.85 : 0;
  } else {
    scores.laycan_start = 0;
    scores.laycan_end   = 0;
  }

  // ── Vessel ───────────────────────────────────────────────────
  let vessel_name: string | null = null;
  let vessel_imo:  string | null = null;

  const vesselLine = rawText.match(/Vessel\s*:\s*(.+)/i) ?? rawText.match(/\bMT\s+([A-Z][A-Za-z\s]+?)(?:,|\s+IMO|\s*$)/i);
  if (vesselLine) {
    const rawVessel = vesselLine[1].trim();
    // Strip "MT " prefix if present
    const candidateName = rawVessel.replace(/^MT\s+/i, "").split(/,|\s+IMO/i)[0].trim();
    // "TBN" / "TBA" / "TBD" means no vessel yet
    // Also filter out descriptive text that isn't a real vessel name
    const NON_VESSEL_PHRASES = /\b(nominated|to be|TBD|TBA|TBN|TBC|not yet|pending|within|days?|before|after)\b/i;
    if (/^TB[NADC]$/i.test(candidateName) || NON_VESSEL_PHRASES.test(candidateName) || candidateName.length > 30) {
      vessel_name = null;
      scores.vessel_name = 0;
    } else {
      vessel_name = candidateName;
      scores.vessel_name = 0.88;
    }
  } else {
    scores.vessel_name = 0;
  }

  const imoMatch = rawText.match(/\bIMO\s*[:\s#]?\s*(\d{7,9})\b/i);
  if (imoMatch) { vessel_imo = imoMatch[1]; scores.vessel_imo = 0.95; }
  else           { scores.vessel_imo = 0; }

  // ── Pricing ──────────────────────────────────────────────────
  const priceMatch = rawText.match(
    /(?:Price|Px|Pricing)\s*:\s*(.{5,80}?)(?:\n|$)/i
  ) ?? rawText.match(/Platts\s+[A-Z].{5,60}/i);
  const pricing_formula = priceMatch ? priceMatch[0].trim() : null;
  scores.pricing_formula = pricing_formula ? 0.8 : 0;

  // ── Pricing Period ──────────────────────────────────────────
  let pricing_period_type: ParsedDealFields["pricing_period_type"] = null;
  let pricing_period_value: string | null = null;

  // "BL 0-1-5", "BL+5", "NOR 3-1-3", "Fixed 1-15 Mar", "EFP"
  const blShorthand = rawText.match(/\bBL\s*\+\s*(\d+)\b/i);
  const blFull = rawText.match(/\bBL\s+(\d+-\d+-\d+)\b/i);
  const norFull = rawText.match(/\bNOR\s+(\d+-\d+-\d+)\b/i);
  const fixedMatch = rawText.match(/\bFixed\s+([\d]+-[\d]+\s+[A-Za-z]+)\b/i);
  const efpMatch = rawText.match(/\bEFP\b/i);

  if (blShorthand) {
    pricing_period_type = "BL";
    pricing_period_value = `0-0-${blShorthand[1]}`;
    scores.pricing_period_type = 0.85;
    scores.pricing_period_value = 0.85;
  } else if (blFull) {
    pricing_period_type = "BL";
    pricing_period_value = blFull[1];
    scores.pricing_period_type = 0.9;
    scores.pricing_period_value = 0.9;
  } else if (norFull) {
    pricing_period_type = "NOR";
    pricing_period_value = norFull[1];
    scores.pricing_period_type = 0.9;
    scores.pricing_period_value = 0.9;
  } else if (fixedMatch) {
    pricing_period_type = "Fixed";
    pricing_period_value = fixedMatch[1];
    scores.pricing_period_type = 0.88;
    scores.pricing_period_value = 0.88;
  } else if (efpMatch) {
    pricing_period_type = "EFP";
    pricing_period_value = "";
    scores.pricing_period_type = 0.9;
    scores.pricing_period_value = 0.9;
  } else {
    scores.pricing_period_type = 0;
    scores.pricing_period_value = 0;
  }

  // ── External ref ─────────────────────────────────────────────
  const refMatch = rawText.match(/\b(?:Ref|Deal\s+ref|Recap\s+ref)\s*[:#]?\s*([A-Z0-9][-A-Z0-9]{3,20})\b/i);
  const external_ref = refMatch ? refMatch[1] : null;
  scores.external_ref = external_ref ? 0.9 : 0;

  // ── Special instructions ─────────────────────────────────────
  const specialMatch = rawText.match(/(?:Note|Special|Instructions?)\s*:\s*(.{10,200})/i);
  const special_instructions = specialMatch ? specialMatch[1].trim() : null;
  scores.special_instructions = special_instructions ? 0.75 : 0;

  const fields: ParsedDealFields = {
    counterparty, direction, product, quantity_mt, contracted_qty, incoterm,
    loadport, discharge_port, laycan_start, laycan_end,
    vessel_name, vessel_imo, pricing_formula,
    pricing_period_type, pricing_period_value,
    special_instructions, external_ref,
  };

  const confidenceScores = Object.fromEntries(
    (Object.keys(fields) as (keyof ParsedDealFields)[]).map((k) => [k, scores[k] ?? 0])
  ) as Record<keyof ParsedDealFields, number>;

  return { fields, confidenceScores, rawResponse: "rule-based" };
}
