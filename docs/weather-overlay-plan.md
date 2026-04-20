# Weather Overlay — Implementation Plan

> **Status**: Living document. Captures the concrete architecture, file
> layout, and week-by-week execution plan for the Windy-style weather
> overlay feature.
>
> **Companion docs**: `MARITIME-ROADMAP.md` §7 (vision + provider
> abstraction), `CLAUDE.md` (product + domain), memory file
> `project_windy_weather_overlay.md` (brainstorm history).

---

## Product intent (one paragraph)

Overlay Windy-style animated weather layers (wind particles, waves,
temperature) on the existing MapLibre fleet map. A single global
time-slider advances **both** the ship marker along its route **and**
the weather layers in lock-step. Operator drags the slider, sees
"vessel is in Biscay in 3 days, 5 m waves expected there". Unique
value over Windy alone: weather in voyage context, ETA-risk
visualisation, NOR/demurrage screenshot evidence. Unique value over
Netpas alone: actual weather.

---

## Architectural decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Rendering library | **`weatherlayers-gl`** (MPL-2.0) | MapLibre v5+ native particle layer; `imageWeight` API gives GPU frame-blending out of the box, which is exactly the unified-slider primitive we need. |
| Data source | **NOAA GFS + GFS-Wave** from AWS S3 Open Data | Public domain, commercial-clean, rate-limit-free AWS mirror. Avoids Open-Meteo CC-BY-NC trap. |
| Data format on CDN | **u/v-encoded PNG + JSON sidecar** (per Agafonkin / mapbox-webgl-wind convention) | Tiny (~80–200 KB per frame), browser-native decode, standard format `weatherlayers-gl` accepts. |
| Pipeline host | **GitHub Actions cron** | Free tier covers 4×/day cadence, ECCODES installable in the runner, keeps infra inside the GitHub + Vercel ecosystem. Fallback: Hetzner CX11 VPS if runner limits bite. |
| Storage / CDN | **Vercel Blob** | Already in stack, global CDN, public URLs, cheap (<$0.50/mo for our volume). |
| Scope | **Global coverage, real live data, from day 1** | NOAA GFS is global by default; regional crops save nothing. No mock data — pipeline is live from week 1. |
| Swappability | **`WeatherProvider` interface** with NEFGO + Windy implementations | Same pattern as `parseRecap()` AI abstraction. Clients swap via one env var at deploy time. |

---

## Data flow

```
[NOAA AWS S3 Open Data]                    # public mirror, no auth, no rate limits
        │
        │  4×/day at 05/11/17/23 UTC (≈ 1 h after NOAA publishes the cycle)
        ▼
[GitHub Actions cron]                       # .github/workflows/weather-cron.yml
    ├─ fetch_gfs.py           GFS 0.25°:  u10, v10, t2m
    ├─ fetch_gfs_wave.py      GFS-Wave:   HTSGW, PERPW, DIRPW
    ├─ encode_png.py          u/v field  → RGBA PNG + JSON sidecar (uMin / uMax / vMin / vMax)
    ├─ encode_scalar.py       scalar     → 1-channel PNG + ramp metadata
    ├─ upload_blob.py         → Vercel Blob via HTTP API
    └─ update_manifest.py     → /weather/manifest.json (latest runId + available frames)
        │
        ▼
[Vercel Blob CDN]
    /weather/manifest.json                                 { runs: [{runId, frames}], latest }
    /weather/{runId}/wind_f{hrs}.png  + .json              vector field, per forecast step
    /weather/{runId}/waves_f{hrs}.png + .json              vector field
    /weather/{runId}/temp_f{hrs}.png  + .json              scalar field
        │
        ▼
[Next.js client — fleet/page.tsx]
    ├─ useWeatherProvider()              # factory based on env
    ├─ useWeatherFrame(type, t)          # → { image, image2, imageWeight }   ← GPU interp primitive
    └─ useShipAtTime(route, t)           # → [lat, lon]                        ← same t
        │
        ▼
[WeatherLayers GL ParticleLayer]         # imageWeight drives particle blending
        │
        ▼
[MapLibre GL]  ←→  [existing route / port / zone layers]
        │
        ▼
[TimeSlider component]   # one t value → moves ship marker AND weather layers IN SYNC
```

**Killer-feature primitive**: `TimeSlider.value = t` →
`useShipAtTime(route, t)` **and** `useWeatherFrame(type, t)` consume
the same `t`. One slider, two effects, native GPU blending.

---

## File plan

### New files (isolated module, swappable provider)

```
src/lib/maritime/weather/
├── types.ts                        WeatherFrame, WeatherType, WeatherManifest, TimeRange
├── provider.ts                     abstract WeatherProvider interface
├── time-sync.ts                    global time state (Jotai / Zustand, module-local store)
├── interpolation.ts                getDatetimeWeight, bracket-frame logic
├── providers/
│   ├── nefgo/
│   │   ├── index.ts                NefgoWeatherProvider
│   │   ├── manifest-loader.ts      fetches /weather/manifest.json
│   │   ├── frame-fetcher.ts        PNG + sidecar loader, memoised cache
│   │   └── config.ts               CDN base URL from env
│   └── windy/
│       └── index.ts                WindyWeatherProvider — stub, implemented in v1.5
├── components/
│   ├── weather-layer.tsx           <WeatherLayer provider type time /> — weatherlayers-gl wrapper
│   ├── weather-controls.tsx        on/off per layer (wind / waves / temp)
│   ├── time-slider.tsx             global time slider + play / pause
│   └── ship-weather-popup.tsx      "this ship sees 5 m waves, 22 kt headwind"
└── hooks/
    ├── use-weather-provider.ts     factory based on env
    ├── use-weather-frame.ts        (type, t) → { image, image2, weight }
    ├── use-ship-at-time.ts         (route, t) → [lat, lon]
    └── use-time-state.ts           global time hook
```

```
scripts/weather-pipeline/            Python backend (lives outside Next.js runtime)
├── requirements.txt                 cfgrib, xarray, pillow, requests, boto3
├── fetch_gfs.py                     AWS S3 → local GRIB2
├── fetch_gfs_wave.py
├── encode_png.py                    u/v → PNG + JSON sidecar
├── encode_scalar.py                 scalar field → PNG + ramp
├── upload_blob.py                   Vercel Blob API
├── update_manifest.py               manifest writer
├── run_pipeline.py                  orchestrator (main entry)
└── README.md                        how to run locally

.github/workflows/
└── weather-cron.yml                 cron @ 05/11/17/23 UTC
```

### Extended files (already in repo)

| File | What we add |
|---|---|
| `src/app/(authenticated)/fleet/fleet-map-maplibre.tsx` | Mount `<WeatherLayer>` per type; wire ship marker to `useShipAtTime(route, t)`. |
| `src/app/(authenticated)/fleet/page.tsx` | Mount `<TimeSlider />` and `<WeatherControls />`. |
| `src/lib/maritime/sea-distance/waypoints.ts` | Export `interpolateRouteAtTime()` — foundation for `useShipAtTime`. |
| `package.json` | `weatherlayers-gl`, `@deck.gl/mapbox`, `@deck.gl/core`, `@deck.gl/layers`, `@luma.gl/*` peers. |
| `.env.example` | `NEXT_PUBLIC_WEATHER_PROVIDER=nefgo`, `NEXT_PUBLIC_WEATHER_CDN_BASE_URL=...`. |
| `THIRD_PARTY_LICENSES.md` (new, root) | MPL-2.0 attribution for `weatherlayers-gl`. |

### Untouched

Nothing in existing routing / ocean-routing / Excel / dashboard /
deals code. The weather module is **purely additive**.

---

## Provider interface

```typescript
// src/lib/maritime/weather/provider.ts

export type WeatherType = "wind" | "waves" | "temperature";

export interface WeatherFrame {
  image: HTMLImageElement | ImageBitmap;
  bounds: [west: number, south: number, east: number, north: number];
  validTime: Date;
  metadata: {
    // vector fields:
    uMin?: number; uMax?: number;
    vMin?: number; vMax?: number;
    // scalar fields:
    scalarMin?: number; scalarMax?: number;
    unit?: string;  // "m/s" | "K" | "m"
  };
}

export interface BracketFrames {
  before: WeatherFrame;
  after:  WeatherFrame;
  weight: number;   // 0..1 — how far we are between before and after (GPU mix)
}

export interface WeatherProvider {
  getAvailableRange(type: WeatherType):  Promise<{ start: Date; end: Date }>;
  getFrameTimes(type: WeatherType):      Promise<Date[]>;
  getFrame(type: WeatherType, t: Date):  Promise<WeatherFrame>;
  getBracketingFrames(type: WeatherType, t: Date): Promise<BracketFrames>;
  preload?(type: WeatherType, w: { start: Date; end: Date }): Promise<void>;
}
```

This supersedes the simpler sketch in `MARITIME-ROADMAP.md` §7
(`getPointForecast` / `getTileUrl`). The bracketing-frames API is
what makes GPU-side time interpolation possible, which is the
feature's headline.

---

## Week-by-week execution

### Week 1 — Backend pipeline (proof of concept)
- [ ] Verify `cfgrib` + ECCODES install cleanly on GitHub Actions `ubuntu-latest` runner (test workflow). Fallback plan: Hetzner VPS if bundle size too big.
- [ ] `fetch_gfs.py` — pull one GFS file from AWS S3 Open Data.
- [ ] `encode_png.py` — GRIB2 u/v → PNG + JSON sidecar; eyeball the PNG to confirm the u-channel gradient looks sane.
- [ ] Upload one PNG manually to Vercel Blob; `curl` that it's globally fetchable.
- **Milestone**: one PNG file on Blob CDN, globally fetchable.

### Week 2 — Cron online, frontend module scaffold
- [ ] `.github/workflows/weather-cron.yml` — 4×/day cadence.
- [ ] `fetch_gfs_wave.py` lives (waves).
- [ ] `update_manifest.py` emits JSON manifest after each successful run.
- [ ] `src/lib/maritime/weather/` scaffold: `types.ts`, `provider.ts`.
- [ ] `NefgoWeatherProvider` stub — reads the manifest, nothing rendered yet.
- **Milestone**: cron runs autonomously overnight; manifest refreshes.

### Week 3 — First WeatherLayers GL integration
- [ ] `npm install weatherlayers-gl @deck.gl/mapbox` + peer deps.
- [ ] `<WeatherLayer />` component — adds a `ParticleLayer` to the existing MapLibre map (single static frame, no time sync yet).
- [ ] `<WeatherControls />` toggle.
- **Milestone**: Fleet page has a "Wind ON" toggle → animated wind trails appear on the map. Not yet synced to the ship.

### Week 4 — Time slider + ship sync (the killer feature)
- [ ] `useShipAtTime` hook — interpolates ship position along route at time `t` (reuses existing `haversineNm` + route geometry).
- [ ] `useWeatherFrame` hook — returns `{ image, image2, imageWeight }` at time `t`.
- [ ] `<TimeSlider />` component — global time state (Jotai store).
- [ ] Wire together: slider changes → ship marker moves + `WeatherLayer.imageWeight` updates, **in lock-step**.
- **Milestone**: **the demo**. Drag the slider → ship + wind particles move together.

### Week 5 — Waves + popup + polish
- [ ] Waves layer (particles coloured by `HTSGW`, direction from `DIRPW`).
- [ ] `<ShipWeatherPopup>` — "vessel in Biscay, 5 m waves, 22 kt headwind".
- [ ] Animation params — particle count, trail length (Agafonkin's `fadeOpacity = 0.996`), drop rate, speed factor.
- [ ] Colour palette — Windy-like feel.
- **Milestone**: visually demo-worthy.

### Week 6 — Demo polish + edge cases
- [ ] Pick a demo voyage that crosses a forecast storm.
- [ ] Record a 30-second screen capture for pitch decks.
- [ ] `THIRD_PARTY_LICENSES.md` — MPL-2.0 attribution for `weatherlayers-gl`.
- [ ] Edge cases: missing frames, slider beyond forecast horizon, cron failure retry.
- [ ] (Optional) Temperature raster layer.
- **Milestone**: ship it.

**Total**: ~20–30 evening hours. Real data, global coverage, polished.

---

## Post-v1 (out of scope for this plan)

- `WindyWeatherProvider` — full implementation (clients that prefer
  the Windy API get it via a one-line env swap).
- AIS integration (Spire Maritime feed, ~€2–5 k/month) — v1.5.
- Historical weather replay (demurrage / NOR dispute evidence) — v2.

---

## References

- Agafonkin, V., "How I built a wind map with WebGL" (Mapbox blog,
  2017). Canonical explanation of the GPU particle technique that
  `weatherlayers-gl` builds on.
- [mapbox/webgl-wind](https://github.com/mapbox/webgl-wind) — ISC,
  the reference shader implementation.
- [weatherlayers/weatherlayers-gl](https://github.com/weatherlayers/weatherlayers-gl) —
  MPL-2.0, the library we build on.
- [Oseenix/maplibre-gl-particle](https://github.com/Oseenix/maplibre-gl-particle)
  — ISC, donor project for the `gfswind2png.py`-style conversion
  script.
- NOAA AWS Open Data: `s3://noaa-gfs-bdp-pda/` (GFS),
  `s3://noaa-gfs-bdp-pda/.../wave/gridded/` (GFS-Wave).

---

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Arne + Claude | Initial plan written after research round (shader deep-dive, WeatherLayers GL eval, NOAA pipeline investigation). Locks on `weatherlayers-gl` + GitHub Actions cron + global coverage from day 1. |
| 2026-04-20 | Arne + Claude | **Weeks 1–6 implementation landed** in one session on Arne's machine (no commits yet, pending Arne's go). Full Python pipeline (`fetch_gfs.py`, `fetch_gfs_wave.py`, `encode_png.py`, `encode_waves.py`, `upload_blob.py`, `update_manifest.py`, `run_pipeline.py`). GitHub Actions cron workflow at `.github/workflows/weather-cron.yml`. Full frontend module at `src/lib/maritime/weather/`: types + provider interface + NEFGO provider (manifest + frame fetcher) + Windy stub + factory hook + `<WeatherLayer>`, `<WeatherControls>`, `<TimeSlider>` components + `shipPositionAtTime` helper. `FleetMapInner` given a `children` slot; `fleet/page.tsx` mounts both wind and wave layers + slider + controls, and projects vessel positions forward along their routes from the slider time. Symmetric `imageUnscale` encoding. `THIRD_PARTY_LICENSES.md` added at repo root (MPL-2.0 for `weatherlayers-gl`). `npx tsc --noEmit` passes clean through every milestone. Missing only: GitHub secrets + first live pipeline run; those are Arne's to configure when he's ready to see it move. |
| 2026-04-20 | Arne + Claude | **Added local-demo mode.** Context: Marten owns the production infrastructure (Vercel, GitHub admin), and waiting on him would block Arne from verifying the feature on his own laptop. Changes: `config.ts` treats an empty `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` as same-origin mode (browser fetches `/weather/manifest.json` from Next.js's `public/`). `run_pipeline.py` gained `--local DIR` mode that writes frames + manifest into `DIR` with root-relative URLs (`/weather/{runId}/...`) instead of uploading to Vercel Blob. `update_manifest.py` gained `Manifest.load_from_file` so consecutive local runs merge history. `public/weather/` git-ignored to keep derived data out of commits. `docs/MARTEN-HANDOFF.md` written: step-by-step production setup (Vercel Blob, Cloudflare R2, or S3 paths). Arne can now `conda install -c conda-forge eccodes cfgrib xarray pillow requests numpy` on Windows and run `python run_pipeline.py --latest --local ../../public/weather --types=wind` to get real NOAA data flowing through the UI — no Marten, no tokens, no cron. `npx tsc --noEmit` still exit 0. |
| 2026-04-20 | Arne + Claude | **First live run + bug sweep.** Ran the pipeline end-to-end on Arne's machine via Miniconda. Found and fixed four bugs that only surfaced against real data: (1) `requests.iter_content` streaming was truncating downloads to ~10 KB — replaced with plain `response.content` (GRIB2 files are 2-5 MB, memory is not a concern). (2) `Zod.string().url()` rejected root-relative paths — relaxed to accept either absolute URLs or `/`-prefixed paths so local mode works. (3) deck.gl 9.3.1 shipped a breaking shader-uniform change that weatherlayers-gl 2026.2.0 is not compatible with; pinned deck.gl + luma.gl to exact 9.2.11 / 9.2.6. (4) `parsePalette` rejected our comma-delimited hex palette string — switched to constructing `Palette` arrays directly and skipping the parser. (5) `MapboxOverlay interleaved: true` silently swallowed the particle render on MapLibre GL JS v5; switched to `interleaved: false` (overlay on top). (6) `reorient_to_web` in `encode_png.py` was flipping latitude (`np.flipud`) based on a misread of the WebGL texture convention — the deck.gl BitmapLayer wants north-first rows to match `bounds = [-180, -90, 180, 90]`. The flip caused a catastrophic "wind and waves over Russia, quiet over oceans" bug (50° N data came from 50° S Southern Ocean). Removed. (7) `Manifest.add_run` replaced whole runs by `runId` instead of merging per-type frames, clobbering wind when waves ran separately — changed to merge. All seven fixed, verified visually: wind + waves animate correctly with the expected geographic patterns (North Atlantic cyclones, Southern Ocean roaring forties, trade winds, ITCZ). **This is the state that works on Arne's machine today.** |
| 2026-04-21 | Arne + Claude | **Full Windy-equivalent horizon.** Extended `FORECAST_STEPS` from 13 near-term frames (0-36 h) to the complete GFS cadence: 0-120 h hourly (121 frames), 120-240 h every 3 h (40 frames), 240-384 h every 12 h (12 frames) = **173 frames × 2 types = 346 frames covering 16 days**, matching what Windy and VentuSky ship. Pipeline takes ~12 min per full run, ~230 MB on disk per run. Also: added a cycle-time badge to `<TimeSlider />` ("issued 20 Apr 12Z" beside the time readout) so operators can tell how fresh the forecast they're looking at is. Verified globe projection renders (weatherlayers-gl works fine on MapLibre v5 desktop globe, despite earlier concerns about known mobile-globe issues). Known cosmetic quirk: particle speed near the poles on globe projection inherits the shader's Mercator-distortion correction (`velocity.x / cos(lat)`), which over-corrects on a non-Mercator surface; descoped as not fixable without patching the library shader. |
