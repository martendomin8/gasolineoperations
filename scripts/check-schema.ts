import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const cols = await sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'deals'
        AND column_name IN ('linkage_id', 'linkage_code')
      ORDER BY column_name
    `;
    console.log("deals schema:", cols);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
