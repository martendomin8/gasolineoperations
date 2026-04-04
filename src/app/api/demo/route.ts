import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import bcrypt from "bcryptjs";

// POST /api/demo — provision a fresh demo tenant with seed data from Arne's Excel
export async function POST() {
  if (process.env.DEMO_ENABLED !== "true" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Demo provisioning disabled" }, { status: 403 });
  }

  const db = getDb();
  const suffix = Date.now().toString(36).toUpperCase();
  const demoPassword = process.env.DEMO_PASSWORD ?? "demo2026";
  const passwordHash = await bcrypt.hash(demoPassword, 10);
  const adminEmail = `admin-${suffix}@demo.nominationengine.com`;

  // --- Tenant ---
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `EuroGas Trading — Demo ${suffix}`, settings: { demo: true } })
    .returning();

  // --- Users (operators from Excel OPS column: AT = Arne Tohver, KK = Karl Kask, LR = Liis Rebane) ---
  const [adminUser] = await db.insert(schema.users).values({
    tenantId: tenant.id, email: adminEmail, name: "Demo Admin",
    passwordHash, role: "admin",
  }).returning();

  const [opAT] = await db.insert(schema.users).values({
    tenantId: tenant.id, email: `at-${suffix}@demo.nominationengine.com`, name: "AT",
    passwordHash, role: "operator",
  }).returning();

  const [opKK] = await db.insert(schema.users).values({
    tenantId: tenant.id, email: `kk-${suffix}@demo.nominationengine.com`, name: "KK",
    passwordHash, role: "operator",
  }).returning();

  const [opLR] = await db.insert(schema.users).values({
    tenantId: tenant.id, email: `lr-${suffix}@demo.nominationengine.com`, name: "LR",
    passwordHash, role: "operator",
  }).returning();

  await db.insert(schema.users).values({
    tenantId: tenant.id, email: `trader-${suffix}@demo.nominationengine.com`, name: "Thomas Berg",
    passwordHash, role: "trader",
  });

  // --- Parties (terminals, agents, inspectors, brokers) ---
  await db.insert(schema.parties).values([
    { tenantId: tenant.id, type: "terminal", name: "Vopak Amsterdam", port: "Amsterdam", email: "nominations@vopak-ams.nl", phone: "+31 20 7891234", isFixed: true, notes: "ARA hub.", regionTags: ["ARA", "Amsterdam"] },
    { tenantId: tenant.id, type: "terminal", name: "Klaipeda Oil Terminal", port: "Klaipeda", email: "ops@klaipeda-terminal.lt", phone: "+370 46 123456", isFixed: true, notes: "Baltic hub.", regionTags: ["Baltic", "Klaipeda"] },
    { tenantId: tenant.id, type: "terminal", name: "ATPC Antwerp", port: "Antwerp", email: "scheduling@atpc-antwerp.be", phone: "+32 3 5678901", isFixed: true, notes: "72h berth notice.", regionTags: ["ARA", "Antwerp"] },
    { tenantId: tenant.id, type: "agent", name: "Van Ommeren Agency", port: "Amsterdam", email: "agency@vanommeren.nl", phone: "+31 20 4561234", isFixed: false, regionTags: ["ARA", "Amsterdam"] },
    { tenantId: tenant.id, type: "agent", name: "Baltic Shipping Agency", port: "Klaipeda", email: "ops@baltic-shipping.lt", phone: "+370 46 654321", isFixed: false, regionTags: ["Baltic", "Klaipeda"] },
    { tenantId: tenant.id, type: "agent", name: "Turkon Agency", port: "Aliaga", email: "ops@turkon-aliaga.com.tr", phone: "+90 232 6161234", isFixed: false, regionTags: ["Turkey", "Aliaga"] },
    { tenantId: tenant.id, type: "agent", name: "Hamburg Port Agency", port: "Hamburg", email: "ops@hpa-hamburg.de", phone: "+49 40 3281234", isFixed: false, regionTags: ["Germany", "Hamburg"] },
    { tenantId: tenant.id, type: "inspector", name: "Saybolt Amsterdam", port: "Amsterdam", email: "amsterdam@saybolt.com", phone: "+31 20 6789012", isFixed: false, regionTags: ["ARA", "Amsterdam"] },
    { tenantId: tenant.id, type: "inspector", name: "SGS Klaipeda", port: "Klaipeda", email: "petroleum.klaipeda@sgs.com", phone: "+370 46 789012", isFixed: false, regionTags: ["Baltic", "Klaipeda"] },
    { tenantId: tenant.id, type: "inspector", name: "SGS Aliaga", port: "Aliaga", email: "petroleum.aliaga@sgs.com", phone: "+90 232 6167890", isFixed: false, regionTags: ["Turkey", "Aliaga"] },
    { tenantId: tenant.id, type: "broker", name: "Clarksons Platou", port: null, email: "chartering@clarksons.com", phone: "+44 20 73341000", isFixed: false, notes: "Primary broker." },
  ]);

  // --- Email templates ---
  const [tplClearance] = await db.insert(schema.emailTemplates).values({
    tenantId: tenant.id,
    name: "Vessel Clearance Request",
    partyType: "broker",
    incoterm: "CIF",
    subjectTemplate: "Vessel Clearance Request — {{counterparty}} / {{product}} / {{laycan_start}}",
    bodyTemplate: `Dear Sirs,\n\nWe hereby request your vessel clearance for the following cargo:\n\nCounterparty: {{counterparty}}\nProduct: {{product}}\nQuantity: {{quantity_mt}} MT\nIncoterm: {{incoterm}}\nLoad Port: {{loadport}}\nDischarge Port: {{discharge_port}}\nLaycan: {{laycan_start}} – {{laycan_end}}\nVessel: {{vessel_name}} (IMO: {{vessel_imo}})\n\nPlease confirm vessel acceptance and revert with your documentary instructions.\n\nBest regards`,
    mergeFields: ["counterparty", "product", "quantity_mt", "incoterm", "loadport", "discharge_port", "laycan_start", "laycan_end", "vessel_name", "vessel_imo"],
    createdBy: adminUser.id,
  }).returning();

  await db.insert(schema.emailTemplates).values({
    tenantId: tenant.id,
    name: "Terminal Nomination",
    partyType: "terminal",
    incoterm: "CIF",
    subjectTemplate: "Nomination — {{product}} / {{vessel_name}} / {{laycan_start}}",
    bodyTemplate: `Dear Sirs,\n\nWe hereby nominate the following vessel for loading:\n\nProduct: {{product}}\nQuantity: {{quantity_mt}} MT\nVessel: {{vessel_name}} (IMO: {{vessel_imo}})\nLaycan: {{laycan_start}} – {{laycan_end}}\nCounterparty: {{counterparty}}\n\nPlease confirm receipt and advise berth availability.\n\nBest regards`,
    mergeFields: ["product", "quantity_mt", "vessel_name", "vessel_imo", "laycan_start", "laycan_end", "counterparty"],
    createdBy: adminUser.id,
  });

  // --- Workflow template ---
  const templateSteps: schema.WorkflowTemplateStep[] = [
    { order: 1, name: "Vessel Clearance Request to Buyer", stepType: "nomination", recipientPartyType: "broker", isExternalWait: true, emailTemplateId: tplClearance.id },
    { order: 2, name: "Nomination + Doc Instructions to Terminal", stepType: "nomination", recipientPartyType: "terminal", isExternalWait: false, recommendedAfterStep: 1 },
    { order: 3, name: "Inspector Appointment — Loadport", stepType: "appointment", recipientPartyType: "inspector", isExternalWait: false },
    { order: 4, name: "Agent Appointment — Loadport", stepType: "appointment", recipientPartyType: "agent", isExternalWait: false },
    { order: 5, name: "Voyage Orders to Chartering Broker", stepType: "order", recipientPartyType: "broker", isExternalWait: false },
  ];

  const [template] = await db.insert(schema.workflowTemplates).values({
    tenantId: tenant.id,
    name: "CIF Sale — ARA",
    incoterm: "CIF",
    direction: "sell",
    regionPattern: "ARA",
    steps: templateSteps,
  }).returning();

  // =============================================================
  // DEALS — from Arne's Excel "GASOLINE VESSELS LIST 2026"
  // =============================================================

  // --- Deal 1: PURCHASE — SOCAR, FOB Aliaga ---
  const [dealSocar] = await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: "GP54124",
    linkageCode: "086412GSS",
    counterparty: "SOCAR",
    direction: "buy",
    product: "Reformate",
    quantityMt: "37000",
    contractedQty: "37000 MT +/-10%",
    incoterm: "FOB",
    loadport: "Aliaga",
    dischargePort: "Amsterdam",
    laycanStart: "2026-04-10",
    laycanEnd: "2026-04-15",
    vesselName: "MRC SEMIRAMIS",
    vesselCleared: true,
    docInstructionsReceived: true,
    status: "active",
    pricingType: "BL",
    pricingFormula: "0-0-5",
    pricingEstimatedDate: "2026-03-18",
    assignedOperatorId: opAT.id,
    secondaryOperatorId: opKK.id,
    createdBy: adminUser.id,
  }).returning();

  // --- Deal 2: SALE — VITOL, FOB Amsterdam ---
  const [dealVitol] = await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: "GP54871",
    linkageCode: "068742GSS",
    counterparty: "VITOL",
    direction: "sell",
    product: "Gasoline",
    quantityMt: "15000",
    contractedQty: "15000 MT +/-10%",
    incoterm: "FOB",
    loadport: "Amsterdam",
    laycanStart: "2026-04-04",
    laycanEnd: "2026-04-07",
    vesselName: "BGAS MAUD",
    vesselCleared: false,
    docInstructionsReceived: false,
    status: "active",
    pricingFormula: "01-30 APR",
    assignedOperatorId: opLR.id,
    secondaryOperatorId: opKK.id,
    createdBy: adminUser.id,
  }).returning();

  // --- Deal 3: PURCHASE+SALE linked — HOLBORN (buy) + SHELL (sell) ---
  const [dealHolborn] = await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: "GP99715",
    linkageCode: "064457GSS",
    counterparty: "HOLBORN",
    direction: "buy",
    product: "Gasoline",
    quantityMt: "11438.534",
    contractedQty: "11438.534 MT VAC (loaded)",
    incoterm: "FOB",
    loadport: "Hamburg",
    dischargePort: "New York",
    laycanStart: "2026-04-02",
    laycanEnd: "2026-04-04",
    vesselName: "GULF HOPPER",
    vesselCleared: true,
    docInstructionsReceived: true,
    status: "sailing",
    pricingType: "BL",
    pricingFormula: "0-0-5",
    pricingEstimatedDate: "2026-04-03",
    assignedOperatorId: opKK.id,
    secondaryOperatorId: opAT.id,
    createdBy: adminUser.id,
  }).returning();

  const [dealShell] = await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: "GP35477",
    linkageCode: "064457GSS",
    counterparty: "SHELL",
    direction: "sell",
    product: "Gasoline",
    quantityMt: "11438.534",
    contractedQty: "11438.534 MT VAC (loaded)",
    incoterm: "DAP",
    loadport: "Hamburg",
    dischargePort: "New York",
    laycanStart: "2026-04-20",
    laycanEnd: "2026-04-25",
    vesselName: "GULF HOPPER",
    vesselCleared: true,
    docInstructionsReceived: true,
    status: "sailing",
    pricingType: "NOR",
    pricingFormula: "0-0-5",
    pricingEstimatedDate: "2026-04-24",
    assignedOperatorId: opKK.id,
    secondaryOperatorId: opAT.id,
    createdBy: adminUser.id,
  }).returning();

  // --- Deal 4: COMPLETED — MERCURIUS sale ---
  await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: "GP51131",
    linkageCode: "022478GSS",
    counterparty: "MERCURIUS",
    direction: "sell",
    product: "Gasoline",
    quantityMt: "25000",
    contractedQty: "25000 MT +/-10%",
    incoterm: "FOB",
    loadport: "Antwerp",
    laycanStart: "2026-04-04",
    laycanEnd: "2026-04-07",
    vesselName: "BGAS ALPINE",
    vesselCleared: true,
    docInstructionsReceived: true,
    status: "completed",
    pricingFormula: "01-30 APR",
    assignedOperatorId: opLR.id,
    secondaryOperatorId: opKK.id,
    createdBy: adminUser.id,
  });

  // --- Audit logs ---
  await db.insert(schema.auditLogs).values([
    { tenantId: tenant.id, dealId: dealSocar.id, userId: adminUser.id, action: "deal.created", details: { source: "demo_provision" } },
    { tenantId: tenant.id, dealId: dealVitol.id, userId: adminUser.id, action: "deal.created", details: { source: "demo_provision" } },
    { tenantId: tenant.id, dealId: dealHolborn.id, userId: adminUser.id, action: "deal.created", details: { source: "demo_provision" } },
    { tenantId: tenant.id, dealId: dealShell.id, userId: adminUser.id, action: "deal.created", details: { source: "demo_provision" } },
  ]);

  return NextResponse.json({
    email: adminEmail,
    password: demoPassword,
    tenantName: tenant.name,
  });
}
