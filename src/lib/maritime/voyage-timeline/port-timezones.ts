// IANA timezone lookup for ports we commonly see on NEFGO voyages. Falls
// back to UTC when the port isn't in the table — UI then labels the
// timestamp "UTC" instead of "LT" so the operator knows it's not localised.
//
// Shipping convention: dates in CP recaps, NORs, statements of fact and
// agency emails are quoted in the LOAD/DISCHARGE port's local time. Mixing
// UTC and LT in the operator's view confuses everyone, so the voyage strip
// always displays each port's events in that port's local time.

const PORT_TZ: Record<string, string> = {
  // ── Western & Southern Europe ─────────────────────────────────
  ANTWERP: "Europe/Brussels",
  ROTTERDAM: "Europe/Amsterdam",
  AMSTERDAM: "Europe/Amsterdam",
  HAMBURG: "Europe/Berlin",
  WILHELMSHAVEN: "Europe/Berlin",
  BREMERHAVEN: "Europe/Berlin",
  "LE HAVRE": "Europe/Paris",
  BAYONNE: "Europe/Paris",
  LAVERA: "Europe/Paris",
  "FOS-SUR-MER": "Europe/Paris",
  MARSEILLE: "Europe/Paris",
  GENOA: "Europe/Rome",
  AUGUSTA: "Europe/Rome",
  MILAZZO: "Europe/Rome",
  TRIESTE: "Europe/Rome",
  GIBRALTAR: "Europe/Gibraltar",
  ALGECIRAS: "Europe/Madrid",
  BARCELONA: "Europe/Madrid",
  TARRAGONA: "Europe/Madrid",
  BILBAO: "Europe/Madrid",
  CARTAGENA: "Europe/Madrid",
  LISBON: "Europe/Lisbon",
  SINES: "Europe/Lisbon",

  // ── Baltic & North Atlantic ───────────────────────────────────
  RIGA: "Europe/Riga",
  VENTSPILS: "Europe/Riga",
  KLAIPEDA: "Europe/Vilnius",
  TALLINN: "Europe/Tallinn",
  MUUGA: "Europe/Tallinn",
  HELSINKI: "Europe/Helsinki",
  PORVOO: "Europe/Helsinki",
  STOCKHOLM: "Europe/Stockholm",
  GOTHENBURG: "Europe/Stockholm",
  COPENHAGEN: "Europe/Copenhagen",
  GDANSK: "Europe/Warsaw",
  GDYNIA: "Europe/Warsaw",
  STETTIN: "Europe/Warsaw",
  MONGSTAD: "Europe/Oslo",
  BERGEN: "Europe/Oslo",
  STAVANGER: "Europe/Oslo",
  PRIMORSK: "Europe/Moscow",
  "ST PETERSBURG": "Europe/Moscow",

  // ── Mediterranean / North Africa / Middle East ────────────────
  PIRAEUS: "Europe/Athens",
  THESSALONIKI: "Europe/Athens",
  ISTANBUL: "Europe/Istanbul",
  IZMIT: "Europe/Istanbul",
  MERSIN: "Europe/Istanbul",
  "SIDI KERIR": "Africa/Cairo",
  ALEXANDRIA: "Africa/Cairo",
  SUEZ: "Africa/Cairo",
  "PORT SAID": "Africa/Cairo",
  YANBU: "Asia/Riyadh",
  JUBAIL: "Asia/Riyadh",
  RAS_TANURA: "Asia/Riyadh",
  FUJAIRAH: "Asia/Dubai",
  "JEBEL ALI": "Asia/Dubai",
  KHALIFA: "Asia/Dubai",

  // ── Americas ──────────────────────────────────────────────────
  HOUSTON: "America/Chicago",
  "CORPUS CHRISTI": "America/Chicago",
  "NEW ORLEANS": "America/Chicago",
  PASCAGOULA: "America/Chicago",
  "NEW YORK": "America/New_York",
  PHILADELPHIA: "America/New_York",
  BALTIMORE: "America/New_York",
  BOSTON: "America/New_York",
  CHARLESTON: "America/New_York",
  PORTLAND: "America/New_York",
  "SAINT JOHN": "America/Halifax",
  HALIFAX: "America/Halifax",
  CHURCHILL: "America/Winnipeg",
  CALLAO: "America/Lima",
  "SANTOS": "America/Sao_Paulo",
  "RIO DE JANEIRO": "America/Sao_Paulo",
  PARANAGUA: "America/Sao_Paulo",

  // ── Asia / Pacific ────────────────────────────────────────────
  SINGAPORE: "Asia/Singapore",
  "MAP TA PHUT": "Asia/Bangkok",
  "LAEM CHABANG": "Asia/Bangkok",
  HONG_KONG: "Asia/Hong_Kong",
  YEOSU: "Asia/Seoul",
  DAESAN: "Asia/Seoul",
  ULSAN: "Asia/Seoul",
  YOKOHAMA: "Asia/Tokyo",
  CHIBA: "Asia/Tokyo",
  KAWASAKI: "Asia/Tokyo",
  TOKYO: "Asia/Tokyo",
  MAILIAO: "Asia/Taipei",
  KAOHSIUNG: "Asia/Taipei",
  SHANGHAI: "Asia/Shanghai",
  NINGBO: "Asia/Shanghai",
  QINGDAO: "Asia/Shanghai",
  DALIAN: "Asia/Shanghai",
  MUMBAI: "Asia/Kolkata",
  "JAWAHARLAL NEHRU": "Asia/Kolkata",
  CHENNAI: "Asia/Kolkata",
  KOLKATA: "Asia/Kolkata",
};

/**
 * Look up the IANA timezone for a port. Tolerant of country/region suffixes
 * ("Bayonne, France", "ANTWERP/BE") — strips after the first comma or slash.
 * Returns "UTC" when the port is unknown so callers don't crash.
 */
export function getPortTimezone(portName: string | null | undefined): string {
  if (!portName) return "UTC";
  const stripped = portName.toUpperCase().split(/[,/;]/)[0].trim();
  return PORT_TZ[stripped] ?? "UTC";
}

/**
 * Format a Date in the port's local time. Output: "17 Apr 14:00 LT" or
 * "17 Apr 14:00 UTC" when the port wasn't recognised.
 */
export function formatInPortTime(
  date: Date | null,
  portName: string | null | undefined
): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  const tz = getPortTimezone(portName);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} ${tz === "UTC" ? "UTC" : "LT"}`;
}

/**
 * Compose a `datetime-local` input value (YYYY-MM-DDTHH:mm, no seconds, no
 * timezone) for a Date as it appears in the port's local time. Used by the
 * voyage strip so the operator types arrival in port-LT, not browser-LT.
 */
export function toPortLocalInputValue(
  date: Date | null,
  portName: string | null | undefined
): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const tz = getPortTimezone(portName);
  // en-CA gives ISO-style "YYYY-MM-DD, HH:mm"; en-GB gives "DD/MM/YYYY, HH:mm".
  // Use en-CA so the date part is already YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}`;
}

/**
 * Inverse of `toPortLocalInputValue`: take the operator's "YYYY-MM-DDTHH:mm"
 * input string AS IF it were that port's local time, and return the absolute
 * Date (UTC instant).
 *
 * JS doesn't ship a "treat-this-naive-string-as-zone-X" parser, so we
 * iterate: ask the zone what it would call our current candidate, compute
 * the drift against the operator's intended local string, and shift the
 * candidate by that drift. Two iterations converges even across DST
 * boundaries (the second pass picks up the post-fold zone offset).
 *
 * Earlier version was buggy: it kept `value` as a fixed base on every
 * iteration, so iter 2 silently undid iter 1's correction whenever local(d)
 * happened to equal `value`. The fix is to apply the drift to the *current*
 * candidate `d`, not to the original input value.
 */
export function fromPortLocalInputValue(
  value: string,
  portName: string | null | undefined
): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const tz = getPortTimezone(portName);

  // Reference instant for the operator's intended naive string. We compare
  // every candidate's local-formatted output against this UTC anchor so the
  // drift always carries the same sign convention.
  const naiveAsUtcMs = new Date(`${value}:00Z`).getTime();
  let d = new Date(naiveAsUtcMs);

  for (let i = 0; i < 3; i++) {
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const lookup = Object.fromEntries(localParts.map((p) => [p.type, p.value]));
    const localAsIfUtcMs = new Date(
      `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}:00Z`
    ).getTime();
    // drift = how much later (or earlier) the zone reads compared to the
    // operator's intent. If positive, the zone shows a later time than they
    // typed → candidate is too far in the future, pull it back.
    const driftMs = localAsIfUtcMs - naiveAsUtcMs;
    if (driftMs === 0) break;
    d = new Date(d.getTime() - driftMs);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}
