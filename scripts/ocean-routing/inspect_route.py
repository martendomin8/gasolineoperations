"""
Print a single route's waypoint chain and per-hop distance.

Usage:
    python inspect_route.py "Genoa, IT" "Koper, SI"
    python inspect_route.py Quebec "New York"         # partial match
"""

import json
import math
import sys
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"


def haversine_nm(p1, p2):
    R = 3440.065
    phi1, phi2 = math.radians(p1[0]), math.radians(p2[0])
    dphi = math.radians(p2[0] - p1[0])
    dlam = math.radians(p2[1] - p1[1])
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def find_port(query: str, all_ports: list[str]) -> str | None:
    q = query.lower()
    # exact or case-insensitive exact
    for p in all_ports:
        if p.lower() == q:
            return p
    # prefix
    hits = [p for p in all_ports if p.lower().startswith(q)]
    if len(hits) == 1:
        return hits[0]
    # substring
    hits = [p for p in all_ports if q in p.lower()]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        print(f"Ambiguous '{query}': {hits}", file=sys.stderr)
    return None


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    with open(OUTPUT_DIR / "paths.json") as f:
        paths = json.load(f)
    with open(OUTPUT_DIR / "distances.json") as f:
        distances = json.load(f)

    all_ports = set()
    for k in paths:
        a, b = k.split("|")
        all_ports.add(a); all_ports.add(b)
    all_ports = sorted(all_ports)

    a = find_port(sys.argv[1], all_ports)
    b = find_port(sys.argv[2], all_ports)
    if not a or not b:
        print(f"Could not resolve: {sys.argv[1]} / {sys.argv[2]}")
        sys.exit(1)

    key = f"{a}|{b}" if a < b else f"{b}|{a}"
    reverse = not (a < b)
    path = paths.get(key)
    if path is None:
        print(f"No route stored for {a} <-> {b}")
        sys.exit(1)
    if reverse:
        path = list(reversed(path))

    dist = distances.get(key, 0)
    direct = haversine_nm(path[0], path[-1])

    print(f"Route: {a} -> {b}")
    print(f"Stored distance: {dist} NM")
    print(f"Direct great-circle: {direct:.1f} NM")
    print(f"Detour ratio: {dist / direct:.3f}" if direct > 0 else "")
    print(f"Waypoints: {len(path)}\n")
    print(f"  {'#':>3}  {'lat':>8}  {'lon':>8}  {'hop NM':>8}")
    print("  " + "-" * 37)
    cum = 0.0
    for i, pt in enumerate(path):
        hop = haversine_nm(path[i - 1], pt) if i > 0 else 0.0
        cum += hop
        print(f"  {i:>3}  {pt[0]:>8.3f}  {pt[1]:>8.3f}  {hop:>8.1f}")
    print(f"\n  Total (from hops): {cum:.1f} NM")


if __name__ == "__main__":
    main()
