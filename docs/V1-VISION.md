# V1 Vision — Light-End Product Desk Operations Platform

> **Status**: Draft. Captures Arne's V1 product vision for team review.
> Comment freely. This is a working document, not a frozen spec.
>
> **Companion docs**: `CLAUDE.md` (architecture + domain context, frozen).

---

## 1. Product positioning

A post-trade operations platform for **commodity desks trading light-end refined products**. Structurally similar workflows mean the same product serves multiple desks:

- Gasoline (primary, V1 reference desk)
- Naphtha
- Gasoil
- Biodiesel
- Other clean products with similar nomination / instruction / appointment flows

The platform sits between the trader's deal recap and the operator's Outlook. It does **not** trade, blend, manage inventory, or send emails directly. It drafts, tracks, and reminds — saving the operator hours of repetitive composition while reducing the risk of missed nominations and demurrage exposure.

**Differentiation vs. existing tools:**
- Sedna / Seasalt: generic email management, not desk workflow-aware
- Veson IMOS: charter management, too heavy + expensive for a small ops team
- Today's reality at most desks: Excel + Outlook + WhatsApp + tribal knowledge

NominationEngine fills the gap — narrow, domain-deep, AI-assisted.

---

## 2. V1 scope

### 2.1 Workflow correctness *(foundation — blocks everything else)*

The current workflow templates are placeholders. V1 needs **real, validated workflows** for each major scenario. Per `(incoterm × direction × region)`:

- Exact list of steps
- Recipients (who gets each email — counterparty, terminal, agent, inspector, broker)
- Recommended sequence (soft dependencies; never hard-block the operator)
- Cancellation flow per step
- Vessel swap cascade — which previously sent emails need re-issuing

**Reference scenarios for V1:**
- FOB Sale
- CIF / CFR Sale
- DAP Sale
- FOB Purchase

**Approach**: Templates are data (JSONB), not code. Define one scenario fully, validate with a real cargo end-to-end, then replicate the structure for the next.

---

### 2.2 Real recap library + parser audit

Today's parser is calibrated against demo data. Real trader recaps are messier — abbreviations, contextual references, "promptly" laycans, varied tolerance notation.

- Collect anonymised real recaps from multiple counterparties
- Audit AI parser fields: which are needed, which can be dropped
- Confidence scoring per field
- Edge cases catalogue (laycan keywords, qty tolerance variants, vessel TBN, etc.)

This work locks the parser contract before templates depend on it.

---

### 2.3 Email templates *(architecturally hardest piece)*

**The model**: standard templates defined by firm legal / management, customised per desk for desk-specific quirks. Every firm and every desk works slightly differently.

**Three implementation options** (decision needed):

| Option | How it works | Pros | Cons |
|--------|--------------|------|------|
| **A. Inheritance** | `BaseTemplate` (locked) + `DeskOverride` (patch). Render merges. | Simple model | Hard to debug ("why did this sentence appear?") |
| **B. Locked sections** | Single template; legal marks `{{LOCKED}}...{{/LOCKED}}` blocks the desk cannot touch | Visually clear in editor | Less flexible |
| **C. Fork + push** | Desk forks template; firm pushes updates that desk approves | Maximum flexibility | Most UX work, conflict resolution |

**Current lean**: Option B for V1 simplicity. Revisit before building.

**Output target**: drafts must be **ready-to-send** — operator copy-pastes to Outlook without editing in 80%+ of cases. Anything below that and we are slower than Word templates.

---

### 2.4 Vessel section completion

Today's vessel section is a placeholder. V1 needs the full vessel intelligence layer:

**Q88 upload + parse**
- Standardised vessel questionnaire — parser is more deterministic than recap parsing
- Extracts vessel particulars (name, IMO, DWT, capacity, build year, flag, P&I, etc.)
- Stored as structured data on the linkage

**Density-based intake estimation**
- Operator inputs cargo density
- System calculates estimated intake (vessel SDWT × density math, accounting for trim/draft)
- Pure math, no AI

**CP Recap upload + parse**
- Third document parser (recap, Q88, CP) — consider unifying behind `parseDocument(type, file)` interface
- Extracts: broker contacts, freight terms, voyage orders inputs, demurrage rate, laytime

**AI Q&A over CP recap (RAG)**
- Operator asks: *"Who is the agent at the loadport?"*
- System answers + cites: *"CP recap, page 2, clause 7"*
- Open-ended questions about contract terms, deadlines, special instructions
- New subsystem: document embedding storage (pgvector?) + retrieval + cited answer

**Live vessel tracking**
- Open vessel view → see live position on map
- Past track, ETA, port calls
- Zoom in / out
- **Integration options to evaluate** (commercial decision):
  - Free: embed MarineTraffic public iframe by IMO (limited)
  - Paid: MarineTraffic API ($200–$2000/month depending on volume)
  - Alternatives: VesselFinder, FleetMon, MyShipTracking

---

### 2.5 Critical-event notifications

Surface-level triggers that demand operator attention:

- **NOR / BL date approaching** — pricing settlement window opening
- **Laycan window approaching** — vessel arrival risk
- **Load tolerance mismatch** — purchased qty vs. sum of linked sales falls outside contractual tolerance
- **Vessel ETA slip** — pulled from tracking integration
- **Document overdue** — Q88 not received N days before nomination deadline
- **Re-notification required** — deal field changed, previously sent emails affected

Delivery in V1: in-app dashboard + visual flags. Email/Slack delivery is V1.5+.

---

### 2.6 Outturn calculations

When the outturn report arrives at end of voyage:
- Operator uploads / inputs outturn figures per discharge
- System reconciles against B/L figures
- Calculates losses, gains, and per-counterparty allocation
- Flags discrepancies above threshold for trader review
- Persists as the final settled quantity for downstream invoicing

---

### 2.7 Inline help system

Lightweight contextual help — small `?` icons next to non-obvious terms and fields.

- Hover or click → short explanation aimed at a junior operator
- Optional external links for deeper reading (industry references, our internal wiki)
- Sourced content TBD: universal vs. per-tenant customisable

Helps onboard new ops staff and reduces training burden.

---

### 2.8 AI provider flexibility *(architectural requirement)*

Different firms allow different AI tools. Examples:
- Some firms: Anthropic Claude (current default)
- Gunvor: Microsoft Copilot only
- Others: Azure OpenAI, AWS Bedrock, local Llama deployments

**Required design:**
- `IAIProvider` interface with methods: `parseDocument`, `embedText`, `chatCompletion`, `qaWithCitations`
- Implementations: `AnthropicProvider`, `OpenAIProvider`, `AzureOpenAIProvider`, `CopilotProvider`, `LocalProvider`
- Per-tenant configuration: `tenant.settings.aiProvider = "copilot"` + endpoint + auth
- Fallback behaviour when a provider doesn't support a capability (e.g. Copilot + RAG)

**Note**: Microsoft Copilot is OAuth-bound through Graph and not a standard REST API. A Copilot deployment may need to fall back to simpler parsing without RAG, or pair with a local embedding model.

---

## 3. Open architectural questions

To resolve before building further:

1. **Workflow rollout sequencing** — fully complete one scenario (e.g. CIF Sale) end-to-end, or paint all four at low fidelity and deepen iteratively?
2. **Template model** — A, B, or C from §2.3?
3. **AI provider abstraction** — design the interface now (before duplicating parsing in three places: recap / Q88 / CP)
4. **Vessel tracking commercial choice** — which provider? Budget?
5. **Help content ownership** — universal text or per-tenant override?
6. **Notification delivery** — in-app only for V1, or also include browser push?

---

## 4. Out of scope for V1

Holding the line here matters — every feature added pulls us toward becoming a CTRM-lite product (Veson territory) and dilutes the "narrow + sharp" positioning.

- Direct email sending (Outlook / SMTP / Sedna integration)
- Demurrage tracking and laytime calculations beyond the basic notification
- Customs clearance workflows (T1 / T2 beyond a status field)
- Vessel vetting / sanctions screening
- Payment / invoice generation
- Mobile native app
- Trader-side deal capture (we are post-trade only)
- Blending, storage, inventory management

---

## 5. Success criteria for V1

V1 is "done" when:

1. One real desk (likely the gasoline pilot) runs **one full cargo end-to-end** through the system without falling back to Excel
2. The operator confirms drafts are **ready-to-send** in 80%+ of cases
3. AI parsing handles real recaps from at least 5 different counterparties with ≥90% field accuracy
4. The system surfaces all critical-event notifications without false-positive fatigue
5. Vessel tracking is live and integrated into the linkage view
6. A new junior operator can onboard with the inline help and run a simple deal within their first day
7. The AI provider is swappable per deployment (Anthropic + at least one alternative tested)

---

## 6. Beyond V1 — known parking lot

Items mentioned in passing but explicitly deferred:

- Outlook / Teams / Sedna direct send integration
- Slack / email notification delivery
- Demurrage cost forecasting
- Counterparty performance analytics
- Multi-leg cargo tracking visualisation
- Trader self-serve deal entry

---

*Last updated: 2026-04-14*
