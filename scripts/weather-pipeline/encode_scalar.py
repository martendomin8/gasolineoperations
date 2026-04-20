#!/usr/bin/env python3
"""Encode a GFS scalar field (e.g. 2 m temperature) to an RGBA PNG + JSON sidecar.

Output convention (compatible with weatherlayers-gl `RasterLayer` when
`imageType = SCALAR`):

    R channel:  scalar value scaled [min..max] -> 0..255
    G channel:  copy of R (so `texture.g` also reads the same value;
                some shader paths look at .g for historical reasons)
    B channel:  0 (unused)
    A channel:  255 for valid pixels, 0 for NaN (e.g. GFS SST over land)

The raster shader reads `texture.r`, rescales via
`imageUnscale = [min, max]` back to real units (Kelvin for TMP), and
paints through the `palette`. No vector logic — SCALAR is purely
colour mapping.

Celsius conversion is NOT applied on the server side. We publish raw
Kelvin and let the frontend palette or formatter convert (palette
breakpoints are easier to reason about in Celsius: `240#blue,
273#white, 303#red`).

Grid orientation matches `encode_png.py` — longitude rolled from
[0, 360) to [-180, 180), latitude left in native GFS north-first
order (the flip was a previous bug).

Sidecar JSON schema:

    {
        "width":  1440,
        "height": 721,
        "imageType":    "SCALAR",
        "imageUnscale": [220.0, 320.0],   // Kelvin min/max used for scaling
        "unit":         "K",
        "scalarMin":    220.0,
        "scalarMax":    320.0,
        "validTime":    "2026-04-21T12:00:00+00:00",
        "cycleTime":    "2026-04-20T12:00:00+00:00",   // optional
        "forecastHour": 24,                             // optional
        "variable":     "temperature",
        "bounds":       [-180.0, -90.0, 180.0, 90.0]
    }

Usage (CLI):
    python encode_scalar.py data/gfs_temp_20260420_12_f024.grib2 \\
        --output-dir out/ --basename temperature_f024 \\
        --cycle 2026-04-20T12:00:00Z --forecast-hour 24

Usage (module):
    from encode_scalar import encode_file
    png_path, json_path = encode_file(Path("data/gfs_temp.grib2"), Path("out"))
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image

from encode_png import reorient_to_web

logger = logging.getLogger(__name__)

# cfgrib maps 2 m temperature to `t2m` under the ECMWF-style naming
# convention that is the default in the conda-forge eccodes build.
# Other builds might surface `TMP`; we try both.
_T2M_NAMES = ("t2m", "TMP", "2t")

# Global fixed bounds for t2m scaling. We pin the range instead of
# per-frame min/max so the colour palette is *consistent* across
# frames — a place that's "cold" at T0 should still be the same
# shade of blue at T+120 h. Real Earth t2m lives in ~200 K (deep
# Antarctic winter) .. ~325 K (desert summer); we pad either side.
TEMP_MIN_K = 220.0  # -53 °C
TEMP_MAX_K = 325.0  # +52 °C


def _find_var(ds: xr.Dataset, candidates: tuple[str, ...]) -> xr.DataArray:
    for name in candidates:
        if name in ds.data_vars:
            return ds[name]
    raise KeyError(
        f"None of {candidates} found in GRIB2 dataset. "
        f"Available variables: {list(ds.data_vars)}"
    )


def load_t2m(
    grib_path: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, datetime]:
    """Open a GFS 2 m temperature GRIB2 file.

    Returns (temp_K, lats, lons, valid_time).
    """
    ds = xr.open_dataset(
        grib_path,
        engine="cfgrib",
        filter_by_keys={"typeOfLevel": "heightAboveGround", "level": 2},
        backend_kwargs={"indexpath": ""},
    )
    try:
        temp_k = _find_var(ds, _T2M_NAMES).values.astype(np.float32)
        lats = ds["latitude"].values.astype(np.float32)
        lons = ds["longitude"].values.astype(np.float32)
        valid64 = np.atleast_1d(ds["valid_time"].values)[0]
        valid_iso = np.datetime_as_string(valid64, unit="s")
        valid_dt = datetime.fromisoformat(valid_iso).replace(tzinfo=timezone.utc)
    finally:
        ds.close()
    return temp_k, lats, lons, valid_dt


def encode_scalar_to_png(
    scalar: np.ndarray,
    output_path: Path,
    scale_min: float,
    scale_max: float,
) -> None:
    """Encode a single scalar field into an 8-bit RGBA PNG.

    Values outside [scale_min, scale_max] clip to 0 or 255. Pins the
    range globally so colour meaning is consistent across frames
    (vs. `encode_png.py` which uses per-frame u/v magnitude to
    maximise 8-bit resolution).
    """
    span = scale_max - scale_min
    if span <= 0:
        raise ValueError("scale_max must be greater than scale_min")

    normalised = ((scalar - scale_min) / span * 255.0).clip(0, 255).astype(np.uint8)
    # Duplicate R into G so downstream code that reads either channel
    # gets the same value. ParticleLayer conventionally uses R+G for
    # u+v; RasterLayer only needs R; duplicating costs nothing and
    # guards against shader variants that look at G.
    r = normalised
    g = normalised
    b = np.zeros_like(r)
    valid = ~np.isnan(scalar)
    a = np.where(valid, 255, 0).astype(np.uint8)

    rgba = np.dstack([r, g, b, a])
    Image.fromarray(rgba, mode="RGBA").save(output_path, optimize=True)
    logger.info(
        "PNG written: %s  (%d x %d, %.1f KB)",
        output_path,
        rgba.shape[1],
        rgba.shape[0],
        output_path.stat().st_size / 1024,
    )


def encode_file(
    grib_path: Path,
    output_dir: Path,
    basename: str | None = None,
    cycle_time: datetime | None = None,
    forecast_hour: int | None = None,
    variable_label: str = "temperature",
    scale_min_k: float = TEMP_MIN_K,
    scale_max_k: float = TEMP_MAX_K,
) -> tuple[Path, Path]:
    """Full pipeline for one GFS temperature GRIB2 file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    if basename is None:
        basename = grib_path.stem

    temp_k, lats, lons, valid_time = load_t2m(grib_path)
    logger.info(
        "Loaded %s: grid %dx%d, valid %s, T range %.1f..%.1f K (%.1f..%.1f C)",
        grib_path,
        temp_k.shape[1],
        temp_k.shape[0],
        valid_time.isoformat(),
        float(np.nanmin(temp_k)),
        float(np.nanmax(temp_k)),
        float(np.nanmin(temp_k)) - 273.15,
        float(np.nanmax(temp_k)) - 273.15,
    )

    # Reuse the same longitude roll + north-first orientation as the
    # vector encoder — pass the scalar as u (v is a dummy zeros array
    # that we discard). This keeps grid orientation identical across
    # layer types so the renderer never needs to special-case them.
    dummy = np.zeros_like(temp_k)
    temp_reoriented, _ = reorient_to_web(temp_k, dummy, lons)

    png_path = output_dir / f"{basename}.png"
    encode_scalar_to_png(
        temp_reoriented,
        png_path,
        scale_min=scale_min_k,
        scale_max=scale_max_k,
    )

    sidecar: dict = {
        "width": int(temp_reoriented.shape[1]),
        "height": int(temp_reoriented.shape[0]),
        "imageType": "SCALAR",
        "imageUnscale": [scale_min_k, scale_max_k],
        "unit": "K",
        "scalarMin": float(np.nanmin(temp_k)),
        "scalarMax": float(np.nanmax(temp_k)),
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
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Encode a GFS 2m temperature GRIB2 file to a weatherlayers-gl PNG + JSON sidecar",
    )
    parser.add_argument("grib_path", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("out"))
    parser.add_argument("--basename", type=str, default=None)
    parser.add_argument("--cycle", type=str, default=None)
    parser.add_argument("--forecast-hour", type=int, default=None)
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
