import { z } from "zod";
import type { DealStatus } from "@/lib/db/schema";

const directions = ["buy", "sell"] as const;
const incoterms = ["FOB", "CIF", "CFR", "DAP"] as const;
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

// IMPORTANT: every optional* preprocess preserves `undefined` (= "key absent
// in body, leave the column alone") and only coerces "" / null to null
// (= "operator explicitly cleared this"). See
// memory/feedback_zod_preserve_undefined.md — coercing undefined → null
// silently nukes columns on partial PUTs and has bitten us twice already
// (voyage timeline ETA preservation, deal pricing formula clobber).

const optionalPositiveNumber = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    return Number(val);
  },
  z.number().positive().nullable().optional()
);

const optionalDateString = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    return val;
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const optionalUuid = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    return val;
  },
  z.string().uuid().nullable().optional()
);

const optionalString = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    return val;
  },
  z.string().nullable().optional()
);

// === Zod Schemas ===

// One parcel inside a multi-grade deal. Single-parcel deals don't need to
// pass this — the API will synthesise one row from the deal-level
// product/quantityMt/contractedQty when omitted. Multi-parcel callers
// (e.g. the deal parser when it detects "ISOMERATE + REFORMATE") pass an
// array with one entry per grade.
export const parcelInputSchema = z.object({
  product: z.string().min(1).max(255),
  quantityMt: z.coerce.number().positive(),
  contractedQty: z.string().max(100).nullable().optional(),
});

export const createDealSchema = z
  .object({
    externalRef: z.string().max(100).nullable().optional(),
    linkageCode: z.string().max(100).nullable().optional(),
    linkageId: z.string().uuid().nullable().optional(),
    dealType: z.enum(["regular", "terminal_operation"]).optional().default("regular"),
    counterparty: z.string().min(1, "Counterparty is required").max(255),
    direction: z.enum(directions),
    product: z.string().min(1, "Product is required").max(255),
    quantityMt: z.coerce.number().positive("Quantity must be positive"),
    contractedQty: z.string().max(100).nullable().optional(),
    nominatedQty: optionalPositiveNumber,
    /**
     * Per-parcel breakdown for multi-grade deals. Optional — when omitted
     * the API treats this as a single-parcel deal and synthesises one
     * `deal_parcels` row from product/quantityMt/contractedQty. When
     * provided with 2+ entries the deal becomes multi-parcel and the
     * deal-level fields act as the denormalised summary (combined product
     * label, summed quantity, verbatim recap text).
     */
    parcels: z.array(parcelInputSchema).optional(),
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
      (val) => {
        if (val === undefined) return undefined;
        if (val === "" || val === null) return null;
        return val;
      },
      z.string().max(20).nullable().optional()
    ),
    pricingEstimatedDate: optionalDateString,
    loadedQuantityMt: optionalPositiveNumber,
    pricingPeriodType: optionalString,
    pricingPeriodValue: optionalString,
    pricingConfirmed: z.boolean().optional(),
    estimatedBlNorDate: optionalDateString,
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
      (val) => {
        if (val === undefined) return undefined;
        if (val === "" || val === null) return null;
        return val;
      },
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

// Coerce ISO 8601 timestamp strings (or empty/null) to Date / null. Used for
// the voyage-timeline arrival/departure fields, which the API passes straight
// through to drizzle's `timestamp({ withTimezone: true })` columns.
//
// IMPORTANT: undefined → undefined (NOT null). The voyage strip sends partial
// PUTs containing only the field the operator just edited; if undefined got
// coerced to null, every ETS edit would clobber arrivalAt and vice-versa.
// The deal route additionally strips undefined keys before drizzle .set().
const optionalTimestamp = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    if (val instanceof Date) return val;
    if (typeof val === "string") {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? val : d;
    }
    return val;
  },
  z.date().nullable().optional()
);

export const updateDealSchema = z.object({
  externalRef: z.string().max(100).nullable().optional(),
  linkageCode: z.string().max(100).nullable().optional(),
  linkageId: z.string().uuid().nullable().optional(),
  dealType: z.enum(["regular", "terminal_operation"]).optional(),
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
    (val) => {
      if (val === undefined) return undefined;
      if (val === "" || val === null) return null;
      return val;
    },
    z.string().max(20).nullable().optional()
  ),
  pricingEstimatedDate: optionalDateString,
  loadedQuantityMt: optionalPositiveNumber,
  pricingPeriodType: optionalString,
  pricingPeriodValue: optionalString,
  pricingConfirmed: z.boolean().optional(),
  estimatedBlNorDate: optionalDateString,
  specialInstructions: optionalString,
  // Voyage-timeline events. arrivalAt = ETA at this deal's port; flips to
  // ATA semantically when arrivalIsActual = true (same column, just a flag).
  // departureOverride pins ETS manually when the operator wants to bypass
  // the auto-computed `arrival + qty / port-rate + MIN_BERTH_SETUP_HOURS`.
  arrivalAt: optionalTimestamp,
  arrivalIsActual: z.boolean().optional(),
  departureOverride: optionalTimestamp,
  version: z.number().int().positive("Version is required for optimistic locking"),
});

export const dealFilterSchema = z.object({
  status: z.enum(statuses).optional(),
  direction: z.enum(directions).optional(),
  incoterm: z.enum(incoterms).optional(),
  counterparty: z.string().optional(),
  linkageCode: z.string().optional(),
  linkageId: z.string().uuid().optional(),
  assignedOperatorId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  // Bumped from 100 → 500 because the spreadsheet view and the parser's
  // duplicate-check both call `/api/deals?perPage=200` to render the full
  // operator workspace in one shot rather than paginating. 500 keeps the
  // upper bound generous for export but well short of "unbounded".
  perPage: z.coerce.number().int().positive().max(500).default(25),
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
export type ParcelInput = z.infer<typeof parcelInputSchema>;
