"""
Build paths.json + distances.json using the searoute library
(eurostat SeaRoute, Apache 2.0, Oak Ridge National Labs maritime
network). Apache 2.0 → commercial-safe.

searoute ships with a global maritime network (oceans + major
shipping lanes + canal/strait passages) and runs Dijkstra over it.
Matches PUB 151 closely (Rotterdam → Houston came out to 5023 NM
against 5022 NM reference — 0.02% error).

Output is drop-in compatible with the ocean_routing provider —
same 106 ports, same JSON shape as build_sphere_graph.py.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import searoute as sr

OUTPUT_DIR = Path(__file__).parent / "output"
KM_TO_NM = 0.539957


# Same 106 ports as build_sphere_graph.py — keep the port contract
# stable so the frontend doesn't need changes.
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
}


def simplify_route(coords_lonlat: list, max_points: int = 30) -> list:
    """
    searoute returns a very dense polyline (30–50 points even for a
    short leg). For rendering we keep at most `max_points` points by
    uniform subsampling — preserves shape without overwhelming the
    client-side GC renderer.
    """
    n = len(coords_lonlat)
    if n <= max_points:
        return coords_lonlat
    step = (n - 1) / (max_points - 1)
    idxs = [int(round(i * step)) for i in range(max_points)]
    idxs[-1] = n - 1
    # de-dup in case of rounding collisions
    seen = set()
    keep = []
    for i in idxs:
        if i not in seen:
            keep.append(coords_lonlat[i])
            seen.add(i)
    return keep


def main():
    names = list(PORTS.keys())
    distances: dict[str, float] = {}
    paths: dict[str, list[list[float]]] = {}
    failed = []

    total_pairs = len(names) * (len(names) - 1) // 2
    print(f"Computing {total_pairs:,} port pairs via searoute...")
    t0 = time.time()
    done = 0

    for i, a in enumerate(names):
        lat_a, lon_a = PORTS[a]
        for b in names[i + 1:]:
            lat_b, lon_b = PORTS[b]
            # Always store with alphabetically-sorted key so the TS
            # provider's `a < b ? "A|B" : "B|A"` lookup matches.
            if a < b:
                key = f"{a}|{b}"
                first_lat, first_lon = lat_a, lon_a
                last_lat, last_lon = lat_b, lon_b
                origin = [lon_a, lat_a]
                dest = [lon_b, lat_b]
            else:
                key = f"{b}|{a}"
                first_lat, first_lon = lat_b, lon_b
                last_lat, last_lon = lat_a, lon_a
                origin = [lon_b, lat_b]
                dest = [lon_a, lat_a]
            try:
                route = sr.searoute(
                    origin,
                    dest,
                    units="naut",   # returns length in nautical miles
                )
                length_nm = route.properties.get("length", 0)
                coords = route.geometry["coordinates"]  # [[lon, lat], ...]
                # Keep every searoute waypoint — removing middle
                # points can make an arc skip a navigable corner and
                # slice a peninsula. Just snap the endpoints to the
                # literal port coordinates (searoute snaps to its
                # nearest network node otherwise).
                latlon = [[c[1], c[0]] for c in coords]
                latlon[0] = [first_lat, first_lon]
                latlon[-1] = [last_lat, last_lon]
                paths[key] = [[round(p[0], 4), round(p[1], 4)] for p in latlon]
                distances[key] = round(length_nm, 1)
            except Exception as e:
                failed.append((key, str(e)))
            done += 1
            if done % 500 == 0:
                elapsed = time.time() - t0
                eta = elapsed / done * (total_pairs - done)
                print(f"  {done:,}/{total_pairs:,} ({elapsed:.0f}s, {eta:.0f}s ETA)")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.0f}s: {len(paths):,} routes, {len(failed)} failed")
    if failed:
        print("First 10 failures:")
        for k, err in failed[:10]:
            print(f"  {k}: {err}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "distances.json").write_text(json.dumps(distances, indent=2))
    (OUTPUT_DIR / "paths.json").write_text(json.dumps(paths, separators=(",", ":")))
    (OUTPUT_DIR / "hand_drawn_keys.json").write_text(json.dumps({"keys": []}, indent=2))

    avg_wp = sum(len(p) for p in paths.values()) / max(1, len(paths))
    print(f"Saved to {OUTPUT_DIR}/")
    print(f"  distances.json: {len(distances)} entries")
    print(f"  paths.json: avg {avg_wp:.1f} waypoints/path")


if __name__ == "__main__":
    main()
