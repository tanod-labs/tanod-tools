// Maths for the Aviation & Space tools. Pure functions, no DOM and no strings; every formula is cited in the
// matching tool's explainer. Not for flight planning or navigation.

export const R_EARTH_KM = 6371.0088;          // IUGG mean radius
export const KM_PER_NM = 1.852;               // international nautical mile
export const KM_PER_SM = 1.609344;            // statute mile
export const FT = 0.3048;                     // metre per foot
export const C_KM_S = 299792.458;             // speed of light, exact
export const AU_KM = 149597870.7;             // astronomical unit, exact (IAU 2012)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (d) => ((d % 360) + 360) % 360;

/* ------------------------------------------------------------------ great circle (haversine, Sinnott 1984) */

export function greatCircle(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const dp = p2 - p1;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const km = R_EARTH_KM * c;
  const brg = (aLat, aLon, bLat, bLon) => {
    const f1 = aLat * D2R, f2 = bLat * D2R, l = (bLon - aLon) * D2R;
    const y = Math.sin(l) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(l);
    return norm360(Math.atan2(y, x) * R2D);
  };
  const same = km < 1e-6;
  const initial = same ? null : brg(lat1, lon1, lat2, lon2);
  const final = same ? null : norm360(brg(lat2, lon2, lat1, lon1) + 180);
  // midpoint (Veness, Movable Type Scripts)
  const bx = Math.cos(p2) * Math.cos(dl), by = Math.cos(p2) * Math.sin(dl);
  const mLat = Math.atan2(Math.sin(p1) + Math.sin(p2), Math.hypot(Math.cos(p1) + bx, by));
  const mLon = lon1 * D2R + Math.atan2(by, Math.cos(p1) + bx);
  const wrap = ((mLon * R2D + 540) % 360) - 180;
  return { km, nm: km / KM_PER_NM, mi: km / KM_PER_SM, initial, final, mid: { lat: mLat * R2D, lon: wrap } };
}

/* ------------------------------------------------------------------ runway wind components */

/* Direction the wind blows FROM and the runway heading, both in degrees (magnetic or true, but the same for both).
   Positive headwind = wind on the nose; positive crosswind = from the right. */
export function windComponents(rwyDeg, windDeg, speed) {
  const a = (((windDeg - rwyDeg + 540) % 360) - 180) * D2R;   // angle of the wind relative to the runway, -180..180
  const head = speed * Math.cos(a);
  const cross = speed * Math.sin(a);
  return { head, cross, angle: a * R2D };
}

/* Runway number "27" -> 270, heading "275" -> 275. Returns null when it isn't a runway or a heading. */
export function runwayHeading(text) {
  const m = /^\s*(\d{1,3})\s*[LRC]?\s*$/i.exec(String(text));
  if (!m) return null;
  const n = Number(m[1]);
  if (m[1].length <= 2) return n >= 1 && n <= 36 ? n * 10 : null;
  return n >= 0 && n <= 360 ? n % 360 : null;
}

/* ------------------------------------------------------------------ ISA (ICAO Doc 7488 / ISO 2533) */

export const ISA = { T0: 288.15, P0: 1013.25, RHO0: 1.225, L: 0.0065, G: 9.80665, R: 287.05287 };
const EXP_P = ISA.G / (ISA.R * ISA.L);       // 5.25588
const H_TROP = 11000, H_MAX = 20000;

/* ISA temperature (K), pressure (hPa) and density (kg/m3) at a geopotential altitude in metres (-500..20000). */
export function isaAt(hM) {
  if (hM <= H_TROP) {
    const T = ISA.T0 - ISA.L * hM;
    const P = ISA.P0 * (T / ISA.T0) ** EXP_P;
    return { T, P, rho: (P * 100) / (ISA.R * T) };
  }
  const T = 216.65;
  const p11 = ISA.P0 * (T / ISA.T0) ** EXP_P;
  const P = p11 * Math.exp((-ISA.G * (hM - H_TROP)) / (ISA.R * T));
  return { T, P, rho: (P * 100) / (ISA.R * T) };
}

/* Pressure altitude (m) at a static pressure in hPa (troposphere formula, extended with the stratosphere layer). */
export function pressureToAltitude(pHpa) {
  const p11 = isaAt(H_TROP).P;
  if (pHpa >= p11) return (ISA.T0 / ISA.L) * (1 - (pHpa / ISA.P0) ** (1 / EXP_P));
  return H_TROP - ((ISA.R * 216.65) / ISA.G) * Math.log(pHpa / p11);
}

/* Station pressure (hPa) from an altimeter setting (QNH, hPa) and the station elevation (m). */
export function stationPressure(qnhHpa, elevM) {
  const T = ISA.T0 - ISA.L * elevM;
  return qnhHpa * (T / ISA.T0) ** EXP_P;
}

/* Density altitude (m) for an air density in kg/m3 (troposphere formula inverted). */
export function densityToAltitude(rho) {
  const r11 = isaAt(H_TROP).rho;
  if (rho >= r11) return (ISA.T0 / ISA.L) * (1 - (rho / ISA.RHO0) ** (1 / (EXP_P - 1)));
  // stratosphere: rho = rho11 * exp(-g (h - 11000) / (R T))
  return H_TROP - ((ISA.R * 216.65) / ISA.G) * Math.log(rho / r11);
}

/* Elevation (m), QNH (hPa) and outside air temperature (deg C) -> pressure altitude, density altitude and more. */
export function densityAltitude(elevM, qnhHpa, oatC) {
  const pStation = stationPressure(qnhHpa, elevM);
  const paM = pressureToAltitude(pStation);
  const T = oatC + 273.15;
  const rho = (pStation * 100) / (ISA.R * T);            // dry air
  const daM = densityToAltitude(rho);
  const isaT = isaAt(paM).T - 273.15;
  return { pStation, paM, daM, rho, isaT, dev: oatC - isaT, roughDaM: paM + 120 * FT * (oatC - isaT), beyond: paM > H_MAX || daM > H_MAX };
}

/* ------------------------------------------------------------------ units (exact definitions) */

/* size of one unit in the base unit: speed m/s, pressure Pa, length m. Temperature is handled separately. */
export const UNITS = {
  speed: [["kt", 1852 / 3600], ["kmh", 1 / 3.6], ["mph", 1609.344 / 3600], ["ms", 1], ["fpm", FT / 60], ["mach", 340.294]],
  pressure: [["hpa", 100], ["inhg", 3386.38864], ["mmhg", 133.322387415], ["kpa", 1000], ["psi", 6894.757293168]],
  length: [["ft", FT], ["m", 1], ["km", 1000], ["nm", 1852], ["sm", 1609.344]],
};
const TO_K = { c: (v) => v + 273.15, f: (v) => ((v + 459.67) * 5) / 9, k: (v) => v };
const FROM_K = { c: (k) => k - 273.15, f: (k) => (k * 9) / 5 - 459.67, k: (k) => k };
export const TEMP_UNITS = ["c", "f", "k"];

export function convert(cat, v, from, to) {
  if (cat === "temperature") {
    if (from === to) return v;
    if (from === "c" && to === "f") return (v * 9) / 5 + 32;
    if (from === "f" && to === "c") return ((v - 32) * 5) / 9;
    return FROM_K[to](TO_K[from](v));
  }
  const u = Object.fromEntries(UNITS[cat]);
  return (v * u[from]) / u[to];
}

/* ------------------------------------------------------------------ Julian date, MJD, GPS time */

const UNIX_JD = 2440587.5, MJD_OFFSET = 2400000.5;
export const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
// UTC dates (ms) at which a leap second was inserted after the GPS epoch; GPS - UTC = number of them so far.
const LEAPS = [[1981, 7], [1982, 7], [1983, 7], [1985, 7], [1988, 1], [1990, 1], [1991, 1], [1992, 7], [1993, 7], [1994, 7],
  [1996, 1], [1997, 7], [1999, 1], [2006, 1], [2009, 1], [2012, 7], [2015, 7], [2017, 1]].map(([y, m]) => Date.UTC(y, m - 1, 1));
export const LAST_LEAP_YEAR = 2017;

/* GPS minus UTC in seconds at a UTC instant (ms). Zero before the GPS epoch; 18 since 2017-01-01. */
export const gpsMinusUtc = (ms) => LEAPS.filter((t) => ms >= t).length;

export const jdFromMs = (ms) => ms / 86400000 + UNIX_JD;
export const msFromJd = (jd) => Math.round((jd - UNIX_JD) * 86400000);
export const mjdFromJd = (jd) => jd - MJD_OFFSET;
export const jdFromMjd = (mjd) => mjd + MJD_OFFSET;

/* GPS week (full count since 1980-01-06), the week modulo 1024, day of week (0 = Sunday) and seconds of week. */
export function gpsFromMs(ms) {
  const secs = (ms - GPS_EPOCH_MS) / 1000 + gpsMinusUtc(ms);
  if (secs < 0) return null;
  const week = Math.floor(secs / 604800);
  const sow = secs - week * 604800;
  return { week, mod1024: week % 1024, rollovers: Math.floor(week / 1024), sow, dow: Math.floor(sow / 86400), seconds: secs };
}

/* UTC instant (ms) of a GPS week and seconds of week (the leap-second count is applied at that instant). */
export function msFromGps(week, sow) {
  const gpsMs = GPS_EPOCH_MS + (week * 604800 + sow) * 1000;
  let ms = gpsMs - gpsMinusUtc(gpsMs) * 1000;
  ms = gpsMs - gpsMinusUtc(ms) * 1000;
  return ms;
}

export function dayOfYear(ms) {
  const d = new Date(ms);
  return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/* ------------------------------------------------------------------ light time and orbits */

export const SOLAR_SYSTEM = {
  // km: Moon from the Earth-Moon distance table (NASA Moon fact sheet); Sun: perihelion, mean, aphelion.
  moon: { near: 363300, mid: 384400, far: 405500 },
  sun: { near: 147.095e6, mid: AU_KM, far: 152.1e6 },
  // geostationary satellite: altitude 35,786 km straight overhead; 41,679 km to a satellite on the horizon
  geo: { near: 35786, mid: 35786, far: 41679 },
};
// Semi-major axes in AU (NASA planetary fact sheets). Closest and farthest Earth distance use the circular,
// coplanar approximation: |a - 1| and a + 1 AU.
export const PLANET_AU = { mercury: 0.38710, venus: 0.72333, mars: 1.52366, jupiter: 5.2029, saturn: 9.5367, uranus: 19.189, neptune: 30.070, pluto: 39.482 };

export function bodyDistances(id) {
  if (SOLAR_SYSTEM[id]) return SOLAR_SYSTEM[id];
  const a = PLANET_AU[id];
  const near = Math.abs(a - 1) * AU_KM, far = (a + 1) * AU_KM;
  return { near, mid: (near + far) / 2, far };
}

export const lightSeconds = (km) => km / C_KM_S;

export const MU_EARTH = 398600.4418;          // km3/s2, geocentric gravitational constant (WGS84/EGM96)
export const R_EQUATOR_KM = 6378.137;         // WGS84 equatorial radius

export function orbitFromAltitude(hKm) {
  const a = R_EQUATOR_KM + hKm;
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
  return { a, period, speed: Math.sqrt(MU_EARTH / a), perDay: 86400 / period };
}

export function altitudeFromPeriod(periodS) {
  const a = (MU_EARTH * (periodS / (2 * Math.PI)) ** 2) ** (1 / 3);
  return { a, h: a - R_EQUATOR_KM, period: periodS, speed: Math.sqrt(MU_EARTH / a), perDay: 86400 / periodS };
}

/* ------------------------------------------------------------------ aurora (dipole approximation) */

// Centred-dipole geomagnetic north pole, IGRF-13 epoch 2020: 80.65 N, 72.68 W.
export const POLE = { lat: 80.65, lon: -72.68 };

/* Geomagnetic latitude in degrees (positive in the northern magnetic hemisphere). */
export function geomagLat(lat, lon) {
  const p = lat * D2R, p0 = POLE.lat * D2R;
  const s = Math.sin(p) * Math.sin(p0) + Math.cos(p) * Math.cos(p0) * Math.cos((lon - POLE.lon) * D2R);
  return Math.asin(Math.max(-1, Math.min(1, s))) * R2D;
}

/* Rule of thumb for the equatorward edge of the auroral oval near magnetic midnight, in degrees of geomagnetic
   latitude: about 66.5 at Kp 0 moving 2 degrees closer to the equator for each step of Kp (about 48.5 at Kp 9). */
export const ovalEdge = (kp) => 66.5 - 2 * kp;

/* Where aurora could be seen from a geomagnetic latitude (absolute value) at a given Kp:
   "overhead" at or poleward of the oval edge, "horizon" up to 8 degrees equatorward of it, otherwise "none". */
export function auroraView(absMagLat, kp) {
  const d = absMagLat - ovalEdge(kp);
  if (d >= 0) return "overhead";
  if (d >= -8) return "horizon";
  return "none";
}
