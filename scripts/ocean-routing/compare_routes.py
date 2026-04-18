"""
Side-by-side comparison for the specific routes we've been debugging.

Prints waypoint chains and distances for OLD (composer) vs NEW (sphere
graph) so we can eyeball whether the new pipeline produces cleaner
paths for the routes that were visibly wrong.
"""

import json
import math
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
OLD_DIR = Path(__file__).parent.parent.parent / "src" / "lib" / "sea-distance" / "providers" / "ocean-routing"

ROUTES_OF_INTEREST = [
    ("Genoa, IT", "Naples, IT"),
    ("Genoa, IT", "Sarroch, IT"),
    ("Genoa, IT", "Koper, SI"),
    ("Belfast, GB", "Fawley, GB"),
    ("New York, US", "Quebec, CA"),
    ("Klaipeda, LT", "New York, US"),
    ("Amsterdam, NL", "New York, US"),
    ("Rotterdam, NL", "Houston, US"),
    ("Gibraltar, GI", "Lagos, NG"),
    ("Amsterdam, NL", "Thessaloniki, GR"),
    ("Singapore, SG", "Fujairah, AE"),
    ("Fawley, GB", "Hamburg, DE"),
    ("Yanbu, SA", "Singapore, SG"),
]


def haversine_nm(p1, p2):
    R = 3440.065
    phi1, phi2 = math.radians(p1[0]), math.radians(p2[0])
    dphi = math.radians(p2[0] - p1[0])
    dlam = math.radians(p2[1] - p1[1])
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def sorted_key(a, b):
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def total(path):
    if not path or len(path) < 2:
        return 0.0
    return sum(haversine_nm(path[i], path[i + 1]) for i in range(len(path) - 1))


def main():
    new_paths = json.loads((OUTPUT_DIR / "paths.json").read_text())
    new_dist = json.loads((OUTPUT_DIR / "distances.json").read_text())
    old_paths = json.loads((OLD_DIR / "paths.json").read_text()) if (OLD_DIR / "paths.json").exists() else {}
    old_dist = json.loads((OLD_DIR / "distances.json").read_text()) if (OLD_DIR / "distances.json").exists() else {}

    for a, b in ROUTES_OF_INTEREST:
        key = sorted_key(a, b)
        print("=" * 72)
        print(f"{a}  <->  {b}")
        print("=" * 72)

        old = old_paths.get(key)
        new = new_paths.get(key)

        print(f"OLD (composer): {old_dist.get(key, '—')} NM, {len(old) if old else 0} waypoints")
        if old:
            for pt in old:
                print(f"  {pt[0]:>8.3f} {pt[1]:>9.3f}")

        print(f"\nNEW (sphere): {new_dist.get(key, '—')} NM, {len(new) if new else 0} waypoints")
        if new:
            for pt in new:
                print(f"  {pt[0]:>8.3f} {pt[1]:>9.3f}")

        if old and new:
            direct = haversine_nm(new[0], new[-1])
            delta_nm = new_dist.get(key, 0) - old_dist.get(key, 0)
            delta_pct = delta_nm / old_dist.get(key, 1) * 100 if old_dist.get(key) else 0
            print(f"\nDirect GC: {direct:.0f} NM")
            print(f"Delta new-old: {delta_nm:+.0f} NM ({delta_pct:+.1f}%)")
        print()


if __name__ == "__main__":
    main()
