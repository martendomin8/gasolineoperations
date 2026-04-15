import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL");
  process.exit(1);
}

async function main() {
  const sql = postgres(connectionString!, { max: 1, ssl: "require" });

  const before = await sql`SELECT id, name, email, role, tenant_id FROM users WHERE email = 'admin@eurogas.com'`;
  console.log("Before:", before);

  const tenantId = before[0]?.tenant_id;
  if (!tenantId) { console.error("admin@eurogas.com not found"); await sql.end(); return; }

  const result = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return await tx`
      UPDATE users
      SET role = 'operator', updated_at = NOW()
      WHERE email = 'admin@eurogas.com'
      RETURNING id, name, email, role
    `;
  });

  console.log("Updated:", result);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
