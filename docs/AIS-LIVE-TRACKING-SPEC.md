# AIS Live Vessel Tracking — Scoping Spec

**Status:** Draft v0.1 · Author: ops session 2026-04-21 · Reviewer: Arne
**Goal:** Build a MarineTraffic-like live vessel tracking layer integrated
with the NEFGO Fleet map, sourced from AISStream.io (free) with
MarineTraffic API as a paid upgrade path.

## 1. Why this, why now

Commodity operators need to see **where their cargo actually is**, not just
where the nomination says it should be. Today the Fleet page shows static
vessel markers placed from `linkage.vessel_name` / `vessel_imo` — no live
position. Every MarineTraffic-style competitor charges €2–5k/month for
global AIS; that kills the "just built in" pitch for NEFGO.

**Insight:** ~85% of commodity flow we care about passes through coastal
chokepoints (ARA, Mediterranean, AG, Singapore Strait, Baltic, US Gulf,
Black Sea). Coastal AIS is covered by volunteer terrestrial receiver
networks and is legally free to consume. Open ocean is expensive (satellite
AIS) — and also mostly uninteresting mid-voyage.

Strategy: build on AISStream.io for V1, keep provider interface swappable
so MarineTraffic API can be dropped in per-deployment when a paying client
needs global coverage.

## 2. What AISStream.io actually gives us

Confirmed via smoke test on 2026-04-21 (`scripts/ais-ingest/test-connection.mjs`):

- **Endpoint:** `wss://stream.aisstream.io/v0/stream` (WebSocket, JSON)
- **Auth:** API key in subscription payload
- **Rate (Baltic bbox):** ~30 useful msg/s
- **Coverage:** global coastal (terrestrial community receivers, ~50 km
  from coast). Open ocean mostly blind.
- **Filtering at source:** bounding box list + message-type list. We can
  also implicitly filter by MMSI client-side.

### Message shapes we care about

**`PositionReport`** — Class A vessels (tankers, bulkers, container, etc.)
Every few seconds per vessel while underway.
```json
{
  "MessageType": "PositionReport",
  "Message": {
    "PositionReport": {
      "Latitude": 59.18522,
      "Longitude": 10.88169,
      "Cog": 28.8,              // course over ground, degrees
      "Sog": 15,                 // speed over ground, knots (×10, so 15 = 1.5 kn)
      "TrueHeading": 29,         // degrees, 511 = not available
      "NavigationalStatus": 0,   // 0=underway, 1=anchored, 5=moored, etc.
      "UserID": 257964900,       // MMSI
      "Timestamp": 33            // seconds of the minute
    }
  },
  "MetaData": {
    "MMSI": 257964900,
    "ShipName": "RS 131 - TBN        ",  // trailing spaces, trim needed
    "latitude": 59.18523, "longitude": 10.8817,
    "time_utc": "2026-04-21 19:43:35.584524619 +0000 UTC"
  }
}
```

**`ShipStaticData`** — name, IMO, dimensions, draught, destination.
Broadcast every 6 minutes while underway, 3 min at anchor.
```json
{
  "MessageType": "ShipStaticData",
  "Message": {
    "ShipStaticData": {
      "ImoNumber": 9588988,
      "Name": "BRATTSKJAER         ",
      "CallSign": "3YKA   ",
      "Destination": "CH 16 FOR INFO      ",
      "Eta": { "Month": 11, "Day": 25, "Hour": 23, "Minute": 30 },
      "Type": 30,                    // vessel type code (30 = fishing, 80 = tanker, etc.)
      "MaximumStaticDraught": 6.8,   // metres
      "Dimension": { "A": 30, "B": 14, "C": 4, "D": 7 },  // bow/stern/port/stbd distances
      "UserID": 259855000            // MMSI — ties to PositionReport
    }
  },
  ...
}
```

**`StandardClassBPositionReport`** — smaller craft (fishing, pleasure).
Lower rate. Probably ignore for V1 (commodity focus).

**Skip:** `DataLinkManagementMessage`, `UnknownMessage`, `AidsToNavigationReport`,
`Interrogation`, `StaticDataReport` (Class B static).

### Key quirks

- `Sog` is in **0.1-knot units** (the value 15 means 1.5 kn). Divide by 10.
- `TrueHeading` = 511 → heading unknown (use Cog instead for rendering).
- `NavigationalStatus` = 15 → default/undefined.
- MMSI is the join key between `PositionReport` and `ShipStaticData` —
  IMO comes only from static messages.
- `ShipName` padded with trailing spaces — trim before storing.
- Coordinates in `MetaData` are rounded; use the `Message` values for precision.

## 3. Architecture

### 3.1 Provider pattern (matches weather + parseRecap)

```
src/lib/maritime/ais/
  ├── types.ts          // VesselPosition, VesselStatic, AisProvider types
  ├── provider.ts       // AisProvider interface (what the UI consumes)
  └── providers/
      ├── aisstream/    // V1 — free WebSocket
      └── marinetraffic/  // later — paid REST API
```

UI reads through `useAisProvider()` hook, analogous to `useWeatherProvider()`.
Env var `NEXT_PUBLIC_AIS_PROVIDER=aisstream|marinetraffic` picks the impl.

### 3.2 Ingest worker (runs separately from Next.js)

Next.js API routes are request/response — they can't hold a WebSocket open
for hours. We need a long-running Node process.

```
scripts/ais-ingest/
  ├── worker.ts        // production worker: WS → upsert into Postgres
  ├── state.ts         // in-memory MMSI whitelist (from linkages)
  └── test-connection.mjs  // the smoke test (already exists)
```

**Options for where this runs** (user decision needed — see §8):
- **A) Railway / Fly.io / Render** — free-tier OK, ~$5/mo paid tier. Easiest.
- **B) VPS (Hetzner €4/mo)** — full control, no vendor lock.
- **C) Same host as the cron (GitHub Actions)** — won't work for persistent WS.
- **D) Vercel** — doesn't support long-running processes. Won't work.

Recommend A (Railway) for MVP; migrate to B when paid client has privacy requirements.

### 3.3 Database (Postgres — already there)

Two tables, tenant-scoped per CLAUDE.md rules:

**`vessels`** — static data cache, one row per MMSI.
```sql
CREATE TABLE vessels (
  mmsi            BIGINT PRIMARY KEY,
  imo             INTEGER,
  tenant_id       UUID,                  -- null = global, else tenant-specific note/tag
  name            VARCHAR(120),
  call_sign       VARCHAR(20),
  ship_type       INTEGER,               -- AIS type code (80 = tanker)
  length_m        SMALLINT,              -- dim.A + dim.B
  beam_m          SMALLINT,              -- dim.C + dim.D
  draught_m       REAL,
  destination     VARCHAR(120),
  eta             TIMESTAMPTZ,
  static_updated  TIMESTAMPTZ NOT NULL,  -- last ShipStaticData received
  first_seen      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_vessels_imo ON vessels(imo);
```

**`vessel_positions`** — current + historical. Hot data.
```sql
CREATE TABLE vessel_positions (
  id              BIGSERIAL PRIMARY KEY,
  mmsi            BIGINT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  cog             REAL,                  -- course over ground, 0-360
  sog             REAL,                  -- speed over ground, knots
  heading         SMALLINT,               -- 0-359 or null if 511
  nav_status      SMALLINT,
  received_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_vp_mmsi_time ON vessel_positions(mmsi, received_at DESC);
CREATE INDEX idx_vp_received  ON vessel_positions(received_at);
```

**Retention:** trim to last 14 days on a daily cron (decision 2026-04-21).
Hot data only — if operators need older positions, query MarineTraffic
paid API on demand.

**Write strategy:** worker batches inserts every 1–2 s (COPY or multi-row
INSERT) to keep Postgres happy under load. At ~30 msg/s filtered down to
our tracked vessels (~50–200 MMSIs), this is trivial volume.

### 3.4 UI integration (on existing Fleet page)

- New layer toggle: **"Live AIS"** alongside Wind/Waves/Temperature toggles.
- When on: fetch positions every 15 s via `/api/maritime/ais/snapshot`
  (last-known-per-mmsi for our tracked MMSIs). Render as `<Marker>`s with
  rotation = heading (or cog if heading unavailable).
- Click a marker → popup with: name, IMO, speed, heading, nav status,
  destination, ETA, last update (× seconds ago).
- **Colour-code by match:** green = matches a linkage's `vessel_imo`,
  grey = known vessel in the fleet but no active linkage, amber = MMSI we
  have never seen (only if "show all tracked" mode is on).
- **Stale indicator:** if `received_at > 10 min ago`, draw the marker
  semi-transparent. AIS is unreliable; operators need to know they're
  looking at old data.

## 4. MVP scope

### In
1. AISStream worker ingesting PositionReport + ShipStaticData for a
   **whitelist of MMSIs** derived from `linkages.vessel_imo` (via lookup).
2. Postgres tables + retention cron.
3. `/api/maritime/ais/snapshot` — returns last-known position for each
   tracked MMSI.
4. New toggle + marker layer on Fleet page.
5. Click popup with vessel details + live data.
6. Stale-data visual signal.
7. AisProvider abstract interface (enables MarineTraffic swap later).

### Out (defer to V2)
- Historical track replay (we store it, but UI for scrubbing waits).
- Dark fleet / AIS-off detection.
- Port approach / ETA prediction from live data.
- Global "show everything" mode (volume too high, UX bad).
- Cross-tenant sharing (each tenant sees only its own linkage vessels).
- Own receiver hardware (AISStream is enough for V1).

## 5. Volume + cost envelope

- **Ingest:** ~30 msg/s coastal world (estimate from Baltic × ~30 hot
  regions globally → ~1000 msg/s raw → we filter to our MMSIs = <1 msg/s
  after filter). **Negligible.**
- **Storage:** ~10 MMSIs × 1 position / 30s × 30 days = ~900k rows. ~100 MB.
  **Negligible.**
- **Egress:** WebSocket 24/7 = ~5–20 GB/month inbound. Free on Railway /
  most hosts.
- **Worker host:** Railway free tier covers it; ~$5/mo paid is comfortable.
- **API cost:** **€0/month** for AISStream V1.

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| AISStream commercial TOS unclear | Legal exposure if we sell | Open GitHub issue asking; fall back to MarineTraffic if blocked |
| AISStream goes offline / rate-limits | Product half-broken | Provider abstraction = MarineTraffic swap is a config change |
| Open-ocean voyages blind | Operator thinks data is live when it's actually stale | Stale indicator on markers; show "last seen X h ago" prominently |
| MMSI ↔ IMO join wrong (MMSI changes on re-flag) | Wrong vessel on map | ShipStaticData gives us authoritative MMSI→IMO map; re-verify daily |
| Worker crash drops positions silently | Missing data, operator doesn't notice | Heartbeat endpoint, Sentry / healthcheck |

## 7. Implementation sequence

1. **This PR (no code yet — just this spec + env vars + provider interface skeleton).**
2. PR 2: DB migration for `vessels` + `vessel_positions`.
3. PR 3: Worker (`scripts/ais-ingest/worker.ts`) — ingest loop, batched writes.
4. PR 4: API route `/api/maritime/ais/snapshot` + AisProvider `aisstream` impl.
5. PR 5: Fleet page layer toggle + markers + popup.
6. PR 6: Stale indicator + colour coding + retention cron.
7. PR 7: Deploy worker to Railway/Fly, wire GitHub secrets.

Each PR reviewable in isolation, each ships incrementally.

## 8. Decisions made (2026-04-21)

1. **Worker host:** Railway (~$5/mo, first month free via signup credit).
   GitHub-push deploy, handles always-on Node.js process trivially. Fly.io
   / Oracle Cloud Free kept as fallback if we outgrow Railway's free credit.
2. **Tracked vessel policy:** Strictly our own vessels — MMSIs derived
   from linkages that have a Q88 uploaded (Q88 contains MMSI alongside
   IMO). No watchlist, no competitor tracking. New vessel added to a
   linkage → appears on map as soon as its MMSI starts broadcasting
   within coastal coverage.
3. **AISStream commercial TOS:** **Not blocking now** (internal use only,
   not selling). Must be resolved before commercial launch. Saved as a
   memory note — see §11.
4. **Retention window:** 14 days. Shorter than my V1 proposal; plenty
   for operational troubleshooting, keeps the hot table small.
5. **Multi-tenant scope:** Single tenant V1, confirmed.
6. **UI placement:** Toggle on existing Fleet page, confirmed.

## 9. Hybrid position strategy (the differentiator)

This is the architectural bet that makes the feature more than "a free
MarineTraffic clone". Each vessel marker has **one** screen position,
but its source flips between three modes:

| Mode | Trigger | Source | Marker style |
|---|---|---|---|
| **LIVE** | AIS message < 10 min old | `vessel_positions.lat/lon` | Green, bright |
| **DEAD RECKONING** | AIS 10 min – 2 h old | Extrapolate from last AIS: `cog` + `sog`, straight line | Amber, "last seen Xm ago" |
| **PREDICTED** | AIS > 2 h old OR never received | Our ocean-routing graph from `loadport → discharge_port`, speed from Q88 CP speed (fallback 12 kn) | Grey, dashed outline, "predicted" label |

**Fallback chain when an AIS point comes in after a prediction gap:**
- Marker tweens (500 ms animation) from predicted → actual position.
- If displacement > 5 nm, log a `ais_prediction_correction` row in DB
  (mmsi, predicted_lat/lon, actual_lat/lon, delta_nm, at). Enables future
  analysis of "how accurate was our CP-speed prediction?" vs "was it the
  AIS gap or our ETA model?".

**Implementation layering:**
```
position selector (`src/lib/maritime/ais/position-resolver.ts`):
  given (linkage, now):
    1. fetch latest AIS row for linkage.mmsi
    2. if ageMs < 10_min            → LIVE   { lat, lon, source: 'ais' }
    3. if ageMs < 2_hours           → DEAD_RECK (extrapolate cog/sog)
    4. else                         → PREDICTED (call ocean-routing from
                                        last-known or loadport, clamp to
                                        "how far vessel would have sailed
                                        at CP speed since now-ageMs")
```

This resolver becomes the **single source of truth** for where to draw
a vessel on the Fleet map — both the current static-marker flow and the
new live-AIS flow converge through it. Removes the split between "AIS
layer" and "route layer" UIs, which gets confusing fast.

## 10. Updated implementation sequence

1. ~~Spec + env vars + interface skeleton~~ — **done.**
2. **PR 2:** DB migration — `vessels`, `vessel_positions`, and
   `ais_prediction_corrections` tables. Add `mmsi` column to `linkages`.
3. **PR 3:** Position resolver (`position-resolver.ts`) — pure function,
   no UI, fully unit-tested (deterministic: given timeline + CP speed,
   compute expected position).
4. **PR 4:** Worker (`scripts/ais-ingest/worker.ts`) — WebSocket loop,
   batched writes. Runs locally with `npm run ais:dev` for dev.
5. **PR 5:** API route `/api/maritime/ais/snapshot` + `aisstream` provider
   implementation. Hooks UI into resolver.
6. **PR 6:** Fleet page — toggle, marker rendering with LIVE/DEAD_RECK/
   PREDICTED styles, click-popup with last-seen info.
7. **PR 7:** Railway deploy config (`railway.json` + start script), GitHub
   secrets, 14-day retention cron.
8. **PR 8 (optional):** Prediction-correction analysis page (admin only).

## 11. Memory — must do before commercial launch

> **AISStream.io commercial TOS.** Before NEFGO sells access to any
> tenant outside our own ops team, open a GitHub issue at
> https://github.com/aisstream/ais-message-models (or whichever is the
> active repo — check their site) asking:
> "We are building a commercial maritime logistics product. Does the
> AISStream free tier permit this use? Is there a commercial tier /
> licence we can pay for?" Save the reply. If answer is "no", swap the
> provider implementation to MarineTraffic API (~€200/mo entry tier)
> before the first paid customer onboards. This is a config change, not
> a rewrite — that's why we built the abstract `AisProvider` interface.

## 12. Out-of-scope (V2+ brainstorm)

- **Dark fleet overlay** — vessels that turn off AIS at known sanctioned
  loading points (Primorsk, Kozmino, Ust-Luga). Would need our own
  heuristics + historical data. High product value.
- **Demurrage-risk live** — vessel at anchor near our discharge port,
  count the hours, flash when exceeding laycan.
- **STS visualisation** — two tanker markers overlapping at anchor =
  likely STS. Flag + timeline.
- **Port lineup** — list view per terminal showing which vessels are
  inbound / alongside / outbound with their ETAs.
- **Prediction accuracy dashboard** — using the
  `ais_prediction_corrections` data, show how well our CP-speed + ocean
  routing actually predicts vessel positions. If our predictions are
  consistently optimistic by 10%, that's a laycan-risk signal we can
  surface proactively.
