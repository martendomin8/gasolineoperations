# Weather overlay — production setup (Marten's handoff)

> **For**: Marten or whichever agent (future Claude Code session, or
> Marten running it manually) sets up the production infrastructure
> for the weather feature Arne and Claude built together in April
> 2026.
>
> **What's already done**: all the application code — Python
> pipeline, Next.js frontend module, GitHub Actions workflow.
> What's left is **the infrastructure plumbing**: where the PNG +
> JSON files live when the cron runs unattended, and where the
> browser fetches them from. See `docs/weather-overlay-plan.md` for
> the full architecture and `memory/project_windy_weather_overlay.md`
> for the history.

---

## What this feature is (60 seconds)

NEFGO's fleet map now has an overlay that animates **wind and
waves** Windy-style, driven by a **unified time-slider** that also
projects each tanker's position forward along its route. Drag the
slider six hours ahead, and both the wind particles and every
vessel marker slide forward in lock-step — "here's where my ships
are and what weather they'll hit".

Data source: **NOAA GFS + GFS-Wave**, US public-domain global
forecasts, published every 6 hours. A Python pipeline fetches the
latest cycle, converts the GRIB2 files to `weatherlayers-gl`-
compatible RGBA PNGs, and writes a manifest. The frontend reads
that manifest, loads the bracketing PNGs for the slider's current
time, and lets the GPU blend between them.

---

## Current state

Arne's laptop has the demo running end-to-end in **local mode**:

1. `python run_pipeline.py --latest --local ../../public/weather --types=wind`
2. The script writes PNGs + JSON + manifest into
   `public/weather/` inside the Next.js app.
3. Next.js serves them as static files (`/weather/...` URLs).
4. The frontend fetches them from the same origin.

No cloud storage, no secrets, no cron — just files on disk.
This is perfect for demos and investor pitches.

**What's missing for production**: the cron that runs
unattended every 6 hours, pushing outputs to a CDN the live
site fetches from. That's what this doc sets up.

---

## What you need to decide

Pick an object store. We need any globally-reachable HTTPS
endpoint that can serve ~20 MB of small PNG + JSON files.
Three reasonable options, in order of simplicity:

| Option | Cost | Pros | Cons |
|---|---|---|---|
| **Vercel Blob** | ~€0.15/GB storage, ~€0.30/GB egress. Our volume: ~40 MB stored + ~1-2 GB/month egress = ~€0.50/mo. | Native to our stack; identical DX to other Vercel primitives; no new account. | Per-deployment pricing can bite if we multi-tenant later. |
| **Cloudflare R2** | ~$0.015/GB storage, zero egress ("always free" up to 10 GB storage). Our volume = $0. | Effectively free at our scale; S3-compatible so easy to swap vendors later. | Requires a Cloudflare account and `boto3`-style client code. |
| **AWS S3** | ~$0.023/GB storage + egress. ~€0.10/mo for our volume + egress. | Universal, everyone knows it. | Separate billing; egress charges add up if we scale up. |

**Arne's plan assumed Vercel Blob** — the code in `upload_blob.py`
calls the Blob HTTP API directly. If you go with R2 or S3, swap
that one file (see "If you choose R2/S3" below).

---

## Path A: Vercel Blob (recommended default)

### 1. Create the Blob store

1. Vercel Dashboard → open the NEFGO project → Storage tab.
2. Click **Create Database → Blob**.
3. Name it something like `nefgo-weather` and leave the region on
   the default (whatever's closest to our audience, typically
   Frankfurt/Amsterdam for EU).
4. Once created, open it. You now have a **base URL** that looks
   like `https://<store-id>.public.blob.vercel-storage.com`.

### 2. Generate a read/write token

Inside the Blob store, go to the **Tokens** tab, click
**Create Token**, give it a label like `weather-cron`, pick
**Read/Write** scope. Copy the token — it looks like
`vercel_blob_rw_XXXXXXXXXXXXXXXX`. You can't view it again after
leaving the page, so save it to your password manager immediately.

### 3. Add the two secrets to GitHub

In the NEFGO GitHub repo, Settings → Secrets and variables →
Actions → **New repository secret**:

- **`BLOB_READ_WRITE_TOKEN`** — paste the token from step 2.
- **`NEXT_PUBLIC_WEATHER_CDN_BASE_URL`** — paste the base URL from
  step 1 (the `https://<store-id>.public.blob.vercel-storage.com`
  one, no trailing slash).

### 4. Mirror the CDN env to Vercel itself

Vercel doesn't inherit GitHub secrets automatically. In the
Vercel project settings → Environment Variables → add:

- `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` with the same value, scoped
  to Production (and Preview if you want branch deploys to see
  weather data too).

The `BLOB_READ_WRITE_TOKEN` does **not** need to be on Vercel —
only the cron (GitHub Actions) touches writes. Vercel only reads.

### 5. Trigger the first real cron

Go to the repo's Actions tab → **Weather pipeline** → **Run
workflow**. Leave the cycle field blank (defaults to `--latest`)
and dispatch.

First run takes ~5-10 minutes (installs apt packages for ECCODES,
spins up Python deps, fetches ~13 forecast steps of GFS + 13 of
GFS-Wave). You can watch the logs stream live. When it finishes,
the workflow also uploads the generated `out/` directory as a
workflow artefact — click it if you want to eyeball the PNGs
without hitting Blob.

### 6. Verify

Open the production site → `/fleet` → toggle Wind. You should
see animated wind trails over the map; the floating time-slider
at the bottom should show a valid range ("21 Apr 12:00 UTC +0.0h").
Drag it — particles re-weight in the shader, every vessel marker
slides forward along its route.

Toggle Waves → the wave particle layer should paint on top (blue →
green → yellow → red as heights rise).

**If nothing animates**:

- Open DevTools → Network → look for `/weather/manifest.json`
  (same-origin, 404 means env isn't set) or
  `<base>/weather/manifest.json` (remote, 404 means cron hasn't
  run yet or Blob upload is failing).
- Open the manifest URL in a new tab — it should be JSON with a
  `runs` array. An empty array means the cron has run but all
  frames failed.
- Check the latest Weather Pipeline run in Actions — the first
  `[WeatherLayer] failed to load frame` or `[WeatherLayer] failed
  to decode PNG` in the browser console usually has the actual
  cause.

### 7. Set the cron's long-term cadence

The workflow is scheduled for `0 */6 * * *` UTC (00/06/12/18) to
match NOAA's cycle publish times plus a one-hour buffer. No
action needed unless you want to reduce frequency (rare; running
less often just means staler forecasts). Never push the schedule
faster than 6 hours — NOAA doesn't publish new cycles more often
than that, so extra runs buy nothing.

---

## Path B: Cloudflare R2 (if you want truly free)

Same shape as above, with a tiny code swap:

1. In Cloudflare: **R2 → Create bucket** → `nefgo-weather`.
   Enable **Public access** so the frontend can fetch without
   signed URLs, and copy the public `r2.dev` URL.
2. Create an **R2 API token** with Read/Write on this bucket.
   Note the access key ID + secret.
3. Replace `scripts/weather-pipeline/upload_blob.py` with a
   boto3-based uploader against the R2 S3-compatible endpoint:

   ```python
   import boto3
   s3 = boto3.client(
       "s3",
       endpoint_url="https://<account-id>.r2.cloudflarestorage.com",
       aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
       aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
       region_name="auto",
   )
   s3.upload_file(str(local_path), "nefgo-weather", blob_pathname,
                  ExtraArgs={"ContentType": content_type})
   public_url = f"{R2_PUBLIC_BASE}/{blob_pathname}"
   ```

4. Keep the same `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` env var —
   point it at the R2 public URL instead of the Vercel Blob URL.
5. GitHub secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
6. Update `.github/workflows/weather-cron.yml` to export those
   instead of `BLOB_READ_WRITE_TOKEN`.

Everything else (manifest shape, frontend code, cron schedule,
GitHub Actions definition) stays the same.

---

## Path C: AWS S3

Essentially identical to R2 — same boto3 code, just drop the
`endpoint_url` arg and use a real AWS region. Bucket needs a
**public-read** policy on its contents plus **CORS enabled**
(the browser fetches across origins). Use CloudFront if you want
proper CDN caching at scale.

---

## What NOT to do

- **Do not** commit the `BLOB_READ_WRITE_TOKEN` (or any other
  storage credential) to the repo. Even in `.env.example`. It
  lives only in GitHub secrets + Vercel env vars + your password
  manager.
- **Do not** use `Open-Meteo Marine` as a data source. It's
  CC-BY-NC licensed — incompatible with commercial / SaaS
  deployments. We've ruled it out. Stick to NOAA (public domain).
- **Do not** skip `libeccodes-dev` in the workflow. `cfgrib` in
  the Python pipeline requires the ECCODES C library at OS level;
  the apt install is ~30 seconds and non-optional.
- **Do not** change the `x-add-random-suffix: 0` header in
  `upload_blob.py`. We rely on deterministic pathnames —
  `/weather/<runId>/wind_f024.png` — so the manifest's URL stays
  stable across runs and the frontend's LRU cache actually hits.

---

## Cost ceiling (back-of-envelope)

Our pipeline writes ~150 KB per forecast step. With wind + waves
× 13 steps per run × 4 runs/day, that's ~16 MB/day new data.
After pruning to "last 2 runs" kept, steady-state storage is
~40 MB.

Frontend egress depends on how many operators view the fleet map.
Typical session: loads manifest (~10 KB), then maybe 4-8 frames
(~150 KB each) as the slider gets scrubbed. Call it 1 MB per
session. At 50 operators × 20 sessions/day = ~1 GB/month egress.

Vercel Blob pricing as of 2026: ~€0.50/month. Cloudflare R2: €0.
AWS S3: ~€0.10/month. All comfortably under the noise floor —
don't over-engineer this.

---

## Cost ceiling if clients run on-premise

For commodity-trading firms that refuse cloud, Arne's longer-term
plan is to support on-premise deployments. This feature works
fine there: the client's IT team stands up a small box (or
container) that runs the Python pipeline and serves the output
directory via any HTTPS server (nginx, Caddy, etc.). Then
`NEXT_PUBLIC_WEATHER_CDN_BASE_URL` points at that internal URL.
No external dependencies beyond NOAA. Fits the "on-premise
deployable" promise from `docs/MARITIME-ROADMAP.md`.

---

## Questions that will probably come up

**Q: Can we keep more than 2 runs of history?**
Yes — edit `MAX_KEEP_RUNS` in `run_pipeline.py`. Storage doubles
roughly linearly. Fine up to maybe 8-10 runs before the manifest
JSON starts feeling large.

**Q: Can the cron run more often than every 6 hours?**
No benefit — NOAA publishes once per cycle, so running at 2 a.m.
and 3 a.m. just re-fetches the same data. The cron skips a run
that would duplicate the latest published cycle (see
`latest_cycle()` in `fetch_gfs.py`).

**Q: Does the frontend break if the cron stops?**
No — the LRU cache keeps the last-loaded frames in memory, and
the manifest carries a `generatedAt` timestamp we can surface in
the UI for a "data freshness" badge later. If the manifest is
completely absent the layer toggles just silently fail (no
particles render), but the rest of the fleet map works.

**Q: Do we need a Preview deployment secret too?**
Only if you want the Preview-deployed branches to animate weather.
Production is the primary target. Setting the env var on Preview
scope is a 30-second nice-to-have.

**Q: Is there a way to test this without Vercel Blob?**
Yes — Arne's local mode. `python run_pipeline.py --latest --local
public/weather` writes files into the Next.js public directory
and leaves `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` empty. Same
frontend code, same URLs (just `/weather/...` instead of the CDN
domain). Useful for pre-production verification on any branch.

---

## Who to ping if something breaks

- **Arne** (app code, pipeline Python, frontend React).
- **NOAA NOMADS status page**: https://nomads.ncep.noaa.gov —
  they have occasional outages (especially during federal-
  government-shutdown-style weeks). The pipeline degrades
  gracefully; a skipped cycle just leaves the previous run in
  the manifest until NOAA recovers.
- **Vercel status**: https://www.vercel-status.com — Blob outages
  are rare but they happen; the frontend falls back to cached
  frames in the browser LRU.

---

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Claude (for Arne) | Initial handoff doc, written when the app side was feature-complete but production infra was pending Marten's involvement. |
