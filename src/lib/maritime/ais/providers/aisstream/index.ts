/**
 * AisProvider implementation backed by AISStream data that the
 * background worker has persisted into Postgres.
 *
 * Architecture: the worker owns the WebSocket + raw ingest. This
 * provider is a pure READ layer — it never opens WebSockets or
 * writes anything. Same pattern as the weather NEFGO provider
 * (worker writes frames, provider reads).
 *
 * Consumers (API routes, Fleet UI hook) import this one file
 * and never touch Postgres directly.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import type { AisProvider } from "../../provider";
import type {
  AisSubscription,
  MMSI,
  VesselPosition,
  VesselSnapshot,
  VesselStatic,
} from "../../types";
import { NavStatus } from "../../types";

export class AisstreamProvider implements AisProvider {
  readonly name = "aisstream";

  /**
   * Return the latest snapshot per MMSI in the subscription. N+1 queries
   * (one per MMSI) rather than a single `DISTINCT ON` — we never track
   * more than ~200 MMSIs per tenant, so the simpler approach wins on
   * maintainability. Each query hits the `(mmsi, received_at DESC)`
   * composite index, so cost is O(log n) per lookup.
   *
   * Earlier versions used raw `DISTINCT ON` SQL, which occasionally 500'd
   * under drizzle's postgres-js array-parameter handling. The N+1
   * rewrite is defensive — reliable first, optimise if we ever actually
   * have ingest at scale.
   */
  async getSnapshots(sub: AisSubscription): Promise<VesselSnapshot[]> {
    const db = getDb();
    if (!sub.mmsis || sub.mmsis.length === 0) return [];
    const mmsis = sub.mmsis.map((m) => String(m));

    const now = Date.now();
    const results: VesselSnapshot[] = [];

    for (const mmsi of mmsis) {
      const [latestPos] = await db
        .select()
        .from(schema.vesselPositions)
        .where(eq(schema.vesselPositions.mmsi, mmsi))
        .orderBy(desc(schema.vesselPositions.receivedAt))
        .limit(1);

      if (!latestPos) continue; // No AIS fix yet for this MMSI.

      const [staticRow] = await db
        .select()
        .from(schema.vessels)
        .where(eq(schema.vessels.mmsi, mmsi))
        .limit(1);

      const position = rowToPosition(latestPos);
      const stat = staticRow
        ? rowToStatic(staticRow)
        : minimalStatic(mmsi, position.receivedAt);

      results.push({
        static: stat,
        position,
        ageMs: now - position.receivedAt.getTime(),
      });
    }

    return results;
  }

  async getStatic(mmsi: MMSI): Promise<VesselStatic | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.vessels)
      .where(eq(schema.vessels.mmsi, String(mmsi)))
      .limit(1);
    return row ? rowToStatic(row) : null;
  }

  async getTrack(
    mmsi: MMSI,
    from: Date,
    to: Date,
  ): Promise<VesselPosition[]> {
    const db = getDb();
    // Cap the returned rows to keep wire size manageable — UI can
    // paginate with smaller windows if it really needs more. 5000
    // rows is ~10 days at 1 position / 3 min.
    const rows = await db
      .select()
      .from(schema.vesselPositions)
      .where(
        and(
          eq(schema.vesselPositions.mmsi, String(mmsi)),
          sql`${schema.vesselPositions.receivedAt} >= ${from}`,
          sql`${schema.vesselPositions.receivedAt} <= ${to}`,
        ),
      )
      .orderBy(desc(schema.vesselPositions.receivedAt))
      .limit(5000);
    return rows.map(rowToPosition);
  }
}

// ---------------------------------------------------------------
// Row mappers — keep the decimal-string-to-number and varchar-to-number
// conversions isolated so consumers always see clean primitives.
// ---------------------------------------------------------------

function rowToPosition(row: schema.VesselPositionRow): VesselPosition {
  return {
    mmsi: Number(row.mmsi),
    lat: Number(row.lat),
    lon: Number(row.lon),
    cog: row.cog === null ? null : Number(row.cog),
    sog: row.sog === null ? null : Number(row.sog),
    heading: row.heading,
    navStatus: row.navStatus === null ? null : (row.navStatus as NavStatus),
    receivedAt: row.receivedAt,
  };
}

function rowToStatic(row: schema.Vessel): VesselStatic {
  return {
    mmsi: Number(row.mmsi),
    imo: row.imo === null ? null : Number(row.imo),
    name: row.name ?? "",
    callSign: row.callSign,
    shipType: row.shipType,
    lengthM: row.lengthM,
    beamM: row.beamM,
    draughtM: row.draughtM === null ? null : Number(row.draughtM),
    destination: row.destination,
    eta: row.eta,
    staticUpdatedAt: row.staticUpdatedAt,
  };
}

/** Placeholder identity when we have a position but no static yet —
 *  happens in the first minutes after a Q88 is uploaded and the
 *  worker sees a PositionReport before the ShipStaticData catches up. */
function minimalStatic(mmsi: string, firstSeen: Date): VesselStatic {
  return {
    mmsi: Number(mmsi),
    imo: null,
    name: "",
    callSign: null,
    shipType: null,
    lengthM: null,
    beamM: null,
    draughtM: null,
    destination: null,
    eta: null,
    staticUpdatedAt: firstSeen,
  };
}
