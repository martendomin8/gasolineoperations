"""
Fast iteration helper: apply hand_drawn_routes.json to the existing
output/distances.json + output/paths.json without re-running the
full 10-minute Dijkstra build.

Use this to iterate on hand-drawn waypoints. When you're happy,
run build_distances.py for a clean rebuild.
"""

import json
import math
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
HAND_DRAWN_PATH = Path(__file__).parent / "hand_drawn_routes.json"


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in nautical miles."""
    R_NM = 3440.065  # Earth radius in nautical miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(a))


def main():
    distances_path = OUTPUT_DIR / "distances.json"
    paths_path = OUTPUT_DIR / "paths.json"

    if not distances_path.exists() or not paths_path.exists():
        print("ERROR: Run build_distances.py first to generate baseline files")
        return

    with open(distances_path) as f:
        distances = json.load(f)
    with open(paths_path) as f:
        paths = json.load(f)

    if not HAND_DRAWN_PATH.exists():
        print(f"No {HAND_DRAWN_PATH} — nothing to apply")
        return

    with open(HAND_DRAWN_PATH) as f:
        hand_drawn = json.load(f)

    print("Applying hand-drawn route overrides:\n")
    applied = 0
    for key, entry in hand_drawn.items():
        if key.startswith("_"):
            continue
        wps = entry.get("waypoints")
        if not wps or len(wps) < 2:
            continue

        parts = key.split("|")
        if len(parts) != 2 or parts[0] >= parts[1]:
            print(f"  WARN: '{key}' not alphabetically sorted — skipping")
            continue

        total_nm = 0.0
        for k in range(len(wps) - 1):
            total_nm += haversine_nm(wps[k][0], wps[k][1],
                                      wps[k+1][0], wps[k+1][1])

        old_dist = distances.get(key)
        new_dist = round(total_nm, 1)

        distances[key] = new_dist
        paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in wps]
        applied += 1

        if old_dist is not None:
            delta = new_dist - old_dist
            sign = "+" if delta >= 0 else ""
            print(f"  {key}")
            print(f"    distance: {old_dist} -> {new_dist} NM ({sign}{delta:.1f})")
            print(f"    waypoints: {len(wps)}")
        else:
            print(f"  {key} (new) -> {new_dist} NM, {len(wps)} waypoints")

    # Save the list of hand-drawn keys so the client can skip
    # great-circle re-rendering (waypoints are already curated).
    hand_drawn_keys = sorted(
        k for k in hand_drawn.keys()
        if not k.startswith("_") and hand_drawn[k].get("waypoints")
    )
    keys_path = OUTPUT_DIR / "hand_drawn_keys.json"
    with open(keys_path, "w") as f:
        json.dump({"keys": hand_drawn_keys}, f, indent=2)

    with open(distances_path, "w") as f:
        json.dump(distances, f, indent=2)
    with open(paths_path, "w") as f:
        json.dump(paths, f, separators=(",", ":"))

    print(f"\nApplied {applied} override(s). Files updated:")
    print(f"  {distances_path}")
    print(f"  {paths_path}")
    print(f"\nRemember to copy to src/lib/sea-distance/ before testing.")


if __name__ == "__main__":
    main()
