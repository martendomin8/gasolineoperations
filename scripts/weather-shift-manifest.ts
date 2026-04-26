/**
 * Date-shift the local weather manifest to "today" so the Fleet map's
 * time slider stops claiming the forecast was issued 21 Apr 12Z when
 * we're actually recording a promo on 26 Apr.
 *
 * What this does:
 *   - Reads `public/weather/manifest.json`.
 *   - Picks the most recent run as the new "anchor".
 *   - Computes a delta between today's most-recent 6-hour cycle (00/06/
 *     12/18 UTC) and that anchor's cycleTime.
 *   - Shifts EVERY run's cycleTime/generatedAt + every frame's validTime
 *     forward by that delta. Frames keep their original URL paths so
 *     the existing PNG/JSON files still serve.
 *   - Updates `latest` to point at the newest run after shifting.
 *
 * Caveat: the actual weather pixel data is N days old. The map shows
 * today's dates on the slider but the underlying wind/wave/temp
 * fields are from a past forecast cycle. Fine for a promo video, NOT
 * fine for operational use. Re-run the proper Python pipeline when
 * possible (scripts/weather-pipeline/run_pipeline.py --local
 * public/weather).
 *
 * Usage:
 *   npx tsx scripts/weather-shift-manifest.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Frame {
  forecastHour: number;
  validTime: string;
  pngUrl: string;
  jsonUrl: string;
}

interface Run {
  runId: string;
  cycleTime: string;
  generatedAt: string;
  frames: Record<string, Frame[]>;
}

interface Manifest {
  version: number;
  latest: string | null;
  runs: Run[];
}

const MANIFEST_PATH = join(process.cwd(), "public", "weather", "manifest.json");

/** Round a Date down to the nearest 6-hour GFS cycle (00/06/12/18 UTC). */
function latestGfsCycle(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  const hour = d.getUTCHours();
  d.setUTCHours(Math.floor(hour / 6) * 6);
  return d;
}

function isoUtc(d: Date): string {
  return d.toISOString().replace(".000Z", "+00:00");
}

function shiftIso(iso: string, offsetMs: number): string {
  return isoUtc(new Date(new Date(iso).getTime() + offsetMs));
}

function main(): void {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  if (manifest.runs.length === 0) {
    console.error("No runs in manifest — nothing to shift.");
    process.exit(1);
  }

  // Pick the newest existing run by cycleTime.
  const sortedRuns = [...manifest.runs].sort(
    (a, b) => new Date(b.cycleTime).getTime() - new Date(a.cycleTime).getTime(),
  );
  const newestExisting = sortedRuns[0];
  const newestExistingTs = new Date(newestExisting.cycleTime).getTime();

  // Target: latest 6-hour cycle <= now. NOAA publishes runs ~4-5h after
  // cycle, so we point at the one that's "fresh enough" without
  // pretending we have an unreleased run.
  const target = latestGfsCycle(new Date(Date.now() - 5 * 60 * 60 * 1000));
  const offsetMs = target.getTime() - newestExistingTs;

  if (offsetMs < 0) {
    console.error(
      `Existing newest run (${newestExisting.cycleTime}) is already AFTER today's freshest cycle (${isoUtc(
        target,
      )}). Nothing to do.`,
    );
    process.exit(0);
  }

  console.log(
    `Shifting all runs forward by ${(offsetMs / 3600000).toFixed(1)}h to anchor newest run at ${isoUtc(target)}`,
  );

  for (const run of manifest.runs) {
    run.cycleTime = shiftIso(run.cycleTime, offsetMs);
    run.generatedAt = shiftIso(run.generatedAt, offsetMs);
    for (const layer of Object.keys(run.frames)) {
      for (const frame of run.frames[layer]) {
        frame.validTime = shiftIso(frame.validTime, offsetMs);
      }
    }
  }

  // Recompute `latest` to match the newest cycleTime after shift.
  const sortedAfter = [...manifest.runs].sort(
    (a, b) => new Date(b.cycleTime).getTime() - new Date(a.cycleTime).getTime(),
  );
  manifest.latest = sortedAfter[0].runId;

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Wrote ${MANIFEST_PATH}`);
  console.log(`  latest run cycleTime → ${sortedAfter[0].cycleTime}`);
  console.log(`  total runs in manifest: ${manifest.runs.length}`);
  console.log(`  ⚠️  underlying PNG data is still ${(offsetMs / 86400000).toFixed(1)} days old — visual hack only`);
}

main();
