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

// === Zod helpers ===

// Coerce empty strings to null for optional numeric fields
const optionalPositiveNumber = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
  z.number().positive().nullable().optional()
);

// Coerce empty strings to null for optional date fields
const optionalDateString = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? null : val),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

// Coerce empty strings to null for optional UUID fields
const optionalUuid = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? null : val),
  z.string().uuid().nullable().optional()
);

// Coerce empty strings to null for optional string fields
const optionalString = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? null : val),
  z.string().nullable().optional()
);

// === Zod Schemas ===

export const createDealSchema = z
  .object({
    externalRef: z.string().max(100).nullable().optional(),
    linkageCode: z.string().max(100).nullable().optional(),
    counterparty: z.string().min(1, "Counterparty is required").max(255),
    direction: z.enum(directions),
    product: z.string().min(1, "Product is required").max(255),
    quantityMt: z.coerce.number().positive("Quantity must be positive"),
    contractedQty: z.string().max(100).nullable().optional(),
    nominatedQty: optionalPositiveNumber,
    incoterm: z.enum(incoterms),
    loadport: z.string().min(1, "Loadport is required").max(255),
    dischargePort: z.string().max(255).nullable().optional(),
    laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    vesselName: z.string().max(255).nullable().optional(),
    vesselImo: z.string().max(20).nullable().optional(),
    assignedOperatorId: optionalUuid,
    secondaryOperatorId: optionalUuid,
    pricingFormula: optionalString,
    pricingType: z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : val),
      z.string().max(20).nullable().optional()
    ),
    pricingEstimatedDate: optionalDateString,
    specialInstructions: optionalString,
    sourceRawText: optionalString,
  })
  .refine(
    (data) => data.laycanEnd >= data.laycanStart,
    { message: "Laycan end must be on or after laycan start", path: ["laycanEnd"] }
  );

/**
 * Relaxed schema for Excel import — product is optional (not in their Excel),
 * defaults to empty string so it can be filled later.
 */
export const importDealSchema = z
  .object({
    externalRef: z.string().max(100).nullable().optional(),
    linkageCode: z.string().max(100).nullable().optional(),
    counterparty: z.string().min(1, "Counterparty is required").max(255),
    direction: z.enum(directions),
    product: z.string().max(255).optional().default(""),
    quantityMt: z.coerce.number().positive("Quantity must be positive"),
    contractedQty: z.string().max(100).nullable().optional(),
    nominatedQty: optionalPositiveNumber,
    incoterm: z.enum(incoterms),
    loadport: z.string().min(1, "Loadport is required").max(255),
    dischargePort: z.string().max(255).nullable().optional(),
    laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    vesselName: z.string().max(255).nullable().optional(),
    vesselImo: z.string().max(20).nullable().optional(),
    assignedOperatorId: optionalUuid,
    secondaryOperatorId: optionalUuid,
    pricingFormula: optionalString,
    pricingType: z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? null : val),
      z.string().max(20).nullable().optional()
    ),
    pricingEstimatedDate: optionalDateString,
    specialInstructions: optionalString,
    sourceRawText: optionalString,
  })
  .refine(
    (data) => data.laycanEnd >= data.laycanStart,
    { message: "Laycan end must be on or after laycan start", path: ["laycanEnd"] }
  );

export const updateDealSchema = z.object({
  externalRef: z.string().max(100).nullable().optional(),
  linkageCode: z.string().max(100).nullable().optional(),
  counterparty: z.string().min(1).max(255).optional(),
  direction: z.enum(directions).optional(),
  product: z.string().min(1).max(255).optional(),
  quantityMt: z.coerce.number().positive().optional(),
  contractedQty: z.string().max(100).nullable().optional(),
  nominatedQty: optionalPositiveNumber,
  incoterm: z.enum(incoterms).optional(),
  loadport: z.string().min(1).max(255).optional(),
  dischargePort: z.string().max(255).nullable().optional(),
  laycanStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  laycanEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vesselName: z.string().max(255).nullable().optional(),
  vesselImo: z.string().max(20).nullable().optional(),
  vesselCleared: z.boolean().optional(),
  docInstructionsReceived: z.boolean().optional(),
  status: z.enum(statuses).optional(),
  assignedOperatorId: optionalUuid,
  secondaryOperatorId: optionalUuid,
  pricingFormula: optionalString,
  pricingType: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? null : val),
    z.string().max(20).nullable().optional()
  ),
  pricingEstimatedDate: optionalDateString,
  specialInstructions: optionalString,
  version: z.number().int().positive("Version is required for optimistic locking"),
});

export const dealFilterSchema = z.object({
  status: z.enum(statuses).optional(),
  direction: z.enum(directions).optional(),
  incoterm: z.enum(incoterms).optional(),
  counterparty: z.string().optional(),
  linkageCode: z.string().optional(),
  assignedOperatorId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(25),
});

// Fields that trigger re-notification checks when changed
export const RE_NOTIFICATION_FIELDS = [
  "vesselName",
  "vesselImo",
  "quantityMt",
  "nominatedQty",
  "laycanStart",
  "laycanEnd",
  "loadport",
  "dischargePort",
  "product",
] as const;

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type ImportDealInput = z.infer<typeof importDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealFilter = z.infer<typeof dealFilterSchema>;
