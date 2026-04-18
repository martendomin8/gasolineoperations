"""
Compose ocean routes from hand-curated port approaches + ocean corridors.

Instead of running Dijkstra on a 0.1° water grid (which produces
coast-hugging zigzags), each port is assigned:
  - an ocean region (NE_ATLANTIC, MED_WEST, BALTIC, etc.)
  - a "gateway" offshore anchor point
  - an optional approach polyline (port → gateway)

Ocean corridors connect regions (Gibraltar, Atlantic crossing, Suez,
Panama etc.). For any port pair the composer:
  1. Looks up both regions
  2. Finds a corridor chain via BFS in the region graph
  3. Concatenates: approach(A) + gateway_A + corridors + gateway_B + approach(B).reverse
  4. Haversine-sums the polyline for distance

All data hand-curated; check_all_paths.py verifies no land crossings.
"""

import json
import math
from collections import deque
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
HAND_DRAWN_PATH = Path(__file__).parent / "hand_drawn_routes.json"


def haversine_nm(lat1, lon1, lat2, lon2):
    R_NM = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R_NM * math.asin(math.sqrt(a))


# ============================================================
# PORT DATA — 106 curated ports with region + gateway + approach
# ============================================================
# approach: [lat, lon] waypoints from port toward open water (gateway is last).
#           Use just port coord if the port is on open coast.
# gateway:  the offshore anchor where the ship joins ocean transit.
# region:   one of the ocean regions below.

PORTS = {
    # NE Atlantic — ARA, UK, Ireland, France Atlantic, Norway
    "Amsterdam, NL":   {"approach": [[52.37, 4.86], [52.45, 4.40]],                       "gateway": [52.60, 4.00], "region": "NE_ATLANTIC"},
    "Rotterdam, NL":   {"approach": [[51.90, 4.48], [51.95, 3.80]],                       "gateway": [52.00, 3.30], "region": "NE_ATLANTIC"},
    "Antwerp, BE":     {"approach": [[51.27, 4.38], [51.45, 3.55], [51.55, 3.00]],        "gateway": [51.70, 2.60], "region": "NE_ATLANTIC"},
    "Flushing, NL":    {"approach": [[51.45, 3.58]],                                      "gateway": [51.60, 3.00], "region": "NE_ATLANTIC"},
    "Ghent, BE":       {"approach": [[51.07, 3.72], [51.40, 3.60]],                       "gateway": [51.55, 3.10], "region": "NE_ATLANTIC"},
    "Le Havre, FR":    {"approach": [[49.48, 0.10]],                                      "gateway": [49.50, -0.50], "region": "NE_ATLANTIC"},
    "Dunkirk, FR":     {"approach": [[51.05, 2.37]],                                      "gateway": [51.15, 1.80], "region": "NE_ATLANTIC"},
    "Hamburg, DE":     {"approach": [[53.53, 9.97], [53.85, 8.70], [54.00, 8.00]],        "gateway": [54.10, 7.50], "region": "NE_ATLANTIC"},
    "Immingham, GB":   {"approach": [[53.63, -0.22], [53.60, 0.40]],                      "gateway": [53.60, 1.30], "region": "NE_ATLANTIC"},
    "Teesport, GB":    {"approach": [[54.62, -1.17]],                                     "gateway": [54.60, -0.50], "region": "NE_ATLANTIC"},
    "Grangemouth, GB": {"approach": [[56.03, -3.70], [56.10, -2.50], [56.20, -1.50]],     "gateway": [56.30, -1.00], "region": "NE_ATLANTIC"},
    "London, GB":      {"approach": [[51.50, 0.05], [51.48, 1.00]],                       "gateway": [51.50, 1.90], "region": "NE_ATLANTIC"},
    "Thames, GB":      {"approach": [[51.45, 0.73], [51.50, 1.30]],                       "gateway": [51.55, 1.90], "region": "NE_ATLANTIC"},
    "Fawley, GB":      {"approach": [[50.83, -1.33]],                                     "gateway": [50.55, -1.60], "region": "NE_ATLANTIC"},
    "Falmouth, GB":    {"approach": [[50.15, -5.07]],                                     "gateway": [49.90, -5.20], "region": "NE_ATLANTIC"},
    "Milford Haven, GB": {"approach": [[51.70, -5.05]],                                   "gateway": [51.50, -5.70], "region": "NE_ATLANTIC"},
    "Pembroke, GB":    {"approach": [[51.68, -4.95]],                                     "gateway": [51.50, -5.70], "region": "NE_ATLANTIC"},
    "Belfast, GB":     {"approach": [[54.60, -5.92], [54.70, -5.60]],                     "gateway": [54.90, -5.30], "region": "NE_ATLANTIC"},
    "Dublin, IE":      {"approach": [[53.35, -6.23]],                                     "gateway": [53.40, -5.60], "region": "NE_ATLANTIC"},
    "Bilbao, ES":      {"approach": [[43.35, -3.03]],                                     "gateway": [43.60, -3.20], "region": "IBERIA"},
    "Aveiro, PT":      {"approach": [[40.63, -8.75]],                                     "gateway": [40.60, -9.10], "region": "IBERIA"},
    "Sines, PT":       {"approach": [[37.95, -8.87]],                                     "gateway": [37.80, -9.30], "region": "IBERIA"},
    "Huelva, ES":      {"approach": [[37.25, -6.95]],                                     "gateway": [37.00, -7.10], "region": "IBERIA"},
    "Mongstad, NO":    {"approach": [[60.82, 5.03], [60.80, 4.70]],                       "gateway": [60.80, 4.00], "region": "NE_ATLANTIC"},
    "Skaw, DK":        {"approach": [[57.73, 10.58]],                                     "gateway": [57.80, 10.70], "region": "BALTIC"},
    "Brofjorden, SE":  {"approach": [[58.35, 11.43]],                                     "gateway": [58.40, 11.00], "region": "BALTIC"},
    "Gothenburg, SE":  {"approach": [[57.70, 11.93], [57.75, 11.50]],                     "gateway": [57.80, 11.20], "region": "BALTIC"},

    # Baltic
    "Ust-Luga, RU":    {"approach": [[59.68, 28.38], [59.70, 27.50]],                     "gateway": [59.70, 26.00], "region": "BALTIC"},
    "Primorsk, RU":    {"approach": [[60.35, 28.62], [60.20, 28.00]],                     "gateway": [59.90, 27.00], "region": "BALTIC"},
    "Sankt-Peterburg, RU": {"approach": [[59.93, 30.20], [59.90, 28.50]],                 "gateway": [59.80, 27.00], "region": "BALTIC"},
    "Tallinn, EE":     {"approach": [[59.45, 24.75], [59.50, 24.60]],                     "gateway": [59.55, 24.00], "region": "BALTIC"},
    "Porvoo, FI":      {"approach": [[60.30, 25.65], [60.00, 25.60]],                     "gateway": [59.80, 25.40], "region": "BALTIC"},
    "Ventspils, LV":   {"approach": [[57.40, 21.53]],                                     "gateway": [57.30, 21.20], "region": "BALTIC"},
    "Klaipeda, LT":    {"approach": [[55.72, 21.10]],                                     "gateway": [55.70, 20.70], "region": "BALTIC"},
    "Gdansk, PL":      {"approach": [[54.40, 18.67], [54.60, 18.90]],                     "gateway": [54.80, 19.00], "region": "BALTIC"},

    # Med West
    "Lavera, FR":      {"approach": [[43.38, 4.98]],                                      "gateway": [43.10, 5.00], "region": "MED_WEST"},
    "Marseille, FR":   {"approach": [[43.30, 5.37]],                                      "gateway": [43.10, 5.40], "region": "MED_WEST"},
    "Barcelona, ES":   {"approach": [[41.35, 2.17]],                                      "gateway": [41.20, 2.50], "region": "MED_WEST"},
    "Tarragona, ES":   {"approach": [[41.10, 1.23]],                                      "gateway": [40.90, 1.30], "region": "MED_WEST"},
    "Castellon, ES":   {"approach": [[39.97, -0.02]],                                     "gateway": [39.90, 0.30], "region": "MED_WEST"},
    "Cartagena, ES":   {"approach": [[37.58, -0.98]],                                     "gateway": [37.50, -0.70], "region": "MED_WEST"},
    "Algeciras, ES":   {"approach": [[36.13, -5.43]],                                     "gateway": [36.00, -5.30], "region": "MED_WEST"},
    "Ceuta, ES":       {"approach": [[35.88, -5.32]],                                     "gateway": [35.80, -5.20], "region": "MED_WEST"},
    "Gibraltar, GI":   {"approach": [[36.13, -5.35]],                                     "gateway": [36.00, -5.30], "region": "MED_WEST"},
    "Mohammedia, MA":  {"approach": [[33.72, -7.38]],                                     "gateway": [33.50, -7.70], "region": "IBERIA"},
    "Algiers, DZ":     {"approach": [[36.77, 3.07]],                                      "gateway": [36.90, 3.10], "region": "MED_WEST"},
    "Skikda, DZ":      {"approach": [[36.88, 6.90]],                                      "gateway": [37.10, 6.90], "region": "MED_WEST"},
    "Genoa, IT":       {"approach": [[44.40, 8.92]],                                      "gateway": [44.20, 8.80], "region": "MED_WEST"},
    "Sarroch, IT":     {"approach": [[39.07, 9.02]],                                      "gateway": [38.80, 9.00], "region": "MED_WEST"},
    # Naples: approach via Bocche di Bonifacio south (west of Italy mainland)
    "Naples, IT":      {"approach": [[40.83, 14.27], [40.20, 13.80], [39.50, 12.80]],     "gateway": [39.00, 11.50], "region": "MED_WEST"},
    # Augusta (Sicily east): loop south of Sicily into the Sicilian Channel
    "Augusta, IT":     {"approach": [[37.22, 15.22], [36.80, 15.20], [36.30, 14.70]],     "gateway": [36.00, 13.50], "region": "MED_WEST"},
    "Benghazi, LY":    {"approach": [[32.12, 20.07]],                                     "gateway": [32.30, 20.00], "region": "MED_WEST"},

    # Med East / Aegean
    "Thessaloniki, GR":{"approach": [[40.62, 22.93], [40.10, 22.80]],                     "gateway": [39.50, 23.50], "region": "MED_EAST"},
    "Agioi Theodoroi, GR": {"approach": [[37.92, 23.08], [37.50, 23.50]],                 "gateway": [37.00, 23.50], "region": "MED_EAST"},
    "Aliaga, TR":      {"approach": [[38.80, 26.97]],                                     "gateway": [38.80, 26.00], "region": "MED_EAST"},
    "Izmit, TR":       {"approach": [[40.77, 29.92], [40.75, 29.00], [40.40, 26.80]],     "gateway": [40.00, 26.00], "region": "MED_EAST"},
    "Vassiliko, CY":   {"approach": [[34.73, 33.33]],                                     "gateway": [34.50, 33.30], "region": "MED_EAST"},
    "Beirut, LB":      {"approach": [[33.90, 35.52]],                                     "gateway": [33.90, 35.00], "region": "MED_EAST"},
    "Alexandria, EG":  {"approach": [[31.18, 29.88]],                                     "gateway": [31.50, 29.90], "region": "MED_EAST"},

    # Adriatic
    "Koper, SI":       {"approach": [[45.53, 13.73], [45.00, 13.50]],                     "gateway": [43.50, 15.00], "region": "MED_WEST"},
    "Split, HR":       {"approach": [[43.50, 16.43], [43.00, 16.00]],                     "gateway": [42.00, 16.50], "region": "MED_WEST"},

    # Black Sea
    "Constantza, RO":  {"approach": [[44.17, 28.65]],                                     "gateway": [44.20, 29.20], "region": "BLACK_SEA"},
    "Novorossiysk, RU":{"approach": [[44.72, 37.77]],                                     "gateway": [44.50, 38.00], "region": "BLACK_SEA"},
    "Tuapse, RU":      {"approach": [[44.10, 39.07]],                                     "gateway": [43.90, 39.30], "region": "BLACK_SEA"},

    # West Africa
    "Lagos, NG":       {"approach": [[6.43, 3.40], [5.50, 3.00]],                         "gateway": [4.00, 2.00], "region": "W_AFRICA"},
    "Lome, TG":        {"approach": [[6.13, 1.28], [5.50, 1.30]],                         "gateway": [4.00, 1.00], "region": "W_AFRICA"},
    "Cotonou, BJ":     {"approach": [[6.35, 2.43]],                                       "gateway": [5.00, 2.30], "region": "W_AFRICA"},
    "Tema, GH":        {"approach": [[5.63, -0.02]],                                      "gateway": [5.00, -0.10], "region": "W_AFRICA"},
    "Abidjan, CI":     {"approach": [[5.27, -4.02]],                                      "gateway": [4.50, -4.20], "region": "W_AFRICA"},
    "Monrovia, LR":    {"approach": [[6.35, -10.80]],                                     "gateway": [6.00, -11.20], "region": "W_AFRICA"},
    "Freetown, SL":    {"approach": [[8.48, -13.23]],                                     "gateway": [8.00, -13.80], "region": "W_AFRICA"},
    "Dakar, SN":       {"approach": [[14.67, -17.42]],                                    "gateway": [14.50, -18.00], "region": "W_AFRICA"},
    "Las Palmas, ES":  {"approach": [[28.13, -15.43]],                                    "gateway": [28.00, -16.00], "region": "W_AFRICA"},

    # East Africa
    "Mombasa, KE":     {"approach": [[-4.07, 39.67]],                                     "gateway": [-4.20, 39.80], "region": "E_AFRICA"},

    # South Africa
    "Cape Town, ZA":   {"approach": [[-33.90, 18.43]],                                    "gateway": [-34.20, 17.50], "region": "S_ATLANTIC"},

    # Red Sea
    "Yanbu, SA":       {"approach": [[24.08, 38.05]],                                     "gateway": [24.00, 37.00], "region": "RED_SEA"},

    # Persian Gulf
    "Fujairah, AE":    {"approach": [[25.13, 56.35]],                                     "gateway": [25.30, 57.00], "region": "INDIAN_OCEAN"},
    "Jebel Ali, AE":   {"approach": [[25.02, 55.07], [25.50, 56.20]],                     "gateway": [25.80, 57.00], "region": "INDIAN_OCEAN"},
    "Ruwais, AE":      {"approach": [[24.10, 52.72], [25.20, 55.80]],                     "gateway": [25.80, 57.00], "region": "INDIAN_OCEAN"},

    # Indian Ocean
    "Sikka, IN":       {"approach": [[22.43, 69.83]],                                     "gateway": [22.40, 68.80], "region": "INDIAN_OCEAN"},

    # SE Asia
    "Singapore, SG":   {"approach": [[1.27, 103.83]],                                     "gateway": [1.20, 103.40], "region": "SE_ASIA"},

    # US East Coast
    "New York, US":    {"approach": [[40.67, -74.03], [40.45, -73.95]],                   "gateway": [40.30, -73.50], "region": "NW_ATLANTIC"},
    "Philadelphia, US":{"approach": [[39.93, -75.13], [39.70, -75.20], [39.25, -75.30], [38.78, -75.05]], "gateway": [38.80, -74.60], "region": "NW_ATLANTIC"},
    "Baltimore, US":   {"approach": [[39.27, -76.58], [37.50, -76.20], [36.90, -75.80]],  "gateway": [36.80, -75.40], "region": "NW_ATLANTIC"},
    "Norfolk, US":     {"approach": [[36.85, -76.30]],                                    "gateway": [36.80, -75.40], "region": "NW_ATLANTIC"},
    "Wilmington, US":  {"approach": [[34.23, -77.95]],                                    "gateway": [34.00, -77.60], "region": "NW_ATLANTIC"},
    "Savannah, US":    {"approach": [[32.08, -81.10]],                                    "gateway": [31.90, -80.70], "region": "NW_ATLANTIC"},
    "Portland, US":    {"approach": [[43.66, -70.25]],                                    "gateway": [43.50, -70.00], "region": "NW_ATLANTIC"},
    "Boston, US":      {"approach": [[42.35, -71.05]],                                    "gateway": [42.30, -70.50], "region": "NW_ATLANTIC"},

    # US Gulf
    "Houston, US":     {"approach": [[29.75, -95.00], [29.40, -94.80]],                   "gateway": [29.00, -94.50], "region": "GULF_OF_MEXICO"},
    "Corpus Christi, US": {"approach": [[27.80, -97.40], [27.60, -97.00]],                "gateway": [27.40, -96.70], "region": "GULF_OF_MEXICO"},

    # Canada East
    "Halifax, CA":     {"approach": [[44.63, -63.57]],                                    "gateway": [44.40, -63.00], "region": "NW_ATLANTIC"},
    "Point Tupper, CA":{"approach": [[45.62, -61.37], [45.50, -60.50]],                   "gateway": [45.00, -59.80], "region": "NW_ATLANTIC"},
    "Come-by-Chance, CA": {"approach": [[47.82, -54.00], [47.30, -53.40]],                "gateway": [46.80, -52.80], "region": "NW_ATLANTIC"},
    "Quebec, CA":      {"approach": [[46.82, -71.20], [47.50, -68.00], [48.50, -66.00], [48.50, -62.00]], "gateway": [47.80, -59.50], "region": "NW_ATLANTIC"},
    "Montreal, CA":    {"approach": [[45.50, -73.55], [46.00, -72.50], [46.82, -71.20], [47.50, -68.00], [48.50, -66.00], [48.50, -62.00]], "gateway": [47.80, -59.50], "region": "NW_ATLANTIC"},

    # Caribbean
    "Aruba, AW":       {"approach": [[12.45, -69.97]],                                    "gateway": [12.80, -70.00], "region": "CARIBBEAN"},
    "Curacao, CW":     {"approach": [[12.18, -68.97]],                                    "gateway": [12.50, -69.00], "region": "CARIBBEAN"},
    "Point Lisas, TT": {"approach": [[10.40, -61.47]],                                    "gateway": [10.50, -61.00], "region": "CARIBBEAN"},
    "St. Croix, VI":   {"approach": [[17.70, -64.73]],                                    "gateway": [17.80, -64.90], "region": "CARIBBEAN"},
    "San Juan, PR":    {"approach": [[18.45, -66.10]],                                    "gateway": [18.60, -66.10], "region": "CARIBBEAN"},
    "Guayanilla, PR":  {"approach": [[17.98, -66.78]],                                    "gateway": [17.80, -67.00], "region": "CARIBBEAN"},
    "Hamilton, BM":    {"approach": [[32.28, -64.78]],                                    "gateway": [32.20, -64.50], "region": "NW_ATLANTIC"},

    # US West Coast
    "Los Angeles, US": {"approach": [[33.73, -118.27]],                                   "gateway": [33.60, -118.50], "region": "PACIFIC_NA"},
    "San Francisco, US": {"approach": [[37.78, -122.42], [37.80, -122.60]],               "gateway": [37.70, -122.80], "region": "PACIFIC_NA"},

    # South Pacific
    "La Libertad, EC": {"approach": [[-2.22, -80.92]],                                    "gateway": [-2.40, -81.10], "region": "PACIFIC_SA"},
}


# ============================================================
# OCEAN CORRIDORS — shared between region connections
# ============================================================

CORRIDORS = {
    # ATLANTIC CROSSINGS
    # Channel exit → Newfoundland south → US East Coast offshore
    "atlantic_n_crossing": [[49.50, -5.50], [48.00, -20.00], [45.00, -40.00], [42.00, -55.00], [40.30, -65.00]],

    # GIBRALTAR — narrow strait, minimal waypoints
    "gibraltar_transit": [[36.00, -5.30], [35.95, -5.70]],

    # IBERIA OFFSHORE — west of Spain and Portugal
    "iberia_offshore": [[45.00, -9.50], [42.00, -9.80], [38.00, -10.00], [36.00, -10.00]],

    # CANARIES CORRIDOR — west of the archipelago (La Palma at -18°W,
    # so -19.5°W is safe clearance for any composed segment).
    "canaries_bypass": [[36.00, -10.00], [33.00, -13.00], [30.00, -17.00], [27.00, -19.50]],

    # WEST AFRICA OFFSHORE — from Canaries down to Gulf of Guinea
    # Waypoints pushed west of Cap Vert and Sierra Leone bulge
    "west_africa_offshore": [[27.00, -19.50], [20.00, -20.00], [12.00, -20.00], [5.00, -16.00], [3.00, -8.00], [2.50, -2.00]],

    # ENGLISH CHANNEL — Channel exit to Dover Strait
    "channel_transit": [[49.50, -5.50], [49.80, -3.00], [50.50, -0.50], [51.00, 1.50]],

    # NORTH SEA — Dover to Skaw / Kattegat / Baltic.
    # Intermediate (57.80, 10.60) keeps the path offshore north of Jutland.
    "north_sea_kattegat_baltic": [
        [51.00, 1.50], [52.00, 2.80], [53.50, 3.50], [55.50, 5.00],
        [57.80, 8.00], [57.80, 10.60], [57.30, 11.50], [56.70, 12.20],
        [56.10, 12.62], [55.95, 12.68], [55.80, 12.75], [55.60, 12.85],
        [55.40, 12.90], [55.25, 13.10], [55.00, 14.50], [54.90, 16.30],
        [56.00, 19.00], [57.50, 20.50], [59.20, 22.30]
    ],

    # WESTERN MED — Gibraltar east to Sicilian Channel. Starts at Alboran
    # Sea (36, -3) to avoid overlapping the gibraltar_transit endpoint
    # which would cause a small west-then-east backtrack in composed paths.
    "med_west_transit": [[36.00, -3.00], [37.20, 1.00], [38.00, 5.00], [38.50, 7.50]],

    # SICILIAN CHANNEL + IONIAN
    "sicilian_channel_ionian": [[38.50, 7.50], [37.70, 11.30], [36.50, 13.50], [36.00, 16.50], [35.80, 20.00], [36.00, 22.00]],

    # AEGEAN TRANSIT — extends south into open east Med so Alexandria,
    # Beirut and Cyprus ports have a clean entry point (south of Crete)
    # before connecting to the main Aegean spine.
    "aegean_transit": [[34.00, 28.00], [34.50, 25.50], [35.20, 23.50], [36.00, 22.00], [36.30, 23.30], [37.30, 24.00], [38.00, 24.40], [38.70, 24.60], [39.30, 24.30]],

    # BOSPHORUS + DARDANELLES + MARMARA
    "turkish_straits": [[39.80, 25.50], [40.00, 26.20], [40.30, 26.50], [40.60, 27.50], [40.80, 28.50], [41.00, 29.00], [41.30, 29.30]],

    # SUEZ + RED SEA — entry via (34, 22) south of Peloponnese, east
    # along south of Crete (34°N), across to Nile delta offshore, south
    # to Port Said, through the canal, down Red Sea centreline to Bab.
    "suez_red_sea": [[34.00, 22.00], [34.00, 26.00], [34.00, 29.00], [32.50, 31.00], [31.50, 31.80], [31.30, 32.30], [30.50, 32.55], [29.90, 32.55], [28.50, 33.50], [25.00, 36.50], [21.00, 38.50], [17.00, 40.80], [14.50, 42.20], [13.20, 43.00]],

    # BAB EL MANDEB
    "bab_el_mandeb": [[13.00, 43.00], [12.50, 43.40], [11.80, 44.10]],

    # GULF OF ADEN + ARABIAN SEA to Strait of Hormuz.
    # Routes offshore east of Oman coast (Musandam peninsula at 26°N 56°E).
    "aden_to_hormuz": [[11.80, 44.10], [12.50, 51.00], [15.00, 58.00], [22.00, 62.00], [26.00, 58.50]],

    # STRAIT OF HORMUZ (narrow)
    "strait_of_hormuz": [[26.00, 56.50], [26.50, 56.20], [26.50, 55.50]],

    # INDIAN OCEAN to MALACCA
    "indian_ocean_malacca": [[11.80, 44.10], [6.00, 70.00], [5.50, 95.00], [5.50, 99.00], [3.00, 100.50], [1.50, 103.00]],

    "malacca_strait": [[5.50, 99.00], [3.00, 100.50], [1.50, 103.00]],

    # FLORIDA STRAIT — hug Florida side well north of Cuba but south of
    # the Bahamas chain (Andros at ~25°N-77°W), then south tip of Florida
    # Keys and into the Gulf.
    "florida_strait": [[27.00, -72.50], [26.50, -76.00], [25.00, -78.50], [24.30, -81.50], [24.30, -83.00], [25.50, -84.50]],

    # PANAMA CANAL — Caribbean side (approach from ABC islands) through
    # canal to Pacific. The canal cuts Panama — covered by navigable_corridor.
    "panama_canal": [[12.00, -72.00], [11.00, -76.00], [9.40, -79.90], [9.00, -79.50], [8.90, -79.50], [7.50, -80.00], [5.00, -82.00]],

    # YUCATAN CHANNEL — between Cuba and Mexico, connects Caribbean to Gulf
    "yucatan_channel": [[12.00, -72.00], [18.00, -82.00], [21.50, -85.00], [25.00, -86.00]],

    # CAPE OF GOOD HOPE
    "cape_of_good_hope": [[-33.00, 17.00], [-35.00, 19.00], [-35.00, 25.00]],

    # US EAST COAST offshore — east of Outer Banks, east of Bahamas chain.
    "us_east_coast": [[40.30, -73.50], [38.80, -74.60], [36.80, -75.40], [35.00, -74.00], [30.00, -73.00], [27.00, -72.50]],

    # CARIBBEAN — east of Bahamas / Hispaniola, through Anegada Passage,
    # then down the Antilles to Dutch Caribbean. Keeps everything east
    # of Dominican Republic and Bahamas until dropping down to the ABC islands.
    "caribbean_transit": [[18.30, -64.80], [20.00, -67.00], [23.00, -70.00], [27.00, -72.50]],

    # GULF OF MEXICO interior
    "gulf_of_mexico_interior": [[25.00, -83.00], [25.00, -87.00], [27.00, -90.00], [29.00, -94.50]],

    # PACIFIC NORTH (Panama Pacific exit to California)
    "pacific_na_coast": [[5.00, -82.00], [15.00, -105.00], [27.00, -115.00], [33.60, -118.50]],

    # PACIFIC SA (Panama to La Libertad)
    "pacific_sa_coast": [[5.00, -82.00], [2.00, -81.50], [-2.40, -81.10]],
}


# ============================================================
# REGION GRAPH — how regions connect via corridors
# ============================================================
# Each edge: (corridor, first_gateway_anchor, last_gateway_anchor)
# "first"/"last" indicate whether the corridor runs from A-side to B-side (or reverse)

REGION_GRAPH = {
    # NE_ATLANTIC connects to:
    ("NE_ATLANTIC", "NW_ATLANTIC"): ["channel_transit", "atlantic_n_crossing"],
    ("NE_ATLANTIC", "IBERIA"): ["channel_transit", "iberia_offshore"],
    ("NE_ATLANTIC", "MED_WEST"): ["channel_transit", "iberia_offshore", "gibraltar_transit"],
    ("NE_ATLANTIC", "W_AFRICA"): ["channel_transit", "iberia_offshore", "canaries_bypass", "west_africa_offshore"],
    ("NE_ATLANTIC", "BALTIC"): ["north_sea_kattegat_baltic"],
    ("NE_ATLANTIC", "MED_EAST"): ["channel_transit", "iberia_offshore", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit"],
    ("NE_ATLANTIC", "RED_SEA"): ["channel_transit", "iberia_offshore", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea"],
    ("NE_ATLANTIC", "INDIAN_OCEAN"): ["channel_transit", "iberia_offshore", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea", "bab_el_mandeb", "aden_to_hormuz"],
    ("NE_ATLANTIC", "S_ATLANTIC"): ["channel_transit", "iberia_offshore", "canaries_bypass", "west_africa_offshore", "cape_of_good_hope"],
    ("NE_ATLANTIC", "CARIBBEAN"): ["channel_transit", "atlantic_n_crossing", "us_east_coast", "caribbean_transit"],
    ("NE_ATLANTIC", "PACIFIC_NA"): ["channel_transit", "atlantic_n_crossing", "us_east_coast", "florida_strait", "panama_canal", "pacific_na_coast"],

    # IBERIA — Portuguese/NW Spanish Atlantic coast, Mohammedia. Skips the
    # channel_transit leg (they're already offshore Atlantic).
    ("IBERIA", "NE_ATLANTIC"): ["iberia_offshore", "channel_transit"],
    ("IBERIA", "NW_ATLANTIC"): ["iberia_offshore", "atlantic_n_crossing"],
    ("IBERIA", "MED_WEST"): ["gibraltar_transit"],
    ("IBERIA", "MED_EAST"): ["gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit"],
    ("IBERIA", "W_AFRICA"): ["canaries_bypass", "west_africa_offshore"],
    ("IBERIA", "S_ATLANTIC"): ["canaries_bypass", "west_africa_offshore", "cape_of_good_hope"],
    ("IBERIA", "BALTIC"): ["iberia_offshore", "channel_transit", "north_sea_kattegat_baltic"],
    ("IBERIA", "RED_SEA"): ["gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea"],
    ("IBERIA", "INDIAN_OCEAN"): ["gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea", "bab_el_mandeb", "aden_to_hormuz"],
    ("IBERIA", "CARIBBEAN"): ["atlantic_n_crossing", "us_east_coast", "caribbean_transit"],

    # MED_WEST — always prepend med_west_transit to reach the Sicilian
    # Channel or Gibraltar without hopping across the western basin.
    ("MED_WEST", "MED_EAST"): ["med_west_transit", "sicilian_channel_ionian", "aegean_transit"],
    ("MED_WEST", "BLACK_SEA"): ["med_west_transit", "sicilian_channel_ionian", "aegean_transit", "turkish_straits"],
    ("MED_WEST", "RED_SEA"): ["med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea"],
    ("MED_WEST", "INDIAN_OCEAN"): ["med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea", "bab_el_mandeb", "aden_to_hormuz"],
    ("MED_WEST", "NE_ATLANTIC"): ["med_west_transit", "gibraltar_transit", "iberia_offshore", "channel_transit"],
    ("MED_WEST", "IBERIA"): ["med_west_transit", "gibraltar_transit"],
    ("MED_WEST", "W_AFRICA"): ["med_west_transit", "gibraltar_transit", "canaries_bypass", "west_africa_offshore"],
    ("MED_WEST", "NW_ATLANTIC"): ["med_west_transit", "gibraltar_transit", "iberia_offshore", "atlantic_n_crossing"],

    # MED_EAST:
    ("MED_EAST", "BLACK_SEA"): ["turkish_straits"],
    ("MED_EAST", "RED_SEA"): ["suez_red_sea"],
    ("MED_EAST", "INDIAN_OCEAN"): ["suez_red_sea", "bab_el_mandeb", "aden_to_hormuz"],
    ("MED_EAST", "MED_WEST"): ["aegean_transit", "sicilian_channel_ionian", "med_west_transit"],
    ("MED_EAST", "NE_ATLANTIC"): ["aegean_transit", "sicilian_channel_ionian", "med_west_transit", "gibraltar_transit", "iberia_offshore", "channel_transit"],
    ("MED_EAST", "IBERIA"): ["aegean_transit", "sicilian_channel_ionian", "med_west_transit", "gibraltar_transit"],
    ("MED_EAST", "W_AFRICA"): ["aegean_transit", "sicilian_channel_ionian", "med_west_transit", "gibraltar_transit", "canaries_bypass", "west_africa_offshore"],

    # BLACK_SEA:
    ("BLACK_SEA", "MED_EAST"): ["turkish_straits"],
    ("BLACK_SEA", "MED_WEST"): ["turkish_straits", "aegean_transit", "sicilian_channel_ionian", "med_west_transit"],
    ("BLACK_SEA", "NE_ATLANTIC"): ["turkish_straits", "aegean_transit", "sicilian_channel_ionian", "med_west_transit", "gibraltar_transit", "iberia_offshore", "channel_transit"],
    ("BLACK_SEA", "IBERIA"): ["turkish_straits", "aegean_transit", "sicilian_channel_ionian", "med_west_transit", "gibraltar_transit"],

    # RED_SEA:
    ("RED_SEA", "MED_EAST"): ["suez_red_sea"],
    ("RED_SEA", "INDIAN_OCEAN"): ["bab_el_mandeb", "aden_to_hormuz"],

    # INDIAN_OCEAN:
    ("INDIAN_OCEAN", "RED_SEA"): ["aden_to_hormuz", "bab_el_mandeb"],
    ("INDIAN_OCEAN", "SE_ASIA"): ["indian_ocean_malacca"],
    ("INDIAN_OCEAN", "E_AFRICA"): [],
    ("INDIAN_OCEAN", "S_ATLANTIC"): ["cape_of_good_hope"],

    # E_AFRICA, S_ATLANTIC, SE_ASIA:
    ("E_AFRICA", "INDIAN_OCEAN"): [],
    ("E_AFRICA", "S_ATLANTIC"): ["cape_of_good_hope"],
    ("S_ATLANTIC", "W_AFRICA"): [],
    ("S_ATLANTIC", "E_AFRICA"): ["cape_of_good_hope"],
    ("S_ATLANTIC", "INDIAN_OCEAN"): ["cape_of_good_hope"],
    ("S_ATLANTIC", "NE_ATLANTIC"): ["cape_of_good_hope", "west_africa_offshore", "canaries_bypass", "iberia_offshore"],
    ("W_AFRICA", "S_ATLANTIC"): [],
    ("W_AFRICA", "IBERIA"): ["west_africa_offshore", "canaries_bypass"],
    ("W_AFRICA", "NE_ATLANTIC"): ["west_africa_offshore", "canaries_bypass", "iberia_offshore", "channel_transit"],
    ("W_AFRICA", "MED_WEST"): ["west_africa_offshore", "canaries_bypass", "gibraltar_transit", "med_west_transit"],
    ("W_AFRICA", "MED_EAST"): ["west_africa_offshore", "canaries_bypass", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit"],
    ("W_AFRICA", "BLACK_SEA"): ["west_africa_offshore", "canaries_bypass", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "turkish_straits"],
    ("W_AFRICA", "RED_SEA"): ["west_africa_offshore", "canaries_bypass", "gibraltar_transit", "med_west_transit", "sicilian_channel_ionian", "aegean_transit", "suez_red_sea"],
    ("W_AFRICA", "BALTIC"): ["west_africa_offshore", "canaries_bypass", "iberia_offshore", "channel_transit", "north_sea_kattegat_baltic"],
    ("W_AFRICA", "NW_ATLANTIC"): ["west_africa_offshore", "canaries_bypass", "atlantic_n_crossing"],
    ("SE_ASIA", "INDIAN_OCEAN"): ["indian_ocean_malacca"],

    # BALTIC:
    ("BALTIC", "NE_ATLANTIC"): ["north_sea_kattegat_baltic"],
    ("BALTIC", "IBERIA"): ["north_sea_kattegat_baltic", "channel_transit", "iberia_offshore"],
    ("BALTIC", "W_AFRICA"): ["north_sea_kattegat_baltic", "channel_transit", "iberia_offshore", "canaries_bypass", "west_africa_offshore"],
    ("BALTIC", "MED_WEST"): ["north_sea_kattegat_baltic", "channel_transit", "iberia_offshore", "gibraltar_transit"],
    ("BALTIC", "NW_ATLANTIC"): ["north_sea_kattegat_baltic", "channel_transit", "atlantic_n_crossing"],

    # NW_ATLANTIC:
    ("NW_ATLANTIC", "NE_ATLANTIC"): ["atlantic_n_crossing", "channel_transit"],
    ("NW_ATLANTIC", "CARIBBEAN"): ["us_east_coast", "caribbean_transit"],
    ("NW_ATLANTIC", "GULF_OF_MEXICO"): ["us_east_coast", "florida_strait", "gulf_of_mexico_interior"],
    ("NW_ATLANTIC", "PACIFIC_NA"): ["us_east_coast", "caribbean_transit", "panama_canal", "pacific_na_coast"],
    ("NW_ATLANTIC", "PACIFIC_SA"): ["us_east_coast", "caribbean_transit", "panama_canal", "pacific_sa_coast"],
    ("NW_ATLANTIC", "W_AFRICA"): ["atlantic_n_crossing", "canaries_bypass", "west_africa_offshore"],

    # CARIBBEAN:
    ("CARIBBEAN", "NW_ATLANTIC"): ["caribbean_transit", "us_east_coast"],
    ("CARIBBEAN", "GULF_OF_MEXICO"): ["yucatan_channel", "gulf_of_mexico_interior"],
    ("CARIBBEAN", "PACIFIC_NA"): ["panama_canal", "pacific_na_coast"],
    ("CARIBBEAN", "PACIFIC_SA"): ["panama_canal", "pacific_sa_coast"],

    # GULF_OF_MEXICO:
    ("GULF_OF_MEXICO", "NW_ATLANTIC"): ["gulf_of_mexico_interior", "florida_strait", "us_east_coast"],
    ("GULF_OF_MEXICO", "CARIBBEAN"): ["gulf_of_mexico_interior", "yucatan_channel"],
    ("GULF_OF_MEXICO", "NE_ATLANTIC"): ["gulf_of_mexico_interior", "florida_strait", "us_east_coast", "atlantic_n_crossing", "channel_transit"],
    ("GULF_OF_MEXICO", "IBERIA"): ["gulf_of_mexico_interior", "florida_strait", "us_east_coast", "atlantic_n_crossing", "iberia_offshore"],
    ("GULF_OF_MEXICO", "W_AFRICA"): ["gulf_of_mexico_interior", "florida_strait", "us_east_coast", "atlantic_n_crossing", "canaries_bypass", "west_africa_offshore"],

    # PACIFIC_NA:
    ("PACIFIC_NA", "NW_ATLANTIC"): ["pacific_na_coast", "panama_canal", "caribbean_transit", "us_east_coast"],
    ("PACIFIC_NA", "NE_ATLANTIC"): ["pacific_na_coast", "panama_canal", "caribbean_transit", "atlantic_n_crossing", "channel_transit"],
    ("PACIFIC_NA", "IBERIA"): ["pacific_na_coast", "panama_canal", "caribbean_transit", "atlantic_n_crossing", "iberia_offshore"],
    ("PACIFIC_NA", "CARIBBEAN"): ["pacific_na_coast", "panama_canal"],
    ("PACIFIC_NA", "GULF_OF_MEXICO"): ["pacific_na_coast", "panama_canal", "yucatan_channel", "gulf_of_mexico_interior"],
    ("PACIFIC_NA", "PACIFIC_SA"): ["pacific_na_coast", "pacific_sa_coast"],
    ("PACIFIC_SA", "PACIFIC_NA"): ["pacific_sa_coast", "pacific_na_coast"],
    ("PACIFIC_SA", "CARIBBEAN"): ["pacific_sa_coast", "panama_canal"],
    ("PACIFIC_SA", "NW_ATLANTIC"): ["pacific_sa_coast", "panama_canal", "florida_strait", "us_east_coast"],
}


def find_corridor_chain(region_a: str, region_b: str) -> list:
    """BFS in the region graph; returns list of corridor names to traverse."""
    if region_a == region_b:
        return []

    direct = REGION_GRAPH.get((region_a, region_b))
    if direct is not None:
        return direct

    # BFS
    visited = {region_a}
    queue = deque([(region_a, [])])
    while queue:
        current, path = queue.popleft()
        for (a, b), corridors in REGION_GRAPH.items():
            if a != current or b in visited:
                continue
            new_path = path + corridors
            if b == region_b:
                return new_path
            visited.add(b)
            queue.append((b, new_path))
    return None  # no path


def _closest_index(point: list, polyline: list) -> int:
    """Return index of polyline waypoint closest to `point`."""
    best_i = 0
    best_d = float("inf")
    for i, p in enumerate(polyline):
        d = haversine_nm(point[0], point[1], p[0], p[1])
        if d < best_d:
            best_d = d
            best_i = i
    return best_i


def _corridor_subset(corridor: list, entry: list, exit_point: list) -> list:
    """
    Traverse only the stretch of `corridor` that lies between the entry
    anchor and the exit anchor. Handles both forward and reverse
    orientation — reversed if entry is later in the polyline than exit.
    If entry and exit land on the same waypoint, the corridor is a no-op
    (returns empty list so the composed path connects entry → exit directly).
    """
    i_entry = _closest_index(entry, corridor)
    i_exit = _closest_index(exit_point, corridor)
    if i_entry == i_exit:
        return []
    if i_entry < i_exit:
        return list(corridor[i_entry:i_exit + 1])
    return list(reversed(corridor[i_exit:i_entry + 1]))


def compose_path(port_a: str, port_b: str) -> list:
    """Return the composed polyline [lat, lon][] from port_a to port_b."""
    pa = PORTS.get(port_a)
    pb = PORTS.get(port_b)
    if not pa or not pb:
        return None

    chain = find_corridor_chain(pa["region"], pb["region"])
    if chain is None:
        return None

    pts = list(pa["approach"]) + [pa["gateway"]]

    # For each corridor we need an "entry" (where we're coming from) and
    # an "exit" (where we're going next). Entry is pts[-1] so far; exit
    # is the next corridor's endpoint closest to the destination, or the
    # destination gateway for the final corridor.
    dest_gateway = pb["gateway"]

    for i, corridor_name in enumerate(chain):
        corridor = CORRIDORS[corridor_name]
        entry = pts[-1]
        if i + 1 < len(chain):
            # Aim for the endpoint of the next corridor that's closer to
            # the destination — keeps multi-corridor chains flowing forward.
            next_corridor = CORRIDORS[chain[i + 1]]
            d_start = haversine_nm(dest_gateway[0], dest_gateway[1],
                                    next_corridor[0][0], next_corridor[0][1])
            d_end = haversine_nm(dest_gateway[0], dest_gateway[1],
                                  next_corridor[-1][0], next_corridor[-1][1])
            exit_point = next_corridor[0] if d_start <= d_end else next_corridor[-1]
        else:
            exit_point = dest_gateway

        subset = _corridor_subset(corridor, entry, exit_point)
        pts.extend(subset)

    pts.append(pb["gateway"])
    pts.extend(list(reversed(pb["approach"])))

    # Deduplicate consecutive near-equal points (within 3 NM) to avoid
    # "backtracks" where two corridors share a nearly identical endpoint.
    cleaned = [pts[0]]
    for p in pts[1:]:
        last = cleaned[-1]
        if haversine_nm(last[0], last[1], p[0], p[1]) > 3.0:
            cleaned.append(p)
    return cleaned


def path_distance_nm(path: list) -> float:
    total = 0.0
    for i in range(len(path) - 1):
        total += haversine_nm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
    return total


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
    (8.60, 10.20, -80.20, -79.30, "Panama Canal"),
    (11.50, 13.20, 43.00, 44.50, "Bab-el-Mandeb"),
    (25.50, 26.70, 55.00, 57.00, "Strait of Hormuz"),
    (1.00, 6.00, 98.00, 104.00, "Malacca / Singapore"),
    (23.80, 31.50, 32.20, 36.80, "Gulf of Suez / Red Sea north"),
    # Gulf of St. Lawrence + St. Lawrence River (Quebec, Montreal)
    (45.00, 50.00, -73.80, -58.00, "Gulf of St. Lawrence / Fleuve"),
    # Newfoundland bays — Come-by-Chance (Placentia Bay), St. John's
    (46.50, 48.50, -55.50, -52.50, "Newfoundland bays"),
    # Scotland east coast — Grangemouth, Firth of Forth
    (55.80, 56.30, -4.00, -2.00, "Firth of Forth"),
    # Halifax / Nova Scotia harbours
    (44.00, 45.20, -64.00, -62.80, "Nova Scotia harbours"),
    # Elbe estuary (Hamburg)
    (53.30, 54.10, 8.00, 10.20, "Elbe estuary"),
    # Adriatic Sea — Koper, Split access
    (42.50, 46.00, 12.50, 17.00, "Adriatic Sea"),
    # Gulf of Kutch (Sikka, India west coast)
    (21.80, 23.50, 68.50, 70.50, "Gulf of Kutch"),
    # Black Sea approaches
    (43.00, 45.50, 27.50, 40.00, "Black Sea"),
    # US East Coast — Miami to Savannah coastal gap
    (31.00, 33.00, -81.50, -78.50, "US SE coast / Savannah approach"),
]


def in_navigable_corridor(lat, lon):
    for min_lat, max_lat, min_lon, max_lon, label in NAVIGABLE_CORRIDORS:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return label
    return None


def segment_crosses_land(p1, p2, land_prep, samples=60, endpoint_buffer_nm=15.0):
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


def load_land_prep():
    from pathlib import Path as _Path
    shp_path = _Path(__file__).parent / "data" / "ne_land" / "ne_50m_land.shp"
    if not shp_path.exists():
        return None
    try:
        import shapefile
        from shapely.geometry import shape
        from shapely.ops import unary_union
        from shapely.prepared import prep
    except ImportError:
        return None
    sf = shapefile.Reader(str(shp_path))
    polys = [shape(sr.shape.__geo_interface__) for sr in sf.shapeRecords()]
    return prep(unary_union(polys))


def main():
    print(f"Loading hand-drawn overrides...")
    hand_drawn = {}
    if HAND_DRAWN_PATH.exists():
        with open(HAND_DRAWN_PATH) as f:
            raw = json.load(f)
        for k, v in raw.items():
            if not k.startswith("_") and v.get("waypoints"):
                hand_drawn[k] = v["waypoints"]
    print(f"  {len(hand_drawn)} hand-drawn overrides loaded")

    print("Loading land polygons for post-compose check...")
    land_prep = load_land_prep()
    if land_prep is None:
        print("  (land data unavailable — skipping check)")

    port_names = sorted(PORTS.keys())
    print(f"\nComposing paths for {len(port_names)} ports ({len(port_names) * (len(port_names) - 1) // 2} pairs)...")

    distances = {}
    paths = {}
    missed = []
    land_hits = []

    for i, a in enumerate(port_names):
        for b in port_names[i + 1:]:
            key = f"{a}|{b}"

            if key in hand_drawn:
                pts = [[round(p[0], 4), round(p[1], 4)] for p in hand_drawn[key]]
                paths[key] = pts
                distances[key] = round(path_distance_nm(pts), 1)
                continue

            composed = compose_path(a, b)
            if composed is None:
                missed.append(key)
                continue

            pts = [[round(p[0], 4), round(p[1], 4)] for p in composed]
            paths[key] = pts
            distances[key] = round(path_distance_nm(pts), 1)

            if land_prep is not None:
                for seg_i in range(len(pts) - 1):
                    hit = segment_crosses_land(pts[seg_i], pts[seg_i + 1], land_prep)
                    if hit:
                        land_hits.append((key, seg_i, pts[seg_i], pts[seg_i + 1], hit))
                        break

    print(f"\nComposed {len(paths)} paths. Missed: {len(missed)}")
    if missed:
        print(f"  First 10 missing: {missed[:10]}")
    print(f"Land-crossings detected: {len(land_hits)}")
    # Summary by problematic segment
    from collections import Counter
    seg_counter = Counter()
    for key, seg_i, a, b, (hlat, hlon, t) in land_hits:
        seg_key = (round(a[0], 1), round(a[1], 1), round(b[0], 1), round(b[1], 1))
        seg_counter[seg_key] += 1
    print("\n  Top problem segments (count | a -> b):")
    for seg, count in seg_counter.most_common(20):
        print(f"    {count:>5} | ({seg[0]}, {seg[1]}) -> ({seg[2]}, {seg[3]})")

    if land_hits[:20]:
        print("\n  First 20 crossings:")
        for key, seg_i, a, b, (hlat, hlon, t) in land_hits[:20]:
            print(f"    {key}")
            print(f"      seg {seg_i}: ({a[0]:.2f}, {a[1]:.2f}) -> ({b[0]:.2f}, {b[1]:.2f})")
            print(f"      hit near ({hlat:.2f}, {hlon:.2f}) at t={t:.2f}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "distances.json").write_text(json.dumps(distances, indent=2))
    (OUTPUT_DIR / "paths.json").write_text(json.dumps(paths, separators=(",", ":")))
    (OUTPUT_DIR / "hand_drawn_keys.json").write_text(json.dumps(
        {"keys": sorted(hand_drawn.keys())}, indent=2
    ))

    size_mb = (OUTPUT_DIR / "paths.json").stat().st_size / 1024 / 1024
    avg_waypoints = sum(len(p) for p in paths.values()) / max(1, len(paths))
    print(f"\nSaved to {OUTPUT_DIR}/")
    print(f"  paths.json: {size_mb:.1f} MB, avg {avg_waypoints:.0f} waypoints/path")
    print(f"  distances.json: {len(distances)} entries")


if __name__ == "__main__":
    main()
