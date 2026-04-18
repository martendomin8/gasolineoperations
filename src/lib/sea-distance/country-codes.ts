/**
 * Maps PUB 151 country/region names to ISO 3166-1 alpha-2 codes.
 *
 * PUB 151 uses full English names and sometimes sub-regions (Sicily,
 * Scotland, Corsica). This mapping normalises them all to standard
 * two-letter codes so port names display as "Barcelona, ES" instead
 * of "Barcelona, Spain".
 */
export const COUNTRY_TO_ISO: Record<string, string> = {
  // A
  "Albania": "AL",
  "Algeria": "DZ",
  "American Samoa": "AS",
  "Andaman Islands": "IN",
  "Angola": "AO",
  "Antigua": "AG",
  "Argentina": "AR",
  "Aruba": "AW",
  "Ascension Island": "SH",
  "Australia": "AU",
  "Azores": "PT",

  // B
  "Bahama Islands": "BS",
  "Bahamas": "BS",
  "Bahrain": "BH",
  "Bahrayn": "BH",
  "Balearic Islands": "ES",
  "Bangladesh": "BD",
  "Barbados": "BB",
  "Belgium": "BE",
  "Belize": "BZ",
  "Benin": "BJ",
  "Bermuda": "BM",
  "Bonaire": "BQ",
  "Brazil": "BR",
  "British Virgin Islands": "VG",
  "Bulgaria": "BG",
  "Burma": "MM",

  // C
  "Cabinda": "AO",
  "Cambodia": "KH",
  "Cameroon": "CM",
  "Canada": "CA",
  "Canary Islands": "ES",
  "Cape Verde Islands": "CV",
  "Caroline Islands": "FM",
  "Cayman Islands": "KY",
  "Chagos Archipelago": "IO",
  "Chile": "CL",
  "China": "CN",
  "Christmas Island": "CX",
  "Cocos Islands": "CC",
  "Colombia": "CO",
  "Congo": "CG",
  "Cook Islands": "CK",
  "Corsica": "FR",
  "Costa Rica": "CR",
  "Croatia": "HR",
  "Cuba": "CU",
  "Curacao": "CW",
  "Cyprus": "CY",

  // D
  "Denmark": "DK",
  "Djibouti": "DJ",
  "Dominica": "DM",
  "Dominican Republic": "DO",

  // E
  "Ecuador": "EC",
  "Egypt": "EG",
  "El Salvador": "SV",
  "England": "GB",
  "Equatorial Guinea": "GQ",
  "Equatorialguinea": "GQ",
  "Estonia": "EE",
  "Ethiopia": "ET",

  // F
  "Falkland Islands": "FK",
  "Faroe Islands": "FO",
  "Fiji Islands": "FJ",
  "Finland": "FI",
  "France": "FR",
  "French Polynesia": "PF",

  // G
  "Gabon": "GA",
  "Gambia": "GM",
  "Georgia": "GE",
  "Germany": "DE",
  "Ghana": "GH",
  "Gibraltar": "GI",
  "Grand Bahama Islands": "BS",
  "Great Inagua Island": "BS",
  "Greece": "GR",
  "Greenland": "GL",
  "Grenada": "GD",
  "Guadeloupe": "GP",
  "Guatemala": "GT",
  "Guinea": "GN",
  "Guinea-Bissau": "GW",
  "Gulf Of Guinea": "GQ",
  "Guyana": "GY",

  // H
  "Haiti": "HT",
  "Honduras": "HN",

  // I
  "Iceland": "IS",
  "Ile De France": "FR",
  "Iles Tuamotu": "PF",
  "India": "IN",
  "Indonesia": "ID",
  "Iran": "IR",
  "Iraq": "IQ",
  "Ireland": "IE",
  "Isle Of Man": "IM",
  "Israel": "IL",
  "Italy": "IT",
  "Ivory Coast": "CI",

  // J
  "Jamaica": "JM",
  "Japan": "JP",
  "Jordan": "JO",

  // K
  "Kenya": "KE",
  "Kermadec Islands": "NZ",
  "Kiribati": "KI",
  "Kriti": "GR",
  "Kuwait": "KW",

  // L
  "Latvia": "LV",
  "Lebanon": "LB",
  "Liberia": "LR",
  "Libya": "LY",
  "Line Islands": "KI",
  "Lithuania": "LT",

  // M
  "Madagascar": "MG",
  "Madeira Island": "PT",
  "Malaysia": "MY",
  "Malta": "MT",
  "Mariana Islands": "GU",
  "Marianaislands": "GU",
  "Marquesa Islands": "PF",
  "Marshall Islands": "MH",
  "Martinique": "MQ",
  "Mauritania": "MR",
  "Mauritius": "MU",
  "Mexico": "MX",
  "Monaco": "MC",
  "Montenegro": "ME",
  "Montserrat": "MS",
  "Morocco": "MA",
  "Mozambique": "MZ",

  // N
  "Namibia": "NA",
  "Netherlands": "NL",
  "New Zealand": "NZ",
  "Newcaledonia": "NC",
  "Newzealand": "NZ",
  "Nicaragua": "NI",
  "Nigeria": "NG",
  "North Korea": "KP",
  "North Pacific": "US",
  "Northern Ireland": "GB",
  "Northkorea": "KP",
  "Norway": "NO",

  // O
  "Oman": "OM",

  // P
  "Pacific": "US",
  "Pakistan": "PK",
  "Palauislands": "PW",
  "Panama": "PA",
  "Papua New Guinea": "PG",
  "Peru": "PE",
  "Philippines": "PH",
  "Phoenix Islands": "KI",
  "Poland": "PL",
  "Portugal": "PT",
  "Puerto Rico": "PR",

  // Q
  "Qatar": "QA",

  // R
  "Reunion Island": "RE",
  "Romania": "RO",
  "Russia": "RU",
  "Ryukyu Islands": "JP",

  // S
  "Sabah": "MY",
  "Saint Kitts And Nevis": "KN",
  "Samoa": "WS",
  "Sarawak": "MY",
  "Sardinia": "IT",
  "Saudi Arabia": "SA",
  "Scotland": "GB",
  "Senegal": "SN",
  "Seychelles": "SC",
  "Sicily": "IT",
  "Sierra Leone": "SL",
  "Sierraleone": "SL",
  "Slovenia": "SI",
  "Solomon Islands": "SB",
  "Somalia": "SO",
  "South Africa": "ZA",
  "South Atlantic": "SH",
  "South Korea": "KR",
  "South Pacific": "FJ",
  "Spain": "ES",
  "Sri Lanka": "LK",
  "Srilanka": "LK",
  "St. Croix": "VI",
  "St. Eustatius": "BQ",
  "St. Lucia": "LC",
  "St. Vincent": "VC",
  "St.Croix": "VI",
  "Sudan": "SD",
  "Sulawesi": "ID",
  "Suriname": "SR",
  "Svalbard": "SJ",
  "Sweden": "SE",
  "Syria": "SY",

  // T
  "Taiwan": "TW",
  "Tanzania": "TZ",
  "Tasmania": "AU",
  "Thailand": "TH",
  "Togo": "TG",
  "Tonga Islands": "TO",
  "Trinidad": "TT",
  "Tunisia": "TN",
  "Turkey": "TR",
  "Tuvalu": "TV",

  // U
  "U.A.E.": "AE",
  "U.S.A.": "US",
  "Ukraine": "UA",
  "Ukraine (Black Sea)": "UA",
  "United Arab Emirates": "AE",
  "Unitedkingdom": "GB",
  "Uruguay": "UY",

  // V
  "Venezuela": "VE",
  "Vietnam": "VN",
  "Virgin Islands": "VI",

  // W
  "Wales": "GB",
  "Western Sahara": "EH",

  // Y
  "Yemen": "YE",
};

/**
 * Convert a PUB 151 canonical name like "Barcelona, Spain" to a short
 * display name like "Barcelona, ES".
 *
 * Multi-part names like "Portland, Oregon, U.S.A." become "Portland, Oregon, US"
 * to keep the disambiguating middle part.
 */
export function toShortName(pub151Name: string): string {
  const parts = pub151Name.split(",").map((p) => p.trim());
  if (parts.length < 2) return pub151Name;

  const countryPart = parts[parts.length - 1];
  const iso = COUNTRY_TO_ISO[countryPart];
  if (!iso) return pub151Name; // unknown country — keep as-is

  // Replace the last part (country) with the ISO code
  parts[parts.length - 1] = iso;
  return parts.join(", ");
}

/**
 * Reverse lookup: given a short name like "Barcelona, ES", return the
 * possible PUB 151 long names. Used by findPort to accept both formats.
 */
const isoToCountries = new Map<string, string[]>();
for (const [country, iso] of Object.entries(COUNTRY_TO_ISO)) {
  if (!isoToCountries.has(iso)) isoToCountries.set(iso, []);
  isoToCountries.get(iso)!.push(country);
}

export function expandShortName(shortName: string): string[] {
  const parts = shortName.split(",").map((p) => p.trim());
  if (parts.length < 2) return [shortName];

  const lastPart = parts[parts.length - 1];
  // If the last part is a 2-letter ISO code, expand it
  if (lastPart.length === 2 && lastPart === lastPart.toUpperCase()) {
    const countries = isoToCountries.get(lastPart);
    if (countries) {
      return countries.map((c) => {
        const expanded = [...parts];
        expanded[expanded.length - 1] = c;
        return expanded.join(", ");
      });
    }
  }
  return [shortName];
}
