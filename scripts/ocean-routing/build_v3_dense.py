"""
V3 Ocean Routing: V2 (searoute + GSHHG + pilot stations) densified
with a global ocean grid.

Goal: push the graph up to Netpas scale (~50 k nodes) so Dijkstra has
the resolution to find truly realistic shortest paths rather than snap
to whatever is in searoute's 10 k-node backbone.

Densification:
  * Generate a 1° × 1° global grid (~65 k cells).
  * Keep only cells whose centre is water per GSHHG full-res.
  * Connect each kept cell to its 8 lat/lon neighbours (if water, if
    arc is land-safe).
  * Connect each kept cell to its nearest searoute nodes within 2°.
  * Add our 106 ports at their pilot-station coordinates (from V2).
  * Run Dijkstra as before.

Everything else inherits from build_v2_landsafe.py — same coastal
tolerance, same pilot stations, same critical-channel whitelist, same
output format.
"""

from __future__ import annotations

import heapq
import json
import math
import time
from pathlib import Path

from build_v2_landsafe import (
    PORTS, PILOT_STATIONS, effective_port_coord,
    CRITICAL_CHANNELS, in_critical_channel,
    SEAROUTE_GEOJSON, COASTAL_TOLERANCE_NM,
    SAMPLE_STEP_NM, ENDPOINT_BUF_NM,
    load_searoute_network, load_gshhg_with_tolerance,
    arc_is_clear, round_coord,
    dijkstra, reconstruct,
)
from build_sphere_graph import haversine_nm, gc_interpolate

OUTPUT_DIR = Path(__file__).parent / "output"

GRID_STEP_DEG = 1.0                # 1° × 1° resolution
GRID_NEIGHBOR_STEPS = (            # which offsets to connect each cell to
    (1, 0), (0, 1), (-1, 0), (0, -1),      # N, E, S, W
    (1, 1), (1, -1), (-1, 1), (-1, -1),    # NE, NW, SE, SW
    (2, 0), (0, 2), (-2, 0), (0, -2),      # 2-step cardinals for long-haul
    (2, 1), (2, -1), (-2, 1), (-2, -1),
    (1, 2), (1, -2), (-1, 2), (-1, -2),
)
PORT_CONNECT_K = 8
GRID_TO_SEAROUTE_MAX_DEG = 2.5     # connect grid cell to searoute nodes within this lat/lon box


def build_ocean_grid(land) -> dict:
    """
    Return {(lat, lon): node_id} for water cells in a 1° × 1° grid.
    """
    from shapely.geometry import Point
    print(f"Generating {GRID_STEP_DEG}° water grid...")
    grid: dict[tuple[float, float], int] = {}
    # Use cell centres at half-integer offsets so they don't sit
    # directly on 0°, which reduces the chance of them landing exactly
    # on a polygon boundary.
    lats = [round(x, 2) for x in _arange(-89.5, 89.5, GRID_STEP_DEG)]
    lons = [round(x, 2) for x in _arange(-179.5, 179.5, GRID_STEP_DEG)]
    print(f"  {len(lats)} × {len(lons)} = {len(lats) * len(lons):,} candidate cells")
    t0 = time.time()
    water = 0
    for i, lat in enumerate(lats):
        for lon in lons:
            if not land.contains(Point(lon, lat)):
                grid[(lat, lon)] = len(grid)
                water += 1
        if (i + 1) % 30 == 0:
            elapsed = time.time() - t0
            print(f"  row {i + 1}/{len(lats)} ({elapsed:.0f}s, {water:,} water cells so far)")
    print(f"  {water:,} water cells kept")
    return grid


def _arange(start, stop, step):
    x = start
    while x <= stop + 1e-9:
        yield x
        x += step


def build_grid_edges(grid, land):
    """
    Create edges between grid cells (up to GRID_NEIGHBOR_STEPS offsets
    from each cell). Land-validate and keep only safe arcs.
    """
    print("Building grid edges...")
    edges: list[tuple[int, int, float]] = []
    cells = list(grid.keys())
    cell_set = set(cells)
    t0 = time.time()
    for i, (lat, lon) in enumerate(cells):
        nid = grid[(lat, lon)]
        for dlat, dlon in GRID_NEIGHBOR_STEPS:
            nlat = round(lat + dlat * GRID_STEP_DEG, 2)
            nlon = round(lon + dlon * GRID_STEP_DEG, 2)
            if nlon < -180 or nlon > 180:
                continue
            key = (nlat, nlon)
            if key not in cell_set:
                continue
            other = grid[key]
            if other <= nid:
                continue  # avoid duplicate edges
            if not arc_is_clear((lat, lon), (nlat, nlon), land):
                continue
            d_nm = haversine_nm(lat, lon, nlat, nlon)
            edges.append((nid, other, d_nm))
        if (i + 1) % 2000 == 0:
            elapsed = time.time() - t0
            print(f"  {i + 1:,}/{len(cells):,} cells processed "
                  f"({elapsed:.0f}s, {len(edges):,} grid edges)")
    print(f"  {len(edges):,} grid edges")
    return edges


def connect_grid_to_searoute(grid, searoute_nodes, edges, land):
    """For each grid cell find nearby searoute nodes and add edges."""
    from scipy.spatial import cKDTree
    print("Connecting grid ↔ searoute network...")
    sr_coords = [(searoute_nodes[i][0], searoute_nodes[i][1]) for i in sorted(searoute_nodes.keys())]
    tree = cKDTree(sr_coords)

    # We want grid cell id in COMBINED namespace: searoute IDs 0..N-1,
    # then grid IDs start at N.
    sr_n = len(searoute_nodes)
    merged_nodes = dict(searoute_nodes)
    for (lat, lon), gid in grid.items():
        merged_nodes[sr_n + gid] = (lat, lon)

    # Rewrite grid edges into the merged namespace
    shifted_edges: list[tuple[int, int, float]] = [
        (sr_n + a, sr_n + b, w) for a, b, w in edges
    ]

    added = 0
    t0 = time.time()
    for i, ((lat, lon), gid) in enumerate(grid.items()):
        idxs = tree.query_ball_point([lat, lon], r=GRID_TO_SEAROUTE_MAX_DEG)
        for idx in idxs:
            cand_lat, cand_lon = sr_coords[idx]
            if arc_is_clear((lat, lon), (cand_lat, cand_lon), land):
                d = haversine_nm(lat, lon, cand_lat, cand_lon)
                shifted_edges.append((sr_n + gid, idx, d))
                added += 1
        if (i + 1) % 2000 == 0:
            elapsed = time.time() - t0
            print(f"  {i + 1:,}/{len(grid):,} cells wired "
                  f"({elapsed:.0f}s, {added:,} bridge edges)")

    print(f"  Added {added:,} grid↔searoute bridge edges")
    return merged_nodes, shifted_edges


def connect_ports_v3(merged_nodes, edges, land):
    """Attach ports at pilot-station positions to nearest merged nodes."""
    from scipy.spatial import cKDTree
    ids = sorted(merged_nodes.keys())
    coords = [(merged_nodes[i][0], merged_nodes[i][1]) for i in ids]
    tree = cKDTree(coords)
    port_name_to_id: dict[str, int] = {}
    pilot_used = 0
    for port_name in PORTS:
        lat, lon = effective_port_coord(port_name)
        if port_name in PILOT_STATIONS:
            pilot_used += 1
        new_id = max(merged_nodes.keys()) + 1
        merged_nodes[new_id] = (lat, lon)
        port_name_to_id[port_name] = new_id
        # Nearest K by degrees, then filter by land-safe arc
        ks = min(PORT_CONNECT_K * 3, len(coords))
        _, idxs = tree.query([lat, lon], k=ks)
        if not hasattr(idxs, "__len__"):
            idxs = [idxs]
        cands = []
        for idx in idxs:
            other_id = ids[idx]
            d_nm = haversine_nm(lat, lon, merged_nodes[other_id][0], merged_nodes[other_id][1])
            cands.append((d_nm, other_id))
        cands.sort()
        connected = 0
        for d_nm, other_id in cands:
            if connected >= PORT_CONNECT_K:
                break
            if arc_is_clear((lat, lon), merged_nodes[other_id], land):
                edges.append((new_id, other_id, d_nm))
                connected += 1
        if connected == 0:
            d_nm, other_id = cands[0]
            edges.append((new_id, other_id, d_nm))
    print(f"  {pilot_used} ports routed via pilot stations, "
          f"{len(PORTS) - pilot_used} at literal coordinates")
    return port_name_to_id


def main():
    print("=" * 60)
    print("V3 Ocean Routing — searoute + GSHHG + dense 1° grid")
    print("=" * 60)

    land = load_gshhg_with_tolerance()

    print("\nLoading searoute maritime network...")
    sr_nodes, sr_edges = load_searoute_network()
    print(f"  {len(sr_nodes):,} nodes, {len(sr_edges):,} edges")

    print(f"\nFiltering searoute edges (GSHHG, {COASTAL_TOLERANCE_NM} NM tolerance)...")
    t0 = time.time()
    filtered_sr_edges = []
    for i, (a, b, w) in enumerate(sr_edges):
        if arc_is_clear(sr_nodes[a], sr_nodes[b], land):
            filtered_sr_edges.append((a, b, w))
        if (i + 1) % 5000 == 0:
            elapsed = time.time() - t0
            print(f"    {i + 1:,}/{len(sr_edges):,} ({elapsed:.0f}s, "
                  f"{len(filtered_sr_edges):,} kept)")
    print(f"  Kept {len(filtered_sr_edges):,}/{len(sr_edges):,} searoute edges")

    print("\n" + "-" * 60)
    grid = build_ocean_grid(land)

    print()
    grid_edges = build_grid_edges(grid, land)

    print()
    merged_nodes, all_edges = connect_grid_to_searoute(grid, sr_nodes, grid_edges, land)
    # Fold in the surviving searoute edges
    all_edges.extend(filtered_sr_edges)

    print(f"\nTotal graph: {len(merged_nodes):,} nodes, {len(all_edges):,} edges")

    print("\nAttaching 106 ports (pilot stations where defined)...")
    port_ids = connect_ports_v3(merged_nodes, all_edges, land)

    # Build adjacency
    adj: dict[int, list] = {}
    for a, b, w in all_edges:
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))

    print(f"\nAdjacency built ({len(adj):,} nodes in use). Running Dijkstra...")
    port_names = list(PORTS.keys())
    port_node_ids = [port_ids[n] for n in port_names]
    distances: dict[str, float] = {}
    paths: dict[str, list] = {}
    unreachable = []
    t0 = time.time()
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
            coord_path = [merged_nodes[nid] for nid in node_path]
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
        print(f"  {len(unreachable)} unreachable pairs (first 10):")
        for a, b in unreachable[:10]:
            print(f"    {a} <-> {b}")


if __name__ == "__main__":
    main()
