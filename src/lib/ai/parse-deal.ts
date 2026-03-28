import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// TYPES
// ============================================================

export interface ParsedDealFields {
  counterparty: string | null;
  direction: "buy" | "sell" | null;
  product: string | null;
  quantity_mt: number | null;
  incoterm: "FOB" | "CIF" | "CFR" | "DAP" | "FCA" | null;
  loadport: string | null;
  discharge_port: string | null;
  laycan_start: string | null; // YYYY-MM-DD
  laycan_end: string | null;   // YYYY-MM-DD
  vessel_name: string | null;
  vessel_imo: string | null;
  pricing_formula: string | null;
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
For quantities, extract the number in metric tonnes (MT). Convert from BBLs if needed (1 MT ≈ 7.5 BBLs for gasoline).
For direction: "buy" means we are purchasing, "sell" means we are selling.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_deal",
  description: "Extract structured deal information from the trading email or recap",
  input_schema: {
    type: "object" as const,
    properties: {
      counterparty: { type: "string", description: "Company name of the trading counterparty" },
      direction: { type: "string", enum: ["buy", "sell"], description: "Trade direction from our perspective" },
      product: { type: "string", description: "Product grade (e.g. EBOB, RBOB, Eurobob Oxy, Light Naphtha, Reformate)" },
      quantity_mt: { type: "number", description: "Quantity in metric tonnes" },
      incoterm: { type: "string", enum: ["FOB", "CIF", "CFR", "DAP", "FCA"], description: "Incoterm" },
      loadport: { type: "string", description: "Loading port or terminal city" },
      discharge_port: { type: "string", description: "Discharge port or terminal city" },
      laycan_start: { type: "string", description: "Laycan start date in YYYY-MM-DD format" },
      laycan_end: { type: "string", description: "Laycan end date in YYYY-MM-DD format" },
      vessel_name: { type: "string", description: "Vessel name if mentioned, null otherwise" },
      vessel_imo: { type: "string", description: "Vessel IMO number if mentioned, null otherwise" },
      pricing_formula: { type: "string", description: "Pricing formula or price if mentioned (e.g. 'Platts CIF NWE +$5/MT')" },
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
          incoterm: { type: "number" },
          loadport: { type: "number" },
          discharge_port: { type: "number" },
          laycan_start: { type: "number" },
          laycan_end: { type: "number" },
          vessel_name: { type: "number" },
          vessel_imo: { type: "number" },
          pricing_formula: { type: "number" },
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
    model: "claude-sonnet-4-6",
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
    incoterm: (input.incoterm as ParsedDealFields["incoterm"]) ?? null,
    loadport: (input.loadport as string) ?? null,
    discharge_port: (input.discharge_port as string) ?? null,
    laycan_start: (input.laycan_start as string) ?? null,
    laycan_end: (input.laycan_end as string) ?? null,
    vessel_name: (input.vessel_name as string) ?? null,
    vessel_imo: (input.vessel_imo as string) ?? null,
    pricing_formula: (input.pricing_formula as string) ?? null,
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
// DEMO MODE (when no API key)
// ============================================================

export function parseDealDemo(rawText: string): ParsedDealResult {
  // Simple regex-based demo extraction for when API key is absent
  const text = rawText.toLowerCase();

  const directionMatch = text.match(/\b(sell|sold|sale|buy|bought|purchase)\b/i);
  const direction = directionMatch
    ? (["sell", "sold", "sale"].includes(directionMatch[1].toLowerCase()) ? "sell" : "buy")
    : null;

  const incotermMatch = rawText.match(/\b(FOB|CIF|CFR|DAP|FCA)\b/);
  const incoterm = incotermMatch ? incotermMatch[1] as ParsedDealFields["incoterm"] : null;

  const qtyMatch = rawText.match(/(\d[\d,]+)\s*(?:mt|mts|metric\s*tons?)/i);
  const quantity_mt = qtyMatch ? parseFloat(qtyMatch[1].replace(/,/g, "")) : null;

  const productMatch = rawText.match(/\b(EBOB|RBOB|Eurobob|Reformate|Naphtha|Isomerate|Alkylate|Gasoline)\b/i);
  const product = productMatch ? productMatch[1] : null;

  return {
    fields: {
      counterparty: null,
      direction,
      product,
      quantity_mt,
      incoterm,
      loadport: null,
      discharge_port: null,
      laycan_start: null,
      laycan_end: null,
      vessel_name: null,
      vessel_imo: null,
      pricing_formula: null,
      special_instructions: null,
      external_ref: null,
    },
    confidenceScores: {
      counterparty: 0,
      direction: direction ? 0.7 : 0,
      product: product ? 0.8 : 0,
      quantity_mt: quantity_mt ? 0.85 : 0,
      incoterm: incoterm ? 0.9 : 0,
      loadport: 0,
      discharge_port: 0,
      laycan_start: 0,
      laycan_end: 0,
      vessel_name: 0,
      vessel_imo: 0,
      pricing_formula: 0,
      special_instructions: 0,
      external_ref: 0,
    },
    rawResponse: "demo",
  };
}
