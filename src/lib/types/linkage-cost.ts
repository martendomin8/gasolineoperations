import { z } from "zod";

// Categories the operator can pick from in the "+ Add cost" dropdown.
// Plain string list (not a pg enum) so we can extend without a migration.
export const LINKAGE_COST_CATEGORIES = [
  "demurrage",
  "freight",
  "full_speed",
  "port_costs",
  "agency",
  "inspector",
  "superintendent",
  "custom",
] as const;

export type LinkageCostCategory = (typeof LINKAGE_COST_CATEGORIES)[number];

const optionalDecimal = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    if (typeof val === "number") return val.toFixed(2);
    return String(val);
  },
  z.string().nullable().optional()
);

const optionalString = z.preprocess(
  (val) => (val === undefined ? undefined : val === "" || val === null ? null : val),
  z.string().nullable().optional()
);

export const createLinkageCostSchema = z.object({
  category: z.enum(LINKAGE_COST_CATEGORIES),
  description: optionalString,
  estimatedAmount: optionalDecimal,
  actualAmount: optionalDecimal,
  currency: z.string().length(3).default("USD"),
  portName: z.string().max(255).nullable().optional(),
  notes: optionalString,
  sortOrder: z.number().int().optional(),
});

export const updateLinkageCostSchema = z.object({
  category: z.enum(LINKAGE_COST_CATEGORIES).optional(),
  description: optionalString,
  estimatedAmount: optionalDecimal,
  actualAmount: optionalDecimal,
  currency: z.string().length(3).optional(),
  portName: z.string().max(255).nullable().optional(),
  notes: optionalString,
  sortOrder: z.number().int().optional(),
  version: z.number().int().positive("Version is required for optimistic locking"),
});

export type CreateLinkageCostInput = z.infer<typeof createLinkageCostSchema>;
export type UpdateLinkageCostInput = z.infer<typeof updateLinkageCostSchema>;
