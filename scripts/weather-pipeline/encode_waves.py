#!/usr/bin/env python3
"""Encode a GFS-Wave GRIB2 file to an RGBA PNG + JSON sidecar.

GFS-Wave publishes significant wave height (HTSGW), primary wave
period (PERPW) and primary wave direction (DIRPW) for every 0.25°
cell. For the particle-animation renderer we want a vector field —
particles flowing in the direction waves are propagating, at a speed
proportional to height. So we convert:

    (Hs, DIRPW)  →  u = Hs * sin(rad(DIRPW + 180))
                    v = Hs * cos(rad(DIRPW + 180))

The +180° flip is because DIRPW is meteorological "from" direction
(where the waves are coming from); particles need to move in the
"towards" direction, i.e. propagation.

Reuses `encode_uv_to_png` + `reorient_to_web` from `encode_png.py`
so the two pipelines produce identical PNG formats.

Usage (CLI):
    python encode_waves.py data/gfswave_20260420_12_f024.grib2 \\
        --output-dir out/ --basename waves_f024 \\
        --cycle 2026-04-20T12:00:00Z --forecast-hour 24
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

from encode_png import encode_uv_to_png, reorient_to_web

logger = logging.getLogger(__name__)

# cfgrib can surface NCEP GFS-Wave variables under either their NCEP
# short names (HTSGW, DIRPW) or ECMWF-style short names (swh, mwd)
# depending on the installed ECCODES definitions. We try both.
_HS_NAMES = ("swh", "htsgw", "HTSGW")
_DIR_NAMES = ("mwd", "dirpw", "DIRPW", "pp1dir")


def _fill_nan_nearest(arr: np.ndarray, max_iters: int = 150) -> np.ndarray:
    """Replace NaN pixels with their nearest valid neighbour.

    Why: GFS-Wave marks any 0.25° cell that contains ANY land as NaN
    (Hs undefined). When we encode that as alpha=0 and the renderer
    linearly interpolates the PNG, the NaN values BLEED into adjacent
    ocean pixels' colour channels — small islands appear surrounded
    by a ~2-pixel "no wave" halo that looks far bigger than the
    actual land. Inpainting replaces the NaN pixels with nearby ocean
    values so the raster colour is continuous across the boundary.
    The ALPHA channel stays 0 over land — the renderer still paints
    nothing there, but now the neighbouring colour isn't polluted.

    Pure numpy — iterative 4-neighbour dilation. Slower than scipy's
    `distance_transform_edt` but we don't want scipy as a dependency.
    Each iteration is O(N); empirically 100 iterations fully fills the
    GFS-Wave global grid (deep interior of Antarctica / central Asia).
    Default 150 leaves headroom.
    """
    mask = np.isnan(arr)
    if not mask.any():
        return arr
    result = arr.copy()
    for _ in range(max_iters):
        if not mask.any():
            break
        # Shift valid values into adjacent NaN slots, one pixel at a
        # time in each of four cardinal directions. First valid neigh-
        # bour wins (order below = up, down, left, right).
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            shifted = np.roll(result, shift, axis=axis)
            # Invalidate wrap-around edge so data from the opposite
            # side of the globe doesn't spill into newly filled cells.
            if axis == 0:
                if shift == 1:
                    shifted[0, :] = np.nan
                else:
                    shifted[-1, :] = np.nan
            else:
                if shift == 1:
                    shifted[:, 0] = np.nan
                else:
                    shifted[:, -1] = np.nan
            can_fill = mask & ~np.isnan(shifted)
            result[can_fill] = shifted[can_fill]
            mask[can_fill] = False
    return result


def _find_var(ds: xr.Dataset, candidates: tuple[str, ...]) -> xr.DataArray:
    for name in candidates:
        if name in ds.data_vars:
            return ds[name]
    raise KeyError(
        f"None of {candidates} found in GRIB2 dataset. "
        f"Available variables: {list(ds.data_vars)}"
    )


def load_wave_fields(
    grib_path: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, datetime]:
    """Open a GFS-Wave GRIB2 file and return (Hs, DIRPW, lats, lons, valid_time).

    Hs is significant wave height in metres. DIRPW is wave direction
    in degrees (0–360, 0 = north, meteorological "from" convention).
    """
    ds = xr.open_dataset(
        grib_path,
        engine="cfgrib",
        backend_kwargs={"indexpath": ""},
    )
    try:
        hs = _find_var(ds, _HS_NAMES).values.astype(np.float32)
        direction_deg = _find_var(ds, _DIR_NAMES).values.astype(np.float32)
        lats = ds["latitude"].values.astype(np.float32)
        lons = ds["longitude"].values.astype(np.float32)
        valid64 = np.atleast_1d(ds["valid_time"].values)[0]
        valid_iso = np.datetime_as_string(valid64, unit="s")
        valid_dt = datetime.fromisoformat(valid_iso).replace(tzinfo=timezone.utc)
    finally:
        ds.close()
    return hs, direction_deg, lats, lons, valid_dt


def waves_to_uv(
    hs: np.ndarray, direction_from_deg: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Turn (Hs, DIRPW-from) into a pseudo-velocity (u, v) vector field
    in the direction of propagation, with magnitude equal to Hs.

    Bearings are compass degrees (0 = N, 90 = E), meteorological from-
    convention. We add 180° to flip it to the propagation direction.

    Returns (u_east, v_north) arrays the same shape as `hs`.
    """
    propagation_deg = direction_from_deg + 180.0
    flow_rad = np.deg2rad(propagation_deg)
    # Compass bearing → cartesian: east = sin, north = cos.
    u = hs * np.sin(flow_rad)
    v = hs * np.cos(flow_rad)
    return u, v


def encode_file(
    grib_path: Path,
    output_dir: Path,
    basename: str | None = None,
    cycle_time: datetime | None = None,
    forecast_hour: int | None = None,
    variable_label: str = "waves",
) -> tuple[Path, Path]:
    """Full pipeline for one GFS-Wave GRIB2 file: GRIB2 → PNG + JSON sidecar.

    Mirrors the `encode_file` signature in `encode_png.py` so the
    orchestrator can treat the two encoders uniformly.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    if basename is None:
        basename = grib_path.stem

    hs, direction_deg, lats, lons, valid_time = load_wave_fields(grib_path)
    logger.info(
        "Loaded %s: grid %dx%d, valid %s, Hs range %.2f..%.2f m",
        grib_path,
        hs.shape[1],
        hs.shape[0],
        valid_time.isoformat(),
        float(np.nanmin(hs)),
        float(np.nanmax(hs)),
    )

    # Preserve the TRUE land/ocean mask before we start inpainting —
    # we still want alpha close to 0 over land in the final PNG so the
    # renderer doesn't paint waves on continents.
    valid_mask = ~np.isnan(hs)
    # Inpaint Hs and DIRPW so the NaN pixels carry the nearest ocean
    # value. Without this, encoding NaN to uint8 leaves undefined
    # garbage in the R/G channels, which then gets linearly
    # interpolated into neighbouring ocean pixels — producing the
    # oversized "dark halo" around small islands that used to show up
    # visibly on the map.
    hs_filled = _fill_nan_nearest(hs)
    direction_filled = _fill_nan_nearest(direction_deg)

    u, v = waves_to_uv(hs_filled, direction_filled)
    u, v = reorient_to_web(u, v, lons)

    # Soft alpha via iterative 4-neighbour box blur of the valid mask.
    # Gives a multi-cell "surf zone" feather at coastlines instead of
    # the hard alpha=0/255 edge that used to punch "dark square" holes
    # around small islands. Physically also more correct — real waves
    # dissipate as they approach shore due to shoaling.
    #
    # Three iterations at 0.25° ≈ 80 km feather. Enough to eliminate
    # the "dark square" around small islands (their wave-coloured fade
    # covers them up) while keeping the "waves on land" projection
    # across the actual coast short enough that continental shorelines
    # look clean. Raising this widens the continental surf-zone effect
    # at the cost of more wave colour bleeding inland.
    blur_iters = 3
    alpha_soft = valid_mask.astype(np.float32)
    for _ in range(blur_iters):
        alpha_soft = (
            alpha_soft
            + np.roll(alpha_soft, 1, axis=0)
            + np.roll(alpha_soft, -1, axis=0)
            + np.roll(alpha_soft, 1, axis=1)
            + np.roll(alpha_soft, -1, axis=1)
        ) / 5.0
    # Clamp so TRUE ocean cells stay fully opaque — only land cells
    # pick up the blurred-down values. Keeps deep-ocean wave colours
    # vibrant right up to the coast instead of getting pulled toward
    # transparency by the blur averaging in neighbouring land zeros.
    alpha_soft = np.maximum(alpha_soft, valid_mask.astype(np.float32))

    # Threshold to kill the blur "tail" deep inside land. Without this
    # the 0.1–0.2 alpha values a few cells inland show up as grey
    # "fog" over complex archipelagos (Canadian Arctic, Svalbard,
    # Antarctic peninsula) because every land cell there is within a
    # few cells of ocean — cumulative faint alpha covers the basemap
    # darkness with a bleed of wave colour. Zeroing anything below
    # ~0.3 keeps the coast-adjacent soft feather and removes the
    # inland fog.
    alpha_soft = np.where(alpha_soft < 0.3, 0.0, alpha_soft)
    # Reorient alpha + u/v with the same geographic transforms.
    alpha_reoriented, _ = reorient_to_web(
        alpha_soft, np.zeros_like(alpha_soft), lons
    )
    alpha_uint8 = (alpha_reoriented.clip(0, 1) * 255.0).astype(np.uint8)

    png_path = output_dir / f"{basename}.png"
    stats = encode_uv_to_png(u, v, png_path, alpha_override=alpha_uint8)

    sidecar: dict = {
        "width": int(u.shape[1]),
        "height": int(u.shape[0]),
        "imageType": "VECTOR",
        "imageUnscale": [stats.unscale[0], stats.unscale[1]],
        "unit": "m",  # wave height expressed in metres
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
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Encode a GFS-Wave GRIB2 file to a weatherlayers-gl PNG + JSON sidecar",
    )
    parser.add_argument("grib_path", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("out"))
    parser.add_argument("--basename", type=str, default=None)
    parser.add_argument(
        "--cycle", type=str, default=None, help="Cycle start as ISO-8601"
    )
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
