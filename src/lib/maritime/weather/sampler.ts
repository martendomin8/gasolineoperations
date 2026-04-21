/**
 * Weather-frame pixel sampler — reads a real-world value from a PNG
 * weather frame at a specific lat/lon.
 *
 * This is the primitive that powers the click-on-map popup
 * (`<WeatherPointPopup>`) and the future ship-weather popup. Both
 * surfaces need the same answer: *given the currently-loaded frame,
 * what are the u/v or scalar values at this point?*
 *
 * Design notes:
 *
 * 1. We could have leant on `weatherlayers-gl`'s `getRasterPoints`
 *    helper, but pulling its internal image-loading path out here
 *    would couple this file to library internals. A 20-line canvas
 *    decoder is simpler to own.
 *
 * 2. Decoding a 1440×721 PNG takes ~10 ms on a warm browser; the
 *    `imageDataCache` keeps the decoded `ImageData` in memory per
 *    pngUrl so repeat samples (slider scrubbing, multi-layer click)
 *    only pay once.
 *
 * 3. Alpha < ~10 means the pipeline marked that pixel as invalid
 *    (typically land for wave data or partial-blur fade). We treat
 *    that as "no data here" and return `null` rather than a
 *    garbage number from the R/G channels.
 */

import type { WeatherFrame } from "./types";

const imageDataCache = new Map<string, ImageData>();

async function loadImageData(url: string): Promise<ImageData> {
  const cached = imageDataCache.get(url);
  if (cached !== undefined) return cached;

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("Failed to get 2D canvas context");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  imageDataCache.set(url, data);
  return data;
}

export interface VectorSample {
  u: number;
  v: number;
  magnitude: number;
  /** Compass bearing in degrees, 0 = north, 90 = east. */
  directionDeg: number;
}

export interface ScalarSample {
  value: number;
}

export interface SampledValue {
  vector?: VectorSample;
  scalar?: ScalarSample;
  unit?: string;
}

/**
 * Sample one frame at lat/lon. Returns `null` if the point is
 * outside the frame's bounds or falls on an invalid pixel (alpha=0).
 */
export async function sampleFrame(
  frame: WeatherFrame,
  lat: number,
  lon: number,
): Promise<SampledValue | null> {
  const { imageType, imageUnscale, unit } = frame.metadata;
  if (imageUnscale === undefined) return null;

  const data = await loadImageData(frame.pngUrl);
  const [west, south, east, north] = frame.bounds;

  if (lat < south || lat > north) return null;

  // Longitude wrap: our pipeline emits PNGs with `west..east` typically
  // spanning -180..180 (or 0..360 for some sources). Normalise the
  // query lon into the same convention before indexing.
  let qLon = lon;
  if (west >= 0 && east > 180 && qLon < 0) qLon += 360;
  if (west < -180 || east < west) {
    // Unusual wrap case — not produced by our pipeline, bail out.
    return null;
  }
  if (qLon < west || qLon > east) return null;

  const px = Math.floor(((qLon - west) / (east - west)) * data.width);
  const py = Math.floor(((north - lat) / (north - south)) * data.height);
  const pxC = Math.max(0, Math.min(data.width - 1, px));
  const pyC = Math.max(0, Math.min(data.height - 1, py));

  const i = (pyC * data.width + pxC) * 4;
  const r = data.data[i];
  const g = data.data[i + 1];
  const a = data.data[i + 3];

  // Alpha-0 is our pipeline's "no data / land" marker. Low alpha
  // means soft-masked (near-coast waves fade) — treat as no-data so
  // we don't quote a bogus "30% of true value" number.
  if (a < 32) return null;

  const [minV, maxV] = imageUnscale;
  const span = maxV - minV;

  if (imageType === "VECTOR") {
    const u = minV + (r / 255) * span;
    const v = minV + (g / 255) * span;
    const magnitude = Math.sqrt(u * u + v * v);
    // atan2(u, v): angle where the vector POINTS TO, measured
    // clockwise from north. For wind this is the "wind heading"
    // (direction it's blowing towards). For wave propagation we
    // store the "from" direction already in the pipeline, so the
    // caller can relabel as needed.
    const rad = Math.atan2(u, v);
    const deg = ((rad * 180) / Math.PI + 360) % 360;
    return {
      vector: { u, v, magnitude, directionDeg: deg },
      unit,
    };
  }

  // SCALAR: value is packed into R only.
  const value = minV + (r / 255) * span;
  return { scalar: { value }, unit };
}
