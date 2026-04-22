/**
 * Layer 6 — Audit trail writer.
 *
 * Every flag raised by the validation stack lands in
 * `ais_validation_flags` so an operator can see WHY a position was
 * rejected / warned, and dismiss false positives.
 *
 * Kept as a small stand-alone module so the worker's hot path can
 * batch writes alongside its position/static batches, and so the
 * retroactive validator (a future feature that re-checks historical
 * data) can reuse the same insert function.
 */

import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NewAisValidationFlag } from "@/lib/db/schema";
import { aisValidationFlags } from "@/lib/db/schema";
import type { Flag } from "./types";

/**
 * Translate an in-memory `Flag` into an insert row. Separate from the
 * DB call so tests can assert on the row shape without needing a DB.
 */
export function toFlagRow(mmsi: string, flag: Flag): NewAisValidationFlag {
  return {
    mmsi,
    layer: flag.layer,
    flagType: flag.type,
    severity: flag.severity,
    details: flag.details,
    messageReceivedAt: flag.messageReceivedAt,
  };
}

/**
 * Insert a batch of flags. Caller is responsible for batching to
 * avoid per-message DB round-trips. `db` is typed loosely so the
 * worker can pass its own postgres-js connection and the API routes
 * can pass the shared app DB.
 */
export async function writeFlags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PgDatabase<any, any, any>,
  mmsi: string,
  flags: Flag[],
): Promise<void> {
  if (flags.length === 0) return;
  const rows = flags.map((f) => toFlagRow(mmsi, f));
  await db.insert(aisValidationFlags).values(rows);
}
