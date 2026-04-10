import { z } from "zod";

export const createLinkageSchema = z.object({
  linkageNumber: z.string().max(100).nullable().optional(),
  vesselName: z.string().max(255).nullable().optional(),
  product: z.string().max(255).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updateLinkageSchema = z.object({
  linkageNumber: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "completed"]).optional(),
  vesselName: z.string().max(255).nullable().optional(),
  vesselImo: z.string().max(20).nullable().optional(),
});

export type CreateLinkageInput = z.infer<typeof createLinkageSchema>;
export type UpdateLinkageInput = z.infer<typeof updateLinkageSchema>;
