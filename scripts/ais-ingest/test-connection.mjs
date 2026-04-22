/**
 * AISStream.io connection smoke test.
 *
 * Opens a WebSocket to the public AIS feed, subscribes to a single
 * bounding box (Baltic Sea — dense traffic, should get messages
 * within seconds), logs the first N decoded messages, then closes.
 *
 * Usage:   node scripts/ais-ingest/test-connection.mjs
 * Requires: AISSTREAM_API_KEY in .env.local
 *
 * This is a one-off smoke test — NOT the production ingest worker.
 * Purpose: confirm the key is valid, confirm message shape, decide
 * what fields the DB schema and UI need before writing production code.
 */

import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

// ---- Load API key from .env.local (avoid adding dotenv dependency) -----
const envPath = path.resolve("./.env.local");
const envText = fs.readFileSync(envPath, "utf8");
const match = envText.match(/^AISSTREAM_API_KEY=(.+)$/m);
if (!match) {
  console.error("ERROR: AISSTREAM_API_KEY not found in .env.local");
  process.exit(1);
}
const apiKey = match[1].trim();

// ---- Config -----------------------------------------------------------
const MAX_SECONDS = 15;
const MAX_MESSAGES = 10;
// Baltic Sea bbox — covers Tallinn/Helsinki/Stockholm/Gdansk approaches.
// AISStream wants bbox as [[lat_min, lon_min], [lat_max, lon_max]].
const BBOX_BALTIC = [
  [54.0, 10.0],
  [66.0, 30.0],
];

console.log("Connecting to wss://stream.aisstream.io/v0/stream ...");
console.log(`Bbox: Baltic (${BBOX_BALTIC[0]} → ${BBOX_BALTIC[1]})`);
console.log(`Will listen for ${MAX_SECONDS}s or ${MAX_MESSAGES} messages.\n`);

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
const startTime = Date.now();
let messageCount = 0;
const messageTypeCounts = new Map();
const sampleMessages = [];

ws.on("open", () => {
  console.log("[OPEN] Connected, sending subscription...");
  // Message types AISStream supports — we want them all for the smoke test
  // so we can see what's available. In production we'll pick a subset.
  ws.send(
    JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [BBOX_BALTIC],
      // Omitting FilterMessageTypes → receive all message types.
    }),
  );
});

ws.on("message", (data) => {
  messageCount++;
  const msg = JSON.parse(data.toString());
  const msgType = msg.MessageType ?? "UNKNOWN";
  messageTypeCounts.set(msgType, (messageTypeCounts.get(msgType) ?? 0) + 1);

  if (sampleMessages.length < MAX_MESSAGES) {
    sampleMessages.push(msg);
    console.log(`[MSG ${messageCount}] type=${msgType}`);
  }

  if (messageCount >= MAX_MESSAGES * 10) {
    // Plenty of data — close early.
    close("enough-samples");
  }
});

ws.on("error", (err) => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});

ws.on("close", () => {
  console.log("\n[CLOSE] Connection closed.");
});

// Hard timeout
const timer = setTimeout(() => close("timeout"), MAX_SECONDS * 1000);

function close(reason) {
  clearTimeout(timer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n--- Summary (${reason}, ${elapsed}s) ---`);
  console.log(`Total messages: ${messageCount}`);
  console.log("By type:");
  for (const [type, count] of [...messageTypeCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${type}: ${count}`);
  }

  // Show 1 full sample per message type — helps us see what fields exist.
  const seenTypes = new Set();
  console.log("\n--- Sample message per type ---");
  for (const msg of sampleMessages) {
    const type = msg.MessageType ?? "UNKNOWN";
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    console.log(`\n[${type}]`);
    console.log(JSON.stringify(msg, null, 2));
  }

  ws.close();
  setTimeout(() => process.exit(0), 500);
}
