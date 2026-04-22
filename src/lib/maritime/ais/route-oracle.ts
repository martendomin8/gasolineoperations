/**
 * Route oracle — answers "where would the vessel be at time X if it
 * left `from` at `since` travelling at `cpSpeedKn` toward `to`?".
 *
 * This is the dependency `position-resolver.ts` needs for its
 * PREDICTED branch. Kept separate so:
 *   1. The resolver stays pure and unit-testable against stub oracles.
 *   2. The implementation can upgrade from great-circle to ocean-route
 *      (via our Dijkstra graph) later without touching the resolver
 *      or the API route.
 *
 * V1 implementation: great-circle interpolation. Good enough for ETA
 * visualisation when we have minutes-to-hours of AIS silence — the
 * resulting predicted position is usually within ~5 nm of where the
 * vessel actually is, because coastal AIS coverage is so dense we
 * rarely go more than a few hours dark at sea.
 *
 * V2 upgrade path: call the ocean-routing graph's Dijkstra runtime to
 * get a land-safe route, then interpolate along the polyline. Same
 * signature, same caller — drop-in replacement.
 */

/** Great-circle forward step — copied from position-resolver.ts to
 *  keep this module dependency-free. Distance in nautical miles. */
const EARTH_RADIUS_NM = 3440.065;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineNm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

function initialBearingDeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

function greatCircleForward(
  latDeg: number, lonDeg: number,
  bearingDeg: number, distanceNm: number,
): { lat: number; lon: number } {
  const lat1 = toRad(latDeg);
  const lon1 = toRad(lonDeg);
  const bearing = toRad(bearingDeg);
  const angDist = distanceNm / EARTH_RADIUS_NM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/**
 * V1 oracle — great-circle only. Signature matches the `routePredict`
 * callback in `position-resolver.ts` so the UI / API layer can wire
 * this in directly.
 */
export function predictGreatCircle(args: {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  since: Date;
  cpSpeedKn: number;
  at: Date;
}): { lat: number; lon: number; bearingDeg: number } | null {
  const elapsedH = (args.at.getTime() - args.since.getTime()) / 3_600_000;
  if (elapsedH <= 0) {
    // Clock disagreement — just return the anchor.
    return {
      lat: args.fromLat,
      lon: args.fromLon,
      bearingDeg: initialBearingDeg(args.fromLat, args.fromLon, args.toLat, args.toLon),
    };
  }
  const totalNm = haversineNm(args.fromLat, args.fromLon, args.toLat, args.toLon);
  if (totalNm === 0) {
    return { lat: args.toLat, lon: args.toLon, bearingDeg: 0 };
  }
  const sailedNm = args.cpSpeedKn * elapsedH;
  if (sailedNm >= totalNm) {
    return {
      lat: args.toLat,
      lon: args.toLon,
      bearingDeg: initialBearingDeg(args.fromLat, args.fromLon, args.toLat, args.toLon),
    };
  }
  const bearing = initialBearingDeg(args.fromLat, args.fromLon, args.toLat, args.toLon);
  const position = greatCircleForward(args.fromLat, args.fromLon, bearing, sailedNm);
  return { lat: position.lat, lon: position.lon, bearingDeg: bearing };
}
