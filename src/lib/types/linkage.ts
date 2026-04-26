import { z } from "zod";

// Coerce empty strings to null for optional UUID fields (forms send "" for "none")
// Preserve undefined (= "key absent") so partial PUTs don't NULL out
// fields the operator never touched. See memory/feedback_zod_preserve_undefined.md.
const optionalUuid = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === "" || val === null) return null;
    return val;
  },
  z.string().uuid().nullable().optional()
);

export const createLinkageSchema = z.object({
  linkageNumber: z.string().max(100).nullable().optional(),
  vesselName: z.string().max(255).nullable().optional(),
  product: z.string().max(255).nullable().optional(),
  notes: z.string().nullable().optional(),
  assignedOperatorId: optionalUuid,
  secondaryOperatorId: optionalUuid,
});

// vesselParticulars is a free-form JSONB blob populated by the Q88 parser.
// Validation is deliberately loose — the shape is still evolving and any
// operator-confirmed partials are better than rejecting the update.
const vesselParticularsSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional();

export const updateLinkageSchema = z.object({
  linkageNumber: z.string().max(100).nullable().optional(),
  // Voyage-state intermediate values (loading / sailing / discharging) are
  // now derived from arrival/departure timestamps via deriveVoyageState —
  // operators no longer set them manually. The only manual transition that
  // remains is "active" ↔ "completed" (archive flag). Old DB rows with
  // intermediate values still exist; they're treated as "active" by every
  // consumer so no data migration is required.
  status: z.enum(["active", "completed"]).optional(),
  vesselName: z.string().max(255).nullable().optional(),
  vesselImo: z.string().max(20).nullable().optional(),
  // MMSI — the 9-digit AIS identifier. Required for live tracking but
  // still optional on the linkage (some vessels have only IMO in their
  // Q88, or the operator is tracking a dry deal before the vessel is
  // even named). The AIS ingest worker filters out malformed MMSIs at
  // runtime, so even a bad operator entry can't corrupt the subscription.
  vesselMmsi: z.string().max(15).nullable().optional(),
  vesselParticulars: vesselParticularsSchema,
  assignedOperatorId: optionalUuid,
  secondaryOperatorId: optionalUuid,
  notes: z.string().nullable().optional(),
  // CP-warranted speed override. When the parser hasn't filled this from
  // CP recap / Q88, the operator can type it in; cpSpeedSource = 'manual'
  // disambiguates from parser-derived values for the voyage-bar badge
  // ("13.5 kn — from addendum" vs "12 kn — manual").
  cpSpeedKn: z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === "" || val === null) return null;
      return Number(val);
    },
    z.number().positive().max(25).nullable().optional()
  ),
  cpSpeedSource: z.enum(["cp_clause", "q88", "manual"]).nullable().optional(),
  // Freight commission toggles. Flip + edit-pct lets the operator deduct
  // address commission (default ON, 2.5%) and brokerage (default OFF,
  // 1.25%) from the freight line. Address commission is normal practice;
  // brokerage is rare (recap usually puts it on owner) but the operator
  // can switch it on when the recap explicitly assigns it to charterers.
  freightDeductAddressCommission: z.boolean().optional(),
  freightAddressCommissionPct: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : String(val)),
    z.string().optional()
  ),
  freightDeductBrokerage: z.boolean().optional(),
  freightBrokeragePct: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : String(val)),
    z.string().optional()
  ),
});

export type CreateLinkageInput = z.infer<typeof createLinkageSchema>;
export type UpdateLinkageInput = z.infer<typeof updateLinkageSchema>;
