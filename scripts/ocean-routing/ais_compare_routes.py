"""
Compare our computed routes against real tanker AIS tracks.

For a chosen port pair where both endpoints are in US waters (so
MarineCadastre covers them), we:

  1. Extract tanker tracks from 4-day AIS: per MMSI, ordered by time.
  2. Keep tracks that start near one port and end near the other
     (within 20 NM of each, ignoring direction).
  3. For each real track, compute the mean cross-track distance
     against our stored path. Low number = we agree with reality.

Also emits a JSON with the real tracks so they can be overlaid on the
map next to our path for visual sanity checking.
"""

from __future__ import annotations

import csv
import json
import math
import sys, os
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_v2_landsafe import PORTS, effective_port_coord
from build_sphere_graph import haversine_nm

AIS_DIR = Path(r"C:\Users\Arne\AppData\Local\Temp\ais")
AIS_FILES = [
    "AIS_2023_01_01.csv", "AIS_2023_01_02.csv",
    "AIS_2023_01_03.csv", "AIS_2023_01_04.csv",
]
PATHS_JSON = Path(__file__).parent / "output" / "paths.json"

PORT_MATCH_NM = 20.0
MIN_TRACK_POINTS = 10


def is_tanker(v: str) -> bool:
    try:
        return 80 <= int(v) <= 89
    except Exception:
        return False


def load_tanker_tracks():
    tracks: dict = defaultdict(list)
    for filename in AIS_FILES:
        path = AIS_DIR / filename
        if not path.exists():
            continue
        print(f"Reading {filename}...")
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not is_tanker(row.get("VesselType", "")):
                    continue
                try:
                    lat = float(row["LAT"])
                    lon = float(row["LON"])
                except Exception:
                    continue
                mmsi = row.get("MMSI")
                t = row.get("BaseDateTime")
                if not mmsi or not t:
                    continue
                tracks[mmsi].append((t, lat, lon))
    # Sort each vessel's track chronologically
    for mmsi in tracks:
        tracks[mmsi].sort()
    print(f"Loaded {len(tracks):,} tanker tracks")
    return tracks


def track_matches_pair(track, port_a, port_b):
    """True if the track visits near port_a AND near port_b (order agnostic)."""
    near_a = False
    near_b = False
    for _, lat, lon in track:
        if not near_a and haversine_nm(lat, lon, port_a[0], port_a[1]) < PORT_MATCH_NM:
            near_a = True
        if not near_b and haversine_nm(lat, lon, port_b[0], port_b[1]) < PORT_MATCH_NM:
            near_b = True
        if near_a and near_b:
            return True
    return False


def path_cross_track_distance(path, track):
    """
    For each point in `track`, compute the minimum great-circle distance
    to any waypoint in `path`. Return (mean, max, samples_count).
    `path` is [[lat, lon], ...], `track` is [(t, lat, lon), ...].
    """
    if not path or not track:
        return None
    total = 0.0
    max_d = 0.0
    n = 0
    for _, lat, lon in track:
        best = float("inf")
        for p_lat, p_lon in path:
            d = haversine_nm(lat, lon, p_lat, p_lon)
            if d < best:
                best = d
        total += best
        if best > max_d:
            max_d = best
        n += 1
    return (total / n, max_d, n)


def main():
    if len(sys.argv) < 3:
        print("Usage: ais_compare_routes.py 'Port A, XX' 'Port B, XX'")
        print("\nExample: ais_compare_routes.py 'Houston, US' 'Philadelphia, US'")
        sys.exit(1)
    a_name = sys.argv[1]
    b_name = sys.argv[2]
    if a_name not in PORTS or b_name not in PORTS:
        print(f"Unknown port. Available: {list(PORTS)[:8]}...")
        sys.exit(1)

    # Use effective port coordinates for the "near port" test since that's
    # where tankers physically dwell.
    pa = effective_port_coord(a_name)
    pb = effective_port_coord(b_name)
    print(f"Port A: {a_name} -> {pa}")
    print(f"Port B: {b_name} -> {pb}")

    # Load our stored path
    paths = json.loads(PATHS_JSON.read_text())
    key = f"{a_name}|{b_name}" if a_name < b_name else f"{b_name}|{a_name}"
    our_path = paths.get(key)
    if not our_path:
        print(f"No stored path for {key}")
        sys.exit(1)
    print(f"Our path: {len(our_path)} waypoints")

    # Extract tanker tracks matching the pair
    tracks = load_tanker_tracks()
    matching = []
    for mmsi, tr in tracks.items():
        if len(tr) < MIN_TRACK_POINTS:
            continue
        if track_matches_pair(tr, pa, pb):
            matching.append((mmsi, tr))

    print(f"\nReal tanker tracks visiting BOTH ports: {len(matching)}")
    if not matching:
        print("(Try a busier US pair, e.g. Houston + Philadelphia, "
              "or Houston + NewYork.)")
        sys.exit(0)

    # For each matching track, compute how close it follows our path
    print(f"\n{'MMSI':<12} {'points':>7} {'mean NM':>9} {'max NM':>9}")
    print("-" * 40)
    deviations = []
    for mmsi, tr in matching:
        stats = path_cross_track_distance(our_path, tr)
        if stats is None:
            continue
        mean_nm, max_nm, n = stats
        deviations.append(mean_nm)
        print(f"{mmsi:<12} {n:>7} {mean_nm:>9.1f} {max_nm:>9.1f}")

    if deviations:
        deviations.sort()
        median = deviations[len(deviations) // 2]
        avg = sum(deviations) / len(deviations)
        print(f"\nAgreement with real tanker tracks:")
        print(f"  Median track vs our path mean distance: {median:.1f} NM")
        print(f"  Average: {avg:.1f} NM")
        print(f"  (Lower = our path matches reality better.)")

    # Dump one representative real track + our path as JSON for overlay
    out = {
        "our_path": our_path,
        "real_tracks": [
            {
                "mmsi": m,
                "points": [[lat, lon] for _, lat, lon in tr],
            }
            for m, tr in matching[:5]
        ],
    }
    out_path = Path(__file__).parent / "output" / f"compare_{a_name.split(',')[0]}_{b_name.split(',')[0]}.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nOverlay JSON: {out_path}")


if __name__ == "__main__":
    main()
