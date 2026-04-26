// One-off cleanup: drop every deal + linkage row (and everything that
// cascades from them — parcels, costs, steps, change logs, documents
// linked to a linkage, workflow instances/steps for those deals).
// Keeps users, tenants, parties, email + workflow templates intact so
// the next operator-led demo starts from a clean trade-history but the
// catalog (parties, templates) is still ready to use.
//
// Run: SEED_CONFIRM=yes npx tsx scripts/clear-deals.ts

import postgres from "postgres";

if (process.env.SEED_CONFIRM !== "yes") {
  console.error("⛔ REFUSED — set SEED_CONFIRM=yes to confirm wiping deals + linkages.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("⛔ DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const sql = postgres(url, { max: 1 });

  console.log("Wiping deals + linkages (cascade)…");
  // TRUNCATE … CASCADE pulls in: deal_parcels, deal_change_logs, deal_legs,
  // linkage_costs, linkage_steps, email_drafts, workflow_instances,
  // workflow_steps, audit_logs (deal_id rows), documents (linkage_id rows).
  await sql`TRUNCATE TABLE deals, linkages RESTART IDENTITY CASCADE`;

  const [{ count: dealsLeft }] = await sql<{ count: number }[]>`SELECT count(*)::int FROM deals`;
  const [{ count: linkagesLeft }] = await sql<{ count: number }[]>`SELECT count(*)::int FROM linkages`;
  const [{ count: parties }] = await sql<{ count: number }[]>`SELECT count(*)::int FROM parties`;
  const [{ count: users }] = await sql<{ count: number }[]>`SELECT count(*)::int FROM users`;
  const [{ count: templates }] = await sql<{ count: number }[]>`SELECT count(*)::int FROM email_templates`;

  console.log("\n=== Done ===");
  console.log(`  Deals:           ${dealsLeft}`);
  console.log(`  Linkages:        ${linkagesLeft}`);
  console.log(`  Parties:         ${parties}    (kept)`);
  console.log(`  Users:           ${users}    (kept)`);
  console.log(`  Email templates: ${templates}    (kept)`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
