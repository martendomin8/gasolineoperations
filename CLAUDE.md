# CLAUDE.md — GasOps Platform (Codename: NominationEngine)

## What This Project Is

NominationEngine is a **SaaS web platform for gasoline trading operations teams** that automates the post-trade workflow: from deal ingestion through nomination/instruction email generation to task tracking and audit logging. It replaces the current process of manually re-entering deals from trader emails into Excel, then copy-pasting nomination templates and relying on memory for deadlines.

The platform is being built initially for a single client (a European physical gasoline trading operations firm) but is architected as **multi-tenant SaaS from day one** with the goal of serving other commodity trading operations teams.

---

## Domain Context — Gasoline Trading Operations

### What the Operations Team Does

The operations team takes over after a trader executes a deal. They do NOT trade, blend, manage inventory, or handle storage. Their job is purely **logistics coordination and documentation**: ensuring the right nominations, instructions, and orders go to the right parties in the right sequence so that physical gasoline moves from seller to buyer without delays, demurrage costs, or compliance failures.

### How a Deal Flows Through Operations

1. **Trader sends a deal recap** via free-text email or chat (unstructured). Contains: counterparty name, buy or sell direction, product grade, quantity (MT), loading/discharge dates (laycan), loadport, discharge port, incoterm, and sometimes a vessel name.

2. **Operator checks if the deal already exists** in the shared Excel database by matching on: counterparty + buy/sell direction + delivery/loading dates + product + quantity + location.

3. **If new, operator adds the deal** and analyzes it to determine what communications need to go out, based on:
   - **Incoterm** (FOB, CIF/CFR, DAP) — determines who arranges shipping, who nominates vessel, who coordinates with which parties
   - **Buy or Sell direction** — determines which side you're on and who you nominate to
   - **Region/port** — determines terminal contacts, customs requirements (T2 intra-EU vs T1 export vs EAD), and region-specific documentary requirements (e.g., SCAC code for US-bound B/Ls)

4. **Operator sends nominations/instructions in a specific sequence** with dependency gates. For example, on a CIF sale:
   - FIRST: Send vessel clearance request to buyer
   - WAIT: Buyer clears vessel and returns documentary instructions
   - THEN: Send nomination + documentary instructions to loading terminal (these are the same email to the terminal)
   - ALSO: Appoint inspector at loadport, send voyage orders to chartering broker, appoint agent at loadport

5. **Operator tracks the cargo** through loading, sailing, and discharge, handling mid-process changes (vessel swaps, quantity amendments, laycan shifts) and re-notifying affected parties.

6. **Operator maintains an audit trail** of every communication sent, action taken, and change made per deal.

### Key Incoterm Workflow Differences

**FOB Sale (you are seller, buyer arranges shipping):**
- Contact: terminal (loading instructions), inspector (appointment)
- Buyer nominates the vessel; you accept/reject
- Simpler workflow — fewer parties to coordinate on your side

**CIF/CFR Sale (you are seller, you arrange shipping):**
- Contact: buyer (vessel clearance request → WAIT for clearance + doc instructions), terminal (nomination + doc instructions), inspector (loadport appointment), agent (loadport), chartering broker (voyage orders)
- Sequence matters: terminal nomination BLOCKED until buyer returns clearance + doc instructions
- You also coordinate discharge side via chartering broker

**DAP Sale (you deliver to destination):**
- Maximum responsibility on seller — all of CIF plus discharge coordination
- You choose loadport inspector yourself (no cost-sharing negotiation)

**FOB Purchase (you are buyer, you arrange shipping):**
- You nominate vessel to seller
- You coordinate with your own terminal/agent at discharge
- You appoint inspector (cost-shared 50/50 with seller typically)

### Critical Domain Terms

- **Nomination**: Formal notification to a terminal, counterparty, or agent with deal details and vessel information. Has strict contractual deadlines.
- **Laycan (Laydays/Cancelling)**: The contractual window (usually 2-3 days) during which the vessel must arrive for loading. Missing this window can result in contract cancellation.
- **Documentary Instructions**: Instructions specifying how the Bill of Lading should be made out — consignee, notify party, marks, and any special requirements (e.g., SCAC code for US destinations).
- **Voyage Orders**: Instructions sent to the vessel (via chartering broker) specifying loadport, discharge port, cargo details, and operational requirements.
- **Notice of Readiness (NOR)**: Formal notice from vessel master that the ship is ready to load/discharge. Triggers laytime calculation.
- **Demurrage**: Penalty paid when vessel loading/discharge exceeds allowed laytime. Rates are $15,000–$40,000/day for MR tankers. "Once on demurrage, always on demurrage."
- **Bill of Lading (B/L)**: The most important shipping document — receipt of cargo, evidence of carriage contract, and document of title. Must match documentary instructions exactly.
- **Letter of Indemnity (LOI)**: Used when original B/Ls haven't arrived at discharge port. Allows discharge but carries counterparty risk.
- **MR Tanker**: Medium Range tanker, 25,000–55,000 DWT. The standard vessel size for this operation.
- **Customs Documents**: T2 (intra-EU movement, no customs clearance), T1 (transit under customs supervision), EAD (Export Accompanying Document for exports outside EU), EUR1/ATR1 (preferential origin certificates), INF3 (used for re-import after outward processing).

### Parties the Operations Team Communicates With

| Party | When | Channel |
|-------|------|---------|
| Counterparty (buyer/seller) | Vessel nomination, clearance requests, doc instructions | Sedna email |
| Loading terminal | Nomination + documentary instructions (same email) | Sedna email |
| Loadport agent | Appointment, vessel arrival coordination | Sedna email |
| Loadport inspector | Appointment for Q&Q certification | Sedna email |
| Chartering broker | Voyage orders, discharge instructions (relayed to vessel) | Sedna email |
| Discharge port agent | Appointment (when CIF/CFR/DAP) | Sedna email |
| Discharge inspector | Appointment (when CIF/CFR/DAP) | Sedna email |
| Customs broker | Fully outsourced, not in platform scope | External |

### Terminals

Three core terminals with deep relationships and fixed contacts:
1. **Klaipeda, Lithuania** — Baltic hub, blending operations
2. **Antwerp, Belgium** — ARA hub
3. **Amsterdam, Netherlands** — ARA hub, global gasoline blending center

Each terminal has its own nomination format preferences, operational requirements, and contact persons. Templates will be terminal-specific.

---

## Architecture Decisions

### Multi-Tenant SaaS

- **Every data model must include a `tenant_id`** field. No exceptions.
- Tenant isolation at the database level (shared database, tenant-scoped queries).
- Each tenant has their own: workflow templates, terminal contacts, agent/inspector database, email templates, operator users.
- V1 launches with a single tenant but the architecture must support multiple tenants without refactoring.

### Tech Stack

- **Frontend**: React (Next.js) with TypeScript, Tailwind CSS
- **Backend**: Node.js (Next.js API routes) or Python (FastAPI) — TBD based on Sedna API integration requirements
- **Database**: PostgreSQL with row-level security for multi-tenancy
- **AI/NLP**: Anthropic Claude API for parsing unstructured deal recaps into structured deal objects
- **Email Integration**: Sedna Platform API (OAuth 2.0, API keys) for sending drafted emails through the existing Sedna shared inbox
- **Hosting**: Cloud-hosted (Vercel/Railway/AWS) with mobile-responsive design
- **Auth**: Role-based access control (Operator, Trader read-only, Admin)

### Core Data Models

```
Tenant
  id, name, settings (JSON), created_at

User
  id, tenant_id, email, name, role (operator|trader|admin), created_at

Deal
  id, tenant_id, external_ref, counterparty, direction (buy|sell),
  product, quantity_mt, incoterm (FOB|CIF|CFR|DAP|FCA),
  loadport, discharge_port, laycan_start, laycan_end,
  vessel_name (nullable), vessel_imo (nullable),
  vessel_cleared (boolean), doc_instructions_received (boolean),
  status (enum), assigned_operator_id, created_by,
  source_raw_text (the original unstructured email text),
  created_at, updated_at

DealLeg (for linked buy/sell or chains)
  id, deal_id, direction, counterparty, incoterm, ...

WorkflowTemplate
  id, tenant_id, name, incoterm, direction, region_pattern,
  steps (JSONB array of ordered workflow steps with dependency gates)

WorkflowInstance
  id, deal_id, template_id, current_step, status, created_at

WorkflowStep
  id, workflow_instance_id, step_type (nomination|instruction|order|appointment),
  recipient_party_type (terminal|agent|inspector|counterparty|broker),
  status (pending|blocked|ready|draft_generated|sent|acknowledged),
  blocked_by (nullable, references another step),
  email_draft_id (nullable), sent_at, created_at

EmailDraft
  id, workflow_step_id, template_id, to_addresses, cc_addresses,
  subject, body, merge_fields_used (JSON), status (draft|reviewed|sent),
  sedna_message_id (nullable), sent_via_sedna_at, created_at

EmailTemplate
  id, tenant_id, name, party_type, terminal_id (nullable),
  incoterm (nullable), region (nullable), subject_template, body_template,
  merge_fields (JSON schema of available fields), created_by, created_at

Party (terminals, agents, inspectors, brokers)
  id, tenant_id, type (terminal|agent|inspector|broker),
  name, port, email, phone, notes, is_fixed (boolean), created_at

AuditLog
  id, deal_id, user_id, action, details (JSON),
  timestamp

DealChangeLog
  id, deal_id, field_changed, old_value, new_value,
  changed_by, affected_steps (JSON array of step IDs needing re-notification),
  timestamp

Task (materialized view or computed from WorkflowSteps)
  operator_id, deal_id, step_description, due_date,
  priority, status, blocked_reason (nullable)
```

### Workflow Engine Design

The workflow engine is the heart of the platform. It operates as a **state machine with dependency gates**:

1. When a deal is created, the system matches it against WorkflowTemplates using (incoterm, direction, region).
2. A WorkflowInstance is created with ordered steps.
3. Each step has a `blocked_by` field pointing to prerequisite steps.
4. Steps become `ready` only when all prerequisites are `sent` or `acknowledged`.
5. When a step becomes `ready`, it auto-generates an EmailDraft using the appropriate EmailTemplate, populating merge fields from the Deal record.
6. The operator sees the draft in their task queue, reviews it, and clicks send.
7. Sending pushes the email through Sedna's API.
8. When a Deal field changes, the system identifies all sent EmailDrafts that used that field as a merge field, and flags the corresponding WorkflowSteps for re-notification.

### Change Detection Logic

When any deal field is updated:
1. Record the change in DealChangeLog.
2. Query all EmailDrafts for this deal where `merge_fields_used` includes the changed field.
3. For each affected draft, set the corresponding WorkflowStep status to `needs_update`.
4. Generate a new draft with updated values and surface it in the operator's task queue as a re-notification task.

### AI Deal Parsing

The platform uses Claude API to parse unstructured trader emails into structured deal objects:

```
Input: Free-text email or chat message from trader
Output: {
  counterparty: string,
  direction: "buy" | "sell",
  product: string,
  quantity_mt: number,
  incoterm: "FOB" | "CIF" | "CFR" | "DAP",
  loadport: string,
  discharge_port: string,
  laycan_start: date,
  laycan_end: date,
  vessel_name: string | null,
  vessel_imo: string | null,
  pricing_formula: string | null,
  special_instructions: string | null,
  confidence_scores: { [field]: number }
}
```

The system should present low-confidence fields highlighted for operator review before creating the deal. The operator confirms or corrects before the deal enters the workflow.

### Sedna Integration

- **Sending**: Use Sedna Platform API to create and send messages through the team's shared Sedna inbox, maintaining the single communication thread.
- **Reading (V2)**: Potentially use Sedna API to ingest incoming deal recap emails and auto-trigger the AI parsing pipeline.
- **Authentication**: OAuth 2.0 with API keys managed per tenant.
- **Fallback**: If Sedna API is unavailable, generate email drafts that can be manually copy-pasted into Sedna.

---

## User Roles

| Role | Permissions |
|------|------------|
| **Operator** | Full access: create/edit deals, review/send emails, manage tasks, assign inspectors/agents, view audit logs |
| **Trader** | Read-only: view deal status, cargo progress, task status. Cannot edit deals or send emails. |
| **Admin** | Everything Operator has + manage users, workflow templates, email templates, terminal/party contacts, tenant settings |

---

## V1 MVP Scope (4–6 week target)

### In Scope
1. **Workflow engine** with 10-25 configurable templates (incoterm × direction × region)
2. **AI deal parsing** from unstructured text (Claude API integration)
3. **Deal deduplication** against existing Excel import (counterparty + direction + dates + product + quantity + port)
4. **Task queue dashboard** per operator showing next actions across all active deals
5. **Email draft generation** with merge fields from deal data
6. **Template editor** for creating/managing nomination and instruction email templates per terminal/incoterm/region
7. **Dependency gates** preventing out-of-sequence communications
8. **Change detection** flagging which parties need re-notification when deal fields change
9. **Audit log** per deal (who sent what, when, to whom)
10. **Trader read-only view** of cargo status
11. **Excel import** for existing deal database
12. **Party management** (terminals with fixed contacts, agents and inspectors as selectable per deal)

### Out of Scope for V1
- Blending operations or recipe management
- Inventory/storage tracking
- Demurrage calculation engine
- Freight/voyage cost calculations
- Customs clearance workflows (outsourced to broker)
- Vessel vetting/sanctions screening (existing separate platform)
- Payment/invoice tracking
- Sedna read integration (V2 — auto-ingesting incoming emails)
- Mobile native app (responsive web only for V1)

---

## Coding Conventions

- TypeScript strict mode everywhere. No `any` types.
- All database queries scoped by `tenant_id`. Never forget tenant isolation.
- All API endpoints require authentication and tenant context.
- Use Zod for runtime validation of deal parsing outputs and API inputs.
- Use PostgreSQL transactions for any operation that touches multiple tables.
- Every state change on a WorkflowStep must create an AuditLog entry.
- Email templates use a simple `{{field_name}}` merge syntax.
- All dates stored as UTC. Display in user's local timezone.
- Test coverage required for: workflow state machine transitions, deal deduplication logic, change detection logic, AI parsing output validation.
- Use feature flags for tenant-specific customizations.

---

## File Structure

```
/src
  /app                    # Next.js app router pages
    /dashboard            # Operator task queue (primary view)
    /deals                # Deal list, detail, creation
    /deals/[id]           # Individual deal view with workflow status
    /templates            # Email template editor
    /parties              # Terminal, agent, inspector management
    /settings             # Tenant settings, user management
    /api                  # API routes
      /deals              # CRUD, deduplication check, AI parsing
      /workflows          # Step progression, draft generation
      /emails             # Draft review, Sedna send integration
      /templates          # Email template CRUD
      /parties            # Party CRUD
      /import             # Excel import endpoint
  /lib
    /db                   # Database client, migrations, queries
    /workflow-engine      # State machine, dependency resolution, step progression
    /ai                   # Claude API integration for deal parsing
    /sedna                # Sedna API client
    /email-generator      # Template merge engine
    /change-detector      # Field change → re-notification mapping
    /deduplication        # Deal matching logic
    /auth                 # Authentication, RBAC middleware
    /types                # Shared TypeScript types and Zod schemas
  /components
    /task-queue           # Operator dashboard components
    /deal-form            # Deal creation/edit with AI-parsed preview
    /workflow-viewer      # Visual workflow status per deal
    /email-preview        # Draft review and send UI
    /template-editor      # Email template creation/management
```

---

## Environment Variables

```
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
SEDNA_API_KEY=...
SEDNA_API_BASE_URL=https://api.sedna.com/v1
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
```

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| AI parsing accuracy on unstructured deal emails | Always show operator a confirmation step with highlighted low-confidence fields. Never auto-create deals without human review. |
| Sedna API rate limits or downtime | Implement fallback: generate downloadable email drafts that can be copy-pasted into Sedna manually. Queue failed sends for retry. |
| Workflow template complexity across 10-25 combinations | Start with the 3-5 most common templates (FOB sale ARA, CIF sale ARA, FOB purchase Klaipeda, CIF sale Klaipeda). Add remaining templates iteratively based on actual deal flow. |
| Multi-tenant data leakage | Enforce tenant_id in every query via database middleware/RLS. Automated tests that verify cross-tenant isolation. |
| Excel import data quality | Validate and preview imported data before committing. Surface field mapping issues to the operator. |
