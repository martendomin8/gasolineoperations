#!/usr/bin/env python3
"""Download one GFS 2 m temperature forecast file from NOAA.

Thin wrapper around `fetch_gfs.fetch_gfs()` that pins the variable to
TMP (temperature) and the level to 2 m above ground — the same
product Windy shows as its "Temperature" layer. Returned as a
standalone GRIB2 file named `gfs_temp_{YYYYMMDD}_{HH}_f{FFF}.grib2`
so the atmospheric-wind file (`gfs_{YYYYMMDD}_{HH}_f{FFF}.grib2`)
and the temperature file can live side-by-side without clashing.

Usage (CLI):
    python fetch_gfs_temp.py --latest --forecast-hour 24 --output-dir data/

Usage (module):
    from fetch_gfs_temp import fetch_gfs_temp
    from fetch_gfs import latest_cycle
    path = fetch_gfs_temp(latest_cycle(), forecast_hour=24, output_dir=Path("data"))
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path

import requests

from fetch_gfs import NOMADS_FILTER_URL, _parse_cycle_arg, latest_cycle

logger = logging.getLogger(__name__)


def fetch_gfs_temp(
    cycle_dt: datetime,
    forecast_hour: int,
    output_dir: Path,
    timeout: float = 60.0,
) -> Path:
    """Download one GFS 2 m temperature forecast step.

    The NOMADS filter returns just `TMP` at `2_m_above_ground`, a
    ~1–2 MB file. Saved as `gfs_temp_{YYYYMMDD}_{HH}_f{FFF}.grib2`
    so it doesn't collide with the wind file in the same directory.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    yyyymmdd = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    fff = f"{forecast_hour:03d}"
    output_path = output_dir / f"gfs_temp_{yyyymmdd}_{hh}_f{fff}.grib2"

    if output_path.exists() and output_path.stat().st_size > 0:
        logger.info("Already downloaded: %s", output_path)
        return output_path

    params = {
        "file": f"gfs.t{hh}z.pgrb2.0p25.f{fff}",
        "lev_2_m_above_ground": "on",
        "dir": f"/gfs.{yyyymmdd}/{hh}/atmos",
        "var_TMP": "on",
    }
    logger.info("Fetching %s with params %s", NOMADS_FILTER_URL, params)
    response = requests.get(NOMADS_FILTER_URL, params=params, timeout=timeout)
    response.raise_for_status()
    content = response.content
    if not content.startswith(b"GRIB"):
        raise RuntimeError(
            f"NOMADS returned non-GRIB2 content for the request. "
            f"First bytes: {content[:64]!r}. "
            f"The cycle may not yet be published, or the filter params "
            f"may be invalid."
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
        path = fetch_gfs_temp(
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
