/**
 * Shipping risk zones — piracy, war, and political-tension areas.
 *
 * Visual overlay only. Does NOT influence routing. (If an operator
 * needs to route around e.g. the Red Sea, they use the existing
 * "Avoid Suez" passage toggle which switches to the Cape of Good
 * Hope variant.)
 *
 * Sources — all public industry guidance:
 *   - Indian Ocean HRA → BMP5 (Best Management Practices v5)
 *   - Gulf of Guinea → IMB PRC / MDAT-GoG reporting area
 *   - Red Sea / Bab el-Mandeb → JWC (Joint War Committee) listed area
 *     for Houthi missile + drone attacks, active since Nov 2023
 *   - Black Sea → JWC listed area since Feb 2022 (Russia-Ukraine)
 *   - Strait of Hormuz / Persian Gulf → US 5th Fleet AOI,
 *     Iran tensions + vessel seizures
 *   - Sulu / Celebes Seas → ReCAAP + Philippine coast guard warnings
 *
 * Boundaries are simplified for on-map display, NOT legal definitions.
 * Operators must check current advisories (UKMTO, MDAT-GoG, MSC-HOA)
 * before transit.
 */

export interface RiskZone {
  /** Short id used for React keys. */
  id: string;
  /** Display name shown in tooltip. */
  name: string;
  /**
   * Risk category:
   *   war     = active conflict / state-level threat (missiles, mines)
   *   piracy  = criminal attack risk (boarding, kidnapping)
   *   tension = political / sanctions risk (seizures, detentions)
   */
  type: "war" | "piracy" | "tension";
  /** Bounding polygon for the colored fill. */
  fillPolygon: Array<[number, number]>;
  /** One-line description shown on hover. */
  note: string;
  /** When the risk became active (for hover info). */
  since: string;
  /** Tooltip anchor. */
  labelAnchor: [number, number];
}

export const RISK_ZONES: RiskZone[] = [
  {
    /*
     * MERGED: the old "Red Sea" (Houthi war risk) and "Indian Ocean
     * HRA" (Somali piracy) zones were overlapping messily in the
     * Gulf of Aden. Shipping industry treats this as one continuous
     * danger corridor anyway (Suez → Arabian Sea), so we merge them
     * into a single zone spanning Red Sea + Bab el-Mandeb + Gulf of
     * Aden + Arabian Sea + Somali waters + W Indian Ocean.
     *
     * Coast tracing is kept tight (~30-50 km offshore) so the
     * polygon does NOT visibly bleed into Ethiopia / Somalia /
     * Yemen inland — the earlier version was too generous inland.
     */
    id: "red-sea-indian-ocean",
    name: "Red Sea + Indian Ocean HRA",
    type: "war",
    note: "Houthi attacks (Red Sea/Gulf of Aden) + Somali piracy",
    since: "war risk 2023 · HRA 2008",
    labelAnchor: [13.0, 52.0],
    fillPolygon: [
      // NORTH — Suez approaches
      [28.50, 32.40],   // NW (Egypt E of Nile)
      [28.50, 34.60],   // NE (Sinai E / Aqaba)
      // EAST side S — Saudi / Yemen coast, offshore ~30 km
      [27.00, 35.80],
      [25.00, 37.00],
      [22.50, 38.80],   // Jeddah offshore
      [20.00, 40.40],
      [17.50, 42.10],
      [15.00, 42.80],   // Hodeidah offshore
      [13.50, 43.30],   // Bab el-Mandeb approach
      [12.50, 43.60],   // Bab el-Mandeb S exit
      // Along Yemen / Oman S coast, offshore
      [12.50, 45.50],
      [13.50, 48.00],   // Hadramaut offshore
      [15.00, 51.50],   // Oman/Yemen border offshore
      [17.00, 55.50],   // Oman Dhofar offshore
      [20.00, 58.50],   // Oman coast offshore (S of Muscat)
      [22.50, 60.50],   // E Oman / Hormuz exit area
      // Arabian Sea — extend to 70°E
      [23.50, 64.00],   // off Pakistan Makran
      [23.00, 67.00],   // off Karachi
      [20.00, 70.00],   // off W India (Gujarat)
      [14.00, 72.00],   // off Goa/Mumbai
      [8.00, 73.00],    // Maldives region
      // SOUTH — Indian Ocean open water
      [2.00, 70.00],
      [-4.00, 64.00],
      [-6.00, 56.00],
      [-5.00, 50.00],
      // WEST — back via E African coast (offshore)
      [-3.50, 46.00],   // N Mozambique / S Kenya offshore
      [-1.50, 42.50],   // Kenya offshore
      [1.00, 43.00],    // S Somalia offshore
      [4.00, 45.00],    // Somalia mid offshore
      [7.00, 48.50],    // Somalia NE offshore
      [10.00, 51.00],   // Cape Guardafui offshore
      [11.50, 50.00],
      [11.50, 47.00],
      [11.30, 44.50],
      [11.30, 43.50],   // N Somalia / Djibouti offshore
      // Up W side — Djibouti / Eritrea / Sudan / Egypt, offshore
      [12.00, 43.00],   // Djibouti offshore
      [13.20, 42.60],   // Eritrea S offshore
      [14.50, 41.00],   // Eritrea offshore
      [16.50, 39.40],   // Eritrea N / Sudan offshore
      [19.00, 37.40],   // Port Sudan offshore
      [21.50, 36.40],
      [24.00, 35.30],
      [26.50, 34.00],
      [28.50, 32.40],   // close
    ],
  },
  {
    id: "gulf-of-guinea",
    name: "Gulf of Guinea",
    type: "piracy",
    note: "Armed robbery + kidnapping — Niger Delta region",
    since: "ongoing (since 2010s)",
    labelAnchor: [2.0, 4.0],
    /*
     * MDAT-GoG reporting area — Ivory Coast to Angola. Coast-side
     * vertices are now ~30-50 km OFFSHORE (previously the ring went
     * inland as far as 7°N, pushing the fill well into Ghana /
     * Nigeria territory). The return path is ~400-600 km offshore.
     */
    fillPolygon: [
      // COAST SIDE — offshore tracing, going W → E → S
      [4.70, -7.20],    // Liberia / CI border offshore
      [4.80, -4.50],    // Abidjan offshore
      [4.80, -2.00],    // W Ghana offshore
      [5.20,  0.50],    // Accra offshore
      [5.80,  2.50],    // Togo / Benin offshore
      [6.10,  4.00],    // Lagos offshore
      [4.50,  6.50],    // Niger Delta offshore (delta juts S)
      [3.50,  8.50],    // E Nigeria / Cameroon offshore
      [2.00,  9.40],    // SW Cameroon offshore
      [0.00,  9.40],    // Gabon N offshore (Libreville)
      [-2.00, 10.00],   // Gabon mid offshore
      [-4.00, 11.00],   // Gabon S / Congo offshore
      [-6.00, 12.00],   // Cabinda offshore
      [-8.00, 12.80],   // Angola N (Luanda) offshore
      [-9.00, 13.00],   // Angola mid
      // OFFSHORE RETURN — ~500 km offshore
      [-10.00, 10.00],
      [-8.00,  5.00],
      [-4.00,  1.00],
      [-1.00, -2.00],
      [2.00, -4.50],
      [4.70, -7.20],    // close
    ],
  },
  {
    id: "black-sea-war",
    name: "Black Sea + Sea of Azov",
    type: "war",
    note: "Russia-Ukraine war — mine risk + missile strikes",
    since: "Feb 2022",
    labelAnchor: [44.0, 34.0],
    fillPolygon: [
      // Entire Black Sea + Sea of Azov, enclosed by coasts ~30 km
      // inland so the whole sea is covered.
      [47.30, 34.00],   // N Azov (Berdyansk/Mariupol area)
      [47.30, 38.80],   // E Azov (Rostov approach)
      [46.50, 39.50],
      [45.30, 38.00],   // Kerch Strait E
      [45.00, 37.00],
      [43.50, 40.00],   // E Black Sea (Russia)
      [42.80, 42.00],   // Georgia coast
      [41.50, 42.50],
      [41.20, 41.00],   // NE Turkey inland
      [41.20, 38.00],
      [41.20, 35.00],
      [41.20, 32.50],   // N Turkey inland
      [41.00, 29.50],   // Bosphorus approaches
      [41.50, 28.50],   // Turkish Thrace
      [43.00, 28.00],   // Varna / Bulgaria
      [44.50, 28.50],   // Constanta / Romania
      [45.50, 29.80],
      [46.20, 30.50],   // Odessa area
      [46.80, 32.00],
      [46.80, 33.50],
      [47.30, 34.00],   // close
    ],
  },
  {
    id: "hormuz-persian-gulf",
    name: "Strait of Hormuz / Persian Gulf",
    type: "tension",
    note: "Iran tensions — vessel seizures, GPS spoofing",
    since: "ongoing",
    labelAnchor: [26.5, 52.0],
    /*
     * Covers the Shatt al-Arab / N Persian Gulf entry, the whole
     * Persian Gulf (including Qatar peninsula inside the ring —
     * gets a faint amber tint, acceptable), Strait of Hormuz, and
     * the Gulf of Oman up to Muscat area.
     *
     * Ring traced counter-clockwise: start at Iraq/Kuwait corner,
     * down the Iranian coast, through Hormuz into Gulf of Oman,
     * back along Oman/UAE/Saudi/Kuwait coast. Each vertex sits
     * ~30 km inland of the nearest coast to guarantee full water
     * coverage at the shoreline.
     */
    fillPolygon: [
      // NW corner — Iraq / Shatt al-Arab / N Kuwait
      [30.60, 47.80],
      // Down the Iranian coast (E side) — inland margin
      [30.30, 49.00],   // SW Iran (Abadan inland)
      [29.40, 50.50],   // Bandar-e Khomeini inland
      [28.40, 51.50],   // Bushehr inland
      [27.50, 53.00],   // Iran mid-Gulf
      [27.00, 54.50],   // Iran
      [26.80, 55.80],   // Iran N of Hormuz
      [26.40, 56.80],   // Hormuz narrow (Iranian side)
      // Exit into Gulf of Oman
      [25.80, 57.50],
      [25.00, 58.50],   // Gulf of Oman
      [24.00, 59.50],   // Muscat / Oman N coast inland
      [22.80, 60.00],   // E Oman offshore
      [22.50, 58.50],   // S offshore (sweep back W)
      [23.20, 57.20],
      // N Oman Musandam peninsula + UAE Fujairah offshore
      [24.00, 56.50],
      [24.70, 55.50],   // Dubai offshore
      [24.80, 54.20],   // Abu Dhabi offshore
      [24.60, 52.80],   // SE Qatar offshore
      // Cross S of Qatar — Qatar peninsula is INSIDE the ring
      [24.50, 51.20],
      // Up along E Saudi coast (Qatar included inside)
      [25.80, 50.10],   // NW Qatar / E Saudi border inland
      [27.20, 49.80],   // E Saudi (Jubail area) inland
      [28.60, 48.80],   // N Saudi / S Kuwait inland
      [29.60, 48.00],   // Kuwait inland
      [30.60, 47.80],   // close at Iraq
    ],
  },
  {
    id: "sulu-celebes",
    name: "Sulu / Celebes Seas",
    type: "piracy",
    note: "Abu Sayyaf kidnapping zone (ReCAAP warning)",
    since: "2000s",
    labelAnchor: [5.0, 121.0],
    fillPolygon: [
      [8.00, 117.00],   // N Sulu Sea (NE Malaysia)
      [9.00, 122.00],   // Philippine SW approach
      [7.50, 124.50],   // N Celebes Sea
      [4.00, 126.00],
      [1.50, 125.00],   // N Indonesia (Celebes)
      [0.50, 122.00],
      [2.00, 118.50],   // E Borneo
      [5.00, 117.00],
      [8.00, 117.00],   // close
    ],
  },
];

/**
 * Color + opacity per risk type. All danger zones are red — piracy
 * and active war look the same severity visually, with slight
 * intensity differences so an overlap (e.g. Red Sea where Houthi
 * missile risk and piracy co-exist) stays readable. Tension zones
 * (political, not kinetic) use amber so they're clearly a lower
 * severity tier.
 *
 * Kept distinct from ECA_STYLE (orange-yellow) so ECA and risk
 * overlays can be enabled together without visual collision.
 */
export const RISK_STYLES: Record<
  RiskZone["type"],
  { fillColor: string; fillOpacity: number; borderColor: string; borderOpacity: number; weight: number }
> = {
  war: {
    fillColor: "#b91c1c",      // red-700 (dark red — conflict)
    fillOpacity: 0.16,
    borderColor: "#dc2626",    // red-600 border (slightly brighter than fill)
    borderOpacity: 0.95,
    weight: 2,
  },
  piracy: {
    fillColor: "#dc2626",      // red-600 (bright red — "danger!")
    fillOpacity: 0.13,
    borderColor: "#ef4444",    // red-500
    borderOpacity: 0.9,
    weight: 2,
  },
  tension: {
    fillColor: "#f59e0b",      // amber-500 (lower severity, political)
    fillOpacity: 0.08,
    borderColor: "#f59e0b",
    borderOpacity: 0.8,
    weight: 1.5,
  },
};

/** Human-readable labels for the type enum (used in the hover tooltip). */
export const RISK_TYPE_LABELS: Record<RiskZone["type"], string> = {
  war: "WAR RISK",
  piracy: "PIRACY",
  tension: "TENSION",
};
