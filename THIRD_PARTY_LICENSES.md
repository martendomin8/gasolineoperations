# Third-Party Licenses

NEFGO bundles the following third-party libraries. Each entry lists
the package, license, and a one-line note on how we use it. License
texts are not reproduced here; see each package's own `LICENSE` file
(under `node_modules/<pkg>/`) for the authoritative text.

---

## Runtime dependencies

### weatherlayers-gl
- **License**: MPL-2.0 (open-source option, dual-licensed with a
  commercial Terms of Use file; we choose MPL-2.0)
- **Upstream**: https://github.com/weatherlayers/weatherlayers-gl
- **Copyright**: © WeatherLayers
- **How we use it**: The particle / raster / contour layer framework
  that renders our animated wind, wave, and (future) temperature
  overlays on the fleet map. We import it unmodified and wrap it in
  `src/lib/maritime/weather/components/weather-layer.tsx`.
- **MPL-2.0 compliance**: This license is file-level copyleft. As
  long as we do not modify files *inside* the `weatherlayers-gl`
  package, our proprietary application code is unaffected. If we
  ever patch the library itself, those patched files must be made
  available under MPL-2.0. We have not modified it.

### @deck.gl/core, @deck.gl/extensions, @deck.gl/layers, @deck.gl/mapbox
- **License**: MIT
- **Upstream**: https://github.com/visgl/deck.gl
- **Copyright**: © Uber Technologies, Inc. and contributors
- **How we use it**: Rendering infrastructure required by
  `weatherlayers-gl`. Integrated with our MapLibre map via the
  `MapboxOverlay` interleaved pattern.

### @luma.gl/core, @luma.gl/engine
- **License**: MIT
- **Upstream**: https://github.com/visgl/luma.gl
- **Copyright**: © Uber Technologies, Inc. and contributors
- **How we use it**: WebGL abstraction layer that `@deck.gl/*` builds
  on. Not used directly in our code.

### cpt2js
- **License**: MIT
- **Upstream**: https://github.com/weatherlayers/cpt2js
- **Copyright**: © WeatherLayers
- **How we use it**: Parses the GMT-style colour palette strings
  passed to `weatherlayers-gl`'s `palette` prop.

### maplibre-gl, react-map-gl
- **License**: BSD-3-Clause (maplibre-gl), MIT (react-map-gl)
- **Upstream**: https://maplibre.org, https://github.com/visgl/react-map-gl
- **How we use it**: Base map rendering. Not specific to the weather
  feature — used across the whole fleet UI.

---

## Weather data

### NOAA Global Forecast System (GFS) and GFS-Wave
- **License**: **Public domain** (US federal government work, 17 USC § 105)
- **Upstream**: https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- **How we use it**: Fetched every six hours by the
  `scripts/weather-pipeline/` backend, converted to PNG + JSON
  frames, and served to the browser via Vercel Blob. NOAA requires
  no attribution but we acknowledge them in the app's About screen
  as a courtesy.

---

## Changes to this file

This file must be kept in sync with `package.json` when new
dependencies are added. The weather module's MPL-2.0 obligation is
the most significant one; everything else here is permissive-
license (MIT / BSD / public domain) and imposes no redistribution
constraints on our application code.
