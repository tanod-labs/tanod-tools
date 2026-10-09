// Sun and Moon positions, rise / set / twilight times and Moon phase, computed in the browser (no ephemeris file,
// no network). A port of the Python implementation behind the Tanod sun/moon API (microapi/astro.py).
//
// Algorithms: Jean Meeus, Astronomical Algorithms, 2nd ed. (Willmann-Bell, 1998): ch. 25 low-accuracy Sun, ch. 47
// Moon (the 32 largest longitude/distance terms and 14 largest latitude terms), ch. 12 sidereal time, ch. 48 phase
// angle. Events are found by sampling the altitude every 10 minutes and bisecting each sign change.
// Accuracy against JPL DE421: Sun < 0.02 deg, Moon < 0.1 deg; sunrise, sunset and twilight within about 1 minute,
// moonrise and moonset within about 3 minutes, illuminated fraction within 0.5 percentage points.
// Pure functions of milliseconds since the Unix epoch; no DOM.

export const AU_KM = 149597870.7;
export const SUN_H0 = -0.8333;            // Sun's centre at the horizon: refraction 34' + semi-diameter 16'
const REFRACTION_DEG = 34 / 60;
const MOON_RADIUS_KM = 1737.4;
const EARTH_EQ_RADIUS_KM = 6378.14;
export const TWILIGHTS = { civil: -6, nautical: -12, astronomical: -18 };
const D2R = Math.PI / 180;

export const julianDay = (ms) => ms / 86400000 + 2440587.5;
const century = (jd) => (jd - 2451545) / 36525;
const norm = (d) => ((d % 360) + 360) % 360;
const sin = (d) => Math.sin(d * D2R);
const cos = (d) => Math.cos(d * D2R);

function eqFromEcl(lon, lat, eps) {
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * D2R) * sin(eps), cos(lon));
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon));
  return [norm(ra / D2R), dec / D2R];
}

/* [apparent ecliptic longitude deg, obliquity deg, distance km] */
export function sunEcliptic(jd) {
  const t = century(jd);
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const e = 0.016708634 - 0.000042037 * t;
  const c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * sin(m) + (0.019993 - 0.000101 * t) * sin(2 * m) + 0.000289 * sin(3 * m);
  const trueLon = l0 + c, nu = m + c;
  const rAu = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu));
  const omega = 125.04 - 1934.136 * t;
  const lam = trueLon - 0.00569 - 0.00478 * sin(omega);
  const eps = 23.439291 - 0.0130042 * t + 0.00256 * cos(omega);
  return [norm(lam), eps, rAu * AU_KM];
}

export function sunRadec(jd) {
  const [lam, eps, r] = sunEcliptic(jd);
  const [ra, dec] = eqFromEcl(lam, 0, eps);
  return [ra, dec, r];
}

// Meeus Table 47.A: D, M, M', F, longitude (1e-6 deg), distance (1e-3 km)
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];
// Meeus Table 47.B: D, M, M', F, latitude (1e-6 deg)
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359],
];

/* [apparent ecliptic longitude deg, latitude deg, distance km, obliquity deg] */
export function moonEcliptic(jd) {
  const t = century(jd);
  const lp = norm(218.3164477 + 481267.88123421 * t - 0.0015786 * t * t);
  const d = norm(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t);
  const m = norm(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t);
  const mp = norm(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t);
  const f = norm(93.272095 + 483202.0175233 * t - 0.0036539 * t * t);
  const a1 = norm(119.75 + 131.849 * t), a2 = norm(53.09 + 479264.29 * t), a3 = norm(313.45 + 481266.484 * t);
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  let sl = 0, sr = 0, sb = 0;
  for (const [cd, cm, cmp, cf, l, r] of LR) {
    const arg = cd * d + cm * m + cmp * mp + cf * f;
    const k = e ** Math.abs(cm);
    sl += l * k * sin(arg);
    sr += r * k * cos(arg);
  }
  for (const [cd, cm, cmp, cf, b] of B) sb += b * e ** Math.abs(cm) * sin(cd * d + cm * m + cmp * mp + cf * f);
  sl += 3958 * sin(a1) + 1962 * sin(lp - f) + 318 * sin(a2);
  sb += -2235 * sin(lp) + 382 * sin(a3) + 175 * sin(a1 - f) + 175 * sin(a1 + f) + 127 * sin(lp - mp) - 115 * sin(lp + mp);
  const omega = 125.04 - 1934.136 * t;
  const lon = lp + sl / 1e6 - 0.00478 * sin(omega);            // + nutation in longitude (leading term)
  const eps = 23.439291 - 0.0130042 * t + 0.00256 * cos(omega);
  return [norm(lon), sb / 1e6, 385000.56 + sr / 1000, eps];
}

export function moonRadec(jd) {
  const [lon, lat, r, eps] = moonEcliptic(jd);
  const [ra, dec] = eqFromEcl(lon, lat, eps);
  return [ra, dec, r];
}

export function gmstDeg(jd) {
  const t = century(jd);
  return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t ** 3 / 38710000);
}

/* [altitude deg, azimuth deg from north through east] for an east-positive longitude. */
export function altaz(ra, dec, jd, lat, lon) {
  const h = (gmstDeg(jd) + lon - ra) * D2R;
  const la = lat * D2R, de = dec * D2R;
  const sinAlt = Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.cos(de) * Math.sin(h), Math.sin(de) * Math.cos(la) - Math.cos(de) * Math.sin(la) * Math.cos(h));
  return [alt / D2R, norm(az / D2R)];
}

export function sunAltaz(ms, lat, lon) {
  const jd = julianDay(ms);
  const [ra, dec] = sunRadec(jd);
  return altaz(ra, dec, jd, lat, lon);
}

/* Topocentric (parallax-corrected) Moon altitude and azimuth, no refraction. */
export function moonAltaz(ms, lat, lon) {
  const jd = julianDay(ms);
  const [ra, dec, r] = moonRadec(jd);
  const [alt, az] = altaz(ra, dec, jd, lat, lon);
  const par = Math.asin(EARTH_EQ_RADIUS_KM / r);
  return [alt - Math.asin(Math.sin(par) * cos(alt)) / D2R, az];
}

/* Crossings of fn(t) - threshold in [t0, t1] (ms): [{t, kind: "rise" | "set"}], found by sampling and bisection. */
function crossings(fn, t0, t1, threshold, stepMs = 600000) {
  const out = [];
  let prevT = t0, prevV = fn(t0) - threshold, t = t0;
  while (t < t1) {
    t = Math.min(t + stepMs, t1);
    const v = fn(t) - threshold;
    if (prevV < 0 !== v < 0) {
      let lo = prevT, hi = t, vlo = prevV;
      for (let i = 0; i < 20; i++) {
        const mid = lo + (hi - lo) / 2;
        const vm = fn(mid) - threshold;
        if (vm < 0 === vlo < 0) { lo = mid; vlo = vm; } else hi = mid;
      }
      out.push({ t: hi, kind: v >= 0 ? "rise" : "set" });
    }
    prevT = t; prevV = v;
  }
  return out;
}

function maximum(fn, t0, t1, stepMs = 600000) {
  let bestT = t0, bestV = fn(t0), t = t0;
  while (t < t1) {
    t = Math.min(t + stepMs, t1);
    const v = fn(t);
    if (v > bestV) { bestT = t; bestV = v; }
  }
  let lo = Math.max(t0, bestT - stepMs), hi = Math.min(t1, bestT + stepMs);
  const g = 0.381966;
  for (let i = 0; i < 30; i++) {
    const a = lo + (hi - lo) * g, b = hi - (hi - lo) * g;
    if (fn(a) < fn(b)) lo = a; else hi = b;
  }
  const tb = lo + (hi - lo) / 2;
  return [tb, fn(tb)];
}

const first = (ev, kind) => ev.find((e) => e.kind === kind)?.t ?? null;

/* Sun events in [start, end) (ms): rise, set, solar noon, the three twilights, or the polar state. */
export function sunDay(start, end, lat, lon) {
  const alt = (t) => sunAltaz(t, lat, lon)[0];
  const out = {};
  const ev = crossings(alt, start, end, SUN_H0);
  out.sunrise = first(ev, "rise");
  out.sunset = first(ev, "set");
  const [noon, noonAlt] = maximum(alt, start, end);
  out.solarNoon = noon;
  out.maxAltitude = noonAlt;
  for (const [name, h] of Object.entries(TWILIGHTS)) {
    const e = crossings(alt, start, end, h);
    out[name + "Dawn"] = first(e, "rise");
    out[name + "Dusk"] = first(e, "set");
  }
  out.polar = null;
  if (out.sunrise === null && out.sunset === null) out.polar = alt(start) > SUN_H0 && alt(end) > SUN_H0 ? "day" : "night";
  return out;
}

/* Moonrise and moonset in [start, end) (ms) for the upper limb with standard refraction. */
export function moonDay(start, end, lat, lon) {
  const alt = (t) => moonAltaz(t, lat, lon)[0];
  const sd = Math.asin(MOON_RADIUS_KM / moonRadec(julianDay(start + (end - start) / 2))[2]) / D2R;
  const ev = crossings(alt, start, end, -REFRACTION_DEG - sd);
  return { moonrise: first(ev, "rise"), moonset: first(ev, "set") };
}

export const PHASES = ["new_moon", "waxing_crescent", "first_quarter", "waxing_gibbous", "full_moon", "waning_gibbous", "last_quarter", "waning_crescent"];

/* Moon-Sun elongation in degrees: 0 new, 90 first quarter, 180 full, 270 last quarter. */
export function elongation(ms) {
  const jd = julianDay(ms);
  const [mlon] = moonEcliptic(jd);
  const [slon] = sunEcliptic(jd);
  return norm(mlon - slon);
}

export function moonPhase(ms) {
  const jd = julianDay(ms);
  const [mlon, mlat, mr] = moonEcliptic(jd);
  const [slon, , sr] = sunEcliptic(jd);
  const elong = norm(mlon - slon);
  const psi = Math.acos(Math.max(-1, Math.min(1, cos(mlat) * cos(elong))));
  const inc = Math.atan2(sr * Math.sin(psi), mr - sr * Math.cos(psi));     // phase angle (Meeus 48.3); 0 = full
  const frac = (1 + Math.cos(inc)) / 2;
  const idx = Math.floor(((elong + 22.5) % 360) / 45);
  return { phase: PHASES[idx], illumination: frac, ageFraction: elong / 360, elongation: elong, waxing: elong < 180, distanceKm: mr };
}

const SYNODIC_DAYS = 29.530588853;
export const synodicDays = SYNODIC_DAYS;

/* Times (ms) in [start, end] when the elongation passes 0, 90, 180 or 270 degrees: [{t, quarter: 0..3}]. */
export function quarters(start, end) {
  const out = [];
  const step = 6 * 3600000;
  let prevT = start, prevE = elongation(start);
  for (let t = start + step; ; t += step) {
    const tt = Math.min(t, end);
    const e = elongation(tt);
    const q0 = Math.floor(prevE / 90), q1 = Math.floor(e / 90);
    if (q1 !== q0) {
      const target = ((q0 + 1) % 4) * 90;
      let lo = prevT, hi = tt;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const em = elongation(mid);
        const past = (((em - target + 540) % 360) - 180) >= 0;     // signed difference to the target, in (-180, 180]
        if (past) hi = mid; else lo = mid;
      }
      out.push({ t: hi, quarter: (q0 + 1) % 4 });
    }
    if (tt >= end) break;
    prevT = tt; prevE = e;
  }
  return out;
}
