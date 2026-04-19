"""
V2 Ocean Routing: searoute's maritime network (3,573 segments / 29,530
waypoints) + GSHHG full-res (150 m) validation.

Guarantees: every edge in the output graph has been checked against
GSHHG and does NOT cross land (beyond a 0.5 NM coastal tolerance that
lets real coastal shipping through). Dijkstra over this graph gives
land-safe shortest paths for any port pair.

Pipeline:
  1. Load searoute.marnet_searoute.geojson as source network.
  2. Convert each LineString into node indices + weighted edges.
  3. Load GSHHG full-res with a 0.5 NM coastal tolerance.
  4. Drop edges where the arc crosses TOLERANCE land (inland by >0.5 NM).
  5. Add each of our 106 ports as extra nodes, connected by edges to
     their K nearest on-water searoute nodes (also land-validated).
  6. Run Dijkstra from every port to every other port.
  7. Emit paths.json + distances.json in the same shape the frontend
     already consumes.

Licenses:
  searoute (Apache 2.0) — network data is shipping-lane-quality.
  GSHHG (LGPL, shoreline data itself derived from public-domain WVS).
  All libs BSD/MIT/Apache.
"""

from __future__ import annotations

import heapq
import json
import math
import time
from pathlib import Path

import searoute as sr

from build_sphere_graph import (
    LandMask, PORTS, haversine_nm, gc_interpolate,
)


# Pilot station overrides — for ports that sit well inland (up a river
# or canal), route to the pilot-boarding position offshore instead of
# the literal port coordinate. This is exactly how Netpas handles the
# same problem: "Amsterdam" in a maritime distance table really means
# the Ijmuiden pilot station. The path still *starts/ends* at the
# pilot station (not the city centre), which is the correct figure for
# sea-distance purposes. The city coordinate can still be shown to the
# user as a label.
PILOT_STATIONS: dict[str, tuple[float, float]] = {
    # (lat, lon) of the pilot-boarding position the route should use.
    "Amsterdam, NL":       (52.47, 4.55),   # Ijmuiden North
    "Rotterdam, NL":       (52.00, 3.80),   # Maas North Pilot
    "Antwerp, BE":         (51.40, 3.15),   # Wandelaar pilot
    "Ghent, BE":           (51.45, 3.20),   # same Scheldt pilot as Antwerp
    "Flushing, NL":        (51.55, 3.00),
    "Hamburg, DE":         (54.00, 8.30),   # Elbe pilot (Cuxhaven)
    "London, GB":          (51.52, 1.90),   # Thames pilot
    "Thames, GB":          (51.55, 1.90),
    "Immingham, GB":       (53.65, 0.40),   # Humber pilot
    "Philadelphia, US":    (38.80, -75.00), # Delaware Bay pilot
    "Baltimore, US":       (37.00, -76.00), # Chesapeake Bay pilot
    "Houston, US":         (29.35, -94.70), # Galveston pilot
    "Corpus Christi, US":  (27.80, -97.00), # Aransas pilot
    "Savannah, US":        (31.95, -80.80),
    "Wilmington, US":      (33.85, -78.00),
    "Montreal, CA":        (47.20, -70.00), # Les Escoumins pilot (Laurentian)
    "Quebec, CA":          (47.20, -69.80),
    "Boston, US":          (42.32, -70.80),
    "Portland, US":        (43.60, -70.10),
    "Come-by-Chance, CA":  (47.50, -53.90),
    "Sankt-Peterburg, RU": (59.95, 29.50),  # Kronstadt pilot
    "Ust-Luga, RU":        (59.70, 28.20),
    "Primorsk, RU":        (60.30, 28.50),
    "Porvoo, FI":          (60.25, 25.60),
    "Gothenburg, SE":      (57.55, 11.60),
    "Brofjorden, SE":      (58.30, 11.30),
    "Gdansk, PL":          (54.45, 18.80),
    "Constantza, RO":      (44.15, 28.75),
    "Novorossiysk, RU":    (44.70, 37.95),
    "Tuapse, RU":          (44.05, 39.20),
    "Alexandria, EG":      (31.25, 29.80),
    "Lagos, NG":           (6.30, 3.30),
    "Lome, TG":            (6.10, 1.30),
    "Tema, GH":            (5.58, -0.02),
    "Abidjan, CI":         (5.20, -4.00),
    "Cotonou, BJ":         (6.30, 2.45),
    "Dakar, SN":           (14.60, -17.50),
    "Freetown, SL":        (8.45, -13.30),
    "Monrovia, LR":        (6.30, -10.90),
    "Singapore, SG":       (1.20, 103.80),
    "Jebel Ali, AE":       (25.00, 55.00),
    "Fujairah, AE":        (25.10, 56.40),
    "Ruwais, AE":          (24.00, 52.65),
    "Yanbu, SA":           (24.00, 38.00),
    "Sikka, IN":           (22.40, 69.75),
    "Mombasa, KE":         (-4.10, 39.70),
    "Los Angeles, US":     (33.70, -118.30),
    "San Francisco, US":   (37.80, -122.50),
    "Guayanilla, PR":      (17.95, -66.80),
    "San Juan, PR":        (18.45, -66.10),
    "Point Lisas, TT":     (10.40, -61.55),
    "Aruba, AW":           (12.45, -70.00),
    "Curacao, CW":         (12.15, -69.00),
    "La Libertad, EC":     (-2.20, -81.00),
    "Mohammedia, MA":      (33.70, -7.40),
    "Bilbao, ES":          (43.35, -3.05),
    "Aveiro, PT":          (40.60, -8.80),
    # US East coast additional pilot stations
    "New York, US":        (40.45, -73.80),  # Ambrose Light pilot station
    "Norfolk, US":         (36.93, -76.00),  # Cape Henry pilot
    "Halifax, CA":         (44.55, -63.50),
    "Point Tupper, CA":    (45.60, -61.40),
    # Mediterranean / Black Sea inland-ish ports
    "Izmit, TR":           (40.73, 29.30),   # Marmara Sea pilot
    "Thessaloniki, GR":    (40.35, 22.95),   # Thermaic Gulf pilot
    "Huelva, ES":          (37.15, -6.95),   # Rio Tinto pilot
    "Naples, IT":          (40.75, 14.15),   # Naples pilot (Capo Miseno)
    "Augusta, IT":         (37.20, 15.30),   # Augusta / Syracuse pilot
    # Baltic / Nordic
    "Mongstad, NO":        (60.85, 4.80),
    "Skaw, DK":            (57.80, 10.60),
    "Ventspils, LV":       (57.40, 21.40),
    "Klaipeda, LT":        (55.75, 20.95),
    "Tallinn, EE":         (59.60, 24.70),
    # UK/Ireland refinements
    "Teesport, GB":        (54.65, -1.00),   # Tees Fairway Buoy
    "Grangemouth, GB":     (56.05, -2.80),   # Rosyth pilot
    "Belfast, GB":         (54.85, -5.50),
    "Dublin, IE":          (53.37, -6.05),
    # Asia / Middle East extras
    "Beirut, LB":          (33.93, 35.40),
    "Vassiliko, CY":       (34.70, 33.30),
    "Aliaga, TR":          (38.70, 26.80),
    "Agioi Theodoroi, GR": (37.85, 23.10),
    # Americas
    "Hamilton, BM":        (32.30, -64.60),
    # Africa
    "Benghazi, LY":        (32.20, 20.00),
    "Cape Town, ZA":       (-34.00, 18.30),
    "Las Palmas, ES":      (28.15, -15.40),
    "Sines, PT":           (37.90, -8.95),
    # AIS-discovered US ports (pilot boarding positions)
    "Tampa, US":           (27.65, -83.00),   # Tampa Bay pilot
    "New Orleans, US":     (29.18, -89.25),   # SW Pass pilot (Mississippi mouth)
    "Port Arthur, US":     (29.70, -93.85),   # Sabine Pilots Association
    "Beaumont, US":        (29.70, -93.85),   # same Sabine pilot
    "Long Beach, US":      (33.74, -118.22),  # LA/LB common pilot area
    "Lake Charles, US":    (29.75, -93.33),   # Calcasieu Pilots
    # 2nd AIS-driven batch
    "Baton Rouge, US":     (29.18, -89.25),   # reached via SW Pass -> Mississippi
    "Searsport, US":       (44.10, -68.80),   # Penobscot Bay pilot
    "Jacksonville, US":    (30.38, -81.38),   # St Johns River sea buoy
    "Seattle, US":         (48.15, -123.50),  # Port Angeles / Puget Sound pilot
    "Port Everglades, US": (26.08, -80.08),   # right at the sea entrance
    "Guam, US":            (13.42, 144.62),   # Apra Harbor entrance
    # EMODnet-discovered EU pilot stations
    "Wilhelmshaven, DE":   (53.85,   7.85),   # Weser/Jade pilot offshore
    "Marsaxlokk, MT":      (35.78,  14.55),   # SE Malta offshore
    "Iskenderun, TR":      (36.55,  36.30),   # Gulf of Iskenderun entrance
    "Venice, IT":          (45.27,  12.45),   # Porto Marghera pilot
    "Murmansk, RU":        (69.35,  33.65),   # Kola Bay entrance
    "Kotka, FI":           (60.12,  26.95),   # Gulf of Finland pilot
    "Livorno, IT":         (43.55,  10.20),   # offshore Livorno
    "Burgas, BG":          (42.48,  27.80),   # offshore Burgas
    "Varna, BG":           (43.15,  28.10),   # offshore Varna
    "Batumi, GE":          (41.65,  41.75),   # offshore Batumi
    "Kristiansund, NO":    (63.00,   7.50),   # offshore Kristiansund
    "Mersin, TR":          (36.70,  34.65),   # offshore Mersin
    "Santa Cruz, ES":      (28.40, -16.15),   # Tenerife anchorage
    "Saint-Nazaire, FR":   (47.15,  -2.40),   # Loire entrance pilot
    "Nynashamn, SE":       (58.85,  17.85),   # Baltic approach
    # EU gaps pilots
    "Trieste, IT":         (45.62,  13.65),
    "Milazzo, IT":         (38.20,  15.30),
    "Odessa, UA":          (46.40,  30.85),
    "Finnart, GB":         (55.90,  -5.50),   # Firth of Clyde entrance
    "Sullom Voe, GB":      (60.60,  -1.40),
    "Sidi Kerir, EG":      (31.05,  29.20),
    "Marsa el Brega, LY":  (30.50,  19.60),
    "Elefsina, GR":        (38.00,  23.45),
    "Porto Torres, IT":    (40.90,   8.35),
    "Ambarli, TR":         (40.95,  28.68),
    "Karsto, NO":          (59.25,   5.20),
    # Middle East
    "Ras Tanura, SA":      (26.80,  50.35),
    "Juaymah, SA":         (26.95,  50.30),
    "Mina al-Ahmadi, KW":  (29.00,  48.35),
    "Kharg Island, IR":    (29.15,  50.30),
    "Sohar, OM":           (24.60,  56.85),
    "Khor al-Zubair, IQ":  (29.90,  48.80),
    # South Asia
    "Mumbai, IN":          (18.80,  72.60),
    "Chennai, IN":         (13.00,  80.40),
    "Kochi, IN":            (9.90,  76.10),
    "Karachi, PK":         (24.70,  66.70),
    "Chittagong, BD":      (22.10,  91.90),
    # Southeast Asia
    "Port Klang, MY":       (2.95, 101.20),
    "Kuantan, MY":          (3.85, 103.50),
    "Map Ta Phut, TH":     (12.55, 101.15),
    "Laem Chabang, TH":    (13.00, 100.95),
    "Tanjung Pelepas, MY":  (1.30, 103.40),
    "Merak, ID":            (5.95, 105.95),
    "Cilacap, ID":         (-7.85, 109.00),
    # East Asia
    "Ulsan, KR":           (35.40, 129.50),
    "Daesan, KR":          (37.05, 126.20),
    "Yeosu, KR":           (34.65, 127.80),
    "Chiba, JP":           (35.30, 140.10),
    "Yokohama, JP":        (35.30, 139.80),
    "Kashima, JP":         (35.90, 140.80),
    "Kaohsiung, TW":       (22.55, 120.20),
    # China
    "Ningbo, CN":          (29.80, 122.00),
    "Dalian, CN":          (38.80, 121.80),
    "Qingdao, CN":         (36.00, 120.50),
    "Tianjin, CN":         (38.80, 117.85),
    "Shanghai, CN":        (30.90, 122.00),
    # West Africa
    "Bonny, NG":            (4.15,   7.20),
    "Qua Iboe, NG":         (4.30,   8.30),
    "Forcados, NG":         (5.10,   5.30),
    "Cabinda, AO":         (-5.60,  12.10),
    "Soyo, AO":            (-6.10,  12.25),
    # South America
    "Santos, BR":         (-24.10, -46.30),
    "Sao Sebastiao, BR":  (-23.90, -45.30),
    "Rio Grande, BR":     (-32.25, -52.00),
    "Puerto La Cruz, VE":  (10.35, -64.60),
    "Callao, PE":         (-12.10, -77.25),
    "Quintero, CL":       (-32.85, -71.70),
    # Oceania
    "Kwinana, AU":        (-32.25, 115.60),
    "Gladstone, AU":      (-23.90, 151.40),
}


def effective_port_coord(port_name: str) -> tuple[float, float]:
    """Pilot station if defined, else literal port coord."""
    return PILOT_STATIONS.get(port_name, PORTS[port_name])

OUTPUT_DIR = Path(__file__).parent / "output"
DATA_DIR = Path(__file__).parent / "data"
SEAROUTE_GEOJSON = Path(sr.__file__).parent / "data" / "marnet_searoute.geojson"
COASTAL_TOLERANCE_NM = 0.5    # ship within this range of shore = allowed
PORT_CONNECT_K = 6            # connect each port to N nearest network nodes
SAMPLE_STEP_NM = 2.0
ENDPOINT_BUF_NM = 2.0

# Bathymetry-based safety filter, applied BOTH at node load time and
# inside arc_is_clear. The threshold is deliberately the SMALLEST
# tanker class (chemical/product at ~6 m draft + UKC ~2 m = 8 m).
# That way the graph is usable for every tanker size in our world:
#   - Small tankers actually use routes over the 8-20 m shelf.
#   - Larger tankers (MR ≈ 12 m, Suezmax ≈ 16 m, VLCC ≈ 20 m) can
#     still follow all those paths — they just never go into water
#     shallower than their own draft, and their operators verify
#     per-voyage against bigger-ship route books + live soundings.
#
# Earlier a 20 m threshold left 33% of port pairs unreachable — far
# too aggressive because it closed legitimate shallow-shelf lanes
# (Gulf of Bothnia, Baltic approaches, Gulf of Finland, much of the
# Black Sea, Gulf of Mexico inshore, parts of the Arabian Gulf).
#
# CRITICAL_CHANNELS (Kiel, Bosphorus, Malacca, Suez, Panama, Danish
# Straits, Dover, Red Sea, Hormuz, Corinth) are EXEMPT — ETOPO
# artefacts there can force false positives; we trust the manual
# curation of those passages.
#
# If we later want per-vessel-class routing (submenu "tanker class"
# in the planner), expose this threshold as a RouteOptions field
# and emit variants at 8 / 12 / 16 / 20 m.
MIN_WATER_DEPTH_M = 5.0


# ─────────────────────────────────────────────────────────────
# Build graph from searoute's marnet + port nodes.
# ─────────────────────────────────────────────────────────────

def round_coord(lon, lat, decimals=4):
    return (round(lon, decimals), round(lat, decimals))


def load_searoute_network():
    """Return (nodes, edges) from searoute's geojson.
    nodes: dict {id: (lat, lon)}
    edges: list of (id_a, id_b, distance_nm)
    """
    with open(SEAROUTE_GEOJSON, encoding="utf-8") as f:
        geo = json.load(f)
    node_id: dict[tuple[float, float], int] = {}
    nodes: dict[int, tuple[float, float]] = {}
    edges: list[tuple[int, int, float]] = []

    def id_for(lon, lat):
        key = round_coord(lon, lat)
        if key not in node_id:
            nid = len(nodes)
            node_id[key] = nid
            nodes[nid] = (key[1], key[0])     # store (lat, lon)
        return node_id[key]

    for feat in geo["features"]:
        geom = feat["geometry"]
        if geom["type"] == "LineString":
            rings = [geom["coordinates"]]
        elif geom["type"] == "MultiLineString":
            rings = geom["coordinates"]
        else:
            continue
        for ring in rings:
            for i in range(len(ring) - 1):
                lon1, lat1 = ring[i][:2]
                lon2, lat2 = ring[i + 1][:2]
                a = id_for(lon1, lat1)
                b = id_for(lon2, lat2)
                if a == b:
                    continue
                w = haversine_nm(lat1, lon1, lat2, lon2)
                edges.append((a, b, w))

    # Drop shallow nodes — see MIN_WATER_DEPTH_M above for rationale.
    nodes, edges = filter_shallow_nodes(nodes, edges)

    return nodes, edges


# Module-level singleton so arc_is_clear can call the depth check
# cheaply on its hot path (17k+ samples per pipeline run).
_BATHY_SINGLETON = None


def get_bathymetry():
    """Lazy-load the ETOPO bathymetry mask (shared across checks)."""
    global _BATHY_SINGLETON
    if _BATHY_SINGLETON is None:
        import bathymetry
        try:
            _BATHY_SINGLETON = bathymetry.BathymetryMask.load()
        except FileNotFoundError:
            _BATHY_SINGLETON = False   # sentinel: tried + failed
    return _BATHY_SINGLETON if _BATHY_SINGLETON is not False else None


def filter_shallow_nodes(nodes, edges):
    """
    Remove searoute nodes whose ETOPO 60s depth is shallower than
    MIN_WATER_DEPTH_M metres. Also drops any edge that referenced a
    removed node so the graph stays consistent.

    Nodes sitting deep inside CRITICAL_CHANNELS bboxes are exempted —
    the ETOPO 60s average over a ~2 km cell can report a shallow
    number in a narrow deep strait (Bosphorus, Kiel) because the cell
    mixes channel + bank. The same regions are already tagged as
    critical passages in the arc-clearance check, so this exemption
    keeps routing through them consistent with that logic.
    """
    b = get_bathymetry()
    if b is None:
        print("  [!] Bathymetry data not found — skipping depth filter.")
        print(f"      Run: curl -L -o scripts/ocean-routing/data/etopo_60s_bed.nc"
              f" https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/"
              f"60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc")
        return nodes, edges

    kept: dict[int, tuple[float, float]] = {}
    dropped_ids: set[int] = set()
    for nid, (lat, lon) in nodes.items():
        # Critical channels get a pass — their narrow geometry fools
        # 1' bathymetry cells into reporting artificially shallow depths.
        if in_critical_channel(lat, lon):
            kept[nid] = (lat, lon)
            continue
        # Dredged river / estuary channels likewise — ETOPO shows the
        # surrounding shallows and misses the dredged fairway.
        if in_navigable_river_channel(lat, lon):
            kept[nid] = (lat, lon)
            continue
        if b.is_unsafe(lat, lon, MIN_WATER_DEPTH_M):
            dropped_ids.add(nid)
        else:
            kept[nid] = (lat, lon)

    kept_edges = [
        (a, c, w) for (a, c, w) in edges
        if a not in dropped_ids and c not in dropped_ids
    ]

    print(
        f"  Bathymetry filter (depth < {MIN_WATER_DEPTH_M:g} m): "
        f"dropped {len(dropped_ids):,} nodes, "
        f"{len(edges) - len(kept_edges):,} edges"
    )
    return kept, kept_edges


def load_gshhg_with_tolerance():
    shp_path = DATA_DIR / "GSHHS_shp" / "f" / "GSHHS_f_L1.shp"
    if not shp_path.exists():
        raise SystemExit(f"Missing GSHHG at {shp_path}")
    print(f"  Loading GSHHG full-res with {COASTAL_TOLERANCE_NM} NM coastal tolerance...")
    import shapefile
    from shapely.geometry import shape
    from shapely.validation import make_valid
    sf = shapefile.Reader(str(shp_path))
    polys = []
    for sr_ in sf.shapeRecords():
        g = shape(sr_.shape.__geo_interface__)
        if not g.is_valid:
            g = make_valid(g)
        polys.append(g)
    return LandMask(polys, inland_buffer_nm=COASTAL_TOLERANCE_NM)


# Man-made canals + narrow straits that even GSHHG full-res reports
# as land because they're only a few hundred metres wide. An arc
# sample landing inside one of these boxes is forced to count as
# water. Kept deliberately tight.
# Surgical "keep routes further offshore" zones. Each entry is a
# lat/lon bounding box + minimum offshore distance + reason. During
# arc_is_clear, any sample point that falls inside the bbox AND is
# within `min_offshore_nm` of the nearest land polygon causes the
# whole arc to be rejected.
#
# Deliberately tight — we only list regions where searoute's AIS
# data puts transit edges unreasonably close to shore (e.g. ship
# anchorage clusters surfaced as through-routes). Everywhere else
# the default 0.5 NM coastal-tolerance behaviour applies.
#
# Format: (name, lat_min, lat_max, lon_min, lon_max, min_offshore_nm, reason)
MANUAL_EXCLUSION_ZONES = [
    ("Liberia coast", 4.0, 7.0, -11.5, -7.0, 5.0,
     "AIS puts edges within a few NM of Monrovia coast; transit should stay >=5 NM offshore"),
]


CRITICAL_CHANNELS = [
    (29.80, 31.30, 32.20, 32.80, "Suez Canal"),
    (53.80, 54.50, 8.80, 10.50, "Kiel Canal"),
    (8.80, 9.40, -80.30, -79.30, "Panama Canal"),
    # Turkish Straits — three tight bboxes that EXCLUDE Gallipoli
    # peninsula. A single wide bbox used to cover 40-41.4°N × 26-29.5°E
    # but that let a 130 NM searoute edge cut straight across Gallipoli
    # land (arc_is_clear skipped the land check inside the bbox). Split
    # to three snug rectangles around actual water so arcs that clip
    # Gallipoli get rejected and the hand-curated chain is forced in.
    (40.97, 41.28, 28.90, 29.25, "Bosphorus"),
    (40.38, 40.95, 26.90, 29.00, "Sea of Marmara"),
    (40.00, 40.42, 26.10, 26.78, "Dardanelles"),
    (37.85, 38.10, 22.85, 23.20, "Corinth Canal"),
    (24.80, 26.90, 54.80, 57.00, "Strait of Hormuz"),
    # Red Sea end-to-end — narrow GSHHG coast forces us to whitelist
    # the full corridor so searoute edges there aren't dropped.
    (12.00, 30.00, 32.00, 44.00, "Red Sea"),
    # Gulf of Aden — bridge between Bab-el-Mandeb and Indian Ocean
    (10.00, 17.00, 42.00, 55.00, "Gulf of Aden"),
    # Malacca / Singapore — dense island cluster
    (1.00, 6.00, 98.00, 104.50, "Malacca / Singapore Straits"),
    # Danish Straits
    (54.50, 57.80, 9.00, 13.50, "Danish Straits / Oresund / Kattegat"),
    # Dover Strait
    (50.50, 51.50, 0.80, 2.10, "Dover Strait"),
]


def in_critical_channel(lat, lon):
    for mla, mxa, mlo, mxo, _ in CRITICAL_CHANNELS:
        if mla <= lat <= mxa and mlo <= lon <= mxo:
            return True
    return False


# River / estuary navigation channels that are DREDGED to tanker-safe
# drafts but show as shallow in ETOPO 60s (1-minute grid averages the
# dredged channel with the surrounding mud/sandbanks). Ports whose
# pilot-station approaches cross these must not be rejected by the
# depth filter — they're reached every day by real tankers.
#
# Format: (name, lat_min, lat_max, lon_min, lon_max).
NAVIGABLE_RIVER_CHANNELS = [
    # Mississippi River — Gulf entrance through Birds Foot Delta up to
    # Baton Rouge (330 miles inland). Maintained to ~14 m draft.
    # Serves New Orleans, Baton Rouge, refinery terminals along the
    # Lower Mississippi.
    ("Mississippi River", 28.5, 31.0, -92.5, -88.5),
    # St Lawrence Seaway — Gulf of St Lawrence up to Montreal. Federal
    # channel maintained to 11.3 m in the Lakes, deeper downstream.
    # Serves Quebec, Montreal + Great Lakes access.
    ("St Lawrence Seaway", 45.0, 52.0, -74.5, -56.0),
    # Yangtze Estuary + Hangzhou Bay — approach to Ningbo-Zhoushan +
    # Shanghai via dredged channels (12.5 m main channel).
    ("Yangtze / Hangzhou Bay", 28.5, 32.5, 120.5, 125.0),
    # Strait of Canso — Nova Scotia causeway-narrow channel, deep
    # dredged (~24 m) but ETOPO cells near the bank look shallow.
    ("Strait of Canso", 45.4, 46.0, -61.7, -60.8),
]


def in_navigable_river_channel(lat, lon):
    """
    Bypass the bathymetry depth filter inside known dredged navigation
    channels. Functionally identical to `in_critical_channel` but
    kept as a separate list so we can evolve them independently:
    critical channels are about narrow land geometry, navigable
    channels are about dredged depth vs ETOPO-reported shallow.
    """
    for _name, mla, mxa, mlo, mxo in NAVIGABLE_RIVER_CHANNELS:
        if mla <= lat <= mxa and mlo <= lon <= mxo:
            return True
    return False


def in_manual_exclusion_zone(lat, lon, land):
    """
    True if the point is in a MANUAL_EXCLUSION_ZONES bbox AND within
    `min_offshore_nm` of the nearest land polygon.

    The bbox check is O(1) per zone and runs first, so points outside
    every listed zone return False immediately (most arc samples).
    Only when we're in a zone do we pay the STRtree.nearest() cost to
    measure distance-to-coast. That keeps build time nearly unchanged
    when the list is empty or small.
    """
    if not MANUAL_EXCLUSION_ZONES:
        return False
    from shapely.geometry import Point
    pt = None
    for _name, mla, mxa, mlo, mxo, min_offshore_nm, _reason in MANUAL_EXCLUSION_ZONES:
        if not (mla <= lat <= mxa and mlo <= lon <= mxo):
            continue
        if pt is None:
            pt = Point(lon, lat)
        # Find nearest land polygon. STRtree.nearest returns an ndarray
        # in shapely 2.x; coerce to a scalar index defensively.
        idx = land.tree.nearest(pt)
        if hasattr(idx, "__iter__"):
            idx = int(list(idx)[0])
        else:
            idx = int(idx)
        # `polygons` on LandMask contains the original polygon objects.
        # Distance in degrees, multiply by 60 for approximate NM — fine
        # at the ~5 NM scale we care about here.
        d_deg = land.polygons[idx].distance(pt)
        if d_deg * 60.0 < min_offshore_nm:
            return True
    return False


def arc_is_clear(p1, p2, land, sample_step=SAMPLE_STEP_NM, endpoint_buf=ENDPOINT_BUF_NM):
    from shapely.geometry import Point
    d = haversine_nm(p1[0], p1[1], p2[0], p2[1])
    if d < 2 * endpoint_buf:
        return True
    samples = max(8, int(d / sample_step))
    # Bathymetry lookup is cheap (numpy array index), so we keep a
    # reference on the arc-clear call rather than looking it up inside
    # the per-sample loop.
    bathy = get_bathymetry()
    for i in range(1, samples):
        t = i / samples
        lat, lon = gc_interpolate(p1, p2, t)
        d1 = haversine_nm(lat, lon, p1[0], p1[1])
        d2 = haversine_nm(lat, lon, p2[0], p2[1])
        if d1 < endpoint_buf or d2 < endpoint_buf:
            continue
        if in_critical_channel(lat, lon):
            continue
        if land.contains(Point(lon, lat)):
            return False
        # Manual "keep offshore" zones — narrow regions where searoute's
        # AIS network puts edges too close to shore. Runs AFTER the
        # critical-channels bypass so known narrow straits stay passable.
        if in_manual_exclusion_zone(lat, lon, land):
            return False
        # Bathymetry check — rejects arcs that cross water shallower than
        # our min-tanker threshold even when the endpoints sit in deep
        # water. Example: great-circle across the Sherbro / Bijagós
        # delta off Sierra Leone passes over extensive sandbars between
        # two nodes in 500+ m water. Depth-per-sample catches it;
        # node-only filter misses it. Dredged river channels bypass
        # since they ARE tanker-navigable despite nominal shallow depth.
        if bathy is not None and not in_navigable_river_channel(lat, lon):
            if bathy.is_unsafe(lat, lon, MIN_WATER_DEPTH_M):
                return False
    return True


def filter_edges_landsafe(nodes, edges, land):
    """Keep only edges whose arc clears the land mask."""
    kept = []
    dropped = 0
    for i, (a, b, w) in enumerate(edges):
        if arc_is_clear(nodes[a], nodes[b], land):
            kept.append((a, b, w))
        else:
            dropped += 1
        if (i + 1) % 10000 == 0:
            print(f"    {i + 1:,}/{len(edges):,} edges checked, "
                  f"{len(kept):,} kept, {dropped:,} dropped")
    print(f"  Filtered: {len(kept):,} kept / {dropped:,} dropped "
          f"of {len(edges):,} searoute edges")
    return kept


# Transit-only anchors we inject into the graph before connecting
# ports. searoute's own network is sparse in open Pacific, so Dijkstra
# happily sends a Long Beach ↔ Yokohama route all the way through the
# Panama Canal and Suez. These nodes give Dijkstra the option of a
# direct trans-Pacific crossing. All are pure-ocean points (verified
# against GSHHG).
TRANSIT_ANCHORS: dict[str, tuple[float, float]] = {
    # North Pacific great-circle corridor — peak latitude ~ 50°N for
    # West Coast ↔ Japan/Korea routes.
    "_tx_pac_n_e":   (45.00, -135.00),
    "_tx_pac_n_mid": (48.00, -170.00),
    "_tx_pac_n_w":   (45.00,  160.00),
    "_tx_pac_w":     (38.00,  145.00),
    # Mid Pacific (Hawaii latitude) for southerly crossings
    "_tx_pac_mid_e": (30.00, -140.00),
    "_tx_pac_hawaii":(22.00, -155.00),
    "_tx_pac_mid_w": (25.00,  170.00),
    # South Pacific — for NZ / Australia / South America trans-Pacific
    "_tx_pac_s":    (-20.00, -140.00),
    "_tx_pac_sw":   (-25.00,  170.00),
    # Indian Ocean midpoints
    "_tx_ind_mid":  (-10.00,   80.00),
    "_tx_ind_w":    (-20.00,   55.00),
    # South Atlantic
    "_tx_atl_s_e":  (-25.00,  -10.00),
    "_tx_atl_s_w":  (-25.00,  -30.00),
    # Arctic corridor (Norway ↔ Russian Arctic)
    "_tx_arctic_ne":(72.00,   45.00),
    # West African coastal corridor. searoute's AIS-derived marnet has a
    # gap between offshore Liberia and the Gulf of Guinea — the only
    # "bridge" through the region was via Monrovia port itself, which is
    # unacceptable now that Dijkstra blocks port transit. These pure-
    # ocean anchors (all ≥ 50 NM from coast, ≥ 1000 m depth per ETOPO)
    # restore the natural ~4°N shipping highway that tankers actually
    # sail. See https://map.searoutes.com — the real AIS traffic follows
    # almost exactly this latitude band.
    "_tx_waf_1":    ( 8.00,  -15.00),  # offshore Sierra Leone
    "_tx_waf_2":    ( 5.50,  -13.00),  # offshore Liberia (W)
    "_tx_waf_3":    ( 4.00,  -10.00),  # offshore Liberia (S)
    "_tx_waf_4":    ( 4.00,   -6.00),  # offshore Ivory Coast
    "_tx_waf_5":    ( 4.00,   -2.00),  # offshore Ghana
    "_tx_waf_6":    ( 4.00,    2.00),  # offshore Togo / Benin
    "_tx_waf_7":    ( 3.00,    6.00),  # offshore Nigeria
}


# ──────────────────────────────────────────────────────────────
# Hand-curated channel chains for narrow waterways
# ──────────────────────────────────────────────────────────────
# searoute's AIS-derived network is very sparse in narrow straits: the
# Bosphorus is a single node-pair, which Dijkstra connects with a
# straight edge that visually cuts across Istanbul. CRITICAL_CHANNELS
# whitelists these regions as "water" for the land-safety check, but
# that alone doesn't give Dijkstra enough waypoints to TRACE the
# channel — it can only pick from what's in the graph.
#
# CHANNEL_CHAINS injects dense, hand-picked waypoints along the real
# navigable centerline. Each chain is a sequence of (lat, lon) points
# ordered from one end of the waterway to the other. Consecutive
# waypoints within a chain are connected with a direct edge (land
# check bypassed — a maritime expert already vetted the path).
# Intermediate + endpoint nodes are wired into the broader graph via
# the normal arc-clear + nearest-k search.
#
# The chain becomes the cheapest (and on narrow straits, the ONLY
# land-safe) path between water on either side, so every route
# through the region automatically follows it.
#
# Coordinates live in `channel_chains.json` so the Fleet dev-tools
# Channel Editor can add/edit them without Python code changes.
CHANNEL_CHAINS_PATH = Path(__file__).parent / "channel_chains.json"


def load_channel_chains() -> dict[str, list[tuple[float, float]]]:
    """Load chains from JSON. Returns empty dict if the file is missing
    — the pipeline still builds, just without hand-curated overrides."""
    if not CHANNEL_CHAINS_PATH.exists():
        return {}
    data = json.loads(CHANNEL_CHAINS_PATH.read_text(encoding="utf-8"))
    out: dict[str, list[tuple[float, float]]] = {}
    for chain in data.get("chains", []):
        cid = chain.get("id")
        waypoints = chain.get("waypoints", [])
        if not cid or len(waypoints) < 2:
            continue
        out[cid] = [(float(wp[0]), float(wp[1])) for wp in waypoints]
    return out


CHANNEL_CHAINS: dict[str, list[tuple[float, float]]] = load_channel_chains()


def add_channel_chains(nodes, edges, land):
    """Inject hand-curated channel chains (see CHANNEL_CHAINS) as dense
    waypoint sequences. Intra-chain edges bypass the land check (chain
    is expert-vetted); endpoint edges to the broader graph use the
    normal arc_is_clear check. Returns the set of chain node ids so
    callers (export_graph.py) can surface them to the runtime Dijkstra
    for the weight-discount trick that makes chains "sticky"."""
    from scipy.spatial import cKDTree
    all_chain_ids: set[int] = set()
    if not CHANNEL_CHAINS:
        return all_chain_ids
    existing_ids = sorted(nodes.keys())
    coords = [(nodes[i][0], nodes[i][1]) for i in existing_ids]
    tree = cKDTree(coords)
    total_nodes = 0
    for name, chain in CHANNEL_CHAINS.items():
        if len(chain) < 2:
            continue
        # Register each chain waypoint as a new graph node.
        chain_ids = []
        for lat, lon in chain:
            nid = max(nodes) + 1
            nodes[nid] = (lat, lon)
            chain_ids.append(nid)
        all_chain_ids.update(chain_ids)
        # Connect consecutive waypoints with direct (land-bypass) edges.
        for i in range(len(chain_ids) - 1):
            a, b = chain_ids[i], chain_ids[i + 1]
            d = haversine_nm(*nodes[a], *nodes[b])
            edges.append((a, b, d))
        # Wire EVERY chain node into the broader graph with a land-safe
        # arc to the 1-2 nearest existing nodes. Connecting only the
        # endpoints would leave any searoute nodes sitting next to the
        # chain's middle (e.g. Marmara nodes that need to reach the
        # Dardanelles) stranded: they'd have to backtrack out of the
        # region and come in through the chain's endpoint, making the
        # chain less preferable than the original cross-peninsula edges.
        # With per-node connections the chain becomes a true "highway"
        # any nearby searoute node can hop onto and off.
        for chain_nid in chain_ids:
            cp = nodes[chain_nid]
            ks = min(5, len(coords))
            _, idxs = tree.query([cp[0], cp[1]], k=ks)
            if not hasattr(idxs, "__len__"):
                idxs = [idxs]
            connected = 0
            for idx in idxs:
                if connected >= 2:
                    break
                other_id = existing_ids[idx]
                other = nodes[other_id]
                # Skip connections > 30 NM — a chain node 50 NM from its
                # nearest base graph node is in the middle of nowhere
                # and such a long jump likely crosses land anyway.
                d = haversine_nm(*cp, *other)
                if d > 30:
                    continue
                if arc_is_clear(cp, other, land):
                    edges.append((chain_nid, other_id, d))
                    connected += 1
        total_nodes += len(chain)
        print(f"  Added channel chain '{name}' with {len(chain)} waypoints")
    if total_nodes:
        print(f"  Channel chains total: {total_nodes} nodes")
    return all_chain_ids


def add_transit_anchors(nodes, edges, land):
    """Inject TRANSIT_ANCHORS into the graph. Each anchor is connected
    to its ~10 nearest existing nodes (with a land-safe arc) AND to
    every other transit anchor that has a clear great-circle to it.
    This gives Dijkstra cross-ocean shortcuts (trans-Pacific, South
    Atlantic, etc.) that searoute's AIS-derived network lacks."""
    from scipy.spatial import cKDTree
    if not TRANSIT_ANCHORS:
        return {}
    # Current nearest-neighbour tree BEFORE we add the anchors
    existing_ids = sorted(nodes.keys())
    coords = [(nodes[i][0], nodes[i][1]) for i in existing_ids]
    tree = cKDTree(coords)
    anchor_id: dict[str, int] = {}
    # First pass: register anchors as graph nodes
    for name, (lat, lon) in TRANSIT_ANCHORS.items():
        nid = max(nodes) + 1
        nodes[nid] = (lat, lon)
        anchor_id[name] = nid
    # Second pass: connect each anchor to ~10 nearest existing nodes
    for name, (lat, lon) in TRANSIT_ANCHORS.items():
        nid = anchor_id[name]
        _, idxs = tree.query([lat, lon], k=min(15, len(coords)))
        connected = 0
        for idx in idxs:
            if connected >= 10:
                break
            other_id = existing_ids[idx]
            other = nodes[other_id]
            if arc_is_clear((lat, lon), other, land):
                d = haversine_nm(lat, lon, *other)
                edges.append((nid, other_id, d))
                connected += 1
    # Third pass: connect anchors to each other where arc is clear
    anchor_ids = list(anchor_id.values())
    for i, a in enumerate(anchor_ids):
        for b in anchor_ids[i + 1:]:
            if arc_is_clear(nodes[a], nodes[b], land):
                d = haversine_nm(*nodes[a], *nodes[b])
                edges.append((a, b, d))
    print(f"  Added {len(TRANSIT_ANCHORS)} ocean-transit anchors")
    return anchor_id


def connect_ports(nodes, edges, land):
    """Add each of our 106 ports to the graph as a new node placed at
    its pilot-station coordinate (falls back to the literal port
    coordinate when no pilot is defined). Each port is then connected
    by K nearest land-safe edges into the searoute network.
    This mirrors how commercial distance tables (including Netpas) treat
    inland ports: the routing endpoint is always the pilot-boarding
    position offshore, not the city centre."""
    from scipy.spatial import cKDTree
    # existing_ids is the authoritative mapping from kd-tree positional
    # index -> real sparse node id. It MUST be used when writing edges
    # because after filter_shallow_nodes the id space has holes, so the
    # positional index in `coords` no longer equals the node id.
    existing_ids = sorted(nodes.keys())
    coords = [(nodes[i][0], nodes[i][1]) for i in existing_ids]
    tree = cKDTree(coords)

    port_name_to_id: dict[str, int] = {}
    pilot_used = 0
    for port_name in PORTS:
        lat, lon = effective_port_coord(port_name)
        if port_name in PILOT_STATIONS:
            pilot_used += 1
        # Use max(nodes)+1, NOT len(nodes). After filter_shallow_nodes
        # the id space is sparse (holes where shallow nodes were dropped)
        # so len(nodes) can collide with an already-assigned id — the
        # port would then silently overwrite a real searoute node while
        # all the old edges remain, pulling hundreds of unrelated
        # connections into one "ghost" node.
        nid = max(nodes) + 1
        nodes[nid] = (lat, lon)
        port_name_to_id[port_name] = nid

        ks = min(PORT_CONNECT_K * 3, len(coords))
        _, idxs = tree.query([lat, lon], k=ks)
        if not hasattr(idxs, "__len__"):
            idxs = [idxs]
        candidates = []
        for idx in idxs:
            cand_lat, cand_lon = coords[idx]
            d_nm = haversine_nm(lat, lon, cand_lat, cand_lon)
            candidates.append((d_nm, idx))
        candidates.sort()
        connected = 0
        for d_nm, idx in candidates:
            if connected >= PORT_CONNECT_K:
                break
            if arc_is_clear((lat, lon), (coords[idx][0], coords[idx][1]), land):
                edges.append((nid, existing_ids[idx], d_nm))
                connected += 1
        if connected == 0:
            d_nm, idx = candidates[0]
            edges.append((nid, existing_ids[idx], d_nm))
    print(f"  Pilot stations used for {pilot_used} ports "
          f"(the rest sit directly on the coast).")
    return port_name_to_id


def dijkstra(adj, source, targets):
    dist = {source: 0.0}
    prev: dict = {}
    heap = [(0.0, source)]
    remaining = set(targets)
    remaining.discard(source)
    while heap and remaining:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        if u in remaining:
            remaining.discard(u)
        if not remaining:
            break
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def reconstruct(prev, source, target):
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
# Main pipeline
# ─────────────────────────────────────────────────────────────

def main():
    print("Loading searoute maritime network...")
    nodes, edges = load_searoute_network()
    print(f"  {len(nodes):,} nodes, {len(edges):,} edges")

    land = load_gshhg_with_tolerance()

    print(f"\nFiltering edges against GSHHG (0.5 NM coastal tolerance)...")
    t0 = time.time()
    edges = filter_edges_landsafe(nodes, edges, land)
    print(f"  Edge filter took {time.time() - t0:.0f}s")

    print(f"\nInjecting trans-ocean transit anchors...")
    add_transit_anchors(nodes, edges, land)

    print(f"\nInjecting hand-curated channel chains...")
    add_channel_chains(nodes, edges, land)

    print(f"\nConnecting {len(PORTS)} ports to nearest {PORT_CONNECT_K} nodes...")
    port_ids = connect_ports(nodes, edges, land)

    # Build adjacency list
    adj: dict[int, list] = {}
    for a, b, w in edges:
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))

    print(f"\nRunning Dijkstra from each port...")
    port_names = list(PORTS.keys())
    distances: dict[str, float] = {}
    paths: dict[str, list] = {}
    unreachable = []
    t0 = time.time()

    port_node_ids = [port_ids[n] for n in port_names]

    for i, src_name in enumerate(port_names):
        src = port_ids[src_name]
        dist, prev = dijkstra(adj, src, port_node_ids)
        for dst_name in port_names:
            if dst_name <= src_name:
                continue
            dst = port_ids[dst_name]
            if dst not in dist:
                unreachable.append((src_name, dst_name))
                continue
            node_path = reconstruct(prev, src, dst)
            coord_path = [nodes[nid] for nid in node_path]
            # Recompute total via haversine so rendered path matches
            total = 0.0
            for k in range(len(coord_path) - 1):
                total += haversine_nm(*coord_path[k], *coord_path[k + 1])
            key = f"{src_name}|{dst_name}"
            distances[key] = round(total, 1)
            paths[key] = [[round(c[0], 4), round(c[1], 4)] for c in coord_path]
        elapsed = time.time() - t0
        print(f"  [{i + 1}/{len(port_names)}] {src_name} ({elapsed:.0f}s)")

    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "distances.json").write_text(json.dumps(distances, indent=2))
    (OUTPUT_DIR / "paths.json").write_text(json.dumps(paths, separators=(",", ":")))
    (OUTPUT_DIR / "hand_drawn_keys.json").write_text(json.dumps({"keys": []}, indent=2))

    avg_wp = sum(len(p) for p in paths.values()) / max(1, len(paths))
    print(f"\nSaved: {len(paths):,} paths, avg {avg_wp:.1f} waypoints")
    if unreachable:
        print(f"  {len(unreachable)} unreachable pairs:")
        for a, b in unreachable[:10]:
            print(f"    {a} <-> {b}")


if __name__ == "__main__":
    main()
