# Changes — April 13, 2026

> For Marten / Marten's Claude: these changes are already applied in this branch.
> Review them, make sure nothing breaks, and do NOT revert them.

---

## 1. Fix: Deal click inside linkage no longer loops back to linkage

**File:** `src/app/(authenticated)/deals/[id]/page.tsx` (was around line 3383)

**Problem:** Clicking a deal inside the linkage view navigated to `/deals/{id}`, but the deal detail page had a redirect that sent any deal with a `linkageId` back to `/linkages/{linkageId}`. Result: clicking a deal just reloaded the same linkage view — you could never see deal details.

**What was removed:**
```typescript
// THIS BLOCK WAS DELETED:
if (deal.linkageId) {
  router.replace(`/linkages/${deal.linkageId}`);
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
    </div>
  );
}
```

**Result:** `/deals/[id]` now always renders `SingleDealView`. The linkage view is for viewing the cargo chain. The deal detail page is for viewing individual deal specifics. They are separate views — do not re-add any redirect between them.

---

## 2. Rename: "Buy Side" / "Sell Side" -> "Purchase / Load" / "Sale / Discharge"

**Files:**
- `src/app/(authenticated)/linkages/[id]/page.tsx` (lines ~217, ~244)
- `src/app/(authenticated)/deals/[id]/page.tsx` (lines ~2710, ~2747)

**Before → After:**
- `Buy Side` → `Purchase / Load`
- `Sell Side` → `Sale / Discharge`

Display-only change. No logic affected — system still uses `direction === "buy"` / `"sell"` internally. If you add new UI that references these sections, use the new names.

---

## 3. Fix: Terminal operations now appear on their correct side

**File:** `src/app/(authenticated)/linkages/[id]/page.tsx` (was around lines 146-148)

**Problem:** Terminal operations (load from own terminal, discharge to own terminal) were filtered into a separate "Terminal Operations" section, away from their logical side.

**Before:**
```typescript
const buyDeals = deals.filter((d) => d.direction === "buy" && d.dealType !== "terminal_operation");
const sellDeals = deals.filter((d) => d.direction === "sell" && d.dealType !== "terminal_operation");
const terminalDeals = deals.filter((d) => d.dealType === "terminal_operation");
```

**After:**
```typescript
const buyDeals = deals.filter((d) => d.direction === "buy");
const sellDeals = deals.filter((d) => d.direction === "sell");
```

The separate "Terminal Operations" section (with the teal dot header and its rendering block) was also removed entirely.

**Rule going forward:** A deal's side is determined by `direction` only. `dealType` should never affect which side a deal appears on in the linkage view.
