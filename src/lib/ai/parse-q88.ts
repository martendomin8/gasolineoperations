import Anthropic from "@anthropic-ai/sdk";
import type { VesselParticulars, VesselTank, VesselLoadline } from "@/lib/db/schema";

// ============================================================
// TYPES
// ============================================================

export interface ParsedQ88Result {
  vesselName: string | null;
  vesselImo: string | null;
  particulars: VesselParticulars;
  confidenceScores: Record<string, number>;
  rawResponse: string;
}

// ============================================================
// TEXT EXTRACTION
// ============================================================

/**
 * Extract plain text from a PDF or Word document buffer.
 * Q88s come as both — older ones are Word, newer often PDF.
 * Throws on extraction failure so the caller can surface a useful message;
 * returns an empty string only when the file type is unsupported.
 */
export async function extractQ88Text(
  buffer: Buffer,
  extension: string
): Promise<string> {
  const ext = extension.toLowerCase().replace(/^\./, "");

  if (ext === "pdf") {
    // pdf-parse v2.x exports a PDFParse class. Convert the Node Buffer to a
    // plain Uint8Array — pdf-parse's types are strict about the `data` shape.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    });
    const result = await parser.getText();
    return result.text ?? "";
  }

  if (ext === "doc" || ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }

  return "";
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `You are an expert at parsing Q88 vessel questionnaires — the standard form used in tanker chartering.

Q88 forms describe the vessel's technical specifications: dimensions, deadweight, tank layout, coatings, class, flag, etc. Your job is to extract these into a structured object so an operator can auto-populate a stowage plan without retyping.

Guidance:
- Vessel name: usually at the top of the form, possibly with the "MT" / "M/V" prefix — strip the prefix and return only the name (e.g. "MT NORDIC BREEZE" → "NORDIC BREEZE").
- IMO: always exactly 7 digits, often shown as "IMO No. 9123456" or on the same line as the vessel name. Return only the 7 digits.
- DWT: summer deadweight in metric tonnes. If multiple deadweights are given (summer / winter / tropical), prefer the summer value.
- LOA, beam, draft: in metres. Convert if the form uses feet (1 ft = 0.3048 m).
- Flag: country of registration (e.g. "Marshall Islands", "Liberia", "Malta").
- Class society: e.g. "DNV", "ABS", "Lloyd's Register", "BV", "NK".
- Built year: the year the vessel was built/delivered.
- Vessel type: e.g. "MR Tanker", "Chemical/Oil Tanker", "LR1", "Panamax".
- Tank count: total number of cargo tanks (excluding slop tanks unless the form doesn't separate them).
- Tanks array: extract every cargo tank row from the tank capacity table. Name examples: "1P" (tank 1 port), "1S" (tank 1 starboard), "2P", "2S", ..., "SLOP P", "SLOP S". Capacity at 100% and at 98% should both be in cubic metres (m³). If the form uses barrels, convert (1 m³ ≈ 6.2898 bbl, so m³ = bbl / 6.2898). If only one of 100% / 98% is given, leave the other null.
- Total cargo capacity: the SUM across all cargo tanks in m³. Sometimes the form states this directly — prefer the stated value over a computed one.
- Coating: e.g. "Epoxy", "Phenolic epoxy", "Zinc silicate", "Marineline 784". If different tanks have different coatings, put the dominant one here and the per-tank values in the tanks array.
- Segregations: number of independent cargo segregations (often called "grades" in the Q88).
- Pump type: e.g. "Deep well submerged", "Centrifugal", "Framo".
- Loadlines: Q88 Section 1.39 shows a table with rows for Summer, Winter, Tropical, Fresh, Tropical Fresh — each with Freeboard / Draft / Deadweight / Displacement columns. Extract EVERY row into the loadlines array. Also include any "Assigned DWT 1/2/3..." rows from Section 1.40/1.41 (multi-SDWT vessels) — use name "Assigned DWT 1", "Assigned DWT 2", etc. The DWT (deadweight) column is the one the planner cares about; freeboard and draft may not always be present for Assigned DWT rows.
- Top-level DWT: prefer the Summer loadline's DWT (this is the industry default — "summer deadweight"). If the vessel is multi-SDWT and "Assigned DWT 1" is different from the Summer row, Summer still wins for the top-level field; the planner will let the operator pick a specific Assigned DWT from the loadlines array.

Confidence scores (0.0-1.0):
- 0.9-1.0: explicitly stated in the form.
- 0.7-0.89: inferred from adjacent fields with low risk.
- 0.5-0.69: inferred with some uncertainty.
- Below 0.5: leave field null.

NEVER invent data. If a field is missing or ambiguous, return null. A wrong DWT or capacity is a costly stowage mistake.`;

// ============================================================
// TOOL SCHEMA
// ============================================================

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_q88",
  description: "Extract structured vessel particulars from a Q88 questionnaire",
  input_schema: {
    type: "object" as const,
    properties: {
      vessel_name: { type: "string", description: "Vessel name without 'MT' / 'M/V' prefix" },
      vessel_imo: { type: "string", description: "7-digit IMO number" },
      dwt: { type: "number", description: "Summer deadweight in metric tonnes" },
      loa: { type: "number", description: "Length overall in metres" },
      beam: { type: "number", description: "Breadth/beam in metres" },
      summer_draft: { type: "number", description: "Summer draft in metres" },
      flag: { type: "string", description: "Country of registration" },
      class_society: { type: "string", description: "Classification society (DNV, ABS, LR, BV, NK, etc.)" },
      built_year: { type: "number", description: "Year the vessel was built" },
      builder: { type: "string", description: "Shipyard / builder name" },
      vessel_type: { type: "string", description: "e.g. 'MR Tanker', 'Chemical/Oil Tanker'" },
      tank_count: { type: "number", description: "Number of cargo tanks" },
      total_cargo_capacity_98: { type: "number", description: "Total cargo capacity at 98% in m³" },
      total_cargo_capacity_100: { type: "number", description: "Total cargo capacity at 100% in m³" },
      coating: { type: "string", description: "Dominant cargo tank coating" },
      segregations: { type: "number", description: "Number of independent cargo segregations" },
      pump_type: { type: "string", description: "Cargo pump type" },
      tanks: {
        type: "array",
        description: "List of cargo tanks with capacities",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Tank identifier (e.g. '1P', '1S', 'SLOP P')" },
            capacity_100: { type: "number", description: "Capacity at 100% in m³" },
            capacity_98: { type: "number", description: "Capacity at 98% in m³" },
            coating: { type: "string", description: "Per-tank coating if it differs" },
          },
          required: ["name"],
        },
      },
      loadlines: {
        type: "array",
        description:
          "Every row from the Q88 loadline table (Summer / Winter / Tropical / Fresh / Tropical Fresh) plus any 'Assigned DWT N' rows for multi-SDWT vessels. The planner uses this to let the operator select the voyage-applicable DWT ceiling.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Loadline name, e.g. 'Summer', 'Winter', 'Tropical', 'Fresh', 'Tropical Fresh', 'Assigned DWT 1'",
            },
            freeboard: { type: "number", description: "Freeboard in metres" },
            draft: { type: "number", description: "Draft in metres" },
            dwt: { type: "number", description: "Deadweight in MT" },
            displacement: { type: "number", description: "Displacement in MT" },
          },
          required: ["name"],
        },
      },
      confidence_scores: {
        type: "object",
        description: "Confidence score 0.0-1.0 per extracted field",
        additionalProperties: { type: "number" },
      },
    },
    required: ["confidence_scores"],
  },
};

// ============================================================
// ENTRY POINT
// ============================================================

/**
 * Parse Q88 text into structured vessel particulars via Anthropic Claude.
 * The caller is responsible for text extraction (extractQ88Text) beforehand.
 *
 * Behind an abstract interface so the AI provider can be swapped per deployment
 * (Azure OpenAI, AWS Bedrock, local model) — see CLAUDE.md on-prem requirement.
 */
export async function parseQ88(text: string): Promise<ParsedQ88Result> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic({ apiKey });

  // Q88s can be very long (20+ pages). Trim to stay under context limits while
  // keeping the tank tables, which are usually in the first 60-70% of the form.
  const MAX_CHARS = 40_000;
  const trimmed = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_q88" },
    messages: [
      {
        role: "user",
        content: `Extract the vessel particulars from this Q88 form:\n\n${trimmed}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const confidence = (raw.confidence_scores as Record<string, number>) ?? {};

  const tanks: VesselTank[] = Array.isArray(raw.tanks)
    ? (raw.tanks as Array<Record<string, unknown>>).map((t) => ({
        name: String(t.name ?? ""),
        capacity100: typeof t.capacity_100 === "number" ? t.capacity_100 : null,
        capacity98: typeof t.capacity_98 === "number" ? t.capacity_98 : null,
        coating: typeof t.coating === "string" ? t.coating : null,
      }))
    : [];

  const loadlines: VesselLoadline[] = Array.isArray(raw.loadlines)
    ? (raw.loadlines as Array<Record<string, unknown>>).map((l) => ({
        name: String(l.name ?? ""),
        freeboard: typeof l.freeboard === "number" ? l.freeboard : null,
        draft: typeof l.draft === "number" ? l.draft : null,
        dwt: typeof l.dwt === "number" ? l.dwt : null,
        displacement: typeof l.displacement === "number" ? l.displacement : null,
      }))
    : [];

  const particulars: VesselParticulars = {
    dwt: numOrNull(raw.dwt),
    loa: numOrNull(raw.loa),
    beam: numOrNull(raw.beam),
    summerDraft: numOrNull(raw.summer_draft),
    flag: strOrNull(raw.flag),
    classSociety: strOrNull(raw.class_society),
    builtYear: numOrNull(raw.built_year),
    builder: strOrNull(raw.builder),
    vesselType: strOrNull(raw.vessel_type),
    tankCount: numOrNull(raw.tank_count),
    totalCargoCapacity98: numOrNull(raw.total_cargo_capacity_98),
    totalCargoCapacity100: numOrNull(raw.total_cargo_capacity_100),
    coating: strOrNull(raw.coating),
    segregations: numOrNull(raw.segregations),
    pumpType: strOrNull(raw.pump_type),
    tanks: tanks.length > 0 ? tanks : undefined,
    loadlines: loadlines.length > 0 ? loadlines : undefined,
  };

  return {
    vesselName: strOrNull(raw.vessel_name),
    vesselImo: strOrNull(raw.vessel_imo),
    particulars,
    confidenceScores: confidence,
    rawResponse: JSON.stringify(raw),
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
