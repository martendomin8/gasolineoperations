# Weather Pipeline

Python backend that fetches NOAA GFS forecast data and converts it
into PNG + JSON frames ready for the browser's `weatherlayers-gl`
particle layer. See `docs/weather-overlay-plan.md` for the full
architecture and week-by-week execution plan.

**Status (Week 2)**: full wind pipeline works end-to-end — fetch +
encode + upload + manifest update. Waves (encoder) and temperature
(scalar encoder) come in Weeks 3+. The GitHub Actions cron runs
4×/day once secrets are configured.

---

## Prerequisites

Python 3.10+ and the **ECCODES** C library (required by `cfgrib` to
parse GRIB2 files).

### Installing ECCODES

- **Ubuntu / Debian / WSL**: `sudo apt install libeccodes-dev`
- **macOS (Homebrew)**: `brew install eccodes`
- **Windows**: ECCODES has no first-class Windows installer. Use WSL2
  with Ubuntu, or run inside a Docker container. Production pipeline
  runs on GitHub Actions Ubuntu runners so this is only a local-dev
  concern.

### Python environment

From the repo root:

```bash
cd scripts/weather-pipeline
python -m venv .venv
source .venv/bin/activate        # on WSL / macOS / Linux
# .venv\Scripts\activate         # on Windows PowerShell
pip install -r requirements.txt
```

---

## Scripts

| File | Purpose |
|---|---|
| `fetch_gfs.py`       | Download one GFS 10 m wind forecast step via the NOAA NOMADS filter service. Returns a ~2–5 MB GRIB2 file (vs. the ~500 MB full forecast). |
| `fetch_gfs_wave.py`  | Download one GFS-Wave forecast step (Hs / period / direction). Same NOMADS filter pattern, different endpoint. |
| `encode_png.py`      | Parse a GRIB2 file, extract u and v wind components, reorient to web-map coordinates, and write an RGBA PNG + JSON sidecar compatible with `weatherlayers-gl`. |
| `upload_blob.py`     | PUT a file to Vercel Blob storage. Requires `BLOB_READ_WRITE_TOKEN`. |
| `update_manifest.py` | Load, mutate, and save `/weather/manifest.json` — the index the frontend reads to discover available runs and frames. |
| `run_pipeline.py`    | Orchestrator. Pulls one full cycle, encodes every forecast step, uploads each, updates the manifest. This is what the GitHub Actions cron calls. |

Later (Weeks 3+): `encode_scalar.py` (temperature + wave height),
wave-particle encoder (combines Hs / period / direction into a
vector-like PNG).

---

## Running the pipeline locally

### 1. Fetch the most recent forecast step

```bash
python fetch_gfs.py --latest --forecast-hour 24 --output-dir data/
```

This picks the most recent fully-published GFS cycle (NOAA publishes
00/06/12/18 UTC runs with a 4–5 hour lag) and downloads the 24-hour
forecast step. The file lands in `data/gfs_YYYYMMDD_HH_f024.grib2`.

To pin a specific cycle instead:

```bash
python fetch_gfs.py --cycle 2026042012 --forecast-hour 24 --output-dir data/
```

### 2. Encode to PNG + JSON

```bash
python encode_png.py data/gfs_20260420_12_f024.grib2 \
    --output-dir out/ \
    --basename wind_f024 \
    --cycle 2026-04-20T12:00:00Z \
    --forecast-hour 24
```

Outputs:
- `out/wind_f024.png`  — 1440 × 721 RGBA, u in R, v in G, mask in A
- `out/wind_f024.json` — `uMin`, `uMax`, `vMin`, `vMax`, `validTime`, etc.

### 3. Eyeball the output

Open `out/wind_f024.png` in any image viewer. You should see:

- A smooth global gradient. The **red** channel (u / eastward wind)
  shows stronger variation in mid-latitudes (westerlies) and reverses
  sign across equatorial / polar bands.
- The **green** channel (v / northward wind) shows the characteristic
  subtropical gyre circulation patterns.
- Continents visible only as subtle texture changes (wind is slightly
  different over land but not dramatically so).

If the PNG looks uniformly grey, check the JSON sidecar — the
`uMin`/`uMax`/`vMin`/`vMax` values should be roughly ±40 m/s for a
typical GFS run.

### 4. Confirm the PNG is web-shader-compatible

Open `out/wind_f024.json` in the browser while looking at the PNG.
Bounds should be `[-180, -90, 180, 90]` and the image should fill
that range edge-to-edge with no blank strips. If the prime meridian
appears on the left edge (not the middle), the longitude roll in
`reorient_to_web()` didn't run — check you're calling `encode_file()`
and not bypassing it.

---

## Troubleshooting

**`RuntimeError: NOMADS returned non-GRIB2 content`**
The cycle you asked for isn't published yet. Use `--latest` or a
cycle at least 5 hours old.

**`FileNotFoundError: libeccodes.so` / `cannot import name 'messages'`**
ECCODES isn't installed, or `cfgrib` can't see it. On Linux / WSL:
`sudo apt install libeccodes-dev`. On macOS: `brew install eccodes`.

**`KeyError: 'u10'` when opening the GRIB2 file**
The GRIB2 file was downloaded without the UGRD + VGRD variables (or
with the wrong level). Verify the NOMADS filter URL includes
`var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on`.

**`.idx` permission errors**
`cfgrib` caches a per-file index next to the GRIB2. `encode_png.py`
disables this with `backend_kwargs={"indexpath": ""}`. If a stale
`.idx` file is in your `data/` directory, delete it.

---

## Full-cycle end-to-end

Three publishing modes, pick by flag:

```bash
# (1) Local demo mode — no cloud setup required. Writes PNGs + manifest
# directly into the Next.js public/ directory; the browser fetches them
# same-origin. This is what Arne runs on his laptop for pitch demos.
python run_pipeline.py --latest --types=wind \
    --local ../../public/weather --verbose

# (2) Dry-run — fetch + encode only, skip upload, file:// URIs:
python run_pipeline.py --latest --dry-run --verbose

# (3) Production upload — Vercel Blob + manifest refresh. Requires
# secrets. See docs/MARTEN-HANDOFF.md for the setup.
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
export NEXT_PUBLIC_WEATHER_CDN_BASE_URL=https://<store-id>.public.blob.vercel-storage.com
python run_pipeline.py --latest --verbose
```

Default forecast steps: `0, 3, 6, ..., 36` (13 frames, one day
ahead). Override with `--forecast-steps 0,6,12,24`. A full run takes
about 5–6 minutes on a GitHub Actions runner (13 fetches × ~25 s +
uploads + manifest update).

## GitHub Actions cron

Workflow: `.github/workflows/weather-cron.yml`. Fires at 00/06/12/18
UTC (one hour after each NOAA cycle fully publishes). Manually
trigger via the Actions tab → "Weather pipeline" → "Run workflow".

**Required repo secrets** (Settings → Secrets and variables → Actions):

- `BLOB_READ_WRITE_TOKEN` — generate in Vercel dashboard under
  Storage → Blob → your store → Tokens.
- `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` — public base URL of the Blob
  store, e.g. `https://<store-id>.public.blob.vercel-storage.com`.

Each run uploads encoded PNGs/JSONs as a build artefact (retained 7
days) so you can eyeball what the cron produced without digging
through Blob.
