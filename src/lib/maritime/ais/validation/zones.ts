/**
 * Sanctioned / high-interest port zones for AIS anomaly detection.
 *
 * The list is deliberately conservative — we only flag ports where
 * AIS-off behaviour is well-documented and operationally relevant to
 * commodity trading compliance. Adding a port here turns it into a
 * "watch zone": vessels that go silent within it generate an
 * anomaly flag.
 *
 * Sources: OFAC designated-vessel lists, EU sanctions maps, public
 * dark-fleet trade reports (Lloyd's List 2023-2025).
 *
 * Format: rough bounding box that covers the approach + terminal.
 * Not a polygon — AIS receivers are sparse at these locations, a
 * generous box matters more than geometric precision.
 */

export interface SanctionedZone {
  /** Short code used in flag details — stable across edits. */
  code: string;
  /** Human-readable name for UI. */
  name: string;
  /** Brief note on why it's here. Surfaces in the operator tooltip. */
  reason: string;
  /** [[latMin, lonMin], [latMax, lonMax]]. */
  bbox: [[number, number], [number, number]];
}

export const SANCTIONED_ZONES: SanctionedZone[] = [
  {
    code: "primorsk",
    name: "Primorsk, Russia",
    reason: "Baltic crude export terminal — heavy dark-fleet activity since 2022.",
    bbox: [[60.20, 28.40], [60.55, 28.90]],
  },
  {
    code: "ust_luga",
    name: "Ust-Luga, Russia",
    reason: "Baltic crude + products export — documented AIS-off transits.",
    bbox: [[59.60, 28.10], [59.85, 28.55]],
  },
  {
    code: "kozmino",
    name: "Kozmino, Russia",
    reason: "ESPO crude Pacific terminal — dark fleet to Asia.",
    bbox: [[42.65, 133.00], [42.85, 133.40]],
  },
  {
    code: "novorossiysk",
    name: "Novorossiysk, Russia",
    reason: "Black Sea crude / products — dual-use infra, elevated scrutiny.",
    bbox: [[44.60, 37.70], [44.80, 37.95]],
  },
  {
    code: "kharg",
    name: "Kharg Island, Iran",
    reason: "Iranian crude loadings — near-universal AIS-off post-2018.",
    bbox: [[29.20, 50.20], [29.40, 50.40]],
  },
  {
    code: "bandar_abbas",
    name: "Bandar Abbas, Iran",
    reason: "Gasoline / condensate — intermittent AIS-off reported.",
    bbox: [[27.10, 56.20], [27.25, 56.45]],
  },
];

/** Point-in-bbox test. Cheap — use for per-message filtering. */
export function zoneContaining(
  lat: number,
  lon: number,
): SanctionedZone | null {
  for (const zone of SANCTIONED_ZONES) {
    const [[latMin, lonMin], [latMax, lonMax]] = zone.bbox;
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
      return zone;
    }
  }
  return null;
}
