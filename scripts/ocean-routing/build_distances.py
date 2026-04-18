"""
Ocean Graph Routing — Distance Calculator for Gasoline Trading Ports

Generates a maritime distance lookup table for 88 curated ports using:
1. Natural Earth 50m land polygons (coastline/land mask)
2. 0.1° water grid (~4.5M waypoints)
3. Forced routing through canals/straits (Suez, Kiel, Bosphorus, etc.)
4. Dijkstra shortest path from each port
5. Validation against PUB 151 known distances

Output: JSON lookup table { "PortA|PortB": distance_nm }
"""

import heapq
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Point, shape
from shapely.prepared import prep
from shapely import strtree

# ── Configuration ──────────────────────────────────────────────

GRID_STEP = 0.1  # degrees
NM_PER_DEGREE = 60  # 1 degree latitude ≈ 60 nautical miles
DATA_DIR = Path(__file__).parent / "data"
OUTPUT_DIR = Path(__file__).parent / "output"

# ── 88 Curated Gasoline Trading Ports ──────────────────────────
# Format: (name, display_code, lat, lon)
# Coordinates sourced from AtoBviaC / known positions

PORTS = [
    # ARA
    ("Amsterdam", "NL", 52.4075, 4.7856),
    ("Rotterdam", "NL", 51.9000, 4.4833),
    ("Antwerp", "BE", 51.2667, 4.3833),
    ("Flushing", "NL", 51.4500, 3.5833),
    ("Ghent", "BE", 51.0667, 3.7167),

    # Med
    ("Lavera", "FR", 43.3833, 4.9833),
    ("Marseille", "FR", 43.3000, 5.3667),
    ("Augusta", "IT", 37.2167, 15.2167),
    ("Barcelona", "ES", 41.3500, 2.1667),
    ("Agioi Theodoroi", "GR", 37.9167, 23.0833),
    ("Thessaloniki", "GR", 40.6167, 22.9333),
    ("Sarroch", "IT", 39.0667, 9.0167),
    ("Genoa", "IT", 44.4000, 8.9167),
    ("Naples", "IT", 40.8333, 14.2667),
    ("Algeciras", "ES", 36.1333, -5.4333),
    ("Cartagena", "ES", 37.5833, -0.9833),

    # North Africa / Med South
    ("Skikda", "DZ", 36.8833, 6.9000),
    ("Mohammedia", "MA", 33.7167, -7.3833),
    ("Alexandria", "EG", 31.1833, 29.8833),

    # Baltic / Northern Europe
    ("Ust-Luga", "RU", 59.6833, 28.3833),
    ("Primorsk", "RU", 60.3500, 28.6167),
    ("Sankt-Peterburg", "RU", 59.9333, 30.2000),
    ("Gothenburg", "SE", 57.7000, 11.9333),
    ("Ventspils", "LV", 57.4000, 21.5333),
    ("Gdansk", "PL", 54.4000, 18.6667),
    ("Brofjorden", "SE", 58.3500, 11.4333),

    # UK / Ireland
    ("Immingham", "GB", 53.6333, -0.2167),
    ("Milford Haven", "GB", 51.7000, -5.0500),
    ("Fawley", "GB", 50.8333, -1.3333),
    ("London", "GB", 51.5000, 0.0500),
    ("Belfast", "GB", 54.6000, -5.9167),

    # West Africa
    ("Lagos", "NG", 6.4333, 3.4000),
    ("Lome", "TG", 6.1333, 1.2833),
    ("Tema", "GH", 5.6333, -0.0167),
    ("Abidjan", "CI", 5.2667, -4.0167),
    ("Dakar", "SN", 14.6667, -17.4167),
    ("Cotonou", "BJ", 6.3500, 2.4333),

    # USA / Caribbean
    ("New York", "US", 40.6667, -74.0333),
    ("Philadelphia", "US", 39.9333, -75.1333),
    ("Baltimore", "US", 39.2667, -76.5833),
    ("Houston", "US", 29.7500, -95.0000),
    ("Corpus Christi", "US", 27.8000, -97.4000),
    ("Savannah", "US", 32.0833, -81.1000),

    # Middle East / Asia
    ("Fujairah", "AE", 25.1333, 56.3500),
    ("Jebel Ali", "AE", 25.0167, 55.0667),
    ("Singapore", "SG", 1.2667, 103.8333),
    ("Ruwais", "AE", 24.1000, 52.7167),

    # Other
    ("Gibraltar", "GI", 36.1333, -5.3500),
    ("Las Palmas", "ES", 28.1333, -15.4333),
    ("Constantza", "RO", 44.1667, 28.6500),

    # Med extra
    ("Tarragona", "ES", 41.1000, 1.2333),
    ("Castellon", "ES", 39.9667, -0.0167),
    ("Huelva", "ES", 37.2500, -6.9500),
    ("Sines", "PT", 37.9500, -8.8667),
    ("Koper", "SI", 45.5333, 13.7333),
    ("Split", "HR", 43.5000, 16.4333),

    # Black Sea
    ("Novorossiysk", "RU", 44.7167, 37.7667),
    ("Tuapse", "RU", 44.1000, 39.0667),

    # Baltic extra
    ("Tallinn", "EE", 59.4500, 24.7500),
    ("Klaipeda", "LT", 55.7167, 21.1000),
    ("Porvoo", "FI", 60.3000, 25.6500),

    # NW Europe extra
    ("Le Havre", "FR", 49.4833, 0.1000),
    ("Dunkirk", "FR", 51.0500, 2.3667),
    ("Hamburg", "DE", 53.5333, 9.9667),

    # UK extra
    ("Grangemouth", "GB", 56.0333, -3.7000),
    ("Teesport", "GB", 54.6167, -1.1667),
    ("Pembroke", "GB", 51.6833, -4.9500),

    # West Africa extra
    ("Monrovia", "LR", 6.3500, -10.8000),
    ("Freetown", "SL", 8.4833, -13.2333),

    # Caribbean / Americas extra
    ("Aruba", "AW", 12.4500, -69.9667),
    ("Curacao", "CW", 12.1833, -68.9667),
    ("Point Lisas", "TT", 10.4000, -61.4667),
    ("St. Croix", "VI", 17.7000, -64.7333),
    ("Come-by-Chance", "CA", 47.8167, -54.0000),
    ("Point Tupper", "CA", 45.6167, -61.3667),

    # Middle East extra
    ("Yanbu", "SA", 24.0833, 38.0500),

    # Puerto Rico
    ("San Juan", "PR", 18.4500, -66.1000),
    ("Guayanilla", "PR", 17.9833, -66.7833),

    # India
    ("Sikka", "IN", 22.4333, 69.8333),

    # East Africa
    ("Mombasa", "KE", -4.0667, 39.6667),

    # USA West Coast
    ("Los Angeles", "US", 33.7333, -118.2667),

    # South Africa
    ("Cape Town", "ZA", -33.9000, 18.4333),

    # USA East Coast extra
    ("Portland", "US", 43.6567, -70.2500),    # Portland, Maine
    ("Boston", "US", 42.3500, -71.0500),
    ("Norfolk", "US", 36.8500, -76.3000),
    ("Wilmington", "US", 34.2333, -77.9500),  # Wilmington, NC
    ("Halifax", "CA", 44.6333, -63.5667),
    ("San Francisco", "US", 37.7750, -122.4183),

    # Bermuda
    ("Hamilton", "BM", 32.2833, -64.7833),

    # Europe extra
    ("Aveiro", "PT", 40.6333, -8.7500),
    ("Bilbao", "ES", 43.3500, -3.0333),
    ("Falmouth", "GB", 50.1500, -5.0667),
    ("Thames", "GB", 51.4500, 0.7333),        # Thames estuary
    ("Skaw", "DK", 57.7333, 10.5833),         # Skagen
    ("Mongstad", "NO", 60.8167, 5.0333),

    # Med extra 2
    ("Algiers", "DZ", 36.7667, 3.0667),
    ("Benghazi", "LY", 32.1167, 20.0667),
    ("Beirut", "LB", 33.9000, 35.5167),
    ("Aliaga", "TR", 38.8000, 26.9667),
    ("Izmit", "TR", 40.7667, 29.9167),
    ("Vassiliko", "CY", 34.7333, 33.3333),
    ("Ceuta", "ES", 35.8833, -5.3167),

    # South America
    ("La Libertad", "EC", -2.2167, -80.9167),

    # Canada - St. Lawrence
    ("Quebec", "CA", 46.8167, -71.2000),
    ("Montreal", "CA", 45.5000, -73.5500),

    # Ireland
    ("Dublin", "IE", 53.3500, -6.2333),
]


# ── Strait / Canal Waypoints ───────────────────────────────────
# These force routing through narrow passages instead of around continents.
# Each is a sequence of (lat, lon) waypoints that must be traversed.

STRAITS = {
    "gibraltar": [
        (35.9667, -5.6000),  # West approach
        (35.9667, -5.3500),  # Strait center
        (36.0500, -5.1000),  # East approach
    ],
    "suez": [
        (31.2667, 32.3167),  # Port Said approach
        (30.8000, 32.3167),  # Canal upper
        (30.4500, 32.3500),  # Canal mid
        (30.1000, 32.4500),  # Canal lower
        (29.9333, 32.5500),  # Suez south end
    ],
    "bosphorus": [
        (41.2167, 29.1167),  # North (Black Sea) approach
        (41.1500, 29.0833),  # North strait
        (41.0667, 29.0500),  # Mid strait
        (41.0000, 29.0000),  # South strait
        (40.9500, 28.9833),  # Marmara approach
    ],
    "dardanelles": [
        (40.0667, 26.1833),  # Aegean approach
        (40.1333, 26.3000),  # West strait
        (40.2000, 26.4000),  # Mid strait
        (40.2667, 26.5000),  # East strait
        (40.3500, 26.6500),  # Marmara approach
    ],
    "marmara": [
        # Connect Dardanelles to Bosphorus through Sea of Marmara
        (40.3500, 26.6500),  # East Dardanelles
        (40.6000, 27.5000),  # Mid Marmara
        (40.7333, 28.5000),  # East Marmara
        (40.7333, 29.0000),  # Izmit Bay west
        (40.7500, 29.5000),  # Izmit Bay mid
        (40.7667, 29.9000),  # Izmit Bay east (Izmit port)
        (40.9500, 28.9833),  # West Bosphorus
    ],
    "messina": [
        # Strait of Messina (very narrow, ~3km)
        (38.3000, 15.6000),  # South approach
        (38.2000, 15.6333),  # Strait center
        (38.1000, 15.6500),  # North approach (Sicilian side)
    ],
    "otranto": [
        # Strait of Otranto (Adriatic entrance)
        (40.0000, 19.0000),  # Albania side
        (39.8000, 18.8000),  # Mid strait
    ],
    "kiel": [
        (54.3667, 10.1500),  # Baltic (Kiel) end
        (54.2500, 9.8000),   # Canal east
        (54.1000, 9.5000),   # Canal mid
        (54.0000, 9.4000),   # Canal west
        (53.8833, 9.1333),   # North Sea (Brunsbuttel) end
    ],
    "dover": [
        (51.0000, 1.5000),   # Channel center
        (50.9000, 1.2000),   # Southwest
    ],
    "skagerrak": [
        (57.7500, 10.5000),  # Skagerrak center
        (57.5000, 9.5000),   # West Skagerrak
    ],
    "english_channel_west": [
        (49.5000, -3.0000),  # Western Channel approach
        (49.8000, -2.0000),  # Mid west
        (50.0000, -1.0000),  # Mid Channel
        (50.5000, 0.0000),   # East approach
    ],
    "malacca": [
        (1.2667, 103.5500),   # East (Singapore) end
        (2.0000, 102.5000),   # East strait
        (2.5000, 101.5000),   # Mid strait
        (4.0000, 99.5000),    # West strait
        (5.5000, 98.0000),    # West (Andaman) end
    ],
    "bab_el_mandeb": [
        (12.6000, 43.3000),   # Strait center
        (12.4000, 43.5000),   # East approach
    ],
    "hormuz": [
        (26.5000, 56.2500),   # Strait center
        (26.2000, 56.5000),   # East approach
    ],
    # West African coastal waypoints — offshore shipping lane
    "west_africa_north": [
        (33.5000, -8.0000),   # Casablanca offshore
        (28.0000, -14.0000),  # Canaries approach
        (22.0000, -17.5000),  # Western Sahara coast
        (17.0000, -17.5000),  # Mauritania coast
        (14.7000, -17.5000),  # Dakar offshore
    ],
    "west_africa_south": [
        (14.7000, -17.5000),  # Dakar offshore
        (12.0000, -17.5000),  # Gambia offshore
        (9.5000, -15.0000),   # Guinea offshore
        (7.5000, -13.0000),   # Sierra Leone offshore
        (6.0000, -10.5000),   # Liberia offshore
        (5.0000, -7.0000),    # Cote d'Ivoire west offshore
        (4.5000, -4.0000),    # Cote d'Ivoire offshore (Abidjan)
        (4.5000, -1.5000),    # Ghana west offshore
        (4.5000, 0.0000),     # Ghana offshore (Tema)
        (5.0000, 1.0000),     # East Ghana
        (5.5000, 1.5000),     # Togo offshore
        (5.5000, 2.5000),     # Benin offshore
        (5.8000, 3.5000),     # Lagos offshore
        (4.0000, 5.0000),     # Niger Delta offshore
        (3.0000, 7.0000),     # Gulf of Guinea
        (2.0000, 8.5000),     # Equatorial Guinea offshore
    ],
    # Aegean Sea waypoints for better Greek islands routing
    "aegean": [
        (37.5000, 23.5000),  # Saronic Gulf
        (37.5000, 24.5000),  # Central Aegean south
        (38.0000, 24.0000),  # Central Aegean
        (38.5000, 24.5000),  # Mid Aegean
        (39.0000, 24.0000),  # North Aegean south
        (39.5000, 24.5000),  # North Aegean
        (40.0000, 24.0000),  # North Aegean north
        (40.3000, 23.5000),  # Thessaloniki approach south
        (40.5000, 23.0000),  # Thermaikos Gulf approach
    ],
    # St. Lawrence Seaway (Quebec/Montreal access)
    "st_lawrence": [
        (48.5000, -58.0000),  # Gulf entrance (Cabot Strait)
        (48.8000, -60.0000),  # Gulf of St. Lawrence
        (49.0000, -62.0000),  # Mid gulf
        (48.8000, -64.0000),  # West gulf
        (48.5000, -66.0000),  # Riviere-du-Loup
        (47.5000, -68.0000),  # Rimouski
        (47.0000, -70.5000),  # Quebec approach
        (46.8000, -71.2000),  # Quebec
        (46.0000, -72.5000),  # Trois-Rivieres
        (45.5000, -73.5000),  # Montreal
    ],
    # Adriatic Sea waypoints
    "adriatic": [
        (39.5000, 19.5000),  # South Adriatic
        (40.5000, 18.5000),  # Mid Adriatic south
        (41.5000, 17.0000),  # Mid Adriatic
        (42.5000, 16.0000),  # Mid Adriatic north
        (43.5000, 15.0000),  # North Adriatic south
        (44.5000, 14.0000),  # North Adriatic
        (45.0000, 13.5000),  # Koper approach
    ],
}


# ── Helper Functions ───────────────────────────────────────────

def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nautical miles."""
    r = 3440.065  # Earth radius in NM
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def load_land_polygons():
    """Load Natural Earth 50m land polygons using shapely."""
    shp_path = DATA_DIR / "ne_land" / "ne_50m_land.shp"
    print(f"Loading land polygons from {shp_path}...")

    # Read shapefile using shapely
    import shapefile  # pyshp
    sf = shapefile.Reader(str(shp_path))
    polygons = []
    for sr in sf.shapeRecords():
        geom = shape(sr.shape.__geo_interface__)
        polygons.append(geom)

    from shapely.ops import unary_union
    land = unary_union(polygons)
    print(f"  Loaded {len(polygons)} land polygons, merged into unified geometry")
    return land


def build_water_grid(land_prep, step: float = GRID_STEP):
    """
    Build a grid of water points at given resolution.
    Returns: dict mapping (lat_idx, lon_idx) -> (lat, lon) for water cells.
    """
    print(f"Building water grid at {step}° resolution...")

    # Grid dimensions
    lat_min, lat_max = -78.0, 84.0  # Skip extreme polar regions
    lon_min, lon_max = -180.0, 180.0

    lats = np.arange(lat_min, lat_max + step, step)
    lons = np.arange(lon_min, lon_max + step, step)
    n_lats = len(lats)
    n_lons = len(lons)
    total = n_lats * n_lons

    print(f"  Grid: {n_lats} x {n_lons} = {total:,} total cells")

    # Batch point-in-polygon test
    # Create all points at once for efficiency
    water_mask = np.zeros((n_lats, n_lons), dtype=bool)

    batch_size = 5000
    points_checked = 0
    water_count = 0

    t0 = time.time()
    for i, lat in enumerate(lats):
        row_points = [Point(lon, lat) for lon in lons]
        for j, pt in enumerate(row_points):
            if not land_prep.contains(pt):
                water_mask[i, j] = True
                water_count += 1
        points_checked += n_lons

        if (i + 1) % 100 == 0:
            elapsed = time.time() - t0
            pct = points_checked / total * 100
            rate = points_checked / elapsed if elapsed > 0 else 0
            eta = (total - points_checked) / rate if rate > 0 else 0
            print(f"  {pct:.1f}% done, {water_count:,} water cells, "
                  f"{rate:.0f} pts/sec, ETA {eta:.0f}s")

    elapsed = time.time() - t0
    print(f"  Grid complete: {water_count:,} water cells in {elapsed:.1f}s")

    return water_mask, lats, lons


def snap_to_grid(lat: float, lon: float, lats: np.ndarray, lons: np.ndarray,
                 water_mask: np.ndarray, search_radius: int = 5):
    """Snap a port coordinate to the nearest water grid cell."""
    lat_idx = int(round((lat - lats[0]) / GRID_STEP))
    lon_idx = int(round((lon - lons[0]) / GRID_STEP))

    # Clamp
    lat_idx = max(0, min(lat_idx, len(lats) - 1))
    lon_idx = max(0, min(lon_idx, len(lons) - 1))

    # If already on water, done
    if water_mask[lat_idx, lon_idx]:
        return lat_idx, lon_idx

    # Search nearby for water cell
    for r in range(1, search_radius + 1):
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                ni, nj = lat_idx + di, lon_idx + dj
                if 0 <= ni < len(lats) and 0 <= nj < len(lons):
                    if water_mask[ni, nj]:
                        return ni, nj

    # Expand search significantly for ports in rivers/channels
    for r in range(search_radius + 1, 30):
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                if abs(di) == r or abs(dj) == r:  # Only check border of square
                    ni, nj = lat_idx + di, lon_idx + dj
                    if 0 <= ni < len(lats) and 0 <= nj < len(lons):
                        if water_mask[ni, nj]:
                            return ni, nj

    print(f"  WARNING: Could not snap ({lat}, {lon}) to water!")
    return lat_idx, lon_idx


def build_graph_edges(water_mask: np.ndarray, lats: np.ndarray, lons: np.ndarray):
    """
    Build adjacency for the water grid. Each water cell connects to its
    8 neighbours (N/S/E/W + diagonals) with haversine distance weights.
    """
    n_lats, n_lons = water_mask.shape
    print(f"Building graph edges for {water_mask.sum():,} water cells...")

    # Encode (lat_idx, lon_idx) -> flat index for compact storage
    # Only water cells get an index
    cell_to_node = {}
    node_to_cell = []
    idx = 0
    for i in range(n_lats):
        for j in range(n_lons):
            if water_mask[i, j]:
                cell_to_node[(i, j)] = idx
                node_to_cell.append((i, j))
                idx += 1

    n_nodes = len(node_to_cell)
    print(f"  {n_nodes:,} water nodes indexed")

    # Build adjacency list
    # Neighbours: 8-connected grid
    directions = [(-1, -1), (-1, 0), (-1, 1),
                  (0, -1),           (0, 1),
                  (1, -1),  (1, 0),  (1, 1)]

    # Pre-compute edge weights (distance in NM)
    adjacency = [[] for _ in range(n_nodes)]

    t0 = time.time()
    edges = 0
    for node_idx in range(n_nodes):
        i, j = node_to_cell[node_idx]
        lat1 = lats[i]
        lon1 = lons[j]

        for di, dj in directions:
            ni, nj = i + di, j + dj
            # Handle longitude wrapping
            if nj < 0:
                nj += n_lons
            elif nj >= n_lons:
                nj -= n_lons

            if 0 <= ni < n_lats and (ni, nj) in cell_to_node:
                neighbor_idx = cell_to_node[(ni, nj)]
                lat2 = lats[ni]
                lon2 = lons[nj]
                dist = haversine_nm(lat1, lon1, lat2, lon2)
                adjacency[node_idx].append((neighbor_idx, dist))
                edges += 1

        if (node_idx + 1) % 500000 == 0:
            elapsed = time.time() - t0
            pct = (node_idx + 1) / n_nodes * 100
            print(f"  {pct:.1f}% edges built, {edges:,} total edges")

    elapsed = time.time() - t0
    print(f"  Graph complete: {n_nodes:,} nodes, {edges:,} edges in {elapsed:.1f}s")

    return adjacency, cell_to_node, node_to_cell


def add_strait_edges(adjacency, cell_to_node, node_to_cell, lats, lons, water_mask):
    """
    Add forced edges through straits/canals to ensure routing works.
    Each waypoint is:
    1. Snapped to nearest water grid cell (or forced to water)
    2. Connected to consecutive waypoints in the strait
    3. Connected to nearby water grid cells (radius) for graph connectivity
    """
    print("Adding strait/canal waypoint edges...")

    n_lats, n_lons = water_mask.shape
    directions = [(-1, -1), (-1, 0), (-1, 1),
                  (0, -1),           (0, 1),
                  (1, -1),  (1, 0),  (1, 1)]

    for strait_name, waypoints in STRAITS.items():
        nodes = []
        for wlat, wlon in waypoints:
            idx = snap_to_grid(wlat, wlon, lats, lons, water_mask, search_radius=10)
            if idx in cell_to_node:
                nodes.append(cell_to_node[idx])
            else:
                # Force this cell to be water and add to graph
                i, j = idx
                water_mask[i, j] = True
                new_node = len(node_to_cell)
                cell_to_node[idx] = new_node
                node_to_cell.append(idx)
                adjacency.append([])
                nodes.append(new_node)

                # Connect to all water neighbours within radius 3
                for r in range(1, 4):
                    for di in range(-r, r + 1):
                        for dj in range(-r, r + 1):
                            ni, nj = i + di, j + dj
                            if nj < 0: nj += n_lons
                            elif nj >= n_lons: nj -= n_lons
                            if 0 <= ni < n_lats and (ni, nj) in cell_to_node:
                                neighbor = cell_to_node[(ni, nj)]
                                dist = haversine_nm(lats[i], lons[j], lats[ni], lons[nj])
                                adjacency[new_node].append((neighbor, dist))
                                adjacency[neighbor].append((new_node, dist))

        # Connect consecutive waypoints with edges
        for a_node, b_node in zip(nodes[:-1], nodes[1:]):
            ai, aj = node_to_cell[a_node]
            bi, bj = node_to_cell[b_node]
            dist = haversine_nm(lats[ai], lons[aj], lats[bi], lons[bj])
            adjacency[a_node].append((b_node, dist))
            adjacency[b_node].append((a_node, dist))

        print(f"  {strait_name}: {len(nodes)} waypoints connected")

    return adjacency


def dijkstra(adjacency, source: int, targets: list[int]):
    """
    Dijkstra from source to all targets.
    Returns (found, parent) where:
      found  = {target_node: distance_nm}
      parent = {node: predecessor_node} — used to reconstruct paths.
    Stops early when all targets found.
    """
    n = len(adjacency)
    dist = [float('inf')] * n
    parent = {}
    dist[source] = 0
    heap = [(0, source)]
    found = {}
    target_set = set(targets)

    while heap and len(found) < len(target_set):
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue

        if u in target_set:
            found[u] = d

        for v, w in adjacency[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                parent[v] = u
                heapq.heappush(heap, (nd, v))

    return found, parent


def reconstruct_path(parent: dict, source: int, target: int) -> list[int]:
    """Walk parent chain back from target to source. Returns node list."""
    if target == source:
        return [source]
    path = [target]
    cur = target
    while cur in parent:
        cur = parent[cur]
        path.append(cur)
        if cur == source:
            break
    path.reverse()
    return path


def perpendicular_distance(point, line_start, line_end):
    """Perpendicular distance from point to line segment (for Douglas-Peucker)."""
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5
    t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
    t = max(0, min(1, t))
    px = x1 + t * dx
    py = y1 + t * dy
    return ((x0 - px) ** 2 + (y0 - py) ** 2) ** 0.5


def chaikin_smooth(points: list, iterations: int = 2) -> list:
    """
    Chaikin corner-cutting: each iteration replaces every corner with two
    points at 1/4 and 3/4 along neighbouring segments. Produces visually
    smooth curves that closely approximate a B-spline while staying inside
    the convex hull of the original path — so existing water-side waypoints
    keep the curve in water by construction.
    """
    if len(points) < 3:
        return points
    for _ in range(iterations):
        if len(points) < 3:
            break
        new_points = [points[0]]
        for i in range(len(points) - 1):
            p0 = points[i]
            p1 = points[i + 1]
            q = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]
            r = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]
            new_points.append(q)
            new_points.append(r)
        new_points.append(points[-1])
        points = new_points
    return points


def segment_crosses_land(p1, p2, land_prep) -> bool:
    """True if the straight line between two [lat, lon] points crosses land."""
    from shapely.geometry import LineString
    line = LineString([(p1[1], p1[0]), (p2[1], p2[0])])
    return land_prep.intersects(line)


def repair_land_crossings(simplified: list, raw: list, land_prep) -> list:
    """
    Walk the simplified path; for every segment that crosses land, replace
    the segment with the subset of raw waypoints between those two endpoints
    (which by construction don't cross land since they come from the
    water-only grid).

    We find each simplified point in the raw sequence by proximity — the
    simplified points came from `raw` via Douglas-Peucker so each one is
    either identical to a raw point or close enough to uniquely identify it.
    """
    if len(simplified) < 2 or len(raw) < 2:
        return simplified

    # Map each simplified point to its index in raw (closest match)
    raw_indices = []
    search_start = 0
    for sp in simplified:
        best_idx = search_start
        best_d = float('inf')
        for i in range(search_start, len(raw)):
            d = (raw[i][0] - sp[0]) ** 2 + (raw[i][1] - sp[1]) ** 2
            if d < best_d:
                best_d = d
                best_idx = i
        raw_indices.append(best_idx)
        search_start = best_idx

    result = [simplified[0]]
    for i in range(len(simplified) - 1):
        p1 = simplified[i]
        p2 = simplified[i + 1]
        if segment_crosses_land(p1, p2, land_prep):
            # Reinsert raw waypoints between these two anchors
            a, b = raw_indices[i], raw_indices[i + 1]
            if a < b:
                for j in range(a + 1, b):
                    result.append(raw[j])
            elif a > b:
                for j in range(a - 1, b, -1):
                    result.append(raw[j])
        result.append(p2)
    return result


def land_safe_simplify(points: list, land_prep, max_depth: int = 30) -> list:
    """
    Simplify a polyline by keeping only waypoints necessary to avoid land.

    Modified Douglas-Peucker: instead of checking "perpendicular distance >
    tolerance", we check "does this shortcut cross land?". If the direct
    segment from start to end is land-free, we keep only those two points.
    Otherwise we split at the point farthest from the straight line and
    recurse on each half.

    This produces the shortest possible visual representation that doesn't
    cross land — straight offshore segments stay straight, and waypoints
    are only kept where geography forces them (around peninsulas, through
    straits, etc.). Because we work from a raw grid path that is entirely
    in water, every sub-segment we preserve is also in water.
    """
    if len(points) < 3 or max_depth <= 0:
        return points

    # If the straight shortcut from first to last doesn't cross land, use it
    if not segment_crosses_land(points[0], points[-1], land_prep):
        return [points[0], points[-1]]

    # Otherwise split at the point farthest from the shortcut and recurse
    max_dist = 0.0
    max_idx = len(points) // 2  # fallback
    for i in range(1, len(points) - 1):
        d = perpendicular_distance(points[i], points[0], points[-1])
        if d > max_dist:
            max_dist = d
            max_idx = i

    left = land_safe_simplify(points[: max_idx + 1], land_prep, max_depth - 1)
    right = land_safe_simplify(points[max_idx:], land_prep, max_depth - 1)
    return left[:-1] + right


def douglas_peucker(points: list, tolerance: float) -> list:
    """
    Simplify a polyline using Douglas-Peucker.
    Keeps points that deviate more than `tolerance` (in degrees) from the
    simplified line. Works directly on [lat, lon] pairs — good enough for
    visualization at this scale.
    """
    if len(points) < 3:
        return points

    # Find the point with max distance from the line between first and last
    max_dist = 0
    max_idx = 0
    for i in range(1, len(points) - 1):
        d = perpendicular_distance(points[i], points[0], points[-1])
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > tolerance:
        left = douglas_peucker(points[: max_idx + 1], tolerance)
        right = douglas_peucker(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]


def run():
    """Main pipeline."""
    print("=" * 60)
    print("Ocean Graph Routing — Distance Calculator")
    print("=" * 60)

    # Step 1: Load land polygons
    try:
        land = load_land_polygons()
    except ImportError:
        print("\nNeed pyshp: pip install pyshp")
        sys.exit(1)

    land_prep = prep(land)

    # Step 2: Build water grid
    water_mask, lats, lons = build_water_grid(land_prep)

    # Step 3: Snap ports to grid
    print("\nSnapping ports to water grid...")
    port_nodes = {}
    for name, code, lat, lon in PORTS:
        key = f"{name}, {code}"
        grid_idx = snap_to_grid(lat, lon, lats, lons, water_mask)
        port_nodes[key] = grid_idx
        glat, glon = lats[grid_idx[0]], lons[grid_idx[1]]
        offset = haversine_nm(lat, lon, glat, glon)
        if offset > 5:
            print(f"  WARNING {key}: snapped {offset:.1f} NM from actual position")

    # Step 4: Build graph
    adjacency, cell_to_node, node_to_cell = build_graph_edges(
        water_mask, lats, lons
    )

    # Step 5: Add strait edges
    adjacency = add_strait_edges(
        adjacency, cell_to_node, node_to_cell, lats, lons, water_mask
    )

    # Map port names to node indices
    port_node_ids = {}
    for key, grid_idx in port_nodes.items():
        if grid_idx in cell_to_node:
            port_node_ids[key] = cell_to_node[grid_idx]
        else:
            print(f"  WARNING {key}: grid cell not in graph!")

    # Step 6: Run Dijkstra from each port
    print(f"\nRunning Dijkstra from {len(port_node_ids)} ports...")
    all_targets = list(port_node_ids.values())
    port_names = list(port_node_ids.keys())
    distances = {}
    paths = {}

    t0 = time.time()
    for i, (name, node) in enumerate(port_node_ids.items()):
        d, parent = dijkstra(adjacency, node, all_targets)
        for other_name, other_node in port_node_ids.items():
            if other_name <= name:
                continue  # Only store one direction
            if other_node in d:
                key = f"{name}|{other_name}"

                # Reconstruct path in node indices, then convert to [lat, lon]
                node_path = reconstruct_path(parent, node, other_node)
                coord_path = []
                for nd in node_path:
                    cell = node_to_cell[nd]
                    lat = lats[cell[0]]
                    lon = lons[cell[1]]
                    coord_path.append([round(lat, 4), round(lon, 4)])

                # Report haversine distance summed over the raw grid path
                # — same approach as before, this is what keeps ETA honest.
                true_dist = 0.0
                for k in range(len(coord_path) - 1):
                    true_dist += haversine_nm(
                        coord_path[k][0], coord_path[k][1],
                        coord_path[k + 1][0], coord_path[k + 1][1],
                    )
                distances[key] = round(true_dist, 1)

                # Land-safe simplification: keep only the waypoints needed
                # to avoid land. Straight offshore segments stay straight
                # (no 0.1° grid zigzag). Waypoints are preserved only
                # around peninsulas and through straits where geography
                # forces bends. Great-circle rendering on the client
                # handles the curvature of long segments on the globe.
                simplified = land_safe_simplify(coord_path, land_prep)
                simplified = [[round(p[0], 4), round(p[1], 4)] for p in simplified]
                paths[key] = simplified

        elapsed = time.time() - t0
        eta = elapsed / (i + 1) * (len(port_node_ids) - i - 1) if i > 0 else 0
        print(f"  [{i+1}/{len(port_node_ids)}] {name} done "
              f"({elapsed:.0f}s elapsed, ETA {eta:.0f}s)")

    total_time = time.time() - t0
    print(f"\nAll distances computed in {total_time:.0f}s")
    print(f"Total pairs: {len(distances):,}")
    print(f"Total paths: {len(paths):,}")

    # Step 6b: Apply hand-drawn route overrides
    # ------------------------------------------------------------
    # For common trade lanes where grid-Dijkstra produces visually
    # unrealistic paths (e.g. coastal hugging on transatlantic routes),
    # we override with curated waypoint lists from hand_drawn_routes.json.
    # These reflect real shipping-lane conventions — offshore safety
    # margin, standard approaches to straits, etc.
    #
    # Distance is computed from haversine over the hand-drawn waypoints
    # so ETA stays honest (no manual distance entry).
    hand_drawn_path = Path(__file__).parent / "hand_drawn_routes.json"
    hand_drawn_keys = []
    if hand_drawn_path.exists():
        with open(hand_drawn_path) as f:
            hand_drawn = json.load(f)

        applied = 0
        for key, entry in hand_drawn.items():
            if key.startswith("_"):
                continue  # skip metadata
            wps = entry.get("waypoints")
            if not wps or len(wps) < 2:
                continue

            # Validate key: must be alphabetically sorted "A|B" with A < B
            parts = key.split("|")
            if len(parts) != 2 or parts[0] >= parts[1]:
                print(f"  WARNING: hand-drawn key '{key}' not alphabetically sorted — skipping")
                continue

            # Compute haversine distance over the hand-drawn path
            total_nm = 0.0
            for k in range(len(wps) - 1):
                total_nm += haversine_nm(wps[k][0], wps[k][1],
                                          wps[k+1][0], wps[k+1][1])

            distances[key] = round(total_nm, 1)
            paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in wps]
            hand_drawn_keys.append(key)
            applied += 1

        print(f"\nApplied {applied} hand-drawn route override(s)")
    else:
        print(f"\nNo hand_drawn_routes.json found — all routes use grid Dijkstra")

    # Save list of hand-drawn keys for the client to recognise
    hand_drawn_keys.sort()
    keys_path = OUTPUT_DIR / "hand_drawn_keys.json"
    with open(keys_path, "w") as f:
        json.dump({"keys": hand_drawn_keys}, f, indent=2)

    # Step 6c: Post-process river ports
    # Montreal is ~150 NM upriver from Quebec on the St. Lawrence
    # If grid can't route there, derive Montreal distances from Quebec + 150 NM
    RIVER_PORTS = {
        "Montreal, CA": ("Quebec, CA", 150),
    }
    # Montreal coordinates (for path extension)
    MONTREAL_COORDS = [45.5017, -73.5673]
    QUEBEC_COORDS = [46.8139, -71.2080]

    for river_port, (base_port, river_nm) in RIVER_PORTS.items():
        # Check if Montreal already has distances
        has_distances = any(
            river_port in k for k in distances.keys()
        )
        if not has_distances:
            print(f"\n  Deriving {river_port} distances from {base_port} + {river_nm} NM")
            added = 0
            for key, dist in list(distances.items()):
                parts = key.split("|")
                if base_port in parts:
                    other = parts[1] if parts[0] == base_port else parts[0]
                    if other == river_port:
                        continue
                    new_key = f"{min(river_port, other)}|{max(river_port, other)}"
                    distances[new_key] = round(dist + river_nm, 1)
                    added += 1

                    # Extend path: base_port's path to `other` + river segment to Montreal
                    if key in paths:
                        base_path = paths[key]
                        # Determine orientation: path starts at parts[0]
                        if parts[0] == base_port:
                            # base_port -> other; prepend Montreal
                            new_path = [MONTREAL_COORDS] + base_path
                        else:
                            # other -> base_port; append Montreal
                            new_path = base_path + [MONTREAL_COORDS]

                        # Normalize direction: path should go from min(key) to max(key)
                        # new_key is f"{min}|{max}", new_path currently goes
                        # from Montreal side toward `other`, need to check.
                        if new_key.split("|")[0] == river_port:
                            # Path should start with Montreal — already does on the prepend branch
                            if parts[0] != base_port:
                                new_path = list(reversed(new_path))
                        else:
                            # Path should end with Montreal
                            if parts[0] == base_port:
                                new_path = list(reversed(new_path))

                        paths[new_key] = new_path

            # Add the river_port <-> base_port path + distance
            pair = f"{min(river_port, base_port)}|{max(river_port, base_port)}"
            distances[pair] = river_nm
            # Direct path: Quebec <-> Montreal (simple 2-point line; real route is upriver)
            if pair.split("|")[0] == river_port:
                paths[pair] = [MONTREAL_COORDS, QUEBEC_COORDS]
            else:
                paths[pair] = [QUEBEC_COORDS, MONTREAL_COORDS]
            added += 1
            print(f"  Added {added} distances for {river_port}")

    # Step 7: Save results
    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = OUTPUT_DIR / "distances.json"
    with open(output_path, "w") as f:
        json.dump(distances, f, indent=2)
    print(f"\nSaved distances to {output_path}")

    # Save paths (compact — no indent, to keep file size down)
    paths_path = OUTPUT_DIR / "paths.json"
    with open(paths_path, "w") as f:
        json.dump(paths, f, separators=(",", ":"))
    size_mb = paths_path.stat().st_size / 1024 / 1024
    total_waypoints = sum(len(p) for p in paths.values())
    print(f"Saved paths to {paths_path} ({size_mb:.1f} MB, "
          f"{total_waypoints:,} waypoints, avg {total_waypoints // max(1, len(paths))}/path)")

    # Step 8: Validate against known PUB 151 distances
    validate(distances)

    return distances


# ── PUB 151 Validation ─────────────────────────────────────────

PUB151_KNOWN = {
    # Netpas-verified distances (more accurate than PUB 151)
    ("Amsterdam, NL", "Thessaloniki, GR"): 3170,   # Netpas verified
    ("Gibraltar, GI", "Lagos, NG"): 3176,           # Netpas verified
    ("Rotterdam, NL", "Houston, US"): 5022,         # Netpas verified
    # PUB 151 distances (still good for many routes)
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
}


def validate(distances: dict):
    """Compare computed distances against PUB 151 known values."""
    print("\n" + "=" * 60)
    print("Validation against PUB 151")
    print("=" * 60)
    print(f"{'Route':<45} {'PUB151':>7} {'Computed':>8} {'Diff':>6} {'%Err':>6}")
    print("-" * 75)

    errors = []
    for (port_a, port_b), pub_dist in PUB151_KNOWN.items():
        # Try both key orders
        key1 = f"{port_a}|{port_b}"
        key2 = f"{port_b}|{port_a}"
        computed = distances.get(key1) or distances.get(key2)

        if computed is None:
            print(f"  {port_a} → {port_b}: NOT FOUND")
            continue

        diff = computed - pub_dist
        pct = diff / pub_dist * 100
        errors.append(abs(pct))

        marker = "OK" if abs(pct) < 5 else "WARN" if abs(pct) < 10 else "BAD"
        route = f"{port_a} -> {port_b}"
        print(f"{marker} {route:<43} {pub_dist:>7} {computed:>8.0f} {diff:>+6.0f} {pct:>+5.1f}%")

    if errors:
        avg = sum(errors) / len(errors)
        print(f"\nMean absolute error: {avg:.1f}%")
        print(f"Max error: {max(errors):.1f}%")
        within_5 = sum(1 for e in errors if e < 5) / len(errors) * 100
        print(f"Within 5%: {within_5:.0f}% of routes")


if __name__ == "__main__":
    run()
