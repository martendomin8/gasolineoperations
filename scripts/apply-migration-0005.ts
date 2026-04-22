/**
 * Manual apply of migration 0005 (deals recap fields: quality,
 * payment, credit, laytime, demurrage, qq_determination, inspection,
 * law, gtc). Same manual-runner pattern as 0004 because drizzle-kit's
 * CLI hangs on this Neon branch.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'deals' AND column_name IN (
        'quality','payment','credit','laytime','demurrage',
        'qq_determination','inspection','law','gtc'
      )
    `;
    if (cols.length === 9) {
      console.log("All 9 recap columns already present — nothing to do.");
      return;
    }

    const sqlText = readFileSync(
      "src/lib/db/migrations/0005_deals_recap_fields.sql",
      "utf-8",
    );
    console.log("Applying migration 0005...");
    await sql.unsafe(sqlText);
    console.log("Migration SQL applied.");

    const hash = createHash("sha256")
      .update(sqlText.replace(/--> statement-breakpoint\n?/g, ""))
      .digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${Date.now().toString()})
      ON CONFLICT DO NOTHING
    `;
    console.log("Recorded in drizzle.__drizzle_migrations hash:", hash);

    const after = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'deals' AND column_name IN (
        'quality','payment','credit','laytime','demurrage',
        'qq_determination','inspection','law','gtc'
      )
      ORDER BY column_name
    `;
    console.log("Post-migration columns:", after.map((r) => r.column_name));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
