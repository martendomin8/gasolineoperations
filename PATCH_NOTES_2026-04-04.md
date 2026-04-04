# NominationEngine — Patch Notes
## April 4, 2026 · 10 commits · +2,666 / -733 lines · 28 files

### Infrastructure

**GitHub repo set up** — `github.com/martendomin8/gasolineoperations` (public, Arne added as collaborator: `arnetohver`)

**Vercel + Neon deployment** — Live at `gasolineoperations.vercel.app`. Auto-deploys on every push to main. Neon PostgreSQL (free tier, us-east-1).

**SSL fix for Neon** — Auto-detects `neon.tech` in DATABASE_URL and enables SSL even in local dev. Fixes auth failures when local `.env` points to Neon.

---

### Spec Alignment (CLAUDE.md + PRD.md rewrite)

Both files rewritten from scratch based on Arne's 15-page GasOps Session Notes (April 3, 2026):

- **Email flow**: Copy-paste to Outlook only. No Resend, no Sedna, no SMTP in V1.
- **Parallel steps**: Soft dependencies (`recommendedAfter`) replace hard blocks (`blockedBy`). System recommends sequence but never prevents the operator from acting.
- **Deal linking**: `linkageCode` groups deals into cargo chains. Cascade detection on field changes.
- **Dual operators**: Primary + secondary operator per deal.
- **Quantity split**: `contractedQty` (tolerance text) + `nominatedQty` (declared exact).
- **Pricing split**: `pricingType` (BL/NOR) + `pricingFormula` (0-0-5 notation) + `pricingEstimatedDate`.
- **On-premise deployment**: AI provider abstraction, each client uses their own approved AI tool.
- **Excel sync spec**: Program reads/writes GASOLINE VESSELS LIST, never overwrites operator-managed columns.
- **Linkage view UI**: Top (voyage) + left (buy) + right (sell with "+" button).
- **Three-option dedup popup**: AI suggestion / manual linkage pick / new deal.
- **Attachment parsing**: AI must parse PDF/Word attachments, not just email body.
- **Completed deals**: Operator manually marks complete, disappears from active views, stays in DB for audit.
- **Sell-side "+" button**: "Add sale" or "Discharge to own terminal" (with cancel flow when balance sold later).

---

### Schema Evolution

**8 new columns on `deals`**: `linkageCode`, `secondaryOperatorId`, `contractedQty`, `nominatedQty`, `pricingType`, `pricingEstimatedDate` + `dischargePort` made nullable.

**`parties.regionTags`**: Text array for port/region tagging (e.g. `["Klaipeda", "Baltic", "Lithuania"]`).

**`workflowSteps.recommendedAfter`**: New column for soft dependencies (keeps `blockedBy` for backward compat).

**4 new step statuses**: `received`, `done`, `na`, `cancelled` added to `workflow_step_status` enum.

**New `documents` table**: `id, tenantId, dealId, filename, fileType, storagePath, uploadedBy, createdAt`.

**New index**: `deals_tenant_linkage_idx` on `(tenantId, linkageCode)`.

---

### Workflow Engine — Soft Dependencies

- All steps now start as `ready` (not `blocked`). No hard gates.
- Removed the "unblock dependents" logic from `advanceStep()`.
- Added `TERMINAL_STATUSES` set: `sent`, `acknowledged`, `received`, `done`, `na`, `cancelled`.
- `recommendedAfterStep` in templates (backward-compatible with legacy `blockedByStep`).

---

### Email Flow — Copy-Paste Only

- Removed Resend SDK integration from `src/lib/email/index.ts`. `sendEmail()` is now a no-op returning `{ success: true, mode: "copy_paste" }`.
- `mark_sent` action no longer calls any external API — purely a confirmation: "I copied this to Outlook and sent it."
- Cleaned up stale Resend toast messages.

---

### New Step Actions

4 new workflow step actions added to `POST /api/workflows/steps/[stepId]`:

| Action | Target Status | Audit Log |
|--------|--------------|-----------|
| `mark_received` | `received` | `workflow.step_received` |
| `mark_done` | `done` | `workflow.step_done` |
| `mark_cancelled` | `cancelled` | `workflow.step_cancelled` |
| `mark_na` | `na` | `workflow.step_na` |

---

### Linkage View (Deal Detail Page)

The biggest visual change. When a deal has a `linkageCode`:

- **VoyageInfoBar** (full-width): Linkage code, vessel + IMO, product, operator initials, pricing type + formula.
- **Two-column grid**: Buy side (blue left border) | Sell side (amber left border).
- **LinkedDealCard**: Counterparty, direction badge, incoterm, qty, ports, laycan, status, embedded workflow steps.
- **"Add Sale" button**: Dashed-border card at bottom of sell column — navigates to `/deals/new?linkageCode=X&direction=sell`.
- Falls back to single-deal view when no linkage code.

---

### Three-Option Deduplication Popup

On both `/deals/new` and `/deals/parse`, before creating a deal:
1. **AI suggestion** — "Link to [matched counterparty + linkage code]?" — Confirm
2. **Manual selection** — Dropdown of all active linkage codes
3. **New deal** — Create standalone

---

### Cancel Cascade + Vessel Swap

**Cancel cascade**: When a step is cancelled on a linked deal, the system finds all other deals with the same `linkageCode` and flags matching `sent` steps (same party type) as `needs_update`.

**Vessel swap** (`mark_vessel_swap` action): Updates vessel on the deal + all linked deals, triggers change detection cascade across all affected email drafts that used `vessel_name` or `vessel_imo`.

---

### Region-Based Party Filtering

- Party dropdown in workflow steps now shows **region-matched parties first** (based on deal's loadport/discharge port vs party's `regionTags`).
- "Show all" toggle reveals remaining parties.
- API: `GET /api/parties?port=Klaipeda` returns `{ matched: [...], rest: [...] }`.
- Flat array returned when no port filter (backward-compatible for party list page).

---

### Active View Filtering

- Completed/cancelled deals hidden from **dashboard task queue** and **notifications**.
- Deals list (`/deals`) shows **all statuses** by default — completed visible under "All statuses" filter.

---

### Step Card UI Polish

- **Two-row layout**: Row 1 = icon + name + status badge (right-aligned). Row 2 = party info + action button + expand chevron.
- **Contextual actions only**: `ready` — Draft. `draft_generated` — Sent. `sent + external wait` — Received. `needs_update` — Draft/Re-sent.
- **N/A and Cancel** moved to expand panel (hidden behind chevron). No more button overflow.
- Toast messages cleaned up for new statuses.

---

### Demo Tour

- Automated 8-step tour: Dashboard — Shell deal — Generate draft — View draft — Parse email — Create deal — New deal — Dashboard.
- Floating HUD with step progress, descriptions, and auto-advance.
- "Demo" button in header + floating "Demo Tour" button.
- 8-second pause on parsed fields so viewer sees confidence scores.
- Tour-aware E2E: fires `tour:deal-created` event for orchestration.

---

### Parser Fixes

- **Counterparty**: "Sold X MT Y CIF to Z" (non-adjacent sold/to), "Deal confirmed with X".
- **Loadport**: "Load Antwerp," without colon.
- **Discharge port**: "discharge Singapore" without colon.
- **Port-after-incoterm**: Block false matches like "FOB basis" (NON_PORTS exclusion list).
- **Known-port scan**: Last-resort fallback for "Klaipeda terminal" style text.
- **Vessel**: Filter out TBN/TBA/TBD as vessel names.
- **Pre-flight validation**: Clear error messages listing missing fields before API call.

---

### Seed Data

- Shell CIF deal (EG-2026-041): `linkageCode: "086412GSS"`, `pricingType: "BL"`, `contractedQty: "30,000 MT +/- 5%"`, `secondaryOperatorId` set.
- Vitol FOB deal (EG-2026-042): Same linkage code, `pricingType: "NOR"`, vessel swap `needs_update` state.
- All 11 parties have `regionTags` populated.
- 20 deals, 5 workflow templates, 7 email templates, 13 workflow instances.

---

### What's Next

- Drag & drop email/document ingestion (.eml, .msg, .docx, PDF)
- Excel sync (read/write GASOLINE VESSELS LIST)
- Attachment parsing by AI
- "Discharge to own terminal" flow on the "+" button
- Real email templates from operations team
- CP Recap parsing
