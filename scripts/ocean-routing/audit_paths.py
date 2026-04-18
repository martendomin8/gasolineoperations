"""
Audit every route in paths.json against a battery of geometric sanity
checks. Unlike check_all_paths.py (which only flags land crossings), this
also catches routes that are *sea-safe but wrong* — big detours, zigzags,
and paths that leave the reasonable bearing corridor between the two
ports. These are the "Genoa → Sarroch via Sicily" style bugs that pass
land-crossing checks but look silly on the map.

Runs in ~30s over all ~5500 routes. Outputs a Markdown report grouped by
severity, with the worst offenders on top so the fix-order is obvious.

Usage:
  python audit_paths.py                          # full audit
  python audit_paths.py --min-severity warn      # only WARN + CRITICAL
  python audit_paths.py --port "Genoa, IT"       # filter by port
  python audit_paths.py --top 30                 # limit output per section
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from dataclasses import dataclass, field

OUTPUT_DIR = Path(__file__).parent / "output"
DATA_DIR = Path(__file__).parent / "data"
REPORT_PATH = OUTPUT_DIR / "audit_report.md"


# ── Geometry helpers ──────────────────────────────────────────

def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R_NM = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(a))


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in degrees (0-360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)
    x = math.sin(dlam) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def bearing_diff(a: float, b: float) -> float:
    """Shortest angular distance between two bearings, in degrees (0-180)."""
    d = abs(a - b) % 360
    return min(d, 360 - d)


def cross_track_distance_nm(start, end, point) -> float:
    """
    Signed perpendicular distance in NM from `point` to the great-circle
    arc between `start` and `end`. Positive = right of course, negative
    = left. Magnitude is what matters for "how far off the ideal line".
    Standard spherical formula — works for any latitude pair.
    """
    R = 3440.065
    d13 = haversine_nm(start[0], start[1], point[0], point[1]) / R  # angular dist
    if d13 == 0:
        return 0.0
    b13 = math.radians(initial_bearing(start[0], start[1], point[0], point[1]))
    b12 = math.radians(initial_bearing(start[0], start[1], end[0], end[1]))
    return math.asin(math.sin(d13) * math.sin(b13 - b12)) * R


def gc_interpolate(p1, p2, t):
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    d = 2 * math.asin(math.sqrt(
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
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


# ── Navigable corridors (shared with check_all_paths.py) ──────

NAVIGABLE_CORRIDORS = [
    # Mirror of build_sphere_graph.NAVIGABLE_BOXES so the audit matches
    # what the router treats as water.
    (54.50, 56.20, 11.30, 13.20, "Danish Straits / Oresund"),
    (51.20, 51.60, 3.30, 4.60, "Scheldt / Westerschelde"),
    (51.40, 53.20, 3.00, 5.30, "Dutch coast / Amsterdam-Rotterdam / Texel"),
    (50.70, 51.40, 0.70, 2.00, "Dover Strait"),
    (53.40, 54.80, 8.20, 10.50, "Kiel Canal + Elbe approach"),
    (49.20, 49.80, -0.60, 0.40, "Seine mouth (Le Havre)"),
    (51.10, 52.00, 0.40, 1.90, "Thames estuary"),
    (59.00, 60.30, 22.00, 29.00, "Gulf of Finland"),
    (35.80, 36.20, -5.90, -5.10, "Strait of Gibraltar"),
    (35.50, 40.00, 22.50, 27.00, "Greek archipelago"),
    (37.90, 38.40, 15.50, 15.80, "Strait of Messina"),
    (41.20, 41.45, 9.10, 9.35, "Strait of Bonifacio"),
    (40.00, 41.30, 26.00, 29.50, "Turkish Straits"),
    (42.20, 45.80, 12.80, 17.50, "Adriatic proper"),
    (40.00, 42.20, 17.50, 20.00, "Otranto Strait"),
    (29.80, 31.30, 32.20, 32.80, "Suez Canal"),
    (27.00, 30.00, 33.00, 35.00, "Red Sea N"),
    (22.00, 27.00, 35.00, 38.50, "Red Sea upper-mid"),
    (16.00, 22.00, 37.50, 41.50, "Red Sea lower-mid"),
    (12.50, 16.00, 40.50, 43.50, "Red Sea S"),
    (11.50, 13.20, 43.00, 44.50, "Bab-el-Mandeb"),
    (25.50, 26.70, 55.00, 57.00, "Strait of Hormuz"),
    (26.50, 30.00, 47.80, 52.00, "Persian Gulf N"),
    (24.50, 27.50, 50.50, 55.00, "Persian Gulf mid"),
    (24.00, 26.50, 53.50, 56.00, "Persian Gulf S"),
    (1.00, 6.00, 98.00, 104.00, "Malacca / Singapore"),
    (8.80, 9.40, -80.00, -79.40, "Panama Canal"),
    (36.70, 39.60, -76.80, -75.20, "Chesapeake / Delaware"),
    (40.20, 40.80, -74.40, -73.20, "NY Bight"),
    (28.50, 30.50, -95.50, -94.00, "Galveston / Houston"),
    (27.50, 28.20, -97.60, -96.80, "Corpus Christi"),
    (32.00, 32.30, -81.20, -80.70, "Savannah"),
    (33.80, 34.40, -78.20, -77.80, "Wilmington NC"),
    (45.00, 50.00, -73.80, -58.00, "St. Lawrence / Gulf"),
    (46.50, 48.50, -55.50, -52.50, "Newfoundland bays"),
    (47.00, 49.00, -60.50, -58.80, "Cabot Strait"),
    (49.00, 50.30, -67.00, -60.00, "Jacques Cartier"),
    (55.80, 56.30, -4.00, -2.00, "Firth of Forth"),
]


def in_navigable(lat: float, lon: float) -> bool:
    return any(mla <= lat <= mxa and mlo <= lon <= mxo
               for mla, mxa, mlo, mxo, _ in NAVIGABLE_CORRIDORS)


# ── Land polygon loader ───────────────────────────────────────

def load_land():
    shp_path = DATA_DIR / "ne_land" / "ne_50m_land.shp"
    if not shp_path.exists():
        return None
    import shapefile
    from shapely.geometry import shape
    from shapely.ops import unary_union
    from shapely.prepared import prep
    sf = shapefile.Reader(str(shp_path))
    polygons = [shape(sr.shape.__geo_interface__) for sr in sf.shapeRecords()]
    return prep(unary_union(polygons))


def segment_crosses_land(p1, p2, land_prep, samples=80, buf_nm=15.0):
    from shapely.geometry import Point
    for i in range(samples + 1):
        t = i / samples
        lat, lon = gc_interpolate(p1, p2, t)
        if haversine_nm(lat, lon, p1[0], p1[1]) < buf_nm:
            continue
        if haversine_nm(lat, lon, p2[0], p2[1]) < buf_nm:
            continue
        if in_navigable(lat, lon):
            continue
        if land_prep.contains(Point(lon, lat)):
            return (lat, lon, t)
    return None


# ── Reference distances (PUB 151 / Netpas — ground truth) ─────

REFERENCE_DISTANCES = {
    # (port_a, port_b): distance_nm.  Order-independent — the checker
    # matches both "A|B" and "B|A" against the alphabetically-sorted key.
    ("Amsterdam, NL", "Thessaloniki, GR"): 3170,
    ("Gibraltar, GI", "Lagos, NG"): 3176,
    ("Rotterdam, NL", "Houston, US"): 5022,
    ("Amsterdam, NL", "Augusta, IT"): 2515,
    ("Amsterdam, NL", "Barcelona, ES"): 1966,
    ("Amsterdam, NL", "Algeciras, ES"): 1453,
    ("Rotterdam, NL", "New York, US"): 3456,
    ("Antwerp, BE", "Le Havre, FR"): 220,
    ("Marseille, FR", "Genoa, IT"): 189,
    ("Marseille, FR", "Alexandria, EG"): 1510,
    ("Barcelona, ES", "Naples, IT"): 537,
    ("Las Palmas, ES", "Dakar, SN"): 862,
    ("Singapore, SG", "Fujairah, AE"): 3293,
    ("Rotterdam, NL", "Gothenburg, SE"): 483,
    # Additional Mediterranean / Adriatic reference points
    ("Genoa, IT", "Naples, IT"): 340,
    ("Genoa, IT", "Koper, SI"): 1060,
    ("Genoa, IT", "Sarroch, IT"): 380,
    # UK / Irish Sea reference points
    ("Belfast, GB", "Fawley, GB"): 610,
    ("Belfast, GB", "Amsterdam, NL"): 790,
}


def normalize_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


# ── Audit checks ──────────────────────────────────────────────

@dataclass
class Issue:
    severity: str       # "CRITICAL" | "WARN" | "INFO"
    category: str       # "land" | "detour" | "zigzag" | "bearing" | "reference"
    key: str
    summary: str
    detail: str = ""
    metric: float = 0.0   # for sorting within a category — worst first


@dataclass
class RouteStats:
    key: str
    path_nm: float
    straight_nm: float
    detour_ratio: float
    forward_nm: float         # path length travelled toward dest
    backward_nm: float        # path length travelled away from dest
    backtrack_fraction: float
    max_xtd_nm: float         # max perpendicular deviation from GC arc
    waypoints: int
    has_land_hit: bool
    land_hit_loc: tuple | None = None


def analyze_route(key: str, wps: list, land_prep) -> tuple[RouteStats, list[Issue]]:
    issues: list[Issue] = []
    if len(wps) < 2:
        return RouteStats(key, 0, 0, 1, 0, 1, 0, len(wps), False), issues

    start, end = wps[0], wps[-1]
    straight = haversine_nm(start[0], start[1], end[0], end[1])
    path_len = sum(
        haversine_nm(wps[i][0], wps[i][1], wps[i + 1][0], wps[i + 1][1])
        for i in range(len(wps) - 1)
    )

    # Detour ratio: how much longer is the path vs the straight line?
    detour = path_len / straight if straight > 0 else 1.0

    # Progress metric — for each waypoint, how much closer did we get
    # to the destination? Accumulate distance-decrease per segment.
    # Works correctly on great-circle paths (LA → Singapore across the
    # Pacific) because we measure distance-to-end on the sphere at each
    # step, so a segment tracing the GC always makes positive progress
    # even when its bearing diverges from the straight-line initial bearing.
    forward_nm = 0.0   # sum of segment lengths that DECREASED dist-to-end
    backward_nm = 0.0  # sum of segment lengths that INCREASED dist-to-end
    for i in range(len(wps) - 1):
        seg_len = haversine_nm(wps[i][0], wps[i][1], wps[i + 1][0], wps[i + 1][1])
        if seg_len < 0.01:
            continue
        d_before = haversine_nm(wps[i][0], wps[i][1], end[0], end[1])
        d_after = haversine_nm(wps[i + 1][0], wps[i + 1][1], end[0], end[1])
        if d_after <= d_before:
            forward_nm += seg_len
        else:
            backward_nm += seg_len

    # Backtrack ratio: fraction of path travelled AWAY from destination.
    # A clean great-circle has backward_nm ≈ 0. A zigzag has significant
    # backward portions. We only flag meaningful backtracks.
    backtrack_fraction = backward_nm / path_len if path_len > 0 else 0.0

    # Cross-track deviation: max perpendicular distance from any waypoint
    # to the direct great-circle arc. Catches paths that sweep wide off
    # the ideal corridor even when they don't literally backtrack.
    max_xtd_nm = 0.0
    for pt in wps[1:-1]:  # interior points only
        xtd = cross_track_distance_nm(start, end, pt)
        if abs(xtd) > max_xtd_nm:
            max_xtd_nm = abs(xtd)

    # ── Land crossing check (only if land data available) ─────
    has_land_hit = False
    land_hit_loc = None
    if land_prep is not None:
        for i in range(len(wps) - 1):
            hit = segment_crosses_land(wps[i], wps[i + 1], land_prep)
            if hit:
                has_land_hit = True
                land_hit_loc = (hit[0], hit[1], i)
                issues.append(Issue(
                    "CRITICAL", "land", key,
                    f"Segment {i} crosses land near ({hit[0]:.2f}, {hit[1]:.2f})",
                    f"  seg {i}: ({wps[i][0]:.2f}, {wps[i][1]:.2f}) -> "
                    f"({wps[i + 1][0]:.2f}, {wps[i + 1][1]:.2f})",
                    metric=1000.0 + i,
                ))
                break  # one per route is enough to act on

    # ── Detour ratio check ───────────────────────────────────
    # A straight great-circle ratio > 1.5 suggests a significant detour.
    # But legitimate routes (around continents) can have ratios of 2-3+.
    # Flag only if we can't explain the detour with a big land mass.
    # Heuristic: if straight line would cross land, the detour is expected.
    if detour > 1.5 and land_prep is not None:
        # Is the straight line blocked by land? If yes, big detour is OK.
        # If no, detour is suspicious.
        straight_blocked = segment_crosses_land(start, end, land_prep,
                                                 samples=120, buf_nm=30.0)
        if not straight_blocked:
            sev = "CRITICAL" if detour > 2.0 else "WARN"
            issues.append(Issue(
                sev, "detour", key,
                f"Path is {detour:.2f}× the straight line "
                f"({path_len:.0f} NM vs {straight:.0f} NM direct)",
                f"  straight-line is sea-safe — detour not explained by land",
                metric=detour,
            ))

    # ── Backtracking / zigzag check ──────────────────────────
    # Flag only when a meaningful fraction of the journey is spent
    # moving away from the destination. 5% of a 5000 NM crossing is
    # 250 NM of genuine zigzag — worth investigating.
    if backtrack_fraction > 0.05 and backward_nm > 50:
        sev = "CRITICAL" if backtrack_fraction > 0.15 else "WARN"
        issues.append(Issue(
            sev, "zigzag", key,
            f"{backtrack_fraction * 100:.1f}% of path ({backward_nm:.0f} NM) "
            f"moves away from destination",
            "",
            metric=backtrack_fraction * 100,
        ))

    # ── Cross-track deviation check ──────────────────────────
    # Paths that stray far from the ideal great-circle corridor even
    # without literal backtracking. Only flag when the straight line
    # is sea-safe (otherwise big deviations are structural).
    if max_xtd_nm > 200 and land_prep is not None:
        straight_blocked = segment_crosses_land(start, end, land_prep,
                                                 samples=120, buf_nm=30.0)
        if not straight_blocked and max_xtd_nm > straight * 0.15:
            sev = "WARN" if max_xtd_nm < 500 else "CRITICAL"
            issues.append(Issue(
                sev, "xtd", key,
                f"Path strays {max_xtd_nm:.0f} NM off the direct GC line",
                "",
                metric=max_xtd_nm,
            ))

    # ── Reference distance check ─────────────────────────────
    pair = normalize_pair(key.split("|")[0], key.split("|")[1])
    for ref_pair, ref_nm in REFERENCE_DISTANCES.items():
        if normalize_pair(*ref_pair) == pair:
            err_pct = abs(path_len - ref_nm) / ref_nm * 100
            if err_pct > 12:
                sev = "CRITICAL" if err_pct > 25 else "WARN"
                issues.append(Issue(
                    sev, "reference", key,
                    f"Computed {path_len:.0f} NM vs reference {ref_nm} NM "
                    f"({err_pct:+.1f}% off)",
                    "",
                    metric=err_pct,
                ))
            break

    stats = RouteStats(
        key=key,
        path_nm=path_len,
        straight_nm=straight,
        detour_ratio=detour,
        forward_nm=forward_nm,
        backward_nm=backward_nm,
        backtrack_fraction=backtrack_fraction,
        max_xtd_nm=max_xtd_nm,
        waypoints=len(wps),
        has_land_hit=has_land_hit,
        land_hit_loc=land_hit_loc,
    )
    return stats, issues


# ── Report generation ─────────────────────────────────────────

SEVERITY_ORDER = {"CRITICAL": 0, "WARN": 1, "INFO": 2}


def write_report(all_issues: list[Issue], port_filter: str | None,
                 top: int | None) -> str:
    """Write Markdown report grouped by category, worst first."""
    lines = [f"# Ocean Routing Audit — {time.strftime('%Y-%m-%d %H:%M')}", ""]

    if port_filter:
        lines.append(f"Filtered to routes involving **{port_filter}**.")
        lines.append("")

    # Summary counts
    by_severity = {"CRITICAL": 0, "WARN": 0, "INFO": 0}
    by_category = {}
    for iss in all_issues:
        by_severity[iss.severity] = by_severity.get(iss.severity, 0) + 1
        by_category[iss.category] = by_category.get(iss.category, 0) + 1
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Critical: **{by_severity['CRITICAL']}**")
    lines.append(f"- Warnings: **{by_severity['WARN']}**")
    lines.append(f"- Info: **{by_severity['INFO']}**")
    lines.append("")
    lines.append("By category:")
    for cat in ("land", "detour", "zigzag", "xtd", "reference"):
        lines.append(f"- {cat}: {by_category.get(cat, 0)}")
    lines.append("")

    # Group by category, sort each group by severity then metric (desc)
    for cat, cat_title in [
        ("land", "Land Crossings"),
        ("detour", "Unnecessarily Long Detours"),
        ("zigzag", "Zigzag / Backtracking"),
        ("xtd", "Off-Course Deviation"),
        ("reference", "Reference Distance Mismatches"),
    ]:
        cat_issues = [i for i in all_issues if i.category == cat]
        if not cat_issues:
            continue
        cat_issues.sort(key=lambda i: (SEVERITY_ORDER[i.severity], -i.metric))
        lines.append(f"## {cat_title} ({len(cat_issues)})")
        lines.append("")
        shown = cat_issues[:top] if top else cat_issues
        for iss in shown:
            lines.append(f"- **[{iss.severity}]** `{iss.key}` — {iss.summary}")
            if iss.detail:
                lines.append(f"  {iss.detail}")
        if top and len(cat_issues) > top:
            lines.append(f"\n*...{len(cat_issues) - top} more omitted (use --top to raise limit)*")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-severity", choices=["info", "warn", "critical"],
                        default="info", help="Filter issues below this severity")
    parser.add_argument("--port", help="Only audit routes involving this port")
    parser.add_argument("--top", type=int, default=50,
                        help="Max issues shown per category")
    parser.add_argument("--no-land-check", action="store_true",
                        help="Skip land-crossing check (much faster)")
    args = parser.parse_args()

    paths_path = OUTPUT_DIR / "paths.json"
    if not paths_path.exists():
        print(f"ERROR: {paths_path} not found — run build_composed_paths.py first")
        return

    with open(paths_path) as f:
        paths = json.load(f)

    land_prep = None if args.no_land_check else load_land()
    if land_prep is None and not args.no_land_check:
        print("  (land data unavailable — land-crossing checks disabled)")

    print(f"Auditing {len(paths):,} routes...")
    t0 = time.time()
    all_issues: list[Issue] = []
    min_sev_rank = SEVERITY_ORDER[args.min_severity.upper()]

    for i, (key, wps) in enumerate(paths.items()):
        if args.port and args.port not in key:
            continue
        _, issues = analyze_route(key, wps, land_prep)
        for iss in issues:
            if SEVERITY_ORDER[iss.severity] <= min_sev_rank:
                all_issues.append(iss)
        if (i + 1) % 500 == 0:
            elapsed = time.time() - t0
            print(f"  {i + 1:,}/{len(paths):,} audited "
                  f"({elapsed:.0f}s, {len(all_issues)} issues)")

    elapsed = time.time() - t0
    print(f"\nAudited {len(paths):,} routes in {elapsed:.0f}s")
    print(f"Found {len(all_issues)} issues")
    for sev in ("CRITICAL", "WARN", "INFO"):
        n = sum(1 for i in all_issues if i.severity == sev)
        if n:
            print(f"  {sev}: {n}")

    report = write_report(all_issues, args.port, args.top)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"\nReport written to: {REPORT_PATH}")
    print(f"\nTop 15 issues:")
    all_issues.sort(key=lambda i: (SEVERITY_ORDER[i.severity], -i.metric))
    for iss in all_issues[:15]:
        print(f"  [{iss.severity}] [{iss.category}] {iss.key} — {iss.summary}")


if __name__ == "__main__":
    main()
