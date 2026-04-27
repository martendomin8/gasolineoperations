import Anthropic from "@anthropic-ai/sdk";
import type { DocumentFileType } from "@/lib/db/schema";

// AI document classifier — single fast Claude call that takes the first
// few thousand chars of a document and returns the most likely doc type
// + confidence. The chip-workflow drop zone runs this on upload to pick
// which type-specific parser to dispatch.
//
// Why a separate classifier (vs. one mega "extract everything" prompt):
// per Marten's input + the architecture decision in chat 2026-04-27,
// type-specific prompts hallucinate dramatically less than a generic
// "look at this and figure it out" prompt. Classifier is the cheapest
// possible Claude call (haiku, ~500 input tokens, ~50 output) so the
// per-upload cost is negligible.

export interface DocumentClassification {
  /** The most likely doc type. The caller dispatches a type-specific parser. */
  type: DocumentFileType;
  /** Classifier confidence, 0.0 - 1.0. Below 0.6 → confirm modal asks operator. */
  confidence: number;
  /** One-line rationale for the chosen type — surfaced in the confirm modal. */
  rationale: string;
  /** Other plausible types ranked, so the operator can override via dropdown. */
  alternatives: Array<{ type: DocumentFileType; confidence: number }>;
}

const CLASSIFIER_TYPES: DocumentFileType[] = [
  "cp_recap",
  "q88",
  "sof",
  "nor",
  "vessel_nomination",
  "doc_instructions",
  "bl",
  "coa",
  "stock_report",
  "gtc",
  "spa",
  "deal_recap",
  "other",
];

const SYSTEM_PROMPT = `You classify maritime / commodity-trading documents into one of a fixed set of categories. Operators drag any document into the program; you decide which type-specific parser should handle it.

Categories and their tell-tale signs:

- cp_recap: Charter Party recap — fixture summary the freight broker emails after the vessel is fixed. Mentions OWNERS, CHARTERERS, LOADPORT, DISPORT, LAYCAN, FREIGHT (e.g. "WS150" or "$XX/MT"), DEMURRAGE, often "BPVOY4" / "ASBATANKVOY" / "SHELLVOY" form references. Usually 1-3 pages of headed text.
- q88: Q88 vessel questionnaire — standard tanker form with sections like "1. Vessel particulars", IMO, DWT, LOA, tank tables, classification society, P&I cover. Long structured form.
- sof: Statement of Facts — chronological list of vessel events at port (NOR tendered, all-fast, hose-on, commenced loading, completed, hose-off, all-clear). Lots of timestamps, often with "Local time" / "GMT" notation.
- nor: Notice of Readiness — single-page formal notice from Master that vessel is ready to load/discharge. Usually starts with "I, the Master of MV ..." and tenders NOR with a specific timestamp.
- vessel_nomination: Buyer's vessel nomination — counterparty proposes their vessel for an FOB sale. Names a vessel, IMO, ETA loadport, last 3 cargoes, sometimes Q88 attached. Often paired with documentary instructions in the same email.
- doc_instructions: Documentary instructions — counterparty tells the seller HOW Bills of Lading should be made out (consignee, notify party, marks, document set required, where originals should be sent). Sometimes embedded in the vessel_nomination email.
- bl: Bill of Lading — shipping document evidencing receipt of goods. Has carrier letterhead, "BILL OF LADING NO.", consignee, notify party, port of loading, port of discharge, vessel name, B/L date, gross/net weight.
- coa: Certificate of Analysis — quality certificate from inspector. Lists product, sample point, test parameters (RVP, density, sulphur, RON, MON, distillation), test results, test methods.
- stock_report: Terminal stock movements report — periodic report from terminal showing inventory movements (in/out/balance) per product per tank.
- gtc: General Terms and Conditions — full text of seller's or buyer's GTC referenced by the cargo SPA. Long, numbered clauses, legal language. Often called "BP Cargo Terms 2015", "Shell SGTSP 2010", etc.
- spa: Sale & Purchase Agreement — the cargo contract itself (the deal contract, NOT the charter party). References an underlying GTC. Names buyer + seller, product, quantity, incoterm, pricing formula, payment terms.
- deal_recap: Trader's deal recap — short summary the trader emails after executing a deal. "Done with X / Y MT / Loadport / Laycan / Pricing / etc." Usually 5-15 lines, less formal than SPA or GTC.
- other: Anything that doesn't match the above. Pick this only if you have low confidence in any specific category.

Output rules:
- Always return one of the listed types — do not invent new categories.
- confidence: 0.9-1.0 if multiple unambiguous markers present; 0.7-0.89 with one clear marker + supporting context; 0.5-0.69 if ambiguous; below 0.5 prefer "other".
- alternatives: at least 2 plausible runner-ups even when you're confident, so the operator can override via dropdown if you got it wrong.
- rationale: one short sentence quoting a phrase or section header from the document that drove your pick.

Be decisive. The whole point of running you is to NOT punt to "other" unnecessarily.`;

const CLASSIFIER_TOOL: Anthropic.Tool = {
  name: "classify_document",
  description: "Classify the document into one of the known maritime/trading types.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: CLASSIFIER_TYPES,
        description: "Most likely document type.",
      },
      confidence: {
        type: "number",
        description: "Classifier confidence 0.0 - 1.0.",
      },
      rationale: {
        type: "string",
        description: "One short sentence (under 30 words) quoting a phrase that drove the classification.",
      },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: CLASSIFIER_TYPES },
            confidence: { type: "number" },
          },
          required: ["type", "confidence"],
        },
        description: "At least 2 runner-up types in case the operator overrides.",
      },
    },
    required: ["type", "confidence", "rationale", "alternatives"],
  },
};

/**
 * Classify a document by its extracted text content.
 *
 * The caller is expected to have already pulled the raw text out of the
 * file (PDF / DOCX / EML / etc.) — keeps this function provider-agnostic
 * and unit-testable. ~3000 chars is enough signal for classification
 * without burning tokens; we only need the first few sections.
 */
export async function classifyDocument(text: string): Promise<DocumentClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot classify document");
  }

  const trimmed = text.slice(0, 3000).trim();
  if (trimmed.length === 0) {
    return {
      type: "other",
      confidence: 0,
      rationale: "Document text was empty — nothing to classify.",
      alternatives: [],
    };
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFIER_TOOL],
    tool_choice: { type: "tool", name: "classify_document" },
    messages: [
      {
        role: "user",
        content: `Classify this document:\n\n${trimmed}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Classifier did not return a tool_use block");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const type = (raw.type as DocumentFileType) ?? "other";
  const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const rationale = typeof raw.rationale === "string" ? raw.rationale : "";
  const alternatives = Array.isArray(raw.alternatives)
    ? (raw.alternatives as Array<Record<string, unknown>>)
        .map((a) => ({
          type: (a.type as DocumentFileType) ?? "other",
          confidence: typeof a.confidence === "number" ? Math.max(0, Math.min(1, a.confidence)) : 0,
        }))
        .filter((a) => CLASSIFIER_TYPES.includes(a.type))
    : [];

  return { type, confidence, rationale, alternatives };
}
