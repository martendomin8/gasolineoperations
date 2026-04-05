import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgresql://nomengine:nomengine123@localhost:5432/nominationengine";
const structuralOnly = process.argv.includes("--structural-only");

async function seed() {
  // === PRODUCTION SAFETY GUARD ===
  if (process.env.SEED_CONFIRM !== "yes" && !structuralOnly) {
    console.error("⛔ SEED REFUSED — set SEED_CONFIRM=yes to confirm full data reset.");
    console.error("   This will DELETE ALL deals, parties, templates, and workflows.");
    console.error("   Use --structural-only to seed parties/templates without deleting deals.");
    console.error("");
    console.error("   Examples:");
    console.error("     SEED_CONFIRM=yes npm run db:seed          # Full reset");
    console.error("     npm run db:seed -- --structural-only      # Safe: parties + templates only");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql, { schema });

  if (structuralOnly) {
    console.log("Seeding structural data only (parties, templates, workflows)...");
    console.log("Existing deals will NOT be deleted.\n");

    // Delete only structural data that gets re-created
    await sql`DELETE FROM workflow_steps WHERE workflow_instance_id IN (SELECT id FROM workflow_instances)`;
    await sql`DELETE FROM workflow_instances`;
    await sql`DELETE FROM workflow_templates WHERE tenant_id IS NOT NULL`;
    await sql`DELETE FROM email_templates WHERE tenant_id IS NOT NULL`;
    await sql`DELETE FROM email_drafts`;
    await sql`DELETE FROM parties WHERE tenant_id IS NOT NULL`;
    console.log("  Cleared structural data (parties, templates, workflows).\n");
  } else {
    console.log("Seeding database (FULL RESET)...\n");

    // Check for real data before truncating
    const [{ count }] = await sql`SELECT COUNT(*) as count FROM deals`;
    if (Number(count) > 0) {
      console.log(`⚠️  WARNING: ${count} deals exist in database and WILL be deleted.`);
    }

    // --- Truncate all tables (cascade) ---
    console.log("Truncating existing data...");
    await sql`TRUNCATE TABLE
      documents, audit_logs, deal_change_logs, email_drafts, workflow_steps,
      workflow_instances, workflow_templates, email_templates,
      deal_legs, deals, parties, users, tenants
      RESTART IDENTITY CASCADE`;
    console.log("  Done.\n");
  }

  // --- Tenant ---
  // Fixed UUIDs so JWT sessions survive re-seeds
  const FIXED_TENANT_ID = "00000000-0000-4000-8000-000000000001";
  const FIXED_USER_IDS = {
    admin:     "00000000-0000-4000-8000-000000000010",
    operator1: "00000000-0000-4000-8000-000000000011",
    operator2: "00000000-0000-4000-8000-000000000012",
    trader:    "00000000-0000-4000-8000-000000000013",
  };

  let tenantId = FIXED_TENANT_ID;
  let adminId = FIXED_USER_IDS.admin;
  let op1Id = FIXED_USER_IDS.operator1;
  let op2Id = FIXED_USER_IDS.operator2;

  if (!structuralOnly) {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        id: FIXED_TENANT_ID,
        name: "EuroGas Trading BV",
        settings: { defaultTimezone: "Europe/Amsterdam", currency: "USD" },
      })
      .returning();
    console.log(`Tenant: ${tenant.name} (${tenantId})`);

    // --- Users ---
    const passwordHash = await bcrypt.hash("password123", 10);

    const usersData = [
      { id: FIXED_USER_IDS.admin, email: "admin@eurogas.com", name: "Pieter van Dijk", role: "admin" as const },
      { id: FIXED_USER_IDS.operator1, email: "operator@eurogas.com", name: "Marta Kask", role: "operator" as const },
      { id: FIXED_USER_IDS.operator2, email: "operator2@eurogas.com", name: "Jan Hendriks", role: "operator" as const },
      { id: FIXED_USER_IDS.trader, email: "trader@eurogas.com", name: "Thomas Berg", role: "trader" as const },
    ];

    for (const u of usersData) {
      const [user] = await db
        .insert(schema.users)
        .values({
          id: u.id,
          tenantId: tenantId,
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
        })
        .returning();
      console.log(`  User: ${user.name} (${user.email}) [${user.role}]`);
    }
  } else {
    console.log(`Using existing tenant ${FIXED_TENANT_ID}`);
  }

  const operator1 = { id: op1Id };
  const operator2 = { id: op2Id };
  const admin = { id: adminId };
  const trader = { id: FIXED_USER_IDS.trader };

  // --- Parties ---
  const partiesData = [
    // Fixed terminals
    { type: "terminal" as const, name: "Klaipeda Oil Terminal", port: "Klaipeda", email: "ops@klaipeda-terminal.lt", phone: "+370 46 123456", isFixed: true, notes: "Baltic hub. Blending operations available. Max draft 12.5m.", regionTags: ["Klaipeda", "Baltic", "Lithuania"] },
    { type: "terminal" as const, name: "Vopak Amsterdam", port: "Amsterdam", email: "nominations@vopak-ams.nl", phone: "+31 20 7891234", isFixed: true, notes: "ARA hub. Global gasoline blending center. 24h operations.", regionTags: ["Amsterdam", "ARA", "Netherlands"] },
    { type: "terminal" as const, name: "ATPC Antwerp", port: "Antwerp", email: "scheduling@atpc-antwerp.be", phone: "+32 3 5678901", isFixed: true, notes: "ARA hub. Berth allocation requires 72h notice.", regionTags: ["Antwerp", "ARA", "Belgium"] },
    // Agents
    { type: "agent" as const, name: "Baltic Shipping Agency", port: "Klaipeda", email: "ops@baltic-shipping.lt", phone: "+370 46 654321", isFixed: false, notes: "Preferred agent for Klaipeda operations.", regionTags: ["Klaipeda", "Baltic", "Lithuania"] },
    { type: "agent" as const, name: "Van Ommeren Agency", port: "Amsterdam", email: "agency@vanommeren.nl", phone: "+31 20 4561234", isFixed: false, notes: "Covers AMS and RTM.", regionTags: ["Amsterdam", "Rotterdam", "ARA", "Netherlands"] },
    { type: "agent" as const, name: "Antwerp Maritime Services", port: "Antwerp", email: "ops@ams-antwerp.be", phone: "+32 3 2345678", isFixed: false, notes: "", regionTags: ["Antwerp", "ARA", "Belgium"] },
    // Inspectors
    { type: "inspector" as const, name: "SGS Klaipeda", port: "Klaipeda", email: "petroleum.klaipeda@sgs.com", phone: "+370 46 789012", isFixed: false, notes: "Q&Q inspection. 24h notice for appointment.", regionTags: ["Klaipeda", "Baltic", "Lithuania"] },
    { type: "inspector" as const, name: "Saybolt Amsterdam", port: "Amsterdam", email: "amsterdam@saybolt.com", phone: "+31 20 6789012", isFixed: false, notes: "Preferred for ARA. Fast turnaround on CoQ.", regionTags: ["Amsterdam", "Rotterdam", "ARA", "Netherlands"] },
    { type: "inspector" as const, name: "Intertek Antwerp", port: "Antwerp", email: "petroleum.antwerp@intertek.com", phone: "+32 3 8901234", isFixed: false, notes: "", regionTags: ["Antwerp", "ARA", "Belgium"] },
    // Brokers
    { type: "broker" as const, name: "Clarksons Platou", port: null, email: "chartering@clarksons.com", phone: "+44 20 73341000", isFixed: false, notes: "Primary chartering broker. MR tanker specialist.", regionTags: [] },
    { type: "broker" as const, name: "Poten & Partners", port: null, email: "tankers@poten.com", phone: "+1 212 2302000", isFixed: false, notes: "Alternative broker for transatlantic.", regionTags: [] },
  ];

  for (const p of partiesData) {
    await db.insert(schema.parties).values({ ...p, tenantId: tenantId });
  }
  console.log(`\n  Parties: ${partiesData.length} created (3 terminals, 3 agents, 3 inspectors, 2 brokers)`);

  // --- Deals (skip in structural-only mode) ---
  if (structuralOnly) {
    console.log("\n  Skipping deals (structural-only mode).");
    console.log("\n=== Structural seed complete! ===");
    await sql.end();
    return;
  }

  const dealsData = [
    // ── ACTIVE (deal entered system, workflow starting) ──────────────────────
    {
      externalRef: "EG-2026-041",
      linkageCode: "086412GSS",
      counterparty: "Shell Trading",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "30000",
      contractedQty: "30,000 MT +/- 5%",
      incoterm: "CIF" as const,
      loadport: "Amsterdam",
      dischargePort: "New York",
      laycanStart: "2026-04-05",
      laycanEnd: "2026-04-07",
      vesselName: "MT Hafnia Polar",
      vesselImo: "9786543",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "active" as const,
      assignedOperatorId: operator1.id,
      secondaryOperatorId: operator2.id,
      pricingFormula: "0-0-5",
      pricingType: "BL",
      pricingEstimatedDate: "2026-04-06",
    },
    {
      externalRef: "EG-2026-042",
      linkageCode: "086412GSS",
      counterparty: "Vitol SA",
      direction: "buy" as const,
      product: "Reformate",
      quantityMt: "15000",
      contractedQty: "15,000 MT +/- 10%",
      incoterm: "FOB" as const,
      loadport: "Klaipeda",
      dischargePort: "Amsterdam",
      laycanStart: "2026-04-10",
      laycanEnd: "2026-04-12",
      vesselName: "MT Stena Penguin",
      vesselImo: "9812301",
      vesselCleared: false,
      docInstructionsReceived: false,
      status: "active" as const,
      assignedOperatorId: operator1.id,
      secondaryOperatorId: operator2.id,
      pricingFormula: "5-1-5",
      pricingType: "NOR",
    },
    {
      externalRef: "EG-2026-044",
      counterparty: "Equinor Trading",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "27000",
      incoterm: "FOB" as const,
      loadport: "Antwerp",
      dischargePort: "Baltimore",
      laycanStart: "2026-04-08",
      laycanEnd: "2026-04-10",
      vesselName: "MT Nordic Ruth",
      vesselImo: "9234567",
      vesselCleared: true,
      docInstructionsReceived: false,
      status: "active" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB ARA +$1.75/MT",
    },
    {
      externalRef: "EG-2026-045",
      counterparty: "Litasco SA",
      direction: "sell" as const,
      product: "Eurobob Oxy",
      quantityMt: "22000",
      incoterm: "CIF" as const,
      loadport: "Amsterdam",
      dischargePort: "Dakar",
      laycanStart: "2026-04-12",
      laycanEnd: "2026-04-14",
      vesselName: "MT Atlantic Gemini",
      vesselImo: "9345001",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "active" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE +$14.50/MT",
    },
    // ── LOADING (vessel at berth, cargo being pumped) ────────────────────────
    {
      externalRef: "EG-2026-038",
      counterparty: "BP Oil International",
      direction: "sell" as const,
      product: "Eurobob Oxy",
      quantityMt: "25000",
      incoterm: "FOB" as const,
      loadport: "Antwerp",
      dischargePort: "Philadelphia",
      laycanStart: "2026-03-28",
      laycanEnd: "2026-03-30",
      vesselName: "MT Nordic Breeze",
      vesselImo: "9812345",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "loading" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB ARA Barge +$3.00/MT",
    },
    {
      externalRef: "EG-2026-040",
      counterparty: "Gunvor Group",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "33000",
      incoterm: "CIF" as const,
      loadport: "Amsterdam",
      dischargePort: "Lagos",
      laycanStart: "2026-03-29",
      laycanEnd: "2026-03-31",
      vesselName: "MT Eagle Barents",
      vesselImo: "9456789",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "loading" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE Cargo +$9.00/MT",
    },
    {
      externalRef: "EG-2026-037",
      counterparty: "Repsol Trading",
      direction: "buy" as const,
      product: "Light Naphtha",
      quantityMt: "18000",
      incoterm: "FOB" as const,
      loadport: "Klaipeda",
      dischargePort: "Rotterdam",
      laycanStart: "2026-03-29",
      laycanEnd: "2026-03-31",
      vesselName: "MT Baltic Pioneer",
      vesselImo: "9543210",
      vesselCleared: true,
      docInstructionsReceived: false,
      status: "loading" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB Baltic +$1.50/MT",
    },
    // ── SAILING (cargo loaded, vessel at sea) ────────────────────────────────
    {
      externalRef: "EG-2026-035",
      counterparty: "TotalEnergies Trading",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "35000",
      incoterm: "CIF" as const,
      loadport: "Amsterdam",
      dischargePort: "Lagos",
      laycanStart: "2026-03-20",
      laycanEnd: "2026-03-22",
      vesselName: "MT West Africa Star",
      vesselImo: "9654321",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE Cargo +$8.00/MT",
    },
    {
      externalRef: "EG-2026-033",
      counterparty: "Freepoint Commodities",
      direction: "sell" as const,
      product: "RBOB",
      quantityMt: "30000",
      incoterm: "DAP" as const,
      loadport: "Amsterdam",
      dischargePort: "New York",
      laycanStart: "2026-03-18",
      laycanEnd: "2026-03-20",
      vesselName: "MT Celsius Mauritius",
      vesselImo: "9501234",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "NYMEX RBOB -3.5 cts/gal",
      specialInstructions: "SCAC code EGAS. Title transfers at POLB manifold.",
    },
    {
      externalRef: "EG-2026-031",
      counterparty: "Glencore Energy UK",
      direction: "sell" as const,
      product: "Eurobob Oxy",
      quantityMt: "26000",
      incoterm: "CIF" as const,
      loadport: "Antwerp",
      dischargePort: "Lome",
      laycanStart: "2026-03-15",
      laycanEnd: "2026-03-17",
      vesselName: "MT Ardmore Seatrader",
      vesselImo: "9678901",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE +$11.00/MT",
    },
    {
      externalRef: "EG-2026-034",
      counterparty: "Trafigura",
      direction: "buy" as const,
      product: "MTBE",
      quantityMt: "12000",
      incoterm: "CIF" as const,
      loadport: "Ust-Luga",
      dischargePort: "Amsterdam",
      laycanStart: "2026-03-19",
      laycanEnd: "2026-03-21",
      vesselName: "MT Pacific Venus",
      vesselImo: "9234890",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB Baltic MTBE +$5.50/MT",
    },
    {
      externalRef: "EG-2026-032",
      counterparty: "Mercuria Energy",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "28000",
      incoterm: "FOB" as const,
      loadport: "Amsterdam",
      dischargePort: "Tunis",
      laycanStart: "2026-03-17",
      laycanEnd: "2026-03-19",
      vesselName: "MT CP Ambition",
      vesselImo: "9389012",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF MED +$4.25/MT",
    },
    // ── DISCHARGING (vessel at discharge port) ───────────────────────────────
    {
      externalRef: "EG-2026-036",
      counterparty: "Mercuria Energy",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "32000",
      incoterm: "CFR" as const,
      loadport: "Klaipeda",
      dischargePort: "Lome",
      laycanStart: "2026-03-25",
      laycanEnd: "2026-03-27",
      vesselName: "MT African Sun",
      vesselImo: "9345678",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "discharging" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CFR West Africa +$12.00/MT",
    },
    {
      externalRef: "EG-2026-029",
      counterparty: "Shell Trading",
      direction: "sell" as const,
      product: "RBOB",
      quantityMt: "31000",
      incoterm: "DAP" as const,
      loadport: "Amsterdam",
      dischargePort: "Houston",
      laycanStart: "2026-03-08",
      laycanEnd: "2026-03-10",
      vesselName: "MT Maersk Privilege",
      vesselImo: "9512678",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "discharging" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "NYMEX RBOB -2.8 cts/gal",
      specialInstructions: "LOI issued. Original B/Ls in transit via DHL.",
    },
    {
      externalRef: "EG-2026-027",
      counterparty: "Vitol SA",
      direction: "sell" as const,
      product: "Isomerate",
      quantityMt: "14000",
      incoterm: "CIF" as const,
      loadport: "Antwerp",
      dischargePort: "Singapore",
      laycanStart: "2026-03-02",
      laycanEnd: "2026-03-04",
      vesselName: "MT SKS Tanaro",
      vesselImo: "9423156",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "discharging" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF Singapore +$18.50/MT",
    },
    // ── COMPLETED ────────────────────────────────────────────────────────────
    {
      externalRef: "EG-2026-030",
      counterparty: "Gunvor Group",
      direction: "buy" as const,
      product: "Light Naphtha",
      quantityMt: "20000",
      incoterm: "CIF" as const,
      loadport: "Ust-Luga",
      dischargePort: "Klaipeda",
      laycanStart: "2026-03-15",
      laycanEnd: "2026-03-17",
      vesselName: "MT Besiktas Canakkale",
      vesselImo: "9543210",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "completed" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB Baltic LN +$3.00/MT",
    },
    {
      externalRef: "EG-2026-025",
      counterparty: "BP Oil International",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "29000",
      incoterm: "FOB" as const,
      loadport: "Amsterdam",
      dischargePort: "New York",
      laycanStart: "2026-02-28",
      laycanEnd: "2026-03-01",
      vesselName: "MT Nordic Hawk",
      vesselImo: "9467234",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "completed" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE -$4.50/MT",
    },
    {
      externalRef: "EG-2026-022",
      counterparty: "Equinor Trading",
      direction: "buy" as const,
      product: "Reformate",
      quantityMt: "16500",
      incoterm: "FOB" as const,
      loadport: "Klaipeda",
      dischargePort: "Rotterdam",
      laycanStart: "2026-02-20",
      laycanEnd: "2026-02-22",
      vesselName: "MT Hafnia Atlantic",
      vesselImo: "9298456",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "completed" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB Baltic Reformate +$4.00/MT",
    },
    // ── DRAFT (not yet active) ───────────────────────────────────────────────
    {
      externalRef: "EG-2026-043",
      counterparty: "Trafigura",
      direction: "sell" as const,
      product: "RBOB",
      quantityMt: "28000",
      incoterm: "DAP" as const,
      loadport: "Amsterdam",
      dischargePort: "Houston",
      laycanStart: "2026-04-15",
      laycanEnd: "2026-04-17",
      vesselName: null,
      vesselImo: null,
      vesselCleared: false,
      docInstructionsReceived: false,
      status: "draft" as const,
      assignedOperatorId: null,
      specialInstructions: "SCAC code required for US B/L. Buyer to provide documentary instructions.",
    },
    {
      externalRef: "EG-2026-046",
      counterparty: "Glencore Energy UK",
      direction: "buy" as const,
      product: "Eurobob Oxy",
      quantityMt: "24000",
      incoterm: "FOB" as const,
      loadport: "Antwerp",
      dischargePort: "Amsterdam",
      laycanStart: "2026-04-18",
      laycanEnd: "2026-04-20",
      vesselName: null,
      vesselImo: null,
      vesselCleared: false,
      docInstructionsReceived: false,
      status: "draft" as const,
      assignedOperatorId: null,
    },
  ];

  for (const d of dealsData) {
    const [deal] = await db
      .insert(schema.deals)
      .values({
        ...d,
        tenantId: tenantId,
        createdBy: trader.id,
      })
      .returning();

    // Add audit log for creation
    await db.insert(schema.auditLogs).values({
      tenantId: tenantId,
      dealId: deal.id,
      userId: trader.id,
      action: "deal.created",
      details: { counterparty: d.counterparty, direction: d.direction, incoterm: d.incoterm },
    });
  }
  console.log(`  Deals: ${dealsData.length} created across various statuses and incoterms`);

  // Add realistic change logs and status history for in-progress deals
  const allDeals = await db.select().from(schema.deals);

  // TotalEnergies sailing deal — vessel swap + laycan shift
  const totalDeal = allDeals.find((d) => d.counterparty === "TotalEnergies Trading" && d.status === "sailing");
  if (totalDeal) {
    await db.insert(schema.dealChangeLogs).values([
      { tenantId: tenantId, dealId: totalDeal.id, fieldChanged: "vesselName", oldValue: "MT Lagos Spirit", newValue: "MT West Africa Star", changedBy: operator1.id },
      { tenantId: tenantId, dealId: totalDeal.id, fieldChanged: "laycanStart", oldValue: "2026-03-18", newValue: "2026-03-20", changedBy: operator1.id },
    ]);
    await db.insert(schema.auditLogs).values([
      { tenantId: tenantId, dealId: totalDeal.id, userId: operator1.id, action: "deal.updated", details: { changes: { vesselName: { from: "MT Lagos Spirit", to: "MT West Africa Star" } } } },
      { tenantId: tenantId, dealId: totalDeal.id, userId: operator1.id, action: "deal.status_changed", details: { from: "active", to: "loading" } },
      { tenantId: tenantId, dealId: totalDeal.id, userId: operator1.id, action: "deal.status_changed", details: { from: "loading", to: "sailing" } },
    ]);
  }

  // BP loading deal — status progression
  const bpDeal = allDeals.find((d) => d.counterparty === "BP Oil International" && d.status === "loading");
  if (bpDeal) {
    await db.insert(schema.auditLogs).values([
      { tenantId: tenantId, dealId: bpDeal.id, userId: operator2.id, action: "deal.status_changed", details: { from: "active", to: "loading" } },
      { tenantId: tenantId, dealId: bpDeal.id, userId: operator2.id, action: "workflow.draft_generated", details: { stepName: "Loading Instructions to Terminal" } },
    ]);
  }

  // Mercuria discharging deal — quantity amendment
  const mercuriaDeal = allDeals.find((d) => d.counterparty === "Mercuria Energy" && d.status === "discharging");
  if (mercuriaDeal) {
    await db.insert(schema.dealChangeLogs).values([
      { tenantId: tenantId, dealId: mercuriaDeal.id, fieldChanged: "quantityMt", oldValue: "32000", newValue: "31850", changedBy: operator1.id },
    ]);
    await db.insert(schema.auditLogs).values([
      { tenantId: tenantId, dealId: mercuriaDeal.id, userId: operator1.id, action: "deal.updated", details: { changes: { quantityMt: { from: "32000", to: "31850" } } } },
      { tenantId: tenantId, dealId: mercuriaDeal.id, userId: operator1.id, action: "deal.status_changed", details: { from: "sailing", to: "discharging" } },
    ]);
  }

  // Freepoint sailing deal — LOI issued
  const freepointDeal = allDeals.find((d) => d.counterparty === "Freepoint Commodities");
  if (freepointDeal) {
    await db.insert(schema.auditLogs).values([
      { tenantId: tenantId, dealId: freepointDeal.id, userId: operator2.id, action: "deal.status_changed", details: { from: "active", to: "loading" } },
      { tenantId: tenantId, dealId: freepointDeal.id, userId: operator2.id, action: "deal.status_changed", details: { from: "loading", to: "sailing" } },
    ]);
  }

  console.log("  Change logs and audit entries added\n");

  // --- Email Templates ---
  const emailTemplatesData = [
    {
      name: "Terminal Nomination — FOB Sale",
      partyType: "terminal" as const,
      incoterm: "FOB" as const,
      region: "ARA",
      subjectTemplate: "Nomination — {{counterparty}} / {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

Please find below our nomination for the following cargo:

Seller:       EuroGas Trading BV
Counterparty: {{counterparty}}
Product:      {{product}}
Quantity:     {{quantity_mt}} MT
Incoterm:     {{incoterm}}
Loadport:     {{loadport}}
Laycan:       {{laycan_start}} / {{laycan_end}}
Vessel:       {{vessel_name}} (IMO {{vessel_imo}})

Documentary instructions to follow separately.

Please confirm receipt and berth availability.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["counterparty", "product", "quantity_mt", "incoterm", "loadport", "laycan_start", "laycan_end", "vessel_name", "vessel_imo", "external_ref"],
    },
    {
      name: "Terminal Nomination + Doc Instructions — CIF/CFR Sale",
      partyType: "terminal" as const,
      incoterm: "CIF" as const,
      region: "ARA",
      subjectTemplate: "Nomination & Documentary Instructions — {{counterparty}} / {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

We are pleased to nominate the following vessel and provide documentary instructions for the below cargo:

CARGO DETAILS
Seller:             EuroGas Trading BV
Buyer:              {{counterparty}}
Product:            {{product}}
Quantity:           {{quantity_mt}} MT
Incoterm:           {{incoterm}}
Load Port:          {{loadport}}
Discharge Port:     {{discharge_port}}
Laycan:             {{laycan_start}} / {{laycan_end}}
Pricing:            {{pricing_formula}}

VESSEL DETAILS
Vessel Name:        {{vessel_name}}
IMO Number:         {{vessel_imo}}

DOCUMENTARY INSTRUCTIONS
Please make out Bills of Lading as follows:
  Consignee:      To Order
  Notify Party:   {{counterparty}}
  Description:    As per Charter Party

Please confirm receipt and berth availability at your earliest convenience.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["counterparty", "product", "quantity_mt", "incoterm", "loadport", "discharge_port", "laycan_start", "laycan_end", "vessel_name", "vessel_imo", "pricing_formula", "external_ref"],
    },
    {
      name: "Vessel Clearance Request — CIF/CFR/DAP Sale",
      partyType: "broker" as const,
      incoterm: "CIF" as const,
      region: null,
      subjectTemplate: "Vessel Clearance Request — {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

We are pleased to inform you of the following cargo and request vessel clearance for the nominated vessel:

CARGO DETAILS
Product:            {{product}}
Quantity:           {{quantity_mt}} MT
Incoterm:           {{incoterm}}
Load Port:          {{loadport}}
Discharge Port:     {{discharge_port}}
Laycan:             {{laycan_start}} / {{laycan_end}}

VESSEL NOMINATION
Vessel Name:        {{vessel_name}}
IMO Number:         {{vessel_imo}}

Please confirm vessel clearance and provide your documentary instructions (consignee, notify party, B/L marks, and any special requirements).

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["counterparty", "product", "quantity_mt", "incoterm", "loadport", "discharge_port", "laycan_start", "laycan_end", "vessel_name", "vessel_imo"],
    },
    {
      name: "Inspector Appointment — Loadport",
      partyType: "inspector" as const,
      incoterm: null,
      region: null,
      subjectTemplate: "Inspector Appointment — {{product}} / {{loadport}} / {{laycan_start}}",
      bodyTemplate: `Dear Sirs,

We hereby appoint you as our inspector for the following cargo:

CARGO DETAILS
Product:        {{product}}
Quantity:       {{quantity_mt}} MT
Incoterm:       {{incoterm}}
Load Port:      {{loadport}}
Laycan:         {{laycan_start}} / {{laycan_end}}
Vessel:         {{vessel_name}}

SCOPE OF APPOINTMENT
- Quantity determination (draft survey and/or flow meter)
- Quality certification (collect representative samples, issue Certificate of Quality)
- Time sheets

Please confirm appointment and advise your local contact details.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["product", "quantity_mt", "incoterm", "loadport", "laycan_start", "laycan_end", "vessel_name"],
    },
    {
      name: "Agent Appointment — Loadport",
      partyType: "agent" as const,
      incoterm: null,
      region: null,
      subjectTemplate: "Agent Appointment — {{vessel_name}} / {{loadport}} / {{laycan_start}}",
      bodyTemplate: `Dear Sirs,

We hereby appoint you as our agent for the following vessel call:

VESSEL DETAILS
Vessel:         {{vessel_name}} (IMO {{vessel_imo}})
Port:           {{loadport}}
Estimated ETA:  {{laycan_start}}

CARGO
Product:        {{product}}
Quantity:       {{quantity_mt}} MT

INSTRUCTIONS
- Arrange berth nomination with terminal
- Coordinate vessel arrival with port authority
- Attend to all port formalities
- Report NOR tendering time immediately upon receipt

Please confirm acceptance and provide your proforma disbursements.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["vessel_name", "vessel_imo", "loadport", "laycan_start", "product", "quantity_mt"],
    },
    {
      name: "Voyage Orders — Chartering Broker",
      partyType: "broker" as const,
      incoterm: null,
      region: null,
      subjectTemplate: "Voyage Orders — {{vessel_name}} / {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

Please find below voyage orders for the above vessel:

VESSEL:             {{vessel_name}} (IMO {{vessel_imo}})
CARGO:              {{product}}
QUANTITY:           {{quantity_mt}} MT
INCOTERM:           {{incoterm}}

LOAD PORT:          {{loadport}}
  Laycan:           {{laycan_start}} / {{laycan_end}}

DISCHARGE PORT:     {{discharge_port}}

INSTRUCTIONS
1. Proceed with all dispatch to load port.
2. Tender NOR on arrival.
3. Load full cargo in accordance with terminal instructions.
4. On completion of loading, proceed to discharge port.

Please acknowledge receipt and pass these orders to the vessel Master.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["vessel_name", "vessel_imo", "product", "quantity_mt", "incoterm", "loadport", "laycan_start", "laycan_end", "discharge_port"],
    },
    {
      name: "Vessel Nomination — FOB Purchase",
      partyType: "broker" as const,
      incoterm: "FOB" as const,
      region: null,
      subjectTemplate: "Vessel Nomination — {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

In accordance with our agreement, we hereby nominate the following vessel for the below cargo:

CARGO DETAILS
Product:            {{product}}
Quantity:           {{quantity_mt}} MT
Incoterm:           {{incoterm}}
Load Port:          {{loadport}}
Laycan:             {{laycan_start}} / {{laycan_end}}

VESSEL NOMINATION
Vessel Name:        {{vessel_name}}
IMO Number:         {{vessel_imo}}

Please confirm acceptance and provide your documentary instructions.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["product", "quantity_mt", "incoterm", "loadport", "laycan_start", "laycan_end", "vessel_name", "vessel_imo", "external_ref"],
    },
  ];

  const createdEmailTemplates: { name: string; id: string }[] = [];
  for (const et of emailTemplatesData) {
    const [tmpl] = await db
      .insert(schema.emailTemplates)
      .values({
        tenantId: tenantId,
        name: et.name,
        partyType: et.partyType,
        incoterm: et.incoterm ?? undefined,
        region: et.region ?? undefined,
        subjectTemplate: et.subjectTemplate,
        bodyTemplate: et.bodyTemplate,
        mergeFields: et.mergeFields,
        createdBy: admin.id,
      })
      .returning();
    createdEmailTemplates.push({ name: tmpl.name, id: tmpl.id });
  }
  console.log(`  Email Templates: ${createdEmailTemplates.length} created`);

  const tmplByName = Object.fromEntries(createdEmailTemplates.map((t) => [t.name, t.id]));

  // --- Workflow Templates ---
  const workflowTemplatesData: Array<{
    name: string;
    incoterm: "FOB" | "CIF" | "CFR" | "DAP" | "FCA" | null;
    direction: "buy" | "sell" | null;
    regionPattern: string | null;
    steps: schema.WorkflowTemplateStep[];
  }> = [
    {
      name: "FOB Sale — ARA",
      incoterm: "FOB",
      direction: "sell",
      regionPattern: "Amsterdam|Antwerp|Rotterdam",
      steps: [
        {
          order: 1,
          name: "Loading Instructions to Terminal",
          stepType: "instruction",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Nomination — FOB Sale"],
          description: "Send loading instructions to the terminal. Include cargo details and vessel nomination.",
        },
        {
          order: 2,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          description: "Appoint Q&Q inspector at loadport.",
        },
      ],
    },
    {
      name: "CIF Sale — ARA",
      incoterm: "CIF",
      direction: "sell",
      regionPattern: "Amsterdam|Antwerp|Rotterdam",
      steps: [
        {
          order: 1,
          name: "Vessel Clearance Request to Buyer",
          stepType: "nomination",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Vessel Clearance Request — CIF/CFR/DAP Sale"],
          isExternalWait: true,
          description: "Send vessel clearance request to buyer. WAIT for buyer to return clearance confirmation and documentary instructions before proceeding.",
        },
        {
          order: 2,
          name: "Nomination + Doc Instructions to Terminal",
          stepType: "nomination",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Nomination + Doc Instructions — CIF/CFR Sale"],
          recommendedAfterStep: 1,
          description: "Send vessel nomination and documentary instructions to loading terminal. Blocked until buyer clearance received.",
        },
        {
          order: 3,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint Q&Q inspector at loadport.",
        },
        {
          order: 4,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent to coordinate vessel arrival.",
        },
        {
          order: 5,
          name: "Voyage Orders to Chartering Broker",
          stepType: "order",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Voyage Orders — Chartering Broker"],
          recommendedAfterStep: 1,
          description: "Issue voyage orders to chartering broker. Blocked until buyer clearance received.",
        },
      ],
    },
    {
      name: "FOB Purchase — Klaipeda",
      incoterm: "FOB",
      direction: "buy",
      regionPattern: "Klaipeda|Klaip",
      steps: [
        {
          order: 1,
          name: "Vessel Nomination to Seller",
          stepType: "nomination",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Vessel Nomination — FOB Purchase"],
          description: "Nominate vessel to seller within contractual deadline.",
        },
        {
          order: 2,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint Q&Q inspector at Klaipeda loadport. Cost shared 50/50 with seller.",
        },
        {
          order: 3,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent in Klaipeda.",
        },
      ],
    },
    {
      name: "CIF Sale — Klaipeda",
      incoterm: "CIF",
      direction: "sell",
      regionPattern: "Klaipeda|Klaip",
      steps: [
        {
          order: 1,
          name: "Vessel Clearance Request to Buyer",
          stepType: "nomination",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Vessel Clearance Request — CIF/CFR/DAP Sale"],
          isExternalWait: true,
          description: "Send vessel clearance request to buyer. WAIT for buyer clearance and documentary instructions.",
        },
        {
          order: 2,
          name: "Nomination + Doc Instructions to Terminal",
          stepType: "nomination",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Nomination + Doc Instructions — CIF/CFR Sale"],
          recommendedAfterStep: 1,
          description: "Send nomination and documentary instructions to Klaipeda terminal.",
        },
        {
          order: 3,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint Q&Q inspector at Klaipeda.",
        },
        {
          order: 4,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent in Klaipeda.",
        },
        {
          order: 5,
          name: "Voyage Orders to Chartering Broker",
          stepType: "order",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Voyage Orders — Chartering Broker"],
          recommendedAfterStep: 1,
          description: "Issue voyage orders to chartering broker.",
        },
      ],
    },
    {
      name: "DAP Sale — Generic",
      incoterm: "DAP",
      direction: "sell",
      regionPattern: null,
      steps: [
        {
          order: 1,
          name: "Vessel Clearance Request to Buyer",
          stepType: "nomination",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Vessel Clearance Request — CIF/CFR/DAP Sale"],
          isExternalWait: true,
          description: "Send vessel clearance request to buyer. WAIT for buyer clearance and documentary instructions.",
        },
        {
          order: 2,
          name: "Nomination + Doc Instructions to Terminal",
          stepType: "nomination",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Nomination + Doc Instructions — CIF/CFR Sale"],
          recommendedAfterStep: 1,
          description: "Send nomination and documentary instructions to loading terminal.",
        },
        {
          order: 3,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport inspector. Under DAP, seller bears inspection cost.",
        },
        {
          order: 4,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent.",
        },
        {
          order: 5,
          name: "Voyage Orders to Chartering Broker",
          stepType: "order",
          recipientPartyType: "broker",
          emailTemplateId: tmplByName["Voyage Orders — Chartering Broker"],
          recommendedAfterStep: 1,
          description: "Issue voyage orders to chartering broker.",
        },
        {
          order: 6,
          name: "Discharge Agent Appointment",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint discharge port agent (DAP — seller coordinates discharge).",
        },
      ],
    },
  ];

  for (const wt of workflowTemplatesData) {
    await db.insert(schema.workflowTemplates).values({
      tenantId: tenantId,
      name: wt.name,
      incoterm: wt.incoterm ?? undefined,
      direction: wt.direction ?? undefined,
      regionPattern: wt.regionPattern ?? undefined,
      steps: wt.steps,
    });
  }
  console.log(`  Workflow Templates: ${workflowTemplatesData.length} created`);

  // --- Instantiate workflows for active/loading/sailing deals ---
  const { matchTemplate, instantiateWorkflow, advanceStep } = await import("../workflow-engine/index");

  const dealsForWorkflow = await db.select().from(schema.deals);

  const activeStatuses = ["active", "loading", "sailing", "discharging"];
  let workflowsCreated = 0;

  for (const deal of dealsForWorkflow) {
    if (!activeStatuses.includes(deal.status)) continue;
    const template = await matchTemplate(deal, db as any);
    if (!template) continue;
    await instantiateWorkflow(deal, template.id, db as any);
    workflowsCreated++;
  }
  console.log(`  Workflows: ${workflowsCreated} instantiated for active deals`);

  // ── Pull party IDs for realistic assignment ────────────────────────────────
  const allParties = await db.select().from(schema.parties).where(eq(schema.parties.tenantId, tenantId));
  const partyByName = Object.fromEntries(allParties.map((p) => [p.name, p.id]));

  // ── DEMO STATE: Shell CIF deal ─────────────────────────────────────────────
  // Step 1 "Vessel Clearance Request to Buyer" → acknowledged (buyer cleared
  // the vessel and returned documentary instructions). Steps 2-5 should be READY.
  const shellDeal = dealsForWorkflow.find((d) => d.externalRef === "EG-2026-041");
  if (shellDeal) {
    const [shellInstance] = await db
      .select()
      .from(schema.workflowInstances)
      .where(eq(schema.workflowInstances.dealId, shellDeal.id));

    if (shellInstance) {
      const shellSteps = await db
        .select()
        .from(schema.workflowSteps)
        .where(eq(schema.workflowSteps.workflowInstanceId, shellInstance.id))
        .orderBy(schema.workflowSteps.stepOrder);

      const [step1, step2, step3, step4, step5] = shellSteps;

      // Insert a realistic sent email draft for step 1 (the clearance request)
      if (step1) {
        await db.insert(schema.emailDrafts).values({
          workflowStepId: step1.id,
          templateId: step1.emailTemplateId,
          toAddresses: "chartering@clarksons.com",
          ccAddresses: "ops@eurogas.com",
          subject: `Vessel Clearance Request — EBOB / EG-2026-041`,
          body: `Dear Sirs,\n\nWe are pleased to inform you of the following cargo and request vessel clearance for the nominated vessel:\n\nCARGO DETAILS\nProduct:            EBOB\nQuantity:           30,000 MT\nIncoterm:           CIF\nLoad Port:          Amsterdam\nDischarge Port:     New York\nLaycan:             2026-04-05 / 2026-04-07\n\nVESSEL NOMINATION\nVessel Name:        MT Hafnia Polar\nIMO Number:         9786543\n\nPlease confirm vessel clearance and provide your documentary instructions (consignee, notify party, B/L marks, and any special requirements).\n\nBest regards,\nEuroGas Trading BV — Operations`,
          mergeFieldsUsed: { counterparty: "Shell Trading", vessel_name: "MT Hafnia Polar", vessel_imo: "9786543", laycan_start: "2026-04-05", laycan_end: "2026-04-07" },
          status: "sent",
          sentViaSednaAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h ago
          sednaMessageId: "demo-msg-001",
        });

        // Advance step 1 to "acknowledged" — this unblocks steps 2–5
        await advanceStep(step1.id, "sent", db as any);
        await advanceStep(step1.id, "acknowledged", db as any);

        await db.insert(schema.auditLogs).values([
          { tenantId: tenantId, dealId: shellDeal.id, userId: operator1.id, action: "workflow.step_sent", details: { stepId: step1.id, stepName: step1.stepName } },
          { tenantId: tenantId, dealId: shellDeal.id, userId: operator1.id, action: "workflow.step_acknowledged", details: { stepId: step1.id, stepName: step1.stepName, note: "Shell confirmed vessel clearance + doc instructions received" } },
        ]);
      }

      // Assign parties to ready steps so draft generation produces real email addresses
      const vopakId     = partyByName["Vopak Amsterdam"];
      const sayboltId   = partyByName["Saybolt Amsterdam"];
      const vanOmmerenId = partyByName["Van Ommeren Agency"];
      const clarksonsId = partyByName["Clarksons Platou"];

      const assignments: Array<[schema.WorkflowStep | undefined, string | undefined]> = [
        [step2, vopakId],       // terminal
        [step3, sayboltId],     // inspector
        [step4, vanOmmerenId],  // agent
        [step5, clarksonsId],   // broker
      ];

      for (const [step, partyId] of assignments) {
        if (step && partyId) {
          await db.update(schema.workflowSteps)
            .set({ assignedPartyId: partyId })
            .where(eq(schema.workflowSteps.id, step.id));
        }
      }

      console.log(`  Shell CIF deal: step 1 acknowledged, steps 2-5 ready with parties assigned`);
    }
  }

  // ── DEMO STATE: Vitol FOB Buy deal ─────────────────────────────────────────
  // Step 1 "Vessel Nomination to Seller" was sent, but vessel was later swapped.
  // Mark as needs_update to show re-notification on dashboard.
  const vitolDeal = dealsForWorkflow.find((d) => d.externalRef === "EG-2026-042");
  if (vitolDeal) {
    const [vitolInstance] = await db
      .select()
      .from(schema.workflowInstances)
      .where(eq(schema.workflowInstances.dealId, vitolDeal.id));

    if (vitolInstance) {
      const vitolSteps = await db
        .select()
        .from(schema.workflowSteps)
        .where(eq(schema.workflowSteps.workflowInstanceId, vitolInstance.id))
        .orderBy(schema.workflowSteps.stepOrder);

      const [vitolStep1] = vitolSteps;
      if (vitolStep1) {
        // Insert a draft that was already sent (with old vessel)
        await db.insert(schema.emailDrafts).values({
          workflowStepId: vitolStep1.id,
          templateId: vitolStep1.emailTemplateId,
          toAddresses: "ops@baltic-shipping.lt",
          subject: `Vessel Nomination — Reformate / EG-2026-042`,
          body: `Dear Sirs,\n\nIn accordance with our agreement, we hereby nominate the following vessel:\n\nVessel Name: MT Nordic Hawk\nIMO Number:  9341298\n\nProduct: Reformate\nQuantity: 15,000 MT\nFOB Klaipeda\nLaycan: 2026-04-10 / 2026-04-12\n\nBest regards,\nEuroGas Trading BV — Operations`,
          mergeFieldsUsed: { vessel_name: "MT Nordic Hawk", vessel_imo: "9341298", counterparty: "Vitol SA" },
          status: "sent",
          sentViaSednaAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        });

        // Advance to sent, then mark needs_update (vessel was swapped)
        await advanceStep(vitolStep1.id, "sent", db as any);
        await db.update(schema.workflowSteps)
          .set({ status: "needs_update" })
          .where(eq(schema.workflowSteps.id, vitolStep1.id));

        // Log the vessel change
        await db.insert(schema.dealChangeLogs).values({
          tenantId: tenantId,
          dealId: vitolDeal.id,
          fieldChanged: "vesselName",
          oldValue: "MT Nordic Hawk",
          newValue: "MT Stena Penguin",
          changedBy: operator1.id,
          affectedSteps: [vitolStep1.id],
        });

        await db.insert(schema.auditLogs).values({
          tenantId: tenantId,
          dealId: vitolDeal.id,
          userId: operator1.id,
          action: "deal.updated",
          details: { changes: { vesselName: { from: "MT Nordic Hawk", to: "MT Stena Penguin" } }, note: "Vessel swap — re-nomination required" },
        });

        console.log(`  Vitol FOB deal: step 1 needs_update (vessel swap re-nomination pending)`);
      }
    }
  }

  console.log();

  console.log("=== Seed complete! ===\n");
  console.log("Test accounts (all passwords: password123):");
  console.log("  Admin:    admin@eurogas.com");
  console.log("  Operator: operator@eurogas.com");
  console.log("  Operator: operator2@eurogas.com");
  console.log("  Trader:   trader@eurogas.com");

  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
