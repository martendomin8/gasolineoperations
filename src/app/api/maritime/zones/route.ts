import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { withAuth } from "@/lib/middleware/with-auth";
import { invalidateRuntimeGraph } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";
import { flushRouteCache } from "@/lib/maritime/sea-distance/providers/ocean-routing";

/**
 * Zones — piracy / war / tension risk overlays, forbidden routing
 * zones, and navigable whitelists. Source of truth:
 * scripts/ocean-routing/zones.json (committed to git).
 *
 * Mirrors the channel-chains API:
 *   GET  — any authenticated user gets the full list (read-only)
 *   POST — any authenticated user writes a new full snapshot
 *          (dev tools gate is the only access control; git history
 *          provides the audit trail)
 */

const ZONES_PATH = path.join(
  process.cwd(),
  "scripts",
  "ocean-routing",
  "zones.json"
);

const DEV_TOOLS_ENABLED = process.env.NEXT_PUBLIC_DEV_TOOLS === "true";

const waypointSchema = z.tuple([
  z.number().gte(-90).lte(90),
  z.number().gte(-180).lte(180),
]);

const zoneSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "id must be kebab-case ascii"),
  label: z.string().min(1).max(200),
  category: z.enum(["war", "piracy", "tension", "forbidden", "navigable"]),
  visible: z.boolean(),
  blocksRouting: z.boolean(),
  navigable: z.boolean(),
  note: z.string().max(2000).optional().nullable(),
  since: z.string().max(200).optional().nullable(),
  polygon: z.array(waypointSchema).min(3).max(500),
});

const payloadSchema = z.object({
  zones: z.array(zoneSchema).max(200),
});

interface StoredZone extends z.infer<typeof zoneSchema> {}

interface ZonesFile {
  _meta?: Record<string, unknown>;
  zones: StoredZone[];
}

async function readZonesFile(): Promise<ZonesFile> {
  try {
    const raw = await fs.readFile(ZONES_PATH, "utf-8");
    return JSON.parse(raw) as ZonesFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { zones: [] };
    }
    throw err;
  }
}

async function writeZonesFile(
  zones: StoredZone[],
  existingMeta?: Record<string, unknown>
): Promise<void> {
  const payload: ZonesFile = {
    _meta: existingMeta ?? {
      description:
        "Operational zones — risk overlays, forbidden routing, navigable whitelists. Edited via the Fleet dev-tools Zone Editor.",
      schema_version: 1,
    },
    zones,
  };
  const json = JSON.stringify(payload, null, 2) + "\n";
  await fs.writeFile(ZONES_PATH, json, "utf-8");
}

export const GET = withAuth(async () => {
  if (!DEV_TOOLS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const file = await readZonesFile();
  return NextResponse.json({ zones: file.zones });
});

export const POST = withAuth(async (req) => {
  if (!DEV_TOOLS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }
  const ids = new Set<string>();
  for (const z of parsed.data.zones) {
    if (ids.has(z.id)) {
      return NextResponse.json(
        { error: `Duplicate zone id: ${z.id}` },
        { status: 400 }
      );
    }
    ids.add(z.id);
  }
  const existing = await readZonesFile();
  await writeZonesFile(parsed.data.zones, existing._meta);
  // Make the edit live for the SERVER-side routing graph too — the
  // Planner panel hits /api/maritime/sea-distance which runs on this
  // same Node process, so we need to push the new zone set into the
  // routing module here, otherwise the planner keeps seeing stale
  // forbidden regions until the next dev-server restart.
  invalidateRuntimeGraph({
    zones: parsed.data.zones.map((z) => ({
      blocksRouting: z.blocksRouting,
      polygon: z.polygon,
    })),
  });
  flushRouteCache();
  return NextResponse.json({
    ok: true,
    zoneCount: parsed.data.zones.length,
    path: "scripts/ocean-routing/zones.json",
    hint: "Zones took effect immediately. Commit + push the JSON for the rest of the team; pipeline rebuild NOT required for forbidden zones.",
  });
});
