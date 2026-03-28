import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// POST /api/demo — provision a fresh demo tenant with seed data
// Returns { email, password } for auto sign-in
export async function POST() {
  if (process.env.DEMO_ENABLED !== "true" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Demo provisioning disabled" }, { status: 403 });
  }

  const db = getDb();
  const suffix = Date.now().toString(36).toUpperCase();
  const demoPassword = "demo2026";
  const passwordHash = await bcrypt.hash(demoPassword, 10);
  const adminEmail = `admin-${suffix}@demo.nominationengine.com`;

  // --- Tenant ---
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `EuroGas Trading — Demo ${suffix}`, settings: { demo: true } })
    .returning();

  // --- Users ---
  const [adminUser] = await db.insert(schema.users).values({
    tenantId: tenant.id, email: adminEmail, name: "Demo Admin",
    passwordHash, role: "admin",
  }).returning();

  await db.insert(schema.users).values([
    { tenantId: tenant.id, email: `operator-${suffix}@demo.nominationengine.com`, name: "Marta Kask", passwordHash, role: "operator" },
    { tenantId: tenant.id, email: `trader-${suffix}@demo.nominationengine.com`, name: "Thomas Berg", passwordHash, role: "trader" },
  ]);

  // --- Parties ---
  await db.insert(schema.parties).values([
    { tenantId: tenant.id, type: "terminal", name: "Klaipeda Oil Terminal", port: "Klaipeda", email: "ops@klaipeda-terminal.lt", phone: "+370 46 123456", isFixed: true, notes: "Baltic hub." },
    { tenantId: tenant.id, type: "terminal", name: "Vopak Amsterdam", port: "Amsterdam", email: "nominations@vopak-ams.nl", phone: "+31 20 7891234", isFixed: true, notes: "ARA hub." },
    { tenantId: tenant.id, type: "terminal", name: "ATPC Antwerp", port: "Antwerp", email: "scheduling@atpc-antwerp.be", phone: "+32 3 5678901", isFixed: true, notes: "72h berth notice." },
    { tenantId: tenant.id, type: "agent", name: "Baltic Shipping Agency", port: "Klaipeda", email: "ops@baltic-shipping.lt", phone: "+370 46 654321", isFixed: false, notes: "" },
    { tenantId: tenant.id, type: "agent", name: "Van Ommeren Agency", port: "Amsterdam", email: "agency@vanommeren.nl", phone: "+31 20 4561234", isFixed: false, notes: "" },
    { tenantId: tenant.id, type: "inspector", name: "SGS Klaipeda", port: "Klaipeda", email: "petroleum.klaipeda@sgs.com", phone: "+370 46 789012", isFixed: false, notes: "" },
    { tenantId: tenant.id, type: "inspector", name: "Saybolt Amsterdam", port: "Amsterdam", email: "amsterdam@saybolt.com", phone: "+31 20 6789012", isFixed: false, notes: "" },
    { tenantId: tenant.id, type: "broker", name: "Clarksons Platou", port: null, email: "chartering@clarksons.com", phone: "+44 20 73341000", isFixed: false, notes: "Primary broker." },
  ]);

  // --- Email templates ---
  const [tpl1] = await db.insert(schema.emailTemplates).values({
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
    { order: 1, name: "Vessel Clearance Request to Buyer", stepType: "nomination", recipientPartyType: "broker", isExternalWait: true, emailTemplateId: tpl1.id },
    { order: 2, name: "Nomination + Doc Instructions to Terminal", stepType: "nomination", recipientPartyType: "terminal", isExternalWait: false, blockedByStep: 1 },
    { order: 3, name: "Inspector Appointment — Loadport", stepType: "appointment", recipientPartyType: "inspector", isExternalWait: false, blockedByStep: 1 },
    { order: 4, name: "Agent Appointment — Loadport", stepType: "appointment", recipientPartyType: "agent", isExternalWait: false, blockedByStep: 1 },
    { order: 5, name: "Voyage Orders to Chartering Broker", stepType: "order", recipientPartyType: "broker", isExternalWait: false, blockedByStep: 1 },
  ];

  const [template] = await db.insert(schema.workflowTemplates).values({
    tenantId: tenant.id,
    name: "CIF Sale — ARA",
    incoterm: "CIF",
    direction: "sell",
    regionPattern: "ARA",
    steps: templateSteps,
  }).returning();

  // --- Deals ---
  const today = new Date();
  const d = (offset: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
  };

  const [activeDeal] = await db.insert(schema.deals).values({
    tenantId: tenant.id,
    externalRef: `DEMO-${suffix}-001`,
    counterparty: "Vitol SA",
    direction: "sell",
    product: "EBOB",
    quantityMt: "25000",
    incoterm: "CIF",
    loadport: "Amsterdam",
    dischargePort: "New York",
    laycanStart: d(3),
    laycanEnd: d(5),
    vesselName: "MT Nordic Breeze",
    vesselImo: "9123456",
    vesselCleared: false,
    docInstructionsReceived: false,
    status: "active",
    pricingFormula: "Platts CIF NWE +$14.50/MT",
    specialInstructions: "B/L to order, notify Vitol SA. SCAC code: VITL.",
    createdBy: adminUser.id,
  }).returning();

  await db.insert(schema.deals).values([
    { tenantId: tenant.id, externalRef: `DEMO-${suffix}-002`, counterparty: "Shell Trading", direction: "buy", product: "Eurobob Oxy", quantityMt: "30000", incoterm: "FOB", loadport: "Antwerp", dischargePort: "Rotterdam", laycanStart: d(6), laycanEnd: d(8), vesselName: "MT Hafnia Polar", vesselImo: "9786543", vesselCleared: true, docInstructionsReceived: true, status: "active", pricingFormula: "Platts FOB ARA +$11.00/MT", createdBy: adminUser.id },
    { tenantId: tenant.id, externalRef: `DEMO-${suffix}-003`, counterparty: "Equinor Trading", direction: "sell", product: "Premium Unleaded 95", quantityMt: "22000", incoterm: "FOB", loadport: "Klaipeda", dischargePort: "Helsinki", laycanStart: d(-1), laycanEnd: d(1), vesselName: "MT Baltic Pioneer", vesselImo: "9345001", vesselCleared: true, docInstructionsReceived: true, status: "loading", pricingFormula: "Platts FOB Klaipeda +$8.75/MT", createdBy: adminUser.id },
    { tenantId: tenant.id, externalRef: `DEMO-${suffix}-004`, counterparty: "BP Oil International", direction: "sell", product: "EBOB", quantityMt: "28000", incoterm: "CIF", loadport: "Amsterdam", dischargePort: "Lagos", laycanStart: d(-8), laycanEnd: d(-6), vesselName: "MT West Africa Star", vesselImo: "9567890", vesselCleared: true, docInstructionsReceived: true, status: "sailing", pricingFormula: "Platts CIF NWE +$16.00/MT", specialInstructions: "LOI issued.", createdBy: adminUser.id },
    { tenantId: tenant.id, externalRef: `DEMO-${suffix}-005`, counterparty: "Trafigura", direction: "buy", product: "RBOB", quantityMt: "20000", incoterm: "CIF", loadport: "Antwerp", dischargePort: "Boston", laycanStart: d(-20), laycanEnd: d(-18), vesselName: "MT Maersk Privilege", vesselImo: "9901234", vesselCleared: true, docInstructionsReceived: true, status: "completed", pricingFormula: "NYMEX RBOB +5.2 cts/gal", createdBy: adminUser.id },
  ]);

  // --- Workflow instance for active deal ---
  const [instance] = await db.insert(schema.workflowInstances).values({
    tenantId: tenant.id,
    dealId: activeDeal.id,
    templateId: template.id,
    currentStep: 0,
    status: "active",
  }).returning();

  // Create steps from template, resolving blockedBy references
  const createdStepIds: Map<number, string> = new Map();
  for (const s of templateSteps) {
    const blockedById = s.blockedByStep ? createdStepIds.get(s.blockedByStep) ?? null : null;
    const stepStatus = s.blockedByStep ? "blocked" : "ready";

    const [step] = await db.insert(schema.workflowSteps).values({
      tenantId: tenant.id,
      workflowInstanceId: instance.id,
      stepOrder: s.order,
      stepName: s.name,
      stepType: s.stepType,
      recipientPartyType: s.recipientPartyType,
      isExternalWait: s.isExternalWait ?? false,
      blockedBy: blockedById,
      emailTemplateId: s.emailTemplateId ?? null,
      status: stepStatus as "blocked" | "ready",
      description: s.description ?? null,
    }).returning();

    createdStepIds.set(s.order, step.id);
  }

  await db.insert(schema.auditLogs).values({
    tenantId: tenant.id,
    dealId: activeDeal.id,
    userId: adminUser.id,
    action: "deal.created",
    details: { source: "demo_provision" },
  });

  return NextResponse.json({
    email: adminEmail,
    password: demoPassword,
    tenantName: tenant.name,
  });
}
