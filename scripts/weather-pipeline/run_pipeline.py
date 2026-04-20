#!/usr/bin/env python3
"""Orchestrator — fetch, encode, upload one GFS cycle end-to-end.

This is the script the GitHub Actions cron invokes. Run locally to
dry-run (without --upload) before wiring the workflow.

Pipeline per cycle:

    1. Pick a cycle (--latest or --cycle YYYYMMDDHH)
    2. For each forecast hour in FORECAST_STEPS:
         a. fetch the 10 m wind GRIB2 slice (fetch_gfs)
         b. encode to RGBA PNG + JSON sidecar (encode_png)
         c. upload both to Vercel Blob (upload_blob) — optional
    3. Load the current manifest from the CDN (404 → empty)
    4. Add the new run, prune to the last MAX_KEEP_RUNS
    5. Save the manifest back to the CDN

If a single forecast hour fails, the run continues and the other
frames still make it into the manifest. A cycle with zero successful
frames is skipped entirely.

Week 2 scope: wind only. Waves (fetch_gfs_wave.py) and scalar
temperature come in later weeks once their encoders exist.

Usage:
    # Dry-run — fetches + encodes locally, does NOT upload:
    python run_pipeline.py --latest --dry-run

    # Full run — uploads to Blob, updates manifest:
    BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \\
    NEXT_PUBLIC_WEATHER_CDN_BASE_URL=https://...blob.vercel-storage.com \\
        python run_pipeline.py --latest

    # Pin a specific cycle (useful for backfill):
    python run_pipeline.py --cycle 2026042012
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import encode_png
import encode_waves
from fetch_gfs import _parse_cycle_arg, fetch_gfs, latest_cycle
from fetch_gfs_wave import fetch_gfs_wave
from update_manifest import Frame, Manifest, Run
from upload_blob import upload_file

logger = logging.getLogger(__name__)

# Forecast steps to publish — matches NOAA GFS native output cadence so
# the slider never shows "synthetic" frames that don't correspond to a
# real model step:
#
#   0 – 120 h  every  1 h  (121 frames) — the actionable operations window
#   120 – 240 h every  3 h  (40 frames)  — planning window
#   240 – 384 h every 12 h  (12 frames)  — strategic / 16-day horizon
#
# Total: 173 frames per weather type, ~150 MB encoded PNGs per run.
# This matches what Windy, VentuSky and every other forecast viewer
# use — there is no higher-resolution forecast-time-axis available
# from GFS; denser interpolation would be invented, not forecast.
FORECAST_STEPS: tuple[int, ...] = (
    tuple(range(0, 121))            # 0, 1, 2, ..., 120
    + tuple(range(123, 241, 3))     # 123, 126, ..., 240
    + tuple(range(252, 385, 12))    # 252, 264, ..., 384
)

# Keep the last N runs in the manifest so the slider has context when
# the newest run is just published (smooth transition).
MAX_KEEP_RUNS = 2

WEATHER_TYPE_WIND = "wind"
WEATHER_TYPE_WAVES = "waves"


def _run_id(cycle_dt: datetime) -> str:
    return cycle_dt.strftime("%Y%m%d%H")


def _blob_path(run_id: str, weather_type: str, forecast_hour: int, ext: str) -> str:
    return f"weather/{run_id}/{weather_type}_f{forecast_hour:03d}.{ext}"


def _process_wind_step(
    *,
    cycle_dt: datetime,
    forecast_hour: int,
    data_dir: Path,
    out_dir: Path,
    upload: bool,
    local_url_prefix: str | None,
    token: str | None,
) -> Frame | None:
    """Fetch + encode + upload a single wind forecast step."""
    run_id = _run_id(cycle_dt)
    basename = f"{WEATHER_TYPE_WIND}_f{forecast_hour:03d}"
    try:
        grib_path = fetch_gfs(
            cycle_dt=cycle_dt,
            forecast_hour=forecast_hour,
            output_dir=data_dir,
        )
    except Exception as e:
        logger.warning("wind fetch failed for f%03d: %s", forecast_hour, e)
        return None
    try:
        png_path, json_path = encode_png.encode_file(
            grib_path=grib_path,
            output_dir=out_dir / run_id,
            basename=basename,
            cycle_time=cycle_dt,
            forecast_hour=forecast_hour,
        )
    except Exception as e:
        logger.warning("wind encode failed for f%03d: %s", forecast_hour, e)
        return None
    return _finalise_step(
        run_id=run_id,
        weather_type=WEATHER_TYPE_WIND,
        forecast_hour=forecast_hour,
        png_path=png_path,
        json_path=json_path,
        upload=upload,
        local_url_prefix=local_url_prefix,
        token=token,
    )


def _process_wave_step(
    *,
    cycle_dt: datetime,
    forecast_hour: int,
    data_dir: Path,
    out_dir: Path,
    upload: bool,
    local_url_prefix: str | None,
    token: str | None,
) -> Frame | None:
    """Fetch + encode + upload a single wave forecast step."""
    run_id = _run_id(cycle_dt)
    basename = f"{WEATHER_TYPE_WAVES}_f{forecast_hour:03d}"
    try:
        grib_path = fetch_gfs_wave(
            cycle_dt=cycle_dt,
            forecast_hour=forecast_hour,
            output_dir=data_dir,
        )
    except Exception as e:
        logger.warning("wave fetch failed for f%03d: %s", forecast_hour, e)
        return None
    try:
        png_path, json_path = encode_waves.encode_file(
            grib_path=grib_path,
            output_dir=out_dir / run_id,
            basename=basename,
            cycle_time=cycle_dt,
            forecast_hour=forecast_hour,
        )
    except Exception as e:
        logger.warning("wave encode failed for f%03d: %s", forecast_hour, e)
        return None
    return _finalise_step(
        run_id=run_id,
        weather_type=WEATHER_TYPE_WAVES,
        forecast_hour=forecast_hour,
        png_path=png_path,
        json_path=json_path,
        upload=upload,
        local_url_prefix=local_url_prefix,
        token=token,
    )


def _finalise_step(
    *,
    run_id: str,
    weather_type: str,
    forecast_hour: int,
    png_path: Path,
    json_path: Path,
    upload: bool,
    local_url_prefix: str | None,
    token: str | None,
) -> Frame | None:
    """Upload + build Frame. Shared tail of each per-type step handler.

    Three URL modes, controlled by the (`upload`, `local_url_prefix`)
    pair:

    | upload | local_url_prefix | result                         |
    |--------|------------------|--------------------------------|
    | True   | —                | Upload to Blob, HTTPS URLs     |
    | False  | "" or "/path"    | Local demo, `/weather/...` URLs |
    | False  | None             | Pure dry-run, `file://` URIs   |
    """
    import json as _json
    with json_path.open("r", encoding="utf-8") as f:
        sidecar = _json.load(f)
    valid_time = sidecar["validTime"]

    if not upload:
        if local_url_prefix is not None:
            pathname = _blob_path(run_id, weather_type, forecast_hour, "png")
            json_pathname = _blob_path(run_id, weather_type, forecast_hour, "json")
            prefix = local_url_prefix.rstrip("/")
            return Frame(
                forecast_hour=forecast_hour,
                valid_time=valid_time,
                png_url=f"{prefix}/{pathname}",
                json_url=f"{prefix}/{json_pathname}",
            )
        return Frame(
            forecast_hour=forecast_hour,
            valid_time=valid_time,
            png_url=png_path.as_uri(),
            json_url=json_path.as_uri(),
        )

    try:
        png_url = upload_file(
            local_path=png_path,
            blob_pathname=_blob_path(run_id, weather_type, forecast_hour, "png"),
            token=token,
            content_type="image/png",
        )
        json_url = upload_file(
            local_path=json_path,
            blob_pathname=_blob_path(run_id, weather_type, forecast_hour, "json"),
            token=token,
            content_type="application/json",
        )
    except Exception as e:
        logger.warning(
            "%s upload failed for f%03d: %s", weather_type, forecast_hour, e
        )
        return None

    return Frame(
        forecast_hour=forecast_hour,
        valid_time=valid_time,
        png_url=png_url,
        json_url=json_url,
    )


def run_pipeline(
    cycle_dt: datetime,
    *,
    forecast_steps: tuple[int, ...] = FORECAST_STEPS,
    weather_types: tuple[str, ...] = (WEATHER_TYPE_WIND, WEATHER_TYPE_WAVES),
    data_dir: Path = Path("data"),
    out_dir: Path = Path("out"),
    upload: bool = True,
    local_dir: Path | None = None,
    keep_runs: int = MAX_KEEP_RUNS,
    base_url: str | None = None,
    token: str | None = None,
) -> Run:
    """Fetch, encode, and publish one full cycle. Returns the resulting Run.

    Three publishing modes (mutually exclusive):

      * `upload=True` (default, production): upload frames + manifest to
        Vercel Blob via `upload_blob.py`. Requires `BLOB_READ_WRITE_TOKEN`.

      * `local_dir=Path(...)` (demo on Arne's laptop): write frames and
        manifest into `local_dir`, with manifest URLs relative to the
        site origin (`/weather/...`). Pair with an empty
        `NEXT_PUBLIC_WEATHER_CDN_BASE_URL` env so the browser fetches
        from Next.js's `public/` directory.

      * `upload=False, local_dir=None` (pure dry-run): encode only,
        emit `file://` URLs. Useful to verify the pipeline locally
        before wiring anything up.

    `weather_types` controls which layers are pulled. Defaults to
    wind + waves; passing `(WEATHER_TYPE_WIND,)` keeps quick iterations
    fast by skipping the GFS-Wave download.
    """
    if local_dir is not None:
        if upload:
            # --local is an explicit "write to files, don't upload" mode.
            # Flip upload off so the call site doesn't need to remember
            # to also pass upload=False.
            upload = False
        out_dir = local_dir

    # In local mode, manifest URLs start with "/" (site-root relative);
    # in dry-run, they use file:// URIs; in upload mode, _finalise_step
    # uses absolute HTTPS URLs returned by Vercel Blob.
    local_url_prefix: str | None = "" if local_dir is not None else None

    run_id = _run_id(cycle_dt)
    generated_at = datetime.now(timezone.utc).isoformat()
    run = Run(
        run_id=run_id,
        cycle_time=cycle_dt.isoformat(),
        generated_at=generated_at,
    )
    # Dispatch table — map weather type → its per-step processor. Keeps
    # the loop below uniform across types.
    processors = {
        WEATHER_TYPE_WIND: _process_wind_step,
        WEATHER_TYPE_WAVES: _process_wave_step,
    }

    logger.info(
        "=== Starting cycle %s (%d forecast steps × %d layers) ===",
        run_id,
        len(forecast_steps),
        len(weather_types),
    )
    total_attempts = 0
    total_successes = 0
    for wt in weather_types:
        proc = processors.get(wt)
        if proc is None:
            logger.warning("Unknown weather type %r — skipping", wt)
            continue
        frames: list[Frame] = []
        for step in forecast_steps:
            total_attempts += 1
            logger.info("--- %s f%03d ---", wt, step)
            frame = proc(
                cycle_dt=cycle_dt,
                forecast_hour=step,
                data_dir=data_dir,
                out_dir=out_dir,
                upload=upload,
                local_url_prefix=local_url_prefix,
                token=token,
            )
            if frame is not None:
                frames.append(frame)
                total_successes += 1
        if frames:
            run.frames[wt] = frames
            logger.info(
                "%s: %d / %d frames succeeded",
                wt,
                len(frames),
                len(forecast_steps),
            )

    if total_successes == 0:
        raise RuntimeError(
            f"Cycle {run_id}: zero successful frames across all layers. "
            f"Not updating manifest."
        )
    logger.info(
        "Cycle %s: %d / %d frame-attempts succeeded across %d layers",
        run_id,
        total_successes,
        total_attempts,
        len(weather_types),
    )

    if local_dir is not None:
        # --local mode: merge with any existing manifest in the same
        # directory so repeated runs accumulate history, then write
        # back to disk. Next.js serves it as /weather/manifest.json.
        manifest_path = local_dir / "manifest.json"
        logger.info("Loading existing manifest from %s (if present)…", manifest_path)
        manifest = Manifest.load_from_file(manifest_path)
        manifest.add_run(run)
        dropped = manifest.prune(keep=keep_runs)
        if dropped:
            logger.info("Pruned runs from manifest: %s", [r.run_id for r in dropped])
        manifest.save_to_file(manifest_path)
        logger.info("Manifest written: %s", manifest_path)
        logger.info("=== Cycle %s complete (local mode) ===", run_id)
        return run

    if not upload:
        logger.info("[dry-run] Skipping manifest update; local files only.")
        return run

    if base_url is None:
        base_url = os.environ.get("NEXT_PUBLIC_WEATHER_CDN_BASE_URL")
    if not base_url:
        raise RuntimeError(
            "NEXT_PUBLIC_WEATHER_CDN_BASE_URL is not set; cannot load existing manifest. "
            "Set the env var or pass --base-url."
        )

    logger.info("Loading existing manifest from %s ...", base_url)
    manifest = Manifest.load_from_blob(base_url)
    manifest.add_run(run)
    dropped = manifest.prune(keep=keep_runs)
    if dropped:
        logger.info("Pruned runs from manifest: %s", [r.run_id for r in dropped])

    manifest_url = manifest.save_to_blob(token=token, scratch_dir=out_dir)
    logger.info("Manifest updated: %s", manifest_url)
    logger.info("=== Cycle %s complete ===", run_id)
    return run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    cycle_group = parser.add_mutually_exclusive_group(required=True)
    cycle_group.add_argument("--cycle", type=_parse_cycle_arg)
    cycle_group.add_argument("--latest", action="store_true")
    parser.add_argument(
        "--forecast-steps",
        type=str,
        default=None,
        help="Comma-separated forecast hours, e.g. '0,3,6,9'. Default: " + ",".join(str(s) for s in FORECAST_STEPS),
    )
    parser.add_argument(
        "--types",
        type=str,
        default="wind,waves",
        help="Comma-separated weather types to fetch. Default: wind,waves. "
        "Useful for quick runs: --types=wind skips the GFS-Wave download.",
    )
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--out-dir", type=Path, default=Path("out"))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch + encode locally but do not upload to Blob or update manifest.",
    )
    parser.add_argument(
        "--local",
        type=Path,
        default=None,
        metavar="DIR",
        help=(
            "Local demo mode: write frames + manifest into DIR (typically "
            "../../public/weather) and emit relative URLs so the frontend "
            "can fetch them same-origin. Skips the Vercel Blob upload "
            "path entirely — no BLOB_READ_WRITE_TOKEN required."
        ),
    )
    parser.add_argument("--keep-runs", type=int, default=MAX_KEEP_RUNS)
    parser.add_argument("--base-url", type=str, default=None)
    parser.add_argument("--token", type=str, default=None)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cycle_dt = args.cycle if args.cycle is not None else latest_cycle()

    steps: tuple[int, ...] = FORECAST_STEPS
    if args.forecast_steps:
        try:
            steps = tuple(int(s.strip()) for s in args.forecast_steps.split(",") if s.strip())
        except ValueError as e:
            logger.error("--forecast-steps parse failed: %s", e)
            return 2

    types = tuple(
        t.strip() for t in args.types.split(",") if t.strip()
    )
    if not types:
        logger.error("--types must list at least one weather type")
        return 2

    try:
        run_pipeline(
            cycle_dt=cycle_dt,
            forecast_steps=steps,
            weather_types=types,
            data_dir=args.data_dir,
            out_dir=args.out_dir,
            upload=not args.dry_run,
            local_dir=args.local,
            keep_runs=args.keep_runs,
            base_url=args.base_url,
            token=args.token,
        )
    except RuntimeError as e:
        logger.error("%s", e)
        return 3

    return 0


if __name__ == "__main__":
    sys.exit(main())
