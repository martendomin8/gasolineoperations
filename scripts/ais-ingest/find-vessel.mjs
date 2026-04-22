/**
 * AIS vessel finder — subscribe to a bbox, watch for a vessel name
 * match, print the MMSI when we see it.
 *
 * Why this exists: operators type a vessel name into the Q88 form
 * but AIS tracks MMSIs, not names. If "ADIYAMAN" isn't showing up
 * on our Fleet map, the first question is always "did the right
 * MMSI land on the linkage?". This tool confirms the authoritative
 * MMSI from AIS itself, so we can compare against what's in the DB.
 *
 * Usage:
 *   node scripts/ais-ingest/find-vessel.mjs ADIYAMAN
 *   node scripts/ais-ingest/find-vessel.mjs ADIYAMAN med
 *   node scripts/ais-ingest/find-vessel.mjs "NORDIC STAR" baltic
 *
 * Regions: med (default) | baltic | ara | world
 */

import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

// ---- CLI args -----------------------------------------------------
const query = (process.argv[2] ?? "").trim().toUpperCase();
const region = (process.argv[3] ?? "med").toLowerCase();
if (!query) {
  console.error("usage: node find-vessel.mjs <NAME_PATTERN> [region]");
  console.error("regions: med (default) | baltic | ara | world");
  process.exit(1);
}

// ---- Load API key from .env.local --------------------------------
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
const apiKey = envText.match(/^AISSTREAM_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error("AISSTREAM_API_KEY missing from .env.local");
  process.exit(1);
}

// ---- Region bboxes -----------------------------------------------
const BBOXES = {
  med:    [[30.0,  -5.0], [46.0, 36.0]],   // Mediterranean
  baltic: [[54.0,  10.0], [66.0, 30.0]],   // Baltic Sea
  ara:    [[50.0,   1.0], [54.0,  6.0]],   // Amsterdam-Rotterdam-Antwerp
  world:  [[-85.0, -180], [85.0, 180.0]],  // Everything
};
const bbox = BBOXES[region];
if (!bbox) {
  console.error(`Unknown region "${region}". Use one of: ${Object.keys(BBOXES).join(", ")}`);
  process.exit(1);
}

// ---- Config --------------------------------------------------------
const LISTEN_SECONDS = 90;
console.log(`Listening for "${query}" in ${region.toUpperCase()} for ${LISTEN_SECONDS}s ...`);
console.log(`Bbox: ${JSON.stringify(bbox)}\n`);

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
const startedAt = Date.now();
const matches = new Map();       // mmsi → { name, lat, lon, count }
let totalMessages = 0;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [bbox],
      FilterMessageTypes: [
        "PositionReport",
        "ShipStaticData",
        "StandardClassBPositionReport",
      ],
    }),
  );
  console.log("[connected]");
});

ws.on("message", (data) => {
  totalMessages++;
  try {
    const msg = JSON.parse(data.toString());
    const mmsi = String(msg.MetaData?.MMSI ?? "");
    const shipName = String(msg.MetaData?.ShipName ?? "").trim().toUpperCase();
    if (!mmsi || !shipName) return;

    if (shipName.includes(query)) {
      const entry = matches.get(mmsi) ?? {
        name: shipName,
        lat: msg.MetaData.latitude,
        lon: msg.MetaData.longitude,
        count: 0,
      };
      entry.count++;
      entry.lat = msg.MetaData.latitude;
      entry.lon = msg.MetaData.longitude;
      matches.set(mmsi, entry);
      if (entry.count === 1) {
        console.log(`[MATCH] MMSI=${mmsi}  name="${shipName}"  at ${entry.lat.toFixed(3)}, ${entry.lon.toFixed(3)}`);
      }
    }
  } catch (err) {
    // Ignore parse errors — bad packets happen.
  }
});

ws.on("error", (err) => {
  console.error("[error]", err.message);
});

setTimeout(() => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n--- Summary after ${elapsed}s ---`);
  console.log(`Total messages seen in bbox: ${totalMessages}`);
  if (matches.size === 0) {
    console.log(`No vessel matching "${query}" broadcast in this window.`);
    console.log(`\nPossible reasons:`);
    console.log(`  1. Vessel is outside the ${region.toUpperCase()} bbox — try a different region`);
    console.log(`  2. Vessel broadcasts too rarely (moored/anchored, every ~3 min) — try again with longer window`);
    console.log(`  3. No AISStream community receiver in the vessel's vicinity`);
    console.log(`  4. Vessel name in AIS is spelled differently (AIS free-text, e.g. "M.T. ADIYAMAN")`);
  } else {
    console.log(`Found ${matches.size} match${matches.size > 1 ? "es" : ""}:`);
    for (const [mmsi, entry] of matches) {
      console.log(`  MMSI ${mmsi} · "${entry.name}" · ${entry.count} msg${entry.count > 1 ? "s" : ""} · pos ${entry.lat.toFixed(3)}, ${entry.lon.toFixed(3)}`);
    }
    console.log(`\nPut that MMSI on the linkage and the worker's next watchlist refresh (≤60s) will start tracking it.`);
  }
  ws.close();
  setTimeout(() => process.exit(0), 300);
}, LISTEN_SECONDS * 1000);
