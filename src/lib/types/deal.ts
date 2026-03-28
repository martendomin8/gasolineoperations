import { z } from "zod";
import type { DealStatus } from "@/lib/db/schema";

const directions = ["buy", "sell"] as const;
const incoterms = ["FOB", "CIF", "CFR", "DAP", "FCA"] as const;
const statuses = ["draft", "active", "loading", "sailing", "discharging", "completed", "cancelled"] as const;

// === Status State Machine (Niles pattern) ===
export const VALID_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["loading", "cancelled"],
  loading: ["sailing", "cancelled"],
  sailing: ["discharging", "cancelled"],
  discharging: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isValidTransition(from: DealStatus, to: DealStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// === Zod Schemas ===

export const createDealSchema = z
  .object({
    externalRef: z.string().max(100).nullable().optional(),
    counterparty: z.string().min(1, "Counterparty is required").max(255),
    direction: z.enum(directions),
    product: z.string().min(1, "Product is required").max(255),
    quantityMt: z.coerce.number().positive("Quantity must be positive"),
    incoterm: z.enum(incoterms),
    loadport: z.string().min(1, "Loadport is required").max(255),
    dischargePort: z.string().min(1, "Discharge port is required").max(255),
    laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    vesselName: z.string().max(255).nullable().optional(),
    vesselImo: z.string().max(20).nullable().optional(),
    assignedOperatorId: z.string().uuid().nullable().optional(),
    pricingFormula: z.string().nullable().optional(),
    specialInstructions: z.string().nullable().optional(),
    sourceRawText: z.string().nullable().optional(),
  })
  .refine(
    (data) => data.laycanEnd >= data.laycanStart,
    { message: "Laycan end must be on or after laycan start", path: ["laycanEnd"] }
  );

export const updateDealSchema = z.object({
  externalRef: z.string().max(100).nullable().optional(),
  counterparty: z.string().min(1).max(255).optional(),
  direction: z.enum(directions).optional(),
  product: z.string().min(1).max(255).optional(),
  quantityMt: z.coerce.number().positive().optional(),
  incoterm: z.enum(incoterms).optional(),
  loadport: z.string().min(1).max(255).optional(),
  dischargePort: z.string().min(1).max(255).optional(),
  laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vesselName: z.string().max(255).nullable().optional(),
  vesselImo: z.string().max(20).nullable().optional(),
  vesselCleared: z.boolean().optional(),
  docInstructionsReceived: z.boolean().optional(),
  status: z.enum(statuses).optional(),
  assignedOperatorId: z.string().uuid().nullable().optional(),
  pricingFormula: z.string().nullable().optional(),
  specialInstructions: z.string().nullable().optional(),
  version: z.number().int().positive("Version is required for optimistic locking"),
});

export const dealFilterSchema = z.object({
  status: z.enum(statuses).optional(),
  direction: z.enum(directions).optional(),
  incoterm: z.enum(incoterms).optional(),
  counterparty: z.string().optional(),
  assignedOperatorId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(25),
});

// Fields that trigger re-notification checks when changed (Phase 4)
export const RE_NOTIFICATION_FIELDS = [
  "vesselName",
  "vesselImo",
  "quantityMt",
  "laycanStart",
  "laycanEnd",
  "loadport",
  "dischargePort",
  "product",
] as const;

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealFilter = z.infer<typeof dealFilterSchema>;
