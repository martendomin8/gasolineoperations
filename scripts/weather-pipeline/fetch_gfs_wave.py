#!/usr/bin/env python3
"""Download one GFS-Wave forecast file from NOAA.

The unified GFS-Wave product (a.k.a. gfswave) took over from the legacy
WaveWatch III naming in 2020. It's published on the same cadence as
atmospheric GFS — 4 cycles/day (00/06/12/18 UTC) — at 0.25° global
resolution with a 0..384 h forecast horizon.

Uses the NOMADS filter service (filter_gfswave.pl) to pull only the
three variables we actually visualise:

    HTSGW  — significant wave height  [m]
    PERPW  — primary wave mean period [s]
    DIRPW  — primary wave direction   [deg, compass]

NOMADS filter URL pattern:
    https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl
        ?file=gfswave.t{HH}z.global.0p25.f{FFF}.grib2
        &var_HTSGW=on
        &var_PERPW=on
        &var_DIRPW=on
        &dir=%2Fgfs.{YYYYMMDD}%2F{HH}%2Fwave%2Fgridded

Usage (CLI):
    python fetch_gfs_wave.py --latest --forecast-hour 24 --output-dir data/
    python fetch_gfs_wave.py --cycle 2026042012 --forecast-hour 24 --output-dir data/

Usage (module):
    from fetch_gfs_wave import fetch_gfs_wave
    from fetch_gfs import latest_cycle
    path = fetch_gfs_wave(latest_cycle(), forecast_hour=24, output_dir=Path("data"))
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests

# Share `latest_cycle` + the _parse_cycle_arg helper so the two fetchers
# agree on which cycles are publishable.
from fetch_gfs import _parse_cycle_arg, latest_cycle

NOMADS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"

logger = logging.getLogger(__name__)


def build_filter_params(
    cycle_dt: datetime,
    forecast_hour: int,
    variables: Iterable[str] = ("HTSGW", "PERPW", "DIRPW"),
) -> dict[str, str]:
    """Build the NOMADS filter query params for one GFS-Wave forecast step.

    Unlike the atmospheric filter_gfs_0p25.pl, filter_gfswave.pl does
    not take a `lev_...=on` key — wave variables live at the surface by
    construction.
    """
    yyyymmdd = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    fff = f"{forecast_hour:03d}"
    params: dict[str, str] = {
        "file": f"gfswave.t{hh}z.global.0p25.f{fff}.grib2",
        "dir": f"/gfs.{yyyymmdd}/{hh}/wave/gridded",
    }
    for v in variables:
        params[f"var_{v}"] = "on"
    return params


def fetch_gfs_wave(
    cycle_dt: datetime,
    forecast_hour: int,
    output_dir: Path,
    variables: Iterable[str] = ("HTSGW", "PERPW", "DIRPW"),
    timeout: float = 60.0,
) -> Path:
    """Download one GFS-Wave forecast step to `output_dir`.

    Returns the local path to the downloaded GRIB2 file:
        gfswave_{YYYYMMDD}_{HH}_f{FFF}.grib2
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    yyyymmdd = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    fff = f"{forecast_hour:03d}"
    output_path = output_dir / f"gfswave_{yyyymmdd}_{hh}_f{fff}.grib2"

    if output_path.exists() and output_path.stat().st_size > 0:
        logger.info("Already downloaded: %s", output_path)
        return output_path

    params = build_filter_params(cycle_dt, forecast_hour, variables=variables)
    logger.info("Fetching %s with params %s", NOMADS_FILTER_URL, params)
    # Non-streaming GET — GFS-Wave filter responses are 5-15 MB per
    # step, which is small enough for memory. The streaming path had
    # a subtle requests/iter_content interaction that truncated
    # downloads to the first chunk only.
    response = requests.get(NOMADS_FILTER_URL, params=params, timeout=timeout)
    response.raise_for_status()
    content = response.content
    if not content.startswith(b"GRIB"):
        raise RuntimeError(
            f"filter_gfswave.pl returned non-GRIB2 content (first bytes: "
            f"{content[:64]!r}). The cycle may not yet be published, "
            f"or the filter params may be invalid."
        )
    output_path.write_bytes(content)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    logger.info("Saved %s (%.2f MB)", output_path, size_mb)
    return output_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    cycle_group = parser.add_mutually_exclusive_group(required=True)
    cycle_group.add_argument("--cycle", type=_parse_cycle_arg)
    cycle_group.add_argument("--latest", action="store_true")
    parser.add_argument("--forecast-hour", type=int, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cycle_dt = args.cycle if args.cycle is not None else latest_cycle()
    logger.info("Cycle:  %s UTC", cycle_dt.strftime("%Y-%m-%d %H:%M"))
    logger.info("F-hour: %03d", args.forecast_hour)

    try:
        path = fetch_gfs_wave(
            cycle_dt=cycle_dt,
            forecast_hour=args.forecast_hour,
            output_dir=args.output_dir,
        )
    except requests.HTTPError as e:
        logger.error("HTTP error: %s", e)
        return 2
    except RuntimeError as e:
        logger.error("%s", e)
        return 3

    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
