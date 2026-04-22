import postgres from "postgres";

/**
 * Promote Arne (arne@nefgo.com) to role = 'admin'.
 *
 * Background: the earlier `demote-arne.ts` script was run to downgrade
 * the developer account to 'operator' so the Fleet / dashboard views
 * could be exercised as a real operator would see them. Side effect: the
 * /api/admin/reset-data endpoint (and any other role-gated admin action)
 * returned 403 for the account that actually owns the codebase.
 *
 * Arne IS the developer. This script flips the bit back.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

async function main() {
  const sql = postgres(connectionString!, { max: 1, ssl: "require" });

  const before = await sql`
    SELECT id, name, email, role, tenant_id
    FROM users
    WHERE email = 'arne@nefgo.com'
  `;
  console.log("Before:", before);

  const tenantId = before[0]?.tenant_id;
  if (!tenantId) {
    console.error("arne@nefgo.com not found");
    await sql.end();
    return;
  }

  const result = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return await tx`
      UPDATE users
      SET role = 'admin', updated_at = NOW()
      WHERE email = 'arne@nefgo.com'
      RETURNING id, name, email, role
    `;
  });

  console.log("Updated:", result);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
