# CLAUDE.md — GasOps Platform (Codename: NominationEngine)

> **Source of truth**: This file supersedes all earlier CLAUDE.md and PRD.md versions.
> Based on the GasOps Session Notes (April 3, 2026) — a product spec co-authored
> with the operations team who will use the platform daily.

## What This Project Is

NominationEngine is an **email composition engine for gasoline trading operations**. It automates the post-trade workflow: from deal ingestion (AI-parsed trader recaps) through nomination/instruction email drafting to workflow tracking and audit logging.

**V1 email flow**: The program generates draft emails displayed in the UI. The operator reads the draft, copy-pastes it into Outlook, and sends from Outlook. Then the operator clicks "Sent" in the program to mark the step as done. **No direct email sending in V1** — no Resend, no Sedna, no SMTP. The program is a drafting and tracking tool.

The platform is being built for a single client first but is architected as **multi-tenant SaaS from day one**.

---

## Domain Context — Gasoline Trading Operations

### What the Operations Team Does

The operations team takes over after a trader executes a deal. They do NOT trade, blend, manage inventory, or handle storage. Their job is purely **logistics coordination and documentation**: ensuring the right nominations, instructions, and orders go to the right parties so that physical gasoline moves from seller to buyer without delays, demurrage costs, or compliance failures.

### How a Deal Flows Through Operations

1. **Trader sends a deal recap** via free-text email (always English, always email). Contains: counterparty, direction, product, quantity (+/- tolerance), laycan, ports, incoterm, pricing terms.

2. **Operator drags & drops the email** (.eml, .msg, or .docx) into the program. Deal details may also be in email attachments (PDF, Word) — AI must parse attachments too. AI parses the content into structured data. Operator confirms before any data is written.

3. **System checks for duplicates** — matching on counterparty, quantity, pricing, product, and laycan. Shows a **three-option popup**: (1) AI suggestion — shows which existing deal/linkage matches, operator confirms. (2) Manual selection — dropdown where operator picks an existing linkage themselves. (3) New deal — create from scratch.

4. **Operator enters linkage code** (from tradehouse system, e.g. `086412GSS`) and reference code (e.g. `GP54124`). These are NOT in the recap — they come from external systems.

5. **System shows all workflow steps** for this deal's incoterm/direction combo. Steps are parallel by default — operator chooses when to act. System recommends sequence but **never hard-blocks**.

6. **Operator generates drafts** one click at a time. Reviews, copies to Outlook, sends, clicks "Sent" in the program.

7. **When deal fields change** (vessel swap, qty amendment), system detects which previously sent emails used the changed fields and flags them for re-notification.

### Key Principle: Parallel Steps, Not Sequential

Most workflow steps can run in parallel. The system tracks **recommended dependencies** (e.g. "get clearance before nominating") but NEVER hard-blocks the operator from acting out of sequence. Operators know the real-world context better than any rule engine.

### Incoterm Workflow Summary

| Scenario | Who We Contact | Key Characteristic |
|----------|---------------|-------------------|
| **FOB Sale** | Terminal, loadport inspector | Buyer arranges shipping. Simpler workflow. |
| **CIF/CFR Sale** | Buyer (clearance + doc inst), terminal, inspector, agent, broker (voyage orders) | Our vessel = we coordinate everything. |
| **DAP Sale** | All CIF parties + discharge terminal + discharge inspector | Maximum responsibility. |
| **FOB Purchase** | Seller (clearance + nomination), discharge terminal, agents, inspector, broker | Our vessel. We nominate discharge terminal (we are receiver). |

Universal rule: **the receiver always nominates the discharge terminal**.

### Critical Domain Terms

- **Nomination**: Formal notification to terminal/counterparty/agent with deal details and vessel info. Contractual deadlines.
- **Laycan**: Contractual date window (2-5 days) for vessel arrival at loadport. Missing = potential contract cancellation.
- **Linkage Code**: Groups related deals into a cargo chain (e.g. 1 purchase + 2 sales sharing same vessel).
- **Q88**: Standardized vessel questionnaire. Attached to clearance emails. Required before a vessel is approved.
- **CP Recap**: Charter Party summary from freight trader when vessel is fixed. Contains data needed for voyage orders.
- **Documentary Instructions**: How the Bill of Lading should be made out — consignee, notify party, marks.
- **Voyage Orders**: Instructions to vessel (via broker) — loadport, discharge port, cargo details.
- **BL Pricing / NOR Pricing**: Price calculated based on market prices around the B/L date or NOR date. Notation: `0-0-5` = 0 days before, 0 on the day, 5 days after.
- **Contracted Qty vs Nominated Qty**: Contracted = original with tolerance (e.g. 37kt +/-10%). Nominated = declared exact number. Once declared, nominated qty is used in ALL subsequent emails.
- **T1/T2**: Customs documents. T1 = goods under customs supervision. T2 = free circulation within EU.
- **Demurrage**: $15,000–$40,000/day penalty when loading/discharge exceeds allowed time.
- **MR Tanker**: Medium Range tanker, 25,000–55,000 DWT. Standard vessel size.

### Parties the Operations Team Communicates With

| Party | When | V1 Channel |
|-------|------|------------|
| Counterparty (buyer/seller) | Clearance, nominations, doc instructions | Copy-paste to Outlook |
| Loading terminal | Nomination + documentary instructions | Copy-paste to Outlook |
| Loadport agent | Appointment | Copy-paste to Outlook |
| Loadport inspector | Appointment | Copy-paste to Outlook |
| Chartering broker | Voyage orders | Copy-paste to Outlook |
| Discharge agent/inspector | Appointment (when our vessel) | Copy-paste to Outlook |

### Terminals

Three core terminals with fixed contacts:
1. **Lavera, France** — Mediterranean hub, blending operations
2. **Antwerp, Belgium** — ARA hub
3. **Amsterdam, Netherlands** — ARA hub, global gasoline blending center

Each has its own nomination format preferences and contact persons. Templates are terminal-specific.

---

## Linkage — The Fundamental Organizational Structure

**Every deal ALWAYS belongs to a linkage.** Think of a linkage as a folder. A folder can contain one deal or many deals. There is no such thing as an "unlinked" deal.

### Linkage as Its Own Entity

Linkage is a **database table**, not just a string field. Each linkage has:
- `linkage_number` — official number from trader's ETRM system (nullable, entered later)
- `temp_name` — auto-generated (e.g. "TEMP-001") when created
- `display_name` — shows linkage_number if set, otherwise temp_name

**Prompt deals**: Deals often arrive urgently before the trader generates a linkage number. The absence of a linkage number must NEVER block the operator. The system auto-generates a temp name.

### Linkage Merging

If the operator creates two separate linkages and later discovers they're the same cargo, the system allows merging. The system asks which linkage number to keep.

### Creating Linkages

- **From deal parse**: When AI creates a new deal, operator chooses: link to existing, or create new linkage
- **From dashboard "+" button**: Creates empty linkage (no deals yet) for planned operations
- Empty linkages can have terminal operations added via the "+" button in the linkage view

### Updating the Linkage Number

The linkage number (e.g. `086412GSS`) is updated via the **inline editor in the voyage info bar** at the top of the linkage view. This is the ONLY legitimate way to change a linkage number.

- Operator clicks the linkage code in the voyage bar → inline input → save
- The update is sent to `PUT /api/linkages/:id` with `{ linkageNumber }`
- The backend cascades the new value to all child deals' `linkage_code` field via a WHERE clause on `linkage_id` FK — so every deal in the linkage stays in sync
- **Never edit `linkage_code` on an individual deal.** The deal edit form has no such input — linkage_code is read-only at the deal level. Editing it would orphan one deal from its siblings and break the linkage grouping.

### Deleting Linkages

- `DELETE /api/linkages/:id` is a **guarded delete**: if any deal still references the linkage (`linkage_id = :id`), the API returns `{ error: "linkage_has_deals" }` with HTTP 400.
- Operator must first delete (or reassign) every deal in the linkage before the linkage itself can be removed.
- The UI shows a "Delete Linkage" button that opens a confirmation modal; on a guard error it surfaces a toast: "Remove all deals from this linkage first."

### Linking Patterns

| Pattern | Example |
|---------|---------|
| 1 purchase → 1 sale | Buy 37kt, sell all to one buyer |
| 1 purchase → N sales (part cargo) | Buy 37kt, sell 5kt to A, balance to B |
| 1 purchase → N sales + balance to own terminal | Sell 7kt to A, 11kt to B, balance (~19kt) to Amsterdam |
| N purchases → 1 sale | Buy from 2 sources, blend, sell combined |

### Cascade Effects

- Purchase qty changes → flag all linked sales for review
- Vessel changes → flag ALL linked deals + ALL emails referencing that vessel
- New sale added mid-voyage → may require cancelling existing discharge nominations

### Cancellation Flow

Operator marks step as "cancelled" → system generates cancellation email from template → status set to CANCELLED (not deleted — audit trail preserved).

### Vessel Swap

Vessel change triggers cascade: all clearances re-sent, all nominations updated, voyage orders re-issued, inspectors/agents notified, all linked deals updated.

---

## Architecture Decisions

### Multi-Tenant SaaS

- **Every data model must include `tenant_id`**. No exceptions.
- Tenant isolation via shared database, tenant-scoped queries.
- V1 = single tenant. Architecture supports multiple without refactoring.

### On-Premise Deployment Support

Commodity trading firms will NOT put operational data in third-party cloud. The platform must support on-premise deployment: firm downloads and runs on their own servers. AI parsing must also run on the firm's own infrastructure — each client uses their own approved AI tool (e.g. Copilot, Cowork, Azure OpenAI). Parsing must never route through our servers. The AI provider must be swappable per deployment.

### Tech Stack

- **Frontend/Backend**: Next.js (React + TypeScript strict), Tailwind CSS
- **Database**: PostgreSQL + Drizzle ORM, RLS via `SET LOCAL`
- **Auth**: Auth.js v5 beta, JWT sessions, RBAC (Operator, Trader, Admin)
- **AI**: Abstract `parseRecap()` interface. V1 implementation: Anthropic Claude API. Must allow swapping to Azure OpenAI, AWS Bedrock, or local models per deployment.
- **Email**: V1 = copy-paste to Outlook (no direct sending). Future: Outlook/Teams API integration.

### Core Data Models

```
Tenant
  id, name, settings (JSON), created_at

User
  id, tenant_id, email, name, role (operator|trader|admin), created_at

Linkage (every deal belongs to exactly one linkage)
  id, tenant_id,
  linkage_number (nullable — official number from trader's ETRM system),
  temp_name (auto-generated, e.g. "TEMP-001"),
  display_name (computed: linkage_number ?? temp_name),
  vessel_name (nullable — shared by all deals in this linkage),
  vessel_imo (nullable),
  assigned_operator_id (nullable — primary operator for this voyage),
  secondary_operator_id (nullable — backup operator; moved from Deal),
  status (active|completed),
  created_at, updated_at

Deal
  id, tenant_id, linkage_id (FK → Linkage, required, never null),
  external_ref, counterparty, direction (buy|sell),
  deal_type (regular|terminal_operation, default: regular),
  product, contracted_qty (text with tolerance), nominated_qty (decimal, nullable),
  loaded_quantity_mt (decimal, nullable — exact loaded qty, purchase deals only),
  incoterm (FOB|CIF|CFR|DAP),
  loadport, discharge_port, laycan_start, laycan_end,
  vessel_name (nullable), vessel_imo (nullable),
  vessel_cleared (boolean), doc_instructions_received (boolean),
  pricing_formula (text — stored but NOT shown in Excel view),
  pricing_period_type (BL|NOR|Fixed|EFP|null),
  pricing_period_value (text — e.g. "0-1-5" or "1-15 Mar"),
  pricing_confirmed (boolean, default false — operator marks when settled),
  estimated_bl_nor_date (date, nullable — only for BL/NOR pricing),
  status (enum), assigned_operator_id,
  secondary_operator_id (DEPRECATED — moved to Linkage; kept for migration compat, do not read in new code),
  created_by, source_raw_text, version,
  created_at, updated_at

WorkflowTemplate
  id, tenant_id, name, incoterm, direction, region_pattern,
  steps (JSONB array of workflow steps with recommended dependencies)

WorkflowInstance
  id, deal_id, template_id, status, created_at

WorkflowStep
  id, workflow_instance_id,
  step_type (nomination|instruction|order|appointment|clearance),
  step_name, description,
  recipient_party_type (terminal|agent|inspector|counterparty|broker),
  status (pending|ready|draft_generated|sent|received|done|needs_update|cancelled|na),
  recommended_after (nullable, references another step — soft dependency, NOT a hard block),
  assigned_party_id, email_draft_id, sent_at, created_at

EmailDraft
  id, workflow_step_id, template_id, to_addresses, cc_addresses,
  subject, body, merge_fields_used (JSON),
  status (draft|reviewed|sent),
  created_at

EmailTemplate
  id, tenant_id, name, party_type, terminal_id (nullable),
  incoterm (nullable), region (nullable),
  subject_template, body_template,
  merge_fields (JSON schema), created_by, created_at

Party (terminals, agents, inspectors, brokers)
  id, tenant_id, type (terminal|agent|inspector|broker),
  name, port, region_tags (text[]), email, phone, notes,
  is_fixed (boolean), created_at

AuditLog
  id, deal_id, user_id, action, details (JSON), timestamp

DealChangeLog
  id, deal_id, field_changed, old_value, new_value,
  changed_by, affected_steps (JSON), timestamp

Document
  id, deal_id, filename, file_type (q88|cp_recap|bl|coa|other),
  storage_path, uploaded_by, created_at
```

### Workflow Engine Design

The workflow engine uses **soft dependencies, not hard blocks**:

1. When a deal is created, the system matches it against WorkflowTemplates using (incoterm, direction, region).
2. A WorkflowInstance is created with ALL steps visible immediately.
3. Each step has `recommended_after` pointing to prerequisite steps — shown as visual guidance.
4. If the operator tries to draft an email for a step where data is incomplete, system warns: "Some data is missing — proceed anyway?" Operator decides.
5. When a step becomes `draft_generated`, the operator reviews the draft, copies to Outlook, sends, and clicks "Sent" in the program.
6. When deal fields change, the system identifies sent drafts that used the changed field and flags steps as `needs_update`.

### Workflow Step Statuses

| Status | Meaning |
|--------|---------|
| (empty/pending) | Not yet started |
| DRAFT READY | Email draft generated, ready for operator review |
| SENT | Operator copied to Outlook, sent, confirmed in program |
| RECEIVED | Response received from counterparty (operator sets manually) |
| DONE | Step fully completed (non-email steps, post-trade tasks) |
| N/A | Not applicable for this deal type |
| NEEDS UPDATE | Previously sent but deal data changed — re-send required |
| CANCELLED | Cancelled — cancellation email sent |

### Excel/Spreadsheet View (In-App)

The in-app Excel view replaces the external Excel file. Two sections:
- **Main table**: Regular deals (`deal_type = 'regular'`). PURCHASE, SALE, PURCHASE+SALE sections.
- **Internal / Terminal Operations**: Linkages with only `deal_type = 'terminal_operation'` deals (own-terminal loading/discharge, no external counterparty yet).

**Grouping uses `linkage_id` (UUID FK), NEVER `linkage_code` string.** The linkage_code is volatile — it gets renamed when the operator updates the linkage number. Grouping by string would split a single voyage across two cards the moment the cascade hasn't fully propagated. All section assignment, linked-deal joining, and "purchase + sell" detection in the Excel and dashboard views MUST go through `linkage_id`.

**Auto-refresh on focus.** Both the Excel page and the dashboard MUST refetch their data when the user returns to the tab (visibility change) and on route navigation back. Otherwise renaming a linkage in the linkage view leaves stale linkage codes in the dashboard for up to 30 seconds.

**Editable cells (dropdown)**: Operator action columns have a dropdown with `(empty)` / `Done`. Selecting "Done" turns the cell green. Editable cells show a ▾ arrow.
**Locked cells (read-only)**: System-populated fields (B/L Figures, Vessel, etc.) update automatically.

**Color coding**:
- **Pattern A (most columns)**: White (not done) → Green (Done)
- **Pattern B (Pricing — BL/NOR only)**: White (not entered) → Yellow (needs monitoring) → Green (confirmed by operator)
- **Fixed/EFP pricing**: Auto-green immediately (nothing to monitor)

**Pricing column shows period, NOT formula**: e.g. "BL 0-1-5" or "NOR 3-1-3" or "Fixed 1-15 Mar" or "EFP". The formula (e.g. "Platts FOB Baltic +$5.50/MT") is stored but hidden from the operator — it's for the invoice desk.

**Est. BL/NOR date**: For BL/NOR deals, a small editable date field next to the pricing period cell.

**Completed linkages**: Operator marks linkage as "Completed" → moves to COMPLETED tab. System can suggest completion when all steps are Done.

### Change Detection Logic

When any deal field is updated:
1. Record in DealChangeLog
2. Query all EmailDrafts for this deal where `merge_fields_used` includes the changed field
3. Set affected WorkflowSteps to `needs_update`
4. Surface in task queue under "Re-notification Required"

### Delete Flows

**Deal delete** (`DELETE /api/deals/:id`) is a **hard delete**. The deal row and its dependent rows (workflow_instances, workflow_steps, email_drafts, deal_change_logs, audit_logs, deal_legs, documents) are removed via FK `ON DELETE CASCADE`. Soft-delete via `status = 'cancelled'` remains available for deals that were officially cancelled (cancellation email sent) — those stay in the DB for audit.

**Where the delete affordance must live.** The delete button MUST be accessible from EVERY surface where a deal is shown — deal detail page, linkage view, Excel/Gasoline Vessels List rows, and dashboard linkage cards. Operators don't navigate down to detail just to delete; they expect a trash icon on the row they're looking at. Each delete still opens a confirmation modal — no exceptions.

**Linkage delete** (`DELETE /api/linkages/:id`) is a **guarded delete**:
- If the linkage still has deals attached, return `{ error: "linkage_has_deals" }` with HTTP 400. No rows removed.
- If the linkage is empty, delete the linkage row.

**UI confirmation**: Every destructive action (deal delete, linkage delete) MUST open a confirmation modal before firing the DELETE request. The modal states exactly what will be removed and warns "This cannot be undone." No keyboard shortcut or gesture can bypass the modal.

### AI Deal Parsing

Abstract interface (`parseRecap()`) with swappable providers:

```
Input: Free-text email (.eml, .msg, .docx, or pasted text) + attachments (PDF, Word)
Output: {
  counterparty, direction, product,
  quantity_mt (numeric — the middle/nominal quantity, used for calculations),
  contracted_qty (string — exact tolerance text as written, e.g. "18000 MT +/-10%", "37kt +/- 5%"),
  incoterm, loadport, discharge_port, laycan_start, laycan_end,
  vessel_name, vessel_imo,
  pricing_type (BL|NOR), pricing_formula (0-0-5 notation),
  declaration_rules (e.g. "qty declared 7 days before laycan"),
  special_instructions,
  confidence_scores: { [field]: number }
}
```

**Tolerance extraction**: The parser MUST extract quantity tolerance expressed as `+/-5%`, `+/-10%`, `±5%` etc. and populate `contracted_qty` with the full text exactly as it appeared in the recap (including units). `quantity_mt` stays as the numeric middle value for arithmetic (calculations, comparisons). This split lets the operator see the original contractual quantity while the system can still compute on a number.

AI never auto-creates or auto-modifies deals. Operator always confirms.

CP Recaps are also parsed via the same drag & drop → AI parse → confirm flow.

---

## UI: Linkage View (`/linkages/[id]`)

A linkage is a **first-class route** at `/linkages/[id]`. The dashboard routes ALL linkage card clicks to this page — never to `/deals/new` or `/deals/[firstDealId]`. The page renders even when the linkage is empty (no deals). Think of it as opening a folder on a computer: an empty folder is a valid state.

When the operator opens a cargo chain, the screen is divided into three sections:

### Top Section — Voyage Info & Vessel
- Linkage code (inline-editable — edits cascade to all child deals via `PUT /api/linkages/:id`)
- Reference codes, product, quality
- Vessel information (name, IMO, Q88 attached) — stored on the **linkage**, not the deal
- CP recap (attached/parsed)
- **Assigned operators — primary + secondary, both at the linkage level.** Operators work entire voyages, not individual deals. The secondary operator is a backup/coverage; both are set once per linkage and apply to every buy/sell deal inside it. Editing the primary or secondary is done via the voyage bar, never via a deal form.
- Pricing terms (prominently displayed, highlighted if approaching)
- Voyage orders and discharge orders (per-vessel, not per-deal)
- **Delete Linkage** button (guarded — only succeeds if the linkage is empty)

### Left Section — Buy Side
- Purchase deal(s): counterparty, qty, laycan, incoterm, loadport
- Workflow steps for the buy side

### Right Section — Sell Side
- **"+" button always visible** at bottom with two options:
  - **"Add sale"** — creates a new sale deal block (counterparty, qty, destination, full sell-side workflow)
  - **"Discharge to own terminal"** — operator selects from company's own terminal list (Amsterdam, Antwerp, Lavera). Creates a discharge block with: terminal nomination + agent nomination + inspector nomination. No counterparty, no doc instructions — just discharge logistics.
  - **CRITICAL**: Both "+" actions MUST attach the new deal to the CURRENT linkage (`linkageId` from the deal being viewed). The terminal-operation creation MUST include `dealType: "terminal_operation"` in the API payload — otherwise the deal is treated as a regular buy and lands in the wrong section of the Excel view. The POST `/api/deals` endpoint also accepts `linkageCode` lookup as a fallback when `linkageId` is missing, so a stale closure or omitted prop never silently spawns a fresh TEMP linkage.
- Each block is independent and collapsible
- If the operator later sells the remaining balance, the own terminal block is CANCELLED (cancellation emails generated) and replaced with a new sale block
- Balance = total purchased qty minus all sold quantities. Always an approximation until outturn report (e.g. buy 37kt, sell 7kt + 11kt → balance ~19kt)

---

## Contact Management

### Region-Based Filtering

Agents and inspectors are tagged with ports/regions they cover. When drafting for a specific port, system filters to show only parties operating in that region. Operator selects from filtered list (or overrides).

### Agent Nomination Logic

- **Our vessel** (FOB purchase, CIF/CFR/DAP sale): we appoint agents at both ports
- **Buyer's vessel** (FOB sale): buyer appoints the agent

### Inspector Appointment Logic

Same region-based filtering as agents. Tagged by ports/regions they cover.

---

## User Roles

| Role | Permissions |
|------|------------|
| **Operator** | Full access: create/edit deals, review drafts, mark as sent, manage tasks, assign parties |
| **Trader** | Read-only: view deal status, cargo progress. Cannot edit or send. |
| **Admin** | Operator + manage users, templates, contacts, tenant settings |

---

## V1 Scope — What to Build First

### In Scope
1. AI deal parsing (drag & drop .eml/.msg/.docx, or paste text)
2. Deal deduplication (new / update / similar)
3. Linkage code grouping (cargo chains)
4. Workflow engine with soft dependencies (all steps visible, no hard blocks)
5. Email draft generation (copy-paste to Outlook flow)
6. "Sent" button per draft (operator confirms after sending from Outlook)
7. Task queue dashboard (pending tasks, re-notifications, laycan urgency)
8. Change detection and re-notification flagging
9. Party management with region-based filtering
10. Excel sync (read/write to GASOLINE VESSELS LIST)
11. Audit log per deal
12. Two operators per **linkage** (primary + secondary) — operators work entire voyages
13. Quantity declaration logic (contracted vs nominated)
14. Pricing tracking (BL/NOR type, formula, estimated date)
15. Cancel and vessel swap cascade flows

### Out of Scope for V1
- Direct email sending (Outlook, Sedna, SMTP)
- Teams/Outlook API integration
- Blending, storage, inventory
- Demurrage calculations
- Customs clearance workflows
- Vessel vetting/sanctions
- Payment/invoice tracking
- Mobile native app

---

## Coding Conventions

- TypeScript strict mode everywhere. No `any` types.
- All database queries scoped by `tenant_id`. Never forget tenant isolation.
- All API endpoints require authentication and tenant context.
- Use Zod for runtime validation (always `safeParse`, never `parse`).
- Use PostgreSQL transactions for multi-table operations.
- Every state change on a WorkflowStep must create an AuditLog entry.
- Email templates use `{{field_name}}` merge syntax.
- All dates stored as UTC. Display in user's local timezone.
- AI parsing behind abstract interface — provider-agnostic.
- The program generates drafts only. No direct email sending in V1.

---

## Environment Variables

```
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...   # V1 AI provider (swappable)
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
DEMO_ENABLED=true              # Enable /demo provisioning
```

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| AI parsing accuracy | Operator always confirms. Low-confidence fields highlighted. Never auto-create. |
| Operator blocked by hard gates | No hard blocks. Soft recommendations only. Operators know the real-world sequence. |
| Client won't use cloud hosting | Architecture supports on-premise deployment. AI provider swappable. |
| Workflow template complexity | Start with 2-3 most common scenarios. Template-driven (data, not code). Add iteratively. |
| Excel sync conflicts | Program never overwrites operator-managed columns. Clear ownership per column. |
| Multi-tenant data leakage | tenant_id in every query via RLS. Automated isolation tests. |
