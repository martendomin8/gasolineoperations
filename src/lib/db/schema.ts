import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ============================================================
// SHARED TYPES
// ============================================================

/**
 * Parsed Q88 vessel particulars, stored on linkages.vessel_particulars.
 * Populated by the Q88 parse endpoint; consumed by the stowage planner.
 * Shape is intentionally loose (jsonb) so we can evolve it as Q88 parsing
 * improves without schema migrations. All fields are optional.
 */
export interface VesselTank {
  name: string;                      // e.g. "1P", "1S", "2P", "2S", "SLOP P"
  capacity100?: number | null;       // m³ at 100%
  capacity98?: number | null;        // m³ at 98% (cargo fill)
  coating?: string | null;           // epoxy / phenolic / zinc / marineline / etc.
}

/**
 * A single loadline row from the Q88. Q88s list several (Summer, Winter,
 * Tropical, Fresh, Tropical Fresh) and for multi-SDWT vessels also several
 * "Assigned DWT" rows. The planner lets the operator pick which DWT ceiling
 * applies to the current voyage — winter zones, fresh water, reduced
 * loadline selection etc. all change the maximum cargo.
 */
export interface VesselLoadline {
  name: string;                      // e.g. "Summer", "Winter", "Tropical", "Assigned DWT 2"
  freeboard?: number | null;         // m
  draft?: number | null;             // m
  dwt?: number | null;               // MT
  displacement?: number | null;      // MT
}

export interface VesselParticulars {
  dwt?: number | null;               // summer deadweight, MT
  loa?: number | null;               // length overall, m
  beam?: number | null;              // breadth, m
  summerDraft?: number | null;       // summer draft, m
  flag?: string | null;
  classSociety?: string | null;
  builtYear?: number | null;
  builder?: string | null;
  vesselType?: string | null;        // e.g. "MR Tanker", "Chemical/Oil"
  tankCount?: number | null;
  totalCargoCapacity98?: number | null;   // sum of tanks at 98%, m³
  totalCargoCapacity100?: number | null;  // sum of tanks at 100%, m³
  coating?: string | null;           // dominant coating
  segregations?: number | null;      // number of cargo segregations
  pumpType?: string | null;
  tanks?: VesselTank[];
  /**
   * Full loadline table from the Q88. The `dwt` field on this interface above
   * reflects the "Summer" loadline by default, but the planner UI may switch
   * to any entry here for voyage-specific cargo planning.
   */
  loadlines?: VesselLoadline[];
  parsedAt?: string;                 // ISO timestamp
  sourceDocumentId?: string;         // documents.id the parse came from
}

// ============================================================
// ENUMS
// ============================================================

export const userRoleEnum = pgEnum("user_role", ["operator", "trader", "admin"]);
export const dealDirectionEnum = pgEnum("deal_direction", ["buy", "sell"]);
export const dealIncotermEnum = pgEnum("deal_incoterm", ["FOB", "CIF", "CFR", "DAP"]);
export const dealStatusEnum = pgEnum("deal_status", [
  "draft",
  "active",
  "loading",
  "sailing",
  "discharging",
  "completed",
  "cancelled",
]);
export const partyTypeEnum = pgEnum("party_type", ["terminal", "agent", "inspector", "broker"]);
export const workflowStepStatusEnum = pgEnum("workflow_step_status", [
  "pending",
  "blocked",
  "ready",
  "draft_generated",
  "sent",
  "acknowledged",
  "needs_update",
  "received",
  "done",
  "na",
  "cancelled",
]);
export const workflowStepTypeEnum = pgEnum("workflow_step_type", [
  "nomination",
  "instruction",
  "order",
  "appointment",
]);
export const emailDraftStatusEnum = pgEnum("email_draft_status", ["draft", "reviewed", "sent"]);

/**
 * Categories for per-port costs entered by ops. Matches the real-world
 * cost buckets a voyage accountant sees on disbursement account
 * invoices — canal transit tolls, port dues, agency fees, pilotage.
 * `other` is a catch-all for things like light dues, tug assist,
 * inspection fees, etc. that don't warrant their own bucket yet.
 */
export const portCostTypeEnum = pgEnum("port_cost_type", [
  "canal_toll",
  "port_dues",
  "agency",
  "pilotage",
  "other",
]);

// ============================================================
// TABLES — Phase 1 (fully used)
// ============================================================

// --- Tenants ---
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  settings: jsonb("settings").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Users ---
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: userRoleEnum("role").default("operator").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_tenant_email_idx").on(table.tenantId, table.email),
  ]
);

// --- Parties (terminals, agents, inspectors, brokers) ---
export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    type: partyTypeEnum("type").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    port: varchar("port", { length: 255 }),
    regionTags: text("region_tags").array().default([]),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 100 }),
    notes: text("notes"),
    isFixed: boolean("is_fixed").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("parties_tenant_type_idx").on(table.tenantId, table.type),
  ]
);

// --- Linkages (cargo chains) ---
export const linkages = pgTable(
  "linkages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    linkageNumber: varchar("linkage_number", { length: 100 }),
    tempName: varchar("temp_name", { length: 100 }).notNull(),
    status: varchar("status", { length: 50 }).default("active").notNull(),
    vesselName: varchar("vessel_name", { length: 255 }),
    vesselImo: varchar("vessel_imo", { length: 20 }),
    // MMSI — 9-digit AIS identifier. Populated by Q88 parse (same flow as IMO)
    // and used as the join key for the AIS live-tracking subsystem. Distinct
    // from IMO because MMSI can change (re-flagging) while IMO is lifetime-fixed.
    vesselMmsi: varchar("vessel_mmsi", { length: 15 }),
    // Parsed Q88 particulars — populated when operator drops a Q88 PDF/DOCX on the
    // vessel section. Stowage planner reads tank data from this column. Pure JSONB
    // so the shape can evolve without schema migrations while Q88 parsing matures.
    vesselParticulars: jsonb("vessel_particulars").$type<VesselParticulars | null>(),
    // Operators work entire voyages, so the assignment lives on the linkage and all
    // deals inside it inherit. `deals.secondary_operator_id` is deprecated.
    assignedOperatorId: uuid("assigned_operator_id").references(() => users.id),
    secondaryOperatorId: uuid("secondary_operator_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("linkages_tenant_status_idx").on(table.tenantId, table.status),
    index("linkages_tenant_linkage_number_idx").on(table.tenantId, table.linkageNumber),
  ]
);

// --- Deals ---
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    externalRef: varchar("external_ref", { length: 100 }),
    linkageCode: varchar("linkage_code", { length: 100 }),
    // linkageId is the FK grouping. Per CLAUDE.md: "every deal belongs
    // to exactly one linkage" — a linkage is a folder, deals are files
    // inside. NOT NULL makes that invariant enforceable at the DB level
    // so we can never again end up with orphan deals that show up on
    // the dashboard as "code-*" virtual cards that 404 when clicked.
    linkageId: uuid("linkage_id")
      .references(() => linkages.id)
      .notNull(),
    dealType: varchar("deal_type", { length: 50 }).default("regular").notNull(),
    counterparty: varchar("counterparty", { length: 255 }).notNull(),
    direction: dealDirectionEnum("direction").notNull(),
    product: varchar("product", { length: 255 }).notNull(),
    quantityMt: decimal("quantity_mt", { precision: 12, scale: 3 }).notNull(),
    contractedQty: varchar("contracted_qty", { length: 100 }),
    nominatedQty: decimal("nominated_qty", { precision: 12, scale: 3 }),
    incoterm: dealIncotermEnum("incoterm").notNull(),
    loadport: varchar("loadport", { length: 255 }).notNull(),
    dischargePort: varchar("discharge_port", { length: 255 }),
    laycanStart: date("laycan_start").notNull(),
    laycanEnd: date("laycan_end").notNull(),
    vesselName: varchar("vessel_name", { length: 255 }),
    vesselImo: varchar("vessel_imo", { length: 20 }),
    vesselCleared: boolean("vessel_cleared").default(false).notNull(),
    docInstructionsReceived: boolean("doc_instructions_received").default(false).notNull(),
    status: dealStatusEnum("status").default("draft").notNull(),
    assignedOperatorId: uuid("assigned_operator_id").references(() => users.id),
    secondaryOperatorId: uuid("secondary_operator_id").references(() => users.id),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    sourceRawText: text("source_raw_text"),
    pricingFormula: text("pricing_formula"),
    pricingType: varchar("pricing_type", { length: 20 }),
    pricingEstimatedDate: date("pricing_estimated_date"),
    loadedQuantityMt: decimal("loaded_quantity_mt", { precision: 12, scale: 3 }),
    pricingPeriodType: varchar("pricing_period_type", { length: 20 }),
    pricingPeriodValue: varchar("pricing_period_value", { length: 100 }),
    pricingConfirmed: boolean("pricing_confirmed").default(false).notNull(),
    estimatedBlNorDate: date("estimated_bl_nor_date"),
    specialInstructions: text("special_instructions"),
    // Commercial recap fields (trader-facing, ops keeps visible but
    // rarely edits). Each maps to one labelled line in Lauri's recap
    // template — Quality / Payment / Credit / Laytime / Demurrage /
    // Q&Q Determination / Inspection / Law / GT&C. Kept as text
    // because the values vary wildly ("as per CP", "48+6", "$12,500/day",
    // "EN590", "BIMCO standard", etc.) and we don't want to force a
    // structured input that rejects a valid phrase the AI extracted.
    // Consumers:
    //   - quality → inspection nomination email merge field
    //   - payment → cost-sector TVM calc ("3/5 days after NOR/COD")
    //   - credit → LC opening cost (parked here, not yet priced)
    //   - laytime + demurrage → estimated demurrage calc
    //   - qqDetermination → drives inspection-nomination port picker
    //     (loadport vs disport) in the workflow engine
    //   - inspection, law, gtc → boilerplate in clearance/nomination
    //     templates
    quality: text("quality"),
    payment: text("payment"),
    credit: text("credit"),
    laytime: text("laytime"),
    demurrage: text("demurrage"),
    qqDetermination: text("qq_determination"),
    inspection: text("inspection"),
    law: text("law"),
    gtc: text("gtc"),
    excelStatuses: jsonb("excel_statuses").default({}).$type<Record<string, string | null>>(),
    sortOrder: integer("sort_order").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    // Multi-parcel marker. Single-parcel deals (the common case) keep
    // parcel_count = 1 and the canonical product/quantity_mt/contracted_qty
    // columns above act as the sole grade. Multi-parcel deals (e.g. an
    // Equinor purchase of 2.5kt ISOMERATE + 2.5kt REFORMATE in one
    // transaction) carry parcel_count >= 2 and the full per-parcel detail
    // lives in `deal_parcels`. The deal-level columns hold a denormalised
    // summary (combined product string, summed quantity) so dashboards and
    // legacy consumers don't need to JOIN deal_parcels for every read.
    parcelCount: integer("parcel_count").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deals_tenant_status_idx").on(table.tenantId, table.status),
    index("deals_tenant_dedup_idx").on(
      table.tenantId,
      table.counterparty,
      table.direction,
      table.laycanStart
    ),
    index("deals_tenant_linkage_idx").on(table.tenantId, table.linkageCode),
  ]
);

// --- Deal Parcels ---
// One row per cargo grade inside a deal. Most deals are single-parcel and
// have exactly one row here that mirrors the deal-level product/quantity.
// Multi-parcel deals (e.g. ISOMERATE + REFORMATE bought from one seller in
// one transaction) carry 2+ rows. Per-parcel BL figures and pricing-finalize
// dates live here because BL is issued per grade by the loadport, even when
// the rest of the contract is shared at deal level.
export const dealParcels = pgTable(
  "deal_parcels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    dealId: uuid("deal_id")
      .references(() => deals.id, { onDelete: "cascade" })
      .notNull(),
    // 1-based ordinal within the deal — preserves the order the trader
    // listed the parcels in the recap (matters for BL number alignment).
    parcelNo: integer("parcel_no").notNull(),
    // Per-parcel grade (e.g. "ISOMERATE", "REFORMATE", "EBOB", "RBOB").
    product: varchar("product", { length: 255 }).notNull(),
    // Numeric middle/nominal quantity in MT, mirrors deals.quantity_mt for
    // single-parcel deals. Used for arithmetic; contracted_qty holds the
    // verbatim string with tolerance.
    quantityMt: decimal("quantity_mt", { precision: 12, scale: 3 }).notNull(),
    // Verbatim contracted quantity text including tolerance, e.g.
    // "2,5kt +/-5% SO" — preserved exactly so the operator's view matches
    // what the trader wrote.
    contractedQty: varchar("contracted_qty", { length: 100 }),
    // Declared exact quantity once the operator nominates it (per CLAUDE.md
    // "contracted vs nominated qty" rule).
    nominatedQty: decimal("nominated_qty", { precision: 12, scale: 3 }),
    // Loaded quantity after BL issuance — exact figure on the Bill of Lading
    // for THIS grade.
    loadedQty: decimal("loaded_qty", { precision: 12, scale: 3 }),
    // BL identifier for this parcel (numeric in most operator workflows but
    // can be alphanumeric for some terminals — kept as varchar).
    blFigure: varchar("bl_figure", { length: 100 }),
    blDate: date("bl_date"),
    // Pricing window finalisation date for THIS parcel — for BL-pricing
    // deals, each parcel's pricing window is anchored on its own BL date,
    // which can differ between parcels loaded at different times even on
    // the same vessel.
    pricingFinalizedDate: date("pricing_finalized_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Each (deal, parcel_no) pair is unique — prevents duplicate parcel #1.
    uniqueIndex("deal_parcels_deal_parcel_no_idx").on(table.dealId, table.parcelNo),
    // Tenant-scoped lookup is the dominant query pattern.
    index("deal_parcels_tenant_deal_idx").on(table.tenantId, table.dealId),
  ]
);

// --- Deal Legs ---
export const dealLegs = pgTable("deal_legs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .references(() => deals.id, { onDelete: "cascade" })
    .notNull(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  direction: dealDirectionEnum("direction").notNull(),
  counterparty: varchar("counterparty", { length: 255 }).notNull(),
  incoterm: dealIncotermEnum("incoterm"),
  loadport: varchar("loadport", { length: 255 }),
  dischargePort: varchar("discharge_port", { length: 255 }),
  quantityMt: decimal("quantity_mt", { precision: 12, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Audit Logs ---
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    details: jsonb("details").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_tenant_deal_idx").on(table.tenantId, table.dealId, table.createdAt),
  ]
);

// --- Deal Change Logs ---
export const dealChangeLogs = pgTable(
  "deal_change_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    dealId: uuid("deal_id")
      .references(() => deals.id, { onDelete: "cascade" })
      .notNull(),
    fieldChanged: varchar("field_changed", { length: 100 }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedBy: uuid("changed_by")
      .references(() => users.id)
      .notNull(),
    affectedSteps: jsonb("affected_steps").default([]).$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deal_change_logs_deal_idx").on(table.dealId, table.createdAt),
  ]
);

// ============================================================
// TABLES — Phase 2/3 (schema defined, API routes built later)
// ============================================================

// --- Workflow Templates ---
export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  incoterm: dealIncotermEnum("incoterm"),
  direction: dealDirectionEnum("direction"),
  regionPattern: varchar("region_pattern", { length: 100 }),
  steps: jsonb("steps").default([]).$type<WorkflowTemplateStep[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Workflow Instances ---
export const workflowInstances = pgTable("workflow_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  dealId: uuid("deal_id")
    .references(() => deals.id, { onDelete: "cascade" })
    .notNull(),
  templateId: uuid("template_id")
    .references(() => workflowTemplates.id)
    .notNull(),
  currentStep: integer("current_step").default(0).notNull(),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Workflow Steps ---
export const workflowSteps = pgTable("workflow_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  workflowInstanceId: uuid("workflow_instance_id")
    .references(() => workflowInstances.id, { onDelete: "cascade" })
    .notNull(),
  stepOrder: integer("step_order").notNull(),
  stepName: varchar("step_name", { length: 255 }).notNull(),
  description: text("description"),
  stepType: workflowStepTypeEnum("step_type").notNull(),
  recipientPartyType: partyTypeEnum("recipient_party_type").notNull(),
  isExternalWait: boolean("is_external_wait").default(false).notNull(),
  status: workflowStepStatusEnum("status").default("pending").notNull(),
  blockedBy: uuid("blocked_by").references((): any => workflowSteps.id),
    recommendedAfter: uuid("recommended_after").references((): any => workflowSteps.id),
  emailTemplateId: uuid("email_template_id").references(() => emailTemplates.id),
  emailDraftId: uuid("email_draft_id"),
  assignedPartyId: uuid("assigned_party_id").references(() => parties.id),
  dueDate: timestamp("due_date", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Email Templates ---
export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  partyType: partyTypeEnum("party_type").notNull(),
  terminalId: uuid("terminal_id").references(() => parties.id),
  incoterm: dealIncotermEnum("incoterm"),
  region: varchar("region", { length: 100 }),
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  mergeFields: jsonb("merge_fields").default([]).$type<string[]>(),
  version: integer("version").default(1).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Email Drafts ---
export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowStepId: uuid("workflow_step_id")
    .references(() => workflowSteps.id, { onDelete: "cascade" })
    .notNull(),
  templateId: uuid("template_id").references(() => emailTemplates.id),
  toAddresses: text("to_addresses").notNull(),
  ccAddresses: text("cc_addresses"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  mergeFieldsUsed: jsonb("merge_fields_used").default({}).$type<Record<string, string>>(),
  status: emailDraftStatusEnum("status").default("draft").notNull(),
  sednaMessageId: varchar("sedna_message_id", { length: 255 }),
  sentViaSednaAt: timestamp("sent_via_sedna_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Linkage Steps (vessel-level workflow: voyage orders, discharge orders, ad-hoc tasks) ---
export const linkageSteps = pgTable(
  "linkage_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    linkageId: uuid("linkage_id")
      .references(() => linkages.id, { onDelete: "cascade" })
      .notNull(),
    stepName: varchar("step_name", { length: 255 }).notNull(),
    stepType: varchar("step_type", { length: 50 }).notNull(), // order, appointment, custom
    recipientPartyType: varchar("recipient_party_type", { length: 50 }), // broker, agent, etc.
    description: text("description"),
    status: varchar("status", { length: 50 }).default("pending").notNull(),
    stepOrder: integer("step_order").default(0).notNull(),
    assignedPartyId: uuid("assigned_party_id").references(() => parties.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("linkage_steps_linkage_idx").on(table.linkageId),
    index("linkage_steps_tenant_idx").on(table.tenantId, table.linkageId),
  ]
);

// --- Documents ---
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    dealId: uuid("deal_id")
      .references(() => deals.id, { onDelete: "cascade" }),
    linkageId: uuid("linkage_id")
      .references(() => linkages.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    fileType: varchar("file_type", { length: 50 }).notNull(), // q88, cp_recap, bl, coa, other
    storagePath: text("storage_path").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_deal_idx").on(table.dealId),
    index("documents_linkage_idx").on(table.linkageId),
  ]
);

// ============================================================
// VOYAGE ECONOMICS (Worldscale rates + port costs)
// ============================================================

/**
 * Worldscale flat rates (WS100) per (load port, discharge port, year).
 *
 * Worldscale Association publishes a new flat-rate book every January
 * 1st — a $/MT freight rate for each named tanker route, baked from
 * distance + port costs + canal fees + nominal bunker + 14.5-kn speed
 * + laytime. Charters are quoted as percentages of this number
 * (WS150 = 150% of flat). Ops looks the flat rate up from the
 * subscription book and pastes it here so next year they don't need
 * to look it up again for the same lane.
 *
 * Historical rows are never auto-deleted — the point of the feature
 * is to show "what the flat was in 2024 vs 2025" at a glance.
 */
export const worldscaleRates = pgTable(
  "worldscale_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * Canonical port names from our distance provider (e.g.
     * "Rotterdam, NL"). We store the exact display name rather than
     * an FK to a `ports` table so the rate survives port-data
     * refreshes; lookup by exact equality.
     */
    loadPort: varchar("load_port", { length: 120 }).notNull(),
    dischargePort: varchar("discharge_port", { length: 120 }).notNull(),
    /** Worldscale book year, e.g. 2025. */
    year: integer("year").notNull(),
    /**
     * WS100 flat rate in USD per metric ton, to 4 decimals (Worldscale
     * publishes to 2 decimals but we allow headroom for edge cases).
     */
    flatRateUsdMt: decimal("flat_rate_usd_mt", { precision: 12, scale: 4 }).notNull(),
    /** Free-form ops notes — e.g. "verified against printed book v2025.1". */
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One flat rate per (load, discharge, year) within a tenant. Edits
    // go through UPDATE of the existing row, not INSERT of a duplicate.
    uniqueIndex("worldscale_rates_unique").on(
      table.tenantId,
      table.loadPort,
      table.dischargePort,
      table.year
    ),
    // Fast lookup by "all rates for this port pair" (shown in the
    // planner when a voyage is computed).
    index("worldscale_rates_pair_idx").on(
      table.tenantId,
      table.loadPort,
      table.dischargePort
    ),
  ]
);

/**
 * Per-port operating costs entered by ops. Unlike Worldscale rates
 * (which are external reference data), these are things ops actually
 * paid / were quoted — canal transit tolls, port dues, agency fees,
 * pilotage — and vary year to year. Keyed by (tenant, port, year,
 * cost_type) so multiple cost types can coexist for one port-year.
 */
export const portCosts = pgTable(
  "port_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Canonical port name from the distance provider. */
    port: varchar("port", { length: 120 }).notNull(),
    year: integer("year").notNull(),
    costType: portCostTypeEnum("cost_type").notNull(),
    /** Amount in USD, 2 decimals (up to ~$9.9B per row — plenty). */
    amountUsd: decimal("amount_usd", { precision: 12, scale: 2 }).notNull(),
    /** Free-form context — e.g. "MR tanker, 38kt cargo, 1 gang". */
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One row per (port, year, cost_type) within a tenant — editing
    // an existing cost updates the row, doesn't duplicate it.
    uniqueIndex("port_costs_unique").on(
      table.tenantId,
      table.port,
      table.year,
      table.costType
    ),
    // Fast lookup by "all costs for this port" (shown in the port
    // click popup).
    index("port_costs_port_idx").on(table.tenantId, table.port),
  ]
);

// ============================================================
// RELATIONS
// ============================================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  parties: many(parties),
  deals: many(deals),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const partiesRelations = relations(parties, ({ one }) => ({
  tenant: one(tenants, { fields: [parties.tenantId], references: [tenants.id] }),
}));

export const linkagesRelations = relations(linkages, ({ one, many }) => ({
  tenant: one(tenants, { fields: [linkages.tenantId], references: [tenants.id] }),
  deals: many(deals),
  linkageSteps: many(linkageSteps),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  tenant: one(tenants, { fields: [deals.tenantId], references: [tenants.id] }),
  linkage: one(linkages, { fields: [deals.linkageId], references: [linkages.id] }),
  assignedOperator: one(users, { fields: [deals.assignedOperatorId], references: [users.id], relationName: "primaryOperator" }),
  secondaryOperator: one(users, { fields: [deals.secondaryOperatorId], references: [users.id], relationName: "secondaryOperator" }),
  creator: one(users, { fields: [deals.createdBy], references: [users.id], relationName: "creator" }),
  legs: many(dealLegs),
  parcels: many(dealParcels),
  auditLogs: many(auditLogs),
  changeLogs: many(dealChangeLogs),
  documents: many(documents),
}));

export const dealLegsRelations = relations(dealLegs, ({ one }) => ({
  deal: one(deals, { fields: [dealLegs.dealId], references: [deals.id] }),
}));

export const dealParcelsRelations = relations(dealParcels, ({ one }) => ({
  deal: one(deals, { fields: [dealParcels.dealId], references: [deals.id] }),
  tenant: one(tenants, { fields: [dealParcels.tenantId], references: [tenants.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  deal: one(deals, { fields: [auditLogs.dealId], references: [deals.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const dealChangeLogsRelations = relations(dealChangeLogs, ({ one }) => ({
  deal: one(deals, { fields: [dealChangeLogs.dealId], references: [deals.id] }),
  changedByUser: one(users, { fields: [dealChangeLogs.changedBy], references: [users.id] }),
}));

export const workflowTemplatesRelations = relations(workflowTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowTemplates.tenantId], references: [tenants.id] }),
  instances: many(workflowInstances),
}));

export const workflowInstancesRelations = relations(workflowInstances, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowInstances.tenantId], references: [tenants.id] }),
  deal: one(deals, { fields: [workflowInstances.dealId], references: [deals.id] }),
  template: one(workflowTemplates, { fields: [workflowInstances.templateId], references: [workflowTemplates.id] }),
  steps: many(workflowSteps),
}));

export const workflowStepsRelations = relations(workflowSteps, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflowSteps.tenantId], references: [tenants.id] }),
  instance: one(workflowInstances, { fields: [workflowSteps.workflowInstanceId], references: [workflowInstances.id] }),
  blockedByStep: one(workflowSteps, { fields: [workflowSteps.blockedBy], references: [workflowSteps.id], relationName: "blockedBy" }),
  dependentSteps: many(workflowSteps, { relationName: "blockedBy" }),
  recommendedAfterStep: one(workflowSteps, { fields: [workflowSteps.recommendedAfter], references: [workflowSteps.id], relationName: "recommendedAfter" }),
  emailTemplate: one(emailTemplates, { fields: [workflowSteps.emailTemplateId], references: [emailTemplates.id] }),
}));

export const linkageStepsRelations = relations(linkageSteps, ({ one }) => ({
  tenant: one(tenants, { fields: [linkageSteps.tenantId], references: [tenants.id] }),
  linkage: one(linkages, { fields: [linkageSteps.linkageId], references: [linkages.id] }),
  assignedParty: one(parties, { fields: [linkageSteps.assignedPartyId], references: [parties.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  tenant: one(tenants, { fields: [documents.tenantId], references: [tenants.id] }),
  deal: one(deals, { fields: [documents.dealId], references: [deals.id] }),
  linkage: one(linkages, { fields: [documents.linkageId], references: [linkages.id] }),
  uploader: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [emailTemplates.tenantId], references: [tenants.id] }),
  terminal: one(parties, { fields: [emailTemplates.terminalId], references: [parties.id] }),
  createdByUser: one(users, { fields: [emailTemplates.createdBy], references: [users.id] }),
}));

export const emailDraftsRelations = relations(emailDrafts, ({ one }) => ({
  step: one(workflowSteps, { fields: [emailDrafts.workflowStepId], references: [workflowSteps.id] }),
  template: one(emailTemplates, { fields: [emailDrafts.templateId], references: [emailTemplates.id] }),
}));

// ============================================================
// AIS LIVE TRACKING — vessel positions, static cache, prediction audit
// ============================================================
// Populated by the background ingest worker (`scripts/ais-ingest/worker.ts`)
// which subscribes to AISStream.io over WebSocket. Read by the Fleet UI
// through `/api/maritime/ais/snapshot` and the `AisProvider` abstraction.
// See `docs/AIS-LIVE-TRACKING-SPEC.md` for the full design.

// --- Vessels (AIS static-data cache, keyed by MMSI) ---
// One row per MMSI we've ever received a ShipStaticData message for.
// Cross-tenant: a vessel is a vessel — but only tenants whose linkages
// reference this MMSI ever query it via the snapshot API, so there's no
// leakage concern. Enables MMSI → IMO lookup without hitting the AIS feed.
export const vessels = pgTable(
  "vessels",
  {
    mmsi: varchar("mmsi", { length: 15 }).primaryKey(),
    imo: varchar("imo", { length: 20 }),
    name: varchar("name", { length: 120 }),
    callSign: varchar("call_sign", { length: 20 }),
    shipType: integer("ship_type"),       // AIS type code; 80-89 = tankers
    lengthM: integer("length_m"),         // dim.A + dim.B
    beamM: integer("beam_m"),             // dim.C + dim.D
    draughtM: decimal("draught_m", { precision: 4, scale: 1 }),
    destination: varchar("destination", { length: 120 }),
    eta: timestamp("eta", { withTimezone: true }),
    staticUpdatedAt: timestamp("static_updated_at", { withTimezone: true }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("vessels_imo_idx").on(table.imo),
  ]
);

// --- Vessel positions (AIS live feed, hot time-series) ---
// Trimmed to last 14 days by a daily cron. Every PositionReport /
// StandardClassBPositionReport becomes one row. Index supports the
// hot path — "latest N positions for MMSI X" — which is what the
// snapshot API and the track-replay V2 feature both need.
export const vesselPositions = pgTable(
  "vessel_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mmsi: varchar("mmsi", { length: 15 }).notNull(),
    lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
    lon: decimal("lon", { precision: 10, scale: 7 }).notNull(),
    cog: decimal("cog", { precision: 5, scale: 2 }),      // course over ground, 0-360
    sog: decimal("sog", { precision: 5, scale: 2 }),      // speed over ground, knots
    heading: integer("heading"),                           // 0-359 or null if AIS 511
    navStatus: integer("nav_status"),                      // AIS nav-status code
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("vessel_positions_mmsi_received_idx").on(table.mmsi, table.receivedAt),
    index("vessel_positions_received_idx").on(table.receivedAt),
  ]
);

// --- AIS validation flags (Layer 6 of the data-quality stack) ---
// Every validation decision made by L1-L5 lands here so an operator can
// see WHY a position was rejected or flagged, and optionally override.
// Severity determines UI treatment: 'reject' = dropped, never stored as
// a real position; 'warn' = stored but flagged in UI; 'info' = shown as
// intelligence signal (e.g. "AIS-off near Primorsk"). Acknowledgement
// columns let an operator dismiss a flag (and we record who + why, for audit).
export const aisValidationFlags = pgTable(
  "ais_validation_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mmsi: varchar("mmsi", { length: 15 }).notNull(),
    /** Which validation layer raised the flag — 'sanity'|'temporal'|
     *  'identity'|'anomaly'|'business'. Kept as varchar (not enum) so
     *  we can add layers without schema migrations. */
    layer: varchar("layer", { length: 20 }).notNull(),
    /** Fine-grained flag identifier — 'null_island', 'teleport',
     *  'name_mismatch', 'ais_off_sanctioned_port', 'speed_below_cp', etc. */
    flagType: varchar("flag_type", { length: 50 }).notNull(),
    /** 'reject' (message dropped), 'warn' (stored, UI flagged),
     *  'info' (stored as intelligence signal, no warning). */
    severity: varchar("severity", { length: 10 }).notNull(),
    /** Structured context: old/new values, distances, deltas, whatever
     *  the specific check needs to explain itself to the operator. */
    details: jsonb("details").$type<Record<string, unknown>>(),
    /** When the AIS message that triggered the flag was received. Separate
     *  from `createdAt` (row insert time) so a retroactive validator
     *  can populate this from historical data. */
    messageReceivedAt: timestamp("message_received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
    /** 'override' (operator says we're wrong to flag), 'confirmed' (they
     *  agree it's suspicious), 'snoozed' (check back later). */
    acknowledgedAction: varchar("acknowledged_action", { length: 30 }),
  },
  (table) => [
    index("ais_flags_mmsi_created_idx").on(table.mmsi, table.createdAt),
    // Partial index on unresolved flags — the hot path for the UI badge.
    index("ais_flags_unresolved_idx").on(table.mmsi).where(sql`acknowledged_at IS NULL`),
  ]
);

// --- AIS prediction corrections (audit log for our hybrid position logic) ---
// When an AIS point arrives after a DEAD_RECK / PREDICTED gap, we log the
// displacement between where we THOUGHT the vessel was and where it ACTUALLY
// was. Feeds a future accuracy dashboard ("how good is our CP-speed-based
// ETA model?") and surfaces laycan risk if we're consistently too optimistic.
export const aisPredictionCorrections = pgTable(
  "ais_prediction_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mmsi: varchar("mmsi", { length: 15 }).notNull(),
    predictedLat: decimal("predicted_lat", { precision: 10, scale: 7 }).notNull(),
    predictedLon: decimal("predicted_lon", { precision: 10, scale: 7 }).notNull(),
    actualLat: decimal("actual_lat", { precision: 10, scale: 7 }).notNull(),
    actualLon: decimal("actual_lon", { precision: 10, scale: 7 }).notNull(),
    deltaNm: decimal("delta_nm", { precision: 7, scale: 2 }).notNull(),
    // Which resolver mode produced the wrong prediction — useful for
    // splitting "dead-reckoning drift" from "route-based guess error".
    mode: varchar("mode", { length: 20 }).notNull(),  // 'dead_reck' | 'predicted'
    aisGapSeconds: integer("ais_gap_seconds").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ais_corrections_mmsi_idx").on(table.mmsi, table.recordedAt),
  ]
);

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Party = typeof parties.$inferSelect;
export type NewParty = typeof parties.$inferInsert;
export type Linkage = typeof linkages.$inferSelect;
export type NewLinkage = typeof linkages.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DealLeg = typeof dealLegs.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type DealChangeLog = typeof dealChangeLogs.$inferSelect;

export type UserRole = "operator" | "trader" | "admin";
export type DealDirection = "buy" | "sell";
export type DealIncoterm = "FOB" | "CIF" | "CFR" | "DAP";
export type DealStatus = "draft" | "active" | "loading" | "sailing" | "discharging" | "completed" | "cancelled";
export type PartyType = "terminal" | "agent" | "inspector" | "broker";

export type WorkflowTemplate = typeof workflowTemplates.$inferSelect;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailDraft = typeof emailDrafts.$inferSelect;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type LinkageStep = typeof linkageSteps.$inferSelect;
export type NewLinkageStep = typeof linkageSteps.$inferInsert;

export type WorkflowStepStatus = "pending" | "blocked" | "ready" | "draft_generated" | "sent" | "acknowledged" | "needs_update" | "received" | "done" | "na" | "cancelled";
export type WorkflowStepType = "nomination" | "instruction" | "order" | "appointment";

export type Vessel = typeof vessels.$inferSelect;
export type NewVessel = typeof vessels.$inferInsert;
export type VesselPositionRow = typeof vesselPositions.$inferSelect;
export type NewVesselPositionRow = typeof vesselPositions.$inferInsert;
export type AisPredictionCorrection = typeof aisPredictionCorrections.$inferSelect;
export type NewAisPredictionCorrection = typeof aisPredictionCorrections.$inferInsert;
export type AisValidationFlag = typeof aisValidationFlags.$inferSelect;
export type NewAisValidationFlag = typeof aisValidationFlags.$inferInsert;

// Workflow template step shape (JSONB)
export interface WorkflowTemplateStep {
  order: number;
  name: string;
  stepType: "nomination" | "instruction" | "order" | "appointment";
  recipientPartyType: PartyType;
  emailTemplateId?: string;
  blockedByStep?: number; // legacy — kept for backward compat
  recommendedAfterStep?: number; // soft dependency — references another step's order
  description?: string;
  isExternalWait?: boolean;
}
