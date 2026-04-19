"""
Bathymetry-aware safety check for ocean routing.

Loads NOAA ETOPO 2022 1-arc-minute bed-elevation data (≈500 MB
NetCDF) into a numpy array and exposes a fast nearest-cell depth
lookup. Used by build_v2_landsafe.py to reject transit arcs whose
sample points fall over water shallower than a tanker-safe draft.

Grid shape: 10800 rows (lat) × 21600 cols (lon)
Resolution: 1/60° (≈1.85 km at equator, <1 km at 60° lat)
Values:     elevation in metres (negative = sea floor depth)

Why ETOPO 2022 and not GEBCO:
  - NOAA hosts ETOPO on a direct HTTPS URL with no sign-up
  - GEBCO's web portal requires registration + manual download
  - For our threshold check (depth < 20 m = unsafe) the 1' resolution
    is plenty. GEBCO's 15" (500 m) data is overkill for us.
  - ETOPO and GEBCO are essentially the same data at this resolution
    (GEBCO itself is built from ETOPO + additional surveys)

Licence: ETOPO 2022 is US Government work — public domain, no
attribution legally required, but we credit NOAA in CREDITS.md.
"""

from __future__ import annotations
import math
from pathlib import Path
from typing import Optional

import numpy as np


DATA_PATH = Path(__file__).parent / "data" / "etopo_60s_bed.nc"


class BathymetryMask:
    """
    In-memory bathymetry + depth-threshold query.

    `depth_at(lat, lon)` returns the sea-floor depth in metres as a
    positive number (m below sea level), or 0.0 if the point is on
    land (elevation > 0).

    `is_unsafe(lat, lon, min_depth_m)` returns True if the point is
    either on land or over water shallower than `min_depth_m`. This
    is the hot path for arc_is_clear — ~17 k samples per pipeline
    run, each in ~1 µs once the grid is loaded.
    """

    def __init__(self, grid: np.ndarray, lat_min: float, lon_min: float, step_deg: float):
        self.grid = grid          # shape (H, W) = (lat rows, lon cols), float32 m
        self.lat_min = lat_min    # southern edge of cell (0, 0)
        self.lon_min = lon_min    # western edge of cell (0, 0)
        self.step = step_deg      # degrees per cell (1/60 for ETOPO 60s)
        self.height = grid.shape[0]
        self.width = grid.shape[1]

    @classmethod
    def load(cls, path: Path = DATA_PATH) -> BathymetryMask:
        """Load the NetCDF file. Takes ~1-2 s and ~500 MB RAM."""
        import xarray as xr
        if not path.exists():
            raise FileNotFoundError(
                f"Bathymetry data not found at {path}. "
                f"Download via: curl -L -o {path} "
                f"https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/"
                f"60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc"
            )
        ds = xr.open_dataset(path)
        # ETOPO stores latitude ascending (-89.99 → 89.99). That matches
        # our index convention: row 0 = south pole side.
        lat_arr = ds.lat.values
        lon_arr = ds.lon.values
        # `z` is the bed elevation in metres. Loading with .values forces
        # the full array into RAM up front so per-query cost is pure
        # numpy index math. float32 is plenty for our metre-scale
        # threshold check and halves the memory footprint vs float64.
        z = ds.z.values.astype(np.float32)
        lat_min = float(lat_arr[0])
        lon_min = float(lon_arr[0])
        step = float(lat_arr[1] - lat_arr[0])
        ds.close()
        return cls(grid=z, lat_min=lat_min, lon_min=lon_min, step_deg=step)

    def elevation_m(self, lat: float, lon: float) -> float:
        """
        Raw elevation (positive = above sea level, negative = below).
        Nearest-cell lookup, no interpolation. Returns np.nan if the
        coords are outside the grid (shouldn't happen for valid
        Earth coords but we guard against it).
        """
        # Normalise longitude to [-180, 180).
        if lon >= 180.0:
            lon -= 360.0
        elif lon < -180.0:
            lon += 360.0
        row = int((lat - self.lat_min) / self.step + 0.5)
        col = int((lon - self.lon_min) / self.step + 0.5)
        if row < 0 or row >= self.height or col < 0 or col >= self.width:
            return float("nan")
        return float(self.grid[row, col])

    def depth_m(self, lat: float, lon: float) -> float:
        """
        Sea-floor depth at (lat, lon) as a POSITIVE number of metres.
        Returns 0.0 if the point is over land or the grid cell happens
        to be recorded as exactly sea level (rare in the 60 s grid).
        """
        e = self.elevation_m(lat, lon)
        if math.isnan(e) or e >= 0:
            return 0.0
        return -e

    def is_unsafe(self, lat: float, lon: float, min_depth_m: float) -> bool:
        """
        True if the point is either land OR water shallower than
        `min_depth_m`. This is the fast path arc_is_clear calls on
        every sample along a candidate edge.

        Typical threshold:
          20 m — loaded MR tanker (draft ~12 m + UKC 8 m)
          25 m — Suezmax loaded
          30 m — VLCC loaded
        """
        e = self.elevation_m(lat, lon)
        # NaN (out-of-grid) treated as safe to avoid false positives.
        if math.isnan(e):
            return False
        if e >= 0:
            # Land.
            return True
        return -e < min_depth_m

    def is_unsafe_batch(
        self, lats: np.ndarray, lons: np.ndarray, min_depth_m: float
    ) -> np.ndarray:
        """
        Vectorised version of `is_unsafe` for when we want to pre-check
        a whole edge in one numpy call. About 1000× faster than a Python
        loop once you're checking >1000 samples.
        """
        # Longitude wrap-around (in-place modification OK on a local copy).
        lons = np.where(lons >= 180.0, lons - 360.0, lons)
        lons = np.where(lons < -180.0, lons + 360.0, lons)
        rows = ((lats - self.lat_min) / self.step + 0.5).astype(np.int64)
        cols = ((lons - self.lon_min) / self.step + 0.5).astype(np.int64)
        in_range = (
            (rows >= 0) & (rows < self.height) & (cols >= 0) & (cols < self.width)
        )
        # Fill out-of-range with 0 index to avoid numpy errors, then mask.
        safe_rows = np.where(in_range, rows, 0)
        safe_cols = np.where(in_range, cols, 0)
        e = self.grid[safe_rows, safe_cols]
        on_land = e >= 0
        shallow = -e < min_depth_m
        # Out-of-range points are safe (we don't know = don't reject).
        return in_range & (on_land | shallow)


def main() -> None:
    """CLI smoke test — prints depth at a few well-known points."""
    print("Loading ETOPO 2022 60s bathymetry…")
    b = BathymetryMask.load()
    print(f"  Grid: {b.height} × {b.width}, step {b.step:.5f}°, "
          f"range lat [{b.lat_min:.2f}, {b.lat_min + (b.height-1)*b.step:.2f}]")

    sample_points = [
        ("Mariana Trench",       11.35,  142.20, "deepest ocean"),
        ("Mid-Atlantic (abyssal)", 40.00, -40.00, "open ocean"),
        ("North Sea (shallow)",   54.00,   3.00, "shallow shelf"),
        ("Grand Banks",           45.00, -52.00, "shallow, historically ice-prone"),
        ("English Channel",       50.20,   0.00, "narrow busy water"),
        ("Singapore Strait",       1.20, 104.20, "busy, narrow, shallow"),
        ("Rotterdam port",        51.95,   4.12, "inside harbour"),
        ("Liberia coast 5 NM",     5.95, -10.90, "off Monrovia"),
        ("Liberia coast 30 NM",    5.60, -11.40, "transit lane offshore"),
        ("Mount Everest",         27.99,  86.93, "very not sea"),
    ]
    print(f"{'Location':<26} {'Lat':>7} {'Lon':>9} {'Depth (m)':>12}  Notes")
    print("-" * 90)
    for name, lat, lon, note in sample_points:
        d = b.depth_m(lat, lon)
        elev = b.elevation_m(lat, lon)
        print(f"{name:<26} {lat:>7.2f} {lon:>9.2f} {d:>12.0f}  {note} (elev={elev:.0f} m)")

    # Also report is_unsafe for 20 m tanker threshold.
    print()
    print("Safety check at 20 m tanker threshold:")
    for name, lat, lon, _note in sample_points:
        print(f"  {name:<26} unsafe? {b.is_unsafe(lat, lon, 20)}")


if __name__ == "__main__":
    main()
