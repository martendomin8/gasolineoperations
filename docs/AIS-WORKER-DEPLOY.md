# AIS Ingest Worker — Railway Deploy Walkthrough

**Purpose:** deploy `scripts/ais-ingest/worker.ts` as a persistent
Node.js service on Railway, so AIS positions flow into Postgres 24/7
without depending on anyone's laptop staying open.

**Who should do this:** whoever owns the infra (Marten for NEFGO).
Operator-level users never touch Railway.

## Prereqs

- Railway account (`railway.app`). Sign in with GitHub.
- Repo already on GitHub: `github.com/martendomin8/gasolineoperations`.
- Neon Postgres connection string (you already have this — it's in
  Vercel env vars as `DATABASE_URL`).
- AISStream.io API key (already in `.env.local` as
  `AISSTREAM_API_KEY` — get your own at `aisstream.io` if unsure).

## Steps

### 1. Create a Railway project from the GitHub repo

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Pick `martendomin8/gasolineoperations`.
3. Railway auto-detects `railway.json` + `nixpacks.toml` and
   configures:
   - Node.js 22 via Nixpacks
   - Install: `npm ci --include=dev`
   - Start: `npm run ais:worker`

At this point the service will fail to start — we haven't added
env vars yet. That's expected; proceed to step 2.

### 2. Add environment variables

Service → **Variables** tab → add:

```
AISSTREAM_API_KEY   = <your key>
DATABASE_URL        = <same Neon connection string as Vercel uses>
NODE_ENV            = production
```

**Important:** use the **pooled** Neon connection string for
`DATABASE_URL` (the one with `-pooler` in the host). The worker opens
a small pool (2 connections) so pgBouncer comfortably absorbs it.

After saving, Railway auto-redeploys and the worker should boot.

### 3. Verify it's running

Service → **Logs** tab → expect to see:

```
[ais-ingest] starting
[ais-ingest] endpoint wss://stream.aisstream.io/v0/stream
[ais-ingest] db postgresql:***@ep-...pooler...aws.neon.tech/neondb?sslmode=require&channel_binding=require
[watchlist] 0 MMSIs tracked
[ais-ingest] idle — waiting for watchlist to populate
```

If watchlist is empty (no linkage yet has a Q88 with MMSI), the
worker sits idle. That's correct — subscribing to AISStream with an
empty filter would flood us with global traffic we don't want.

As soon as an operator uploads a Q88 and the parser extracts an MMSI
onto a linkage, the next 60-second refresh cycle picks it up, opens
the WebSocket, and positions start landing in `vessel_positions`.

### 4. Recommended: set up log retention + alerts

Railway keeps logs for a limited window. For production:

- **Observability** tab → ship logs to Better Stack / Axiom / Logtail.
- **Heartbeat check:** worker logs `[heartbeat] X msg/min · Y rows/min
  · Z flags · N pending · M tracked` every 60 s. If this stops for
  more than 5 min while a watchlist has members, something's wrong.
- Wire a simple uptime monitor (UptimeRobot free tier) to ping
  Railway's public URL — actually the worker has no public URL (no
  web server), so instead monitor via log absence. Better Stack
  does this out of the box.

### 5. Cost envelope

- **Free tier (~$5 credit/month).** The worker uses ~50 MB RAM, ~1%
  CPU steady-state, negligible egress. Should stay comfortably under
  the free credit for the first ~1-2 months.
- After credit runs out, starter tier is $5/month flat for one
  always-on service. Still cheap.

### 6. Restart / redeploy

- **Railway auto-redeploys** on every GitHub push to `main`.
- Manual restart: service → **Settings** → **Restart**.
- Worker handles SIGTERM gracefully: flushes pending batches, closes
  DB pool, exits 0. No data loss on deploy.

## Troubleshooting

### Worker keeps restarting ("ON_FAILURE")

Check logs for the reason — most common:
- `AISSTREAM_API_KEY missing from .env.local` → env var not set,
  edit Variables tab.
- `DATABASE_URL missing from .env.local` → same.
- Repeated `[ws] parse error` → AISStream server-side issue, will
  self-resolve; logs only.

Note: the error message mentions `.env.local` even on Railway because
the worker's env loader preserves the dev-mode message. When running
on Railway, env vars come from Railway's injected environment — the
file just doesn't exist, which is fine.

### `[ws] closed · reconnecting in Xms` every few seconds

AISStream is closing us. Reasons:
1. Too many reconnects — AISStream rate-limits abusive keys. Wait
   5 min, then the exponential backoff recovers on its own.
2. Invalid API key — double-check `AISSTREAM_API_KEY` matches what's
   on aisstream.io dashboard.
3. Empty watchlist + old worker version — fixed in current code; if
   logs show "watchlist empty — not subscribing" and WS stays idle,
   we're good.

### DB writes timing out

Neon pooler might be idle-closing connections. The worker handles
this transparently via `postgres-js` reconnect — logs will show one
`[flush] write error: timeout` then the next cycle recovers. If it
persists for more than a few minutes:
- Check Neon dashboard → Metrics → active connections
- Ensure DATABASE_URL uses the pooled host (with `-pooler`)

### Retention not running

`[retention]` logs appear once on startup (~5 min in) and then once
every 24 h. If you don't see any after 5 min, something is wrong —
check logs for `[retention] sweep failed:` lines.

## Rollback plan

If a bad deploy breaks ingest:
1. Railway → **Deployments** tab → pick previous green deploy →
   **Redeploy**. Restores the prior code + env vars.
2. Railway keeps the last ~10 deploys. Plenty of margin.

The worker is stateless on disk — no backup needed. Postgres holds
all state; killing and restarting the worker loses at most the
current 2-second batch.
