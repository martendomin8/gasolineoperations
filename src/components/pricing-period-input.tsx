"use client";

// PricingPeriodInput — structured BL / NOR / Fixed / EFP pricing editor.
//
// Replaces the older free-text "Period Value" field that let operators type
// e.g. "0-1-5" but also let them forget to set the period type at all,
// which produced deals with `pricingFormula = "Fixed pricing"` and both
// `pricingPeriodType` + `pricingPeriodValue` null. The Excel grid then
// rendered an em-dash because it only reads structured fields.
//
// UI shape (per Arne 2026-04-26):
//   Period type: [BL ▾]
//                ┌──┐ ┌──┐ ┌──┐
//                │ 0│-│ 1│-│ 5│   days before · on · after
//                └──┘ └──┘ └──┘
//   - BL or NOR   → 3 numeric slots, each 0–99. Middle slot constrained to
//                   0 or 1 (the BL date itself; pricing either runs on
//                   that day or skips it).
//   - Fixed       → free text (date range, e.g. "1-30 APR")
//   - EFP         → no value field
//   - Empty type  → no value field

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export type PricingPeriodType = "BL" | "NOR" | "Fixed" | "EFP" | "";

export interface PricingPeriodInputProps {
  type: PricingPeriodType;
  value: string;
  onChange: (next: { type: PricingPeriodType; value: string }) => void;
  /** When the field is part of a parser-confirm modal we surface the
   *  AI's confidence next to the dropdown. Optional. */
  typeConfidence?: number;
  valueConfidence?: number;
  /** Optional id — used to tie the labels to the inputs for screen readers. */
  idPrefix?: string;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: PricingPeriodType; label: string }> = [
  { value: "", label: "—" },
  { value: "BL", label: "BL" },
  { value: "NOR", label: "NOR" },
  { value: "Fixed", label: "Fixed" },
  { value: "EFP", label: "EFP" },
];

function parseSlots(value: string): [string, string, string] {
  // "0-1-5" → ["0","1","5"]; missing slots stay empty.
  const m = value.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  if (m) return [m[1], m[2], m[3]];
  return ["", "", ""];
}

function joinSlots(a: string, b: string, c: string): string {
  if (!a && !b && !c) return "";
  return `${a || "0"}-${b || "0"}-${c || "0"}`;
}

export function PricingPeriodInput({
  type,
  value,
  onChange,
  idPrefix = "pp",
}: PricingPeriodInputProps) {
  const [a, b, c] = parseSlots(value);
  const [slotA, setSlotA] = useState(a);
  const [slotB, setSlotB] = useState(b);
  const [slotC, setSlotC] = useState(c);

  // Sync slot drafts when an external change rewrites `value` (e.g. parent
  // resets to the parser's original output). We re-derive from `value`
  // rather than maintaining our own truth so the editor stays controlled.
  useEffect(() => {
    const [na, nb, nc] = parseSlots(value);
    setSlotA(na);
    setSlotB(nb);
    setSlotC(nc);
  }, [value]);

  const handleType = (newType: PricingPeriodType) => {
    // When switching INTO BL/NOR from a free-text type, try to keep the
    // existing value if it's already in X-X-X shape; otherwise reset.
    if (newType === "BL" || newType === "NOR") {
      const [na, nb, nc] = parseSlots(value);
      const preserved = joinSlots(na, nb, nc);
      onChange({ type: newType, value: preserved });
    } else if (newType === "EFP") {
      onChange({ type: newType, value: "" });
    } else {
      onChange({ type: newType, value });
    }
  };

  const handleSlot = (idx: 0 | 1 | 2, raw: string) => {
    // Strip non-digits, cap length at 2.
    const sanitized = raw.replace(/\D/g, "").slice(0, 2);
    let v = sanitized;
    if (idx === 1) {
      // Middle slot is the BL date itself — only 0 or 1 makes sense.
      const n = parseInt(sanitized, 10);
      if (Number.isFinite(n) && n > 1) v = "1";
    }
    const next: [string, string, string] =
      idx === 0 ? [v, slotB, slotC] : idx === 1 ? [slotA, v, slotC] : [slotA, slotB, v];
    if (idx === 0) setSlotA(v);
    if (idx === 1) setSlotB(v);
    if (idx === 2) setSlotC(v);
    onChange({ type, value: joinSlots(...next) });
  };

  const handleFreeText = (raw: string) => {
    onChange({ type, value: raw });
  };

  const isStructured = type === "BL" || type === "NOR";
  const isFixed = type === "Fixed";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`${idPrefix}-type`}
          className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] w-28"
        >
          Pricing period
        </label>
        <div className="relative">
          <select
            id={`${idPrefix}-type`}
            value={type}
            onChange={(e) => handleType(e.target.value as PricingPeriodType)}
            className="appearance-none bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2.5 pr-7 py-1 text-sm text-[var(--color-text-primary)] cursor-pointer hover:border-[var(--color-border-default)]"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-tertiary)] pointer-events-none" />
        </div>
      </div>

      {isStructured && (
        <div className="flex items-center gap-2 pl-[7.5rem]">
          <SlotInput
            id={`${idPrefix}-a`}
            value={slotA}
            placeholder="0"
            onChange={(v) => handleSlot(0, v)}
          />
          <span className="text-[var(--color-text-tertiary)]">-</span>
          <SlotInput
            id={`${idPrefix}-b`}
            value={slotB}
            placeholder="0"
            onChange={(v) => handleSlot(1, v)}
            // Visual hint that this slot is constrained to 0/1.
            hint="0/1"
          />
          <span className="text-[var(--color-text-tertiary)]">-</span>
          <SlotInput
            id={`${idPrefix}-c`}
            value={slotC}
            placeholder="0"
            onChange={(v) => handleSlot(2, v)}
          />
          <span className="text-[10px] text-[var(--color-text-tertiary)] ml-2 italic">
            days before · on · after {type === "BL" ? "B/L" : "NOR"}
          </span>
        </div>
      )}

      {isFixed && (
        <div className="flex items-center gap-2 pl-[7.5rem]">
          <input
            id={`${idPrefix}-fixed`}
            type="text"
            value={value}
            onChange={(e) => handleFreeText(e.target.value)}
            placeholder="e.g. 1-30 APR"
            className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] w-40"
          />
          <span className="text-[10px] text-[var(--color-text-tertiary)] italic">
            date range
          </span>
        </div>
      )}

      {type === "EFP" && (
        <div className="pl-[7.5rem] text-[10px] text-[var(--color-text-tertiary)] italic">
          EFP pricing — no period value, freight settles on exchange.
        </div>
      )}
    </div>
  );
}

function SlotInput({
  id,
  value,
  placeholder,
  onChange,
  hint,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-12 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded px-2 py-1 text-center text-base font-mono tabular-nums text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30"
      />
      {hint && (
        <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8.5px] text-[var(--color-text-tertiary)] whitespace-nowrap">
          {hint}
        </span>
      )}
    </div>
  );
}
