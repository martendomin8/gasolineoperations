/**
 * Port coordinates dictionary for the Fleet Map prototype.
 *
 * Maps port name strings (as they appear in deal loadport/dischargePort fields)
 * to geographic coordinates. Matching is case-insensitive and substring-based
 * since operators type ports in various formats (e.g. "Lavera", "FOS LAVERA").
 *
 * Phase 2: Replace with a proper port database or geocoding API.
 */

export interface PortCoordinates {
  lat: number;
  lng: number;
  label: string; // Display name
}

/** Known port coordinates — extend as needed */
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
 * Case-insensitive substring match — "LAVERA", "Fos/Lavera", "Amsterdam ARA" all work.
 * Returns null if no match found.
 */
export function findPortCoordinates(portName: string | null | undefined): PortCoordinates | null {
  if (!portName) return null;
  const lower = portName.toLowerCase().trim();

  // Exact match first
  if (PORTS[lower]) return PORTS[lower];

  // Substring match — port name contains or is contained by a known key
  for (const [key, coords] of Object.entries(PORTS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return coords;
    }
  }

  return null;
}
