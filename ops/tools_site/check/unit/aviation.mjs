// Unit tests for the Aviation & Space maths (site/tools/js/{aviationcore,astrocore,metarcore}.js), run with plain node:
//   node ops/tools_site/check/unit/aviation.mjs
// Reference values are literals: published constants, textbook examples, the Python astro.py output that the
// sun/moon API pins against JPL DE421 (the sun and moon tests of the private API), or arithmetic written here.
import { fileURLToPath } from "node:url";
import * as av from "../../../../site/tools/js/aviationcore.js";
import * as astro from "../../../../site/tools/js/astrocore.js";
import * as mt from "../../../../site/tools/js/metarcore.js";
import { readFileSync, existsSync } from "node:fs";

let n = 0, bad = 0;
const near = (a, b, tol, msg) => {
  n++;
  if (!(Math.abs(a - b) <= tol)) { bad++; console.log(`FAIL ${msg}: got ${a}, expected ${b} +/- ${tol}`); }
};
const eq = (a, b, msg) => {
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
};

/* ---- great circle */
const jl = av.greatCircle(40.6398, -73.7789, 51.4706, -0.4619);
near(jl.km, 5540, 10, "JFK-LHR km");
near(jl.initial, 51.2, 0.6, "JFK-LHR initial bearing");
near(av.greatCircle(0, 0, 0, 90).km, 10007.56, 0.01, "quarter equator");
near(av.greatCircle(0, 0, 1, 0).km, 111.2, 0.006, "one degree");
near(av.greatCircle(0, 0, 1, 0).nm, 60.04, 0.01, "one degree in nm");
near(av.greatCircle(90, 0, -90, 0).km, 20015.12, 0.01, "pole to pole");
near(av.greatCircle(0, 179, 0, -179).km, 222.39, 0.01, "antimeridian");
eq(Math.abs(av.greatCircle(0, 179, 0, -179).mid.lon), 180, "antimeridian midpoint");
eq(av.greatCircle(10, 20, 10, 20).initial, null, "same point has no bearing");
near(av.greatCircle(0, 0, 0, 90).mid.lon, 45, 1e-9, "midpoint");

/* ---- wind components */
const w1 = av.windComponents(270, 270, 20); near(w1.head, 20, 1e-9, "direct headwind"); near(w1.cross, 0, 1e-9, "no crosswind");
const w2 = av.windComponents(270, 360, 20); near(w2.head, 0, 1e-9, "wind from 360 on rwy 27: no head"); near(w2.cross, 20, 1e-9, "crosswind from the right");
const w3 = av.windComponents(90, 60, 30); near(w3.head, 30 * Math.cos(30 * Math.PI / 180), 1e-9, "30 degrees off"); near(w3.cross, -15, 1e-9, "from the left is negative");
near(av.windComponents(270, 90, 10).head, -10, 1e-9, "tailwind negative");
near(av.windComponents(10, 350, 10).cross, -10 * Math.sin(20 * Math.PI / 180), 1e-9, "wrap through north");
eq([av.runwayHeading("27"), av.runwayHeading("09L"), av.runwayHeading("275"), av.runwayHeading("360"), av.runwayHeading("37"), av.runwayHeading("x")], [270, 90, 275, 0, null, null], "runway parsing");

/* ---- ISA */
const s0 = av.isaAt(0);
near(s0.T - 273.15, 15, 1e-9, "ISA 0 ft temperature"); near(s0.P, 1013.25, 1e-9, "ISA 0 ft pressure"); near(s0.rho, 1.225, 0.0005, "ISA density");
const s10k = av.isaAt(10000 * av.FT);
near(s10k.T - 273.15, -4.81, 0.01, "ISA 10,000 ft temperature"); near(s10k.P, 696.8, 0.3, "ISA 10,000 ft pressure");
near(av.isaAt(11000).P, 226.32, 0.02, "ISA tropopause pressure"); near(av.isaAt(11000).T, 216.65, 1e-9, "ISA tropopause temperature");
near(av.isaAt(20000).P, 54.75, 0.05, "ISA 20 km pressure");
near(av.pressureToAltitude(1013.25), 0, 1e-6, "standard pressure is 0");
near(av.pressureToAltitude(av.isaAt(5000).P), 5000, 1e-6, "pressure round trip"); near(av.pressureToAltitude(av.isaAt(15000).P), 15000, 1e-6, "stratosphere round trip");
const d0 = av.densityAltitude(0, 1013.25, 15); near(d0.paM, 0, 1e-6, "PA at standard"); near(d0.daM, 0, 1e-3, "DA at standard"); near(d0.dev, 0, 1e-9, "ISA deviation 0");
// Denver (5,434 ft) on a 35 C day at ISA pressure: the actual air density equals ISA density at the density altitude
const den = av.densityAltitude(5434 * av.FT, 1013.25, 35);
let lo = 0, hi = 11000; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (av.isaAt(mid).rho > den.rho) lo = mid; else hi = mid; }
near(den.daM, lo, 0.05, "density altitude agrees with a bisection on the ISA density profile");
near(den.paM / av.FT, 5434, 0.01, "PA equals elevation when QNH is standard"); near(den.dev, 35 - (15 - 0.0065 * 5434 * av.FT), 0.01, "ISA deviation");
near(den.roughDaM / av.FT, den.daM / av.FT, 400, "120 ft per degree rule within 400 ft");
near(av.densityToAltitude(av.isaAt(8000).rho), 8000, 0.01, "density round trip");
near(av.densityAltitude(0, 1013.25, 30).daM / av.FT, 1800, 80, "sea level 30 C is about 1,800 ft");
near(av.stationPressure(1013.25, 0), 1013.25, 1e-9, "station pressure at sea level");

/* ---- units */
near(av.convert("speed", 100, "kt", "kmh"), 185.2, 1e-9, "100 kt in km/h"); near(av.convert("speed", 1, "ms", "kt"), 1.9438444924, 1e-9, "1 m/s in kt");
near(av.convert("pressure", 1013.25, "hpa", "inhg"), 29.9213, 0.0005, "standard pressure in inHg"); near(av.convert("pressure", 29.92, "inhg", "mmhg"), 759.97, 0.02, "inHg to mmHg");
near(av.convert("pressure", 760, "mmhg", "hpa"), 1013.25, 0.001, "760 mmHg");
near(av.convert("length", 1, "nm", "km"), 1.852, 1e-12, "NM"); near(av.convert("length", 10000, "ft", "m"), 3048, 1e-9, "10,000 ft");
near(av.convert("length", 1, "sm", "nm"), 0.868976242, 1e-8, "SM to NM");
near(av.convert("temperature", 15, "c", "f"), 59, 1e-9, "15 C"); near(av.convert("temperature", -40, "f", "c"), -40, 1e-9, "-40"); near(av.convert("temperature", 0, "c", "k"), 273.15, 1e-9, "0 C in K");

/* ---- Julian date, MJD, GPS */
near(av.jdFromMs(Date.UTC(2000, 0, 1, 12)), 2451545.0, 1e-9, "J2000.0");
near(av.jdFromMs(Date.UTC(1987, 0, 27)), 2446822.5, 1e-9, "Meeus example 7.a (1987 Jan 27.0)");
near(av.jdFromMs(Date.UTC(1957, 9, 4, 19, 26, 24)), 2436116.31, 0.0001, "Meeus example (Sputnik)");
near(av.mjdFromJd(2451545.0), 51544.5, 1e-9, "MJD of J2000");
eq(av.gpsFromMs(av.GPS_EPOCH_MS).week, 0, "GPS epoch is week 0");
eq(av.gpsMinusUtc(Date.UTC(2026, 9, 8)), 18, "GPS-UTC is 18 s now"); eq([av.gpsMinusUtc(Date.UTC(1989, 11, 31)), av.gpsMinusUtc(Date.UTC(1990, 0, 1))], [5, 6], "GPS-UTC around 1990-01-01"); eq(av.gpsMinusUtc(Date.UTC(1980, 5, 1)), 0, "GPS-UTC 1980");
// 2019-04-06 00:00 UTC was GPS week 2048 (the second rollover); GPS time was 18 s ahead
const g = av.gpsFromMs(Date.UTC(2019, 3, 6, 23, 59, 42)); eq([g.week, g.mod1024], [2048, 0], "GPS week rollover 2019-04-06");
eq(av.gpsFromMs(Date.UTC(2019, 3, 6, 23, 59, 41)).week, 2047, "one second earlier is week 2047");
eq(av.msFromGps(2048, 0), Date.UTC(2019, 3, 6, 23, 59, 42), "GPS week 2048 sow 0 -> UTC");
eq(av.gpsFromMs(Date.UTC(1999, 7, 21, 23, 59, 47)).week, 1024, "first rollover 1999-08-22 (GPS time)");
eq(av.dayOfYear(Date.UTC(2024, 11, 31)), 366, "day of year in a leap year");

/* ---- light time, orbits */
near(av.lightSeconds(384400), 1.282, 0.001, "Moon light time"); near(av.lightSeconds(av.AU_KM), 499.005, 0.001, "1 AU light time");
near(av.orbitFromAltitude(35786).period / 3600, 23.934, 0.01, "geostationary period (sidereal day)");
near(av.orbitFromAltitude(420).period / 60, 92.9, 0.2, "ISS period"); near(av.orbitFromAltitude(420).speed, 7.66, 0.01, "ISS speed");
near(av.orbitFromAltitude(20200).period / 3600, 11.97, 0.02, "GPS period");
near(av.altitudeFromPeriod(86164.0905).h, 35786, 2, "GEO altitude from sidereal day");
near(av.altitudeFromPeriod(av.orbitFromAltitude(800).period).h, 800, 1e-6, "round trip");
near(av.bodyDistances("mars").near / av.AU_KM, 0.52366, 1e-9, "Mars closest");

/* ---- aurora */
near(av.geomagLat(av.POLE.lat, av.POLE.lon), 90, 1e-9, "geomagnetic pole");
near(av.geomagLat(0, 17.32), 0, 0.01, "magnetic equator crosses the geographic equator near 17 E");
near(av.geomagLat(64.84, -147.72), 65.3, 1.0, "Fairbanks about 65 N geomagnetic");   // accepted range for a dipole: 64-66
near(av.geomagLat(51.5, -0.12), 53.4, 1.5, "London about 53-54 N geomagnetic");
eq([av.auroraView(70, 3), av.auroraView(58, 3), av.auroraView(40, 3)], ["overhead", "horizon", "none"], "aurora view");

/* ---- astro.py parity (values from microapi/astro.py, which is pinned to JPL DE421 within about 1 minute) */
const near1 = (a, b, tolS, msg) => near(a / 1000, b / 1000, tolS, msg);
const day = (lat, lon, startMs) => ({ s: astro.sunDay(startMs, startMs + 86400000, lat, lon), m: astro.moonDay(startMs, startMs + 86400000, lat, lon) });
{
  const { s, m } = day(14.5995, 120.9842, Date.UTC(2026, 9, 7, 16));
  near1(s.sunrise, 1791409580803, 2, "Manila sunrise"); near1(s.sunset, 1791452452060, 2, "Manila sunset");
  near1(s.solarNoon, 1791431017071, 2, "Manila noon"); near(s.maxAltitude, 69.5357, 0.01, "Manila max altitude");
  near1(s.civilDawn, 1791408294247, 2, "Manila civil dawn"); near1(s.astronomicalDusk, 1791456717846, 2, "Manila astro dusk");
  near1(m.moonrise, 1791401146876, 5, "Manila moonrise"); near1(m.moonset, 1791446375597, 5, "Manila moonset");
  // JPL DE421 references pinned by the API tests: within 60 s (sun), 240 s (moon)
  near1(s.sunrise, Date.parse("2026-10-07T21:46:21Z"), 60, "Manila sunrise vs DE421"); near1(s.sunset, Date.parse("2026-10-08T09:40:51Z"), 60, "Manila sunset vs DE421");
  near1(m.moonrise, Date.parse("2026-10-07T19:26:56Z"), 240, "Manila moonrise vs DE421");
}
{
  const { s, m } = day(59.9139, 10.7522, Date.UTC(2026, 9, 7, 22));
  near1(s.sunrise, 1791437934105, 2, "Oslo sunrise"); near1(s.sunset, 1791476938930, 2, "Oslo sunset");
  near1(s.sunrise, Date.parse("2026-10-08T05:38:55Z"), 60, "Oslo sunrise vs DE421"); near1(m.moonset, 1791474186052, 5, "Oslo moonset");
}
{
  const { s } = day(69.65, 18.96, Date.UTC(2026, 5, 20, 22));
  eq([s.polar, s.sunrise], ["day", null], "Tromso midnight sun");
  const w = day(69.65, 18.96, Date.UTC(2026, 11, 20, 22)).s; eq(w.polar, "night", "Tromso polar night");
}
{
  const ph = astro.moonPhase(Date.UTC(2026, 9, 8, 12));
  near(ph.illumination, 0.0529, 0.001, "moon illumination 2026-10-08"); eq(ph.phase, "waning_crescent", "phase name"); near(ph.elongation, 333.51, 0.02, "elongation");
  eq(astro.moonPhase(Date.UTC(2026, 9, 26, 4)).phase, "full_moon", "full moon 2026-10-26");
  const q = astro.quarters(Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1));
  eq(q.length >= 4 && q.length <= 5, true, "four or five quarter phases in a month");
  const full = q.find((x) => x.quarter === 2); near(full.t / 3600000, Date.parse("2026-10-26T04:12:00Z") / 3600000, 6, "full moon time (Oct 2026, within 6 h)");
}

/* ---- METAR / TAF (the same cases as the Python decoder's tests) */
{
  const d = mt.decodeMetar("METAR KSFO 080256Z 29016KT 10SM FEW003 16/13 A2986 RMK AO2 SLP112 T01560128 53003");
  eq([d.station, d.observed, d.wind.dir, d.wind.speedKt, mt.compass(d.wind.dir)], ["KSFO", { day: 8, hour: 2, minute: 56 }, 290, 16, "WNW"], "KSFO basics");
  eq([d.visibility.sm, d.visibility.m, d.temperatureC, d.dewpointC, d.altimeter.inhg, d.altimeter.hpa, d.flightCategory], [10, 16093, 16, 13, 29.86, 1011.2, "VFR"], "KSFO values");
  eq([d.clouds, d.remarks, d.unparsed], [[{ cover: "FEW", heightFt: 300, type: null }], "AO2 SLP112 T01560128 53003", []], "KSFO clouds/remarks");
  const e = mt.decodeMetar("EGLL 080220Z AUTO 24008KT 9999 -RA SCT015CB BKN025 M02/M05 Q0998 NOSIG");
  eq([e.auto, e.wind.dir, e.visibility.m, e.weather[0].intensity, e.weather[0].phenomena, e.clouds[0].type, e.temperatureC, e.dewpointC, e.altimeter.hpa, e.trend, e.flightCategory],
    [true, 240, 9999, "light", ["RA"], "CB", -2, -5, 998, "NOSIG", "MVFR"], "EGLL METAR");
  const c = mt.decodeMetar("LFPG 080500Z 00000KT CAVOK 10/09 Q1020");
  eq([c.cavok, c.wind.calm, c.flightCategory], [true, true, "VFR"], "CAVOK");
  const f = mt.decodeMetar("KJFK 081951Z 1 1/2SM BR VV002 12/12 A3001");
  eq([f.visibility.sm, f.verticalVisibilityFt, f.flightCategory], [1.5, 200, "LIFR"], "mixed-number visibility and vertical visibility");
  eq(mt.decodeMetar("RPLL 080500Z 12010G25KT 080V150 FOGGY 28/25 Q1008").unparsed, ["FOGGY"], "unknown group is reported");
  eq(mt.decodeMetar("RPLL 080500Z VRB03MPS 4000 1500NE").unparsed, ["1500NE"], "unknown group 2");
  const v = mt.decodeMetar("RPLL 080500Z 12010G25KT 080V150 8000 R06/0900U 28/25 Q1008"); eq([v.wind.varFrom, v.wind.varTo, v.wind.gustKt, v.rvr[0].trend], [80, 150, 25, "improving"], "wind variation, gust, RVR");
  const t = mt.decodeTaf("TAF AMD KSFO 080300Z 0803/0906 30015KT P6SM FEW005 FM080600 28007KT P6SM FEW004 TEMPO 0900/0902 3SM BR PROB30 0902/0904 1SM FG TX20/0821Z TN12/0913Z");
  eq(t.forecast.map((g2) => g2.change), ["BASE", "FM", "TEMPO", "PROB30"], "TAF groups");
  eq([t.amended, t.forecast[2].flightCategory, t.forecast[3].flightCategory, t.temperatureExtremes.length, t.unparsed], [true, "IFR", "LIFR", 2, []], "TAF details");
  eq(mt.decodeTaf("TAF RPLL 080300Z NIL").nil, true, "TAF NIL");
  let code = ""; try { mt.decodeMetar("hello"); } catch (err) { code = err.code; } eq(code, "station", "error code");
  eq(mt.splitReports("METAR A 1\nMETAR B 2").length, 2, "split on METAR lines"); eq(mt.splitReports("TAF X\n 0803/0906 FM\n=\nTAF Y=").length, 2, "split on =");
}

console.log(`${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
