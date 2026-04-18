"""
Multi-day MarineCadastre AIS analysis — discover tanker-hub ports
that are NOT in our current 112-port database.

Pipeline:
  1. Read AIS_2023_01_0{1..4}.csv (4 days, ~3.5 GB total).
  2. Filter rows to tanker vessel types (80-89).
  3. Filter further to "dwell" rows: SOG < 0.5 kn, tanker is stopped.
  4. Bin dwells into 0.1° × 0.1° cells (~6 NM), count visits.
  5. Drop cells within ~15 NM of any existing port (covered already).
  6. Top N remaining cells = suggested new ports.

Outputs a markdown table so it's obvious which hubs to add.
"""

from __future__ import annotations

import csv
import math
from collections import Counter, defaultdict
from pathlib import Path

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_v2_landsafe import PORTS, effective_port_coord

AIS_DIR = Path(r"C:\Users\Arne\AppData\Local\Temp\ais")
AIS_FILES = [
    "AIS_2023_01_01.csv",
    "AIS_2023_01_02.csv",
    "AIS_2023_01_03.csv",
    "AIS_2023_01_04.csv",
]
GRID_DEG = 0.10                # ~6 NM bin size for dwell clusters
DWELL_SOG_KNOTS = 0.5
NEAR_PORT_NM = 15.0            # drop cells within this range of an existing port
TOP_N = 40


def is_tanker(v: str) -> bool:
    try:
        return 80 <= int(v) <= 89
    except Exception:
        return False


def haversine_nm(la1, lo1, la2, lo2):
    R = 3440.065
    p1, p2 = math.radians(la1), math.radians(la2)
    dp = math.radians(la2 - la1); dl = math.radians(lo2 - lo1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def round_bin(v: float, step: float) -> float:
    return round(v / step) * step


def main():
    # Port list (use effective / pilot-station coords since that's where
    # AIS dwells would aggregate for our own ports).
    port_coords = {p: effective_port_coord(p) for p in PORTS}
    print(f"Existing port database: {len(port_coords)} entries")

    dwell_counts: Counter = Counter()
    name_hits: dict = defaultdict(Counter)
    imo_hits: dict = defaultdict(set)
    total_rows = 0
    tanker_rows = 0

    for filename in AIS_FILES:
        path = AIS_DIR / filename
        if not path.exists():
            print(f"  SKIP (missing): {path}")
            continue
        print(f"Scanning {filename} ({path.stat().st_size / 1e9:.2f} GB)...")
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                total_rows += 1
                if not is_tanker(row.get("VesselType", "")):
                    continue
                tanker_rows += 1
                try:
                    lat = float(row["LAT"])
                    lon = float(row["LON"])
                    sog = float(row.get("SOG") or 0)
                except Exception:
                    continue
                if sog >= DWELL_SOG_KNOTS:
                    continue
                key = (round_bin(lat, GRID_DEG), round_bin(lon, GRID_DEG))
                dwell_counts[key] += 1
                name = (row.get("VesselName") or "").strip()
                if name:
                    name_hits[key][name] += 1
                imo = (row.get("IMO") or "").strip()
                if imo:
                    imo_hits[key].add(imo)

    print(f"\nTotal rows: {total_rows:,}, tanker rows: {tanker_rows:,}")
    print(f"Distinct dwell cells: {len(dwell_counts):,}")

    # Drop cells within NEAR_PORT_NM of any existing port
    near_port: dict = {}
    kept: list = []
    for (lat, lon), hits in dwell_counts.items():
        nearest_port = None
        nearest_nm = 1e9
        for pname, (plat, plon) in port_coords.items():
            d = haversine_nm(lat, lon, plat, plon)
            if d < nearest_nm:
                nearest_nm = d
                nearest_port = pname
        if nearest_nm < NEAR_PORT_NM:
            continue
        kept.append(((lat, lon), hits, nearest_port, nearest_nm))
    kept.sort(key=lambda x: -x[1])

    print(f"\n## Top {TOP_N} tanker-dwell cells NOT within {NEAR_PORT_NM} NM "
          f"of any current port")
    print(f"\n| rank | lat | lon | hits | distinct tankers | nearest existing port | dist NM | top tanker names |")
    print("|---:|---:|---:|---:|---:|---|---:|---|")
    for rank, ((lat, lon), hits, near, dist) in enumerate(kept[:TOP_N], 1):
        names = name_hits.get((lat, lon), Counter()).most_common(3)
        names_str = ", ".join(f"{n}" for n, _ in names) if names else "—"
        imos = len(imo_hits.get((lat, lon), set()))
        print(f"| {rank} | {lat:.2f} | {lon:.2f} | {hits:,} | {imos} | {near} | "
              f"{dist:.0f} | {names_str} |")

    # Save machine-readable form too
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)
    import json
    (out_dir / "ais_candidate_ports.json").write_text(json.dumps([
        {
            "lat": lat, "lon": lon, "hits": hits,
            "distinct_tankers": len(imo_hits.get((lat, lon), set())),
            "nearest_port": near, "dist_nm": round(dist, 1),
            "top_names": list(name_hits.get((lat, lon), Counter()).most_common(5)),
        }
        for (lat, lon), hits, near, dist in kept[:80]
    ], indent=2))
    print(f"\nWrote top 80 candidates to {out_dir / 'ais_candidate_ports.json'}")


if __name__ == "__main__":
    main()
