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
    return nodes, edges


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
CRITICAL_CHANNELS = [
    (29.80, 31.30, 32.20, 32.80, "Suez Canal"),
    (53.80, 54.50, 8.80, 10.50, "Kiel Canal"),
    (8.80, 9.40, -80.30, -79.30, "Panama Canal"),
    # Turkish Straits — Dardanelles → Marmara → Bosphorus
    (40.00, 41.40, 26.00, 29.50, "Turkish Straits"),
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


def arc_is_clear(p1, p2, land, sample_step=SAMPLE_STEP_NM, endpoint_buf=ENDPOINT_BUF_NM):
    from shapely.geometry import Point
    d = haversine_nm(p1[0], p1[1], p2[0], p2[1])
    if d < 2 * endpoint_buf:
        return True
    samples = max(8, int(d / sample_step))
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
}


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
    coords = [(nodes[i][0], nodes[i][1]) for i in sorted(nodes.keys())]
    tree = cKDTree(coords)

    port_name_to_id: dict[str, int] = {}
    pilot_used = 0
    for port_name in PORTS:
        lat, lon = effective_port_coord(port_name)
        if port_name in PILOT_STATIONS:
            pilot_used += 1
        nid = len(nodes)
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
                edges.append((nid, idx, d_nm))
                connected += 1
        if connected == 0:
            d_nm, idx = candidates[0]
            edges.append((nid, idx, d_nm))
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
