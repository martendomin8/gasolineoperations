// Math constants for the voyage-timeline auto-fill cascade. Centralised so
// the same values drive the in-memory resolver, the linkage voyage strip
// UI, and the >14 kn reality check on operator-overridden disport ETAs.
//
// Port stay duration = BERTH_SETUP_HOURS + qty / rate. Setup time is
// ADDITIVE, not a floor — every port call eats the same fixed slice for
// NOR + customs + survey + mooring + manifold connection + sample +
// disconnection + BL signing, regardless of cargo size. Pumping time
// (qty / rate) stacks on top.
//
// UNREALISTIC_SPEED_KN is the threshold at which a manually-entered disport
// ETA gets a red warning ("assumes X kn — recheck"). Most product/chemical
// tankers cruise 12-13 kn for fuel economy; > 14 kn is suspicious regardless
// of the vessel's design speed.

export const LOAD_RATE_MT_PER_HOUR = 800;
export const DISCHARGE_RATE_MT_PER_HOUR = 600;
export const BERTH_SETUP_HOURS = 8;
/** @deprecated kept as an alias to ease migration; prefer BERTH_SETUP_HOURS. */
export const MIN_BERTH_SETUP_HOURS = BERTH_SETUP_HOURS;
export const UNREALISTIC_SPEED_KN = 14;
export const DEFAULT_CP_SPEED_KN = 12;
