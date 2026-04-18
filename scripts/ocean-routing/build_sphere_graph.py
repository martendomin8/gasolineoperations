"""
Sphere-native visibility graph + Dijkstra for ocean routing.

Unlike the lat/lon grid (build_distances.py) or hand-composed corridors
(build_composed_paths.py), this computes *true* great-circle shortest
paths on a unit sphere. No grid discretization error, no lat/lon
projection artefacts at high latitudes.

Algorithm:
  1. Nodes = curated ports + ~100 geographic anchors (capes, strait entries).
  2. Edge exists between two nodes iff the great-circle arc connecting
     them stays in open water (sampled every ~1 NM and checked against
     Natural Earth 10m land polygons + a small whitelist of narrow
     navigable straits the 10m data over-simplifies).
  3. Dijkstra over this graph, weights = haversine distances.
  4. Light Douglas-Peucker simplification (keeps nodes where the route
     genuinely bends around land; drops mid-ocean filler points).

Outputs the same paths.json + distances.json shape as the composer so
the client can swap providers without changing any frontend code.

Data sources (all public-domain or permissive, commercial-safe):
  - Natural Earth 10m Physical > Land (public domain, no attribution
    required). https://www.naturalearthdata.com/
"""

from __future__ import annotations

import heapq
import json
import math
import time
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
DATA_DIR = Path(__file__).parent / "data"

NM_PER_DEG = 60.0
EARTH_R_NM = 3440.065


# ─────────────────────────────────────────────────────────────
# Spherical geometry primitives — everything works on the unit
# sphere, no flat-map assumptions. Lat/lon is just a storage
# format; all distance and direction work happens in 3D.
# ─────────────────────────────────────────────────────────────

def latlon_to_vec(lat: float, lon: float) -> tuple[float, float, float]:
    """Unit 3D vector from latitude/longitude in degrees."""
    phi = math.radians(lat)
    lam = math.radians(lon)
    cphi = math.cos(phi)
    return (cphi * math.cos(lam), cphi * math.sin(lam), math.sin(phi))


def vec_to_latlon(v: tuple[float, float, float]) -> tuple[float, float]:
    """Inverse: unit vector → (lat, lon) in degrees."""
    x, y, z = v
    lat = math.degrees(math.asin(max(-1.0, min(1.0, z))))
    lon = math.degrees(math.atan2(y, x))
    return lat, lon


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_R_NM * math.asin(math.sqrt(a))


def gc_interpolate(p1: tuple[float, float], p2: tuple[float, float], t: float) -> tuple[float, float]:
    """
    Point at fractional position `t` ∈ [0, 1] along the great-circle
    arc from p1 to p2 on the unit sphere. Uses spherical linear
    interpolation (slerp) on the 3D unit vectors — same math turf.js
    uses on the client, so sampled and rendered arcs are identical.
    """
    v1 = latlon_to_vec(*p1)
    v2 = latlon_to_vec(*p2)
    dot = max(-1.0, min(1.0, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]))
    omega = math.acos(dot)
    if omega < 1e-9:
        return p1
    s1 = math.sin((1 - t) * omega) / math.sin(omega)
    s2 = math.sin(t * omega) / math.sin(omega)
    v = (v1[0] * s1 + v2[0] * s2, v1[1] * s1 + v2[1] * s2, v1[2] * s1 + v2[2] * s2)
    return vec_to_latlon(v)


# ─────────────────────────────────────────────────────────────
# NAVIGABLE STRAITS — narrow waterways that Natural Earth 10m
# over-simplifies to solid land. Any GC arc sample falling inside
# one of these boxes is treated as water. Keep boxes tight.
# ─────────────────────────────────────────────────────────────

# With GSHHG full-res almost every real strait (Messina 3 km,
# Bonifacio 11 km, Hormuz 20 km, Bab-el-Mandeb 30 km, Dardanelles,
# Bosphorus) already shows up as water — no whitelist needed.
# Keep only:
#   * Man-made canals too narrow for GSHHG (Suez, Kiel, Panama)
#   * A few tight river / estuary approaches where the polygon edge
#     sits a few hundred metres inland of the actual navigable fairway
NAVIGABLE_BOXES = [
    # (min_lat, max_lat, min_lon, max_lon, label)
    # ── Canals (too narrow for GSHHG even at full-res) ────────
    (29.80, 31.30, 32.20, 32.80, "Suez Canal"),
    (53.80, 54.50, 9.00, 10.30, "Kiel Canal"),
    (8.80, 9.40, -80.00, -79.40, "Panama Canal"),
    # ── River / estuary approaches where the fairway is inside
    #    GSHHG's coastline polygon fragment. Kept tight — each box
    #    hugs a known navigable channel only.
    (53.40, 54.00, 8.20, 10.20, "Elbe (Hamburg approach)"),
    (51.10, 51.60, 0.40, 1.90, "Thames estuary"),
    (51.20, 51.60, 3.30, 4.60, "Scheldt / Westerschelde"),
    (49.20, 49.70, -0.20, 0.30, "Seine mouth (Le Havre)"),
    # ── St. Lawrence estuary + Gulf — broad sea area, but the
    #    GSHHG coastline has many fragmenting islands.
    (45.00, 50.00, -73.80, -58.00, "St. Lawrence / Gulf"),
    # ── Gulf of Finland — Russian / Estonian / Finnish coasts
    #    have thousands of tiny islands that GSHHG resolves
    #    down to individual polygons.
    (59.00, 60.30, 22.00, 29.00, "Gulf of Finland"),
]


def in_navigable_box(lat: float, lon: float) -> bool:
    for mla, mxa, mlo, mxo, _ in NAVIGABLE_BOXES:
        if mla <= lat <= mxa and mlo <= lon <= mxo:
            return True
    return False


# ─────────────────────────────────────────────────────────────
# Land mask — GSHHG full-resolution L1 shoreline (~150 m accuracy,
# the maritime-grade standard). Fall back to Natural Earth 10m if
# GSHHG data isn't present locally. GSHHG L1 is the land polygon
# everything-else-is-water; we don't need L2 (lakes) for open-ocean
# routing, so any point inside L1 → blocked.
# ─────────────────────────────────────────────────────────────

class LandMask:
    """
    Fast land query over a collection of polygons using an STRtree
    spatial index. Supports an optional coastal tolerance: a point
    inside a polygon is reported as land only if it lies deeper than
    `inland_buffer_nm` NM from the polygon boundary. This is essential
    with GSHHG full-res, where a ship sailing within ~200 m of a cliff
    would otherwise be flagged as "on land"; real navigation passes
    that close routinely. A 500 m buffer is enough to distinguish a
    normal coast-hugging passage from a genuine peninsula crossing.
    """
    def __init__(self, polygons, inland_buffer_nm: float = 0.0):
        from shapely.strtree import STRtree
        from shapely.prepared import prep
        self.polygons = polygons
        self.prepared = [prep(p) for p in polygons]
        self.boundaries = [p.boundary for p in polygons] if inland_buffer_nm > 0 else None
        self.tree = STRtree(polygons)
        # 1 degree ≈ 60 NM, so buffer_deg = NM / 60.
        self.inland_buffer_deg = inland_buffer_nm / 60.0

    def contains(self, point):
        idxs = self.tree.query(point)
        for i in idxs:
            if self.prepared[i].contains(point):
                if self.boundaries is None:
                    return True
                # Tolerance mode: only report land if we're deeper
                # than the buffer from the nearest shore edge.
                if self.boundaries[i].distance(point) > self.inland_buffer_deg:
                    return True
        return False


def load_land():
    gshhg = DATA_DIR / "GSHHS_shp" / "f" / "GSHHS_f_L1.shp"
    ne10m = DATA_DIR / "ne_land_10m" / "ne_10m_land.shp"
    if gshhg.exists():
        shp_path = gshhg
        source = "GSHHG full-res (150 m accuracy)"
    elif ne10m.exists():
        shp_path = ne10m
        source = "Natural Earth 10m (~1 km)"
    else:
        raise SystemExit(f"No land data found at {gshhg} or {ne10m}")
    print(f"  Loading land mask: {source}")
    import shapefile
    from shapely.geometry import shape
    from shapely.validation import make_valid
    sf = shapefile.Reader(str(shp_path))
    polygons = []
    for sr in sf.shapeRecords():
        geom = shape(sr.shape.__geo_interface__)
        if not geom.is_valid:
            geom = make_valid(geom)
        polygons.append(geom)
    print(f"  Loaded {len(polygons):,} land polygons, building STRtree index...")
    return LandMask(polygons)


# ─────────────────────────────────────────────────────────────
# Visibility test — two nodes are graph-connected iff the GC arc
# between them stays in water end-to-end.
# ─────────────────────────────────────────────────────────────

def find_offshore(port: tuple[float, float], land_prep, max_search_nm: float = 80.0,
                  step_nm: float = 3.0) -> tuple[float, float] | None:
    """
    If the port falls on land (per the simplified coastline), walk outward
    in 16 compass directions up to `max_search_nm` NM until we find a
    water point. Returns the nearest water waypoint, or None if none
    found inside the search radius.
    """
    from shapely.geometry import Point
    if not land_prep.contains(Point(port[1], port[0])):
        return port
    best = None
    best_d = float("inf")
    for bearing_deg in range(0, 360, 22):       # 16 directions, 22.5° apart
        br = math.radians(bearing_deg)
        for d_nm in range(int(step_nm), int(max_search_nm) + 1, int(step_nm)):
            # Spherical "destination from bearing + distance" formula
            d_rad = d_nm / EARTH_R_NM
            phi1 = math.radians(port[0])
            lam1 = math.radians(port[1])
            phi2 = math.asin(math.sin(phi1) * math.cos(d_rad)
                             + math.cos(phi1) * math.sin(d_rad) * math.cos(br))
            lam2 = lam1 + math.atan2(math.sin(br) * math.sin(d_rad) * math.cos(phi1),
                                     math.cos(d_rad) - math.sin(phi1) * math.sin(phi2))
            plat, plon = math.degrees(phi2), math.degrees(lam2)
            if not land_prep.contains(Point(plon, plat)):
                if d_nm < best_d:
                    best_d = d_nm
                    best = (plat, plon)
                break  # this bearing found water; try the next
    return best


def arc_is_clear(p1: tuple[float, float], p2: tuple[float, float], land_prep,
                 sample_step_nm: float = 3.0, endpoint_buf_nm: float = 10.0) -> bool:
    """
    Sample the great-circle arc between p1 and p2 every ~sample_step_nm
    NM. Return False if any sample (outside endpoint buffers and outside
    any navigable-strait box) falls on land.
    """
    from shapely.geometry import Point
    dist = haversine_nm(p1[0], p1[1], p2[0], p2[1])
    if dist < 2 * endpoint_buf_nm:
        return True  # too short to usefully check; caller trusts endpoints
    # Sample count proportional to distance so every ~sample_step_nm NM
    # we take one point. Cap at a reasonable max to keep builds fast.
    samples = min(max(int(dist / sample_step_nm), 10), 2000)
    for i in range(1, samples):
        t = i / samples
        pt = gc_interpolate(p1, p2, t)
        # Skip near-endpoint samples — ports typically sit on the coast
        # line, so the first and last few NM will always "touch land"
        # in the 10m dataset.
        d1 = haversine_nm(pt[0], pt[1], p1[0], p1[1])
        d2 = haversine_nm(pt[0], pt[1], p2[0], p2[1])
        if d1 < endpoint_buf_nm or d2 < endpoint_buf_nm:
            continue
        if in_navigable_box(pt[0], pt[1]):
            continue
        if land_prep.contains(Point(pt[1], pt[0])):
            return False
    return True


# ─────────────────────────────────────────────────────────────
# PORT DATABASE — 100 curated gasoline trading ports. Same list
# as build_composed_paths.py so the frontend contract doesn't
# change (names + coords). Just (lat, lon) — no "approach" or
# "gateway" anymore; the sphere graph works them out.
# ─────────────────────────────────────────────────────────────

PORTS: dict[str, tuple[float, float]] = {
    "Amsterdam, NL": (52.4075, 4.7856),
    "Rotterdam, NL": (51.9000, 4.4833),
    "Antwerp, BE": (51.2667, 4.3833),
    "Flushing, NL": (51.4500, 3.5833),
    "Ghent, BE": (51.0667, 3.7167),
    "Le Havre, FR": (49.4833, 0.1000),
    "Dunkirk, FR": (51.0500, 2.3667),
    "Hamburg, DE": (53.5333, 9.9667),
    "Immingham, GB": (53.6333, -0.2167),
    "Teesport, GB": (54.6167, -1.1667),
    "Grangemouth, GB": (56.0333, -3.7000),
    "London, GB": (51.5000, 0.0500),
    "Thames, GB": (51.4500, 0.7333),
    "Fawley, GB": (50.8333, -1.3333),
    "Milford Haven, GB": (51.7000, -5.0500),
    "Pembroke, GB": (51.6833, -4.9500),
    "Belfast, GB": (54.6000, -5.9167),
    "Dublin, IE": (53.3500, -6.2333),
    "Falmouth, GB": (50.1500, -5.0667),
    "Mongstad, NO": (60.8167, 5.0333),
    "Skaw, DK": (57.7333, 10.5833),
    "Gothenburg, SE": (57.7000, 11.9333),
    "Brofjorden, SE": (58.3500, 11.4333),
    "Gdansk, PL": (54.4000, 18.6667),
    "Klaipeda, LT": (55.7167, 21.1000),
    "Ventspils, LV": (57.4000, 21.5333),
    "Tallinn, EE": (59.4500, 24.7500),
    "Ust-Luga, RU": (59.6833, 28.3833),
    "Primorsk, RU": (60.3500, 28.6167),
    "Sankt-Peterburg, RU": (59.9333, 30.2000),
    "Porvoo, FI": (60.3000, 25.6500),
    "Lavera, FR": (43.3833, 4.9833),
    "Marseille, FR": (43.3000, 5.3667),
    "Barcelona, ES": (41.3500, 2.1667),
    "Tarragona, ES": (41.1000, 1.2333),
    "Castellon, ES": (39.9667, -0.0167),
    "Cartagena, ES": (37.5833, -0.9833),
    "Algeciras, ES": (36.1333, -5.4333),
    "Ceuta, ES": (35.8833, -5.3167),
    "Gibraltar, GI": (36.1333, -5.3500),
    "Algiers, DZ": (36.7667, 3.0667),
    "Skikda, DZ": (36.8833, 6.9000),
    "Genoa, IT": (44.4000, 8.9167),
    "Sarroch, IT": (39.0667, 9.0167),
    "Naples, IT": (40.8333, 14.2667),
    "Augusta, IT": (37.2167, 15.2167),
    "Benghazi, LY": (32.1167, 20.0667),
    "Koper, SI": (45.5333, 13.7333),
    "Split, HR": (43.5000, 16.4333),
    "Agioi Theodoroi, GR": (37.9167, 23.0833),
    "Thessaloniki, GR": (40.6167, 22.9333),
    "Aliaga, TR": (38.8000, 26.9667),
    "Izmit, TR": (40.7667, 29.9167),
    "Vassiliko, CY": (34.7333, 33.3333),
    "Beirut, LB": (33.9000, 35.5167),
    "Alexandria, EG": (31.1833, 29.8833),
    "Constantza, RO": (44.1667, 28.6500),
    "Novorossiysk, RU": (44.7167, 37.7667),
    "Tuapse, RU": (44.1000, 39.0667),
    "Mohammedia, MA": (33.7167, -7.3833),
    "Las Palmas, ES": (28.1333, -15.4333),
    "Huelva, ES": (37.2500, -6.9500),
    "Sines, PT": (37.9500, -8.8667),
    "Aveiro, PT": (40.6333, -8.7500),
    "Bilbao, ES": (43.3500, -3.0333),
    "Yanbu, SA": (24.0833, 38.0500),
    "Fujairah, AE": (25.1333, 56.3500),
    "Jebel Ali, AE": (25.0167, 55.0667),
    "Ruwais, AE": (24.1000, 52.7167),
    "Sikka, IN": (22.4333, 69.8333),
    "Mombasa, KE": (-4.0667, 39.6667),
    "Singapore, SG": (1.2667, 103.8333),
    "Lagos, NG": (6.4333, 3.4000),
    "Lome, TG": (6.1333, 1.2833),
    "Tema, GH": (5.6333, -0.0167),
    "Abidjan, CI": (5.2667, -4.0167),
    "Dakar, SN": (14.6667, -17.4167),
    "Cotonou, BJ": (6.3500, 2.4333),
    "Monrovia, LR": (6.3500, -10.8000),
    "Freetown, SL": (8.4833, -13.2333),
    "Cape Town, ZA": (-33.9000, 18.4333),
    "New York, US": (40.6667, -74.0333),
    "Philadelphia, US": (39.9333, -75.1333),
    "Baltimore, US": (39.2667, -76.5833),
    "Norfolk, US": (36.8500, -76.3000),
    "Wilmington, US": (34.2333, -77.9500),
    "Savannah, US": (32.0833, -81.1000),
    "Houston, US": (29.7500, -95.0000),
    "Corpus Christi, US": (27.8000, -97.4000),
    "Portland, US": (43.6567, -70.2500),
    "Boston, US": (42.3500, -71.0500),
    "Halifax, CA": (44.6333, -63.5667),
    "Come-by-Chance, CA": (47.8167, -54.0000),
    "Point Tupper, CA": (45.6167, -61.3667),
    "Quebec, CA": (46.8139, -71.2080),
    "Montreal, CA": (45.5017, -73.5673),
    "San Juan, PR": (18.4500, -66.1000),
    "Guayanilla, PR": (17.9833, -66.7833),
    "Aruba, AW": (12.4500, -69.9667),
    "Curacao, CW": (12.1833, -68.9667),
    "Point Lisas, TT": (10.4000, -61.4667),
    "St. Croix, VI": (17.7000, -64.7333),
    "Hamilton, BM": (32.2833, -64.7833),
    "La Libertad, EC": (-2.2167, -80.9167),
    "Los Angeles, US": (33.7333, -118.2667),
    "San Francisco, US": (37.7750, -122.4183),
    # Added from MarineCadastre AIS analysis (Jan 2023): major US
    # tanker-dwell ports that weren't in the original 100-port list.
    "Tampa, US":         (27.9500, -82.4500),
    "New Orleans, US":   (29.9500, -90.0700),
    "Port Arthur, US":   (29.8700, -93.9300),
    "Beaumont, US":      (30.0800, -94.1000),
    "Long Beach, US":    (33.7700, -118.1900),
    "Lake Charles, US":  (30.2300, -93.2200),
    # 4-day AIS analysis (Jan 2023): 6 more tanker-dwell clusters far
    # from any existing port.
    "Baton Rouge, US":     (30.4500,  -91.1800),
    "Searsport, US":       (44.4500,  -68.9300),
    "Jacksonville, US":    (30.3200,  -81.6300),
    "Seattle, US":         (47.6000, -122.3300),
    "Port Everglades, US": (26.0900,  -80.1200),
    "Guam, US":            (13.4400,  144.6600),
    # EU tanker hubs surfaced by EMODnet 2024 vessel-density raster.
    "Wilhelmshaven, DE":    (53.5100,   8.1400),
    "Marsaxlokk, MT":       (35.8300,  14.5400),
    "Iskenderun, TR":       (36.5800,  36.1700),
    "Venice, IT":           (45.4400,  12.3300),
    "Murmansk, RU":         (68.9700,  33.0500),
    "Kotka, FI":            (60.4600,  26.9500),
    "Livorno, IT":          (43.5500,  10.3100),
    "Burgas, BG":           (42.5000,  27.4800),
    "Varna, BG":            (43.2100,  27.9300),
    "Batumi, GE":           (41.6500,  41.6300),
    "Kristiansund, NO":     (63.1100,   7.7400),
    "Mersin, TR":           (36.7800,  34.6400),
    "Santa Cruz, ES":       (28.4700, -16.2500),
    "Saint-Nazaire, FR":    (47.2700,  -2.2000),
    "Nynashamn, SE":        (58.9000,  17.9500),
    # EU gaps (industry-known tanker hubs not yet in EMODnet top results)
    "Trieste, IT":          (45.6500,  13.7700),
    "Milazzo, IT":          (38.2200,  15.2500),
    "Odessa, UA":           (46.4900,  30.7300),
    "Finnart, GB":          (56.0800,  -4.8800),
    "Sullom Voe, GB":       (60.4800,  -1.3000),
    "Sidi Kerir, EG":       (30.9800,  29.2700),
    "Marsa el Brega, LY":   (30.4200,  19.5800),
    "Elefsina, GR":         (38.0300,  23.5500),
    "Porto Torres, IT":     (40.8400,   8.4000),
    "Ambarli, TR":          (40.9700,  28.6800),
    "Karsto, NO":           (59.2700,   5.5000),
    # Middle East (world's top tanker region)
    "Ras Tanura, SA":       (26.6500,  50.1700),
    "Juaymah, SA":          (26.8400,  50.0700),
    "Mina al-Ahmadi, KW":   (29.0700,  48.1500),
    "Kharg Island, IR":     (29.2200,  50.3400),
    "Sohar, OM":            (24.4900,  56.6300),
    "Khor al-Zubair, IQ":   (30.1800,  47.9500),
    # South Asia
    "Mumbai, IN":           (18.9500,  72.8500),
    "Chennai, IN":          (13.1000,  80.2900),
    "Kochi, IN":             (9.9700,  76.2600),
    "Karachi, PK":          (24.8400,  66.9800),
    "Chittagong, BD":       (22.2800,  91.8000),
    # Southeast Asia
    "Port Klang, MY":        (3.0000, 101.4000),
    "Kuantan, MY":           (3.9500, 103.4200),
    "Map Ta Phut, TH":      (12.6800, 101.1500),
    "Laem Chabang, TH":     (13.0800, 100.9000),
    "Tanjung Pelepas, MY":   (1.3600, 103.5500),
    "Merak, ID":             (5.9600, 105.9900),
    "Cilacap, ID":          (-7.7500, 109.0000),
    # East Asia
    "Ulsan, KR":            (35.5100, 129.3800),
    "Daesan, KR":           (37.0100, 126.3300),
    "Yeosu, KR":            (34.7400, 127.7500),
    "Chiba, JP":            (35.5800, 140.0400),
    "Yokohama, JP":         (35.4500, 139.6500),
    "Kashima, JP":          (35.9600, 140.7000),
    "Kaohsiung, TW":        (22.6100, 120.2800),
    # China
    "Ningbo, CN":           (29.8700, 121.8000),
    "Dalian, CN":           (38.9200, 121.6300),
    "Qingdao, CN":          (36.0700, 120.3200),
    "Tianjin, CN":          (39.0000, 117.7200),
    "Shanghai, CN":         (31.2000, 121.5000),
    # West Africa (oil export)
    "Bonny, NG":             (4.4300,   7.1700),
    "Qua Iboe, NG":          (4.4700,   8.3000),
    "Forcados, NG":          (5.2500,   5.4000),
    "Cabinda, AO":          (-5.5500,  12.2000),
    "Soyo, AO":             (-6.1200,  12.3500),
    # South America
    "Santos, BR":          (-23.9500, -46.3000),
    "Sao Sebastiao, BR":   (-23.8000, -45.4000),
    "Rio Grande, BR":      (-32.0300, -52.1000),
    "Puerto La Cruz, VE":   (10.2300, -64.6300),
    "Callao, PE":          (-12.0500, -77.1500),
    "Quintero, CL":        (-32.7800, -71.5300),
    # Oceania
    "Kwinana, AU":         (-32.2300, 115.7700),
    "Gladstone, AU":       (-23.8300, 151.2500),
}


# ─────────────────────────────────────────────────────────────
# GEOGRAPHIC ANCHORS — key waypoints where sea routes naturally
# bend: strait entries/exits, major capes, island corners.
# Dijkstra stitches these together, no hand-curated chain needed.
# Keep each anchor a few NM offshore so the 10m coastline doesn't
# cause spurious "land" hits at the node itself.
# ─────────────────────────────────────────────────────────────

ANCHORS: dict[str, tuple[float, float]] = {
    # ── Gibraltar & Iberia ─────────────────────────────────────
    "gib_atlantic": (36.00, -6.20),       # SW approach, open Atlantic
    "gib_west": (35.95, -5.70),           # west of strait
    "gib_east": (36.02, -5.10),           # east of strait (Alboran)
    "cabo_trafalgar": (36.10, -6.20),
    "cabo_sao_vicente": (37.00, -9.30),   # SW Portugal
    "cabo_da_roca": (38.80, -9.70),       # W Portugal
    "cabo_finisterre": (42.85, -9.60),    # NW Spain
    "bay_biscay_w": (45.00, -8.00),       # open Atlantic W of Biscay
    "bay_biscay_n": (47.50, -5.50),       # N Biscay approach
    # ── English Channel & NW Europe ───────────────────────────
    "ushant_n": (48.80, -5.70),           # N Ushant (Brittany NW)
    "lizard_point": (49.80, -5.20),       # SW England
    "lands_end_w": (49.80, -6.00),        # W of Land's End
    "channel_mid": (49.80, -3.00),
    "channel_e": (50.50, -0.50),
    "dover_strait": (51.00, 1.50),
    "thames_approach": (51.50, 1.90),
    "dutch_offshore": (52.00, 2.80),
    "heligoland": (54.15, 7.90),
    "elbe_mouth": (53.90, 8.30),          # Elbe → North Sea exit
    "wadden_sea_mid": (53.70, 7.00),      # between Germany & Netherlands offshore
    "jutland_n": (57.80, 8.00),           # NW Jutland
    "skaw_outer": (57.85, 10.70),
    # ── Scotland / Irish Sea ──────────────────────────────────
    "pentland_firth": (58.70, -3.00),     # N Scotland passage
    "hebrides_w": (57.50, -8.00),         # W Outer Hebrides
    "northern_ireland": (54.90, -5.30),   # NI gateway
    "irish_sea_s": (52.00, -6.20),        # S Irish Sea
    "celtic_sea": (51.00, -7.50),         # Celtic Sea, SW of Ireland
    "celtic_deep": (49.80, -7.50),
    # ── Baltic ────────────────────────────────────────────────
    "kattegat": (56.70, 12.00),           # E of Skagen
    "oresund_s": (55.40, 12.80),          # Oresund south
    "danish_belt": (55.10, 11.00),        # Great Belt
    "bornholm_e": (55.00, 15.50),
    "gotland_s": (56.90, 18.30),
    "gotland_n": (58.40, 19.50),
    "saaremaa_w": (58.00, 21.20),
    "hiiumaa_w": (59.00, 21.80),
    "gulf_finland_mouth": (59.60, 23.50),
    # ── Western Med ───────────────────────────────────────────
    "balearic_w": (39.50, 1.80),
    "balearic_e": (39.80, 4.50),
    "cap_creus": (42.30, 3.50),
    "corsica_nw": (43.00, 8.30),          # NW of Corsica
    "corsica_sw": (41.50, 8.30),          # SW of Corsica (west approach)
    "corsica_ne": (43.00, 9.70),          # NE Corsica
    "bonifacio_w": (41.35, 9.05),         # Bonifacio Strait west entry
    "bonifacio_e": (41.35, 9.30),         # Bonifacio Strait east entry
    "sardinia_nw": (41.20, 8.20),
    "sardinia_sw": (38.90, 8.30),
    "sardinia_se": (39.00, 9.60),
    "sicily_nw": (38.20, 12.30),          # offshore Marsala
    "sicily_ne": (38.35, 15.75),          # offshore N of Messina
    "sicily_s_messina": (38.05, 15.70),   # S exit of Messina strait
    "cape_passero": (36.55, 15.30),       # SE Sicily
    "cap_bon": (37.30, 11.30),            # Tunisia cape — Sicilian Channel
    "tyrrhenian_n": (43.50, 10.00),       # Ligurian / north Tyrrhenian
    "tyrrhenian_mid": (40.90, 12.50),     # central Tyrrhenian
    "naples_approach": (40.50, 14.20),
    # ── Adriatic ──────────────────────────────────────────────
    "otranto_w": (40.00, 19.00),          # Otranto Strait, Albanian side
    "adriatic_mid": (42.50, 16.30),
    "adriatic_n": (44.00, 14.30),
    "gulf_trieste": (45.10, 13.40),
    # ── Ionian / Aegean ───────────────────────────────────────
    "cape_matapan": (36.30, 22.50),       # S Peloponnese
    "cape_malea": (36.40, 23.20),
    "kythira_channel": (36.20, 22.80),
    "crete_s": (34.50, 24.00),            # S of Crete (open east Med)
    "crete_w": (35.20, 23.30),
    "saronic_s": (37.50, 24.00),
    "cyclades_n": (37.80, 24.70),
    "aegean_n": (39.50, 24.80),
    "lemnos_e": (39.90, 26.00),
    # ── Turkish straits & Black Sea ───────────────────────────
    "dardanelles_w": (40.10, 26.10),
    "dardanelles_e": (40.30, 26.80),
    "bosphorus_s": (41.00, 29.00),
    "bosphorus_n": (41.25, 29.10),
    "black_sea_nw": (44.50, 31.00),
    # ── East Med / Levant ─────────────────────────────────────
    "rhodes_s": (35.90, 28.20),
    "cyprus_w": (34.80, 32.20),
    "cyprus_e": (34.80, 33.80),
    "levant_offshore": (33.50, 34.50),
    "alexandria_offshore": (31.60, 30.10),
    "port_said": (31.50, 32.30),
    # ── Red Sea / Arabia ──────────────────────────────────────
    "suez_s": (29.90, 32.55),
    "red_sea_n": (27.50, 34.50),
    "red_sea_upper_mid": (26.00, 35.60),
    "red_sea_yanbu_off": (24.50, 36.80),     # offshore Yanbu
    "red_sea_jeddah_off": (21.50, 38.50),
    "red_sea_mid": (19.00, 40.00),
    "red_sea_s_mid": (15.50, 41.50),
    "red_sea_s": (13.50, 42.50),
    "bab_el_mandeb": (12.60, 43.40),
    "gulf_aden_e": (12.00, 51.00),
    "socotra_s": (11.50, 54.00),
    "hormuz_w": (26.40, 56.30),
    "hormuz_e": (26.00, 56.90),
    "gulf_oman": (24.50, 58.50),
    "persian_gulf_mid": (27.00, 52.00),
    "persian_gulf_s": (25.50, 53.50),
    "persian_gulf_n": (29.50, 49.50),
    "bahrain_offshore": (26.20, 50.50),
    "abu_dhabi_offshore": (24.80, 54.00),
    # ── Indian Ocean ──────────────────────────────────────────
    "arabian_sea": (15.00, 60.00),
    "cape_comorin": (8.00, 78.00),
    "sri_lanka_s": (5.00, 80.50),
    "bengal_approach": (8.00, 90.00),
    "mombasa_offshore": (-4.50, 40.50),
    "mombasa_e": (-4.00, 42.00),          # further offshore for transit
    "dar_es_salaam": (-7.00, 40.00),
    "zanzibar_n": (-5.50, 40.00),
    "somali_offshore": (-2.00, 43.00),
    "madagascar_n": (-12.00, 49.00),
    "mozambique_mid": (-22.00, 38.50),
    "agulhas_e": (-36.00, 25.00),
    "good_hope_s": (-35.50, 18.50),
    "cape_town_offshore": (-34.50, 17.80),
    # ── SE Asia ───────────────────────────────────────────────
    "malacca_w": (5.50, 96.00),
    "malacca_e": (1.30, 103.90),
    "singapore_offshore": (1.20, 104.30),
    # ── W Africa ──────────────────────────────────────────────
    "dakar_w": (14.70, -18.50),
    "dakar_s": (13.50, -17.80),
    "freetown_offshore": (8.30, -13.80),
    "monrovia_offshore": (6.00, -11.50),
    "cape_palmas": (4.00, -8.00),
    "cape_three_points": (4.40, -2.30),
    "cotonou_offshore": (6.00, 2.40),
    "lagos_offshore": (6.00, 3.40),
    "gulf_guinea_e": (3.00, 6.50),
    "angola_offshore": (-12.00, 12.00),
    "cape_verde_n": (16.00, -25.00),
    "senegal_s_offshore": (12.00, -17.50),
    # ── N Atlantic open ocean ─────────────────────────────────
    "azores_n": (41.00, -28.00),
    "mid_atlantic_n": (45.00, -40.00),
    "grand_banks_s": (42.00, -50.00),
    "grand_banks_e": (45.00, -48.00),
    "cape_farewell": (59.50, -44.00),
    # ── Americas East Coast ──────────────────────────────────
    "newfoundland_se": (46.00, -52.00),
    "cabot_strait_n": (47.30, -59.80),    # Cabot Strait north entry
    "cabot_strait_s": (46.80, -60.00),    # Cabot Strait south entry
    "nova_scotia_e": (44.50, -62.50),     # offshore east of Halifax
    "nova_scotia_s": (43.00, -65.50),     # offshore south of NS
    "gulf_of_maine": (42.50, -69.00),
    "ny_bight_offshore": (40.30, -73.50),
    "cape_hatteras": (35.00, -74.00),
    "south_florida": (25.00, -78.50),
    "florida_strait_w": (24.30, -81.80),
    "yucatan_channel": (21.60, -85.50),
    "caribbean_e": (18.00, -64.00),
    "caribbean_w": (13.00, -75.00),
    "panama_caribbean": (9.35, -79.90),
    "panama_pacific": (8.85, -79.50),
    # ── St. Lawrence / Gulf ───────────────────────────────────
    "stl_estuary_mid": (48.30, -69.00),
    "stl_pointe_monts": (49.30, -67.40),
    "jacques_cartier_w": (49.95, -65.00),
    "jacques_cartier_e": (50.10, -61.50),
    "stl_anticosti_e": (49.00, -60.00),
    # ── Pacific ───────────────────────────────────────────────
    "gulf_tehuantepec": (14.50, -95.50),
    "cape_san_lucas": (22.50, -110.00),
    "california_offshore": (34.00, -121.00),
    "san_francisco_offshore": (37.50, -123.00),
    "hawaii_n": (25.00, -158.00),
    "pacific_mid_n": (30.00, -170.00),
    "ecuador_offshore": (-2.50, -82.00),
    # ── Trans-Pacific (Hawaii → Asia) ──────────────────────────
    "aleutian_s": (50.00, -175.00),
    "japan_se": (33.00, 143.00),
    "philippines_e": (15.00, 128.00),
    "marshall_is": (8.00, 168.00),
    "pacific_mid": (15.00, -165.00),
    "pacific_se": (-10.00, -135.00),
    "fiji_n": (-12.00, 178.00),
    # ── S Atlantic / Africa ────────────────────────────────────
    "cape_verde_offshore": (15.00, -24.00),
    "st_helena_n": (-10.00, -15.00),
    "ascension_offshore": (-8.00, -14.00),
    "namibia_offshore": (-22.00, 12.00),
    "tristan_da_cunha": (-37.00, -12.00),
    "south_atlantic_mid": (-20.00, -25.00),
    # ── S America ──────────────────────────────────────────────
    "recife_offshore": (-8.50, -34.00),
    "rio_offshore": (-23.50, -42.00),
    "rio_plata": (-36.00, -55.00),
    "falklands_n": (-50.00, -57.00),
    "cape_horn_s": (-58.00, -67.00),
    "chile_offshore": (-40.00, -74.00),
    "peru_offshore": (-15.00, -78.00),
    "pacific_sa_mid": (-15.00, -100.00),
    # ── Indian Ocean ───────────────────────────────────────────
    "maldives_s": (0.00, 73.00),
    "chagos_area": (-7.00, 72.00),
    "reunion_offshore": (-22.00, 56.00),
    "indian_ocean_mid": (-10.00, 80.00),
    "andaman_sea": (10.00, 95.00),
    "java_s": (-10.00, 110.00),
    "bali_s": (-10.00, 115.00),
    # ── NW Pacific / E Asia ────────────────────────────────────
    "taiwan_strait_s": (22.00, 119.00),
    "south_china_sea": (15.00, 115.00),
    "luzon_w": (15.00, 120.00),
    "okinawa_offshore": (26.00, 128.00),
    "east_china_sea": (30.00, 125.00),
    # ── N Pacific Americas ─────────────────────────────────────
    "vancouver_offshore": (48.50, -125.50),
    "seattle_offshore": (47.50, -125.00),
    "oregon_offshore": (44.00, -125.00),
    "baja_sur": (23.00, -110.00),
    "mexico_w": (17.00, -103.00),
    "central_am_w": (11.50, -88.00),
    # ── Caribbean / Gulf ───────────────────────────────────────
    "gulf_of_mexico_mid": (25.00, -88.00),
    "gulf_mex_w": (27.00, -94.00),       # W Gulf of Mexico for Houston/Corpus
    "gulf_mex_ne": (28.00, -90.00),      # NE Gulf of Mexico
    "texas_offshore": (28.50, -95.00),
    "mobile_offshore": (29.50, -87.50),
    "bahamas_n": (26.00, -77.00),
    "hispaniola_s": (17.00, -72.00),
    "windward_passage": (20.00, -73.80),
    "mona_passage": (18.50, -67.80),
    "caribbean_mid": (15.00, -70.00),
    # ── High latitudes (NE Atlantic) ───────────────────────────
    "faroe_islands": (62.00, -7.00),
    "iceland_s": (63.00, -19.00),
    "iceland_e": (64.50, -12.00),
    "ireland_w": (53.00, -11.50),
    "portugal_w": (40.00, -11.00),
    "canaries_w": (28.00, -18.00),
    # ── Arabian Sea detail ─────────────────────────────────────
    "socotra_n": (13.00, 53.00),
    "gulf_of_aden_mid": (12.00, 47.00),
    "gulf_of_oman_mid": (23.50, 59.50),
    "arabian_sea_n": (18.00, 63.00),
    "arabian_sea_s": (7.00, 68.00),
    # ── Additional Med detail ──────────────────────────────────
    "menorca_n": (40.30, 4.20),
    "ibiza_s": (38.50, 1.50),
    "gulf_lion": (42.50, 4.50),
    "ligurian_mid": (43.40, 7.50),
    "riviera_west": (43.20, 6.50),        # offshore Toulon/Hyeres
    "riviera_cannes": (43.40, 7.00),      # offshore Cannes
    "riviera_nice": (43.60, 7.30),        # offshore Nice/Monaco
    "riviera_east": (43.80, 8.00),        # offshore Ventimiglia/Sanremo
    "tyrrhenian_mid_s": (39.50, 13.50),
    "ionian_mid": (37.50, 19.00),
    "kythera_w": (36.00, 22.50),
    "greek_south": (35.00, 22.00),
    "crete_e": (35.00, 27.00),
    "kastellorizo": (36.20, 29.50),
    # ── Additional Atlantic crossings ──────────────────────────
    "bermuda_n": (33.00, -64.00),
    "canaries_e": (28.50, -13.00),
    "azores_w": (39.00, -32.00),
    "sargasso_w": (30.00, -60.00),
    "sargasso_e": (30.00, -45.00),
}


# Auto-generated per-port offshore satellites: for each port, we
# search out from the port in 16 bearings, placing a waypoint at the
# first water point encountered in each direction. Narrow-estuary
# ports (Hamburg up the Elbe, Philadelphia up the Delaware, Houston
# up Galveston Bay) may need to reach 100+ NM out before hitting
# open sea — we keep searching until we find water.
PORT_OFFSHORE_BEARINGS = tuple(range(0, 360, 22))   # 16 directions
PORT_OFFSHORE_MAX_NM = 150.0
PORT_OFFSHORE_STEP_NM = 5.0


def _bearing_destination(lat: float, lon: float, bearing_deg: float, dist_nm: float) -> tuple[float, float]:
    """Spherical direct formula: walk `dist_nm` NM along `bearing_deg` from (lat,lon)."""
    br = math.radians(bearing_deg)
    d = dist_nm / EARTH_R_NM
    phi1 = math.radians(lat)
    lam1 = math.radians(lon)
    phi2 = math.asin(math.sin(phi1) * math.cos(d)
                     + math.cos(phi1) * math.sin(d) * math.cos(br))
    lam2 = lam1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(phi1),
                             math.cos(d) - math.sin(phi1) * math.sin(phi2))
    return math.degrees(phi2), math.degrees(lam2)


def generate_port_offshore_anchors(land_prep) -> dict[str, tuple[float, float]]:
    """
    For each port and each of 16 bearings, walk outward from the port
    until we hit water (or give up at PORT_OFFSHORE_MAX_NM). Return a
    dict of extra graph nodes.
    """
    from shapely.geometry import Point
    out: dict[str, tuple[float, float]] = {}
    for port_name, (lat, lon) in PORTS.items():
        slug = port_name.split(",")[0].lower().replace(" ", "_").replace(".", "").replace("-", "_")
        for bearing_deg in PORT_OFFSHORE_BEARINGS:
            found = None
            d = PORT_OFFSHORE_STEP_NM
            while d <= PORT_OFFSHORE_MAX_NM:
                plat, plon = _bearing_destination(lat, lon, bearing_deg, d)
                if not land_prep.contains(Point(plon, plat)):
                    found = (plat, plon)
                    break
                d += PORT_OFFSHORE_STEP_NM
            if found is not None:
                out[f"_port_{slug}_{bearing_deg:03d}"] = found
    return out


# ─────────────────────────────────────────────────────────────
# Graph construction — all-pairs visibility test between every
# pair of (ports ∪ anchors). Expensive but one-shot; result is
# a sparse adjacency list keyed by node name.
# ─────────────────────────────────────────────────────────────

def compute_port_proxies(land_prep) -> dict[str, tuple[float, float]]:
    """
    For each port, determine the "graph position" used for visibility
    checks. If the port's literal coordinate falls on the simplified
    Natural Earth coastline (~70% of our ports — canals, river ports
    and tight harbours), snap to the nearest water point within 80 NM.
    The original port coordinate is still used as the *display* endpoint
    in the final path.
    """
    from shapely.geometry import Point
    proxies = {}
    fixed = 0
    for name, coord in PORTS.items():
        if not land_prep.contains(Point(coord[1], coord[0])):
            proxies[name] = coord
            continue
        offshore = find_offshore(coord, land_prep)
        if offshore is None:
            print(f"  WARN: {name} at {coord} — no water within 80 NM")
            proxies[name] = coord
        else:
            proxies[name] = offshore
            fixed += 1
    print(f"  Port proxies: {fixed} of {len(PORTS)} ports snapped to offshore")
    return proxies


def build_graph(land_prep, port_proxies: dict, port_ring: dict,
                distance_cap_nm: float = 4000.0) -> dict:
    """
    Returns {node_name: [(neighbor_name, distance_nm), ...]}.

    distance_cap_nm caps the max direct edge length. Edges longer than
    this almost never form the shortest path (they'd go through some
    intermediate anchor). Saves build time and trims the graph.
    """
    # Use port proxies (offshore shadow coords) for visibility checks,
    # not the literal port coordinates.
    nodes = {**port_proxies, **ANCHORS, **port_ring}
    names = list(nodes.keys())
    print(f"Building visibility graph: {len(names)} nodes "
          f"({len(PORTS)} ports + {len(ANCHORS)} anchors + {len(port_ring)} port-ring)")

    adj: dict[str, list] = {n: [] for n in names}
    total_pairs = len(names) * (len(names) - 1) // 2
    checked = 0
    edges = 0
    t0 = time.time()

    for i, a in enumerate(names):
        pa = nodes[a]
        for b in names[i + 1:]:
            pb = nodes[b]
            d = haversine_nm(pa[0], pa[1], pb[0], pb[1])
            if d > distance_cap_nm:
                continue
            if arc_is_clear(pa, pb, land_prep):
                adj[a].append((b, d))
                adj[b].append((a, d))
                edges += 1
            checked += 1
            if checked % 5000 == 0:
                elapsed = time.time() - t0
                eta = elapsed / checked * (total_pairs - checked)
                print(f"  {checked:,}/{total_pairs:,} pairs checked, "
                      f"{edges:,} edges, {elapsed:.0f}s ({eta:.0f}s ETA)")

    elapsed = time.time() - t0
    print(f"\nGraph built in {elapsed:.0f}s: {edges:,} edges from {checked:,} pair checks")
    return adj


# ─────────────────────────────────────────────────────────────
# Dijkstra — standard priority-queue implementation. Returns
# (distance, predecessor) maps from the source node.
# ─────────────────────────────────────────────────────────────

def dijkstra(adj: dict, source: str):
    dist = {source: 0.0}
    prev: dict = {}
    heap = [(0.0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def reconstruct(prev: dict, source: str, target: str) -> list[str]:
    if target not in prev and source != target:
        return []
    path = [target]
    while path[-1] != source:
        p = prev.get(path[-1])
        if p is None:
            return []
        path.append(p)
    path.reverse()
    return path


# ─────────────────────────────────────────────────────────────
# Path simplification — Douglas-Peucker on a great-circle arc.
# Keeps the nodes where the route genuinely bends, drops
# mid-ocean filler. Threshold is in NM of perpendicular GC
# distance from the simplified line.
# ─────────────────────────────────────────────────────────────

def _cross_track_nm(start, end, point) -> float:
    R = EARTH_R_NM
    d13 = haversine_nm(start[0], start[1], point[0], point[1]) / R
    if d13 == 0:
        return 0.0
    y1 = math.sin(math.radians(point[1] - start[1])) * math.cos(math.radians(point[0]))
    x1 = (math.cos(math.radians(start[0])) * math.sin(math.radians(point[0]))
          - math.sin(math.radians(start[0])) * math.cos(math.radians(point[0]))
          * math.cos(math.radians(point[1] - start[1])))
    b13 = math.atan2(y1, x1)
    y2 = math.sin(math.radians(end[1] - start[1])) * math.cos(math.radians(end[0]))
    x2 = (math.cos(math.radians(start[0])) * math.sin(math.radians(end[0]))
          - math.sin(math.radians(start[0])) * math.cos(math.radians(end[0]))
          * math.cos(math.radians(end[1] - start[1])))
    b12 = math.atan2(y2, x2)
    return abs(math.asin(math.sin(d13) * math.sin(b13 - b12)) * R)


def simplify_path(coords: list[tuple[float, float]], eps_nm: float = 5.0) -> list[tuple[float, float]]:
    """Recursive Douglas-Peucker using great-circle cross-track distance."""
    if len(coords) < 3:
        return coords
    dmax = 0.0
    idx = 0
    for i in range(1, len(coords) - 1):
        d = _cross_track_nm(coords[0], coords[-1], coords[i])
        if d > dmax:
            dmax = d
            idx = i
    if dmax > eps_nm:
        left = simplify_path(coords[:idx + 1], eps_nm)
        right = simplify_path(coords[idx:], eps_nm)
        return left[:-1] + right
    return [coords[0], coords[-1]]


# ─────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────

def main():
    print("Loading Natural Earth 10m land polygons...")
    land_prep = load_land()

    print("\nSnapping land-bound ports to nearest offshore water...")
    port_proxies = compute_port_proxies(land_prep)

    print("Generating per-port offshore anchor ring...")
    port_ring = generate_port_offshore_anchors(land_prep)
    print(f"  Generated {len(port_ring)} offshore satellite nodes")

    adj = build_graph(land_prep, port_proxies, port_ring)

    # Connectivity sanity check — every port should reach every other.
    print("\nRunning Dijkstra from each port...")
    port_names = list(PORTS.keys())
    # For path *display* use the original port coord on the endpoints;
    # internal anchors / proxies / ring nodes stay as-is.
    nodes = {**port_proxies, **ANCHORS, **port_ring}

    distances: dict[str, float] = {}
    paths: dict[str, list[list[float]]] = {}
    unreachable = []
    t0 = time.time()

    for i, src in enumerate(port_names):
        dist_map, prev_map = dijkstra(adj, src)
        for dst in port_names:
            if dst <= src:
                continue
            if dst not in dist_map:
                unreachable.append((src, dst))
                continue
            key = f"{src}|{dst}"
            node_path = reconstruct(prev_map, src, dst)
            coord_path = [nodes[n] for n in node_path]
            # Endpoints display the original (literal) port coords, not
            # the offshore proxies used for visibility.
            coord_path[0] = PORTS[node_path[0]]
            coord_path[-1] = PORTS[node_path[-1]]
            simplified = simplify_path(coord_path, eps_nm=5.0)
            # Recompute distance from simplified polyline so the number
            # matches what the client will render.
            total = 0.0
            for k in range(len(simplified) - 1):
                total += haversine_nm(simplified[k][0], simplified[k][1],
                                       simplified[k + 1][0], simplified[k + 1][1])
            distances[key] = round(total, 1)
            paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in simplified]
        elapsed = time.time() - t0
        print(f"  [{i + 1}/{len(port_names)}] {src} done ({elapsed:.0f}s)")

    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "distances.json").write_text(json.dumps(distances, indent=2))
    (OUTPUT_DIR / "paths.json").write_text(json.dumps(paths, separators=(",", ":")))
    (OUTPUT_DIR / "hand_drawn_keys.json").write_text(json.dumps({"keys": []}, indent=2))

    print(f"\nSaved to {OUTPUT_DIR}/")
    print(f"  distances.json: {len(distances)} entries")
    print(f"  paths.json: avg {sum(len(p) for p in paths.values()) / max(1, len(paths)):.1f} waypoints/path")
    if unreachable:
        print(f"\n  WARN: {len(unreachable)} unreachable port pairs:")
        for a, b in unreachable[:20]:
            print(f"    {a} <-> {b}")


if __name__ == "__main__":
    main()
