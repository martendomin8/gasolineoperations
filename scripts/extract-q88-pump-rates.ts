// One-off script: walk every Q88 PDF in DATA/Q88, extract text, and grep for
// the pump / loading / discharge rate fields. Print a vessel-by-vessel table
// so we can decide whether to thread per-vessel rates into the voyage-timeline
// math instead of the current 800/600 MT/h hardcoded constants.
//
// Run: npx tsx scripts/extract-q88-pump-rates.ts

import { readdir, readFile, stat } from "fs/promises";
import path from "path";

const ROOT = path.join(process.cwd(), "DATA", "Q88");

type Hit = { label: string; line: string };

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walk(full, out);
    } else if (name.toLowerCase().endsWith(".pdf")) {
      out.push(full);
    }
  }
}

async function extract(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  });
  const result = await parser.getText();
  return result.text ?? "";
}

const PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Section 8 in standard Q88 is "Cargo Handling Rates"
  { label: "MAX LOADING RATE (whole)", re: /max(imum)?\s+(loading|load)\s+rate\s*(\(.*?\))?\s*[:=]?\s*[\d,.]+\s*(m3|m³|cbm|cu\.?\s*m|mt|t).*$/gim },
  { label: "MAX DISCHARGE RATE (whole)", re: /max(imum)?\s+(disch(arging|arge)?)\s+rate\s*(\(.*?\))?\s*[:=]?\s*[\d,.]+\s*(m3|m³|cbm|cu\.?\s*m|mt|t).*$/gim },
  { label: "MANIFOLD RATE", re: /manifold.{0,50}\d[\d,. ]*\s*(m3|m³|cbm|cu\.?\s*m|mt|t).{0,5}\/?\s*(hr|h|hour).*$/gim },
  { label: "8.1 / 8.2 / 8.3", re: /(8\.[123][a-z]?\b).{0,200}\d.*$/gim },
  { label: "PUMP rate (per-pump)", re: /pump.{0,30}(rate|capacity|maximum).{0,80}\d+.*$/gim },
];

(async () => {
  const pdfs: string[] = [];
  await walk(ROOT, pdfs);
  pdfs.sort();
  console.log(`Found ${pdfs.length} Q88 PDFs.\n`);

  for (const pdf of pdfs) {
    const rel = path.relative(ROOT, pdf);
    const vessel = path.basename(pdf, ".pdf").replace(/_Q88$/, "");
    console.log(`\n========== ${vessel} (${rel}) ==========`);
    let text = "";
    try {
      text = await extract(pdf);
    } catch (err) {
      console.log(`  ! extract failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!text.trim()) {
      console.log("  ! no text extracted (possibly scanned image)");
      continue;
    }

    const hits = new Set<string>();
    for (const { label, re } of PATTERNS) {
      const matches = text.match(re);
      if (matches) {
        for (const m of matches.slice(0, 3)) {
          const cleaned = m.replace(/\s+/g, " ").trim().slice(0, 200);
          const tag = `[${label}] ${cleaned}`;
          if (!hits.has(tag)) {
            hits.add(tag);
            console.log(`  ${tag}`);
          }
        }
      }
    }

    if (hits.size === 0) {
      // Fallback: dump any line with "rate" or "pump" in it (max 6 lines)
      const linesWithRate = text
        .split(/\r?\n/)
        .filter((l) => /(?:pump|rate|capacity)/i.test(l) && /\d/.test(l))
        .slice(0, 6);
      if (linesWithRate.length > 0) {
        console.log("  (fallback context lines with rate/pump/capacity)");
        for (const l of linesWithRate) {
          console.log("    | " + l.replace(/\s+/g, " ").trim().slice(0, 200));
        }
      } else {
        console.log("  (no rate / pump / capacity lines found)");
      }
    }
  }
})();
