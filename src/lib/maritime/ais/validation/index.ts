/**
 * AIS validation stack — public entry point.
 *
 * The orchestrator runs every layer, aggregates flags, and returns a
 * single `ValidationResult`. Layers are deliberately decoupled: each
 * one is a pure function that takes inputs + context and returns
 * `Flag[]`. The orchestrator just concatenates.
 *
 * The worker calls `validateIncomingMessage()` per AIS packet. Other
 * callers (API routes that accept operator-entered positions, a
 * future retroactive validator) can call individual layers directly.
 *
 * See `docs/AIS-LIVE-TRACKING-SPEC.md` §9a for the layered model.
 */

import type { Flag, ValidationResult } from "./types";
import { checkSanity, type SanityInput } from "./sanity";
import { checkTemporal, type TemporalInput } from "./temporal";
import { checkIdentity, type IdentityInput } from "./identity";
import { checkAnomaly, type AnomalyInput } from "./anomaly";
import { checkBusiness, type BusinessInput } from "./business-rules";

export type { Flag, FlagSeverity, FlagType, ValidationLayer, ValidationResult } from "./types";
export { checkSanity } from "./sanity";
export { checkTemporal } from "./temporal";
export { checkIdentity } from "./identity";
export { checkAnomaly } from "./anomaly";
export { checkBusiness } from "./business-rules";
export { toFlagRow, writeFlags } from "./audit";

/** Everything a validation pass might need. Individual layers pluck
 *  what they need — the temporal layer reads `priorPosition`, identity
 *  reads `linkage`, anomaly reads `sanctionedZones` etc. */
export interface ValidationContext {
  sanity: SanityInput;
  temporal: TemporalInput | null;     // null if no prior position known
  identity: IdentityInput | null;     // null if message is not tied to a linkage
  anomaly: AnomalyInput | null;
  business: BusinessInput | null;
}

/**
 * Run the whole stack. Any layer can set `accept: false` via a 'reject'
 * flag, but we still run downstream layers so the operator gets the
 * full picture in the audit trail ("this was rejected AND also flagged
 * for being off-route") rather than a single reason that depends on
 * ordering.
 */
export function validateMessage(ctx: ValidationContext): ValidationResult {
  const flags: Flag[] = [];

  flags.push(...checkSanity(ctx.sanity));
  if (ctx.temporal !== null) flags.push(...checkTemporal(ctx.temporal));
  if (ctx.identity !== null) flags.push(...checkIdentity(ctx.identity));
  if (ctx.anomaly !== null) flags.push(...checkAnomaly(ctx.anomaly));
  if (ctx.business !== null) flags.push(...checkBusiness(ctx.business));

  const accept = !flags.some((f) => f.severity === "reject");
  return { accept, flags };
}
