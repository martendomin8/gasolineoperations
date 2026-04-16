/**
 * Scan every PDF in ./Q88, pull the summer DWT from the text, and rename
 * the file to "<original>_<DWT>dwt.pdf" so the operator can pick a vessel
 * of the right size at a glance.
 *
 * Heuristic: look for "Summer DWT" / "Deadweight" / "DWT" followed by a
 * numeric value in the first ~20k chars. Q88s are very consistent — this
 * keyword search works without an AI call.
 *
 * Run: npx tsx scripts/rename-q88.ts
 */
import { readFile, readdir, rename } from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";

const Q88_DIR = path.join(process.cwd(), "Q88");

// Try these patterns in order — first hit wins. Ordered from most specific to least.
// Q88 loadline tables typically render as: "Summer: <freeboard> m <draft> m <DWT> MT <disp> MT"
// so we grab the 3rd numeric column after "Summer:".
const NUM = "(\\d{1,3}(?:[,\\s]\\d{3})+(?:\\.\\d+)?|\\d{4,6}(?:\\.\\d+)?)";
// Accept British "metres", American "meters", abbreviations "m" / "mtrs", and the
// MT/Metric/Tonnes suffix — plus an "optional unit" hole for Q88s that strip units.
const UNIT = "(?:m(?:eters?|etres?|trs)?|mt|metric|tonnes?|tons?)";
const U = `(?:${UNIT}\\s*)?`;
const DWT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Loadline table "Summer:" row — number 3 is the DWT. Units vary between
  // Q88s (Metres / Meters / Mtrs / m / none at all) so we let each unit be
  // optional and rely on the sanity check below to reject false positives.
  {
    label: "Loadline Summer row",
    re: new RegExp(
      `summer:?\\s*[\\d.,]+\\s*${U}[\\d.,]+\\s*${U}${NUM}`,
      "i"
    ),
  },
  // "Assigned DWT 1: <n>" — Q88 multi-loadline vessels
  { label: "Assigned DWT 1", re: new RegExp(`assigned\\s*dwt\\s*1[:\\s]*${NUM}`, "i") },
  // "Summer DWT: <n>" explicit
  { label: "Summer DWT", re: new RegExp(`summer\\s*(?:dwt|deadweight)[^\\d]{0,20}${NUM}`, "i") },
  // "Deadweight (summer) <n>"
  { label: "Deadweight summer", re: new RegExp(`deadweight[^\\d]{0,10}\\(?summer\\)?[^\\d]{0,20}${NUM}`, "i") },
  // Plain "DWT <n>"
  { label: "DWT", re: new RegExp(`\\bdwt[^\\d]{0,30}${NUM}`, "i") },
];

function parseDwt(text: string): { dwt: number; via: string } | null {
  const sample = text.slice(0, 30_000);
  for (const { label, re } of DWT_PATTERNS) {
    const m = sample.match(re);
    if (!m) continue;
    const raw = m[1].replace(/[,\s]/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // Sanity check — MR tanker DWT sits roughly 3,000–120,000 MT.
    if (n < 1000 || n > 350_000) continue;
    return { dwt: Math.round(n), via: label };
  }
  return null;
}

function formatDwt(n: number): string {
  // Round to nearest kilo-tonne for the filename tag: 45827 -> "46kt"
  if (n >= 10_000) return `${Math.round(n / 1000)}kt`;
  return `${Math.round(n / 100) / 10}kt`;
}

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  });
  const result = await parser.getText();
  return result.text ?? "";
}

async function main() {
  const files = (await readdir(Q88_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));

  for (const file of files) {
    // Skip files that already have a DWT tag so repeat runs are idempotent
    if (/_\d+(?:\.\d+)?kt\.pdf$/i.test(file)) {
      console.log(`skip   ${file} (already tagged)`);
      continue;
    }

    const absolute = path.join(Q88_DIR, file);
    try {
      const buffer = await readFile(absolute);
      const text = await extractText(buffer);
      const found = parseDwt(text);

      if (!found) {
        console.log(`miss   ${file} (no DWT match)`);
        continue;
      }

      const tag = formatDwt(found.dwt);
      const base = file.replace(/\.pdf$/i, "");
      const newName = `${base}_${tag}.pdf`;
      const newPath = path.join(Q88_DIR, newName);

      await rename(absolute, newPath);
      console.log(`tag    ${file} -> ${newName}  (${found.dwt} MT via "${found.via}")`);
    } catch (err) {
      console.error(`error  ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
