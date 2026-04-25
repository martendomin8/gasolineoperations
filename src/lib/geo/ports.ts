/**
 * Port coordinates dictionary for the Fleet Map prototype.
 *
 * Originally a 24-entry hardcoded dictionary — sufficient for the early
 * prototype but the proper 200+ port catalogue lives in
 * `src/lib/maritime/sea-distance` (used by the AIS snapshot route + the
 * Planner). Keeping two port DBs in sync was a bug magnet: a deal whose
 * loadport resolved fine for the AIS layer (e.g. Bayonne, Gdansk) was
 * silently tagged "unlocated" on the Fleet map because that lookup
 * missed the smaller dictionary here.
 *
 * `findPortCoordinates` now delegates to `getPortCoords` from the
 * sea-distance provider so the Fleet view, Planner, AIS snapshot, and
 * Excel listing all see the same port catalogue. The local `PORTS`
 * record remains for the legacy `CORE_TERMINALS` export which a few
 * map overlays still depend on; new code should not extend it.
 */

import { getPortCoords } from "@/lib/maritime/sea-distance";

export interface PortCoordinates {
  lat: number;
  lng: number;
  label: string; // Display name
}

/** Legacy core-terminal anchors — kept for `CORE_TERMINALS`. */
const PORTS: Record<string, PortCoordinates> = {
  // Coordinates point to the actual port/harbor area, NOT city centers.
  // This keeps mock vessel positions in the water instead of on land.

  // ── Core terminals ──
  lavera:       { lat: 43.3920, lng: 4.9940,   label: "Lavera" },        // Lavera oil terminal jetty
  fos:          { lat: 43.4050, lng: 4.9300,   label: "Fos-sur-Mer" },   // Fos port basin
  amsterdam:    { lat: 52.4080, lng: 4.7850,   label: "Amsterdam" },     // Petroleumhaven / IJ waterway
  antwerp:      { lat: 51.3050, lng: 4.3800,   label: "Antwerp" },       // Antwerp port oil terminals
  rotterdam:    { lat: 51.9550, lng: 4.1300,   label: "Rotterdam" },     // Europoort / Maasvlakte

  // ── Europe ──
  hamburg:      { lat: 53.5350, lng: 9.9600,   label: "Hamburg" },       // Hamburg port Elbe
  barcelona:    { lat: 41.3580, lng: 2.1680,   label: "Barcelona" },     // Port of Barcelona
  marseille:    { lat: 43.3400, lng: 5.3500,   label: "Marseille" },     // Port of Marseille
  genoa:        { lat: 44.4100, lng: 8.9200,   label: "Genoa" },         // Genoa port
  algeciras:    { lat: 36.1300, lng: -5.4400,  label: "Algeciras" },     // Algeciras bay
  augusta:      { lat: 37.2100, lng: 15.2400,  label: "Augusta" },       // Augusta harbor, Sicily
  thessaloniki: { lat: 40.6250, lng: 22.9350,  label: "Thessaloniki" },  // Thessaloniki port
  thames:       { lat: 51.4600, lng: 0.7200,   label: "Thames" },        // Thames Estuary
  aliaga:       { lat: 38.8100, lng: 26.9600,  label: "Aliaga" },        // Aliaga refinery pier, Turkey

  // ── Baltic / Russia ──
  "ust-luga":   { lat: 59.6800, lng: 28.4000,  label: "Ust-Luga" },     // Ust-Luga oil terminal, Gulf of Finland
  "ust luga":   { lat: 59.6800, lng: 28.4000,  label: "Ust-Luga" },     // alias without hyphen

  // ── Americas ──
  "new york":   { lat: 40.6600, lng: -74.0400, label: "New York" },      // NY Harbor
  houston:      { lat: 29.7350, lng: -95.0100, label: "Houston" },       // Houston Ship Channel
  philadelphia: { lat: 39.9100, lng: -75.1400, label: "Philadelphia" },  // Philadelphia port, Delaware River
  baltimore:    { lat: 39.2600, lng: -76.5800, label: "Baltimore" },     // Port of Baltimore

  // ── West Africa ──
  lagos:        { lat: 6.4200,  lng: 3.4100,   label: "Lagos" },         // Apapa / Tin Can Island port
  "lomé":       { lat: 6.1300,  lng: 1.3500,   label: "Lomé" },          // Port of Lomé, Togo
  lome:         { lat: 6.1300,  lng: 1.3500,   label: "Lomé" },          // alias without accent

  // ── Asia ──
  singapore:    { lat: 1.2500,  lng: 103.8300, label: "Singapore" },     // Singapore Strait anchorage
};

/** Core terminals that always show on the map regardless of vessel presence */
export const CORE_TERMINALS: PortCoordinates[] = [
  PORTS.lavera,
  PORTS.antwerp,
  PORTS.amsterdam,
];

/**
 * Resolve a free-text port name to coordinates.
 *
 * Delegates to the sea-distance provider's port catalogue (200+ tanker
 * ports, kept in sync with the ocean-routing graph) so the Fleet map
 * sees the same port set as the Planner and AIS snapshot route. Falls
 * back to the legacy `PORTS` dictionary for any niche aliases historic
 * code paths might still rely on.
 *
 * Returns null if no match found.
 */
export function findPortCoordinates(portName: string | null | undefined): PortCoordinates | null {
  if (!portName) return null;
  const lower = portName.toLowerCase().trim();

  // Primary path — proper port DB (Bayonne, Gdansk, all Med + ARA + Baltic
  // + W. Africa + USEC etc.). Returns { lat, lon }; we adapt to the legacy
  // { lat, lng, label } shape this module exposes.
  const canon = getPortCoords(portName);
  if (canon) {
    // Use the cleaned-up name as the display label when available, falling
    // back to the operator's raw input.
    return { lat: canon.lat, lng: canon.lon, label: portName };
  }

  // Legacy fallback — the small hardcoded dictionary above. Kept for
  // robustness in case the proper DB rejects a quirky historical alias.
  if (PORTS[lower]) return PORTS[lower];
  for (const [key, coords] of Object.entries(PORTS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return coords;
    }
  }

  return null;
}
