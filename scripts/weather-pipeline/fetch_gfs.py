#!/usr/bin/env python3
"""Download one GFS forecast file from NOAA.

Uses the NOMADS filter service so we pull only the specific variables
and levels we need (UGRD + VGRD at 10 m above ground), returning a
small ~2-5 MB GRIB2 file instead of the full ~500 MB forecast file.

The NOMADS filter URL pattern:
    https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
        ?file=gfs.t{HH}z.pgrb2.0p25.f{FFF}
        &lev_10_m_above_ground=on
        &var_UGRD=on
        &var_VGRD=on
        &dir=%2Fgfs.{YYYYMMDD}%2F{HH}%2Fatmos

Rate-limit note: NOMADS throttles aggressive clients at roughly 120
requests/minute. Our cron fires 4x/day and pulls ~40 forecast steps
per run, so we stay well inside the limit.

Usage (CLI):
    python fetch_gfs.py --cycle 2026042012 --forecast-hour 24 \\
        --output data/gfs_20260420_12_f024.grib2

Or, for the most recent published cycle:
    python fetch_gfs.py --latest --forecast-hour 24 --output-dir data/

Usage (module):
    from fetch_gfs import fetch_gfs, latest_cycle
    path = fetch_gfs(latest_cycle(), forecast_hour=24, output_dir=Path("data"))
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import requests

NOMADS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

# NOAA typically finishes publishing a GFS cycle 4-5 hours after the
# nominal cycle time. We wait 5 h to be safe.
PUBLISH_DELAY = timedelta(hours=5)

# GFS issues 4 cycles per day, 6 h apart.
CYCLE_HOURS = (0, 6, 12, 18)

logger = logging.getLogger(__name__)


def latest_cycle(now: datetime | None = None) -> datetime:
    """Return the most recent GFS cycle that should be fully published.

    "Fully published" means at least PUBLISH_DELAY has elapsed since the
    nominal cycle time — NOAA takes several hours to finish writing all
    forecast steps after each cycle starts.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    # Step back in 6-hour increments until we find a cycle whose publish
    # window is safely behind us.
    candidate = now.replace(minute=0, second=0, microsecond=0)
    # Snap to the nearest cycle hour at or before `now`.
    cycle_hour = max(h for h in CYCLE_HOURS if h <= candidate.hour)
    candidate = candidate.replace(hour=cycle_hour)
    while (now - candidate) < PUBLISH_DELAY:
        candidate -= timedelta(hours=6)
    return candidate


def build_filter_params(
    cycle_dt: datetime,
    forecast_hour: int,
    variables: Iterable[str] = ("UGRD", "VGRD"),
    level: str = "10_m_above_ground",
) -> dict[str, str]:
    """Build the NOMADS filter query params for one forecast step.

    `variables` are GFS variable names (UGRD = u-wind, VGRD = v-wind,
    TMP = temperature, etc.). `level` is the NOMADS level slug (e.g.
    '10_m_above_ground' for surface winds, '2_m_above_ground' for 2 m
    temperature).

    Returns a dict meant to be passed as `params=` to `requests.get`;
    letting requests do the URL encoding keeps us safe with characters
    like the `/` inside `dir=/gfs.YYYYMMDD/HH/atmos` that NOMADS wants
    percent-encoded.
    """
    yyyymmdd = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    fff = f"{forecast_hour:03d}"
    params: dict[str, str] = {
        "file": f"gfs.t{hh}z.pgrb2.0p25.f{fff}",
        f"lev_{level}": "on",
        "dir": f"/gfs.{yyyymmdd}/{hh}/atmos",
    }
    for v in variables:
        params[f"var_{v}"] = "on"
    return params


def fetch_gfs(
    cycle_dt: datetime,
    forecast_hour: int,
    output_dir: Path,
    variables: Iterable[str] = ("UGRD", "VGRD"),
    level: str = "10_m_above_ground",
    timeout: float = 60.0,
) -> Path:
    """Download a single GFS forecast step to `output_dir`.

    Returns the local path to the downloaded GRIB2 file.

    The output filename encodes cycle date/hour + forecast hour so
    multiple cycles can coexist in the same directory without clashing:
        gfs_{YYYYMMDD}_{HH}_f{FFF}.grib2
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    yyyymmdd = cycle_dt.strftime("%Y%m%d")
    hh = cycle_dt.strftime("%H")
    fff = f"{forecast_hour:03d}"
    output_path = output_dir / f"gfs_{yyyymmdd}_{hh}_f{fff}.grib2"

    if output_path.exists() and output_path.stat().st_size > 0:
        logger.info("Already downloaded: %s", output_path)
        return output_path

    params = build_filter_params(
        cycle_dt, forecast_hour, variables=variables, level=level
    )
    logger.info("Fetching %s with params %s", NOMADS_FILTER_URL, params)
    # Non-streaming GET — these files are typically 2-5 MB, memory is
    # a non-issue, and the streaming path had a subtle interaction
    # with requests' iter_content that truncated downloads mid-stream.
    # Simpler is better here.
    response = requests.get(NOMADS_FILTER_URL, params=params, timeout=timeout)
    response.raise_for_status()
    content = response.content
    # NOMADS returns an HTML error page with 200 OK when the cycle
    # hasn't been published yet or the filter params are invalid.
    # Real GRIB2 files always start with the four-byte magic "GRIB"
    # and end with "7777".
    if not content.startswith(b"GRIB"):
        raise RuntimeError(
            f"NOMADS returned non-GRIB2 content for the request. "
            f"First bytes: {content[:64]!r}. "
            f"The cycle may not yet be published, or the filter "
            f"parameters may be invalid."
        )
    output_path.write_bytes(content)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    logger.info("Saved %s (%.2f MB)", output_path, size_mb)
    return output_path


def _parse_cycle_arg(value: str) -> datetime:
    """Parse a --cycle argument of the form YYYYMMDDHH."""
    if len(value) != 10 or not value.isdigit():
        raise argparse.ArgumentTypeError(
            "--cycle must be a 10-digit YYYYMMDDHH string, e.g. 2026042012"
        )
    dt = datetime.strptime(value, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    if dt.hour not in CYCLE_HOURS:
        raise argparse.ArgumentTypeError(
            f"--cycle hour must be one of {CYCLE_HOURS}, got {dt.hour}"
        )
    return dt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    cycle_group = parser.add_mutually_exclusive_group(required=True)
    cycle_group.add_argument(
        "--cycle",
        type=_parse_cycle_arg,
        help="GFS cycle as YYYYMMDDHH (UTC), e.g. 2026042012",
    )
    cycle_group.add_argument(
        "--latest",
        action="store_true",
        help="Use the most recent published cycle",
    )
    parser.add_argument(
        "--forecast-hour",
        type=int,
        required=True,
        help="Forecast hour (0, 3, 6, ...). 0 = analysis, i.e. current conditions.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data"),
        help="Directory to save the GRIB2 file (default: data/)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print debug logs",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cycle_dt = args.cycle if args.cycle is not None else latest_cycle()
    logger.info("Cycle:  %s UTC", cycle_dt.strftime("%Y-%m-%d %H:%M"))
    logger.info("F-hour: %03d", args.forecast_hour)

    try:
        path = fetch_gfs(
            cycle_dt=cycle_dt,
            forecast_hour=args.forecast_hour,
            output_dir=args.output_dir,
        )
    except requests.HTTPError as e:
        logger.error("HTTP error fetching GFS: %s", e)
        return 2
    except RuntimeError as e:
        logger.error("%s", e)
        return 3

    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
