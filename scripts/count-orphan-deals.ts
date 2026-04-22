import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const counts = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE linkage_id IS NULL)::int AS orphans,
        COUNT(*) FILTER (WHERE linkage_id IS NULL AND linkage_code IS NOT NULL)::int AS orphans_with_code,
        COUNT(*) FILTER (WHERE linkage_id IS NULL AND linkage_code IS NULL)::int AS orphans_without_code
      FROM deals
    `;
    console.log("Deal orphan stats:", counts[0]);

    const sample = await sql`
      SELECT id, counterparty, linkage_code, tenant_id
      FROM deals
      WHERE linkage_id IS NULL
      LIMIT 10
    `;
    console.log("Sample orphans:", sample);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
