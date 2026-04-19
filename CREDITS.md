# Third-Party Credits & Licenses

This file lists every third-party library, data source, and map service
the NEFGO platform relies on, with licences and any attribution the
authors ask us to carry. Keeping this file up to date is a legal and
ethical obligation — and the single place a lawyer or auditor should
look first.

## Runtime libraries

| Dependency | License | Commercial use |
|------------|---------|----------------|
| Next.js, React, TypeScript | MIT | ✓ |
| MapLibre GL JS | BSD 3-Clause | ✓ (on-screen "MapLibre" credit in the map attribution bar) |
| react-map-gl (MapLibre variant) | MIT | ✓ |
| Leaflet | BSD 2-Clause | ✓ (legacy — kept in repo until MapLibre migration is verified) |
| react-leaflet | Hippocratic License 2.1 | ✓, ethical-use clause satisfied as standard |
| Drizzle ORM | Apache 2.0 | ✓ |
| lucide-react (icons) | ISC | ✓ |
| turf.js (client geometry) | MIT | ✓ |

## Python build tooling

| Dependency | License | Commercial use |
|------------|---------|----------------|
| Shapely | BSD 3-Clause | ✓ |
| pyshp | MIT | ✓ |
| NetworkX | BSD 3-Clause | ✓ |
| SciPy | BSD 3-Clause | ✓ |
| `searoute` (Python package) | Apache 2.0 | ✓ (ships with the eurostat SeaRoute maritime network) |

## Map tiles & basemap imagery

The Fleet map has two user-selectable basemaps. Both render their
attribution automatically through MapLibre's `AttributionControl`
(always visible at bottom-right — `compact={false}` so the credits
never hide behind an "i" icon).

### Dark vector (default) — CARTO

- Style: `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
- Tiles served by **CARTO**, rendered from **OpenStreetMap** vector data.
- Attribution: `© MapLibre | © OpenStreetMap contributors © CARTO`
- Free tier covers ~75k map loads/month. If we exceed it, fallback is
  MapTiler Dark or a self-hosted OpenMapTiles build.
- CARTO terms: https://carto.com/attributions
- OpenStreetMap ODbL: https://www.openstreetmap.org/copyright

### Satellite — EOX Sentinel-2 Cloudless

- Tiles: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/...`
- Pre-processed global cloud-free composite built from a full year of
  ESA Sentinel-2 observations. 10 m/px native resolution.
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
  on the composite, **Copernicus Data Licence** on the underlying
  Sentinel-2 data — both commercial-use-friendly with attribution.
- Required attribution (emitted on the map): `Sentinel-2 Cloudless ©
  EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023)`
- EOX terms: https://s2maps.eu
- Copernicus terms: https://sentinel.esa.int/documents/247904/690755/Sentinel_Data_Legal_Notice

### Upgrade path

For submeter sharpness on the globe view we can swap to Mapbox
Satellite (free tier ≤50k loads/mo, `$5/1000` after) or MapTiler
Satellite (free tier ≤500k tile loads/mo). Both allow commercial
use on their free tiers — see `docs/MARITIME-ROADMAP.md` for the
cost table.

## Geographic data

| Source | License | Use |
|--------|---------|-----|
| Natural Earth 10m | Public domain | Coarse land mask (legacy, kept as fallback) |
| GSHHG full-resolution shoreline (Wessel & Smith) | LGPL (shoreline data derived from public-domain WVS/NGA) | Primary land mask for route validation |
| searoute maritime network (eurostat SeaRoute) | Apache 2.0 | Backbone of the ocean routing graph |
| NOAA MarineCadastre AIS | US Government (public domain) | Discovery of tanker ports and real shipping lanes |
| NOAA ETOPO 2022 (60 arc-sec bed elevation) | US Government (public domain) | Bathymetry-aware routing — blocks transit arcs over water shallower than tanker safety depth. Not redistributed, derived depth thresholds are stored in our graph. |

When GSHHG is used as a derivative data source (our build scripts
ingest it, we ship derived distance tables, never the raw polygons)
we credit Wessel & Smith in the `build_sphere_graph.py` file header
and in this document.

## Future data sources (planned)

| Source | License | Intended use |
|--------|---------|--------------|
| EMODnet vessel-density rasters | CC BY 4.0 + attribution | European shipping-lane heatmap, port discovery |
| HELCOM Baltic AIS density | Open, attribution | Baltic ship-type density |
| NGA World Port Index (PUB 150) | US gov public domain | Bulk port import (~3 700 ports) |
| OpenSeaMap (TSS, buoys) | ODbL, attribution | Traffic Separation Schemes |

All future additions will be appended here with their licence
and any attribution the source requires.
