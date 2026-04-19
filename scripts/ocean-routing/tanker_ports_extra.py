"""
Additional tanker-capable ports — loaded from tanker_ports_extra.json
which is the single source of truth (also imported by the frontend).

Each entry describes:
  - `name` : canonical port name in "City, CC" form
  - `lat`, `lon` : literal port coord (city/harbour)
               — clickable on the map, shown in tooltips
  - `pilotLat`, `pilotLon` : offshore pilot-boarding position
               — used by Dijkstra as the routing endpoint
  - `tier` : visibility tier (2 = regional, hidden below zoom 4)
  - `aliases` : alternate names the search should match

The JSON can be regenerated from a curated Python dict if needed
(see git history for the original build script), but going forward
the JSON is what lives in version control.
"""

from __future__ import annotations

import json
from pathlib import Path

_JSON_PATH = Path(__file__).parent / "tanker_ports_extra.json"


def _load() -> dict[str, tuple[float, float, float, float, list[str]]]:
    """Read the JSON file and collapse to the (port_lat, port_lon,
    pilot_lat, pilot_lon, aliases) 5-tuple format the rest of the
    pipeline expects."""
    out: dict[str, tuple[float, float, float, float, list[str]]] = {}
    if not _JSON_PATH.exists():
        return out
    data = json.loads(_JSON_PATH.read_text(encoding="utf-8"))
    for entry in data.get("ports", []):
        name = entry.get("name")
        if not name:
            continue
        out[name] = (
            float(entry["lat"]),
            float(entry["lon"]),
            float(entry["pilotLat"]),
            float(entry["pilotLon"]),
            list(entry.get("aliases", [])),
        )
    return out


EXTRA_PORTS: dict[str, tuple[float, float, float, float, list[str]]] = _load()


def count_extra_ports() -> int:
    return len(EXTRA_PORTS)


if __name__ == "__main__":
    print(f"Loaded {count_extra_ports()} extra tanker ports from JSON")
