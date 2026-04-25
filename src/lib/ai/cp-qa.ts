/**
 * CP Q&A — answer operator questions about a fixture by reading two layers
 * in priority order:
 *
 *   1. The CP recap text (the operator's deal-specific rider clauses).
 *   2. The standard charter-party form named in the recap's TITLE block
 *      (BPVOY4 / Asbatankvoy / Shellvoy 6 / etc.) — looked up from the
 *      reference docs in `DATA/Charter Parties/<form>/`.
 *
 * The assistant always cites which layer the answer came from, so the
 * operator can verify by opening the CP recap or the base-form reference.
 *
 * The base-form registry is intentionally extensible. To add Asbatankvoy
 * (or any other form), drop a reference markdown into the matching
 * `DATA/Charter Parties/<Form>/` folder and add an entry below — no other
 * code changes needed.
 */

import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { readFile, access } from "fs/promises";

// ============================================================
// BASE-FORM REGISTRY
// ============================================================

export interface BaseFormSpec {
  /** Canonical display key, e.g. "BPVOY4". */
  key: string;
  /** Human-readable name, e.g. "BP Voyage Charter Party, 4th edition". */
  fullName: string;
  /** Path under DATA/Charter Parties/ — relative, forward slashes. */
  referencePath: string;
  /**
   * Recap-text patterns that identify this form. Case-insensitive,
   * matched against the recap's TITLE / preamble.
   */
  aliases: string[];
}

export const BASE_FORMS: BaseFormSpec[] = [
  {
    key: "BPVOY4",
    fullName: "BP Voyage Charter Party, 4th edition",
    referencePath: "BPVOY4/bpvoy4-reference.md",
    aliases: ["BPVOY4", "BPVOY 4", "BP VOY4", "BP VOY 4", "BPVOY-4"],
  },
  {
    key: "BPVOY5",
    fullName: "BP Voyage Charter Party, 5th edition",
    referencePath: "BPVOY5/bpvoy5-reference.md",
    aliases: ["BPVOY5", "BPVOY 5", "BP VOY5", "BP VOY 5", "BPVOY-5"],
  },
  {
    key: "Asbatankvoy",
    fullName: "Asbatankvoy (American Standard Tanker Voyage Charter Party)",
    referencePath: "Asbatankvoy/asbatankvoy-reference.md",
    aliases: ["ASBATANKVOY", "ASBA TANKVOY", "ASBA-TANKVOY"],
  },
  {
    key: "Shellvoy 6",
    fullName: "Shellvoy 6 — Shell Voyage Charter Party",
    referencePath: "Shellvoy 6/shellvoy6-reference.md",
    aliases: ["SHELLVOY 6", "SHELLVOY6", "SHELLVOY"],
  },
  {
    key: "Mobilvoy",
    fullName: "Mobilvoy (ExxonMobil Voyage Charter Party)",
    referencePath: "Mobilvoy/mobilvoy-reference.md",
    aliases: ["MOBILVOY", "EXXONVOY", "EXXON VOYAGE"],
  },
];

export function detectBaseForm(recapText: string): BaseFormSpec | null {
  const haystack = recapText.toUpperCase();
  for (const form of BASE_FORMS) {
    for (const alias of form.aliases) {
      if (haystack.includes(alias.toUpperCase())) {
        return form;
      }
    }
  }
  return null;
}

/**
 * Resolve the absolute filesystem path of a base-form reference doc.
 * The folder is stable across deployments because it sits at the project
 * root under DATA/, not under public/ or src/.
 */
function referenceAbsolutePath(form: BaseFormSpec): string {
  const projectRoot = process.cwd();
  return path.join(projectRoot, "DATA", "Charter Parties", form.referencePath);
}

/**
 * Read a base-form reference markdown from disk. Returns null if the
 * file doesn't exist (e.g. Asbatankvoy folder is reserved but the
 * reference hasn't been authored yet).
 */
export async function loadBaseFormReference(
  form: BaseFormSpec
): Promise<string | null> {
  const fp = referenceAbsolutePath(form);
  try {
    await access(fp);
  } catch {
    return null;
  }
  return readFile(fp, "utf8");
}

/**
 * List which base-form references actually exist on disk. Useful for the
 * UI to show "BPVOY4 (ready), Asbatankvoy (reference not authored)".
 */
export async function availableBaseForms(): Promise<
  Array<BaseFormSpec & { ready: boolean }>
> {
  const results: Array<BaseFormSpec & { ready: boolean }> = [];
  for (const form of BASE_FORMS) {
    let ready = false;
    try {
      await access(referenceAbsolutePath(form));
      ready = true;
    } catch {
      ready = false;
    }
    results.push({ ...form, ready });
  }
  return results;
}

// ============================================================
// SYSTEM PROMPT + ANSWER GENERATOR
// ============================================================

const SYSTEM_PROMPT = `You are a chartering-operations assistant for an oil & gas trading desk.
The operator is asking a question about a specific voyage fixture. You have
two layers of context to draw on, in strict priority order:

1. THE CP RECAP — the deal-specific rider clauses agreed for this exact
   voyage. This always wins when it addresses the question.
2. THE BASE STANDARD CHARTER PARTY — the underlying industry form named
   in the recap (BPVOY4 today, others in future). This is the fallback
   for points the recap is silent on.

Rules of engagement:

- Answer the operator's question concisely. Charterers and Owners read
  this every day — don't over-explain charter-party fundamentals.
- ALWAYS cite which layer the answer came from. Use this format inline:
    "Per CP recap, Clause 5 (Discharge Port Declaration): ..."
    "Not in CP recap. Per BPVOY4 Clause 26 (Agency): ..."
- If both layers are silent, say so plainly. Don't invent a rule.
- If the recap and the base form conflict, the recap wins — say so and
  cite both.
- Quote sparingly and never reproduce more than one short fragment from
  either source.
- If the question is ambiguous (e.g. "what's the demurrage rate" on a
  multi-grade fixture), ask the operator to clarify before guessing.
- Numbers and party names always come from the recap when present.
- Never speculate about market context or commercial reasonableness —
  stick to what the documents say.`;

export interface CpQaResult {
  answer: string;
  baseFormUsed: string | null;
  rawResponse: string;
}

export async function answerCpQuestion(opts: {
  question: string;
  recapText: string;
  baseFormReference: string | null;
  baseFormName: string | null;
}): Promise<CpQaResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  const client = new Anthropic({ apiKey });

  // Trim contexts to keep token cost bounded. The recap is usually
  // 5-25 KB; the base reference is ~15 KB. Keeping both in full is fine
  // for Sonnet-class context windows.
  const MAX_RECAP_CHARS = 50_000;
  const MAX_BASE_CHARS = 50_000;
  const recap = opts.recapText.slice(0, MAX_RECAP_CHARS);
  const base = (opts.baseFormReference ?? "").slice(0, MAX_BASE_CHARS);

  const userMessage = [
    "OPERATOR QUESTION:",
    opts.question.trim(),
    "",
    "----- LAYER 1: CP RECAP -----",
    recap || "(no recap text available)",
    "",
    `----- LAYER 2: ${opts.baseFormName ?? "BASE STANDARD"} -----`,
    base ||
      `(no reference document for ${opts.baseFormName ?? "this base form"} yet — answer from CP recap only, or say so)`,
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  // Concatenate any text blocks the model emitted
  const textBlocks = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    answer: textBlocks.trim(),
    baseFormUsed: opts.baseFormName,
    rawResponse: JSON.stringify(response),
  };
}
