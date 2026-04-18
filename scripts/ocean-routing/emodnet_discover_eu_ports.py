"""
Discover European tanker hubs from EMODnet vessel density data.

EMODnet publishes annual-average tanker density rasters (vessel-type
code 10) at 1 km resolution across all EU waters. Dense cells =
places tankers spend lots of time = ports + anchorages.

Pipeline:
  1. Open vesseldensity_10_2024.tif (tanker hours/km²/year).
  2. Reproject each pixel centre from EPSG:3035 back to lat/lon.
  3. Keep top-N cells by density.
  4. Drop cells within 25 NM of an existing port in our list.
  5. Cluster the remaining high-density cells so dense anchorages
     (dozens of adjacent hot pixels) show up as one candidate.
  6. Emit markdown table of top candidates — the ones we should
     consider adding to our port database.

License: EMODnet Human Activities vessel density maps are CC-BY 4.0
(originator: Cogea Srl). We must credit EMODnet + originator when
we publish derived work.
"""

from __future__ import annotations

import math
import sys, os
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_v2_landsafe import PORTS, effective_port_coord
from build_sphere_graph import haversine_nm

TIF_PATH = Path(r"C:\Users\Arne\AppData\Local\Temp\emodnet\EMODnet_HA_Vessel_Density_10Avg\vesseldensity_10_2024.tif")

TOP_CELL_PCTILE = 99.5      # only look at top 0.5% densest cells
CLUSTER_NM = 6.0            # cells within 6 NM merge into one candidate
PORT_MATCH_NM = 25.0        # drop candidates within this of an existing port
MAX_CANDIDATES = 30


def main():
    import rasterio
    import numpy as np
    from pyproj import Transformer

    print(f"Opening {TIF_PATH.name}...")
    with rasterio.open(TIF_PATH) as src:
        data = src.read(1)
        nodata = src.nodata
        transform = src.transform
        crs = src.crs

    # Mask nodata
    mask = np.isfinite(data) & (data != nodata) & (data > 0)
    values = data[mask]
    if values.size == 0:
        print("No valid pixels.")
        return

    threshold = np.percentile(values, TOP_CELL_PCTILE)
    print(f"Density range: {values.min():.2f} – {values.max():.2f} "
          f"(top {100 - TOP_CELL_PCTILE:.1f}% cutoff = {threshold:.2f})")

    # Grab coordinates of cells above threshold
    ys, xs = np.where((data >= threshold) & mask)
    print(f"Cells above threshold: {len(xs):,}")

    # Reproject EPSG:3035 -> lat/lon (EPSG:4326)
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    cells: list[tuple[float, float, float]] = []
    for y, x in zip(ys, xs):
        # Pixel centre in EPSG:3035
        px, py = transform * (x + 0.5, y + 0.5)
        lon, lat = transformer.transform(px, py)
        cells.append((lat, lon, float(data[y, x])))

    # Cluster: simple nearest-merge in NM space. Sort by density so
    # peaks absorb their neighbours.
    cells.sort(key=lambda r: -r[2])
    clusters: list[dict] = []
    for lat, lon, v in cells:
        merged = False
        for c in clusters:
            if haversine_nm(lat, lon, c["lat"], c["lon"]) < CLUSTER_NM:
                # Weighted centroid update
                total_v = c["sum_v"] + v
                c["lat"] = (c["lat"] * c["sum_v"] + lat * v) / total_v
                c["lon"] = (c["lon"] * c["sum_v"] + lon * v) / total_v
                c["sum_v"] = total_v
                c["peak"] = max(c["peak"], v)
                c["cells"] += 1
                merged = True
                break
        if not merged:
            clusters.append({
                "lat": lat, "lon": lon,
                "sum_v": v, "peak": v, "cells": 1,
            })

    print(f"Clusters after merge (within {CLUSTER_NM} NM): {len(clusters):,}")

    # Drop clusters close to existing ports
    port_coords = {p: effective_port_coord(p) for p in PORTS}
    results = []
    for c in clusters:
        nearest_port = None
        nearest_nm = 1e9
        for pname, (plat, plon) in port_coords.items():
            d = haversine_nm(c["lat"], c["lon"], plat, plon)
            if d < nearest_nm:
                nearest_nm = d
                nearest_port = pname
        if nearest_nm < PORT_MATCH_NM:
            continue
        results.append({**c, "nearest_port": nearest_port, "dist_nm": nearest_nm})
    results.sort(key=lambda r: -r["sum_v"])

    print(f"\nTop {MAX_CANDIDATES} EU tanker hubs NOT within "
          f"{PORT_MATCH_NM} NM of any existing port:")
    print(f"\n| rank | lat | lon | peak (h/km²/yr) | cells | nearest existing | dist NM |")
    print("|---:|---:|---:|---:|---:|---|---:|")
    for i, r in enumerate(results[:MAX_CANDIDATES], 1):
        print(f"| {i} | {r['lat']:.2f} | {r['lon']:.2f} | "
              f"{r['peak']:.0f} | {r['cells']} | {r['nearest_port']} | {r['dist_nm']:.0f} |")

    # Dump for later use
    import json
    out = Path(__file__).parent / "output" / "emodnet_eu_candidates.json"
    out.write_text(json.dumps(results[:60], indent=2, default=float))
    print(f"\nWrote top 60 candidates to {out}")


if __name__ == "__main__":
    main()
