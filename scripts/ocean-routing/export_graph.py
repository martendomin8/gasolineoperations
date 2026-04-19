"""
Export the V2 land-safe graph as a single JSON file the Node.js runtime
can load for on-the-fly Dijkstra with user-injected custom waypoints.

Why: precomputed paths.json only answers port-to-port queries — it can't
route through an arbitrary (lat, lon) point. A custom click-anywhere
waypoint needs a runtime Dijkstra over the full graph, with the custom
point temporarily wired to its k-nearest land-safe neighbours.

Output shape (see src/lib/maritime/sea-distance/providers/ocean-routing/graph.json):
{
  "nodes": [{"id": 0, "lat": 51.40, "lon": 3.15}, ...],
  "edges": [{"from": 0, "to": 1, "weight": 12.3}, ...],
  "portMap": {"Antwerp, BE": 9876, ...},
  "meta": {
    "nodeCount": N,
    "edgeCount": E,
    "portCount": P,
    "variant": "default",
    "builtAt": "2026-04-19T...Z"
  }
}

The edge list stores each undirected edge once; the Node loader
materialises the bidirectional adjacency map at init time.

We currently export only the default variant (no passages avoided).
avoid-Suez / avoid-Panama variants stay on the precomputed paths.json
for now — extending custom-waypoint routing to respect them is a
straightforward follow-up (export 3 more graph.json files, pick by
`avoid` param at runtime).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import build_v2_landsafe as v2


OUT_PATH = (
    Path(__file__).parent.parent.parent
    / "src" / "lib" / "maritime" / "sea-distance" / "providers"
    / "ocean-routing" / "graph.json"
)


def main() -> None:
    print("Loading GSHHG land mask (with coastal tolerance buffer)...")
    land = v2.load_gshhg_with_tolerance()

    print("Loading searoute marnet network...")
    sr_nodes, sr_edges = v2.load_searoute_network()
    print(f"  {len(sr_nodes):,} nodes, {len(sr_edges):,} edges")

    print("Filtering land-unsafe edges...")
    safe_edges = v2.filter_edges_landsafe(sr_nodes, sr_edges, land)
    print(f"  {len(safe_edges):,}/{len(sr_edges):,} land-safe")

    # IMPORTANT: mirror build_v2_landsafe.main() execution order so the
    # exported graph matches the one paths.json was built from. Transit
    # anchors go in BEFORE ports because port-connection may snap onto
    # an anchor as its nearest node.
    nodes_out: dict[int, tuple[float, float]] = dict(sr_nodes)
    edges_out: list[tuple[int, int, float]] = list(safe_edges)

    print("Injecting trans-ocean transit anchors...")
    v2.add_transit_anchors(nodes_out, edges_out, land)
    print(f"  After anchors: {len(nodes_out):,} nodes, {len(edges_out):,} edges")

    print("Injecting hand-curated channel chains...")
    chain_node_ids = v2.add_channel_chains(nodes_out, edges_out, land) or set()
    print(f"  After channel chains: {len(nodes_out):,} nodes, {len(edges_out):,} edges")

    print("Connecting ports (with pilot stations where configured)...")
    port_map = v2.connect_ports(nodes_out, edges_out, land)
    print(f"  After ports: {len(nodes_out):,} nodes, {len(edges_out):,} edges")

    # Flatten to JSON-friendly shape. Edge `weight` is in nautical miles
    # so the Node Dijkstra matches paths.json distances end to end.
    nodes_json = [
        {"id": nid, "lat": round(lat, 4), "lon": round(lon, 4)}
        for nid, (lat, lon) in sorted(nodes_out.items())
    ]
    # scipy.cKDTree returns numpy int64 indices from port-connect step —
    # json.dumps can't serialise numpy scalars. Coerce every id to a
    # native Python int defensively.
    edges_json = [
        {"from": int(a), "to": int(b), "weight": round(float(w), 3)}
        for (a, b, w) in edges_out
    ]
    port_map_json = {name: int(nid) for name, nid in port_map.items()}

    # Chain node IDs — the runtime uses this to detect intra-chain
    # edges and apply the weight-discount that keeps Dijkstra on the
    # hand-drawn corridor even when a nearby coastal shortcut is a
    # few NM shorter. Without this, a chain that detours offshore is
    # never chosen and the hand-curation was wasted.
    chain_ids_json = sorted(int(nid) for nid in chain_node_ids)

    payload = {
        "meta": {
            "nodeCount": len(nodes_json),
            "edgeCount": len(edges_json),
            "portCount": len(port_map_json),
            "chainNodeCount": len(chain_ids_json),
            "variant": "default",
            "builtAt": datetime.now(timezone.utc).isoformat(),
        },
        "nodes": nodes_json,
        "edges": edges_json,
        "portMap": port_map_json,
        "chainNodeIds": chain_ids_json,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # compact encoding — this file is meant to be parsed, not read.
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print()
    print(f"Wrote {OUT_PATH.relative_to(Path(__file__).parent.parent.parent)}")
    print(f"  nodes: {len(nodes_json):,}")
    print(f"  edges: {len(edges_json):,}")
    print(f"  ports: {len(port_map_json):,}")
    print(f"  size:  {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
