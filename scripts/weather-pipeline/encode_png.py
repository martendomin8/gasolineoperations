#!/usr/bin/env python3
"""Encode a GFS 10 m wind GRIB2 file to an RGBA PNG + JSON sidecar.

Output convention (compatible with weatherlayers-gl ParticleLayer):

    R channel:  u component (eastward wind), scaled [min..max] → 0..255
    G channel:  v component (northward wind), scaled [min..max] → 0..255
    B channel:  0 (unused)
    A channel:  255 for valid pixels, 0 for NaN / masked pixels

CRITICAL: `weatherlayers-gl` consumes a SINGLE shared unscale range
`[min, max]` for vector fields — both u and v are rescaled through the
same pair. We compute a symmetric range `[-vmax, +vmax]` where vmax =
max(|u|, |v|) so both components fit losslessly in 8 bits, with zero
mapped to mid-grey (128) in both channels. Per-channel min/max are
also stored in the sidecar for debugging, but the renderer only uses
`imageUnscale`.

Grid orientation transforms applied (GFS native → web-map native):

    longitude: 0..360 (GFS) rolled to -180..180 (web); prime meridian
               moves from the left edge to the middle column
    latitude:  90..-90 (GFS, north-first) flipped to -90..90
               (south-first); texture row 0 then maps to south edge,
               matching the shader's `pos.y = 0 → latitude -90` convention

Sidecar JSON schema (one file per PNG):

    {
        "width":  1440,
        "height": 721,
        "imageType":    "VECTOR",
        "imageUnscale": [-52.8, 52.8],                  // shared u/v range
        "unit":         "m/s",
        "uMin":  -45.2,     // per-channel debug values; renderer ignores
        "uMax":   52.8,
        "vMin":  -41.7,
        "vMax":   48.3,
        "validTime":    "2026-04-21T12:00:00+00:00",
        "cycleTime":    "2026-04-20T12:00:00+00:00",   // optional
        "forecastHour": 24,                             // optional
        "variable":     "wind10m",
        "bounds":       [-180.0, -90.0, 180.0, 90.0]
    }

Usage (CLI):
    python encode_png.py data/gfs_20260420_12_f024.grib2 \\
        --output-dir out/ --basename wind_f024 \\
        --cycle 2026-04-20T12:00:00Z --forecast-hour 24

Usage (module):
    from encode_png import encode_file
    png_path, json_path = encode_file(Path("data/gfs.grib2"), Path("out"))
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image

logger = logging.getLogger(__name__)


def load_uv(
    grib_path: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, datetime]:
    """Open a GFS 10 m wind GRIB2 file.

    Returns (u, v, lats, lons, valid_time) where u and v are 2-D float32
    arrays shaped (height, width), lats and lons are 1-D coordinate
    arrays, and valid_time is the forecast target time as a timezone-
    aware UTC datetime.
    """
    # indexpath="" disables cfgrib's on-disk .idx cache — useful when the
    # GRIB2 file lives in a read-only location (e.g. a container layer or
    # CI runner cache).
    ds = xr.open_dataset(
        grib_path,
        engine="cfgrib",
        filter_by_keys={"typeOfLevel": "heightAboveGround", "level": 10},
        backend_kwargs={"indexpath": ""},
    )
    try:
        u = ds["u10"].values.astype(np.float32)
        v = ds["v10"].values.astype(np.float32)
        lats = ds["latitude"].values.astype(np.float32)
        lons = ds["longitude"].values.astype(np.float32)
        # xarray stores valid_time as numpy datetime64; convert to a
        # Python datetime so the sidecar JSON gets a stable ISO string.
        valid64 = np.atleast_1d(ds["valid_time"].values)[0]
        valid_iso = np.datetime_as_string(valid64, unit="s")
        valid_dt = datetime.fromisoformat(valid_iso).replace(tzinfo=timezone.utc)
    finally:
        ds.close()
    return u, v, lats, lons, valid_dt


def reorient_to_web(
    u: np.ndarray, v: np.ndarray, lons: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Reorient a GFS 0.25° grid to the web-map / raster convention.

    GFS native grid:
        - latitude row 0 = 90° N (north first) — SAME as web rasters
        - longitude col 0 = 0° (Greenwich meridian on the left)

    Web-map raster convention (what deck.gl BitmapLayer expects when
    `bounds = [-180, -90, 180, 90]`):
        - image top-left pixel corresponds to (west = -180, north = +90)
        - image rows go NORTH → SOUTH (matches GFS native)
        - image cols go WEST → EAST

    Only transform needed: roll the longitude axis by half the width so
    the prime meridian moves from col 0 to col width/2, matching the
    [-180..180] span. No latitude flip — GFS is already north-first.

    (Earlier versions `np.flipud()`'d the latitude axis based on a
    misread of the WebGL texture convention. That rendered the map
    upside down — wind off Antarctica appeared over the Arctic —
    which showed up visually as "weather over land, ocean quiet"
    because 50° N land data came from 50° S ocean and vice versa.)
    """
    width = lons.shape[0]
    roll_by = width // 2
    u_web = np.roll(u, roll_by, axis=1)
    v_web = np.roll(v, roll_by, axis=1)
    return u_web, v_web


@dataclass(frozen=True)
class UVStats:
    """Per-channel and shared scaling stats for a u/v field."""

    u_min: float
    u_max: float
    v_min: float
    v_max: float
    # The symmetric [-vmax, +vmax] range that weatherlayers-gl's
    # `imageUnscale` prop consumes. Both u and v share this range.
    unscale: tuple[float, float]


def encode_uv_to_png(
    u: np.ndarray,
    v: np.ndarray,
    output_path: Path,
    valid_mask: np.ndarray | None = None,
    alpha_override: np.ndarray | None = None,
) -> UVStats:
    """Encode a u/v float field into an 8-bit RGBA PNG.

    Both channels share the same symmetric range so `weatherlayers-gl`'s
    single `imageUnscale = [min, max]` prop can recover them: after the
    shader reads a channel's 0..255 value it computes
    `mix(min, max, value/255)`, giving us back real-world m/s.

    Alpha channel sources (in precedence order):
      1. `alpha_override` — caller-supplied pre-computed uint8 alpha
         (used by waves to feather coastlines; gives a soft surf-zone
         look instead of hard "dark square" holes around islands).
      2. `valid_mask` — boolean; True → 255, False → 0.
      3. NaN-detection on u + v (fallback).

    Returns a UVStats with per-channel debug values and the shared
    `[min, max]` unscale range.
    """
    u_min, u_max = float(np.nanmin(u)), float(np.nanmax(u))
    v_min, v_max = float(np.nanmin(v)), float(np.nanmax(v))

    # Symmetric shared range. Zero wind lands at 128 in both channels,
    # which also makes eyeballing the PNG easier — mid-grey = no wind.
    vmax = max(abs(u_min), abs(u_max), abs(v_min), abs(v_max), 1.0)
    umin_shared = -vmax
    umax_shared = vmax
    span = umax_shared - umin_shared  # = 2 * vmax, always positive

    r = ((u - umin_shared) / span * 255.0).clip(0, 255).astype(np.uint8)
    g = ((v - umin_shared) / span * 255.0).clip(0, 255).astype(np.uint8)
    b = np.zeros_like(r)

    if alpha_override is not None:
        a = alpha_override.astype(np.uint8)
    else:
        if valid_mask is None:
            valid_mask = ~(np.isnan(u) | np.isnan(v))
        a = np.where(valid_mask, 255, 0).astype(np.uint8)

    rgba = np.dstack([r, g, b, a])  # shape: (height, width, 4)
    Image.fromarray(rgba, mode="RGBA").save(output_path, optimize=True)
    logger.info(
        "PNG written: %s  (%d x %d, %.1f KB)",
        output_path,
        rgba.shape[1],
        rgba.shape[0],
        output_path.stat().st_size / 1024,
    )
    return UVStats(
        u_min=u_min,
        u_max=u_max,
        v_min=v_min,
        v_max=v_max,
        unscale=(umin_shared, umax_shared),
    )


def encode_file(
    grib_path: Path,
    output_dir: Path,
    basename: str | None = None,
    cycle_time: datetime | None = None,
    forecast_hour: int | None = None,
    variable_label: str = "wind10m",
) -> tuple[Path, Path]:
    """Full one-shot pipeline: GRIB2 → PNG + JSON sidecar.

    Returns the (png_path, json_path) pair.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    if basename is None:
        basename = grib_path.stem

    u, v, lats, lons, valid_time = load_uv(grib_path)
    logger.info(
        "Loaded %s: grid %dx%d, valid %s",
        grib_path,
        u.shape[1],
        u.shape[0],
        valid_time.isoformat(),
    )

    u, v = reorient_to_web(u, v, lons)

    png_path = output_dir / f"{basename}.png"
    stats = encode_uv_to_png(u, v, png_path)

    sidecar: dict = {
        "width": int(u.shape[1]),
        "height": int(u.shape[0]),
        "imageType": "VECTOR",
        "imageUnscale": [stats.unscale[0], stats.unscale[1]],
        "unit": "m/s",
        # Per-channel values kept for debugging / future asymmetric encoders.
        "uMin": stats.u_min,
        "uMax": stats.u_max,
        "vMin": stats.v_min,
        "vMax": stats.v_max,
        "validTime": valid_time.isoformat(),
        "variable": variable_label,
        "bounds": [-180.0, -90.0, 180.0, 90.0],
    }
    if cycle_time is not None:
        sidecar["cycleTime"] = cycle_time.isoformat()
    if forecast_hour is not None:
        sidecar["forecastHour"] = forecast_hour

    json_path = output_dir / f"{basename}.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(sidecar, f, indent=2)
    logger.info("Sidecar written: %s", json_path)

    return png_path, json_path


def _parse_iso(value: str) -> datetime:
    """Parse an ISO-8601 string; accept both `Z` and `+00:00` timezone suffixes."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Encode a GFS 10m wind GRIB2 file to a weatherlayers-gl PNG + JSON sidecar",
    )
    parser.add_argument("grib_path", type=Path, help="Path to the input GRIB2 file")
    parser.add_argument("--output-dir", type=Path, default=Path("out"))
    parser.add_argument(
        "--basename",
        type=str,
        default=None,
        help="Output filename without extension (default: input stem)",
    )
    parser.add_argument(
        "--cycle",
        type=str,
        default=None,
        help="Cycle start time as ISO-8601, e.g. 2026-04-20T12:00:00Z (optional metadata)",
    )
    parser.add_argument(
        "--forecast-hour",
        type=int,
        default=None,
        help="Forecast step in hours (optional metadata)",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cycle_time = _parse_iso(args.cycle) if args.cycle is not None else None

    png_path, json_path = encode_file(
        grib_path=args.grib_path,
        output_dir=args.output_dir,
        basename=args.basename,
        cycle_time=cycle_time,
        forecast_hour=args.forecast_hour,
    )
    print(png_path)
    print(json_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
