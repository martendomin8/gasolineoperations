# GasOps — Operator Feedback

**Comprehensive Comments on the Current Version**

Author: Arne Tohver (Operator) | Date: 5 April 2026 | Version: 2

---

## 1. Pricing Column — Must Show Pricing Period, Not Price Formula

### Problem

The current Excel/Spreadsheet view displays the pricing formula in the Pricing column, for example *"Platts FOB Baltic MTBE +$5.50/MT"*. This information is relevant for the invoice desk, but **it is not relevant to the operator's daily workflow**. The operator does not need the price level or benchmark — that is a trader/finance concern. The operator needs to know **_when_** the price will be fixed, because that determines what the operator needs to monitor.

### What the Operator Needs: Pricing Period

The **pricing period** determines **WHEN** the price is fixed — not what the price is. This is the only pricing information relevant to the operator's daily workflow. The pricing period type directly affects what the operator must monitor (BL = Bill of Lading date, NOR = Notice of Readiness date, or a fixed calendar period).

#### Pricing Period Types

**CRITICAL INSTRUCTION FOR CLAUDE (Marten's AI assistant):** Before implementing this feature, you MUST research physical oil/gasoline trading pricing periods in depth. Understand the differences between BL, NOR, Fixed, and EFP pricing. Recommended sources: Wall Street Oasis "Physical Oil Trading Basics", Platts/Argus methodology documents, ICE EFP explainers, ISDA commodity definitions. This must be 100% accurate — the operator knows these concepts inside out and any errors will be immediately obvious and will cause mistrust in the platform.

| Type | Description | Format / Example in Table |
|------|-------------|---------------------------|
| **BL Pricing** | Bill of Lading pricing. The price is the average of the benchmark over a window of days counted around the **BL date** (the date on the Bill of Lading). The format is: **`[days before BL]-[BL day: 1=counts, 0=excluded]-[days after BL]`**. The operator must monitor that the estimated BL date in the trader's external ETRM system (a separate company system for storage, invoicing, and trade management — not GasOps) is correct, because that date determines the pricing window. | **"BL 0-1-5"** = 0 days before, BL day counts, 5 days after (6 pricing days total). **"BL 5-1-5"** = 5 days before, BL day counts, 5 days after (11 pricing days total). **"BL 0-0-5"** = BL day excluded, only 5 days after BL count. **Shorthand:** In trade recaps, "BL+5" is shorthand for "BL 0-0-5" (5 days after BL, BL day not counted). This is the most common format. If the BL day itself is included in the pricing window, the trader will state this explicitly in the recap — but this is rare. |
| **NOR Pricing** | Notice of Readiness pricing. Identical logic to BL pricing, but the window of days is counted around the **NOR date** (when the vessel tendered Notice of Readiness at the port). Same format as BL. The operator must monitor the NOR date instead of the BL date. | **"NOR 0-1-5"** = same format as BL but centered on the NOR date. **"NOR 3-1-3"** = 3 days before NOR, NOR day counts, 3 days after. |
| **Fixed** | A specific calendar period agreed between the traders. The price is the average of the benchmark over that exact period. No monitoring required from the operator — the dates are known and fixed in advance. | **"Fixed 1-15 Mar"** = average of benchmark over 1–15 March. **"Fixed 10-20 Apr"** = average over 10–20 April. |
| **EFP** | Exchange for Physical. The price is linked to a futures position on an exchange (e.g., ICE Brent, NYMEX RBOB). The pricing is effectively already determined through the exchange transaction. Minimal monitoring needed from operator. | **"EFP"** — showing the type alone is sufficient. No additional parameters needed. |

**Note about pricing formula:** The pricing formula (e.g., "Platts FOB Baltic MTBE +$5.50/MT") is *always present in the trader's deal recap email*. The AI deal parser should still extract it and store it in the database — it is useful for the invoice desk. However, it should **NOT** be displayed in the operator's Excel/Spreadsheet view. It is useless information for the operator / for this program's primary purpose.

#### AI Deal Parsing Must Include Pricing Period

When the AI parses a trader's deal recap email, it must extract the **pricing period** as a structured field in addition to the pricing formula. Example: if the email says "Pricing: Platts FOB Baltic 0-1-5 after BL", the parser should output:

| Field | Parsed Value |
|-------|-------------|
| `pricing_formula` | *"Platts FOB Baltic MTBE +$5.50/MT"* |
| `pricing_period_type` | "BL" |
| `pricing_period_value` | "0-1-5" |

For Fixed pricing, the value would be the date range (e.g., "1-15 Mar"). For EFP, the type alone is sufficient with no additional value needed.

**Note on business days:** The days in the BL/NOR format (e.g., "0-1-5") refer to business days (working days), not calendar days. However, the system does not need to calculate or validate this — the operator knows the convention and the actual pricing calculation is done externally. The system only needs to store and display the pricing period string as provided by the trader.

---

## 2. Color Coding for Excel/Spreadsheet View Cells

### Problem

The current table is entirely monochrome — all cells have the same dark background with no visual differentiation. The operator cannot see **at a glance** what has been completed, what needs attention, and what hasn't been touched yet. This is critical because an operator manages dozens of deals simultaneously and needs an instant visual overview.

### Solution: Color Coding System

There are two distinct color logic patterns depending on the type of field:

#### Pattern A: Operator Action Fields (Most Columns)

These are fields where the operator performs an action (sends an email, receives a document, appoints a party, etc.). They follow a simple **two-state** logic:

| Color | Meaning | Description |
|-------|---------|-------------|
| No color (white) | **Not done yet** | The cell has no background color. The step has not been completed. The field remains uncolored until the operator marks it as done. Example: Doc Instructions column is uncolored because doc instructions have not been sent/received yet. |
| 🟢 Green | **Done** | The operator has selected "Done" from the dropdown. The cell turns green. Example: Doc Instructions completed → operator selects "Done" → cell turns green. Nomination sent to terminal → "Done" → green. Inspector appointed → "Done" → green. |

This applies to columns such as: Doc Instructions, Voyage/Discharge Orders, Vessel Nomination, Supervision (LP/DP), COA to Traders, Discharge Nomination (Terminal), Outturn, Freight Invoice, Tax, Invoice to CP. The operator selects "Done" from the dropdown, and the cell turns green. There is no yellow state for these fields.

#### Pattern B: Pricing Field (BL and NOR Pricing Only)

The Pricing cell is the **only field that uses the yellow state**. This is because BL and NOR pricing require ongoing monitoring of an estimated date that can change. The three-state logic:

| Color | Meaning | Description |
|-------|---------|-------------|
| No color (white) | **Not yet entered** | Pricing period has not yet been entered for this deal. Once entered, it immediately transitions to yellow (BL/NOR) or green (Fixed/EFP). |
| 🟡 Yellow | **Needs monitoring** | BL or NOR pricing is active and the pricing is NOT yet confirmed/settled. The BL or NOR date may still be an estimate. The operator must monitor the situation and verify dates as the cargo progresses. |
| 🟢 Green | **Pricing confirmed** | The operator has confirmed that the pricing is settled. The operator manually marks this cell green when they know the pricing window is finalized. |

**How pricing period data enters the system:** The pricing period is extracted by the AI deal parser from the trader's email (see Section 1). If the trader forgot to include it, the operator can add it manually later in the linkage view (see Section 4). Once the pricing period is entered, the pricing cell automatically gets its initial color. If the pricing type is BL or NOR, the cell immediately turns **yellow** (needs monitoring). If the pricing type is Fixed or EFP, the cell immediately turns **green** (nothing to monitor).

**Important — all deal fields are editable:** The linkage view (detail view for a cargo grouping, explained in Section 4) must allow the operator to edit **all deal fields retroactively** — not just pricing, but counterparty, quantity, dates, vessel, ports, everything. Information often arrives late or changes. The operator must be able to add, correct, or update any field at any time.

**Transition trigger (yellow → green for BL/NOR):** The operator manually marks the pricing cell as green when they have confirmed that the pricing is settled. This is done via the same dropdown mechanism as other fields (see Section 6). The reason for this simple approach:

- **BL pricing**: The BL (Bill of Lading) date becomes known after loading. Once the operator has the exact loaded quantity and BL date, they mark pricing as confirmed.
- **NOR pricing**: The NOR (Notice of Readiness) date is based on the **discharge port**, NOT the loading port. This means that even after loading (exact quantity entered, BL date known), the NOR date is **still unknown** — the vessel hasn't arrived at the discharge port yet. NOR pricing can only be confirmed after the vessel tenders NOR at the discharge port, which happens days or weeks after loading.
- **Why no automatic trigger:** Because BL and NOR have fundamentally different timelines (BL is known at loading, NOR is known at discharge), a single automatic trigger would not work for both. Keeping it simple — the operator decides when pricing is confirmed — avoids complex logic, reduces error risk, and gives the operator full control. The operator knows best when pricing is settled.

#### Estimated BL/NOR Date in the Excel/Spreadsheet View

For BL and NOR priced deals, the Excel/Spreadsheet view must show a small **editable date field** directly next to the pricing period cell. This field is called **"Est. BL"** or **"Est. NOR"** (depending on the pricing type) and the operator enters their best estimate of when the Bill of Lading will be dated or when NOR will be tendered.

**Why this is needed:** The pricing window (e.g., BL 0-1-5) is calculated relative to the BL or NOR date. If the operator doesn't have the estimated date in front of them at all times, they risk forgetting to check whether it's still correct as the cargo progresses. The estimated date must be **always visible** in the Excel/Spreadsheet view, right next to the pricing period, so the operator sees both pieces of information together.

**Example:** A deal with BL 0-1-5 pricing and an estimated BL date of 12 April. Both pieces of information must be visible in the Excel/Spreadsheet view. The exact layout (one cell with both values, two adjacent cells, or another approach) is up to the developer — the requirement is that both are visible together, the estimated date is editable directly in the Excel/Spreadsheet view, and the whole thing takes up minimal space.

**For Fixed and EFP pricing:** No estimated date field is needed. Fixed pricing has known dates already. EFP has no date dependency. The estimated date field only appears for BL and NOR pricing types.

**Implementation:** Add `estimated_bl_nor_date` (date, nullable) to the Deal model. This field is only used when `pricing_period_type` is BL or NOR. The operator enters and updates this field directly in the Excel/Spreadsheet view.

**Note:** For Fixed and EFP pricing, the pricing cell is **automatically green** as soon as the pricing period is entered. There is nothing for the operator to monitor — Fixed dates are known in advance, and EFP is already determined through the exchange transaction. Yellow only applies to BL and NOR pricing types.

---

## 3. Missing Feature: Exact Loaded Quantity Entry

### Problem

There is currently no way to enter the **exact loaded quantity** after a vessel has been loaded. This is critically important because:

- The deal's original quantity is always an *estimate* (e.g., 25,000 MT). The actual loaded quantity always differs (e.g., 24,847.532 MT). This is normal in physical trading — you can never load exactly the contracted quantity.
- The Bill of Lading figures must reflect the **exact loaded quantity to decimal precision** — this is the legally binding number. Any mismatch between B/L figures and actual cargo creates documentary and financial problems.
- Entering the exact loaded quantity confirms the BL date (the date on the Bill of Lading is now known). For BL-priced deals, this means the operator can now verify the pricing window and manually mark the Pricing cell as green (see Section 2). For NOR-priced deals, the NOR date at the discharge port is still unknown at this point — pricing confirmation comes later.

### Solution

**Important:** The loaded quantity is entered at the **individual purchase deal level**, NOT at the linkage level. This is because a linkage can contain multiple purchases (e.g., buying from two different suppliers for the same cargo). Each purchase has its own loaded quantity. The linkage total is the **sum of all purchase quantities** within that linkage.

**Workflow in the dashboard linkage view:**

1. The operator opens a specific linkage in the dashboard.
2. Under each purchase deal within the linkage, a field labeled **"Loaded Quantity (MT)"** allows entry of the exact quantity with decimal precision (e.g., 24,847.532).
3. Upon saving, the following happens automatically:
   - The **linkage total quantity** recalculates as the sum of all purchase loaded quantities within that linkage.
   - The Excel/Spreadsheet view **B/L Figures** column updates with the exact loaded quantity for that deal.
   - For BL-priced deals, the BL date is now confirmed. The operator can verify the pricing window and **manually mark the Pricing cell as green** when satisfied (see Section 2). For NOR-priced deals, the NOR date at the discharge port is still unknown at this stage.
   - The change detection system logs the quantity change and flags any parties that need re-notification (if the quantity difference is material).

*Example: A linkage contains two purchases: Buy from Supplier A (estimated 15,000 MT +/-10%) and Buy from Supplier B (estimated 10,000 MT +/-10%). After loading, the operator enters: Supplier A = 15,324.024 MT, Supplier B = 9,876.114 MT. The B/L figures update for each purchase deal accordingly. The operator can then manually confirm the pricing status (mark green) once they have verified the pricing window is correct.*

**Important — only applies to purchases:** Loaded quantity is only entered on purchase deals. On the sale side, the operator nominates the contractual quantity with tolerance (e.g., 15,000 MT +/-10%). The exact loaded quantity does not need to be entered on the sale deal — the receiver will see the exact figures from the shipping documents (Bill of Lading) that the operator sends as part of the normal workflow. There is no need to update the sale deal's quantity in the system.

**Loading from own terminal ("+" button in linkage view):** The linkage view must always have a permanent **"+"** button that allows the operator to indicate that cargo is being loaded from their own terminal (Klaipeda, Amsterdam, or Antwerp). This button is **always available** on every linkage, regardless of whether it contains purchase deals, sale deals, or both.

**How the "+" button works:** When the operator clicks "+", it creates a new deal entry in the linkage with one of the operator's own terminals (Klaipeda, Amsterdam, or Antwerp) as the counterparty. This can be either a purchase-side entry (loading FROM own terminal) or a sell-side entry (discharging INTO own terminal). The "+" button itself does NOT show any workflow emails yet — it simply adds the terminal deal entry. **Only after the entry is created** does the system generate the workflow view showing what emails need to be sent.

#### Data Model for Terminal Operations

**Suggested approach:** Add a `deal_type` enum field to the Deal model with two values: `regular` (default — normal deals with external counterparties) and `terminal_operation` (own-terminal loading or discharge created via the "+" button).

**Why reuse the Deal model:** A terminal operation is functionally very similar to a deal — it has a direction (buy/sell side), a counterparty (the terminal), quantity, workflow steps, and emails. By using the same Deal table with a type flag, the existing workflow engine, audit logging, email draft generation, and all other infrastructure works without any changes. A separate table (e.g., TerminalOperation) would require duplicating all of that logic.

**Key differences from regular deals:**

- `deal_type = 'terminal_operation'` instead of `'regular'`
- `counterparty` = the terminal name (e.g., "Klaipeda Terminal", "Amsterdam Terminal")
- `external_ref` = NULL (there is no reference number from an external party — this is an internal operation)
- The workflow engine generates emails specific to terminal operations (see below)

#### Excel/Spreadsheet View Behavior for Terminal Operations

**Terminal operations do NOT appear in the main purchase/sell deal rows in the Excel/Spreadsheet view.** Instead, the Excel/Spreadsheet view has a separate section at the bottom called **"Internal / Terminal Operations"**, visually separated from the main table by a divider and header. This section shows:

- Linkages that contain ONLY terminal operations (no external counterparty deals). Example: loading from Klaipeda and discharging into Amsterdam — both sides are "+" entries, no external buy or sell.
- Linkages where a terminal operation exists but the corresponding external deal has not yet been added. Example: loading from Klaipeda via "+", but the sell deal hasn't arrived yet.

**Movement rule:** When an external (regular) deal is added to a linkage that was previously internal-only, the linkage moves from the "Internal / Terminal Operations" section **up into the main Excel/Spreadsheet table** under the normal purchase/sell rows. The terminal operation deal stays in the linkage (visible in the linkage view) but does not appear as its own row in the main table. Only the regular deal appears as a row.

**Filter logic:** The main Excel/Spreadsheet table shows only deals where `deal_type = 'regular'`. The Internal / Terminal Operations section shows linkages where ALL deals have `deal_type = 'terminal_operation'`, OR where at least one terminal_operation exists but no regular deal exists yet.

**Future scope:** This "Internal / Terminal Operations" section will also be used for ITT (inter-tank transfer) operations and other internal movements in later versions. The structure is designed to accommodate these future use cases.

#### Emails for Own Terminal Operations

**Discharging into own terminal** (sell-side "+", e.g., cargo arriving at your terminal in Amsterdam):

1. Terminal incoming discharge nomination
2. Inspection nomination (at discharge port)
3. Agency nomination (at discharge port)

**Loading from own terminal** (purchase-side "+", e.g., loading cargo from your terminal in Klaipeda):

Same three emails as above, but the **vessel nomination and documentary instructions are combined into one email** to the terminal (since it is your own terminal, these go together).

**Documentary instructions logic:** If a sell deal already exists in the linkage, the operator uses the **buyer's (receiver's) documentary instructions** when sending the nomination to their own terminal. The "receiver" here means the buyer / cargo recipient — the party the cargo is being sold to. If there is no sell deal yet (cargo destination not yet decided), the operator composes the documentary instructions themselves based on their own judgment.

**Note:** A detailed description of how receiver/buyer documentary instructions work in practice (what fields they contain, how they flow into the nomination, etc.) will be provided in a later version of this feedback document. For V1 implementation, the key requirement is that the system supports attaching documentary instructions to a terminal nomination and that the operator can choose the source (buyer's instructions vs. self-composed).

#### When is the "+" button used?

- **Sale-only linkage:** No purchase deal exists. The cargo is loaded entirely from the operator's own terminal (e.g., Klaipeda). The "+" button adds a purchase-side terminal entry and triggers the loading workflow emails.
- **Purchases + own terminal top-up:** The operator bought 15,000 MT from Supplier A, but also loaded an additional 3,000 MT from their own terminal in Amsterdam on top. The "+" button adds another purchase-side terminal entry for the extra 3,000 MT.
- **Purchase-only linkage (discharging into own terminal):** The operator bought cargo and is bringing it into their own terminal. The "+" button adds a sell-side terminal entry and triggers the discharge workflow emails.

The "+" button never disappears. It is a permanent feature of the linkage view, always available to add own-terminal operations on either the purchase or sell side.

**Implementation — new fields on the Deal model:**

- `loaded_quantity_mt` (decimal, nullable) — The exact loaded quantity. Used on purchase deals only. When populated, it overrides the original `quantity_mt` for all B/L-related fields. Note: the pricing cell color (yellow → green) is changed manually by the operator, not automatically by loaded quantity entry (see Section 2).
- `pricing_period_type` (enum: BL | NOR | Fixed | EFP, nullable) — The type of pricing period. Extracted from the deal recap by the AI parser (see Section 1). This determines which column in the Excel/Spreadsheet view the pricing information appears in and which color logic applies.
- `pricing_period_value` (string, nullable) — The pricing period parameters. For BL/NOR: the day window in format "0-1-5". For Fixed: the date range (e.g., "1-15 Mar"). For EFP: null (no parameters). This is the value displayed in the Excel/Spreadsheet view pricing column.
- `deal_type` (enum: regular | terminal_operation, default: regular) — Distinguishes external deals from own-terminal operations created via the "+" button (see above).
- `estimated_bl_nor_date` (date, nullable) — The operator's estimate of the BL or NOR date. Only used when pricing_period_type is BL or NOR. Displayed in the Excel/Spreadsheet view next to the pricing period. See Section 2 for full details.

---

## 4. Linkage — The Fundamental Organizational Structure

### Problem

In a previous version with mock data, **linkage was missing from all deals**. This is a fundamental gap — linkage is the primary way operators organize and view their cargo portfolio. Without it, the operator has no way to see which deals belong together as part of the same physical cargo movement.

### What is Linkage?

Think of a linkage as a **folder**. Every deal always belongs to a folder (linkage). A folder can contain one deal or many deals. Here are the key rules:

- **Every deal ALWAYS belongs to a linkage**. Even if there is only a single purchase with no corresponding sale yet, that purchase is still inside its own linkage folder. There is no such thing as an "unlinked" deal.
- **A linkage can contain any combination of buys and sells**. Common scenarios: one buy + one sell (back-to-back), one buy + two sells (splitting a cargo), multiple buys + one sell (consolidation), or just a single buy or single sell on its own.
- **Linkages can be merged**. If an operator initially creates two separate linkages and later discovers they are actually the same physical cargo, the system must allow merging them into one. When merging, the system asks the operator which linkage number to keep.

#### Concrete Examples

**Example 1 — Back-to-back (most common):** Linkage "TEMP-003" contains: Buy from Shell 15,000 MT FOB ARA + Sell to BP 15,000 MT CIF Baltic. Two deals, one folder. Same physical cargo bought from Shell and sold to BP.

**Example 2 — Cargo split:** Linkage "LNK-2026-0047" contains: Buy from TotalEnergies 30,000 MT + Sell to Neste 15,000 MT + Sell to Orlen 15,000 MT. One purchase split across two sales. Three deals, one folder.

**Example 3 — Single deal (no counterpart yet):** Linkage "TEMP-008" contains: Buy from Vitol 25,000 MT. No sale yet — but the deal is already in its folder. When a sale is added later, it goes into the same linkage.

**Example 4 — Own terminal (sale only):** Linkage "TEMP-012" contains: Sell to Neste 10,000 MT CIF Baltic. No purchase from an external supplier — the cargo is loaded from the operator's own terminal (e.g., Klaipeda). The operator uses the "+" button in the linkage view to add the terminal loading operation and triggers the loading workflow emails.

**Example 5 — Merging:** "TEMP-003" has a Buy from Shell 15,000 MT. "TEMP-005" has a Sell to BP 15,000 MT. The operator realizes these are the same cargo. They merge TEMP-003 and TEMP-005 into one linkage. The system asks: "Which linkage number should the merged linkage use?" The operator picks TEMP-003 (or enters the official number if available).

### Linkage Number vs. Temporary Name

This is critically important for the implementation:

- The official **linkage number** comes from the trader's external ETRM system (a separate company system used for storage, invoicing, and trade management — this is NOT GasOps/NominationEngine). The trader generates it when they have entered the deal into their system. This can happen *after* the deal has already been communicated to operations.
- Deals frequently arrive as **prompt deals** — urgent deals where the operator must start working immediately, before the trader has generated a linkage number. **The absence of a linkage number must NEVER block the operator from sending emails or progressing the workflow.**
- Therefore, our program must **auto-generate a temporary name** for every new linkage that does not yet have an official number. For example: TEMP-001, TEMP-002, etc.
- When the official linkage number is later entered by the operator (after the trader provides it), the temporary name is replaced by the real number everywhere in the system.

#### Data Model

The Linkage must be its own entity in the database. Suggested structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Multi-tenant isolation (required) |
| `linkage_number` | String, nullable | Official number from trader's ETRM system. NULL until trader provides it. |
| `temp_name` | String | Auto-generated temporary name (e.g., "TEMP-001"). Created on linkage creation. |
| `display_name` | Computed | Shows linkage_number if set, otherwise temp_name. This is what the operator sees everywhere. |
| `created_at` | Timestamp | When the linkage was created |

The Deal model then gets a `linkage_id` (required, never null) foreign key pointing to the Linkage table. Every deal always has a linkage.

#### Creating a New Linkage from the Dashboard

The operator dashboard (main view) must have a **"+" or "New Linkage" button** that creates a new, empty linkage. This is essential because not all linkages start with a deal arriving from the trader. Sometimes the operator knows that a cargo movement is coming (e.g., they need to load from their own terminal) but no formal deal exists yet.

**How it works:**

1. Operator clicks "+" / "New Linkage" on the dashboard.
2. System opens a form asking for basic information. The operator fills in what they know: vessel name, loading terminal, approximate dates, product, etc.
3. Fields that the operator does not yet know are left as **TBA (To Be Announced)** or **TBC (To Be Confirmed)**. The system must accept incomplete information — a linkage can be created with minimal data.
4. The system creates the linkage with an auto-generated temp name (e.g., TEMP-015) and opens the linkage view.
5. In the linkage view, everything is empty — no buy deals, no sell deals. The operator can now use the "+" button (see Section 3) to add terminal operations on the purchase side (loading from own terminal) or sell side (discharging into own terminal).
6. Later, when an external deal arrives (e.g., a sell deal from the trader), the operator adds it to this existing linkage. At that point, the linkage moves from the "Internal / Terminal Operations" section of the Excel/Spreadsheet view into the main table.

*Example scenario: The operator knows that 20,000 MT of gasoline needs to be loaded from Klaipeda terminal and shipped somewhere — but the trader hasn't finalized the sale yet. The operator clicks "New Linkage" on the dashboard, enters: vessel = TBA, terminal = Klaipeda, product = Gasoline, quantity = ~20,000 MT, dates = TBA. The system creates TEMP-015. The operator opens it, clicks "+" on the buy side to create a terminal loading operation for Klaipeda. The workflow emails for terminal loading appear. The operator sends the terminal nomination. Three days later, the trader sends a deal recap: "Sold 20,000 MT to Neste CIF discharge port Porvoo." The operator adds this sell deal to TEMP-015. The linkage now contains a terminal loading (buy side) and a regular sell to Neste — it moves to the main Excel/Spreadsheet table.*

*Another scenario — terminal to terminal: The operator needs to move cargo from Klaipeda to Amsterdam (both own terminals). They create a new linkage, click "+" on the buy side (loading from Klaipeda) and "+" on the sell side (discharging into Amsterdam). This linkage stays in the "Internal / Terminal Operations" section of the Excel/Spreadsheet view because it has no external counterparty. Both sides have their own workflow emails (loading emails for Klaipeda, discharge emails for Amsterdam).*

#### Dashboard: Linkage Overview

The operator dashboard must show a **list of all active linkages**. This includes linkages in all states — those with deals in the main Excel/Spreadsheet table, those in the Internal / Terminal Operations section, and those that are still empty (just created, no deals or terminal operations yet). This linkage list is how the operator navigates to linkages that are not visible in the Excel/Spreadsheet view.

**Completed linkages:** Linkages where all work is finished should not clutter the active list. The operator must be able to mark a linkage as **"Completed"** — meaning all workflow steps are done, all emails sent, cargo has been delivered, no further action needed. When a linkage is marked completed, **its rows move from the active Excel/Spreadsheet view to a separate "Completed" sheet/tab**. This Completed sheet serves as an archive — old linkages remain fully visible and searchable, but they don't clutter the operator's active workspace. The system could also *suggest* marking a linkage as completed when all workflow steps across all deals in the linkage show "Done" — but the operator always makes the final decision.

#### Adding a New Deal to an Existing Linkage

When a trader sends a deal recap and the AI parser creates a new deal, the system must help the operator place it in the correct linkage. The flow is:

1. Trader sends deal recap (email or chat message).
2. AI parser extracts structured deal data (counterparty, direction, quantity, dates, etc.).
3. System checks for **potential matches** against existing linkages. Match criteria: similar counterparty on the opposite side, overlapping dates, compatible quantities, same product. If a match is found, the system suggests: *"This deal looks like it could belong to Linkage TEMP-003 (Buy from Shell 15,000 MT, loading ARA 10-12 Apr). Do you want to add it to this linkage?"*
4. The operator has three options:
   - **Accept the suggestion** — the deal is added to the suggested linkage.
   - **Choose a different linkage** — the operator manually selects an existing linkage from a search/dropdown list.
   - **Create a new linkage** — the deal gets its own new linkage (with auto-generated temp name).

This flow ensures that every deal always ends up in a linkage (never orphaned), and the operator always has the final say on which linkage it belongs to. The system's matching suggestions are helpful but never automatic — the operator confirms every placement.

---

## 5. Workflow Dependency Gates — Soft Warnings, Not Hard Blocks

### Problem

The current architecture describes dependency gates as **hard blocks** — meaning a workflow step cannot proceed until its prerequisites are complete. For example, the CLAUDE.md states that a terminal nomination is "BLOCKED until buyer returns clearance + doc instructions." **This is incorrect for real-world operations.**

### Why Hard Blocks Don't Work

In practice, there are many situations where the operator **_needs_** to send a communication even though a prerequisite isn't complete. Real example:

*You have a CIF sale. You need to send a nomination to your loading terminal, but the buyer hasn't returned documentary instructions yet. Normally, you would wait. But the loading window is approaching and if you don't nominate now, you lose your slot in the terminal's loading line-up. Other traders will take your slot. So you send the nomination with the information you have, and send an updated version later when the documentary instructions arrive.*

### Solution: Warning-Based Dependencies

Dependency gates must be **soft warnings**, not hard blocks. The operator always decides. The system's job is to inform, not to restrict.

1. When a prerequisite is incomplete and the operator clicks "Send", the system shows a **popup dialog (modal)** with a clear warning message.
2. The popup message must be specific. Example: *"Warning: Buyer's documentary instructions have not been received yet. The nomination will be sent without doc instructions. Are you sure you want to proceed?"* The popup has two buttons: **"Send Anyway"** and **"Cancel"**.
3. The operator clicks "Send Anyway" to proceed or "Cancel" to wait. This is always the operator's decision.
4. If the operator proceeds, the system records that the email was sent *without complete prerequisites* in the audit log.
5. When the missing information arrives later (e.g., the operator marks the Doc Instructions dropdown as "Done" in the Excel/Spreadsheet view), the system detects that a previous email was sent without this information and surfaces an **"Update Required"** task in the operator's queue — prompting them to send an updated version of the nomination/instruction with the now-complete information.

*Example scenario end-to-end: CIF sale, terminal nomination needed urgently. Operator clicks "Send nomination" → system shows warning "Buyer's doc instructions not received" → operator clicks "Send anyway" → nomination goes to terminal without doc instructions → audit log records this. Two days later, buyer sends doc instructions → operator sets Doc Instructions dropdown to "Done" in Excel/Spreadsheet view → system creates "Update Required" task: "Terminal nomination for Linkage TEMP-003 was sent without doc instructions. Doc instructions now marked as done. Send updated nomination with doc instructions?" → operator reviews and sends updated nomination.*

**Key principle:** The operator must ALWAYS be able to send any email at any time. The system warns about missing prerequisites but never prevents the operator from acting. In physical trading, timing can be more important than completeness — you can always send an update, but you cannot get back a lost terminal slot.

**V1 vs. future:** In V1, the operator manually marks steps as "Done" in the Excel/Spreadsheet view dropdown (e.g., marking Doc Instructions as Done when received). In the future, this could be automated: the operator drags and drops an incoming email into the platform, and the AI parses it to extract the relevant information (e.g., documentary instructions from the buyer's email) and automatically updates the status and populates fields. This ties into email templates and the broader Sedna integration. For V1, manual operator input is sufficient.

---

## 6. Excel/Spreadsheet View Must Be Editable — Dropdown Status Fields

### Problem

The current Excel/Spreadsheet view is **read-only**. The operator cannot interact with the cells at all. This is a fundamental problem because the Excel/Spreadsheet view is where the operator spends most of their time. They need to be able to update the status of each workflow step **directly in the Excel/Spreadsheet view** without navigating to a separate detail page for every single update.

### Solution: Dropdown Menus in Cells

Each operator action field (see section 2, Pattern A) should have a **dropdown menu** directly in the Excel/Spreadsheet view cell. When the operator clicks on a cell, a dropdown appears with the relevant status options. Upon selection, the cell updates and the color changes accordingly.

**Why dropdowns:** Dropdowns are the simplest approach from both a development and UX perspective. The system knows exactly which statuses are valid for each column, so it can present the right options. The operator selects one, and the system immediately knows what color to apply. No ambiguity, no free-text parsing, no validation errors.

**Which columns exist:** The complete list of columns in the Excel/Spreadsheet view is already defined in the existing version of the platform. Use the current column set as the starting point. The key change is not which columns exist, but **which columns are editable (operator dropdown) vs. locked (system-populated)**. The table below shows examples of editable columns with their dropdown options:

| Column | Dropdown Options | Color Result |
|--------|-----------------|--------------|
| Doc Instructions | (empty) / Done | No color → Green on "Done" |
| Vessel Nomination | (empty) / Done | No color → Green on "Done" |
| Supervision (LP/DP) | (empty) / Done | No color → Green on "Done" |
| Freight Invoice | (empty) / Done | No color → Green on "Done" |
| Pricing (BL/NOR) | (empty) / Done | No color → Yellow (auto) → Green on "Done" |
| Pricing (Fixed/EFP) | No dropdown | No color → Green (auto, no operator action) |

**Special case — Pricing column:** The Pricing column uses the same "Done" dropdown as all other columns, but with one difference: when the pricing period is first entered (from the deal recap), the system **automatically sets the cell to yellow** for BL/NOR pricing types (meaning: needs monitoring). The operator then selects "Done" from the dropdown when they have confirmed that pricing is settled — the cell turns green. For Fixed and EFP pricing, the cell goes directly to green when the pricing period is entered — **no dropdown interaction needed**, because there is nothing to monitor. If the pricing period is not yet known (trader forgot to include it), the cell stays empty with no color, just like any other empty field.

#### Editable vs. Locked Cells

Not all cells in the Excel/Spreadsheet view are editable. There are two types:

- **Operator-editable cells (dropdown):** These are fields that only the operator can update. They represent workflow steps the operator is responsible for. The operator selects "Done" from the dropdown when the step is completed. Examples: Doc Instructions, Vessel Nomination, Supervision, Freight Invoice. These cells have a dropdown arrow and the operator updates them.
- **System-populated cells (locked/read-only):** These are fields that the system fills in automatically based on data from other parts of the platform. The operator cannot edit these directly in the Excel/Spreadsheet view. Examples: B/L Figures (auto-populated when loaded quantity is entered), Pricing period (comes from deal data), Vessel name (comes from deal record). These cells update automatically when the underlying data changes.

**Visual indicator:** Editable cells must be visually distinguishable from locked cells. A small dropdown arrow (▾) inside or next to the cell is the clearest way to signal that the cell is interactive. Locked/system cells have no arrow and do not respond to clicks. The operator should never have to guess which cells they can interact with.

**This distinction is important:** the Excel/Spreadsheet view is not a free-form spreadsheet where everything is editable. It is a structured view where the operator can update their own action statuses via dropdowns (visually marked with an arrow), but system-generated data is locked and controlled by the platform. The color coding applies to both types — system cells also turn green when their conditions are met (e.g., B/L Figures turns green when loaded quantity is entered via the linkage view).

**Note:** For simplicity, all operator action columns use the same dropdown with two options: (empty) or "Done". Selecting "Done" turns the cell green. The operator can also undo this by opening the dropdown again and selecting the blank/empty option — the cell reverts to no color. This keeps the interface simple, consistent, and forgiving of accidental clicks. If more granular statuses are needed in the future (e.g., distinguishing "Sent" from "Received"), this can be refined later. The key requirement is that every operator action column has a dropdown and that the operator never needs to leave the Excel/Spreadsheet view to update a simple status.

**What "Done" means:** "Done" = **this step requires no further attention from the operator**. The meaning varies by column context: for a Vessel Nomination column, "Done" means the nomination has been sent. For a Doc Instructions column, "Done" means the documentary instructions have been received from the buyer. For a Supervision column, "Done" means the inspector has been appointed. The operator understands the context — the system does not need to distinguish between "sent" and "received" actions. "Done" is a universal signal that means "handled, no more attention needed."

**Auto-Done when sending emails:** When the operator sends an email through the system (e.g., a vessel nomination email via Sedna), the system should **automatically mark the corresponding dropdown cell as "Done"** in the Excel/Spreadsheet view. The operator should not need to manually mark it — the system knows the email was sent and can update the cell accordingly. This also updates the corresponding step in the linkage view. Conversely, if the operator manually marks a cell as "Done" (e.g., because they sent the email outside the system, or handled the step via phone), the system records this and marks the corresponding step in the linkage view as completed. The two directions work in sync: system → dropdown, or dropdown → system.

#### Navigation Between Excel/Spreadsheet View and Linkage View

The platform has two main views that serve different purposes:

- **Excel/Spreadsheet view** — The operator's primary workspace. Shows all deals in a table format. The operator spends most of their time here, using dropdowns to update statuses and scanning colors for an overview. This is where quick status updates happen.
- **Linkage view** — A detail view for a specific linkage (folder). Opened by clicking on a linkage from the Excel/Spreadsheet view. This is where the operator enters detailed information such as loaded quantity, manages deals within the linkage, merges linkages, enters the official linkage number, etc.

If the operator tries to edit a locked/system cell in the Excel/Spreadsheet view (e.g., clicks on B/L Figures or Loaded Quantity), the system should display a message directing them to the linkage view: *"This field is managed in the Linkage view. Click here to open it."* with a direct link to the relevant linkage. The operator should never be confused about where to go to update something.

---

## 7. Excel/Spreadsheet View Structure — Main Table vs. Internal Operations

### Problem

The current Excel/Spreadsheet view shows all deals in a single flat table. This does not account for the distinction between external deals (with counterparties like Shell, BP, Trafigura) and internal terminal operations (loading from or discharging into the operator's own terminals). These are fundamentally different types of entries and must be visually separated.

### Solution: Two-Section Excel/Spreadsheet View

The Excel/Spreadsheet view must be divided into two sections:

1. **Main table (top)** — Shows all regular deals (`deal_type = 'regular'`). This is the standard purchase/sell view with counterparty names, quantities, dates, and all the dropdown status columns from Section 6.
2. **Internal / Terminal Operations (bottom)** — A visually separated section below the main table (clear divider line + section header). Shows linkages that are entirely internal: terminal-to-terminal movements, own-terminal loadings where no external deal exists yet, and other internal operations.

**Automatic movement between sections:** When a regular (external) deal is added to a linkage that was previously in the Internal section, the entire linkage moves up to the main table. The terminal operation entry remains part of the linkage (visible in the linkage view) but the main table row shows only the regular deal. This ensures the operator sees all external commitments in one place.

#### What Appears in Each Section

| Main Table (Regular Deals) | Internal / Terminal Operations |
|---|---|
| Buy from Shell 15,000 MT FOB ARA | Loading from Klaipeda 20,000 MT (sell deal pending) |
| Sell to BP 15,000 MT CIF Baltic | Klaipeda → Amsterdam 10,000 MT (internal transfer) |
| Buy from TotalEnergies 30,000 MT | Discharge into Antwerp 8,000 MT (purchase arriving) |

#### Columns in the Internal / Terminal Operations Section

The Internal / Terminal Operations section does **NOT** need all the columns that appear in the main table for regular deals. It uses a reduced set of columns relevant to terminal operations only:

- B/L Quantity
- Voyage / Discharge Orders
- Nomination to Load/Discharge Terminal
- Load/Discharge Inspection Nomination
- Load/Discharge Port Agency Nomination
- Load/Discharge Port Demurrage
- Freight Invoice

All other columns that appear in the main table (such as Doc Instructions from counterparty, COA to Traders, Tax, Invoice to CP, etc.) are not relevant for internal terminal operations and should be omitted from this section to keep it clean and focused.

#### Status Carry-Over When Moving Between Sections

When a linkage moves from the Internal / Terminal Operations section to the main table (because an external deal is added), **all existing "Done" statuses must carry over**. For example: the operator has already completed load port demurrage (marked "Done" in the Internal section). When a sell deal is added and the linkage moves to the main table, the load port demurrage column in the main table must already show "Done" (green). The operator should not have to re-enter any statuses that were already completed.

This is straightforward to implement because the "Done" status is stored on the workflow step / deal level, not on the section. The Excel/Spreadsheet view simply renders whatever status exists, regardless of which section the linkage is displayed in.

**Future extensibility:** The Internal / Terminal Operations section is designed to grow. In later versions, it will also house ITT (inter-tank transfer) operations and other internal logistics movements. The `deal_type` enum can be extended (e.g., `'itt_operation'`) to support these future types while keeping the same visual separation logic.

**Dashboard "+" button:** As described in Section 4, the operator can create a new empty linkage directly from the dashboard. When a new empty linkage is created (no deals yet), it initially appears in neither section of the Excel/Spreadsheet view — it only exists in the linkage list. Once the operator adds a terminal operation via the "+" button in the linkage view, the linkage appears in the Internal / Terminal Operations section. Once a regular deal is added, it moves to the main table.

---

## 8. Platform Views — Excel/Spreadsheet, Dashboard, and Linkage View

### The Three Views

The platform has three distinct views, each serving a different purpose. Understanding their relationship is essential for implementation:

1. **Excel/Spreadsheet View** — The operator's **overview and monitoring tool**. A single large table showing ALL deals across ALL linkages. This is where the operator sees the full picture: color coding reveals what's done, what's pending, what needs attention. The operator uses dropdown menus here to mark steps as "Done" (see Section 6). This view answers the question: "Across all my cargo, what is the status of everything?"
2. **Dashboard** — The operator's **navigation hub**. Shows all linkages as cards (tiles/boxes), organized in columns by type. The operator uses this to find and open the right linkage. This view answers the question: "Which linkage do I need to work on?"
3. **Linkage View** — The operator's **workspace for action**. Opens when the operator clicks a linkage card on the dashboard. Shows everything inside that specific linkage: the deals, workflow steps, email drafts to send, loaded quantity entry, and all editable deal fields. This view answers the question: "What do I need to do for this specific cargo?"

### Dashboard — Linkage Cards Layout

The dashboard displays linkage cards organized in columns from left to right:

| Sell Only | Buy Only | Purchase + Sell | Own Terminal | Empty |
|-----------|----------|-----------------|--------------|-------|
| Linkages with only sell deal(s), no purchase | Linkages with only purchase deal(s), no sell | Linkages with both purchase and sell deals | Terminal-only operations (see Section 7) | New linkages with no deals yet |

**Important:** The column placement is not stored as a separate field. It is computed on-the-fly from the deals inside each linkage, using the same logic that determines section placement in the Excel/Spreadsheet view. For example, if a linkage currently contains only a sell deal, its card appears in the "Sell Only" column. If a purchase deal is later added to that linkage, the card automatically moves to the "Purchase + Sell" column.

Each card shows summary information:

- Linkage number or temp name (e.g., "LNK-2026-0047" or "TEMP-003")
- Deal summary (e.g., "1 purchase from Vitol 15,000 MT + 1 sell to Neste 15,000 MT")
- Vessel name (e.g., "MT Saturnus") or "TBA" if not yet known
- Loading/discharge dates or "TBA"

Clicking a card opens the **Linkage View** for that linkage.

The "+" / "New Linkage" button (described in Section 4) is located on the dashboard. Completed linkages are not shown on the dashboard — they are archived in the Completed sheet/tab (see Section 4).

### Linkage View — Inside the Folder

When the operator opens a linkage, they see everything inside that folder:

- **Deal list** — All deals in this linkage (purchases and sells), including terminal operations created via the "+" button. Each deal shows its key fields (counterparty, direction, quantity, dates, vessel, incoterm, pricing period, etc.).
- **Editable deal fields** — The operator can edit **all** fields on any deal directly in this view. Counterparty, quantity, dates, vessel, pricing period, ports — everything is editable at any time. Information often arrives late or changes mid-process.
- **Loaded quantity entry** — For purchase deals: the field where the operator enters the exact loaded quantity with decimal precision (see Section 3).
- **Workflow steps and email drafts** — For each deal, the workflow steps that need to be completed: which emails to send, to whom, in what order. The operator reviews email drafts and sends them from here. Dependency warnings appear here (see Section 5).
- **Linkage number** — The operator can enter or update the official linkage number (from the trader's external ETRM) when it becomes available.
- **The "+" button** — Always visible, for adding own-terminal operations (see Section 3).
- **Merge option** — The ability to merge this linkage with another one (see Section 4).
- **Mark as Completed** — When all work is done, the operator marks the linkage as completed. It moves to the Completed archive.

**Key principle:** The Excel/Spreadsheet view is for **monitoring** (scanning colors, marking simple Done statuses). The Linkage view is for **working** (editing deals, entering data, sending emails, managing workflow). These two views complement each other — the operator switches between them throughout their day.

---

## Summary of All Changes

All eight sections are interconnected and form the operator's core workflow requirements:

| # | Change | Why It Matters | Priority | Complexity |
|---|--------|---------------|----------|------------|
| 1 | Pricing column shows pricing period instead of formula | Operator sees the correct information they actually need to monitor | High | Medium |
| 2 | Color coding (empty / yellow / green) for all cells | Instant visual overview across dozens of deals — the operator's #1 need | High | Medium |
| 3 | Loaded quantity + "+" terminal operations with deal_type model | Exact B/L figures, own-terminal loading/discharge, data model for internal vs external deals | High | Medium |
| 4 | Linkage as folder + dashboard linkage list + deal-to-linkage assignment + completion status | Fundamental structure; dashboard shows all linkages; new deals matched to existing linkages; completed linkages archived | Critical | High |
| 5 | Soft warnings instead of hard blocks for dependencies | Operators must never be blocked; timing > completeness in physical trading | Critical | Medium |
| 6 | Editable Excel/Spreadsheet view with dropdown status fields | Operator must update statuses directly in Excel/Spreadsheet view; drives the color coding system | Critical | Medium |
| 7 | Excel/Spreadsheet view: main table vs. Internal / Terminal Operations section | Own-terminal ops separated from external deals; auto-moves to main table when external deal added | High | Medium |
| 8 | Three-view architecture: Excel/Spreadsheet + Dashboard cards + Linkage view | Three distinct views for monitoring, navigation, and action; dashboard cards organized by linkage type | Critical | High |

**Note:** Points 4 (Linkage), 5 (Soft Warnings), and 6 (Editable Excel/Spreadsheet View) are marked as **Critical** because they affect the fundamental architecture and usability of the platform. Point 6 is the mechanism that makes Point 2 (Color Coding) work in practice — without editable dropdowns, there is no way for the operator to trigger color changes. Points 3 and 7 are closely related: the `deal_type` field introduced in Point 3 is what drives the two-section Excel/Spreadsheet view in Point 7. If these are not implemented correctly from the start, they will require significant refactoring later.

**Terminology note:** Throughout this document, references to the trader's **external ETRM system** mean a separate company application used by the trader for storage, invoicing, and trade management. This is NOT GasOps/NominationEngine. The ETRM is the source of linkage numbers and deal reference numbers. GasOps receives this data from the trader — it does not generate it.

**Deferred to next version:** Detailed description of how receiver (buyer) documentary instructions work in practice — what fields they contain, how they flow into terminal nominations, and how the operator decides between using the buyer's instructions vs. composing their own. This will be covered in the next iteration of this feedback document.

*These are operator comments based on hands-on experience with the current version. More feedback will follow as testing continues.*
