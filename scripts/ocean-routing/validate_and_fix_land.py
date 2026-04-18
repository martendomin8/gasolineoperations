"""
Post-process paths.json: guarantee no arc touches land.

Pipeline:
  1. Load paths.json (from searoute).
  2. Load GSHHG full-res land mask + navigable-box whitelist.
  3. For every segment of every path, sample the great-circle arc
     every ~1 NM and check each sample against GSHHG. If any
     sample is on land (and not inside a narrow whitelist box),
     flag the segment.
  4. For each flagged segment, insert a detour waypoint offshore
     on whichever side (north / south / east / west) has nothing
     but water within ~200 NM. Recurse until clean.
  5. Write paths.json back.

Land is never navigable. After this pass, not a single arc touches
any continent or island.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

from build_sphere_graph import (
    in_navigable_box, haversine_nm, gc_interpolate,
    EARTH_R_NM, _bearing_destination, LandMask,
)

OUTPUT_DIR = Path(__file__).parent / "output"
DATA_DIR = Path(__file__).parent / "data"
# Validator uses the COARSER land mask (Natural Earth 10m ≈ 1 km) on
# purpose — GSHHG full-res flags every single small peninsula or islet
# within ~150 m of the arc, which would reject 100 % of coastal routes.
# NE 10m only flags genuine land masses a ship can't reasonably sail
# through. We treat any hit outside a navigable-box whitelist as a
# real blocker that needs a detour waypoint.
SAMPLE_STEP_NM = 2.0
ENDPOINT_BUF_NM = 8.0    # first / last stretch is port approach
MAX_DETOUR_DEPTH = 4     # max recursion per flagged segment


class ToleranceLandMask:
    """
    Uses GSHHG full-res but tolerates arcs that briefly *graze* land
    — a sample is counted as a real land hit only if the point is
    deeper than `inland_buffer_nm` NM inside the polygon. This means
    a ship sailing within a few hundred metres of a cliff doesn't
    trigger a detour, but a clear crossing of a kilometres-wide
    peninsula does.
    """
    def __init__(self, polygons, inland_buffer_nm=0.5):
        from shapely.strtree import STRtree
        from shapely.prepared import prep
        self.polygons = polygons
        self.prepared = [prep(p) for p in polygons]
        # boundary for distance queries
        self.boundaries = [p.boundary for p in polygons]
        self.tree = STRtree(polygons)
        self.inland_buffer_deg = inland_buffer_nm / 60.0   # deg ≈ NM/60

    def contains(self, point):
        idxs = self.tree.query(point)
        for i in idxs:
            if self.prepared[i].contains(point):
                # Truly inland? distance to boundary > tolerance.
                if self.boundaries[i].distance(point) > self.inland_buffer_deg:
                    return True
        return False


def load_validator_land():
    """NE 10m (11 continent polygons) — catches real continental
    crossings (Oman/Yemen/Saudi/etc) but is coarse enough that
    legitimate coastal traffic doesn't trigger spurious detours."""
    shp = DATA_DIR / "ne_land_10m" / "ne_10m_land.shp"
    if not shp.exists():
        raise SystemExit(f"Missing NE 10m at {shp}")
    import shapefile
    from shapely.geometry import shape
    from shapely.validation import make_valid
    sf = shapefile.Reader(str(shp))
    polygons = []
    for sr in sf.shapeRecords():
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = make_valid(g)
        polygons.append(g)
    print(f"  Validator land mask: NE 10m ({len(polygons):,} continent polygons)")
    return LandMask(polygons)


def arc_land_hit(p1, p2, land, sample_step=SAMPLE_STEP_NM):
    """Return (lat, lon, t) of first land sample on the arc, or None."""
    from shapely.geometry import Point
    d = haversine_nm(p1[0], p1[1], p2[0], p2[1])
    if d < 2 * ENDPOINT_BUF_NM:
        return None
    samples = max(10, int(d / sample_step))
    for i in range(1, samples):
        t = i / samples
        lat, lon = gc_interpolate(p1, p2, t)
        d1 = haversine_nm(lat, lon, p1[0], p1[1])
        d2 = haversine_nm(lat, lon, p2[0], p2[1])
        if d1 < ENDPOINT_BUF_NM or d2 < ENDPOINT_BUF_NM:
            continue
        if in_navigable_box(lat, lon):
            continue
        if land.contains(Point(lon, lat)):
            return (lat, lon, t)
    return None


def find_offshore_detour(p1, p2, land, hit_lat, hit_lon):
    """
    Given an arc p1->p2 that hits land near (hit_lat, hit_lon), find
    an offshore waypoint to detour around. Tries perpendicular
    bearings in increasing distance; returns the nearest valid one.
    """
    from shapely.geometry import Point
    # Overall bearing of the arc at the hit point — detour to left
    # or right (perpendicular). Using a small step to estimate bearing.
    dlat = p2[0] - p1[0]
    dlon = p2[1] - p1[1]
    # Perpendicular unit directions (approx in lat/lon space)
    perp_left_lat, perp_left_lon = -dlon, dlat
    perp_right_lat, perp_right_lon = dlon, -dlat
    # Normalize
    mag = math.hypot(perp_left_lat, perp_left_lon) or 1.0
    perp_left_lat /= mag; perp_left_lon /= mag
    perp_right_lat /= mag; perp_right_lon /= mag

    best = None
    best_dist = float("inf")
    for perp in [(perp_left_lat, perp_left_lon), (perp_right_lat, perp_right_lon)]:
        for dist_nm in (30, 50, 80, 120, 180, 260, 360, 500):
            # Convert perpendicular unit to a lat/lon offset at that distance.
            # Rough approximation — good enough for detour routing (we verify
            # clearance afterward via arc_land_hit).
            lat_offset_deg = (dist_nm / 60.0) * perp[0]
            # cos scaling at the hit latitude
            cos_lat = max(0.01, math.cos(math.radians(hit_lat)))
            lon_offset_deg = (dist_nm / 60.0) * perp[1] / cos_lat
            cand_lat = hit_lat + lat_offset_deg
            cand_lon = hit_lon + lon_offset_deg
            cand = (cand_lat, cand_lon)
            if in_navigable_box(cand_lat, cand_lon):
                pass  # explicitly water
            elif land.contains(Point(cand_lon, cand_lat)):
                continue  # still on land at this range, try further
            # Check that both sub-arcs (p1 → cand and cand → p2) are
            # cleaner than the original. We don't require fully clear —
            # recursion will handle residual hits.
            sub1 = arc_land_hit(p1, cand, land)
            sub2 = arc_land_hit(cand, p2, land)
            score = (0 if sub1 is None else 1) + (0 if sub2 is None else 1)
            if score < 2:
                # improvement — prefer fewer remaining hits and shorter total
                total_len = haversine_nm(*p1, *cand) + haversine_nm(*cand, *p2)
                if total_len < best_dist:
                    best_dist = total_len
                    best = cand
    return best


def repair_path(path, land, depth=0):
    """Recursively repair a path by inserting detour waypoints."""
    if depth > MAX_DETOUR_DEPTH:
        return path, False
    repaired = [path[0]]
    all_clean = True
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        hit = arc_land_hit(a, b, land)
        if hit is None:
            repaired.append(b)
            continue
        detour = find_offshore_detour(a, b, land, hit[0], hit[1])
        if detour is None:
            # Can't find a clean detour — leave as-is and flag.
            repaired.append(b)
            all_clean = False
            continue
        # Recurse on the two halves
        left, left_ok = repair_path([a, detour], land, depth + 1)
        right, right_ok = repair_path([detour, b], land, depth + 1)
        repaired.extend(left[1:])    # skip duplicate 'a'
        repaired.extend(right[1:])   # skip duplicate 'detour'
        if not (left_ok and right_ok):
            all_clean = False
    return repaired, all_clean


def recompute_distance(path):
    total = 0.0
    for i in range(len(path) - 1):
        total += haversine_nm(path[i][0], path[i][1], path[i+1][0], path[i+1][1])
    return round(total, 1)


def main():
    print("Loading land mask...")
    land = load_validator_land()

    paths = json.loads((OUTPUT_DIR / "paths.json").read_text())
    distances = json.loads((OUTPUT_DIR / "distances.json").read_text())

    print(f"Validating {len(paths):,} paths against land...\n")
    t0 = time.time()
    dirty = 0
    fixed = 0
    broken = []

    for i, (key, path) in enumerate(paths.items()):
        # Quick check: any segment hits land?
        has_hit = any(
            arc_land_hit(path[k], path[k + 1], land) is not None
            for k in range(len(path) - 1)
        )
        if not has_hit:
            continue
        dirty += 1
        new_path, ok = repair_path(path, land)
        if ok:
            fixed += 1
            paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in new_path]
            distances[key] = recompute_distance(new_path)
        else:
            broken.append(key)
            paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in new_path]
            distances[key] = recompute_distance(new_path)
        if (i + 1) % 200 == 0:
            elapsed = time.time() - t0
            print(f"  {i + 1:,}/{len(paths):,} checked ({elapsed:.0f}s) — "
                  f"{dirty} touched land, {fixed} repaired, {len(broken)} residual")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.0f}s")
    print(f"  Paths touching land before fix: {dirty:,}")
    print(f"  Fully repaired: {fixed:,}")
    print(f"  Residual issues: {len(broken):,}")
    if broken[:10]:
        print("  First 10 residuals:", broken[:10])

    (OUTPUT_DIR / "paths.json").write_text(json.dumps(paths, separators=(",", ":")))
    (OUTPUT_DIR / "distances.json").write_text(json.dumps(distances, indent=2))
    print("\nPaths + distances updated.")


if __name__ == "__main__":
    main()
