"""
Build *multiple* distance/paths JSON files by running V2
(build_v2_landsafe) with different avoid-passage filters applied to
searoute's Marnet. Lets operators route around the Red Sea (Houthi
risk), Panama (water levels), Malacca (piracy), etc., the way Netpas
does with its "Avoid passage" checkboxes.

Variants produced (file suffix → which passages are removed):
  default                → nothing removed (fastest route)
  no-suez                → Suez forbidden → forces Cape of Good Hope
  no-panama              → Panama forbidden → routes via Magellan or Cape
  no-suez-no-panama      → worst-case: both main man-made canals closed

Each variant emits its own `paths-<suffix>.json` + `distances-<suffix>.json`
under output/variants/. `paths.json` / `distances.json` at the top of
output/ remains the default (unfiltered) run and is what the current
TS provider reads.

All variants share the same PORTS + PILOT_STATIONS + GSHHG land mask
+ coastal tolerance — only the passage filter changes.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

# Reuse V2 building blocks.
import build_v2_landsafe as v2

OUTPUT_DIR = Path(__file__).parent / "output"
VARIANTS_DIR = OUTPUT_DIR / "variants"

# searoute labels its network passages with a `passage` property on
# each edge. To "avoid Suez" we drop edges tagged `suez`, etc.
# Known passage tags in searoute's marnet:
#   suez, panama, malacca, gibraltar, dover, bering, magellan,
#   kiel, corinth, northwest, northeast
VARIANTS: list[tuple[str, list[str]]] = [
    ("default", []),
    ("no-suez", ["suez"]),
    ("no-panama", ["panama"]),
    ("no-suez-no-panama", ["suez", "panama"]),
]


def load_searoute_network_filtered(avoid_tags: list[str]):
    """Like v2.load_searoute_network but drops edges whose passage tag
    is in `avoid_tags`. Also drops nodes that end up orphaned."""
    with open(v2.SEAROUTE_GEOJSON, encoding="utf-8") as f:
        geo = json.load(f)
    node_id: dict = {}
    nodes: dict = {}
    edges: list = []

    def id_for(lon, lat):
        key = (round(lon, 4), round(lat, 4))
        if key not in node_id:
            nid = len(nodes)
            node_id[key] = nid
            nodes[nid] = (key[1], key[0])
        return node_id[key]

    dropped_passages = {tag: 0 for tag in avoid_tags}
    for feat in geo["features"]:
        passage = (feat.get("properties") or {}).get("passage")
        if passage in avoid_tags:
            dropped_passages[passage] += 1
            continue
        geom = feat["geometry"]
        rings = (geom["coordinates"] if geom["type"] == "LineString"
                 else geom["coordinates"] if geom["type"] == "MultiLineString"
                 else None)
        if rings is None:
            continue
        if geom["type"] == "LineString":
            rings = [rings]
        for ring in rings:
            for i in range(len(ring) - 1):
                lon1, lat1 = ring[i][:2]
                lon2, lat2 = ring[i + 1][:2]
                a = id_for(lon1, lat1)
                b = id_for(lon2, lat2)
                if a == b:
                    continue
                w = v2.haversine_nm(lat1, lon1, lat2, lon2)
                edges.append((a, b, w))
    return nodes, edges, dropped_passages


def build_variant(suffix: str, avoid: list[str], land):
    print("\n" + "=" * 60)
    print(f"Variant: {suffix} (avoid: {avoid or '(none)'})")
    print("=" * 60)

    sr_nodes, sr_edges, dropped = load_searoute_network_filtered(avoid)
    print(f"  {len(sr_nodes):,} nodes, {len(sr_edges):,} edges "
          f"(dropped passage features: {dropped})")

    # Filter edges against GSHHG — same as v2.
    filtered = []
    for a, b, w in sr_edges:
        if v2.arc_is_clear(sr_nodes[a], sr_nodes[b], land):
            filtered.append((a, b, w))
    print(f"  {len(filtered):,}/{len(sr_edges):,} edges land-safe")

    # Inject trans-ocean transit anchors BEFORE connecting ports so
    # Dijkstra has trans-Pacific / South-Atlantic shortcuts that
    # searoute's AIS-derived network doesn't provide.
    edges_writable = list(filtered)
    v2.add_transit_anchors(sr_nodes, edges_writable, land)
    port_ids = v2.connect_ports(sr_nodes, edges_writable, land)

    # Adjacency
    adj: dict = {}
    for a, b, w in edges_writable:
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))

    # Dijkstra from every port
    port_names = list(v2.PORTS.keys())
    port_node_ids = [port_ids[n] for n in port_names]
    distances: dict = {}
    paths: dict = {}
    unreachable = 0
    t0 = time.time()
    for i, src_name in enumerate(port_names):
        src = port_ids[src_name]
        dist, prev = v2.dijkstra(adj, src, port_node_ids)
        for dst_name in port_names:
            if dst_name <= src_name:
                continue
            dst = port_ids[dst_name]
            if dst not in dist:
                unreachable += 1
                continue
            node_path = v2.reconstruct(prev, src, dst)
            coord_path = [sr_nodes[nid] for nid in node_path]
            total = 0.0
            for k in range(len(coord_path) - 1):
                total += v2.haversine_nm(*coord_path[k], *coord_path[k + 1])
            key = f"{src_name}|{dst_name}"
            distances[key] = round(total, 1)
            paths[key] = [[round(c[0], 4), round(c[1], 4)] for c in coord_path]
    elapsed = time.time() - t0
    print(f"  {len(paths):,} paths, {unreachable} unreachable "
          f"(took {elapsed:.0f}s)")

    VARIANTS_DIR.mkdir(exist_ok=True)
    if suffix == "default":
        paths_path = OUTPUT_DIR / "paths.json"
        dist_path = OUTPUT_DIR / "distances.json"
    else:
        paths_path = VARIANTS_DIR / f"paths-{suffix}.json"
        dist_path = VARIANTS_DIR / f"distances-{suffix}.json"
    paths_path.write_text(json.dumps(paths, separators=(",", ":")))
    dist_path.write_text(json.dumps(distances, indent=2))
    print(f"  -> {paths_path.name}, {dist_path.name}")


def main():
    land = v2.load_gshhg_with_tolerance()
    for suffix, avoid in VARIANTS:
        build_variant(suffix, avoid, land)
    print("\nAll variants built.")


if __name__ == "__main__":
    main()
