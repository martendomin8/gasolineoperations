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
  lavera:      { lat: 43.3857, lng: 5.0143,   label: "Lavera" },
  fos:         { lat: 43.4370, lng: 4.9440,   label: "Fos-sur-Mer" },
  amsterdam:   { lat: 52.3676, lng: 4.9041,   label: "Amsterdam" },
  antwerp:     { lat: 51.2194, lng: 4.4025,   label: "Antwerp" },
  rotterdam:   { lat: 51.9225, lng: 4.4792,   label: "Rotterdam" },
  hamburg:     { lat: 53.5511, lng: 9.9937,   label: "Hamburg" },
  barcelona:   { lat: 41.3851, lng: 2.1734,   label: "Barcelona" },
  "new york":  { lat: 40.6892, lng: -74.0445, label: "New York" },
  aliaga:      { lat: 38.8000, lng: 26.9833,  label: "Aliaga" },
  singapore:   { lat: 1.2644,  lng: 103.8198, label: "Singapore" },
  houston:     { lat: 29.7604, lng: -95.3698, label: "Houston" },
  augusta:     { lat: 37.2305, lng: 15.2227,  label: "Augusta" },
  thessaloniki:{ lat: 40.6401, lng: 22.9444,  label: "Thessaloniki" },
  thames:      { lat: 51.4500, lng: 0.7000,   label: "Thames" },
  marseille:   { lat: 43.2965, lng: 5.3698,   label: "Marseille" },
  genoa:       { lat: 44.4056, lng: 8.9463,   label: "Genoa" },
  algeciras:   { lat: 36.1408, lng: -5.4536,  label: "Algeciras" },
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
