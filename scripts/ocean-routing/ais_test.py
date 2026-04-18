"""
Quick spike: read one day of MarineCadastre AIS data, filter to
tankers, surface (a) the most-visited dwell points (ports) and
(b) a rough shipping-lane density grid.

Goal is proof-of-concept, not production. We just want to see
what one day of US coastal traffic tells us.

Data source: MarineCadastre.gov — US government AIS feed, public
domain. Vessel type 80–89 = tankers.
"""

import csv
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

AIS_CSV = Path(r"C:\Users\Arne\AppData\Local\Temp\ais\AIS_2023_01_01.csv")
GRID_DEG = 0.25       # ~15 NM cell for dwell clustering
LANE_GRID_DEG = 0.5   # coarser grid for lane heatmap
DWELL_SOG_KNOTS = 0.5 # considered at-rest


def is_tanker(vessel_type_str: str) -> bool:
    try:
        v = int(vessel_type_str)
        return 80 <= v <= 89
    except Exception:
        return False


def main():
    print(f"Reading {AIS_CSV} ({AIS_CSV.stat().st_size / 1e9:.2f} GB)...")
    rows = 0
    tanker_rows = 0
    tanker_mmsi = set()
    dwell_counts: Counter = Counter()    # (lat_round, lon_round) → hits
    lane_counts: Counter = Counter()     # (lat_round, lon_round) at any speed
    vessel_types = Counter()
    names_at_dwell: dict = defaultdict(Counter)   # (cell) → Counter(name → hits)

    def round_to(deg_step, value):
        return round(value / deg_step) * deg_step

    with open(AIS_CSV, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows += 1
            vt = row.get("VesselType", "") or ""
            vessel_types[vt] += 1
            if not is_tanker(vt):
                continue
            tanker_rows += 1
            try:
                lat = float(row["LAT"])
                lon = float(row["LON"])
                sog = float(row.get("SOG") or 0)
            except Exception:
                continue
            tanker_mmsi.add(row.get("MMSI"))
            lane_key = (round_to(LANE_GRID_DEG, lat), round_to(LANE_GRID_DEG, lon))
            lane_counts[lane_key] += 1
            if sog < DWELL_SOG_KNOTS:
                dkey = (round_to(GRID_DEG, lat), round_to(GRID_DEG, lon))
                dwell_counts[dkey] += 1
                name = (row.get("VesselName") or "").strip()
                if name:
                    names_at_dwell[dkey][name] += 1
            if rows % 500_000 == 0:
                print(f"  {rows:,} rows scanned, {tanker_rows:,} tanker rows, "
                      f"{len(tanker_mmsi):,} distinct tankers")

    print("\n" + "=" * 60)
    print(f"Total rows: {rows:,}")
    print(f"Tanker rows (type 80–89): {tanker_rows:,} "
          f"({tanker_rows / rows * 100:.1f}% of traffic)")
    print(f"Distinct tanker MMSI: {len(tanker_mmsi):,}")
    print()
    print("Vessel-type distribution (top 10):")
    for vt, n in vessel_types.most_common(10):
        print(f"  type={vt or '(blank)':>5}  {n:>10,}")

    print("\n" + "=" * 60)
    print(f"Top 30 tanker dwell points (grid {GRID_DEG}°, SOG < {DWELL_SOG_KNOTS} kn):")
    print(f"  {'lat':>7}  {'lon':>8}  {'hits':>8}  top vessel names")
    for (lat, lon), n in dwell_counts.most_common(30):
        names = names_at_dwell[(lat, lon)].most_common(3)
        name_str = ", ".join(f"{nm}({c})" for nm, c in names) if names else "—"
        print(f"  {lat:7.2f}  {lon:8.2f}  {n:>8,}  {name_str}")

    print("\n" + "=" * 60)
    print(f"Top 30 tanker lane cells (grid {LANE_GRID_DEG}°, any speed):")
    for (lat, lon), n in lane_counts.most_common(30):
        print(f"  {lat:7.2f}  {lon:8.2f}  {n:>8,}")


if __name__ == "__main__":
    main()
