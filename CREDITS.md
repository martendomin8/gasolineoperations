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
| Leaflet | BSD 2-Clause | ✓ (attribution in source headers) |
| react-leaflet | Hippocratic License 2.1 | ✓, with the ethical-use clause we comply with as standard |
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

## Map tiles

The map viewer uses the **CARTO Basemap (`dark_all`)** service, which
is rendered from **OpenStreetMap** data. Both need on-screen
attribution and we display it in the bottom-right corner of every map:

> © OpenStreetMap contributors — © CARTO

- CARTO free tier: https://carto.com/attributions
- OpenStreetMap: https://www.openstreetmap.org/copyright (ODbL)

If per-month tile loads exceed CARTO's free tier (~75k/month) we switch
to MapTiler or self-hosted OpenMapTiles.

## Geographic data

| Source | License | Use |
|--------|---------|-----|
| Natural Earth 10m | Public domain | Coarse land mask (legacy, kept as fallback) |
| GSHHG full-resolution shoreline (Wessel & Smith) | LGPL (shoreline data derived from public-domain WVS/NGA) | Primary land mask for route validation |
| searoute maritime network (eurostat SeaRoute) | Apache 2.0 | Backbone of the ocean routing graph |
| NOAA MarineCadastre AIS | US Government (public domain) | Discovery of tanker ports and real shipping lanes |

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
