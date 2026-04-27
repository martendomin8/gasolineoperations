import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgresql://nomengine:nomengine123@localhost:5432/nominationengine";
const structuralOnly = process.argv.includes("--structural-only");
// Default behaviour for a full reset is CATALOG ONLY — tenant, users,
// parties, email templates and workflow templates. NO deals, NO linkages,
// NO workflow instances. Operators build reality from real recaps.
//
// Set SEED_INCLUDE_DEMO_DEALS=yes to additionally generate ~10 demo deals,
// linkages, audit logs and the Shell/Vitol/Trafigura cargo-chain showcase.
// Useful for screen-recordings and client demos; bad for production.
const includeDemoDeals = process.env.SEED_INCLUDE_DEMO_DEALS === "yes";

async function seed() {
  // === PRODUCTION SAFETY GUARD ===
  if (process.env.SEED_CONFIRM !== "yes" && !structuralOnly) {
    console.error("⛔ SEED REFUSED — set SEED_CONFIRM=yes to confirm full data reset.");
    console.error("   This will DELETE ALL deals, parties, templates, and workflows.");
    console.error("   Use --structural-only to seed parties/templates without deleting deals.");
    console.error("");
    console.error("   Examples:");
    console.error("     SEED_CONFIRM=yes npm run db:seed                              # Catalog-only reset (no deals/linkages)");
    console.error("     SEED_INCLUDE_DEMO_DEALS=yes SEED_CONFIRM=yes npm run db:seed  # + demo deals/linkages for showcase");
    console.error("     npm run db:seed -- --structural-only                          # Safe: parties + templates only");
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
    console.log("Seeding database (FULL RESET)...");
    console.log(includeDemoDeals
      ? "  Mode: catalog + demo deals (SEED_INCLUDE_DEMO_DEALS=yes)\n"
      : "  Mode: catalog only — no demo deals or linkages will be created.\n");

    // Check for real data before truncating
    const [{ count }] = await sql`SELECT COUNT(*) as count FROM deals`;
    if (Number(count) > 0) {
      console.log(`⚠️  WARNING: ${count} deals exist in database and WILL be deleted.`);
    }

    // --- Truncate all tables (cascade) ---
    console.log("Truncating existing data...");
    // NOTE: users + tenants are intentionally NOT truncated.
    // UI-created users and password changes must survive a re-seed.
    // The fixed seed users are inserted idempotently via ON CONFLICT DO NOTHING.
    await sql`TRUNCATE TABLE
      audit_logs, deal_change_logs, email_drafts, workflow_steps,
      workflow_instances, workflow_templates, email_templates,
      deal_legs, deals, linkages, parties
      RESTART IDENTITY CASCADE`;
    console.log("  Done.\n");
  }

  // --- Tenant ---
  // Fixed UUIDs so JWT sessions survive re-seeds
  const FIXED_TENANT_ID = "00000000-0000-4000-8000-000000000001";
  // NominationEngine is an ops tool — no trader accounts. Traders never log in.
  const FIXED_USER_IDS = {
    admin:     "00000000-0000-4000-8000-000000000010",
    operator1: "00000000-0000-4000-8000-000000000011",
    operator2: "00000000-0000-4000-8000-000000000012",
    operator3: "00000000-0000-4000-8000-000000000013",
  };

  let tenantId = FIXED_TENANT_ID;
  let adminId = FIXED_USER_IDS.admin;
  let op1Id = FIXED_USER_IDS.operator1;
  let op2Id = FIXED_USER_IDS.operator2;

  if (!structuralOnly) {
    // Tenant: idempotent — preserve existing settings if already present.
    await db
      .insert(schema.tenants)
      .values({
        id: FIXED_TENANT_ID,
        name: "EuroGas Trading BV",
        settings: { defaultTimezone: "Europe/Amsterdam", currency: "USD" },
      })
      .onConflictDoNothing({ target: schema.tenants.id });
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, FIXED_TENANT_ID));
    console.log(`Tenant: ${tenant.name} (${tenantId})`);

    // --- Users ---
    // Idempotent: only inserts the 4 fixed seed accounts if missing.
    // UI-created users and password changes survive a re-seed.
    const passwordHash = await bcrypt.hash("password123", 10);

    // Marten = admin. Arne, Lauri, Kristjan = operators. No trader accounts.
    const usersData = [
      { id: FIXED_USER_IDS.admin,     email: "marten@nefgo.com",   name: "Marten",   role: "admin"    as const },
      { id: FIXED_USER_IDS.operator1, email: "arne@nefgo.com",     name: "Arne",     role: "operator" as const },
      { id: FIXED_USER_IDS.operator2, email: "lauri@nefgo.com",    name: "Lauri",    role: "operator" as const },
      { id: FIXED_USER_IDS.operator3, email: "kristjan@nefgo.com", name: "Kristjan", role: "operator" as const },
    ];

    for (const u of usersData) {
      const result = await db
        .insert(schema.users)
        .values({
          id: u.id,
          tenantId: tenantId,
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
        })
        .onConflictDoNothing({ target: schema.users.id })
        .returning();
      if (result.length > 0) {
        console.log(`  User: ${result[0].name} (${result[0].email}) [${result[0].role}] — created`);
      } else {
        console.log(`  User: ${u.email} — already exists, left untouched`);
      }
    }
  } else {
    console.log(`Using existing tenant ${FIXED_TENANT_ID}`);
  }

  const operator1 = { id: op1Id };
  const operator2 = { id: op2Id };
  const admin = { id: adminId };
  // operator3 is declared for symmetry; currently no seed data assigns to it.
  const operator3 = { id: FIXED_USER_IDS.operator3 };
  void operator3;

  // --- Parties ---
  const partiesData = [
    // Fixed terminals
    { type: "terminal" as const, name: "Lavera Oil Terminal", port: "Lavera", email: "ops@lavera-terminal.fr", phone: "+33 4 4206 1234", isFixed: true, notes: "Mediterranean hub. Blending operations available. Max draft 14m.", regionTags: ["Lavera", "Mediterranean", "France"] },
    { type: "terminal" as const, name: "Vopak Amsterdam", port: "Amsterdam", email: "nominations@vopak-ams.nl", phone: "+31 20 7891234", isFixed: true, notes: "ARA hub. Global gasoline blending center. 24h operations.", regionTags: ["Amsterdam", "ARA", "Netherlands"] },
    { type: "terminal" as const, name: "ATPC Antwerp", port: "Antwerp", email: "scheduling@atpc-antwerp.be", phone: "+32 3 5678901", isFixed: true, notes: "ARA hub. Berth allocation requires 72h notice.", regionTags: ["Antwerp", "ARA", "Belgium"] },
    // Agents
    { type: "agent" as const, name: "Lavera Maritime Agency", port: "Lavera", email: "ops@lavera-agency.fr", phone: "+33 4 4206 5678", isFixed: false, notes: "Preferred agent for Lavera operations.", regionTags: ["Lavera", "Mediterranean", "France"] },
    { type: "agent" as const, name: "Van Ommeren Agency", port: "Amsterdam", email: "agency@vanommeren.nl", phone: "+31 20 4561234", isFixed: false, notes: "Covers Amsterdam and Rotterdam.", regionTags: ["Amsterdam", "Rotterdam", "ARA", "Netherlands"] },
    { type: "agent" as const, name: "Antwerp Maritime Services", port: "Antwerp", email: "ops@ams-antwerp.be", phone: "+32 3 2345678", isFixed: false, notes: "", regionTags: ["Antwerp", "ARA", "Belgium"] },
    // Inspectors
    { type: "inspector" as const, name: "SGS Lavera", port: "Lavera", email: "petroleum.lavera@sgs.com", phone: "+33 4 4206 7890", isFixed: false, notes: "Q&Q inspection. 24h notice for appointment.", regionTags: ["Lavera", "Mediterranean", "France"] },
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

  // --- Email Templates ---
  // Catalog item — always created on every reset (full or structural-only).
  // Templates must exist before deals are created because the workflow engine
  // attaches them to workflow steps at instantiation time.
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
    // ── Phase 1 chip-workflow templates (FOB Sale) ─────────────────────
    {
      name: "Terminal Vetting Request — FOB Sale",
      partyType: "terminal" as const,
      incoterm: "FOB" as const,
      region: null,
      subjectTemplate: "Vetting Request — {{vessel_name}} / {{loadport}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

Please find attached the Q88 for the following vessel and kindly confirm vetting acceptance for loading at your terminal.

VESSEL
Name:       {{vessel_name}}
IMO:        {{vessel_imo}}

CARGO
Product:    {{product}}
Quantity:   {{quantity_mt}} MT
Loadport:   {{loadport}}
Laycan:     {{laycan_start}} / {{laycan_end}}

Q88 attached for your review. Please advise vetting outcome at your earliest convenience.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["vessel_name", "vessel_imo", "product", "quantity_mt", "loadport", "laycan_start", "laycan_end", "external_ref"],
    },
    {
      name: "VAT + Transport Request — Buyer",
      partyType: "counterparty" as const,
      incoterm: "FOB" as const,
      region: null,
      subjectTemplate: "VAT + Transport Confirmation — {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

For invoicing purposes, please confirm the following for the captioned cargo:

1. VAT number to be used on the invoice
2. Whether transport (vessel + downstream logistics) is arranged by yourselves

CARGO REFERENCE
Product:    {{product}}
Quantity:   {{quantity_mt}} MT
Loadport:   {{loadport}}
Vessel:     {{vessel_name}}
Laycan:     {{laycan_start}} / {{laycan_end}}

Kindly revert at your earliest convenience to enable timely invoicing.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["product", "quantity_mt", "loadport", "vessel_name", "laycan_start", "laycan_end", "external_ref"],
    },
    {
      name: "Supervision Order — Inspector",
      partyType: "inspector" as const,
      incoterm: "FOB" as const,
      region: null,
      subjectTemplate: "Supervision Order — {{vessel_name}} / {{loadport}} / {{laycan_start}}",
      bodyTemplate: `Dear Sirs,

Following our nomination, please find below the supervision order for the captioned loading:

VESSEL & CARGO
Vessel:     {{vessel_name}} (IMO {{vessel_imo}})
Product:    {{product}}
Quantity:   {{quantity_mt}} MT
Loadport:   {{loadport}}
Laycan:     {{laycan_start}} / {{laycan_end}}

SUPERVISION SCOPE
- Quantity determination (shore tank gauging, ullage, draft survey)
- Quality sampling at all relevant stages (shore tank, ship's manifold, composite)
- Issue Certificate of Quality and Quantity
- Time sheets covering vessel arrival, NOR, all-fast, hose-on, commencement, completion, hose-off, all-clear
- Witness B/L figures vs ship's figures

Please proceed and revert with attendance confirmation and your local point of contact.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["vessel_name", "vessel_imo", "product", "quantity_mt", "loadport", "laycan_start", "laycan_end"],
    },
    {
      name: "Missing-Info Request — Buyer",
      partyType: "counterparty" as const,
      incoterm: "FOB" as const,
      region: null,
      subjectTemplate: "Outstanding Items — {{product}} / {{external_ref}}",
      bodyTemplate: `Dear Sirs,

To complete loading preparations for the captioned cargo, kindly revert with the following outstanding items:

{{missing_items_bulleted}}

CARGO REFERENCE
Product:    {{product}}
Quantity:   {{quantity_mt}} MT
Vessel:     {{vessel_name}}
Loadport:   {{loadport}}
Laycan:     {{laycan_start}} / {{laycan_end}}

Your prompt response is appreciated to avoid any delay at the loadport.

Best regards,
EuroGas Trading BV — Operations`,
      mergeFields: ["missing_items_bulleted", "product", "quantity_mt", "vessel_name", "loadport", "laycan_start", "laycan_end", "external_ref"],
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
  // Catalog item — always created. The workflow engine matches a template
  // to each new deal at instantiation time, so all templates that operators
  // might need must be present before any deal is created.
  const workflowTemplatesData: Array<{
    name: string;
    incoterm: "FOB" | "CIF" | "CFR" | "DAP" | null;
    direction: "buy" | "sell" | null;
    regionPattern: string | null;
    steps: schema.WorkflowTemplateStep[];
  }> = [
    // ── FOB Sale — Lauri-style chip workflow (Arne-pruned to 6 chips) ──
    // Each chip = one operator-clickable email-drafting action. The chip
    // names omit "Send" (it's implied — clicking a chip drafts an email
    // for review). Receive/gate/auto events are NOT chips — they happen
    // in the background and the parser fills the deal data.
    //
    // Region intentionally null so this template matches FOB sells at any
    // port until incoterm-specific regional variants are introduced.
    {
      name: "FOB Sale",
      incoterm: "FOB",
      direction: "sell",
      regionPattern: null,
      steps: [
        {
          order: 1,
          name: "Terminal vetting request",
          stepType: "nomination",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Vetting Request — FOB Sale"],
          description: "Send Q88 to loadport terminal for vetting acceptance. Q88 attached automatically from linkage documents.",
        },
        {
          order: 2,
          name: "VAT + transport request to buyer",
          stepType: "instruction",
          recipientPartyType: "counterparty",
          emailTemplateId: tmplByName["VAT + Transport Request — Buyer"],
          description: "Ask buyer to confirm VAT number for invoicing and whether transport is arranged by themselves.",
        },
        {
          order: 3,
          name: "Terminal nomination",
          stepType: "nomination",
          recipientPartyType: "terminal",
          emailTemplateId: tmplByName["Terminal Nomination — FOB Sale"],
          description: "Send formal loading nomination to terminal. CC loadport agent + inspector. Includes vessel, cargo, laycan, doc instructions.",
        },
        {
          order: 4,
          name: "Loadport inspector nomination",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          description: "Appoint Q&Q inspector at loadport.",
        },
        {
          order: 5,
          name: "Supervision Order to inspector",
          stepType: "instruction",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Supervision Order — Inspector"],
          recommendedAfterStep: 4,
          description: "After inspector confirms attendance, send detailed supervision order covering quantity, quality, time sheets and B/L witnessing.",
        },
        {
          order: 6,
          name: "Missing-info request to buyer",
          stepType: "instruction",
          recipientPartyType: "counterparty",
          emailTemplateId: tmplByName["Missing-Info Request — Buyer"],
          description: "Conditional — only fires when post-parse the deal still has empty required fields (CN code, MSDS, VAT, etc.). Lists the missing items in the email body.",
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
      name: "FOB Purchase — Lavera",
      incoterm: "FOB",
      direction: "buy",
      regionPattern: "Lavera|Lav",
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
          description: "Appoint Q&Q inspector at Lavera loadport. Cost shared 50/50 with seller.",
        },
        {
          order: 3,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent in Lavera.",
        },
      ],
    },
    {
      name: "CIF Sale — Lavera",
      incoterm: "CIF",
      direction: "sell",
      regionPattern: "Lavera|Lav",
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
          description: "Send nomination and documentary instructions to Lavera terminal.",
        },
        {
          order: 3,
          name: "Inspector Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "inspector",
          emailTemplateId: tmplByName["Inspector Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint Q&Q inspector at Lavera.",
        },
        {
          order: 4,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent in Lavera.",
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
    // ── CFR Sale — Generic (same steps as CIF, no discharge agent) ───
    {
      name: "CFR Sale — Generic",
      incoterm: "CFR",
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
          description: "Send vessel nomination and documentary instructions to loading terminal. Wait for buyer clearance first.",
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
          description: "Issue voyage orders to chartering broker.",
        },
      ],
    },
    // ── FOB Purchase — Generic (no region lock — matches any FOB buy) ─
    {
      name: "FOB Purchase — Generic",
      incoterm: "FOB",
      direction: "buy",
      regionPattern: null,
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
          description: "Appoint Q&Q inspector at loadport.",
        },
        {
          order: 3,
          name: "Agent Appointment — Loadport",
          stepType: "appointment",
          recipientPartyType: "agent",
          emailTemplateId: tmplByName["Agent Appointment — Loadport"],
          recommendedAfterStep: 1,
          description: "Appoint loadport agent.",
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

  // --- Catalog complete ---
  // Short-circuit when no deals are needed: structural-only mode AND
  // catalog-only full reset (the default). Demo deals are opt-in via
  // SEED_INCLUDE_DEMO_DEALS=yes.
  if (structuralOnly) {
    console.log("\n=== Structural seed complete (catalog only). ===");
    await sql.end();
    return;
  }

  if (!includeDemoDeals) {
    console.log("\n=== Seed complete! Catalog only — no demo deals or linkages. ===\n");
    console.log("Test accounts (all passwords: password123):");
    console.log("  Admin:    marten@nefgo.com");
    console.log("  Operator: arne@nefgo.com");
    console.log("  Operator: lauri@nefgo.com");
    console.log("  Operator: kristjan@nefgo.com");
    console.log("");
    console.log("To include demo deals/linkages for a showcase:");
    console.log("  SEED_INCLUDE_DEMO_DEALS=yes SEED_CONFIRM=yes npm run db:seed");
    await sql.end();
    process.exit(0);
  }

  // ────────────────────────────────────────────────────────────────────────
  // BELOW THIS LINE: opt-in demo dataset (SEED_INCLUDE_DEMO_DEALS=yes)
  // Generates ~10 deals across cargo-chain showcases (Vitol/Shell, Trafigura
  // /TotalEnergies/NNPC, Repsol/BP) plus standalones, with realistic audit
  // trails and a couple of mid-flight workflow states (Shell acknowledged,
  // Vitol pending re-nomination after vessel swap).
  // ────────────────────────────────────────────────────────────────────────

  const dealsData = [
    // ── PURCHASE+SALE #1 — 086412GSS (ops has entered the linkage number) ───
    // Single vessel MT Hafnia Polar loads 30k MT EBOB in Lavera and sails to NY.
    // Buy FOB Lavera from Vitol; sell CIF Lavera→NY to Shell.
    // Buy laycan = Lavera loadport window. Sell laycan = NY discharge window
    // (~2.5 weeks later for trans-Atlantic voyage).
    {
      externalRef: "EG-2026-042",
      counterparty: "Vitol SA",
      direction: "buy" as const,
      product: "EBOB",
      quantityMt: "30000",
      contractedQty: "30,000 MT +/- 5%",
      incoterm: "FOB" as const,
      loadport: "Lavera",
      dischargePort: "New York",
      laycanStart: "2026-04-05",
      laycanEnd: "2026-04-07",
      vesselName: "MT Hafnia Polar",
      vesselImo: "9786543",
      vesselCleared: false,
      docInstructionsReceived: false,
      status: "active" as const,
      assignedOperatorId: operator1.id,
      secondaryOperatorId: operator2.id,
      pricingFormula: "Platts FOB MED +$1.50/MT",
      pricingType: "BL",
      pricingPeriodType: "BL",
      pricingPeriodValue: "0-0-5",
    },
    {
      externalRef: "EG-2026-041",
      counterparty: "Shell Trading",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "30000",
      contractedQty: "30,000 MT +/- 5%",
      incoterm: "CIF" as const,
      loadport: "Lavera",
      dischargePort: "New York",
      laycanStart: "2026-04-22",
      laycanEnd: "2026-04-25",
      vesselName: "MT Hafnia Polar",
      vesselImo: "9786543",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "active" as const,
      assignedOperatorId: operator1.id,
      secondaryOperatorId: operator2.id,
      pricingFormula: "Platts CIF NWE Cargo +$8.00/MT",
      pricingType: "NOR",
      pricingPeriodType: "NOR",
      pricingPeriodValue: "2-1-2",
      pricingEstimatedDate: "2026-04-23",
    },

    // ── PURCHASE+SALE #2 — TEMP-001 (ops hasn't entered a linkage number yet) ──
    // Single vessel MT West Africa Star loads 35k MT EBOB in Ust-Luga and sails to Lagos.
    // Buy FOB Ust-Luga from Trafigura; sell CIF Ust-Luga→Lagos to TotalEnergies.
    // Buy laycan = Ust-Luga loadport window (Mar 20-22). Sell laycan = Lagos discharge window (~Apr 15-18).
    {
      externalRef: "EG-2026-034",
      counterparty: "Trafigura",
      direction: "buy" as const,
      product: "EBOB",
      quantityMt: "35000",
      incoterm: "FOB" as const,
      loadport: "Ust-Luga",
      dischargePort: "Lagos",
      laycanStart: "2026-03-20",
      laycanEnd: "2026-03-22",
      vesselName: "MT West Africa Star",
      vesselImo: "9654321",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB Baltic +$4.00/MT",
      pricingPeriodType: "EFP",
      pricingPeriodValue: "Apr H+1",
    },
    {
      externalRef: "EG-2026-035",
      counterparty: "TotalEnergies Trading",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "23000",
      incoterm: "CIF" as const,
      loadport: "Ust-Luga",
      dischargePort: "Lagos",
      laycanStart: "2026-04-15",
      laycanEnd: "2026-04-18",
      vesselName: "MT West Africa Star",
      vesselImo: "9654321",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE Cargo +$8.00/MT",
      pricingPeriodType: "NOR",
      pricingPeriodValue: "2-1-2",
    },
    {
      externalRef: "EG-2026-036",
      counterparty: "NNPC",
      direction: "sell" as const,
      product: "EBOB",
      quantityMt: "12000",
      incoterm: "CIF" as const,
      loadport: "Ust-Luga",
      dischargePort: "Lagos",
      laycanStart: "2026-04-15",
      laycanEnd: "2026-04-18",
      vesselName: "MT West Africa Star",
      vesselImo: "9654321",
      vesselCleared: true,
      docInstructionsReceived: false,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE Cargo +$9.50/MT",
      pricingPeriodType: "NOR",
      pricingPeriodValue: "2-1-2",
    },

    // ── PURCHASE+SALE #3 — TEMP-002 (ops hasn't entered a linkage number yet) ──
    // Single vessel MT Nordic Breeze loads 25k MT Light Naphtha in Antwerp and sails to Philadelphia.
    // Buy FOB Antwerp from Repsol; sell DAP Antwerp→Philadelphia to BP.
    // Buy laycan = Antwerp loadport window (Mar 28-30). Sell laycan = Philadelphia discharge window (~Apr 15-17).
    {
      externalRef: "EG-2026-037",
      counterparty: "Repsol Trading",
      direction: "buy" as const,
      product: "Light Naphtha",
      quantityMt: "25000",
      incoterm: "FOB" as const,
      loadport: "Antwerp",
      dischargePort: "Philadelphia",
      laycanStart: "2026-03-28",
      laycanEnd: "2026-03-30",
      vesselName: "MT Nordic Breeze",
      vesselImo: "9812345",
      vesselCleared: true,
      docInstructionsReceived: false,
      status: "loading" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB ARA Naphtha +$1.50/MT",
      pricingPeriodType: "BL",
      pricingPeriodValue: "0-0-5",
    },
    {
      externalRef: "EG-2026-038",
      counterparty: "BP Oil International",
      direction: "sell" as const,
      product: "Light Naphtha",
      quantityMt: "25000",
      incoterm: "DAP" as const,
      loadport: "Antwerp",
      dischargePort: "Philadelphia",
      laycanStart: "2026-04-15",
      laycanEnd: "2026-04-17",
      vesselName: "MT Nordic Breeze",
      vesselImo: "9812345",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "loading" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts CIF NWE Naphtha +$3.00/MT",
      pricingPeriodType: "BL",
      pricingPeriodValue: "0-0-5",
    },

    // ── PURCHASE only — standalone buy without a matched sale ────────────────
    {
      externalRef: "EG-2026-030",
      counterparty: "Orlen Trading",
      direction: "buy" as const,
      product: "EBOB",
      quantityMt: "20000",
      incoterm: "FOB" as const,
      loadport: "Barcelona",
      dischargePort: "Thessaloniki",
      laycanStart: "2026-03-15",
      laycanEnd: "2026-03-17",
      vesselName: "MT Besiktas Canakkale",
      vesselImo: "9543211",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "active" as const,
      assignedOperatorId: operator2.id,
      pricingFormula: "Platts FOB MED +$3.00/MT",
      pricingPeriodType: "BL",
      pricingPeriodValue: "0-1-5",
    },

    // ── SALE only ────────────────────────────────────────────────────────────
    {
      externalRef: "EG-2026-044",
      counterparty: "Equinor Trading",
      direction: "sell" as const,
      product: "Eurobob Oxy",
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
      pricingPeriodType: "BL",
      pricingPeriodValue: "2-1-2",
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
      laycanStart: "2026-04-05",
      laycanEnd: "2026-04-08",
      vesselName: "MT Ardmore Seatrader",
      vesselImo: "9678901",
      vesselCleared: true,
      docInstructionsReceived: true,
      status: "sailing" as const,
      assignedOperatorId: operator1.id,
      pricingFormula: "Platts CIF NWE +$11.00/MT",
      pricingPeriodType: "BL",
      pricingPeriodValue: "0-1-5",
    },
  ];

  // ── Create linkages for every deal ──────────────────────────────────────
  // RULE: every deal belongs to a linkage. The `linkage_number` comes from
  // the ops-team manually (external ETRM system) — it is NEVER in the
  // trade recap. If ops hasn't entered it yet, the system auto-generates
  // `TEMP-NNN` as a placeholder.
  //
  // Demo data simulates three states:
  //   1. Shared linkage with ops-entered number (Vitol buy + Shell sell
  //      under "086412GSS") — shows the "PURCHASE+SALE" grouping card.
  //   2. Shared linkage with no ops number yet (Trafigura buy + TotalEnergies
  //      sell under "TEMP-001") — shows ops hasn't grouped the pair yet but
  //      the system auto-linked them.
  //   3. Every other demo deal — its own standalone linkage, auto-TEMP name.
  type SharedSpec = {
    linkageNumber: string | null;
    tempName: string;
    externalRefs: string[];
  };
  const DEMO_SHARED_LINKAGES: SharedSpec[] = [
    // Pair 1 — ops has already entered the official ETRM linkage number.
    { linkageNumber: "086412GSS", tempName: "086412GSS", externalRefs: ["EG-2026-041", "EG-2026-042"] },
    // Pair 2 — system auto-grouped, ops hasn't entered a number yet (TEMP-001).
    { linkageNumber: null,        tempName: "TEMP-001",  externalRefs: ["EG-2026-034", "EG-2026-035", "EG-2026-036"] },
    // Pair 3 — same situation (TEMP-002).
    { linkageNumber: null,        tempName: "TEMP-002",  externalRefs: ["EG-2026-037", "EG-2026-038"] },
  ];

  const linkageIdByExternalRef = new Map<string, string>();
  let tempCounter = DEMO_SHARED_LINKAGES.filter((s) => !s.linkageNumber).length;

  for (const spec of DEMO_SHARED_LINKAGES) {
    const first = dealsData.find((d) => d.externalRef && spec.externalRefs.includes(d.externalRef));
    const [link] = await db
      .insert(schema.linkages)
      .values({
        tenantId: tenantId,
        linkageNumber: spec.linkageNumber,
        tempName: spec.tempName,
        vesselName: first?.vesselName ?? null,
        vesselImo: first?.vesselImo ?? null,
        assignedOperatorId: first?.assignedOperatorId ?? null,
        secondaryOperatorId: first?.secondaryOperatorId ?? null,
        status: "active",
      })
      .returning();
    for (const ref of spec.externalRefs) {
      linkageIdByExternalRef.set(ref, link.id);
    }
  }

  // Per-deal auto-TEMP linkages for everything else
  for (const d of dealsData) {
    if (!d.externalRef || linkageIdByExternalRef.has(d.externalRef)) continue;
    tempCounter += 1;
    const tempName = `TEMP-${String(tempCounter).padStart(3, "0")}`;
    const [link] = await db
      .insert(schema.linkages)
      .values({
        tenantId: tenantId,
        linkageNumber: null,
        tempName,
        vesselName: d.vesselName ?? null,
        vesselImo: d.vesselImo ?? null,
        assignedOperatorId: d.assignedOperatorId ?? null,
        secondaryOperatorId: d.secondaryOperatorId ?? null,
        status: "active",
      })
      .returning();
    linkageIdByExternalRef.set(d.externalRef, link.id);
  }
  console.log(`  Linkages: ${linkageIdByExternalRef.size > 0 ? new Set(linkageIdByExternalRef.values()).size : 0} created (3 shared pairs + rest auto-TEMP)`);

  for (const d of dealsData) {
    // Every deal MUST have a linkage_id (DB-enforced by migration 0004).
    // Each seeded deal has an externalRef and is either part of a
    // DEMO_SHARED_LINKAGES pair or gets an auto-TEMP linkage above, so
    // the lookup should always hit. If it doesn't, fail loud rather
    // than insert a broken row.
    const linkageId = d.externalRef ? linkageIdByExternalRef.get(d.externalRef) : undefined;
    if (!linkageId) {
      throw new Error(
        `Seed bug: deal ${d.externalRef ?? "(no ref)"} has no matching linkage — check DEMO_SHARED_LINKAGES and auto-TEMP loop above.`,
      );
    }
    const [deal] = await db
      .insert(schema.deals)
      .values({
        ...d,
        tenantId: tenantId,
        linkageId,
        createdBy: admin.id,
      })
      .returning();

    // Add audit log for creation
    await db.insert(schema.auditLogs).values({
      tenantId: tenantId,
      dealId: deal.id,
      userId: admin.id,
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
      { tenantId: tenantId, dealId: totalDeal.id, fieldChanged: "laycanStart", oldValue: "2026-04-12", newValue: "2026-04-15", changedBy: operator1.id },
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

  console.log("  Change logs and audit entries added\n");

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
          mergeFieldsUsed: { counterparty: "Shell Trading", vessel_name: "MT Hafnia Polar", vessel_imo: "9786543", laycan_start: "2026-04-22", laycan_end: "2026-04-25" },
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
          subject: `Vessel Nomination — EBOB / EG-2026-042`,
          body: `Dear Sirs,\n\nIn accordance with our agreement, we hereby nominate the following vessel:\n\nVessel Name: MT Nordic Hawk\nIMO Number:  9341298\n\nProduct: EBOB\nQuantity: 30,000 MT\nFOB Lavera\nLaycan: 2026-04-05 / 2026-04-07\n\nBest regards,\nEuroGas Trading BV — Operations`,
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
          newValue: "MT Hafnia Polar",
          changedBy: operator1.id,
          affectedSteps: [vitolStep1.id],
        });

        await db.insert(schema.auditLogs).values({
          tenantId: tenantId,
          dealId: vitolDeal.id,
          userId: operator1.id,
          action: "deal.updated",
          details: { changes: { vesselName: { from: "MT Nordic Hawk", to: "MT Hafnia Polar" } }, note: "Vessel swap — re-nomination required" },
        });

        console.log(`  Vitol FOB deal: step 1 needs_update (vessel swap re-nomination pending)`);
      }
    }
  }

  console.log();

  console.log("=== Seed complete (with demo deals)! ===\n");
  console.log("Test accounts (all passwords: password123):");
  console.log("  Admin:    marten@nefgo.com");
  console.log("  Operator: arne@nefgo.com");
  console.log("  Operator: lauri@nefgo.com");
  console.log("  Operator: kristjan@nefgo.com");

  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
