/**
 * One-shot manual application of migration 0004 (deals.linkage_id
 * NOT NULL). Used because drizzle-kit's CLI runner hangs on the
 * Neon branch we're connected to — manual apply gets the same result
 * without the CLI-level spinner bug.
 *
 * Idempotent: if the column is already NOT NULL we exit without re-running
 * the backfill steps.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // Already applied?
    const cols = await sql`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'deals' AND column_name = 'linkage_id'
    `;
    if (cols[0]?.is_nullable === "NO") {
      console.log("deals.linkage_id is already NOT NULL — nothing to do.");
      return;
    }

    const sqlText = readFileSync(
      "src/lib/db/migrations/0004_deals_linkage_id_not_null.sql",
      "utf-8",
    );
    console.log("Applying migration 0004...");
    await sql.unsafe(sqlText);
    console.log("Migration SQL applied.");

    // Record in drizzle.__drizzle_migrations so drizzle-kit sees it as
    // applied on the next run. The hash must match what drizzle would
    // compute from the SQL file — SHA-256 of the file contents with
    // --> statement-breakpoint delimiters stripped.
    const hash = createHash("sha256")
      .update(sqlText.replace(/--> statement-breakpoint\n?/g, ""))
      .digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${Date.now().toString()})
      ON CONFLICT DO NOTHING
    `;
    console.log("Recorded in drizzle.__drizzle_migrations with hash:", hash);

    const afterCols = await sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name='deals' AND column_name IN ('linkage_id','linkage_code')
      ORDER BY column_name
    `;
    console.log("Post-migration schema:", afterCols);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
