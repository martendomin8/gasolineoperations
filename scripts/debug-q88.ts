import { readFile } from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/debug-q88.ts <file.pdf>");
    process.exit(1);
  }
  const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), "Q88", file);
  const buffer = await readFile(absolute);
  const parser = new PDFParse({
    data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  });
  const result = await parser.getText();
  const text = result.text ?? "";

  // Print every line containing 'dwt' or 'deadweight' (case-insensitive)
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/dwt|deadweight/i.test(l)) {
      const before = lines[i - 1] ?? "";
      const after = lines[i + 1] ?? "";
      console.log(`--- line ${i} ---`);
      console.log(`  ${before}`);
      console.log(`> ${l}`);
      console.log(`  ${after}`);
    }
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
