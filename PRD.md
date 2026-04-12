# Product Requirements Document (PRD)
## NominationEngine — Gasoline Operations Email Composition Engine

**Version**: 2.0
**Date**: April 4, 2026
**Status**: V1 prototype shipped. V2 spec aligned with operations team input.
**Source of truth**: GasOps Session Notes (April 3, 2026) — co-authored with the operator who will use the platform.
**Target User**: Physical gasoline trading operations teams (4–10 operators per firm)

---

## 1. Executive Summary

NominationEngine is an email composition engine for gasoline trading operations. It replaces the current manual workflow where operators receive unstructured deal recaps from traders, re-enter them into a shared Excel file, then compose 5-15 emails per deal by copy-pasting from previous messages while relying on memory for deadlines and sequences.

The platform automates the email composition part while keeping the operator in full control. Deals are parsed from trader emails using AI, stored in a database (with Excel as a synced secondary view), and routed through configurable workflow templates that determine which emails need to go out based on incoterm, direction, and region. Each step generates a draft email that the operator copy-pastes into Outlook and sends manually. The system tracks what has been sent, what is pending, and what needs updating when deal data changes.

**V1 prototype** was built in a single evening (March 28, 2026) as a proof of concept. It demonstrated: AI deal parsing, workflow engine with dependency gates, email draft generation, task queue dashboard, and multi-tenant architecture.

**V2 spec** (this document) incorporates detailed feedback from the operations team to align the product with how the business actually works.

---

## 2. Problem Statement

### Problems We Are Solving

**Manual deal re-entry from unstructured sources.** Traders send recaps as free-text emails. Operators manually extract counterparty, direction, product, quantity, dates, ports, incoterms, and pricing — then re-enter into a shared Excel file. 10-15 minutes per deal, error-prone.

**Tribal knowledge workflow routing.** Which emails go to whom, in what order, for which incoterm/direction combo — all lives in operators' heads. ~10-25 unique scenarios. New operators have no system to learn from.

**Copy-paste email drafting.** Operators find a similar previous email, copy it, replace fields manually. Stale data left in from previous emails. Time-consuming and error-prone.

**No change propagation.** When a deal changes (vessel swap, qty amendment, laycan shift), operators must manually remember which parties were already notified and re-send. No system detects which communications are stale.

**No deadline tracking.** Nomination deadlines tracked by memory. Demurrage at $15K-$40K/day on MR tankers makes missed deadlines extremely expensive.

**No audit trail.** No consolidated log of what was sent to whom, when, by which operator, for which deal.

### Problems We Are NOT Solving

Blending, storage/inventory, demurrage calculations, freight calculations, customs clearance (outsourced), vessel vetting (separate platform), invoice/payment tracking, trading/execution.

---

## 3. User Personas

### Primary: The Operator (4-10 per firm)

Generalist post-trade operations professional. Manages 5-25 active cargoes simultaneously. Works in Outlook for email, shared Excel for deal tracking. Day is constant context-switching between cargoes and counterparties. Measured on zero demurrage incidents, nomination accuracy, and throughput.

**Core need**: "Tell me what I need to do next for every cargo — and don't let me forget anything or send wrong information."

### Secondary: The Trader (read-only)

Executes deals. Needs visibility into operational status without interrupting the ops team.

### Tertiary: The Admin / COO

Manages operations function. Configures templates, onboards operators, oversees workload.

---

## 4. Feature Requirements

### 4.1 AI Deal Ingestion

**AI-1**: Operator drags & drops email file (.eml, .msg, or .docx) into the program. AI parses free-text content into structured data.

**AI-2**: Extracts: counterparty, direction, product, quantity (with tolerance), laycan, incoterm, loadport, discharge port, pricing terms (BL/NOR type, formula notation, estimated date), declaration rules, vessel info, special instructions.

**AI-3**: Confidence scores per field. Low-confidence fields highlighted for operator review.

**AI-4**: Operator ALWAYS confirms before any data is written. AI never auto-creates or auto-modifies deals.

**AI-5**: AI provider is behind abstract `parseRecap()` interface. V1: Anthropic Claude API. Each client firm uses their own approved AI tool (e.g. Copilot, Cowork, Azure OpenAI) — parsing must run on the firm's infrastructure, not ours.

**AI-5b**: Deal details may be in email attachments (PDF, Word). AI must parse attachments too, not just the email body text.

**AI-6**: CP Recap parsing uses the same drag & drop → parse → confirm flow. Parsed data feeds into voyage orders.

**AI-7**: Deal update via new email: operator clicks existing deal, drags new email onto it, system parses as update, refreshes fields, flags stale emails for re-send.

**AI-8**: **Quantity tolerance extraction**. The parser MUST recognise tolerance notation (`+/-5%`, `+/-10%`, `±5%`, etc.) and populate two distinct fields: `quantity_mt` (the numeric middle value, used for all calculations and Excel display) AND `contracted_qty` (the full string exactly as it appeared in the recap, e.g. `"18000 MT +/-10%"`, `"37kt +/- 5%"`). This preserves the operator's view of the original contractual quantity while keeping a clean number for arithmetic. Both the regex fallback parser and the LLM tool schema must support this.

### 4.2 Deduplication

**DD-1**: After parsing, system checks existing deals. Match on: counterparty, quantity, pricing, product, laycan.

**DD-2**: Three-option popup: (1) **AI suggestion** — shows which existing deal/linkage matches, operator confirms. (2) **Manual selection** — dropdown where operator picks an existing linkage themselves. (3) **New deal** — create from scratch.

### 4.3 Deal Management

**DM-1**: Two creation paths: AI parse (drag & drop or paste) and manual form.

**DM-2**: Reference code (e.g. `GP54124`) entered manually by operator — NOT in the recap, comes from tradehouse system.

**DM-3**: Linkage code (e.g. `086412GSS`) entered manually. Groups related deals into cargo chains.

**DM-4**: Two operators per **linkage** (primary + secondary), displayed as initials (e.g. `AB/CD`). Operators work entire voyages, not individual deals — so the assignment lives on the linkage and is inherited by every buy/sell deal inside it. See OP-1.

**DM-5**: Quantity split: `contracted_qty` (original with tolerance, e.g. "37kt +/-10%") and `nominated_qty` (declared exact number). Once nominated qty exists, ALL subsequent emails use it.

**DM-6**: Pricing split: `pricing_type` (BL or NOR), `pricing_formula` (day-range notation, e.g. "0-0-5"), `pricing_estimated_date`. Display prominently — critical for hedge timing.

**DM-7**: Status state machine: `draft → active → loading → sailing → discharging → completed → cancelled`. Completed deals disappear from active views (linkage tracking, task queue, dashboard) but remain in database for audit trail. Operator manually marks a deal as completed.

**DM-8**: Deal fields editable. Changes logged to `dealChangeLogs`. Re-notification flagging on affected steps.

**DM-9**: **Hard delete with confirmation**. `DELETE /api/deals/:id` removes the deal row and its dependent rows (workflow instances, workflow steps, email drafts, change logs, audit logs, deal legs, documents) via FK `ON DELETE CASCADE`. The UI surfaces a "Delete Deal" button on the deal detail page that opens a confirmation modal ("Delete this deal permanently? This cannot be undone.") — no destructive action fires without the modal. Soft-delete via `status = 'cancelled'` remains for officially cancelled deals; hard delete is for deals created in error that should not pollute the audit trail.

**DM-10**: **`linkage_code` is read-only on deal edit forms.** Operators must never edit the linkage code of an individual deal — editing the code on one deal would orphan it from its siblings. Linkage number changes happen at the linkage level only (see LC-7).

**DM-11**: **Terminal operation deal type is set at creation.** Any code path that creates an "own terminal loading/discharge" deal MUST set `deal_type = "terminal_operation"` on the API payload. The Zod schema defaults to `"regular"`, so omitting the field silently corrupts the categorization (terminal ops show up under PURCHASE in the Excel view instead of INTERNAL/TERMINAL OPERATIONS). The "+ Discharge to own terminal" / "+ Load from own terminal" buttons in the linkage view's `AddDealMenu` must always pass `dealType: "terminal_operation"`.

**DM-12**: **POST `/api/deals` accepts `linkageCode` as a fallback when `linkageId` is missing.** Historically the endpoint silently auto-created a fresh TEMP-NNN linkage whenever `linkageId` was absent — even when the caller passed a valid `linkageCode`. That made stale closures and omitted props silently spawn duplicate linkages. The endpoint now resolves `linkageCode` → `linkage_id` (within the tenant) before falling back to auto-create. If the lookup succeeds, the new deal joins the existing linkage. Auto-create only fires when BOTH `linkageId` and `linkageCode` are missing.

### 4.4 Deal Linking (Cargo Chains)

**LC-1**: Deals grouped by `linkage_code`. All deals sharing a code are part of the same cargo chain.

**LC-2**: Supports 1:1, 1:N, N:1, and mixed linking patterns. Part cargo with balance to own terminal.

**LC-3**: Qty tracking per linkage: total purchased, total sold, remaining balance. Balance = total purchased qty minus all sold quantities (e.g. buy 37kt, sell 7kt + 11kt → balance ~19kt). Balance is always an approximation.

**LC-4**: Cascade detection: when any deal field changes, query all linked deals + all emails that used that field → flag for re-notification.

**LC-5**: Cancellation flow: mark step as cancelled → generate cancellation email → preserve in audit trail (never delete).

**LC-6**: Vessel swap cascade: all clearances re-sent, nominations updated, voyage orders re-issued, all linked deals updated.

**LC-7**: **Linkage number editor + guarded delete**.
- The linkage number is editable via an inline input in the voyage info bar of the linkage view. Saving calls `PUT /api/linkages/:id { linkageNumber }`, which cascades the new value to every child deal's `linkage_code` via a `WHERE linkage_id = :id` clause. This is the only supported way to change a linkage number.
- `DELETE /api/linkages/:id` is **guarded**: if any deal still references the linkage (`linkage_id = :id`), the endpoint returns `{ error: "linkage_has_deals" }` with HTTP 400. The UI surfaces a toast: "Remove all deals from this linkage first." Only empty linkages can be deleted. The delete button opens a confirmation modal.

### 4.5 Workflow Engine

**WF-1**: Template-driven. Each incoterm × direction × region combination is a configuration, not hardcoded logic. New scenarios added as templates (data in database), not code.

**WF-2**: On deal creation, auto-match best WorkflowTemplate using scoring algorithm.

**WF-3**: ALL steps visible immediately, even if data is incomplete. Operator always sees the full picture.

**WF-4**: **Parallel by default.** Steps have `recommended_after` (soft dependency) for guidance. System shows recommendations but NEVER hard-blocks the operator from acting out of sequence.

**WF-5**: If operator tries to draft with incomplete data, system warns: "Some data is missing — proceed anyway?" Operator decides.

**WF-6**: Step statuses: (empty) / DRAFT READY / SENT / RECEIVED / DONE / N/A / NEEDS UPDATE / CANCELLED.

**WF-7**: Start with 2-3 most common scenarios (agreed with operations team). Add remaining templates iteratively.

### 4.6 Email Draft Generation

**ED-1**: `{{field_name}}` merge syntax. All deal fields + assigned party fields available.

**ED-2**: Templates scoped by party type, incoterm, terminal. Auto-match with fallback.

**ED-3**: V1 flow: program generates draft → operator reviews in UI → copies to Outlook → sends from Outlook → clicks "Sent" in program → step turns green.

**ED-4**: "Draft" button exists in UI (V1: copy-to-clipboard. Future: opens as Outlook draft).

**ED-5**: Template editor at `/settings/templates` for creating/managing templates per terminal/incoterm/region.

**ED-6**: Terminal-specific templates — Amsterdam, Klaipeda, Antwerp each have different nomination formats.

### 4.7 Task Queue Dashboard

**TQ-1**: Shows all actionable tasks, waiting tasks, and re-notification tasks.

**TQ-2**: Each task: deal ref, counterparty, step description, recipient party type.

**TQ-3**: Laycan urgency panel: deals within 5 days of laycan start, color-coded.

**TQ-4**: Summary stats: Active Cargoes, Pending Tasks, Awaiting Reply, Laycan Critical.

**TQ-5**: Task links directly to deal detail page.

### 4.8 Change Detection & Re-Notification

**CD-1**: On deal update, identify all sent EmailDrafts that used the changed field.

**CD-2**: Flag affected steps as `needs_update`. Surface in task queue.

**CD-3**: All changes logged in dealChangeLogs and auditLogs.

### 4.9 Contact Management

**CM-1**: Party directory per tenant: terminal, agent, inspector, broker, counterparty.

**CM-2**: Region/port tags on agents and inspectors for location-based filtering.

**CM-3**: When drafting for a specific port, system filters contacts to that region. Operator selects from filtered list (or overrides).

**CM-4**: Counterparty autocomplete: operator types → system suggests matches.

**CM-5**: Agent nomination logic: our vessel = we appoint. Buyer's vessel = buyer appoints.

### 4.9b Operator Assignment

**OP-1**: **Secondary operator lives at the linkage level, not the deal level.** Operators are assigned per voyage/cargo chain, because in real-world operations an operator either handles the whole linkage or none of it — it would be disruptive for a buy deal and its matching sale to have different owners. The `linkages` table owns both `assigned_operator_id` (primary) and `secondary_operator_id`. Every deal in the linkage inherits both. Deal forms do NOT show a secondary operator selector when the deal belongs to a linkage — the field is managed via the voyage info bar of the linkage view. The deprecated `deals.secondary_operator_id` column is kept for migration compatibility but must not be read by new code.

### 4.10 Excel Sync

**XL-1**: Program reads from and writes status updates to the operators' GASOLINE VESSELS LIST Excel file.

**XL-2**: Excel has ONGOING sheet (PURCHASE, SALE, PURCHASE+SALE sections) and COMPLETED sheet.

**XL-3**: Some columns are operator-managed (COA to Traders, Outturn, Freight invoice, INVOICE TO CP). Program NEVER overwrites these.

**XL-4**: Linked deals in PURCHASE+SALE section share vessel and linkage code (merged cells in Excel).

**XL-5**: **Section grouping uses `linkage_id` (UUID FK), never `linkage_code` string.** The Excel view's PURCHASE / SALE / PURCHASE+SALE / INTERNAL TERMINAL OPERATIONS sections must group deals by `linkage_id`. Grouping by `linkage_code` (the cached display string) is forbidden because the string changes whenever an operator renames a linkage and any unpropagated row would split a single voyage across two cards.

**XL-6**: **Excel and dashboard pages auto-refetch on focus.** Both the `/excel` page and the `/dashboard` page register a `visibilitychange` listener and refetch their data whenever the document becomes visible. They also refetch when the route becomes active again (return navigation). Without this, renaming a linkage in another tab leaves the user staring at stale linkage codes.

**XL-7**: **Inline delete affordance on Excel and dashboard rows.** Each row in the Excel view's PURCHASE / SALE / PURCHASE+SALE / INTERNAL sections has a small trash icon (visible on hover, hard-to-click-by-accident). The dashboard linkage cards also expose a trash button. Both fire the standard "Delete this deal? This cannot be undone." confirmation modal before calling `DELETE /api/deals/:id`. Operators must never have to navigate down to the deal detail page just to delete a misplaced deal.

### 4.11 Document Handling

**DH-1**: Q88, CP Recap, B/L, COA, and other documents added via drag & drop.

**DH-2**: Documents stored per deal for audit trail.

**DH-3**: V1: no automatic document parsing or email attachment. Operator drags documents onto drafts manually.

### 4.12 Audit Logging

**AL-1**: Every action logged: deal.created, deal.updated, workflow.draft_generated, workflow.step_sent, etc.

**AL-2**: Timestamp (UTC), user ID, action type, details JSONB.

**AL-3**: Visible on deal detail page.

### 4.13 UI: Linkage View (Deal Detail)

**UI-0**: **Linkage is a first-class route.** Every linkage has its own canonical page at `/linkages/[id]`. This page renders the voyage bar, notes, qty totals, and buy/sell columns even when the linkage is empty. The dashboard routes ALL linkage card clicks to `/linkages/[id]`, never to `/deals/new` or `/deals/[firstDealId]`. Think of a linkage as a folder on a computer — an empty folder exists and can be opened.

**UI-1**: Top section — Voyage info (linkage code, vessel, Q88, CP recap, operators, pricing, voyage/discharge orders).

**UI-2**: Left section — Buy side (purchase deals with workflow steps).

**UI-3**: Right section — Sell side with **"+" button always visible**. Two options: (1) **"Add sale"** — new sale deal block with counterparty, qty, destination, full workflow. (2) **"Discharge to own terminal"** — operator selects from company terminal list. Creates block with terminal nomination + agent nomination + inspector nomination only (no counterparty, no doc instructions).

**UI-4**: Each sell block is independent and collapsible. If operator later sells the remaining balance, own terminal block → CANCELLED (cancellation emails generated) and replaced with a new sale block.

**UI-5**: Part cargo example: Vitol sale (7kt, Barcelona) + own terminal (balance, Amsterdam). Each with independent steps.

---

## 5. Non-Functional Requirements

**NFR-1 — On-Premise Deployment**: Architecture must support self-hosted deployment. Commodity firms will not use third-party cloud for operational data.

**NFR-2 — AI Provider Abstraction**: AI parsing behind abstract interface. V1 = Claude API. Must support Azure OpenAI, AWS Bedrock, or local models per deployment.

**NFR-3 — Multi-Tenancy**: Every query scoped by tenant_id. RLS enforced.

**NFR-4 — Performance**: Dashboard <1s, AI parsing <3s, draft generation <500ms.

**NFR-5 — Data Integrity**: Deal updates use optimistic locking. Workflow operations transactional.

**NFR-6 — Security**: HTTPS, SSL database, JWT sessions, bcrypt passwords.

---

## 6. Delivery Status

### V1 Prototype ✅ SHIPPED (March 28, 2026)

Built in a single evening as proof of concept. Demonstrated:
- AI deal parsing from unstructured text
- Workflow engine with dependency gates
- Email draft generation with merge fields
- Task queue dashboard
- Multi-tenant architecture
- Demo tour (automated 2-minute walkthrough)

**What needs to change for production (per V2 spec)**:
- Email flow: remove Resend sending → copy-paste to Outlook
- Steps: soft dependencies instead of hard blocks
- Schema: add linkage_code, secondary_operator, split qty/pricing
- UI: linkage view (buy/sell split) instead of single deal view
- Excel sync: read/write to GASOLINE VESSELS LIST
- Contacts: region-based filtering
- New: drag & drop document/email ingestion, cancel flows, vessel swap cascade

### V2 Development — In Progress

| Phase | Scope | Status |
|-------|-------|--------|
| Schema evolution | linkage_code, secondary_operator, qty/pricing split | Planned |
| UX overhaul | Copy-paste flow, linkage view, parallel steps, "+" button | Planned |
| Excel sync | Read/write GASOLINE VESSELS LIST | Planned |
| Document handling | Drag & drop Q88, CP recap, B/L | Planned |
| Contact filtering | Region-based agent/inspector lookup | Planned |
| Cancel/swap flows | Cancellation emails, vessel swap cascade | Planned |
| Iterative templates | Build 2-3 priority workflows with operations team | Planned |

---

## 7. Technical Architecture

### Stack
- **Frontend/Backend**: Next.js 16, TypeScript strict, Tailwind CSS v4
- **Database**: PostgreSQL (Neon serverless for dev, on-premise for production), Drizzle ORM
- **Auth**: Auth.js v5 beta, JWT sessions, Credentials provider
- **AI**: Abstract interface → V1: Anthropic Claude API
- **Email**: V1 = copy-paste to Outlook. No direct sending.
- **Hosting**: Vercel for dev/demo. On-premise for production clients.

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | All Drizzle table definitions |
| `src/lib/db/index.ts` | DB client + `withTenantDb()` RLS |
| `src/lib/workflow-engine/index.ts` | Template scoring, instantiation, step advancement |
| `src/lib/ai/parse-deal.ts` | AI deal parser (abstract interface) |
| `src/app/api/workflows/steps/[stepId]/route.ts` | Step advancement, draft generation |

---

## 8. Full Workflow Example

**Scenario**: FOB Purchase of reformate from Socar (Turkey). Originally for own terminal in Amsterdam. Mid-voyage, cargo sold to Vitol (delivery Barcelona).

### Deal Ingestion
1. Trader sends recap → operator drags into program → AI parses → confirms → new deal
2. Operator enters linkage code `097284GSL` and reference `GP54124`

### Purchase Workflow (Loading in Aliaga)
1. Vessel clearance to seller (Q88 via drag & drop)
2. Vessel clearance to discharge terminal (parallel)
3. Nomination to seller (declare qty)
4. Inspector appointment (region-filtered for Aliaga)
5. Agent nomination (region-filtered)
6. Voyage orders (needs CP recap, parsed from freight trader email)

### Original Discharge: Amsterdam
- Terminal nomination, agent nomination, loading docs attached

### Plan Change: Sold to Vitol (Barcelona)
- Amsterdam discharge CANCELLED → cancellation email generated
- Amsterdam agent CANCELLED
- New sale workflow starts:
  - Clearance request to Vitol
  - Doc instructions request to Vitol
  - Terminal nomination using Vitol's doc instructions
  - Vitol (receiver) nominates Barcelona discharge terminal themselves
  - Discharge agent for Barcelona (our vessel = we appoint)
  - Voyage orders updated with new discharge port

---

## 9. Open Questions for V2

1. **Priority workflows**: Which 2-3 incoterm/direction combos to build first?
2. **Email templates**: Collect 3-5 real nomination/instruction emails for template building
3. **CP recap fields**: What data from CP recaps is needed for voyage orders?
4. **Terminal formats**: What are terminal-specific nomination requirements?
5. **Pricing alerts**: V2 feature — popup 1 day before pricing date?
6. **Outlook integration timeline**: When to add Teams/Outlook API for auto-send and auto-detect?

---

## 10. Future Roadmap

### V2.1 — Outlook/Teams Integration
- Auto-detect sent emails (no manual "Sent" button)
- Open drafts directly in Outlook
- Push notifications via Teams for new deal recaps
- Auto-ingest incoming emails

### V2.2 — Pricing Alerts & Deadline Engine
- Popup notification 1 day before BL/NOR pricing dates
- Calendar integration, 72h/48h/24h laycan reminders
- Escalation paths for overdue tasks

### V3.0 — Full Excel Replacement
- Program's own deal dashboard replaces Excel entirely
- Real-time updates, filtering, sorting
- No more concurrent access issues

### V3.1 — Demurrage & Laytime Module
- NOR tracking, laytime calculation, demurrage accrual, claim preparation

### V4.0 — Multi-Commodity Expansion
- Diesel, jet fuel, naphtha, fuel oil — each with spec requirements and workflow nuances

### V5.0 — Counterparty Portal
- External-facing portal where counterparties view nomination status, submit doc instructions
