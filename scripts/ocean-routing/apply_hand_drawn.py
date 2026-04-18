"""
Fast iteration helper: apply hand_drawn_routes.json to the existing
output/distances.json + output/paths.json without re-running the
full 10-minute Dijkstra build.

Also warns about any route whose great-circle segments cross land
(using Natural Earth 50m polygons — same data the main build uses).
This catches waypoints that accidentally land on a peninsula or
mainland before the operator spots it on the map.

Use this to iterate on hand-drawn waypoints. When you're happy,
run build_distances.py for a clean rebuild.
"""

import json
import math
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
HAND_DRAWN_PATH = Path(__file__).parent / "hand_drawn_routes.json"
DATA_DIR = Path(__file__).parent / "data"


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in nautical miles."""
    R_NM = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(a))


def gc_interpolate(p1, p2, t: float):
    """
    Great-circle interpolation between two [lat, lon] points.
    t=0 → p1, t=1 → p2. Uses the slerp formula on the unit sphere so
    it matches what turf.greatCircle renders on the client.
    """
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


def load_land_geometry():
    """
    Load Natural Earth 50m land polygons as a single prepared geometry.
    Returns None if the shapefile isn't available (data dir is gitignored,
    so this will skip the check on fresh checkouts).
    """
    shp_path = DATA_DIR / "ne_land" / "ne_50m_land.shp"
    if not shp_path.exists():
        return None

    try:
        import shapefile  # pyshp
        from shapely.geometry import shape
        from shapely.ops import unary_union
        from shapely.prepared import prep
    except ImportError as e:
        print(f"  (land check skipped — missing dependency: {e})")
        return None

    sf = shapefile.Reader(str(shp_path))
    polygons = [shape(sr.shape.__geo_interface__) for sr in sf.shapeRecords()]
    merged = unary_union(polygons)
    return prep(merged)


# Navigable corridors where Natural Earth 50m's simplified coastline
# incorrectly reports land-crossings. These are narrow straits, tidal
# rivers, and dense archipelagos where real ships DO pass through but
# the 50m polygon merges adjacent islands/peninsulas into "mainland".
# Hits inside any of these boxes are treated as water.
#
# Format: (min_lat, max_lat, min_lon, max_lon, label)
NAVIGABLE_CORRIDORS = [
    # Danish straits — Øresund + Great Belt + Little Belt + Kattegat approach
    (54.50, 56.20, 11.30, 13.20, "Danish Straits / Øresund"),
    # Scheldt estuary (Antwerp approach via Westerschelde)
    (51.20, 51.60, 3.30, 4.60, "Scheldt / Westerschelde"),
    # Dutch North Sea approaches (Maas/Waal/IJ — Amsterdam + Rotterdam)
    # Lower bound extended to 51.40 to include Zeeland/Walcheren islands.
    (51.40, 52.60, 3.00, 5.30, "Dutch coast / Amsterdam-Rotterdam"),
    # English Channel / Dover narrows
    (50.70, 51.30, 0.90, 2.00, "Dover Strait"),
    # Kiel Canal (Germany, cuts through Schleswig-Holstein)
    (53.80, 54.50, 9.00, 10.30, "Kiel Canal"),
    # Chesapeake Bay entrance + Delmarva shore (Baltimore/Norfolk approach)
    (36.70, 39.60, -76.80, -75.20, "Chesapeake Bay / Delaware Bay"),
    # New York Bight / Long Island Sound approaches
    (40.20, 40.80, -74.40, -73.20, "New York Bight"),
    # Gulf of Finland mouth (Tallinn / Helsinki / Ust-Luga approach)
    (59.00, 60.30, 22.00, 29.00, "Gulf of Finland"),
    # Greek archipelago — Cyclades + Ionian + Aegean islands
    (35.50, 40.00, 22.50, 27.00, "Greek archipelago"),
    # Strait of Gibraltar
    (35.80, 36.20, -5.90, -5.10, "Strait of Gibraltar"),
    # Strait of Messina (Sicily)
    (37.90, 38.40, 15.50, 15.80, "Strait of Messina"),
    # Bosphorus + Dardanelles + Sea of Marmara
    (40.00, 41.30, 26.00, 29.50, "Turkish Straits"),
    # Suez Canal (Port Said to Suez)
    (29.80, 31.30, 32.20, 32.70, "Suez Canal"),
    # Panama Canal
    (8.80, 9.40, -80.00, -79.40, "Panama Canal"),
]


def in_navigable_corridor(lat: float, lon: float) -> str | None:
    """Return the label of the corridor containing this point, or None."""
    for min_lat, max_lat, min_lon, max_lon, label in NAVIGABLE_CORRIDORS:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return label
    return None


def segment_crosses_land(p1, p2, land_prep, samples: int = 80,
                         endpoint_buffer_nm: float = 15.0):
    """
    Sample the great-circle arc between two [lat, lon] points and
    return the first sampled point that lies on land, or None if the
    arc is clear.

    Hits within `endpoint_buffer_nm` of either waypoint are ignored:
    Natural Earth 50m is a simplified coastline at ~1 km accuracy, so
    port-approach segments often "touch land" near the port without
    any real crossing. The buffer filters those false positives while
    still catching mid-segment crossings (Nova Scotia, Newfoundland,
    Long Island, Jutland etc.).
    """
    from shapely.geometry import Point
    for i in range(samples + 1):
        t = i / samples
        lat, lon = gc_interpolate(p1, p2, t)

        # Skip if the sample is within the endpoint buffer of either waypoint
        d1 = haversine_nm(lat, lon, p1[0], p1[1])
        d2 = haversine_nm(lat, lon, p2[0], p2[1])
        if d1 < endpoint_buffer_nm or d2 < endpoint_buffer_nm:
            continue

        # Skip if inside a known-navigable corridor (Natural Earth 50m
        # false-positive zone — narrow straits, tidal rivers, archipelagos).
        if in_navigable_corridor(lat, lon):
            continue

        if land_prep.contains(Point(lon, lat)):
            return (lat, lon, t)
    return None


def check_route_land_crossings(key: str, waypoints, land_prep) -> list:
    """Return a list of (segment_index, hit_lat, hit_lon, t) for any
    segment whose great-circle arc crosses land."""
    hits = []
    for i in range(len(waypoints) - 1):
        p1, p2 = waypoints[i], waypoints[i + 1]
        result = segment_crosses_land(p1, p2, land_prep)
        if result:
            hits.append((i, *result))
    return hits


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

    print("Loading land polygons for land-crossing check...")
    land_prep = load_land_geometry()
    if land_prep is None:
        print("  (land data not found — skipping check)")

    print("\nApplying hand-drawn route overrides:\n")
    applied = 0
    total_warnings = 0
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
                                      wps[k + 1][0], wps[k + 1][1])

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

        if land_prep is not None:
            hits = check_route_land_crossings(key, wps, land_prep)
            if hits:
                total_warnings += len(hits)
                for seg_i, hlat, hlon, t in hits:
                    a, b = wps[seg_i], wps[seg_i + 1]
                    print(f"    LAND CROSSING segment {seg_i}: "
                          f"({a[0]:.2f}, {a[1]:.2f}) -> ({b[0]:.2f}, {b[1]:.2f})")
                    print(f"        hit at t={t:.2f} near ({hlat:.2f}, {hlon:.2f}) "
                          f"-- move a waypoint offshore")

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

    if land_prep is not None:
        if total_warnings:
            print(f"\n{total_warnings} LAND-CROSSING WARNING(S) — fix the "
                  f"waypoints above before testing in the app.")
        else:
            print("\nNo land crossings detected — all routes are sea-safe.")

    print(
        "\nRemember to copy to src/lib/sea-distance/providers/ocean-routing/ "
        "before testing."
    )


if __name__ == "__main__":
    main()
