# Product Requirements Document (PRD)
## NominationEngine — Gasoline Operations Workflow Platform

**Version**: 1.1
**Date**: March 29, 2026
**Status**: V1 Shipped — Deployment Ready
**Launch**: March 29, 2026
**Target User**: Physical gasoline trading operations teams (4–10 operators per firm)

---

## 1. Executive Summary

NominationEngine is a cloud-based SaaS platform that transforms how gasoline trading operations teams manage post-trade workflows. Today, operations teams receive unstructured deal recaps from traders, manually re-enter them into Excel, determine which nominations and instructions to send based on tribal knowledge of incoterm and region rules, and copy-paste from previous emails to draft communications — all while relying on memory for critical deadlines that carry $15,000–$40,000/day demurrage penalties if missed.

The platform replaces this with an intelligent workflow engine: deals are parsed from unstructured text using AI, deduplicated against the existing deal database, and automatically routed through the correct communication sequence based on incoterm, buy/sell direction, and region. Each step generates a draft email populated with deal data, surfaced to the operator in a task queue for review and one-click sending. When deal fields change, the system identifies every party that received stale information and flags them for re-notification.

**V1 is fully built and deployed.** The initial client operates from ARA (Amsterdam/Rotterdam/Antwerp) and Klaipeda with three core terminals, trading globally on MR tankers across FOB, CIF/CFR, and DAP terms.

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

### 4.1 Workflow Engine ✅ SHIPPED

**Description**: A configurable state machine that, given a deal's incoterm, buy/sell direction, and region, determines the exact sequence of communications that must be sent, to which parties, in what order, with dependency gates preventing out-of-sequence execution.

**Requirements**:

**WF-1** ✅: WorkflowTemplates with incoterm, direction, and region pattern matching. Steps defined per template with party type, email template, and prerequisite gates.

**WF-2** ✅: Dependency gates enforced. Steps with `blockedBy` references remain `blocked` until prerequisites reach `sent` or `acknowledged`. Unblocking is automatic when a prerequisite advances.

**WF-3** ✅: On deal creation, the system auto-matches the best-fitting WorkflowTemplate using a scoring algorithm (incoterm match +3, direction match +2, region pattern match +2) and instantiates a WorkflowInstance with all steps at their correct initial status.

**WF-4** ✅: External wait steps (`isExternalWait: true`) unblock dependents on `acknowledged` rather than `sent`. Operators manually advance these when external input arrives.

**WF-5** ✅: Unlimited WorkflowTemplates per tenant. V1 ships with the CIF Sale ARA template (5 steps); additional templates added by tenant admin.

**WF-6** ⏳ V1.1: Region-specific conditional logic in templates (SCAC codes, customs status). Currently handled via email template content.

**WF-7** ⏳ V1.1: Auto-alert when no matching template exists. Currently shows blank workflow panel on deal detail.

**Auto-complete** ✅: When all steps in a workflow instance reach terminal status (`sent` or `acknowledged`), the instance is automatically marked `completed` and a success banner appears on the deal detail page.

### 4.2 AI Deal Parsing ✅ SHIPPED

**AI-1** ✅: Accepts raw text and returns structured deal object with all required fields via Anthropic Claude API (claude-haiku-4-5 model for speed, configurable).

**AI-2** ✅: Confidence scores per field. Fields below threshold highlighted in the review form.

**AI-3** ✅: Operator must confirm before deal is created. Parsed output populates a pre-filled form at `/deals/parse`.

**AI-4** ✅: Handles common abbreviations and date format variations. Falls back to regex parsing mode if `ANTHROPIC_API_KEY` is absent.

**AI-5** ✅: Raw source text stored as `sourceRawText` on the Deal record.

**AI-6** ✅: Typical parse time under 3 seconds.

### 4.3 Task Queue Dashboard ✅ SHIPPED

**TQ-1** ✅: Operator sees all actionable tasks (ready/draft_generated), waiting tasks (sent + isExternalWait), and re-notification tasks (needs_update).

**TQ-2** ✅: Each task shows deal ref, counterparty, task description, step type icon, and recipient party type.

**TQ-3** ✅: Dashboard filtered to current operator's tenant. Sort by urgency implicit via status grouping.

**TQ-4** ✅: Laycan urgency panel shows deals within 5 days of laycan start, with color-coded urgency chips (TODAY, Tomorrow, 2d, 3d). Critical deals (≤1 day) shown with red fire icon and danger colors.

**TQ-5** ✅: Task row links directly to deal detail page (`/deals/[id]`).

**TQ-6** ✅: Completed tasks not shown in task queue; visible in deal audit log.

**TQ-7** ✅: Summary stat cards: Active Cargoes, Pending Tasks, Awaiting Reply, Laycan Critical.

**TQ-8** ✅: Notification bell in header polls `/api/notifications` every 30 seconds. Badge shows pending count (amber) and re-notification count (red).

### 4.4 Email Template Editor ✅ SHIPPED

**ET-1** ✅: `{{field_name}}` merge syntax. All fields from the Deal record supported: counterparty, direction, product, quantity_mt, incoterm, loadport, discharge_port, laycan_start, laycan_end, vessel_name, vessel_imo, external_ref, pricing_formula.

**ET-2** ✅: Templates scoped by `partyType` and `incoterm`. Auto-match logic: prefers matching incoterm; falls back to any template matching the party type; final fallback generates a fully-populated plain-text draft from deal fields.

**ET-3** ✅: Template editor at `/settings/templates` with merge field reference panel.

**ET-4** ⏳ V1.1: Conditional sections (`{{#if ...}}`). Not yet implemented.

**ET-5** ✅: Subject template + body template + partyType + incoterm scope. CC addresses on EmailDraft.

**ET-6** ✅: Preview on deal detail page shows rendered draft with actual deal data.

**ET-7** ⏳ V1.1: Template versioning. Current implementation overwrites in place.

### 4.5 Deal Management ✅ SHIPPED

**DM-1** ✅: Two creation paths: AI parse (`/deals/parse`) and manual form (`/deals/new`).

**DM-2** ✅: Deduplication check at `POST /api/deals/check-duplicates` — matches on counterparty + direction + product + laycan ±3 days + quantity ±10% + port. Warning shown before creation.

**DM-3** ✅: Status state machine: `draft → active → loading → sailing → discharging → completed → cancelled`. One-click status stepper on deal detail page. Transitions validated server-side.

**DM-4** ✅: Deal detail at `/deals/[id]` shows: all fields, status stepper, workflow panel with step-by-step progress, email draft per step (with copy-to-clipboard), assigned party selector, change history, and audit log.

**DM-5** ✅: Excel import wizard at `/import` — upload → column mapping → preview with row validation → confirm insert. Handles DD/MM/YYYY dates by default.

**DM-6** ✅: Deal fields editable at `/deals/[id]/edit`. Changes logged to `dealChangeLogs`. Re-notification flagging sets affected steps to `needs_update`.

### 4.6 Change Detection & Re-Notification ✅ SHIPPED

**CD-1** ✅: On deal update, queries all EmailDrafts for this deal where `mergeFieldsUsed` contains the changed field.

**CD-2** ✅: Affected steps set to `needs_update`. Re-notification items appear in task queue under "Re-notification Required" section.

**CD-3** ⏳ V1.1: Dismiss re-notification without sending. Currently must mark as sent to clear.

**CD-4** ✅: All changes logged in `dealChangeLogs` and `auditLogs`.

**CD-5** ✅: All merge fields tracked. The `mergeFieldsUsed` JSONB on EmailDraft records exactly which fields were substituted.

### 4.7 Party Management ✅ SHIPPED

**PM-1** ✅: Party directory per tenant: terminal, agent, inspector, broker types.

**PM-2** ✅: Name, type, port, email, phone, notes, isFixed flag per party.

**PM-3** ✅: Fixed terminals auto-suggested by port. Agent/inspector selectable per workflow step.

**PM-4** ✅: Assign party dropdown on workflow steps. Draft generation uses assigned party's email; if unassigned, draft shows placeholder `[party type — assign party]`.

**PM-5** ⏳ V1.1: Inspector cost-sharing reminder note. Not yet surfaced in UI.

### 4.8 Audit Logging ✅ SHIPPED

**AL-1** ✅: Every action logged: deal.created, deal.updated, workflow.draft_generated, workflow.step_sent, workflow.step_acknowledged, workflow.completed.

**AL-2** ✅: Timestamp (UTC), user ID, action type, details JSONB (step IDs, draft IDs, field changes).

**AL-3** ✅: Audit log visible on deal detail page. CSV export ⏳ V1.1.

### 4.9 Email Delivery ✅ SHIPPED (Resend, not Sedna)

V1 uses **Resend** for email delivery rather than Sedna (Sedna integration moved to V1.1 pending API access confirmation).

**SI-1** ✅: Emails sent from operator's tenant via Resend API. `RESEND_API_KEY` in environment.

**SI-2** ✅: API key per environment. Tenant-specific Sedna keys ⏳ V1.1.

**SI-3** ✅: Operator clicks "Mark Sent" on a workflow step → system calls Resend, stores `sednaMessageId` (Resend message ID) on the EmailDraft, marks draft `sent`.

**SI-4** ✅: If `RESEND_API_KEY` absent, system operates in demo mode: email content logged to console, operator sees "Email logged (demo mode)" toast. No data loss.

**SI-5** ✅: Sent timestamp stored as `sentViaSednaAt` on EmailDraft. Visible in step status and audit log.

### 4.10 Trader Read-Only View ✅ SHIPPED

**TR-1** ✅: Trader role can view all deals, deal status, and workflow progress.

**TR-2** ✅: Trader role cannot access generate/send actions (API enforces `operator|admin` role on write endpoints).

**TR-3** ✅: All users see the same deal list; full edit UI gated behind role check.

### 4.11 Demo Provisioning ✅ SHIPPED (new in V1)

**DP-1** ✅: `/demo` landing page — one-click demo environment provisioning.

**DP-2** ✅: `POST /api/demo` creates an isolated tenant with: 3 users (admin, operator, trader), 8 parties (3 terminals, 2 agents, 2 inspectors, 1 broker), 2 email templates, 1 workflow template (CIF Sale ARA), 5 deals at various stages, 1 active workflow instance with 5 steps.

**DP-3** ✅: Demo signs the prospect in automatically via `signIn("credentials")` after provisioning. Redirects to `/dashboard`.

**DP-4** ✅: Gated by `DEMO_ENABLED=true` in production. Safe for public URL.

---

## 5. Non-Functional Requirements

**NFR-1 — Performance** ✅: Dashboard loads in <1s with demo data (16 tasks, 5 deals). AI parsing <3s. Draft generation <500ms.

**NFR-2 — Availability** ✅: Vercel serverless with Neon PostgreSQL. Resend fallback (demo mode) if API key absent.

**NFR-3 — Security** ✅: HTTPS via Vercel. Neon SSL required in production. JWT sessions (24h). Passwords bcrypt-hashed. Row-level security via `SET LOCAL app.current_tenant_id`.

**NFR-4 — Multi-tenancy** ✅: Every query scoped by `tenantId`. `withTenantDb()` helper enforces RLS on all writes. Demo tenants isolated by design (unique suffix per provision).

**NFR-5 — Mobile Responsiveness** ✅: Tailwind responsive layout. Dashboard, deal list, and deal detail usable on mobile.

**NFR-6 — Data Integrity** ✅: Deal updates use optimistic locking (`version` field, 409 on conflict). Workflow instance creation transactional.

**NFR-7 — Compliance** ⏳ V1.1: Audit log retention policy, GDPR data export, and deletion flows not yet implemented.

---

## 6. Delivery Status

### Phase 1 — Foundation ✅ COMPLETE
Database schema (Drizzle ORM, PostgreSQL enums, full relational model), Auth.js v5 JWT sessions, RBAC middleware, multi-tenant RLS, Deal CRUD, Excel import wizard, Party management CRUD.

### Phase 2 — Workflow Engine ✅ COMPLETE
WorkflowTemplate data model, template scoring and auto-match, workflow instantiation, dependency gate enforcement, step state machine, automatic unblocking, workflow auto-complete.

### Phase 3 — Email Generation ✅ COMPLETE
Email template editor with merge fields, `renderTemplate` engine, EmailDraft generation with auto-match fallback, Resend API integration, demo-mode fallback, copy-to-clipboard on drafts.

### Phase 4 — AI Parsing & Task Queue ✅ COMPLETE
Claude API integration for deal parsing, confidence scoring UI, deal deduplication, task queue dashboard with urgency prioritization, change detection and `needs_update` flagging, full audit logging.

### Phase 5 — Deal Detail Polish ✅ COMPLETE
Status stepper (one-click progression), workflow step panel with full draft review UI, assign party inline, toast notifications (sonner), workflow auto-complete banner.

### Phase 6 — Deployment & Demo ✅ COMPLETE
Resend email integration, notification bell with polling, Vercel deployment config (`vercel.json`, fra1 region), serverless DB pool tuning, `/demo` onboarding page, demo tenant provisioning API, production build verified (33 routes, clean TypeScript).

---

## 7. Technical Architecture

### Stack
- **Frontend/Backend**: Next.js 16, TypeScript strict mode, Tailwind CSS v4
- **Database**: PostgreSQL (Neon serverless), Drizzle ORM, RLS via `SET LOCAL`
- **Auth**: Auth.js v5 beta, JWT sessions, Credentials provider
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`)
- **Email**: Resend SDK (`resend`), demo fallback when key absent
- **Hosting**: Vercel (fra1 / eu-central-1)

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | All Drizzle table definitions — single source of truth |
| `src/lib/db/index.ts` | DB client + `withTenantDb()` RLS context + serverless pool config |
| `src/lib/middleware/with-auth.ts` | API auth HOF — single chokepoint for all routes |
| `src/lib/workflow-engine/index.ts` | Template scoring, instantiation, step advancement, draft generation |
| `src/lib/email/index.ts` | Resend wrapper with demo fallback |
| `src/lib/ai/parse-deal.ts` | Claude API deal parser with confidence scores |
| `src/app/api/workflows/steps/[stepId]/route.ts` | Step advancement, email firing, auto-complete |
| `src/app/api/demo/route.ts` | Demo tenant provisioning |
| `src/app/demo/page.tsx` | Demo landing page |

### Data Model Summary
13 tables: `tenants`, `users`, `parties`, `deals`, `dealLegs`, `dealChangeLogs`, `auditLogs`, `workflowTemplates`, `workflowInstances`, `workflowSteps`, `emailTemplates`, `emailDrafts`, `tasks` (view).

---

## 8. Deployment

See `DEPLOY.md` for step-by-step instructions. Summary:

1. Push to GitHub
2. Create Neon project (eu-central-1), run `DATABASE_URL=... npm run db:push`
3. Deploy to Vercel with 8 environment variables
4. Verify at `/demo`

---

## 9. Open Questions — Still Relevant for V1.1

1. **Sedna API access**: Confirm client's Sedna plan includes API access. When confirmed, replace Resend with Sedna for email delivery to preserve existing email threading.

2. **Workflow templates**: Client to provide content for remaining incoterm × direction × region combinations beyond the seeded CIF Sale ARA template.

3. **Email template content**: Client to draft actual template bodies for each terminal × incoterm combination using the template editor.

4. **Inspector cost-sharing**: Confirm rule for when buyer agreement is required before inspector appointment step can advance.

5. **GDPR / data retention**: Confirm 7-year retention requirement and whether we need a data export / right-to-erasure flow for V1.1.

---

## 10. Future Roadmap

### V1.1 — Sedna Integration & Polish (Next sprint)
- Sedna Platform API for email sending (replace Resend, preserve threading)
- Sedna inbound: auto-detect incoming deal recap emails → trigger AI parsing
- Template versioning
- Conditional template sections (`{{#if region_us}}`)
- Inspector cost-sharing reminder
- Re-notification dismiss without sending
- Audit log CSV export
- Workflow fallback when no template matches

### V1.2 — Deadline Engine
Calendar integration, automated reminders at 72h/48h/24h before laycan, escalation paths for overdue tasks.

### V2.0 — Demurrage & Laytime Module
NOR tracking, laytime calculation (SHINC/SHEX), demurrage accrual, claim preparation.

### V2.1 — Document Management
B/L originals tracking, certificates of quality/quantity, customs documents (T1/T2/EAD/EUR1), LOI status per cargo. PDF generation.

### V3.0 — Multi-Commodity Expansion
Diesel, jet fuel, naphtha, fuel oil — each with specification requirements and workflow nuances.

### V3.1 — Analytics & Reporting
Operator performance metrics, average deal processing time, demurrage exposure trends, cargo throughput dashboards.

### V4.0 — Counterparty Portal
External-facing portal where counterparties can view nomination status, submit documentary instructions, and track cargo progress.
