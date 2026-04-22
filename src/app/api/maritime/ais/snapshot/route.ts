/**
 * GET /api/maritime/ais/snapshot
 *
 * The single endpoint the Fleet map polls to render live vessels.
 * For every linkage that has a tracked MMSI, the payload contains:
 *   - Identity (name, IMO, destination, ETA)
 *   - A RESOLVED position — already run through the hybrid LIVE /
 *     DEAD_RECK / PREDICTED selector, so the UI just draws the marker
 *     and colour-codes by `position.mode`.
 *   - Unresolved validation flags (last 7 days, excluding ack'd ones).
 *   - L5 business-rule checks run at read time against the voyage
 *     context (laycan, loadport, discharge port). These flags are
 *     NOT written to the audit table — they're live derived signals
 *     that can flip back and forth as the vessel moves.
 *
 * Tenant-scoped: only returns linkages belonging to the caller's tenant.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, isNotNull, inArray, sql } from "drizzle-orm";
import { AisstreamProvider } from "@/lib/maritime/ais/providers/aisstream";
import {
  resolvePosition,
  type VoyagePlan,
} from "@/lib/maritime/ais/position-resolver";
import { predictGreatCircle } from "@/lib/maritime/ais/route-oracle";
import { checkBusiness } from "@/lib/maritime/ais/validation";
import type { Flag } from "@/lib/maritime/ais/validation";
import { getPortCoords } from "@/lib/maritime/sea-distance";

export const GET = withAuth(async (req: NextRequest, _ctx, session) => {
  const tenantId = session.user.tenantId;
  const db = getDb();
  const provider = new AisstreamProvider();

  // ---- 1. Linkages with MMSI + voyage context ---------------------
  // Pull the MMSI-bearing linkages, plus the "earliest active deal" for
  // each so we have loadport / discharge / laycan for L5 at read time.
  // A linkage can have multiple deals — we pick the one with the
  // earliest laycan_start that isn't cancelled, which corresponds to
  // the purchase leg in a simple buy→sell chain.
  const linkageRows = await db
    .select({
      id: schema.linkages.id,
      displayName: sql<string>`COALESCE(${schema.linkages.linkageNumber}, ${schema.linkages.tempName})`,
      mmsi: schema.linkages.vesselMmsi,
      vesselName: schema.linkages.vesselName,
      vesselImo: schema.linkages.vesselImo,
      particulars: schema.linkages.vesselParticulars,
    })
    .from(schema.linkages)
    .where(
      and(
        eq(schema.linkages.tenantId, tenantId),
        isNotNull(schema.linkages.vesselMmsi),
      ),
    );

  if (linkageRows.length === 0) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      vessels: [],
    });
  }

  const linkageIds = linkageRows.map((r) => r.id);
  const dealRows = await db
    .select({
      linkageId: schema.deals.linkageId,
      loadport: schema.deals.loadport,
      dischargePort: schema.deals.dischargePort,
      laycanStart: schema.deals.laycanStart,
      laycanEnd: schema.deals.laycanEnd,
      direction: schema.deals.direction,
    })
    .from(schema.deals)
    .where(
      and(
        inArray(schema.deals.linkageId, linkageIds),
        sql`${schema.deals.status} <> 'cancelled'`,
      ),
    );

  // Fold deals into a per-linkage voyage plan. Pick loadport from the
  // earliest purchase deal, discharge port from the latest sale deal,
  // laycanEnd as the latest laycan_end across all active deals in the
  // linkage (a cautious "this is the window we need to be out by").
  const voyageByLinkage = new Map<string, ReturnType<typeof buildVoyageFromDeals>>();
  const dealsByLinkage = new Map<string, typeof dealRows>();
  for (const d of dealRows) {
    if (d.linkageId === null) continue;
    const bucket = dealsByLinkage.get(d.linkageId) ?? [];
    bucket.push(d);
    dealsByLinkage.set(d.linkageId, bucket);
  }
  for (const [linkageId, deals] of dealsByLinkage) {
    voyageByLinkage.set(linkageId, buildVoyageFromDeals(deals));
  }

  // ---- 2. Latest AIS snapshot per MMSI ----------------------------
  const mmsis = linkageRows.map((r) => Number(r.mmsi!));
  const snapshots = await provider.getSnapshots({ mmsis });
  const snapshotByMmsi = new Map(
    snapshots.map((s) => [String(s.static.mmsi), s]),
  );

  // ---- 3. Unresolved flags from last 7 days -----------------------
  const mmsiStrings = linkageRows.map((r) => r.mmsi!);
  const flagRows = await db
    .select()
    .from(schema.aisValidationFlags)
    .where(
      and(
        inArray(schema.aisValidationFlags.mmsi, mmsiStrings),
        sql`${schema.aisValidationFlags.acknowledgedAt} IS NULL`,
        sql`${schema.aisValidationFlags.createdAt} > NOW() - INTERVAL '7 days'`,
      ),
    )
    .orderBy(sql`${schema.aisValidationFlags.createdAt} DESC`);
  const flagsByMmsi = new Map<string, typeof flagRows>();
  for (const f of flagRows) {
    const bucket = flagsByMmsi.get(f.mmsi) ?? [];
    bucket.push(f);
    flagsByMmsi.set(f.mmsi, bucket);
  }

  // ---- 4. Run resolver + L5 per linkage ---------------------------
  const now = new Date();
  const vessels = linkageRows.map((linkage) => {
    const mmsi = linkage.mmsi!;
    const snap = snapshotByMmsi.get(mmsi) ?? null;
    const voyage = voyageByLinkage.get(linkage.id) ?? NULL_VOYAGE;
    const voyagePlan = voyagePlanFor(voyage);

    const resolved = resolvePosition({
      lastAis: snap?.position ?? null,
      now,
      voyage: voyagePlan,
    });

    // L5 live — only when we have a position to evaluate and voyage
    // context rich enough for at least one sub-check to fire.
    const liveL5Flags: Flag[] =
      snap !== null
        ? checkBusiness({
            current: {
              lat: snap.position.lat,
              lon: snap.position.lon,
              sog: snap.position.sog,
              receivedAt: snap.position.receivedAt,
            },
            cpSpeedKn: null,        // No stored source yet (CP recap parsing future)
            avgSogRecentKn: null,   // Requires rolling-window fetch — V2 optimisation
            route: voyage.route,
            aisEta: snap.static.eta,
            laycanEnd: voyage.laycanEnd,
          })
        : [];

    const storedFlags = (flagsByMmsi.get(mmsi) ?? []).map((f) => ({
      id: f.id,
      layer: f.layer,
      type: f.flagType,
      severity: f.severity,
      details: f.details,
      messageReceivedAt: f.messageReceivedAt.toISOString(),
      createdAt: f.createdAt.toISOString(),
    }));

    return {
      linkageId: linkage.id,
      linkageName: linkage.displayName,
      mmsi,
      vessel: {
        name: snap?.static.name || linkage.vesselName || null,
        imo: snap?.static.imo
          ? String(snap.static.imo)
          : linkage.vesselImo ?? null,
        destination: snap?.static.destination ?? null,
        eta: snap?.static.eta?.toISOString() ?? null,
        shipType: snap?.static.shipType ?? null,
        lengthM: snap?.static.lengthM ?? null,
        beamM: snap?.static.beamM ?? null,
      },
      position: {
        lat: resolved.lat,
        lon: resolved.lon,
        mode: resolved.mode,
        bearingDeg: resolved.bearingDeg,
        ageMs: Number.isFinite(resolved.ageMs) ? resolved.ageMs : null,
        aisReceivedAt: resolved.aisReceivedAt?.toISOString() ?? null,
      },
      voyage: {
        loadportName: voyage.loadportName,
        dischargePortName: voyage.dischargePortName,
        laycanEnd: voyage.laycanEnd?.toISOString() ?? null,
      },
      storedFlags,
      liveFlags: liveL5Flags.map((f) => ({
        layer: f.layer,
        type: f.type,
        severity: f.severity,
        details: f.details,
      })),
    };
  });

  return NextResponse.json({
    generatedAt: now.toISOString(),
    vessels,
  });
});

// ---------------------------------------------------------------
// Voyage plan assembly
// ---------------------------------------------------------------

interface VoyageContext {
  loadportName: string | null;
  loadportLat: number | null;
  loadportLon: number | null;
  dischargePortName: string | null;
  dischargeLat: number | null;
  dischargeLon: number | null;
  laycanEnd: Date | null;
  voyageStart: Date | null;
  route: {
    loadportLat: number;
    loadportLon: number;
    dischargeLat: number;
    dischargeLon: number;
  } | null;
}

const NULL_VOYAGE: VoyageContext = {
  loadportName: null,
  loadportLat: null,
  loadportLon: null,
  dischargePortName: null,
  dischargeLat: null,
  dischargeLon: null,
  laycanEnd: null,
  voyageStart: null,
  route: null,
};

function buildVoyageFromDeals(
  deals: Array<{
    loadport: string;
    dischargePort: string | null;
    laycanStart: string;
    laycanEnd: string;
    direction: "buy" | "sell";
  }>,
): VoyageContext {
  if (deals.length === 0) return NULL_VOYAGE;

  // Loadport: from the earliest purchase deal; fall back to earliest deal.
  const purchases = deals.filter((d) => d.direction === "buy");
  const sorted = [...deals].sort((a, b) =>
    a.laycanStart.localeCompare(b.laycanStart),
  );
  const loadportDeal =
    purchases.sort((a, b) => a.laycanStart.localeCompare(b.laycanStart))[0] ??
    sorted[0];

  // Discharge: from the latest sale deal; fall back to latest with a
  // non-null dischargePort.
  const sales = deals.filter((d) => d.direction === "sell");
  const dischargeDeal =
    sales
      .filter((d) => d.dischargePort !== null)
      .sort((a, b) => b.laycanEnd.localeCompare(a.laycanEnd))[0] ??
    sorted
      .filter((d) => d.dischargePort !== null)
      .sort((a, b) => b.laycanEnd.localeCompare(a.laycanEnd))[0];

  const loadportName = loadportDeal?.loadport ?? null;
  const dischargePortName = dischargeDeal?.dischargePort ?? null;
  const loadportCoords = loadportName ? getPortCoords(loadportName) : null;
  const dischargeCoords = dischargePortName
    ? getPortCoords(dischargePortName)
    : null;

  const latestLaycanEnd = sorted.reduce<Date | null>((acc, d) => {
    const t = new Date(d.laycanEnd + "T00:00:00Z");
    return acc === null || t > acc ? t : acc;
  }, null);
  const earliestLaycanStart = sorted[0]
    ? new Date(sorted[0].laycanStart + "T00:00:00Z")
    : null;

  let route: VoyageContext["route"] = null;
  if (loadportCoords && dischargeCoords) {
    route = {
      loadportLat: loadportCoords.lat,
      loadportLon: loadportCoords.lon,
      dischargeLat: dischargeCoords.lat,
      dischargeLon: dischargeCoords.lon,
    };
  }

  return {
    loadportName,
    loadportLat: loadportCoords?.lat ?? null,
    loadportLon: loadportCoords?.lon ?? null,
    dischargePortName,
    dischargeLat: dischargeCoords?.lat ?? null,
    dischargeLon: dischargeCoords?.lon ?? null,
    laycanEnd: latestLaycanEnd,
    voyageStart: earliestLaycanStart,
    route,
  };
}

/**
 * Map our rich `VoyageContext` onto the narrower `VoyagePlan` that
 * the position-resolver consumes. If we have no loadport coords we
 * pass `(0, 0)` — the resolver treats this defensively (null route
 * oracle → marker at anchor point, which in that case is loadport or
 * fallback). We explicitly set `routePredict` to null when we can't
 * build a route so the resolver stays in its defensive branch rather
 * than calling the GC oracle with bogus coords.
 */
function voyagePlanFor(ctx: VoyageContext): VoyagePlan {
  const hasLoadport = ctx.loadportLat !== null && ctx.loadportLon !== null;
  const hasDischarge = ctx.dischargeLat !== null && ctx.dischargeLon !== null;
  return {
    loadportLat: ctx.loadportLat ?? 0,
    loadportLon: ctx.loadportLon ?? 0,
    cpSpeedKn: null,
    dischargeLat: hasDischarge ? ctx.dischargeLat : null,
    dischargeLon: hasDischarge ? ctx.dischargeLon : null,
    voyageStart: ctx.voyageStart,
    routePredict: hasLoadport && hasDischarge ? predictGreatCircle : null,
  };
}
