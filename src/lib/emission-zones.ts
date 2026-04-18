/**
 * IMO MARPOL Annex VI Emission Control Areas (ECA / SECA / NECA).
 *
 * Netpas-style representation:
 *   1. `fillPolygon` — a generous bounding polygon covering the full
 *      regulatory zone (including any land that falls inside). We
 *      render it with very low opacity (~5%) so only the sea gets a
 *      visible tint; land inside the zone gets a barely-perceptible
 *      hue shift.
 *   2. `boundaries` — the **straight regulatory boundary lines** as
 *      they're written in MARPOL text (e.g. "parallel 62°N",
 *      "longitude 5°W"). Coastal portions are *not* drawn — the
 *      basemap's own coastline already shows where water ends, so
 *      drawing extra coast-tracing lines would be redundant and
 *      visually noisy. This matches what Netpas Distance does on its
 *      chart view.
 *
 * Good enough for an on-map overlay telling operators where
 * low-sulphur / low-NOx fuel rules apply. NOT a substitute for the
 * official charts when bunkering.
 *
 * Sources (all public regulatory text):
 *   - IMO MARPOL Annex VI, Regulations 13 & 14
 *   - MARPOL Annex V Reg 5(1)(f) for the North Sea geometry
 *   - MARPOL Annex I Reg 1.11.2 for the Baltic geometry
 *   - Mediterranean SECA added May 2025 per IMO MEPC 79 resolution
 */

export interface EmissionZone {
  /** Short id used for React keys. */
  id: string;
  /** Display name on the map legend. */
  name: string;
  /**
   * Zone type — SECA = sulphur-only, NECA = nitrogen-oxide-only,
   * ECA = both. Displayed next to the name.
   */
  type: "SECA" | "NECA" | "ECA";
  /**
   * Bounding polygon used for the sea-tint fill. Includes land
   * inside the zone; low fill opacity keeps that invisible.
   */
  fillPolygon: Array<[number, number]>;
  /**
   * The offshore regulatory boundary segments, each a polyline.
   * Usually just two endpoints per segment because MARPOL defines
   * them as literal meridians / parallels.
   */
  boundaries: Array<Array<[number, number]>>;
  /** In force since (shown as hover info). */
  effective: string;
  /** Where to anchor the hover tooltip. */
  labelAnchor: [number, number];
}

export const EMISSION_ZONES: EmissionZone[] = [
  {
    id: "baltic-seca",
    name: "Baltic Sea",
    type: "ECA",
    effective: "SECA 2006 · NECA 2021",
    labelAnchor: [58.5, 20.0],
    /*
     * Per MARPOL Annex I Reg 1.11.2: Baltic Sea proper + Gulf of
     * Bothnia + Gulf of Finland + entrance up to 57°44.8'N.
     *
     * fillPolygon traces the outer edge of the Baltic region with
     * ~30-80 km of inland margin so the sea is always fully covered
     * at the coast (previous version left diagonal gaps). Low fill
     * opacity keeps the slight land overlap barely perceptible.
     * The sole offshore regulatory line is 57°44.8'N across the
     * Kattegat between Skagen (DK) and Sweden.
     */
    fillPolygon: [
      // Entry at Skagen (Danish N tip, on 57.74°N boundary)
      [57.74, 10.40],
      // Jutland E coast going S (Kattegat inside polygon)
      [56.90, 10.30],   // Aarhus hinterland
      [55.90, 10.00],   // E Jutland inland
      [54.80, 10.30],   // Fyn / Lolland (Danish islands inside)
      [54.30, 11.30],
      // N Germany Baltic coast inland
      [54.20, 13.00],   // Rügen hinterland
      [53.90, 14.00],   // Usedom / Polish border
      // Poland coast inland
      [54.10, 15.80],
      [54.50, 17.50],   // Gdansk hinterland (Gdansk at 54.3°N 18.6°E)
      [54.60, 19.50],   // Polish / Kaliningrad border
      // Kaliningrad (Russian enclave)
      [54.70, 20.40],
      [55.00, 21.30],   // Lithuanian border (Nida inland)
      // Lithuania coast (coast at ~21°E)
      [55.30, 21.50],   // Klaipeda hinterland (Klaipeda at 55.7°N 21.1°E)
      [55.90, 21.70],   // N Lithuania / Latvia border
      // Latvia Baltic-proper coast inland
      [56.30, 21.60],   // Liepaja hinterland (Liepaja at 56.5°N 21.0°E)
      [57.00, 21.80],
      [57.50, 22.20],   // Ventspils hinterland (Ventspils at 57.4°N 21.5°E)
      [57.85, 22.90],   // Kolka cape inland (entrance to Gulf of Riga)
      // Trace INTO Gulf of Riga so its water is inside the polygon
      [57.30, 23.70],   // W Gulf of Riga S side
      [56.85, 24.30],   // Riga inland (Riga at 56.95°N 24.1°E)
      [57.00, 25.10],   // SE Gulf of Riga
      [57.80, 24.90],   // E Gulf of Riga (Latvia/Estonia border)
      [58.30, 24.60],   // Pärnu hinterland (Pärnu at 58.4°N 24.5°E)
      // Estonia mainland S coast inland
      [58.60, 25.80],
      [59.20, 27.50],   // Narva hinterland (Narva at 59.4°N 28.2°E)
      // W Russia (Vyborg / St Petersburg)
      [59.80, 28.50],
      [60.20, 29.50],
      [60.70, 30.50],
      // Finland S coast (Gulf of Finland N shore, inland)
      [60.60, 27.50],
      [60.30, 25.00],   // Helsinki hinterland (Helsinki at 60.17°N 24.94°E)
      [60.70, 23.00],   // Turku hinterland (Turku at 60.45°N 22.27°E)
      [61.20, 22.20],   // SW Finland inland
      // Finland W (Bothnian) coast — coast CURVES EASTWARD going N
      [62.00, 22.00],   // inland Pori (Pori at 61.5°N 21.8°E)
      [63.20, 22.00],   // inland Vaasa (Vaasa at 63.1°N 21.6°E)
      [63.80, 23.50],   // inland Kokkola (Kokkola at 63.8°N 23.1°E)
      [64.60, 25.00],   // inland Raahe (Raahe at 64.7°N 24.5°E)
      [65.10, 26.00],   // inland Oulu (Oulu at 65.0°N 25.5°E) — was too far W
      [65.80, 25.40],   // inland Kemi (Kemi at 65.7°N 24.5°E)
      [66.00, 24.50],   // top at Tornio (Tornio at 65.9°N 24.1°E)
      // Top of Gulf of Bothnia going W into Sweden
      [66.00, 23.30],
      // Sweden N Bothnian coast going S inland
      [65.60, 22.30],   // inland Luleå (Luleå at 65.6°N 22.1°E)
      [64.80, 21.20],   // inland Piteå / Skellefteå
      [63.80, 20.20],   // inland Umeå (Umeå at 63.8°N 20.3°E)
      [62.90, 18.50],   // inland Örnsköldsvik
      [62.30, 17.50],   // inland Sundsvall (Sundsvall at 62.4°N 17.3°E)
      [61.50, 17.10],   // inland Hudiksvall
      [60.70, 17.20],   // inland Gävle (Gävle at 60.7°N 17.2°E)
      // Sweden E coast (Baltic proper) going S inland
      [59.80, 17.70],
      [59.30, 17.90],   // inland Stockholm
      [58.60, 16.80],
      [57.70, 16.60],   // inland Kalmar
      [56.90, 16.10],
      [56.20, 15.30],   // Karlskrona inland
      [55.70, 14.30],   // S Sweden
      [55.40, 13.40],   // Malmö inland (Malmö at 55.6°N 13.0°E)
      [55.80, 12.60],   // Oresund E side (Helsingborg inland)
      [56.60, 12.30],   // Kattegat E inland
      [57.40, 11.80],   // inland Gothenburg (Gothenburg at 57.7°N 12.0°E)
      [57.74, 11.50],   // Swedish coast at 57.74°N
      // Close at Skagen via 57.74°N line west across Kattegat
      [57.74, 10.40],
    ],
    boundaries: [
      // 57°44.8'N Kattegat entry line (Skagen tip → Swedish coast)
      [[57.74, 10.60], [57.74, 11.90]],
    ],
  },
  {
    id: "north-sea",
    name: "North Sea + English Channel",
    type: "ECA",
    effective: "SECA 2006 · NECA 2021",
    labelAnchor: [55.0, 3.5],
    /*
     * Per MARPOL Annex V Reg 5(1)(f): North Sea proper (S of 62°N,
     * E of 4°W) + Skagerrak (S limit 57°44.8'N east of the Skaw) +
     * English Channel (E of 5°W, N of 48°30'N).
     *
     * fillPolygon goes ~30-60 km inland of the surrounding coasts
     * so the sea is covered all the way to shore. UK is NOT inside
     * the ring — its west coast is outside the zone. Four straight
     * regulatory boundary lines are drawn on top of the fill.
     */
    fillPolygon: [
      [62.00, -4.00],   // NW (N of Shetland, 4°W)
      [62.00,  0.00],
      [62.00,  5.00],   // NE at Norway coast (62°N)
      // Down Norway W coast
      [61.00,  4.80],
      [59.50,  5.30],
      [58.50,  6.00],
      [58.00,  7.00],   // Lindesnes (S tip of Norway)
      // Norway S coast going E into Skagerrak (inland a bit)
      [58.10,  8.20],   // Kristiansand inland
      [58.60,  9.50],
      [58.90, 10.50],   // approaching Oslofjord
      [59.20, 11.30],   // Norwegian-Swedish border
      // Down Swedish W coast
      [58.50, 11.30],
      [57.90, 11.60],
      [57.74, 11.90],   // Swedish coast at 57.74°N line
      // 57.74°N line WEST — eastern segment, through Kattegat/Skagerrak to Skagen
      [57.74, 10.65],   // Skagen tip (Danish N point, on the line)
      // Down Danish W coast (Jutland)
      [57.00,  8.40],
      [56.00,  8.10],
      [55.30,  8.20],
      [54.60,  8.60],   // S Denmark / N German border
      // Continental coast going S
      [54.00,  7.80],   // N Germany (Heligoland Bight)
      [53.50,  6.80],
      [53.20,  5.80],   // N Netherlands
      [52.50,  4.60],
      [51.80,  3.80],
      [51.20,  2.80],   // Belgium
      [50.90,  2.00],   // N France
      [50.50,  1.40],
      // French Channel coast going W
      [49.80,  0.00],
      [49.50, -1.20],
      [49.00, -1.60],
      [48.70, -2.00],
      [48.50, -2.40],   // NW Brittany inland
      [48.50, -4.50],
      [48.50, -5.00],   // Channel SW corner (5°W / 48.5°N)
      // 5°W going N to UK S coast
      [49.20, -5.00],
      [49.90, -5.00],   // Cornwall SW tip at 5°W
      // UK S coast going E
      [50.20, -4.50],
      [50.40, -3.00],
      [50.70, -1.00],
      [50.90,  0.30],
      [51.20,  1.40],   // Dover
      // UK E coast going N
      [51.80,  1.90],
      [52.70,  1.90],   // East Anglia
      [53.50,  0.50],
      [54.30, -0.30],   // Yorkshire
      [55.00, -1.30],
      [56.00, -1.70],
      [57.00, -1.80],   // Aberdeen
      [57.74, -2.00],   // UK E coast at 57.74°N
      // 57.74°N line WEST — western segment, UK coast to 4°W meridian
      [57.74, -4.00],
      // 4°W meridian N back to start (Shetland/Orkney fall inside)
      [58.50, -4.00],
      [60.00, -4.00],
      [61.00, -4.00],
      [62.00, -4.00],   // close NW
    ],
    boundaries: [
      // 62°N parallel from 4°W east to Norwegian coast
      [[62.00, -4.00], [62.00, 5.00]],
      // 4°W meridian from UK N coast up to 62°N
      [[58.80, -4.00], [62.00, -4.00]],
      // 48°30'N Channel southern boundary (5°W to French coast)
      [[48.50, -5.00], [48.50, -2.10]],
      // 5°W Channel western boundary (48.5°N up to UK S coast)
      [[48.50, -5.00], [49.90, -5.00]],
    ],
  },
  {
    id: "med-seca",
    name: "Mediterranean Sea",
    type: "SECA",
    effective: "May 2025",
    labelAnchor: [36.5, 17.0],
    /*
     * Full Mediterranean. fillPolygon hugs the surrounding coasts
     * with ~30-60 km inland margin so all Med waters (including
     * tricky bits like the Adriatic and Aegean) are covered. Entry
     * points at Gibraltar, Dardanelles, and Suez get a short
     * boundary tick.
     */
    fillPolygon: [
      [35.90, -5.40],   // Gibraltar S (Morocco side)
      [36.15, -5.40],   // Gibraltar N (Spain)
      // N coast — Spain Med, each vertex ~30-50 km INLAND of the coast
      [36.70, -3.80],   // Málaga hinterland (coast at 36.72°N)
      [37.30, -1.80],   // Cartagena inland
      [38.30, -0.60],   // Alicante inland (coast at 38.35°N)
      [39.40, -0.50],   // Valencia inland (coast at 39.47°N, ‑0.37°E)
      [40.80,  0.40],   // Ebro delta inland
      [41.80,  2.10],   // Barcelona inland (coast at 41.4°N 2.2°E)
      [42.40,  3.00],   // NE Spain / French border
      // N coast — S France (inland of Med coast)
      [43.20,  3.80],   // Montpellier
      [43.60,  4.80],   // N of Marseille (Salon-de-Provence)
      [43.90,  5.80],   // Aix-en-Provence
      [44.00,  6.80],   // N Provence
      [44.00,  7.60],   // Monaco-Italy border inland
      // N coast — Italy Ligurian + Tyrrhenian
      [44.50,  8.50],   // Genoa hinterland (coast at 44.4°N 8.9°E)
      [44.30, 10.00],   // N Tuscany inland
      [43.40, 11.00],
      [42.60, 11.80],
      [42.30, 12.30],   // Rome hinterland (coast at 41.9°N 12.5°E)
      [41.50, 13.60],
      [41.10, 14.40],   // Naples hinterland (coast at 40.8°N 14.3°E)
      [40.00, 15.80],   // Calabria inland
      [39.00, 16.50],
      [38.10, 15.90],   // Strait of Messina (Sicily sits inside ring)
      // S Italy / Ionian Italy mainland
      [38.70, 16.60],
      [40.00, 17.30],   // Taranto inland
      [40.90, 17.90],   // Brindisi inland
      // Adriatic E side — Italy mainland first goes N along the Italian E coast
      [41.80, 15.90],   // Gargano peninsula inland
      [42.60, 14.20],   // Pescara inland
      [43.60, 13.30],   // Ancona inland
      [44.40, 12.40],   // Rimini/Po delta
      [45.20, 12.40],   // Venice area inland
      [45.80, 13.60],   // Trieste / Slovenia inland
      // Adriatic E side — Slovenia / Croatia
      [45.40, 14.80],   // Rijeka / Istria
      [44.50, 15.80],
      [43.50, 16.80],   // Split inland
      [42.70, 18.30],   // Dubrovnik inland
      [42.20, 19.30],   // Montenegro inland
      [41.40, 19.80],   // Albania coast inland
      [40.30, 20.20],   // S Albania
      // N Greece mainland (Epirus / Macedonia / Thrace)
      [39.50, 21.00],
      [39.00, 22.30],
      [39.70, 23.00],
      [40.30, 24.30],   // Thessaloniki / Chalkidiki inland
      [40.80, 25.60],
      [41.00, 26.30],   // Evros / Dardanelles approach
      // Dardanelles + Marmara + Bosphorus (include Sea of Marmara)
      [41.20, 28.00],   // Istanbul area
      [41.10, 29.40],   // Marmara E end
      [40.60, 29.30],
      [40.00, 28.20],   // NW Turkey
      [39.30, 26.90],
      [38.60, 27.30],   // Izmir hinterland
      [37.40, 28.00],
      [36.80, 28.80],
      // S Turkey coast inland (Antalya / Mersin / Hatay)
      [36.50, 30.60],   // Antalya hinterland (coast at 36.9°N)
      [36.50, 32.50],
      [36.60, 34.60],   // Mersin inland
      [36.90, 36.00],   // Hatay inland
      // Syria / Lebanon / Israel coast (30-50 km INLAND)
      [35.80, 36.30],   // N Syria inland (Latakia at 35.5°N 35.8°E)
      [34.70, 36.50],   // Tartus inland
      [33.80, 36.00],   // Lebanon inland (Beirut at 33.9°N 35.5°E)
      [32.80, 35.30],   // N Israel (Haifa hinterland)
      [31.90, 34.80],   // Tel Aviv inland
      [31.30, 34.30],   // Gaza inland
      [31.20, 33.00],   // Sinai N coast inland
      [31.15, 32.40],   // Port Said area
      // Egypt Med N coast (inland)
      [31.00, 31.50],   // Alexandria hinterland
      [31.10, 29.00],
      [31.30, 26.00],
      [31.50, 25.10],   // W Egypt / Libyan border
      // Libya N coast — follows Cyrenaica bulge + Gulf of Sirte DIP
      [31.90, 24.00],   // Tobruk / Bardia inland
      [32.70, 22.80],   // Derna inland (Cyrenaica N bulge)
      [32.50, 21.80],
      [32.10, 20.00],   // Benghazi inland (coast at 32.1°N 20.07°E)
      [31.20, 19.80],   // N Gulf of Sirte
      [30.50, 19.30],   // Gulf of Sirte E corner
      [30.30, 17.50],   // Sirte town inland (deepest Gulf dip)
      [30.70, 16.00],
      [31.60, 15.30],   // Misrata inland
      [32.60, 13.50],   // Tripoli hinterland (coast at 32.9°N 13.2°E)
      [32.90, 12.00],
      [33.20, 11.20],
      [33.80, 10.80],   // Tunisia border
      // Tunisia N coast inland
      [34.40, 10.20],   // Sfax inland
      [35.20, 10.80],   // Sousse inland
      [36.00, 10.60],
      [36.80, 10.40],   // Cap Bon peninsula inland
      [37.10, 10.10],   // Tunis hinterland
      [37.30,  9.40],   // Bizerte
      // Algeria N coast inland
      [37.00,  8.00],
      [36.80,  6.00],
      [36.80,  4.80],
      [36.80,  3.00],   // Algiers hinterland (coast at 36.75°N 3.05°E)
      [36.30,  1.40],
      [35.70, -0.20],
      [35.30, -1.00],
      [35.20, -2.10],   // Oran inland
      // Morocco Med coast inland
      [35.40, -3.00],
      [35.70, -4.60],
      [35.90, -5.40],   // close at Gibraltar S
    ],
    boundaries: [
      // Gibraltar Strait entry
      [[35.85, -5.50], [36.10, -5.50]],
      // Dardanelles / Bosphorus (approximate — edge of Aegean)
      [[40.10, 26.20], [40.45, 26.30]],
      // Suez Canal entry at Port Said
      [[31.25, 32.30], [31.45, 32.30]],
    ],
  },
  {
    id: "na-eca",
    name: "North American ECA (Atlantic + Gulf)",
    type: "ECA",
    effective: "2012",
    labelAnchor: [35.0, -72.0],
    /*
     * 200 NM offshore buffer around US + Canadian Atlantic and Gulf
     * coasts. fillPolygon runs out to the 200 NM arc and back ~60 km
     * INLAND of the coast, so there's no visible gap at the shore.
     * The regulatory polyline is the offshore arc only.
     */
    fillPolygon: [
      // Offshore arc — 200 NM buffer
      [60.00, -55.00], [52.00, -48.00], [44.00, -58.00], [40.00, -66.00],
      [36.00, -70.00], [32.00, -74.00], [28.00, -76.00], [25.00, -78.00],
      [24.00, -82.50], [24.50, -86.00], [26.00, -91.00], [26.50, -94.00],
      [26.00, -97.00],
      // Inland return — traces ~60-100 km inland of the coast.
      // The return path detours NORTH through the Gulf of Saint
      // Lawrence so Quebec / Anticosti / St. Lawrence estuary (all
      // ECA waters) are included — otherwise a straight NB→Nova
      // Scotia path would leave the whole gulf outside the fill.
      [27.00, -99.00],   // S Texas inland (Rio Grande)
      [29.50, -98.50],   // San Antonio area
      [31.00, -94.00],   // E Texas inland
      [31.50, -90.50],   // MS inland
      [31.80, -87.00],   // Alabama inland
      [31.00, -83.50],   // GA/FL border inland
      [29.00, -82.50],   // C Florida inland
      [26.50, -81.50],   // S Florida inland
      [25.50, -80.80],   // S Florida
      [27.00, -80.50],   // E Florida
      [30.00, -81.80],   // NE Florida / Georgia inland
      [33.00, -80.50],   // SC inland
      [35.50, -78.50],   // NC inland
      [37.50, -77.50],   // VA inland
      [39.50, -76.50],   // MD/DE inland
      [41.00, -75.00],   // NJ/PA inland
      [42.00, -73.50],   // NY/CT inland
      [43.00, -71.50],   // MA/NH inland
      [44.50, -69.50],   // Maine inland
      [46.00, -68.00],   // New Brunswick inland
      // Detour inland around the Gulf of Saint Lawrence
      [47.50, -68.50],   // ME/Quebec border (St. Lawrence approach)
      [48.50, -70.00],   // Quebec inland (covers Quebec City area)
      [49.50, -68.00],   // N Gulf of SL, Quebec N shore inland
      [50.50, -66.00],   // Sept-Îles inland
      [51.50, -63.00],   // Labrador S / Strait of Belle Isle approach
      [54.00, -60.00],   // Labrador inland
      [57.00, -60.00],   // Labrador inland
      [60.00, -62.00],   // N Labrador inland
      [60.00, -64.00],   // Labrador coast at 60°N parallel
      // Polygon auto-closes from [60, -64] back to [60, -55]:
      // a horizontal line along 60°N — this IS the ECA's northern
      // regulatory boundary, so the fill naturally traces it.
    ],
    boundaries: [
      // Regulatory 200 NM offshore arc (drawn as polyline on top).
      // Extended at the N end along the 60°N parallel out to the
      // Labrador coast at ~-64°W so the line terminates on land,
      // not dangling in the middle of the Labrador Sea.
      [
        [60.00, -64.00],   // N terminus at Labrador coast (60°N parallel)
        [60.00, -55.00],   // 200 NM offshore at 60°N
        [52.00, -48.00], [44.00, -58.00], [40.00, -66.00],
        [36.00, -70.00], [32.00, -74.00], [28.00, -76.00], [25.00, -78.00],
        [24.00, -82.50], [24.50, -86.00], [26.00, -91.00], [26.50, -94.00],
        [26.00, -97.00],
        [26.00, -97.15],   // S terminus at Mexican coast (US/MX border)
      ],
    ],
  },
  {
    id: "na-pacific-eca",
    name: "North American ECA (Pacific)",
    type: "ECA",
    effective: "2012",
    labelAnchor: [42.0, -132.0],
    /*
     * 200 NM offshore arc along US + Canadian Pacific coast. Fill
     * goes out to the regulatory arc and back ~60-100 km inland so
     * no gap appears at the coast.
     */
    fillPolygon: [
      // Offshore arc
      [60.00, -146.00], [57.00, -142.00], [54.00, -135.00], [50.00, -130.00],
      [46.00, -127.00], [42.00, -127.00], [38.00, -126.00], [34.00, -124.00],
      [32.00, -121.00], [30.00, -118.00], [23.00, -114.00], [18.00, -107.00],
      // Inland return
      [19.00, -105.00],    // W Mexico coast inland
      [22.00, -106.00],    // Mazatlán area inland
      [25.00, -111.00],    // Baja California Sur inland
      [28.50, -113.00],    // Baja California inland
      [31.50, -115.50],    // N Baja inland
      [33.50, -117.00],    // SoCal inland
      [35.50, -119.50],    // C California inland
      [38.00, -121.50],    // N California inland
      [41.00, -122.50],    // Klamath / CA-OR inland
      [44.00, -122.50],    // Oregon inland (Willamette Valley)
      [47.00, -121.50],    // Washington inland (Cascades)
      [49.00, -121.50],    // BC inland (Fraser Valley)
      [52.00, -125.00],    // BC coast inland
      [55.00, -130.00],    // SE Alaska inland
      [58.00, -135.00],    // Alaska panhandle inland
      [60.00, -143.00],    // S Alaska inland
      [60.00, -146.00],    // close
    ],
    boundaries: [
      [
        [60.00, -146.00], [57.00, -142.00], [54.00, -135.00], [50.00, -130.00],
        [46.00, -127.00], [42.00, -127.00], [38.00, -126.00], [34.00, -124.00],
        [32.00, -121.00], [30.00, -118.00], [23.00, -114.00], [18.00, -107.00],
      ],
    ],
  },
  {
    id: "caribbean-eca",
    name: "US Caribbean ECA",
    type: "ECA",
    effective: "2014",
    labelAnchor: [18.4, -65.7],
    /*
     * Rectangle around Puerto Rico + US Virgin Islands (approximately
     * 50 NM offshore). Islands sit in the middle of the box so the
     * fill covers the sea around them naturally.
     */
    fillPolygon: [
      [19.80, -67.80], [19.80, -63.60], [17.00, -63.60], [17.00, -67.80],
      [19.80, -67.80],
    ],
    boundaries: [
      [[19.80, -67.80], [19.80, -63.60]],
      [[19.80, -63.60], [17.00, -63.60]],
      [[17.00, -63.60], [17.00, -67.80]],
      [[17.00, -67.80], [19.80, -67.80]],
    ],
  },
];

/**
 * Style for the sea-tint fill — extremely low opacity so land inside
 * the zone only gets a barely perceptible shift.
 */
export const ECA_FILL_STYLE = {
  stroke: false,
  fillColor: "#f97316",
  fillOpacity: 0.06,
};

/**
 * Style for the regulatory boundary lines — drawn prominently on top
 * of the fill. Matches the orange Netpas uses.
 */
export const ECA_BOUNDARY_STYLE = {
  color: "#f97316",
  weight: 2,
  opacity: 0.9,
  dashArray: undefined,
  lineCap: "round" as const,
};

/**
 * Legacy export — kept so existing imports don't break. Equivalent
 * to `ECA_BOUNDARY_STYLE` spread over `ECA_FILL_STYLE`.
 */
export const ECA_STYLE = {
  color: "#f97316",
  weight: 2,
  opacity: 0.9,
  fillColor: "#f97316",
  fillOpacity: 0,
};
