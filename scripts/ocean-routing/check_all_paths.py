"""
One-shot checker: runs the same great-circle land-crossing detector
against EVERY route in paths.json (not just the hand-drawn ones),
so we know the full table is sea-safe.

Mirrors apply_hand_drawn.py's segment_crosses_land logic.
"""

import json
import math
import time
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
DATA_DIR = Path(__file__).parent / "data"


def haversine_nm(lat1, lon1, lat2, lon2):
    R_NM = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(a))


def gc_interpolate(p1, p2, t):
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    d = 2 * math.asin(math.sqrt(
        math.sin((lat2 - lat1) / 2) ** 2 +
        math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    ))
    if d == 0:
        return [p1[0], p1[1]]
    A = math.sin((1 - t) * d) / math.sin(d)
    B = math.sin(t * d) / math.sin(d)
    x = A * math.cos(lat1) * math.cos(lon1) + B * math.cos(lat2) * math.cos(lon2)
    y = A * math.cos(lat1) * math.sin(lon1) + B * math.cos(lat2) * math.sin(lon2)
    z = A * math.sin(lat1) + B * math.sin(lat2)
    lat = math.atan2(z, math.sqrt(x * x + y * y))
    lon = math.atan2(y, x)
    return [math.degrees(lat), math.degrees(lon)]


NAVIGABLE_CORRIDORS = [
    (54.50, 56.20, 11.30, 13.20, "Danish Straits"),
    (51.20, 51.60, 3.30, 4.60, "Scheldt"),
    (51.40, 52.60, 3.00, 5.30, "Dutch coast"),
    (50.70, 51.30, 0.90, 2.00, "Dover Strait"),
    (53.80, 54.50, 9.00, 10.30, "Kiel Canal"),
    (36.70, 39.60, -76.80, -75.20, "Chesapeake / Delaware"),
    (40.20, 40.80, -74.40, -73.20, "NY Bight"),
    (59.00, 60.30, 22.00, 29.00, "Gulf of Finland"),
    (35.50, 40.00, 22.50, 27.00, "Greek archipelago"),
    (35.80, 36.20, -5.90, -5.10, "Gibraltar"),
    (37.90, 38.40, 15.50, 15.80, "Messina"),
    (40.00, 41.30, 26.00, 29.50, "Turkish Straits"),
    (29.80, 31.30, 32.20, 32.70, "Suez"),
    (8.80, 9.40, -80.00, -79.40, "Panama"),
]


def in_navigable_corridor(lat, lon):
    for min_lat, max_lat, min_lon, max_lon, label in NAVIGABLE_CORRIDORS:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return label
    return None


def segment_crosses_land(p1, p2, land_prep, samples=80, endpoint_buffer_nm=15.0):
    from shapely.geometry import Point
    for i in range(samples + 1):
        t = i / samples
        lat, lon = gc_interpolate(p1, p2, t)
        d1 = haversine_nm(lat, lon, p1[0], p1[1])
        d2 = haversine_nm(lat, lon, p2[0], p2[1])
        if d1 < endpoint_buffer_nm or d2 < endpoint_buffer_nm:
            continue
        if in_navigable_corridor(lat, lon):
            continue
        if land_prep.contains(Point(lon, lat)):
            return (lat, lon, t)
    return None


def main():
    paths_path = OUTPUT_DIR / "paths.json"
    if not paths_path.exists():
        print(f"ERROR: {paths_path} not found")
        return

    shp_path = DATA_DIR / "ne_land" / "ne_50m_land.shp"
    if not shp_path.exists():
        print(f"ERROR: {shp_path} not found — can't check")
        return

    print("Loading paths.json...")
    with open(paths_path) as f:
        paths = json.load(f)

    print("Loading Natural Earth land polygons...")
    import shapefile
    from shapely.geometry import shape
    from shapely.ops import unary_union
    from shapely.prepared import prep

    sf = shapefile.Reader(str(shp_path))
    polygons = [shape(sr.shape.__geo_interface__) for sr in sf.shapeRecords()]
    land_prep = prep(unary_union(polygons))
    print(f"  Loaded {len(polygons)} polygons")

    print(f"\nChecking {len(paths):,} routes...")
    t0 = time.time()
    bad_routes = []
    for i, (key, wps) in enumerate(paths.items()):
        if len(wps) < 2:
            continue
        for seg_i in range(len(wps) - 1):
            hit = segment_crosses_land(wps[seg_i], wps[seg_i + 1], land_prep)
            if hit:
                bad_routes.append((key, seg_i, wps[seg_i], wps[seg_i + 1], hit))
                break  # one warning per route is enough

        if (i + 1) % 500 == 0:
            elapsed = time.time() - t0
            print(f"  {i+1:,}/{len(paths):,} checked, {len(bad_routes)} crossings, {elapsed:.0f}s")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.0f}s")
    print(f"Routes with land crossings: {len(bad_routes):,} / {len(paths):,}")

    if bad_routes:
        print("\nFirst 20 crossings:")
        for key, seg_i, a, b, (hlat, hlon, t) in bad_routes[:20]:
            print(f"  {key}")
            print(f"    seg {seg_i}: ({a[0]:.2f}, {a[1]:.2f}) -> ({b[0]:.2f}, {b[1]:.2f})")
            print(f"    hit near ({hlat:.2f}, {hlon:.2f}) at t={t:.2f}")
    else:
        print("\nAll routes sea-safe.")


if __name__ == "__main__":
    main()
