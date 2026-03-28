import { z } from "zod";

const partyTypes = ["terminal", "agent", "inspector", "broker"] as const;

export const createPartySchema = z.object({
  type: z.enum(partyTypes),
  name: z.string().min(1, "Name is required").max(255),
  port: z.string().max(255).nullable().optional(),
  email: z.string().email("Invalid email").max(255).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  isFixed: z.boolean().default(false),
});

export const updatePartySchema = createPartySchema.partial().extend({
  version: z.number().int().positive("Version is required for optimistic locking"),
});

export const partyFilterSchema = z.object({
  type: z.enum(partyTypes).optional(),
  port: z.string().optional(),
  search: z.string().optional(),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
export type PartyFilter = z.infer<typeof partyFilterSchema>;
