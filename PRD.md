# Product Requirements Document (PRD)
## NominationEngine — Gasoline Operations Workflow Platform

**Version**: 1.0
**Date**: March 28, 2026
**Status**: Draft for V1 MVP
**Target Launch**: 4–6 weeks from development start
**Target User**: Physical gasoline trading operations teams (4–10 operators per firm)

---

## 1. Executive Summary

NominationEngine is a cloud-based SaaS platform that transforms how gasoline trading operations teams manage post-trade workflows. Today, operations teams receive unstructured deal recaps from traders, manually re-enter them into Excel, determine which nominations and instructions to send based on tribal knowledge of incoterm and region rules, and copy-paste from previous emails to draft communications — all while relying on memory for critical deadlines that carry $15,000–$40,000/day demurrage penalties if missed.

The platform replaces this with an intelligent workflow engine: deals are parsed from unstructured text using AI, deduplicated against the existing deal database, and automatically routed through the correct communication sequence based on incoterm, buy/sell direction, and region. Each step generates a draft email populated with deal data, surfaced to the operator in a task queue for review and one-click sending through Sedna. When deal fields change, the system identifies every party that received stale information and flags them for re-notification.

The initial client operates from ARA (Amsterdam/Rotterdam/Antwerp) and Klaipeda with three core terminals, trading globally on MR tankers across FOB, CIF/CFR, and DAP terms, handling 20–100 deals per month with a team of 4–10 generalist operators.

---

## 2. Problem Statement

### Problems We Are Solving

**Manual deal re-entry from unstructured sources.** Traders send deal recaps as free-text emails or chat messages. Operators manually extract counterparty, direction, product, quantity, dates, ports, and incoterms, then re-enter this into a shared Excel database. This process introduces transcription errors and takes 10–15 minutes per deal.

**Tribal knowledge workflow routing.** The rules governing which communications go to which parties, and in what order, live entirely in operators' heads. There are approximately 10–25 unique incoterm × direction × region combinations, each requiring a different set of nominations and instructions to different parties. New operators have no system to learn from; experienced operators occasionally forget steps under pressure.

**Copy-paste nomination drafting.** Operators find a previous email that looks similar, copy it, and manually replace vessel names, quantities, dates, and other fields. This is error-prone (stale data left in from the previous email) and time-consuming.

**No deadline tracking.** Nomination deadlines (vessel naming deadlines, terminal slot windows, laycan dates) are tracked ad hoc — operators rely on memory. With demurrage rates of $15,000–$40,000/day on MR tankers, a single missed deadline can cost more than a month of an operator's salary.

**No change propagation.** When a deal changes mid-process (vessel swap, quantity amendment, laycan shift, or cancellation), operators must manually recall which parties they already contacted and which emails need to be resent with updated information. There is no system to detect which communications are now stale.

**No audit trail.** There is no consolidated log of what was sent to whom, when, and by which operator for any given deal. This creates exposure during demurrage disputes, compliance reviews, and operational handoffs.

### Problems We Are NOT Solving (Out of Scope)

Blending operations, storage/inventory tracking, demurrage calculations, freight calculations, customs clearance (outsourced), vessel vetting/sanctions screening (separate platform exists), invoice/payment tracking, and trading/execution activities.

---

## 3. User Personas

### Primary: The Operator (4–10 per firm)

Generalist post-trade operations professional who handles every aspect of cargo logistics. Manages 5–25 active cargoes simultaneously. Works primarily in Sedna for email communication, shared Excel for deal tracking, WhatsApp for urgent issues. Their day is a constant context-switching between cargoes, counterparties, and communication channels. They are measured on zero demurrage incidents, nomination accuracy, and cargo throughput without errors.

**Core need**: "Tell me exactly what I need to do next, in what order, for every cargo I'm managing — and don't let me forget anything or send the wrong information."

### Secondary: The Trader (read-only)

Front-office professional who executes deals and needs visibility into operational status of their trades. Currently has to ask operators for status updates or check the shared Excel. Does not want to (and should not) edit operational data or send communications.

**Core need**: "Let me see where my cargoes are in the operations process without interrupting my ops team."

### Tertiary: The Admin / COO

Manages the operations function. Needs to configure workflow templates, manage email templates, onboard new operators, and have oversight of all active deals and team workload.

**Core need**: "Codify our operational procedures into the system so the team executes consistently, and give me visibility into bottlenecks."

---

## 4. Feature Requirements

### 4.1 Workflow Engine (Priority 1 — Build First)

**Description**: A configurable state machine that, given a deal's incoterm, buy/sell direction, and region, determines the exact sequence of communications that must be sent, to which parties, in what order, with dependency gates preventing out-of-sequence execution.

**Requirements**:

**WF-1**: The system must support creation of WorkflowTemplates, each defined by a combination of incoterm (FOB, CIF, CFR, DAP), direction (buy, sell), and region pattern (e.g., "ARA", "Klaipeda", "US", "Mediterranean", wildcard). A template consists of an ordered list of steps, each specifying: the party type to contact (terminal, agent, inspector, counterparty, chartering broker), the email template to use, and any prerequisite steps that must complete before this step becomes actionable.

**WF-2**: Dependency gates must be enforced. A step with `blocked_by` references cannot have its email draft generated or sent until all referenced prerequisite steps reach status `sent` or `acknowledged`. Example: "Send terminal nomination" is blocked by "Receive buyer vessel clearance + documentary instructions."

**WF-3**: When a deal is created, the system must automatically match it to the best-fitting WorkflowTemplate and instantiate a WorkflowInstance with all steps in their initial states (pending, blocked, or ready).

**WF-4**: Steps that require external input (e.g., "Wait for buyer to return documentary instructions") must have a status that operators can manually advance when the input is received. The system should prompt the operator to confirm receipt and optionally attach or note the received information.

**WF-5**: The system must support at least 10 and up to 25 concurrent WorkflowTemplates per tenant, covering the known incoterm × direction × region combinations.

**WF-6**: Region-specific rules must be configurable per template. Example: US-destination sales require SCAC code in documentary instructions; intra-EU movements use T2 customs status; exports outside EU require EAD references.

**WF-7**: When no matching template exists for a deal's characteristics, the system must alert the operator and allow manual workflow step creation.

### 4.2 AI Deal Parsing (Priority 2)

**Description**: Leverages Anthropic Claude API to extract structured deal data from unstructured trader emails and chat messages.

**Requirements**:

**AI-1**: The system must accept raw text input (pasted from email or chat) and return a structured deal object with fields: counterparty, direction (buy/sell), product, quantity (MT), incoterm, loadport, discharge port, laycan start date, laycan end date, vessel name (if mentioned), vessel IMO (if mentioned), pricing formula (if mentioned), and any special instructions.

**AI-2**: Each extracted field must include a confidence score (0–1). Fields with confidence below a configurable threshold (default: 0.85) must be highlighted in the review UI for operator attention.

**AI-3**: The system must NEVER auto-create a deal without operator confirmation. The parsed output is always presented as a pre-filled form that the operator reviews, corrects if needed, and explicitly confirms.

**AI-4**: The system must handle common variations in deal recap format including: different date formats (DD/MM/YYYY, Month DD, "first half March"), quantity expressed in MT, KT, or barrels, port names in various forms ("Rdam" = Rotterdam, "AMS" = Amsterdam, "Kly" = Klaipeda), and incoterm abbreviations.

**AI-5**: The raw source text must be stored alongside the parsed deal for audit purposes.

**AI-6**: Parsing should complete in under 5 seconds for a typical deal recap (under 500 words).

### 4.3 Task Queue Dashboard (Priority 3)

**Description**: The primary user interface — a per-operator view showing all pending actions across all active deals, prioritized by deadline urgency.

**Requirements**:

**TQ-1**: Each operator must see a personalized task list showing: tasks assigned to them, tasks unassigned (available for pickup), and tasks requiring re-notification due to deal changes.

**TQ-2**: Each task must display: deal reference, counterparty name, incoterm, task description (e.g., "Send terminal nomination to Amsterdam"), deadline (if applicable), current blocked/ready status, and which prerequisite is blocking it (if blocked).

**TQ-3**: Tasks must be sortable and filterable by: deadline urgency, deal, counterparty, task type (nomination/instruction/order/appointment), and status.

**TQ-4**: Tasks with deadlines approaching within 24 hours must be visually highlighted (warning state). Tasks past deadline must show a critical alert state.

**TQ-5**: Clicking a task must open the email draft preview for that step, allowing the operator to review, edit, and send.

**TQ-6**: Completed tasks must move to a "done" section but remain visible for the current day. Historical tasks accessible via the deal's audit log.

**TQ-7**: The dashboard must show a summary count: total active deals, tasks due today, overdue tasks, and blocked tasks.

**TQ-8**: The dashboard must auto-refresh at a configurable interval (default: 60 seconds) or support real-time updates.

### 4.4 Email Template Editor (Priority 4)

**Description**: An interface for admin/operators to create and manage email templates for each type of communication (nomination, documentary instruction, voyage order, inspector appointment, etc.), with merge fields that auto-populate from deal data.

**Requirements**:

**ET-1**: Templates must support merge field syntax (e.g., `{{vessel_name}}`, `{{quantity_mt}}`, `{{laycan_start}}`) that auto-populates from the deal record when generating a draft.

**ET-2**: Templates must be scopable to: specific terminals, specific incoterms, specific regions, and specific party types. The system selects the most specific matching template when generating a draft.

**ET-3**: The template editor must provide a list of all available merge fields with descriptions, allowing the template author to insert them via click or autocomplete.

**ET-4**: Templates must support conditional sections. Example: "Include SCAC code block only if discharge port is in USA." This can be implemented with simple `{{#if region_us}}...{{/if}}` syntax.

**ET-5**: Each template must include: subject line template, body template, default To/CC recipients (by party type, auto-resolved from the deal's assigned parties), and metadata (which merge fields are used, for change detection).

**ET-6**: Templates must support a preview mode where an operator can see the rendered output with sample deal data before saving.

**ET-7**: Template versioning: editing a template creates a new version. Previously generated drafts reference the version used.

### 4.5 Deal Management

**Requirements**:

**DM-1**: Operators can create deals in two ways: (a) paste unstructured text for AI parsing, or (b) manual form entry.

**DM-2**: Before saving a new deal, the system must run deduplication check against all existing deals for the tenant, matching on: counterparty + direction + product + laycan dates (within a ±3 day tolerance) + quantity (within a ±10% tolerance) + loadport OR discharge port. If a potential match is found, the operator is warned and can either link to the existing deal or confirm creation of a new one.

**DM-3**: Deals must support the following statuses: Draft, Active, Loading, Sailing, Discharging, Completed, Cancelled. Status transitions must be logged.

**DM-4**: Deal detail view must show: all deal fields, current workflow status (visual step-by-step with completed/active/blocked indicators), all generated email drafts with sent/pending status, assigned parties (terminal, agent, inspector, broker), change history, and full audit log.

**DM-5**: Excel import: the system must support importing the existing shared Excel database as initial deal seed data. A field mapping interface lets the admin map Excel columns to deal fields. Imported deals are created in "Active" status with no workflow instance (historical data only).

**DM-6**: Deal fields must be editable. Any field change on an active deal triggers the change detection and re-notification logic.

### 4.6 Change Detection & Re-Notification

**Requirements**:

**CD-1**: When a deal field is updated, the system must identify all previously sent emails (EmailDrafts with status `sent`) that included the changed field as a merge field.

**CD-2**: For each affected email, a new task must appear in the operator's task queue labeled as "Re-notification required" with: the party that received stale information, which field changed, old value vs. new value, and a pre-generated updated email draft.

**CD-3**: The operator can review and send the re-notification, or dismiss it if the change is immaterial to that party.

**CD-4**: All changes and re-notification decisions must be logged in the deal's audit trail.

**CD-5**: The following field changes must trigger re-notification checks: vessel_name, vessel_imo, quantity_mt, laycan_start, laycan_end, loadport, discharge_port, product, and any field present in an email template's merge field list.

### 4.7 Party Management

**Requirements**:

**PM-1**: The system must maintain a directory of parties per tenant: terminals, agents, inspectors, and chartering brokers.

**PM-2**: Each party record includes: name, type, port(s), email addresses, phone, and notes.

**PM-3**: Terminal contacts are fixed per port (auto-populated when a deal's loadport matches). Agent and inspector contacts are selectable per deal from the directory.

**PM-4**: When a workflow step requires an agent or inspector that hasn't been assigned to the deal yet, the task queue must prompt the operator to select one from the directory before the email draft can be generated.

**PM-5**: Party selection for inspectors must support the business rule that on FOB and CIF sales, inspector choice is agreed with the buyer (costs shared 50/50). The system should surface a note reminding the operator of this when the inspector appointment step becomes active.

### 4.8 Audit Logging

**Requirements**:

**AL-1**: Every action on a deal must be logged: creation, field changes, workflow step transitions, email draft generation, email sending, task assignment, party assignment, manual status overrides, and re-notification decisions.

**AL-2**: Each log entry records: timestamp (UTC), user who performed the action, action type, before/after values (for changes), and any associated email or workflow step.

**AL-3**: The audit log must be viewable per deal, filterable by action type and date range, and exportable (CSV).

### 4.9 Sedna Integration

**Requirements**:

**SI-1**: The platform must integrate with Sedna's Platform API to send emails from the team's shared Sedna inbox, preserving existing email threading and team visibility.

**SI-2**: Authentication via OAuth 2.0 with API keys, configured per tenant.

**SI-3**: When an operator clicks "Send" on an email draft, the system calls Sedna's API to create and send the message. The Sedna message ID is stored against the EmailDraft for reference.

**SI-4**: If Sedna API is unavailable (timeout, error), the system must: (a) retry once after 5 seconds, (b) if retry fails, surface the email as a formatted draft that the operator can copy-paste into Sedna manually, and (c) log the failure.

**SI-5**: Sent emails must appear in the deal's activity log with a link or reference to the Sedna message (if Sedna provides a permalink).

### 4.10 Trader Read-Only View

**Requirements**:

**TR-1**: Users with the Trader role can view: list of all active deals (filtered to deals where they are the originating trader, or all deals if unrestricted), deal status, current workflow stage, and assigned operator.

**TR-2**: Traders cannot: edit deal fields, view or send email drafts, assign parties, or modify workflow steps.

**TR-3**: Traders see a simplified deal card view, not the full task queue.

---

## 5. Non-Functional Requirements

**NFR-1 — Performance**: Task queue must load in under 2 seconds with 100 active deals. AI deal parsing must complete in under 5 seconds. Email draft generation (template rendering) must complete in under 1 second.

**NFR-2 — Availability**: 99.5% uptime target. Graceful degradation if Sedna API is unavailable (drafts still generated, manual send fallback).

**NFR-3 — Security**: All data encrypted at rest and in transit. Row-level security enforcing tenant isolation in PostgreSQL. API keys and Sedna credentials stored in encrypted secrets management. HTTPS everywhere.

**NFR-4 — Multi-tenancy**: Every data operation scoped by tenant_id. No cross-tenant data leakage. Automated test suite that verifies tenant isolation.

**NFR-5 — Mobile Responsiveness**: Web application must be usable on mobile browsers for viewing task queue, deal status, and approving/sending urgent email drafts. Full template editing and admin functions are desktop-only acceptable.

**NFR-6 — Data Integrity**: All deal creation and field updates wrapped in database transactions. Optimistic locking to prevent simultaneous conflicting edits.

**NFR-7 — Compliance**: Full audit trail per deal. Email content and sending records retained for minimum 7 years (configurable per tenant). GDPR-compliant data handling for EU-based operations.

---

## 6. V1 MVP Delivery Plan

### Phase 1 — Foundation (Weeks 1–2)
- Database schema and migrations (PostgreSQL with RLS)
- Authentication and RBAC (Operator, Trader, Admin roles)
- Multi-tenant data layer with tenant scoping middleware
- Deal CRUD with manual form entry
- Excel import for existing deal database
- Party management (terminals, agents, inspectors) CRUD

### Phase 2 — Workflow Engine (Weeks 2–3)
- WorkflowTemplate data model and admin editor
- Workflow instantiation (deal → template match → step creation)
- Dependency gate enforcement (blocked_by logic)
- Workflow step state machine (pending → blocked → ready → draft_generated → sent)
- Manual step advancement for external wait states
- Build first 5 workflow templates (FOB sale ARA, CIF sale ARA, FOB purchase Klaipeda, CIF sale Klaipeda, DAP sale generic)

### Phase 3 — Email Generation & Sedna (Weeks 3–4)
- Email template editor with merge fields
- Template rendering engine (merge fields → populated draft)
- Email draft review UI (preview, edit, send)
- Sedna API integration for sending
- Fallback: copy-paste draft if Sedna unavailable
- Create initial email templates for the 3 core terminals

### Phase 4 — AI Parsing & Task Queue (Weeks 4–5)
- Claude API integration for unstructured deal parsing
- AI confidence scoring and operator review UI
- Deal deduplication logic
- Task queue dashboard (per-operator view)
- Task prioritization by deadline urgency
- Change detection and re-notification engine
- Audit logging across all actions

### Phase 5 — Polish & Launch (Weeks 5–6)
- Trader read-only view
- Mobile-responsive CSS for task queue and deal views
- Remaining workflow templates (up to 10-25 total, guided by client input)
- End-to-end testing with real deal scenarios
- Deployment to cloud hosting
- Operator training documentation / onboarding flow

---

## 7. Success Metrics

**Operational Efficiency**: Time from deal receipt to first nomination sent reduced from ~30 minutes to under 10 minutes. Measured by comparing average time between deal creation and first email sent in the system.

**Error Reduction**: Zero incidents of nominations sent with stale data (wrong vessel name, incorrect quantity, old dates) within 90 days of launch. Measured via audit log review.

**Deadline Compliance**: 100% of nomination deadlines tracked in the system with zero missed windows. Measured by tracking tasks that reached "overdue" status.

**Adoption**: 90%+ of new deals processed through the platform (vs. falling back to old Excel + copy-paste process) within 30 days of launch.

**Re-notification Coverage**: 100% of deal changes trigger appropriate re-notification tasks. Measured by comparing DealChangeLog entries to re-notification tasks generated.

---

## 8. Open Questions for Client Validation

1. **Template content**: Client will draft the actual email templates for each terminal × incoterm combination. Platform provides the editor and merge fields; client provides the content. Timeline: templates needed by Week 3 at latest.

2. **Sedna API access**: Need to confirm client's Sedna plan includes API access and obtain API credentials for development and testing. Risk: if Sedna API is not available on their plan, the email integration falls back to copy-paste.

3. **Excel schema**: Need a sample of the existing shared Excel database to design the import mapping. Required by Week 1.

4. **Workflow template details**: The 10-25 workflow templates need to be defined in detail (exact steps, exact sequence, exact dependency gates). Client and development team to collaborate on defining these during Weeks 1-2. Start with the 5 most common, add the rest iteratively.

5. **Inspector cost-sharing logic**: Confirm exact rules for when inspector choice requires buyer agreement vs. when the operator chooses independently. This affects whether the inspector appointment step has a prerequisite "Agree inspector with counterparty" step.

6. **Deal linking**: Confirm how buy and sell legs should be linked in the system. Can one vessel load carry multiple sell legs? Can a buy leg be linked to multiple sell legs simultaneously?

7. **Notification preferences**: Should the platform send browser notifications or mobile push notifications for overdue tasks, or is the dashboard warning sufficient for V1?

---

## 9. Future Roadmap (Post-V1)

**V1.1 — Sedna Inbound Integration**: Auto-detect incoming deal recap emails via Sedna API and trigger AI parsing pipeline automatically, eliminating the need for operators to manually paste text.

**V1.2 — Advanced Deadline Engine**: Calendar integration, automated reminders at configurable intervals before deadlines (72h, 48h, 24h), and escalation paths for overdue tasks.

**V2.0 — Demurrage & Laytime Module**: NOR tracking, laytime calculation (SHINC/SHEX), demurrage accrual, and claim preparation.

**V2.1 — Document Management**: Track B/L originals, certificates of quality/quantity, customs documents, and LOI status per cargo. PDF generation for standard documents.

**V3.0 — Multi-Commodity Expansion**: Extend beyond gasoline to diesel, jet fuel, naphtha, and fuel oil — each with their own specification requirements and workflow nuances.

**V3.1 — Analytics & Reporting**: Operator performance metrics, average deal processing time, demurrage exposure trends, and cargo throughput dashboards.

**V4.0 — Counterparty Portal**: External-facing portal where counterparties can view nomination status, submit documentary instructions, and track cargo progress — reducing back-and-forth email volume.
