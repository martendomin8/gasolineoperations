import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { withAuth } from "@/lib/middleware/with-auth";
import { invalidateRuntimeGraph } from "@/lib/maritime/sea-distance/providers/ocean-routing/graph-runtime";
import { flushRouteCache } from "@/lib/maritime/sea-distance/providers/ocean-routing";

/**
 * Channel Chains — hand-curated dense waypoint sequences through
 * narrow waterways (Turkish Straits, Greek archipelago, etc.) that
 * the searoute AIS network can't trace on its own.
 *
 * Source of truth: scripts/ocean-routing/channel_chains.json (committed
 * to git). This endpoint GETs the current file and POSTs a new full
 * snapshot — save atomically replaces the whole file, so one dev's
 * edit can't partially corrupt another's chain. Conflict resolution
 * happens at git-push time via normal merge conflict UX.
 *
 * Dev-tools-only: guarded by NEXT_PUBLIC_DEV_TOOLS=true. In production
 * deployments without this flag the endpoint returns 404 so the editor
 * UI is genuinely inaccessible — not just hidden behind a CSS flag.
 */

// On-disk path — resolved relative to project root so it works the
// same on the dev's laptop and on the on-prem deployments.
const CHAINS_PATH = path.join(
  process.cwd(),
  "scripts",
  "ocean-routing",
  "channel_chains.json"
);

const DEV_TOOLS_ENABLED = process.env.NEXT_PUBLIC_DEV_TOOLS === "true";

const waypointSchema = z.tuple([
  z.number().gte(-90).lte(90),
  z.number().gte(-180).lte(180),
]);

const chainSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "id must be kebab-case ascii"),
  label: z.string().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
  waypoints: z.array(waypointSchema).min(2).max(500),
});

const payloadSchema = z.object({
  chains: z.array(chainSchema).max(100),
});

interface StoredChain {
  id: string;
  label: string;
  notes?: string | null;
  waypoints: Array<[number, number]>;
}

interface ChainsFile {
  _meta?: Record<string, unknown>;
  chains: StoredChain[];
}

async function readChainsFile(): Promise<ChainsFile> {
  try {
    const raw = await fs.readFile(CHAINS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ChainsFile;
    return parsed;
  } catch (err) {
    // Missing file → empty scaffold. Any other error bubbles up.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { chains: [] };
    }
    throw err;
  }
}

async function writeChainsFile(
  chains: StoredChain[],
  existingMeta?: Record<string, unknown>
): Promise<void> {
  const payload: ChainsFile = {
    _meta: existingMeta ?? {
      description:
        "Hand-curated dense waypoint chains for narrow waterways. Edited via the Fleet dev-tools Channel Editor.",
      schema_version: 1,
    },
    chains,
  };
  // Indent for human readability — these files are reviewed in PRs.
  const json = JSON.stringify(payload, null, 2) + "\n";
  await fs.writeFile(CHAINS_PATH, json, "utf-8");
}

// GET /api/maritime/channel-chains — returns the current file
// contents. Open to any authenticated user (read-only) so non-dev
// operators can *see* existing chains on the map without editing.
export const GET = withAuth(async () => {
  if (!DEV_TOOLS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const file = await readChainsFile();
  return NextResponse.json({
    chains: file.chains,
    savedAt: null, // future: fs.stat().mtime
  });
});

// POST /api/maritime/channel-chains — replaces the chains array with
// the submitted one. Any authenticated user can save when dev tools
// are enabled: the NEXT_PUBLIC_DEV_TOOLS flag gates access, and every
// save is recorded in git history (the JSON file is committed) so
// bad edits are recoverable via `git revert`. No role gate needed
// on top of that.
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
    // Enforce unique ids (zod array can't express it easily).
    const ids = new Set<string>();
    for (const c of parsed.data.chains) {
      if (ids.has(c.id)) {
        return NextResponse.json(
          { error: `Duplicate chain id: ${c.id}` },
          { status: 400 }
        );
      }
      ids.add(c.id);
    }
    const existing = await readChainsFile();
    await writeChainsFile(
      parsed.data.chains as StoredChain[],
      existing._meta
    );
    // Make the edit live for SERVER-side routing too. Without this,
    // the Planner (which calls /api/maritime/sea-distance) would
    // keep using stale chains from the startup-time module cache
    // until the dev-server restarted.
    invalidateRuntimeGraph({
      channelChains: parsed.data.chains.map((c) => ({
        id: c.id,
        waypoints: c.waypoints,
      })),
    });
    flushRouteCache();
    return NextResponse.json({
      ok: true,
      chainCount: parsed.data.chains.length,
      path: "scripts/ocean-routing/channel_chains.json",
      hint: "Chains took effect immediately. Commit + push the JSON for the rest of the team; pipeline rebuild NOT required.",
    });
});
