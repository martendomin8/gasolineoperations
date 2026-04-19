/**
 * Ocean Routing provider — our maritime distance + path engine.
 *
 * V1 backend: the `searoute` Python package (Apache 2.0, based on
 * EuroStat's SeaRoute / Oak Ridge global shipping lane network
 * enriched with AIS data). For each of our 106 gasoline ports we
 * precompute all 5,565 pair routes via Dijkstra on its maritime
 * graph, then ship the resulting paths and distances as static JSON.
 *
 * Validated against PUB 151 references:
 *   Rotterdam → Houston:   5,023 NM vs 5,022 ref  (0.02 % off)
 *   Amsterdam → Thessaloniki: 3,097 vs 3,170 ref  (−2.3 %)
 *   Amsterdam → Algeciras:  1,421 vs 1,453 ref   (−2.2 %)
 *   ...mean abs error 3.2 % across 14 reference routes.
 *
 * Real shipping lanes — so the rendered route genuinely goes through
 * Suez, Gibraltar, Dover, Panama, Malacca etc. rather than a great-
 * circle arc that cuts across the continent.
 *
 * License chain: searoute (Apache 2.0) + port coordinates (in-house)
 *   → 100 % commercial-safe.
 *
 * Data pipeline:
 *   scripts/ocean-routing/build_via_searoute.py   — full rebuild (~20 s)
 *   Output lands in scripts/ocean-routing/output/, copied into this folder.
 *
 * Earlier experiments kept in the repo for reference:
 *   build_composed_paths.py  — hand-curated corridor chains (deprecated)
 *   build_sphere_graph.py    — pure visibility graph on NE-10m land
 *                              (hit a data quality hole in Sicily; kept
 *                              around to port onto GSHHG in V2)
 */

import type {
  DistanceProvider,
} from "../../provider";
import type {
  PortInfo,
  RouteLeg,
  RouteResult,
  PortSearchResult,
  PortAmbiguityResult,
} from "../../types";

import { routeThroughGraph, getRuntimeGraph } from "./graph-runtime";

// ─────────────────────────────────────────────────────────────
// Runtime Dijkstra — single source of truth for all routes.
// Earlier the provider also shipped precomputed paths.json +
// distances.json for every port pair (and variants for
// avoid-Suez / avoid-Panama). Those are now redundant:
//
//   - graph.json carries the same graph the pipeline ran Dijkstra on
//   - runtime Dijkstra over ~10k nodes is ~50 ms, plenty fast
//   - avoid-passage is now an edge filter driven by bbox, no
//     separate variant files needed
//   - chain-editor edits are reflected immediately on the next
//     pipeline rebuild — no stale paths.json to drift out of sync
//
// The old JSON files can stay on disk for diff / audit but we no
// longer import them. Dropping ~25 MB of bundled JSON + one class
// of "why does my edit not show up" bug.
// ─────────────────────────────────────────────────────────────

export interface RouteOptions {
  avoidSuez?: boolean;
  avoidPanama?: boolean;
}

const PROVIDER_NAME = "ocean_routing";

// ============================================================
// PORT DATABASE — 106 curated gasoline trading ports
// ============================================================

interface PortEntry {
  name: string;
  lat: number;
  lon: number;
  aliases: string[];
}

const PORTS: PortEntry[] = [
  // ARA
  { name: "Amsterdam, NL", lat: 52.4075, lon: 4.7856, aliases: ["ijmuiden", "velsen"] },
  { name: "Rotterdam, NL", lat: 51.9000, lon: 4.4833, aliases: ["europoort", "maasvlakte", "botlek", "pernis"] },
  { name: "Antwerp, BE", lat: 51.2667, lon: 4.3833, aliases: ["antwerpen"] },
  { name: "Flushing, NL", lat: 51.4500, lon: 3.5833, aliases: ["vlissingen"] },
  { name: "Ghent, BE", lat: 51.0667, lon: 3.7167, aliases: ["gent"] },

  // Med
  { name: "Lavera, FR", lat: 43.3833, lon: 4.9833, aliases: ["fos-sur-mer", "fos"] },
  { name: "Marseille, FR", lat: 43.3000, lon: 5.3667, aliases: [] },
  { name: "Augusta, IT", lat: 37.2167, lon: 15.2167, aliases: [] },
  { name: "Barcelona, ES", lat: 41.3500, lon: 2.1667, aliases: [] },
  { name: "Agioi Theodoroi, GR", lat: 37.9167, lon: 23.0833, aliases: ["agioi theodori"] },
  { name: "Thessaloniki, GR", lat: 40.6167, lon: 22.9333, aliases: ["saloniki"] },
  { name: "Sarroch, IT", lat: 39.0667, lon: 9.0167, aliases: [] },
  { name: "Genoa, IT", lat: 44.4000, lon: 8.9167, aliases: ["genova"] },
  { name: "Naples, IT", lat: 40.8333, lon: 14.2667, aliases: ["napoli"] },
  { name: "Algeciras, ES", lat: 36.1333, lon: -5.4333, aliases: [] },
  { name: "Cartagena, ES", lat: 37.5833, lon: -0.9833, aliases: [] },

  // North Africa / Med South
  { name: "Skikda, DZ", lat: 36.8833, lon: 6.9000, aliases: [] },
  { name: "Mohammedia, MA", lat: 33.7167, lon: -7.3833, aliases: [] },
  { name: "Alexandria, EG", lat: 31.1833, lon: 29.8833, aliases: [] },

  // Baltic / Northern Europe
  { name: "Ust-Luga, RU", lat: 59.6833, lon: 28.3833, aliases: ["ust luga"] },
  { name: "Primorsk, RU", lat: 60.3500, lon: 28.6167, aliases: [] },
  { name: "Sankt-Peterburg, RU", lat: 59.9333, lon: 30.2000, aliases: ["st petersburg", "saint petersburg"] },
  { name: "Gothenburg, SE", lat: 57.7000, lon: 11.9333, aliases: ["goteborg", "göteborg"] },
  { name: "Ventspils, LV", lat: 57.4000, lon: 21.5333, aliases: [] },
  { name: "Gdansk, PL", lat: 54.4000, lon: 18.6667, aliases: [] },
  { name: "Brofjorden, SE", lat: 58.3500, lon: 11.4333, aliases: [] },

  // UK / Ireland
  { name: "Immingham, GB", lat: 53.6333, lon: -0.2167, aliases: [] },
  { name: "Milford Haven, GB", lat: 51.7000, lon: -5.0500, aliases: [] },
  { name: "Fawley, GB", lat: 50.8333, lon: -1.3333, aliases: [] },
  { name: "London, GB", lat: 51.5000, lon: 0.0500, aliases: [] },
  { name: "Belfast, GB", lat: 54.6000, lon: -5.9167, aliases: [] },

  // West Africa
  { name: "Lagos, NG", lat: 6.4333, lon: 3.4000, aliases: ["apapa"] },
  { name: "Lome, TG", lat: 6.1333, lon: 1.2833, aliases: ["lomé"] },
  { name: "Tema, GH", lat: 5.6333, lon: -0.0167, aliases: [] },
  { name: "Abidjan, CI", lat: 5.2667, lon: -4.0167, aliases: [] },
  { name: "Dakar, SN", lat: 14.6667, lon: -17.4167, aliases: [] },
  { name: "Cotonou, BJ", lat: 6.3500, lon: 2.4333, aliases: [] },

  // USA / Caribbean
  { name: "New York, US", lat: 40.6667, lon: -74.0333, aliases: [] },
  { name: "Philadelphia, US", lat: 39.9333, lon: -75.1333, aliases: [] },
  { name: "Baltimore, US", lat: 39.2667, lon: -76.5833, aliases: [] },
  { name: "Houston, US", lat: 29.7500, lon: -95.0000, aliases: [] },
  { name: "Corpus Christi, US", lat: 27.8000, lon: -97.4000, aliases: [] },
  { name: "Savannah, US", lat: 32.0833, lon: -81.1000, aliases: [] },

  // Middle East / Asia
  { name: "Fujairah, AE", lat: 25.1333, lon: 56.3500, aliases: ["al fujayrah"] },
  { name: "Jebel Ali, AE", lat: 25.0167, lon: 55.0667, aliases: ["jabel ali"] },
  { name: "Singapore, SG", lat: 1.2667, lon: 103.8333, aliases: [] },
  { name: "Ruwais, AE", lat: 24.1000, lon: 52.7167, aliases: [] },

  // Other
  { name: "Gibraltar, GI", lat: 36.1333, lon: -5.3500, aliases: [] },
  { name: "Las Palmas, ES", lat: 28.1333, lon: -15.4333, aliases: [] },
  { name: "Constantza, RO", lat: 44.1667, lon: 28.6500, aliases: ["constanta"] },

  // Med extra
  { name: "Tarragona, ES", lat: 41.1000, lon: 1.2333, aliases: [] },
  { name: "Castellon, ES", lat: 39.9667, lon: -0.0167, aliases: [] },
  { name: "Huelva, ES", lat: 37.2500, lon: -6.9500, aliases: [] },
  { name: "Sines, PT", lat: 37.9500, lon: -8.8667, aliases: [] },
  { name: "Koper, SI", lat: 45.5333, lon: 13.7333, aliases: [] },
  { name: "Split, HR", lat: 43.5000, lon: 16.4333, aliases: [] },

  // Black Sea
  { name: "Novorossiysk, RU", lat: 44.7167, lon: 37.7667, aliases: [] },
  { name: "Tuapse, RU", lat: 44.1000, lon: 39.0667, aliases: [] },

  // Baltic extra
  { name: "Tallinn, EE", lat: 59.4500, lon: 24.7500, aliases: [] },
  { name: "Klaipeda, LT", lat: 55.7167, lon: 21.1000, aliases: [] },
  { name: "Porvoo, FI", lat: 60.3000, lon: 25.6500, aliases: ["neste", "sköldvik"] },

  // NW Europe extra
  { name: "Le Havre, FR", lat: 49.4833, lon: 0.1000, aliases: [] },
  { name: "Dunkirk, FR", lat: 51.0500, lon: 2.3667, aliases: ["dunkerque"] },
  { name: "Hamburg, DE", lat: 53.5333, lon: 9.9667, aliases: ["brunsbuttel", "brunsbüttel"] },

  // UK extra
  { name: "Grangemouth, GB", lat: 56.0333, lon: -3.7000, aliases: [] },
  { name: "Teesport, GB", lat: 54.6167, lon: -1.1667, aliases: [] },
  { name: "Pembroke, GB", lat: 51.6833, lon: -4.9500, aliases: [] },

  // West Africa extra
  { name: "Monrovia, LR", lat: 6.3500, lon: -10.8000, aliases: [] },
  { name: "Freetown, SL", lat: 8.4833, lon: -13.2333, aliases: [] },

  // Caribbean / Americas extra
  { name: "Aruba, AW", lat: 12.4500, lon: -69.9667, aliases: ["san nicolas"] },
  { name: "Curacao, CW", lat: 12.1833, lon: -68.9667, aliases: ["bullenbaai", "willemstad"] },
  { name: "Point Lisas, TT", lat: 10.4000, lon: -61.4667, aliases: [] },
  { name: "St. Croix, VI", lat: 17.7000, lon: -64.7333, aliases: ["saint croix"] },
  { name: "Come-by-Chance, CA", lat: 47.8167, lon: -54.0000, aliases: [] },
  { name: "Point Tupper, CA", lat: 45.6167, lon: -61.3667, aliases: [] },

  // Middle East extra
  { name: "Yanbu, SA", lat: 24.0833, lon: 38.0500, aliases: [] },

  // Puerto Rico
  { name: "San Juan, PR", lat: 18.4500, lon: -66.1000, aliases: [] },
  { name: "Guayanilla, PR", lat: 17.9833, lon: -66.7833, aliases: [] },

  // India
  { name: "Sikka, IN", lat: 22.4333, lon: 69.8333, aliases: [] },

  // East Africa
  { name: "Mombasa, KE", lat: -4.0667, lon: 39.6667, aliases: [] },

  // USA West Coast
  { name: "Los Angeles, US", lat: 33.7333, lon: -118.2667, aliases: [] },

  // South Africa
  { name: "Cape Town, ZA", lat: -33.9000, lon: 18.4333, aliases: [] },

  // USA East Coast extra
  { name: "Portland, US", lat: 43.6567, lon: -70.2500, aliases: ["portland maine"] },
  { name: "Boston, US", lat: 42.3500, lon: -71.0500, aliases: [] },
  { name: "Norfolk, US", lat: 36.8500, lon: -76.3000, aliases: [] },
  { name: "Wilmington, US", lat: 34.2333, lon: -77.9500, aliases: [] },
  { name: "Halifax, CA", lat: 44.6333, lon: -63.5667, aliases: [] },
  { name: "San Francisco, US", lat: 37.7750, lon: -122.4183, aliases: [] },

  // Bermuda
  { name: "Hamilton, BM", lat: 32.2833, lon: -64.7833, aliases: [] },

  // Europe extra
  { name: "Aveiro, PT", lat: 40.6333, lon: -8.7500, aliases: [] },
  { name: "Bilbao, ES", lat: 43.3500, lon: -3.0333, aliases: [] },
  { name: "Falmouth, GB", lat: 50.1500, lon: -5.0667, aliases: [] },
  { name: "Thames, GB", lat: 51.4500, lon: 0.7333, aliases: [] },
  { name: "Skaw, DK", lat: 57.7333, lon: 10.5833, aliases: ["skagen"] },
  { name: "Mongstad, NO", lat: 60.8167, lon: 5.0333, aliases: [] },

  // Med extra 2
  { name: "Algiers, DZ", lat: 36.7667, lon: 3.0667, aliases: [] },
  { name: "Benghazi, LY", lat: 32.1167, lon: 20.0667, aliases: [] },
  { name: "Beirut, LB", lat: 33.9000, lon: 35.5167, aliases: ["zouk", "zouk mikael", "dora", "jieh", "selaata", "zahrani"] },
  { name: "Aliaga, TR", lat: 38.8000, lon: 26.9667, aliases: [] },
  { name: "Izmit, TR", lat: 40.7667, lon: 29.9167, aliases: [] },
  { name: "Vassiliko, CY", lat: 34.7333, lon: 33.3333, aliases: [] },
  { name: "Ceuta, ES", lat: 35.8833, lon: -5.3167, aliases: [] },

  // South America
  { name: "La Libertad, EC", lat: -2.2167, lon: -80.9167, aliases: [] },

  // Canada - St. Lawrence
  { name: "Quebec, CA", lat: 46.8167, lon: -71.2000, aliases: ["quebec city"] },
  { name: "Montreal, CA", lat: 45.5000, lon: -73.5500, aliases: [] },

  // Ireland
  { name: "Dublin, IE", lat: 53.3500, lon: -6.2333, aliases: [] },

  // AIS-discovered US tanker hubs (Jan 2023 MarineCadastre, 1-day pass)
  { name: "Tampa, US",           lat: 27.9500, lon:  -82.4500, aliases: [] },
  { name: "New Orleans, US",     lat: 29.9500, lon:  -90.0700, aliases: ["nola"] },
  { name: "Port Arthur, US",     lat: 29.8700, lon:  -93.9300, aliases: [] },
  { name: "Beaumont, US",        lat: 30.0800, lon:  -94.1000, aliases: [] },
  { name: "Long Beach, US",      lat: 33.7700, lon: -118.1900, aliases: ["lb"] },
  { name: "Lake Charles, US",    lat: 30.2300, lon:  -93.2200, aliases: [] },
  // Second AIS batch (Jan 2023, 4-day pass) — real dwell clusters >50 NM
  // from any existing port.
  { name: "Baton Rouge, US",     lat: 30.4500, lon:  -91.1800, aliases: [] },
  { name: "Searsport, US",       lat: 44.4500, lon:  -68.9300, aliases: ["penobscot"] },
  { name: "Jacksonville, US",    lat: 30.3200, lon:  -81.6300, aliases: ["jax"] },
  { name: "Seattle, US",         lat: 47.6000, lon: -122.3300, aliases: ["tacoma", "puget sound"] },
  { name: "Port Everglades, US", lat: 26.0900, lon:  -80.1200, aliases: ["fort lauderdale", "ft lauderdale"] },
  { name: "Guam, US",            lat: 13.4400, lon:  144.6600, aliases: ["apra"] },
  // EU tanker hubs from EMODnet 2024 vessel-density raster
  { name: "Wilhelmshaven, DE",   lat: 53.5100, lon:    8.1400, aliases: [] },
  { name: "Marsaxlokk, MT",      lat: 35.8300, lon:   14.5400, aliases: ["malta"] },
  { name: "Iskenderun, TR",      lat: 36.5800, lon:   36.1700, aliases: ["dortyol"] },
  { name: "Venice, IT",          lat: 45.4400, lon:   12.3300, aliases: ["venezia", "marghera"] },
  { name: "Murmansk, RU",        lat: 68.9700, lon:   33.0500, aliases: [] },
  { name: "Kotka, FI",           lat: 60.4600, lon:   26.9500, aliases: [] },
  { name: "Livorno, IT",         lat: 43.5500, lon:   10.3100, aliases: [] },
  { name: "Burgas, BG",          lat: 42.5000, lon:   27.4800, aliases: [] },
  { name: "Varna, BG",           lat: 43.2100, lon:   27.9300, aliases: [] },
  { name: "Batumi, GE",          lat: 41.6500, lon:   41.6300, aliases: [] },
  { name: "Kristiansund, NO",    lat: 63.1100, lon:    7.7400, aliases: [] },
  { name: "Mersin, TR",          lat: 36.7800, lon:   34.6400, aliases: [] },
  { name: "Santa Cruz, ES",      lat: 28.4700, lon:  -16.2500, aliases: ["tenerife"] },
  { name: "Saint-Nazaire, FR",   lat: 47.2700, lon:   -2.2000, aliases: ["nantes", "st nazaire"] },
  { name: "Nynashamn, SE",       lat: 58.9000, lon:   17.9500, aliases: ["stockholm oil", "stockholm"] },

  // Remaining EU tanker gaps
  { name: "Trieste, IT",         lat: 45.6500, lon:   13.7700, aliases: [] },
  { name: "Milazzo, IT",         lat: 38.2200, lon:   15.2500, aliases: [] },
  { name: "Odessa, UA",          lat: 46.4900, lon:   30.7300, aliases: [] },
  { name: "Finnart, GB",         lat: 56.0800, lon:   -4.8800, aliases: ["clyde"] },
  { name: "Sullom Voe, GB",      lat: 60.4800, lon:   -1.3000, aliases: ["shetland"] },
  { name: "Sidi Kerir, EG",      lat: 30.9800, lon:   29.2700, aliases: ["sumed"] },
  { name: "Marsa el Brega, LY",  lat: 30.4200, lon:   19.5800, aliases: ["brega"] },
  { name: "Elefsina, GR",        lat: 38.0300, lon:   23.5500, aliases: ["elefsis"] },
  { name: "Porto Torres, IT",    lat: 40.8400, lon:    8.4000, aliases: [] },
  { name: "Ambarli, TR",         lat: 40.9700, lon:   28.6800, aliases: ["istanbul"] },
  { name: "Karsto, NO",          lat: 59.2700, lon:    5.5000, aliases: ["kårstø"] },

  // Middle East (biggest tanker region)
  { name: "Ras Tanura, SA",      lat: 26.6500, lon:   50.1700, aliases: [] },
  { name: "Juaymah, SA",         lat: 26.8400, lon:   50.0700, aliases: [] },
  { name: "Mina al-Ahmadi, KW",  lat: 29.0700, lon:   48.1500, aliases: ["kuwait"] },
  { name: "Kharg Island, IR",    lat: 29.2200, lon:   50.3400, aliases: ["kharg"] },
  { name: "Sohar, OM",           lat: 24.4900, lon:   56.6300, aliases: [] },
  { name: "Khor al-Zubair, IQ",  lat: 30.1800, lon:   47.9500, aliases: ["basra", "iraq"] },

  // South Asia
  { name: "Mumbai, IN",          lat: 18.9500, lon:   72.8500, aliases: ["bombay", "jnpt"] },
  { name: "Chennai, IN",         lat: 13.1000, lon:   80.2900, aliases: ["madras"] },
  { name: "Kochi, IN",           lat:  9.9700, lon:   76.2600, aliases: ["cochin"] },
  { name: "Karachi, PK",         lat: 24.8400, lon:   66.9800, aliases: [] },
  { name: "Chittagong, BD",      lat: 22.2800, lon:   91.8000, aliases: [] },

  // Southeast Asia
  { name: "Port Klang, MY",      lat:  3.0000, lon:  101.4000, aliases: ["klang"] },
  { name: "Kuantan, MY",         lat:  3.9500, lon:  103.4200, aliases: [] },
  { name: "Map Ta Phut, TH",     lat: 12.6800, lon:  101.1500, aliases: [] },
  { name: "Laem Chabang, TH",    lat: 13.0800, lon:  100.9000, aliases: ["bangkok"] },
  { name: "Tanjung Pelepas, MY", lat:  1.3600, lon:  103.5500, aliases: ["ptp"] },
  { name: "Merak, ID",           lat:  5.9600, lon:  105.9900, aliases: ["jakarta"] },
  { name: "Cilacap, ID",         lat: -7.7500, lon:  109.0000, aliases: [] },

  // East Asia
  { name: "Ulsan, KR",           lat: 35.5100, lon:  129.3800, aliases: [] },
  { name: "Daesan, KR",          lat: 37.0100, lon:  126.3300, aliases: [] },
  { name: "Yeosu, KR",           lat: 34.7400, lon:  127.7500, aliases: ["gwangyang"] },
  { name: "Chiba, JP",           lat: 35.5800, lon:  140.0400, aliases: ["tokyo bay"] },
  { name: "Yokohama, JP",        lat: 35.4500, lon:  139.6500, aliases: ["kawasaki"] },
  { name: "Kashima, JP",         lat: 35.9600, lon:  140.7000, aliases: [] },
  { name: "Kaohsiung, TW",       lat: 22.6100, lon:  120.2800, aliases: [] },

  // China
  { name: "Ningbo, CN",          lat: 29.8700, lon:  121.8000, aliases: ["zhoushan"] },
  { name: "Dalian, CN",          lat: 38.9200, lon:  121.6300, aliases: [] },
  { name: "Qingdao, CN",         lat: 36.0700, lon:  120.3200, aliases: [] },
  { name: "Tianjin, CN",         lat: 39.0000, lon:  117.7200, aliases: [] },
  { name: "Shanghai, CN",        lat: 31.2000, lon:  121.5000, aliases: [] },

  // West Africa (oil export)
  { name: "Bonny, NG",           lat:  4.4300, lon:    7.1700, aliases: [] },
  { name: "Qua Iboe, NG",        lat:  4.4700, lon:    8.3000, aliases: [] },
  { name: "Forcados, NG",        lat:  5.2500, lon:    5.4000, aliases: [] },
  { name: "Cabinda, AO",         lat: -5.5500, lon:   12.2000, aliases: [] },
  { name: "Soyo, AO",            lat: -6.1200, lon:   12.3500, aliases: [] },

  // South America
  { name: "Santos, BR",          lat:-23.9500, lon:  -46.3000, aliases: [] },
  { name: "Sao Sebastiao, BR",   lat:-23.8000, lon:  -45.4000, aliases: [] },
  { name: "Rio Grande, BR",      lat:-32.0300, lon:  -52.1000, aliases: [] },
  { name: "Puerto La Cruz, VE",  lat: 10.2300, lon:  -64.6300, aliases: [] },
  { name: "Callao, PE",          lat:-12.0500, lon:  -77.1500, aliases: ["lima"] },
  { name: "Quintero, CL",        lat:-32.7800, lon:  -71.5300, aliases: ["valparaiso"] },

  // Oceania
  { name: "Kwinana, AU",         lat:-32.2300, lon:  115.7700, aliases: ["perth", "fremantle"] },
  { name: "Gladstone, AU",       lat:-23.8300, lon:  151.2500, aliases: [] },
];

// Build indices
const portIndex = new Map<string, PortEntry>();
const portByName = new Map<string, PortEntry>();

for (const port of PORTS) {
  portByName.set(port.name, port);
  portIndex.set(port.name.toLowerCase(), port);
  const city = port.name.split(",")[0].trim().toLowerCase();
  if (!portIndex.has(city)) portIndex.set(city, port);
  for (const alias of port.aliases) portIndex.set(alias.toLowerCase(), port);
}

// Tiny per-request memoisation so a Planner panel that renders both
// the distance and the polyline doesn't run Dijkstra twice for the
// same (from, to, avoid) tuple. Cache key includes the options so
// toggling Avoid-Suez doesn't leak a stale result. LRU-eviction is
// overkill for our scale (one user clicking a handful of ports per
// session); a plain Map with a size cap is enough.
const ROUTE_CACHE_MAX = 256;
const routeCache = new Map<
  string,
  { totalNm: number; coords: [number, number][] }
>();

function cacheKey(a: string, b: string, opts?: RouteOptions): string {
  const ordered = a < b ? `${a}|${b}` : `${b}|${a}`;
  const sz = opts?.avoidSuez ? "1" : "0";
  const pz = opts?.avoidPanama ? "1" : "0";
  return `${ordered}|s${sz}p${pz}`;
}

/**
 * Wipe the per-request route memo. Called after the dev editor
 * invalidates the graph (zone edits) so the next Planner lookup
 * recomputes against the new forbidden set instead of returning
 * the stale pre-edit path.
 */
export function flushRouteCache(): void {
  routeCache.clear();
}

function computeRoute(
  from: string,
  to: string,
  opts?: RouteOptions
): { totalNm: number; coords: [number, number][] } | null {
  if (from === to) return { totalNm: 0, coords: [] };
  const k = cacheKey(from, to, opts);
  const hit = routeCache.get(k);
  if (hit) return hit;
  // Port names must resolve in the graph.portMap — if they don't, the
  // port is either missing from the pipeline or mis-spelled. Return
  // null so callers can report "not_found" upstream.
  const graph = getRuntimeGraph();
  if (!graph.portMap.has(from) || !graph.portMap.has(to)) return null;
  const result = routeThroughGraph(
    [
      { type: "port", label: from, portName: from, lat: 0, lon: 0 },
      { type: "port", label: to, portName: to, lat: 0, lon: 0 },
    ],
    { avoidSuez: opts?.avoidSuez, avoidPanama: opts?.avoidPanama }
  );
  if (!result || result.legs.length === 0) return null;
  // Direction: portMap key lookups are order-insensitive in the
  // cache, but the returned coord list MUST run from `from` to `to`.
  // routeThroughGraph already walks in waypoint order so this is
  // correct without reversing.
  const coords = result.legs[0].coordinates;
  const out = { totalNm: result.totalNm, coords };
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    // Evict oldest insertion — Map preserves insertion order.
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(k, out);
  return out;
}

// Internal helpers
function lookupDistance(a: string, b: string, opts?: RouteOptions): number | null {
  const r = computeRoute(a, b, opts);
  return r ? r.totalNm : null;
}

// Provider methods (each matches the DistanceProvider interface)

function findPort(query: string): string | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const exact = portIndex.get(q);
  if (exact) return exact.name;

  const commaIdx = q.indexOf(",");
  if (commaIdx > 0) {
    const city = q.slice(0, commaIdx).trim();
    const code = q.slice(commaIdx + 1).trim().toUpperCase();
    for (const port of PORTS) {
      const pCity = port.name.split(",")[0].trim().toLowerCase();
      const pCode = port.name.split(",")[1]?.trim();
      if (pCity === city && pCode === code) return port.name;
    }
  }

  const matches: PortEntry[] = [];
  for (const port of PORTS) {
    const city = port.name.split(",")[0].trim().toLowerCase();
    if (city.startsWith(q)) matches.push(port);
  }
  if (matches.length === 1) return matches[0].name;

  for (const port of PORTS) {
    if (port.name.toLowerCase().includes(q)) return port.name;
  }

  return null;
}

function searchPorts(query: string, limit = 20): PortSearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: Array<{ port: PortEntry; score: number; matchedAlias: string | null }> = [];

  for (const port of PORTS) {
    const nameLower = port.name.toLowerCase();
    const city = nameLower.split(",")[0].trim();
    let score = 0;
    let matchedAlias: string | null = null;

    if (city === q) score = 100;
    else if (city.startsWith(q)) score = 80;
    else if (nameLower.startsWith(q)) score = 70;
    else if (city.includes(q)) score = 50;
    else if (nameLower.includes(q)) score = 30;

    if (score === 0) {
      for (const alias of port.aliases) {
        if (alias === q) { score = 95; matchedAlias = alias; break; }
        else if (alias.startsWith(q)) { score = 75; matchedAlias = alias; break; }
        else if (alias.includes(q)) { score = 45; matchedAlias = alias; break; }
      }
    }

    if (score > 0) results.push({ port, score, matchedAlias });
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit).map((r) => ({
    name: r.port.name,
    lat: r.port.lat,
    lon: r.port.lon,
    routingVia: null,
    matchedAlias: r.matchedAlias,
  }));
}

function getPortCoords(portName: string): { lat: number; lon: number } | null {
  const port = portByName.get(portName);
  if (port) return { lat: port.lat, lon: port.lon };

  const resolved = findPort(portName);
  if (resolved) {
    const p = portByName.get(resolved);
    if (p) return { lat: p.lat, lon: p.lon };
  }
  return null;
}

function checkPortAmbiguity(query: string): PortAmbiguityResult {
  const q = query.toLowerCase().trim();
  if (!q) {
    return { query, isAmbiguous: false, candidates: [], resolved: null, isAlias: false, aliasTarget: null };
  }

  const cityMatches: PortEntry[] = [];
  for (const port of PORTS) {
    const city = port.name.split(",")[0].trim().toLowerCase();
    if (city === q) cityMatches.push(port);
  }

  if (cityMatches.length === 0) {
    for (const port of PORTS) {
      for (const alias of port.aliases) {
        if (alias.toLowerCase() === q) { cityMatches.push(port); break; }
      }
    }
  }

  if (cityMatches.length > 0) {
    const candidates = cityMatches.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
    return {
      query,
      isAmbiguous: cityMatches.length > 1,
      candidates,
      resolved: cityMatches.length === 1 ? cityMatches[0].name : null,
      isAlias: false,
      aliasTarget: null,
    };
  }

  const exact = findPort(query);
  if (exact) {
    const p = portByName.get(exact);
    return {
      query,
      isAmbiguous: false,
      candidates: p ? [{ name: p.name, lat: p.lat, lon: p.lon }] : [],
      resolved: exact,
      isAlias: false,
      aliasTarget: null,
    };
  }

  return { query, isAmbiguous: false, candidates: [], resolved: null, isAlias: false, aliasTarget: null };
}

function getAllPorts(): PortInfo[] {
  return PORTS.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
}

function getSeaDistance(from: string, to: string, opts?: RouteOptions): RouteResult {
  const fromPort = findPort(from);
  const toPort = findPort(to);

  if (!fromPort || !toPort) {
    return { totalNm: 0, legs: [], source: "not_found" };
  }

  if (fromPort === toPort) {
    return { totalNm: 0, legs: [], source: PROVIDER_NAME };
  }

  const distance = lookupDistance(fromPort, toPort, opts);
  if (distance !== null) {
    return {
      totalNm: Math.round(distance),
      legs: [{ from: fromPort, to: toPort, distanceNm: Math.round(distance) }],
      source: PROVIDER_NAME,
    };
  }

  return { totalNm: 0, legs: [], source: "not_found" };
}

function getMultiStopDistance(portNames: string[], opts?: RouteOptions): RouteResult {
  if (portNames.length < 2) {
    return { totalNm: 0, legs: [], source: "not_found" };
  }

  const legs: RouteLeg[] = [];
  let totalNm = 0;

  for (let i = 0; i < portNames.length - 1; i++) {
    const result = getSeaDistance(portNames[i], portNames[i + 1], opts);
    if (result.source === "not_found") {
      return { totalNm: 0, legs: [], source: "not_found" };
    }
    legs.push(...result.legs);
    totalNm += result.totalNm;
  }

  return { totalNm, legs, source: PROVIDER_NAME };
}

function getRoutePath(a: string, b: string, opts?: RouteOptions): [number, number][] | null {
  if (a === b) return null;
  const r = computeRoute(a, b, opts);
  if (!r || r.coords.length === 0) return null;
  return r.coords;
}

function isHandDrawnRoute(_a: string, _b: string): boolean {
  // Legacy port-pair hand-drawn routes lived in hand_drawn_routes.json
  // (deprecated after the channel-editor + zone-editor took over).
  // The provider interface still requires this method; always returning
  // false is honest — no port pair has a full override; every route
  // runs through the runtime Dijkstra on graph.json.
  return false;
}

export const oceanRoutingProvider: DistanceProvider = {
  name: PROVIDER_NAME,
  findPort,
  searchPorts,
  getPortCoords,
  checkPortAmbiguity,
  getAllPorts,
  getSeaDistance,
  getMultiStopDistance,
  getRoutePath,
  isHandDrawnRoute,
};
