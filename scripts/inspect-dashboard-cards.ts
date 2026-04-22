import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const linkages = await sql`
      SELECT id, linkage_number, temp_name, status, tenant_id, created_at
      FROM linkages
      ORDER BY created_at DESC
    `;
    console.log(`Total linkages: ${linkages.length}`);
    console.table(
      linkages.map((l) => ({
        id: l.id.slice(0, 8),
        display: l.linkage_number ?? l.temp_name,
        status: l.status,
      })),
    );

    const deals = await sql`
      SELECT d.id, d.counterparty, d.linkage_code, d.linkage_id,
             l.linkage_number AS l_number, l.temp_name AS l_temp
      FROM deals d
      LEFT JOIN linkages l ON l.id = d.linkage_id
      ORDER BY d.created_at DESC
    `;
    console.log(`\nTotal deals: ${deals.length}`);
    console.table(
      deals.map((d) => ({
        id: d.id.slice(0, 8),
        cp: d.counterparty.slice(0, 20),
        l_code: d.linkage_code,
        l_id: d.linkage_id ? d.linkage_id.slice(0, 8) : "(null)",
        l_display: d.l_number ?? d.l_temp ?? "(no row)",
      })),
    );

    const orphanCodes = await sql`
      SELECT DISTINCT d.linkage_code
      FROM deals d
      WHERE d.linkage_code IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM linkages l
          WHERE l.tenant_id = d.tenant_id
            AND (l.linkage_number = d.linkage_code OR l.temp_name = d.linkage_code)
        )
    `;
    console.log("\nLinkage codes with NO matching linkage row:", orphanCodes);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
