/**
 * NEFGO weather provider configuration.
 *
 * All public env vars are surfaced here rather than scattered across
 * the provider internals, so switching stores (dev vs prod, different
 * Blob shards) is a one-file change.
 */

/**
 * Base URL of the store that the Python pipeline writes to.
 *
 * Two modes are supported:
 *
 *   1. **Same-origin / demo mode** (empty string, the default).
 *      The pipeline runs with `run_pipeline.py --local public/weather`
 *      and writes PNG + JSON + manifest into Next.js's `public/weather/`
 *      directory. The browser fetches `/weather/manifest.json` from the
 *      same origin. No cloud storage, no tokens, no Marten. Perfect
 *      for local dev, investor demos on Arne's laptop, and Claude
 *      Preview verification runs.
 *
 *   2. **Remote CDN mode** (env var set). Set
 *      `NEXT_PUBLIC_WEATHER_CDN_BASE_URL=https://<store-id>.public.blob.vercel-storage.com`
 *      when the production Vercel Blob store is provisioned (see
 *      `docs/MARTEN-HANDOFF.md`). The provider will then fetch from
 *      that absolute URL instead.
 *
 * The value is read at module load time — components that import the
 * provider resolve the mode immediately at bootstrap.
 */
export const WEATHER_CDN_BASE_URL: string =
  process.env.NEXT_PUBLIC_WEATHER_CDN_BASE_URL ?? "";

/** Path of the manifest file, relative to the base URL (or to `/` in
 *  same-origin mode). */
export const MANIFEST_PATHNAME = "weather/manifest.json";

/**
 * How long (ms) the manifest stays in the in-memory cache before we
 * refetch. The pipeline updates on a 6h cadence, so 10 minutes is a
 * comfortable default — short enough that a dev running the pipeline
 * locally sees changes quickly, long enough that normal slider
 * scrubbing never triggers a refetch.
 */
export const MANIFEST_TTL_MS = 10 * 60 * 1000;

export function manifestUrl(baseUrl: string = WEATHER_CDN_BASE_URL): string {
  if (baseUrl === "") {
    // Same-origin / public/ mode — browser resolves against current origin.
    return `/${MANIFEST_PATHNAME}`;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${MANIFEST_PATHNAME}`;
}
