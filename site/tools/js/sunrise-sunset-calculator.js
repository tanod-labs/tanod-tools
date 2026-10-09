// Sunrise, sunset, twilights, moonrise, moonset and moon phase for a place and a date (astrocore.js, after Meeus).
import { $, tx } from "./core.js?v=11";
import { sunDay, moonDay, moonPhase } from "./astrocore.js?v=11";
import { fillZoneSelect, zoneOf, wallFields, resolveWall, pad } from "./tzcore.js?v=11";
import { readNum, f, fInt, fillStats, invalid, duration, latText, lonText, plain, locate, PHASE_NAMES, PHASE_GLYPH } from "./avui.js?v=11";

const latEl = $("#ss-lat"), lonEl = $("#ss-lon"), dateEl = $("#ss-date"), tzEl = $("#ss-tz");
const msg = $("#ss-msg"), res = $("#ss-res");
fillZoneSelect(tzEl);
tzEl.value = "local";

const iso = (f2) => `${String(f2.y).padStart(4, "0")}-${pad(f2.mo)}-${pad(f2.d)}`;
const clock = (ms, tz) => { const w = wallFields(ms, tz); return `${pad(w.h)}:${pad(w.mi)}`; };
const NONE = tx("does not occur on this date");

function update() {
  invalid([latEl, lonEl, dateEl], false);
  res.hidden = true;
  const lat = readNum(latEl), lon = readNum(lonEl);
  const dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(dateEl.value);
  if (lat === null || lon === null) { msg.textContent = tx("Enter a latitude and a longitude, or use your location."); return; }
  const bad = [];
  if (Number.isNaN(lat) || Math.abs(lat) > 90) bad.push(latEl);
  if (Number.isNaN(lon) || Math.abs(lon) > 180) bad.push(lonEl);
  if (bad.length) { invalid(bad); msg.textContent = tx("Latitude must be between -90 and 90, and longitude between -180 and 180, in decimal degrees."); return; }
  if (!dm) { invalid([dateEl]); msg.textContent = tx("Choose a date."); return; }
  msg.textContent = "";
  const tz = zoneOf(tzEl.value);
  const y = +dm[1], mo = +dm[2], d = +dm[3];
  const start = resolveWall({ y, mo, d, h: 0, mi: 0, s: 0 }, tz).ms;
  const nx = new Date(Date.UTC(2000, 0, 1)); nx.setUTCFullYear(y, mo - 1, d + 1);
  const end = resolveWall({ y: nx.getUTCFullYear(), mo: nx.getUTCMonth() + 1, d: nx.getUTCDate(), h: 0, mi: 0, s: 0 }, tz).ms;
  const sun = sunDay(start, end, lat, lon);
  const moon = moonDay(start, end, lat, lon);
  const ph = moonPhase(start + (end - start) / 2);
  const t = (ms) => (ms === null ? NONE : clock(ms, tz));
  let length = null;
  if (sun.sunrise !== null && sun.sunset !== null) length = (((sun.sunset - sun.sunrise) / 1000) + 86400) % 86400;
  else if (sun.polar === "day") length = 86400;
  else if (sun.polar === "night") length = 0;
  $("#ss-main").textContent = length === null ? "–" : sun.polar === "day" ? tx("24 h (polar day)") : sun.polar === "night" ? tx("0 h (polar night)") : duration(length);
  fillStats($("#ss-sun"), [
    [tx("Sunrise"), t(sun.sunrise)],
    [tx("Sunset"), t(sun.sunset)],
    [tx("Solar noon"), `${clock(sun.solarNoon, tz)} (${tx("{n}° high", { n: f(sun.maxAltitude, 1) })})`],
    [tx("Civil twilight begins"), t(sun.civilDawn)],
    [tx("Civil twilight ends"), t(sun.civilDusk)],
    [tx("Nautical twilight begins"), t(sun.nauticalDawn)],
    [tx("Nautical twilight ends"), t(sun.nauticalDusk)],
    [tx("Astronomical twilight begins"), t(sun.astronomicalDawn)],
    [tx("Astronomical twilight ends"), t(sun.astronomicalDusk)],
  ]);
  fillStats($("#ss-moon"), [
    [tx("Moonrise"), t(moon.moonrise)],
    [tx("Moonset"), t(moon.moonset)],
    [tx("Phase at midday"), `${PHASE_GLYPH[ph.phase]} ${PHASE_NAMES[ph.phase]}`],
    [tx("Illuminated"), `${fInt(ph.illumination * 100)} %`],
    [tx("Distance"), tx("{n} km", { n: fInt(ph.distanceKm) })],
  ]);
  $("#ss-main-l").textContent = tx("Daylight at {place}", { place: `${latText(lat, 2)}, ${lonText(lon, 2)}` });
  res.hidden = false;
}

function today() {
  const w = wallFields(Date.now(), zoneOf(tzEl.value));
  dateEl.value = iso(w);
  update();
}
[latEl, lonEl, dateEl].forEach((e) => e.addEventListener("input", update));
tzEl.addEventListener("change", update);
$("#ss-today").addEventListener("click", today);
locate($("#ss-locate"), msg, (la, lo) => { latEl.value = plain(la, 4); lonEl.value = plain(lo, 4); tzEl.value = "local"; today(); });
today();

