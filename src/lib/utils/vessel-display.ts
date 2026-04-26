// Vessel-name display normaliser. Renders the literal string "TBN"
// (To Be Nominated — industry shorthand for "no vessel assigned yet")
// for every variation of "no data" we've seen flow into the column:
//   - JS null / undefined
//   - empty string
//   - the literal text "null" / "undefined" (the AI parser used to
//     hallucinate these into vessel_name for vesselless recaps; the
//     parser is now sanitised but DB rows from earlier parses persist)
//   - assorted placeholders (N/A, TBD, TBA, em-dash, etc.)
//
// Centralised here so every render site (linkage header, Excel grid,
// Fleet card, deal card, schematic bar) gets the same answer instead
// of each component inventing its own fallback chain.

const PLACEHOLDER_NAMES = new Set([
  "null",
  "undefined",
  "n/a",
  "na",
  "none",
  "tbd",
  "tba",
  "tbc",
  "—",
  "-",
  "?",
  "unknown",
]);

export function formatVesselName(name: string | null | undefined): string {
  if (!name) return "TBN";
  const trimmed = String(name).trim();
  if (!trimmed) return "TBN";
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) return "TBN";
  return trimmed;
}

export function formatVesselImo(imo: string | null | undefined): string {
  if (!imo) return "—";
  const trimmed = String(imo).trim();
  if (!trimmed) return "—";
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) return "—";
  return trimmed;
}

/** True when the vessel slot is effectively empty (nothing real to display). */
export function vesselIsUnassigned(name: string | null | undefined): boolean {
  return formatVesselName(name) === "TBN";
}
