/**
 * AIS ingest worker — long-running standalone Node.js process.
 *
 * Responsibilities:
 *   1. Load the current MMSI watchlist from the `linkages` table.
 *   2. Subscribe to AISStream.io over WebSocket, filtered to those MMSIs.
 *   3. Buffer incoming messages; flush to Postgres every 2 s in batches.
 *   4. Upsert `vessels` (static data) and insert into `vessel_positions`
 *      (time series).
 *   5. Refresh the watchlist every 60 s so newly added linkages appear
 *      without restarting the worker.
 *   6. Reconnect with exponential back-off if the WS drops.
 *   7. Shutdown cleanly on SIGINT / SIGTERM (flush pending batches first).
 *
 * NOT Next.js. Runs as its own process under Railway (production) or
 * `npm run ais:dev` (local). See `docs/AIS-LIVE-TRACKING-SPEC.md` §3.2.
 */

import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, isNotNull } from "drizzle-orm";
import * as schema from "../../src/lib/db/schema";
import {
  checkSanity,
  checkTemporal,
  checkIdentity,
  checkAnomaly,
  toFlagRow,
} from "../../src/lib/maritime/ais/validation";
import type { Flag } from "../../src/lib/maritime/ais/validation";
// Note: `checkBusiness` (L5) is NOT imported here. L5 needs voyage context
// (laycan, CP speed, route coords) that lives behind joins and port-name
// lookups — running it in the API layer at read time keeps the worker
// hot path cheap. See docs/AIS-LIVE-TRACKING-SPEC.md §9a.

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const AIS_ENDPOINT = "wss://stream.aisstream.io/v0/stream";
const FLUSH_INTERVAL_MS = 2_000;
const WATCHLIST_REFRESH_MS = 60_000;
const HEARTBEAT_MS = 60_000;
/** L4 anomaly checks scan every tracked MMSI on this cadence — not per
 *  message, since the question is "have we STOPPED hearing from X?". */
const ANOMALY_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Retention sweep — trim old positions + acknowledged flags to keep
 *  the hot tables small. Runs daily. Window matches spec §8 decision. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const POSITION_RETENTION_DAYS = 14;
const FLAG_RETENTION_DAYS = 30;   // Ack'd flags kept a bit longer for audit.
/** Initial reconnect delay; doubles on each failure up to `RECONNECT_MAX_MS`. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** We care about these three — enough to track position, identity, and
 *  static particulars. Skip DataLinkManagementMessage etc. to cut noise. */
const SUBSCRIBED_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ShipStaticData",
] as const;

// ---------------------------------------------------------------
// Env loading — avoid adding a dotenv dependency
// ---------------------------------------------------------------

function loadEnv() {
  // `.env.local` exists on a developer's laptop (where the worker runs
  // via `npm run ais:dev`). On Railway — or any other production host —
  // env vars come from the platform's injected environment, so the file
  // is absent and that's fine. Only complain if the required variables
  // themselves are unset (see the two checks after this call).
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!process.env[key]) process.env[key] = value.trim();
  }
}

loadEnv();

const apiKey = process.env.AISSTREAM_API_KEY;
if (!apiKey) throw new Error("AISSTREAM_API_KEY is not set (check .env.local in dev or Railway Variables in prod)");
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is not set (check .env.local in dev or Railway Variables in prod)");

// ---------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------

// `max: 2` — worker does two things: reads watchlist, writes batches. A
// tiny pool is plenty; we never hold many concurrent queries. SSL required
// on Neon (which is what DATABASE_URL points at in our stack).
const sqlClient = postgres(dbUrl, {
  max: 2,
  idle_timeout: 30,
  connect_timeout: 10,
  ssl: dbUrl.includes("neon.tech") ? "require" : false,
});
const db = drizzle(sqlClient, { schema });

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

/** MMSIs we care about — refreshed from DB every 60 s. */
let watchlist = new Set<string>();
/** Pending position rows to insert, keyed by `${mmsi}|${ts}` to dedup
 *  the same packet arriving via multiple receivers. */
const positionBatch = new Map<string, schema.NewVesselPositionRow>();
/** Pending vessel upserts — only one per MMSI (newest wins per batch). */
const vesselBatch = new Map<string, schema.NewVessel>();
/** Pending validation flag inserts — every reject / warn / info from L1-L5. */
const flagBatch: schema.NewAisValidationFlag[] = [];
/**
 * Cache of the last accepted position per MMSI — fuels L2 temporal checks
 * without a DB round-trip per incoming message. Populated on first accepted
 * position; evicted only on worker restart (memory bounded by watchlist size).
 */
const lastAcceptedPosition = new Map<
  string,
  { lat: number; lon: number; sog: number | null; receivedAt: Date }
>();
/**
 * Cache of linkage identity (for L3 identity checks) keyed by MMSI.
 * Refreshed every 60 s alongside the watchlist. L5 business-rule checks
 * need richer context (laycan, CP speed, route coords) that lives behind
 * joins and port-name lookups — those run in the API layer at read time,
 * not in the worker's hot path. See docs/AIS-LIVE-TRACKING-SPEC.md §9a.
 */
interface LinkageIdentity {
  name: string | null;
  imo: string | null;
  lengthM: number | null;
  beamM: number | null;
}
const linkageByMmsi = new Map<string, LinkageIdentity>();
let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_BASE_MS;
let shuttingDown = false;
let messagesSinceHeartbeat = 0;
let writesSinceHeartbeat = 0;
let flagsSinceHeartbeat = 0;
let rejectsSinceHeartbeat = 0;

// ---------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------

/**
 * MMSI format check. The ITU-R M.1371 standard says MMSI is exactly 9
 * decimal digits; anything else is a typo, a call sign mistakenly
 * entered in the MMSI field, or junk from a bad Q88 parse. We filter
 * these out before they hit the AISStream subscription — a single
 * malformed entry in `FiltersShipMMSI` can get the whole subscription
 * rejected, which would silently break live tracking for every
 * correctly-configured linkage.
 */
function isValidMmsi(s: string): boolean {
  return /^\d{9}$/.test(s);
}

async function refreshWatchlist(): Promise<void> {
  // Pull MMSI + identity fields together so L3 identity checks don't need
  // per-message DB lookups. `vesselParticulars` is a JSONB blob from the
  // Q88 parser; we only need length/beam off it.
  const rows = await db
    .select({
      mmsi: schema.linkages.vesselMmsi,
      name: schema.linkages.vesselName,
      imo: schema.linkages.vesselImo,
      particulars: schema.linkages.vesselParticulars,
    })
    .from(schema.linkages)
    .where(isNotNull(schema.linkages.vesselMmsi));

  const next = new Set<string>();
  const rejected: string[] = [];
  linkageByMmsi.clear();
  for (const row of rows) {
    if (row.mmsi === null) continue;
    const candidate = row.mmsi.trim();
    if (candidate.length === 0) continue;
    if (!isValidMmsi(candidate)) {
      rejected.push(candidate);
      continue;
    }
    next.add(candidate);
    linkageByMmsi.set(candidate, {
      name: row.name,
      imo: row.imo,
      lengthM: row.particulars?.loa ?? null,
      beamM: row.particulars?.beam ?? null,
    });
  }

  if (rejected.length > 0) {
    console.warn(
      `[watchlist] rejected ${rejected.length} invalid MMSI(s): ${rejected.slice(0, 5).join(", ")}${rejected.length > 5 ? "…" : ""}. Fix the linkage(s) — AIS requires exactly 9 digits.`,
    );
  }

  const added = [...next].filter((m) => !watchlist.has(m));
  const removed = [...watchlist].filter((m) => !next.has(m));
  const wasEmpty = watchlist.size === 0;

  if (added.length > 0 || removed.length > 0 || wasEmpty) {
    console.log(
      `[watchlist] ${next.size} MMSIs tracked` +
        (added.length > 0 ? ` · +${added.length}` : "") +
        (removed.length > 0 ? ` · -${removed.length}` : ""),
    );
  }

  watchlist = next;

  // Three state transitions to handle:
  //   empty → non-empty : open WS (was idle waiting)
  //   non-empty → empty : close WS (don't spam AISStream with reconnects)
  //   non-empty → non-empty (list changed) : resubscribe on existing WS
  if (wasEmpty && next.size > 0) {
    openWs();
  } else if (!wasEmpty && next.size === 0) {
    console.log("[watchlist] emptied — closing WS");
    if (ws !== null) {
      ws.close();
      ws = null;
    }
  } else if (
    ws !== null &&
    ws.readyState === WebSocket.OPEN &&
    (added.length > 0 || removed.length > 0)
  ) {
    sendSubscription();
  }
}

// ---------------------------------------------------------------
// WebSocket subscription
// ---------------------------------------------------------------

function sendSubscription(): void {
  if (ws === null || ws.readyState !== WebSocket.OPEN) return;
  // Guard: empty watchlist = no subscription. We keep the WS open but
  // AISStream sends us nothing until a linkage gets a Q88 with an MMSI
  // and the next `refreshWatchlist` picks it up. Without this guard,
  // an empty-watchlist subscription with a worldwide bbox would flood
  // us with ~1000 msg/s of global traffic we'd immediately filter out.
  if (watchlist.size === 0) {
    console.log("[ws] watchlist empty — not subscribing");
    return;
  }
  // AISStream requires a BoundingBox (worldwide is fine when we're
  // pairing it with an MMSI filter).
  const sub = {
    APIKey: apiKey!,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FilterMessageTypes: [...SUBSCRIBED_TYPES],
    FiltersShipMMSI: [...watchlist],
  };
  ws.send(JSON.stringify(sub));
  console.log(`[ws] subscribed · ${watchlist.size} MMSIs · ${SUBSCRIBED_TYPES.length} types`);
}

function openWs(): void {
  if (shuttingDown) return;
  ws = new WebSocket(AIS_ENDPOINT);

  ws.on("open", () => {
    console.log("[ws] connection open");
    reconnectDelay = RECONNECT_BASE_MS;
    sendSubscription();
  });

  ws.on("message", (data) => {
    messagesSinceHeartbeat++;
    try {
      const msg = JSON.parse(data.toString()) as AisStreamMessage;
      handleMessage(msg);
    } catch (err) {
      // Don't crash the worker over a single malformed packet.
      console.error("[ws] parse error:", (err as Error).message);
    }
  });

  ws.on("close", () => {
    if (shuttingDown) return;
    console.log(`[ws] closed · reconnecting in ${reconnectDelay}ms`);
    setTimeout(openWs, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  });

  ws.on("error", (err) => {
    console.error("[ws] error:", err.message);
    // Rely on the `close` handler to schedule reconnect — WS emits close
    // after error, so double-scheduling would hammer AISStream.
  });
}

// ---------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------

interface AisStreamMessage {
  MessageType: string;
  MetaData: {
    MMSI: number;
    ShipName?: string;
    latitude?: number;
    longitude?: number;
    time_utc?: string;
  };
  Message: Record<string, Record<string, unknown>>;
}

function handleMessage(msg: AisStreamMessage): void {
  const mmsi = String(msg.MetaData?.MMSI ?? "");
  if (!mmsi) return;
  // Client-side filter as a safety net — AISStream's server-side MMSI
  // filter should have already dropped anything we don't care about.
  if (watchlist.size > 0 && !watchlist.has(mmsi)) return;

  switch (msg.MessageType) {
    case "PositionReport":
    case "StandardClassBPositionReport":
      collectPosition(mmsi, msg);
      break;
    case "ShipStaticData":
      collectStatic(mmsi, msg);
      break;
    // Else: ignore.
  }
}

function collectPosition(mmsi: string, msg: AisStreamMessage): void {
  const inner =
    (msg.Message.PositionReport as Record<string, unknown> | undefined) ??
    (msg.Message.StandardClassBPositionReport as Record<string, unknown> | undefined);
  if (!inner) return;

  const lat = numOrNull(inner.Latitude);
  const lon = numOrNull(inner.Longitude);
  if (lat === null || lon === null) return;

  const cog = numOrNull(inner.Cog);
  // AIS `Sog` is already knots for PositionReport — no 0.1-kn scaling in
  // AISStream's parsed output. Class B's `Sog` field follows the same
  // convention here (decoded server-side).
  const sog = numOrNull(inner.Sog);
  const heading = numOrNull(inner.TrueHeading);
  // 511 means "not available" in the AIS spec — store null instead.
  const headingClean = heading === 511 ? null : heading;
  const navStatus = numOrNull(inner.NavigationalStatus);
  const receivedAt = parseTime(msg.MetaData.time_utc) ?? new Date();

  // ---- Run validation stack (L1 Sanity + L2 Temporal) --------------
  const sanityFlags = checkSanity({ lat, lon, sog, cog, receivedAt });
  const prior = lastAcceptedPosition.get(mmsi) ?? null;
  const temporalFlags = checkTemporal({
    current: { lat, lon, sog, navStatus, receivedAt },
    prior,
  });
  const flags: Flag[] = [...sanityFlags, ...temporalFlags];
  for (const f of flags) flagBatch.push(toFlagRow(mmsi, f));
  flagsSinceHeartbeat += flags.length;

  const hasReject = flags.some((f) => f.severity === "reject");
  if (hasReject) {
    rejectsSinceHeartbeat++;
    return; // Drop the position — it was L1/L2 rejected.
  }
  // --------------------------------------------------------------------

  const key = `${mmsi}|${receivedAt.getTime()}`;
  positionBatch.set(key, {
    mmsi,
    lat: String(lat),
    lon: String(lon),
    cog: cog === null ? null : String(cog),
    sog: sog === null ? null : String(sog),
    heading: headingClean,
    navStatus,
    receivedAt,
  });
  // Update the prior-position cache with the accepted fix so L2 temporal
  // has a baseline for the NEXT incoming message.
  lastAcceptedPosition.set(mmsi, { lat, lon, sog, receivedAt });
}

function collectStatic(mmsi: string, msg: AisStreamMessage): void {
  const ship = msg.Message.ShipStaticData as Record<string, unknown> | undefined;
  if (!ship) return;

  const imo = ship.ImoNumber;
  const name = strClean(ship.Name);
  const callSign = strClean(ship.CallSign);
  const destination = strClean(ship.Destination);
  const shipType = numOrNull(ship.Type);
  const dim = ship.Dimension as Record<string, unknown> | undefined;
  const lengthM = dim ? sumOrNull(dim.A, dim.B) : null;
  const beamM = dim ? sumOrNull(dim.C, dim.D) : null;
  const draughtM = numOrNull(ship.MaximumStaticDraught);
  const eta = parseAisEta(ship.Eta);

  const imoStr = imo === null || imo === undefined || imo === 0 ? null : String(imo);

  vesselBatch.set(mmsi, {
    mmsi,
    imo: imoStr,
    name: name ?? null,
    callSign: callSign ?? null,
    shipType,
    lengthM,
    beamM,
    draughtM: draughtM === null ? null : String(draughtM),
    destination: destination ?? null,
    eta,
    staticUpdatedAt: new Date(),
  });

  // ---- Run L3 Identity against linkage's expected values ----------
  const expected = linkageByMmsi.get(mmsi);
  if (expected !== undefined) {
    const identityFlags = checkIdentity({
      ais: { name: name ?? null, imo: imoStr, lengthM, beamM },
      expected,
      messageReceivedAt: new Date(),
    });
    for (const f of identityFlags) flagBatch.push(toFlagRow(mmsi, f));
    flagsSinceHeartbeat += identityFlags.length;
  }
}

// ---------------------------------------------------------------
// Flush loop
// ---------------------------------------------------------------

async function flush(): Promise<void> {
  if (positionBatch.size === 0 && vesselBatch.size === 0 && flagBatch.length === 0) return;

  const positions = [...positionBatch.values()];
  const vessels = [...vesselBatch.values()];
  const flagRows = flagBatch.splice(0, flagBatch.length);
  positionBatch.clear();
  vesselBatch.clear();

  try {
    if (vessels.length > 0) {
      // onConflictDoUpdate against the mmsi PK — newer static data wins.
      // `firstSeenAt` is NOT updated (it's set once on insert).
      await db
        .insert(schema.vessels)
        .values(vessels)
        .onConflictDoUpdate({
          target: schema.vessels.mmsi,
          set: {
            imo: sql`excluded.imo`,
            name: sql`excluded.name`,
            callSign: sql`excluded.call_sign`,
            shipType: sql`excluded.ship_type`,
            lengthM: sql`excluded.length_m`,
            beamM: sql`excluded.beam_m`,
            draughtM: sql`excluded.draught_m`,
            destination: sql`excluded.destination`,
            eta: sql`excluded.eta`,
            staticUpdatedAt: sql`excluded.static_updated_at`,
          },
        });
    }

    if (positions.length > 0) {
      // No conflict target — duplicates are dropped by the client-side
      // dedup via positionBatch Map key (mmsi|timestamp). Two receivers
      // catching the same broadcast will collide on that key, not on a
      // DB constraint.
      await db.insert(schema.vesselPositions).values(positions);
    }

    if (flagRows.length > 0) {
      await db.insert(schema.aisValidationFlags).values(flagRows);
    }

    writesSinceHeartbeat += positions.length + vessels.length + flagRows.length;
  } catch (err) {
    console.error("[flush] write error:", (err as Error).message);
    // Drop the batch — retrying would risk duplicates and the worker
    // should stay alive to keep ingesting. The spec explicitly accepts
    // position gaps over worker crashes.
  }
}

// ---------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------

async function main() {
  console.log("[ais-ingest] starting");
  console.log(`[ais-ingest] endpoint ${AIS_ENDPOINT}`);
  console.log(`[ais-ingest] db ${dbUrl.replace(/:[^@]+@/, ":***@")}`);

  // Initial watchlist load — opens WS too if any MMSIs are present.
  // If watchlist is empty, WS stays closed until the next refresh turns
  // up an MMSI (e.g. operator uploads a Q88 and the parser extracts it).
  await refreshWatchlist();
  if (watchlist.size === 0) {
    console.log("[ais-ingest] idle — waiting for watchlist to populate");
  }

  setInterval(flush, FLUSH_INTERVAL_MS);
  setInterval(refreshWatchlist, WATCHLIST_REFRESH_MS);
  setInterval(heartbeat, HEARTBEAT_MS);
  setInterval(scanAnomalies, ANOMALY_CHECK_INTERVAL_MS);
  setInterval(retentionSweep, RETENTION_INTERVAL_MS);

  // Run one retention sweep ~5 min after startup so newly deployed
  // instances catch up on any pent-up trimming without blocking the
  // connect/subscribe flow. setTimeout so the first full 24h interval
  // still fires normally after this one.
  setTimeout(retentionSweep, 5 * 60 * 1000);

  const shutdown = async (signal: string) => {
    console.log(`[ais-ingest] ${signal} received, shutting down`);
    shuttingDown = true;
    if (ws !== null) ws.close();
    await flush();
    await sqlClient.end({ timeout: 5 });
    console.log("[ais-ingest] bye");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * L4 Anomaly sweep — runs on a timer, not per-message. For every
 * tracked MMSI, look up the last stored position and ask the anomaly
 * layer "has this vessel gone silent somewhere suspicious?". Any
 * resulting flags are appended to the next flush. We dedupe at the
 * DB layer by only raising a flag if we don't already have one of
 * the same type in the last `ANOMALY_CHECK_INTERVAL_MS * 2` window —
 * a quiet vessel would otherwise spam a new `ais_off_sanctioned`
 * row every 5 minutes forever.
 */
async function scanAnomalies(): Promise<void> {
  if (watchlist.size === 0) return;
  const now = new Date();
  for (const mmsi of watchlist) {
    const last = lastAcceptedPosition.get(mmsi);
    if (last === undefined) continue;
    const flags = checkAnomaly({
      lastKnown: {
        lat: last.lat,
        lon: last.lon,
        receivedAt: last.receivedAt,
      },
      now,
    });
    if (flags.length === 0) continue;

    // Dedupe: skip if we already raised this flag_type for this MMSI
    // in the last 12 min. Per-MMSI noise suppression.
    const recentlyFlagged = await db
      .select({ type: schema.aisValidationFlags.flagType })
      .from(schema.aisValidationFlags)
      .where(
        sql`${schema.aisValidationFlags.mmsi} = ${mmsi} AND ${schema.aisValidationFlags.createdAt} > NOW() - INTERVAL '12 minutes'`,
      );
    const recentTypes = new Set(recentlyFlagged.map((r) => r.type));
    for (const f of flags) {
      if (!recentTypes.has(f.type)) {
        flagBatch.push(toFlagRow(mmsi, f));
        flagsSinceHeartbeat++;
      }
    }
  }
}

/**
 * Retention sweep — runs once daily, trims old positions and ack'd
 * flags. Deliberately narrow: we only delete rows clearly beyond the
 * retention window, never truncate a whole table. If a restart mid-
 * sweep fails, the next run picks up where we left off; idempotent.
 */
async function retentionSweep(): Promise<void> {
  const startedAt = Date.now();
  try {
    const posResult = await db.execute(
      sql`DELETE FROM vessel_positions WHERE received_at < NOW() - (${POSITION_RETENTION_DAYS}::int * INTERVAL '1 day')`,
    );
    // `execute` returns different shapes depending on the driver — postgres-js
    // gives us the affected rows count under `count`. Guard with any so a
    // driver upgrade doesn't silently break the log line.
    const posCount = (posResult as unknown as { count?: number }).count ?? 0;

    const flagResult = await db.execute(
      sql`DELETE FROM ais_validation_flags
          WHERE acknowledged_at IS NOT NULL
            AND created_at < NOW() - (${FLAG_RETENTION_DAYS}::int * INTERVAL '1 day')`,
    );
    const flagCount = (flagResult as unknown as { count?: number }).count ?? 0;

    const ms = Date.now() - startedAt;
    console.log(
      `[retention] trimmed ${posCount} positions (>${POSITION_RETENTION_DAYS}d) + ${flagCount} ack'd flags (>${FLAG_RETENTION_DAYS}d) in ${ms}ms`,
    );
  } catch (err) {
    console.error("[retention] sweep failed:", (err as Error).message);
  }
}

function heartbeat(): void {
  console.log(
    `[heartbeat] ${messagesSinceHeartbeat} msg/min · ${writesSinceHeartbeat} rows/min · ${flagsSinceHeartbeat} flags (${rejectsSinceHeartbeat} rejects) · ${positionBatch.size} pending · ${watchlist.size} tracked`,
  );
  messagesSinceHeartbeat = 0;
  writesSinceHeartbeat = 0;
  flagsSinceHeartbeat = 0;
  rejectsSinceHeartbeat = 0;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strClean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sumOrNull(a: unknown, b: unknown): number | null {
  const x = numOrNull(a);
  const y = numOrNull(b);
  if (x === null && y === null) return null;
  return (x ?? 0) + (y ?? 0);
}

function parseTime(s: string | undefined): Date | null {
  if (!s) return null;
  // AISStream's time_utc has a Go-style nanosecond suffix:
  //   "2026-04-21 19:43:35.584524619 +0000 UTC"
  // Normalise to ISO so JS Date can parse it.
  const iso = s
    .replace(" ", "T")
    .replace(/\.(\d{3})\d+/, ".$1")
    .replace(" +0000 UTC", "Z");
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * AIS ETA has no year, just month/day/hour/minute. We pick the NEXT
 * occurrence of that date relative to today — so an ETA of "25-Nov 23:30"
 * broadcast in April means 25 Nov of the current year (unless it would
 * be in the past, in which case next year).
 */
function parseAisEta(raw: unknown): Date | null {
  if (!raw || typeof raw !== "object") return null;
  const eta = raw as Record<string, unknown>;
  const month = numOrNull(eta.Month);
  const day = numOrNull(eta.Day);
  const hour = numOrNull(eta.Hour);
  const minute = numOrNull(eta.Minute);
  if (month === null || day === null || hour === null || minute === null) return null;
  // AIS sentinel: 0 month = "not available".
  if (month === 0 || day === 0) return null;

  const now = new Date();
  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (candidate.getTime() < now.getTime() - 30 * 24 * 3600 * 1000) {
    // ETA already more than 30 days in the past → must be next year.
    year += 1;
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  }
  return candidate;
}

// ---------------------------------------------------------------
// Entry
// ---------------------------------------------------------------

main().catch((err) => {
  console.error("[ais-ingest] fatal:", err);
  process.exit(1);
});
