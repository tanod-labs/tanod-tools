// Time-zone helpers for the date tools, built on the browser's Intl time-zone data. Nothing is sent anywhere.
import { tx, EN, dateFormat } from "./i18n.js?v=5";

export const LOCAL_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (_) { return "UTC"; }
})();

const fmts = new Map();
function partsFormatter(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", era: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    fmts.set(tz, f);
  }
  return f;
}

export function isZone(tz) {
  try { partsFormatter(tz); return true; } catch (_) { return false; }
}

/* A UTC instant (ms) from calendar fields, valid for any year (Date.UTC maps years 0-99 to 1900-1999). */
export function utcFromFields(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
  const t = new Date(Date.UTC(2000, 0, 1, h, mi, s, ms));
  t.setUTCFullYear(y, mo - 1, d);
  return t.getTime();
}

/* Wall-clock fields {y, mo, d, h, mi, s} of an instant in a zone. Years before 1 CE are astronomical (0, -1, ...). */
export function wallFields(ms, tz) {
  if (tz === "UTC") {
    const t = new Date(ms);
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
  }
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  let y = Number(p.year);
  if (/^B/i.test(p.era || "")) y = 1 - y;
  return { y, mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/* Offset of a zone from UTC at an instant, in minutes (east positive). */
export function offsetMinutes(ms, tz) {
  if (tz === "UTC") return 0;
  const base = Math.floor(ms / 1000) * 1000;
  const f = wallFields(base, tz);
  return Math.round((utcFromFields(f.y, f.mo, f.d, f.h, f.mi, f.s) - base) / 60000);
}

const sameWall = (a, b) => a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi && a.s === b.s;

/* Every instant at which a zone's clock shows these fields: [] in a spring-forward gap, two in a fall-back overlap. */
export function wallToInstants(f, tz) {
  const guess = utcFromFields(f.y, f.mo, f.d, f.h, f.mi, f.s || 0);
  if (tz === "UTC") return [guess];
  const offsets = new Set([offsetMinutes(guess - 864e5, tz), offsetMinutes(guess, tz), offsetMinutes(guess + 864e5, tz)]);
  const out = [];
  for (const o of offsets) {
    const t = guess - o * 60000;
    if (sameWall(wallFields(t, tz), { ...f, s: f.s || 0 }) && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/* Resolve wall-clock fields to one instant, the way most software does ("compatible"):
   in a gap the clock reading is moved forward by the length of the gap; in an overlap the earlier instant is used.
   Returns {ms, kind: "ok" | "gap" | "overlap", other?} */
export function resolveWall(f, tz) {
  const list = wallToInstants(f, tz);
  if (list.length === 1) return { ms: list[0], kind: "ok" };
  if (list.length > 1) return { ms: list[0], kind: "overlap", other: list[list.length - 1] };
  const guess = utcFromFields(f.y, f.mo, f.d, f.h, f.mi, f.s || 0);
  const before = offsetMinutes(guess - 864e5, tz);
  return { ms: guess - before * 60000, kind: "gap" };
}

export const pad = (n, w = 2) => (n < 0 ? "-" : "") + String(Math.abs(n)).padStart(w, "0");

export function fmtYear(y) { return y < 0 || y > 9999 ? (y < 0 ? "-" : "+") + String(Math.abs(y)).padStart(6, "0") : pad(y, 4); }

/* "+08:00", "-04:00", "+00:00" */
export function fmtOffset(min, sep = ":") {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return sign + pad(Math.floor(a / 60)) + sep + pad(a % 60);
}

/* "2026-10-08 14:05:09" in a zone */
export function fmtWall(ms, tz, { seconds = true } = {}) {
  const f = wallFields(ms, tz);
  return `${fmtYear(f.y)}-${pad(f.mo)}-${pad(f.d)} ${pad(f.h)}:${pad(f.mi)}${seconds ? ":" + pad(f.s) : ""}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekday(ms, tz) {
  const f = wallFields(ms, tz);
  return WD[new Date(utcFromFields(f.y, f.mo, f.d)).getUTCDay()];
}

/* Short weekday name for people to read: "Thu" on English pages, the page language's own form elsewhere.
   (weekday() above stays English for machine formats such as RFC 2822.) */
export function weekdayLabel(ms, tz) {
  if (EN) return weekday(ms, tz);
  const f = wallFields(ms, tz);
  return dateFormat({ weekday: "short", timeZone: "UTC" }).format(new Date(utcFromFields(f.y, f.mo, f.d)));
}

/* Display names of well-known places. Anything else shows the last part of its IANA name ("Sao Paulo"). */
const CITIES = {
  UTC: "UTC",
  "America/New_York": tx("New York"), "America/Chicago": tx("Chicago"), "America/Denver": tx("Denver"),
  "America/Los_Angeles": tx("Los Angeles"), "America/Toronto": tx("Toronto"), "America/Mexico_City": tx("Mexico City"),
  "America/Sao_Paulo": tx("Sao Paulo"), "America/Argentina/Buenos_Aires": tx("Buenos Aires"), "America/Bogota": tx("Bogota"),
  "America/Lima": tx("Lima"), "Pacific/Honolulu": tx("Honolulu"),
  "Europe/London": tx("London"), "Europe/Paris": tx("Paris"), "Europe/Berlin": tx("Berlin"), "Europe/Madrid": tx("Madrid"),
  "Europe/Rome": tx("Rome"), "Europe/Amsterdam": tx("Amsterdam"), "Europe/Lisbon": tx("Lisbon"), "Europe/Vienna": tx("Vienna"),
  "Europe/Zurich": tx("Zurich"), "Europe/Stockholm": tx("Stockholm"), "Europe/Athens": tx("Athens"),
  "Europe/Moscow": tx("Moscow"), "Europe/Istanbul": tx("Istanbul"), "Europe/Kyiv": tx("Kyiv"),
  "Africa/Cairo": tx("Cairo"), "Africa/Lagos": tx("Lagos"), "Africa/Nairobi": tx("Nairobi"), "Africa/Johannesburg": tx("Johannesburg"),
  "Asia/Dubai": tx("Dubai"), "Asia/Karachi": tx("Karachi"), "Asia/Kolkata": tx("Kolkata"), "Asia/Dhaka": tx("Dhaka"),
  "Asia/Bangkok": tx("Bangkok"), "Asia/Jakarta": tx("Jakarta"), "Asia/Singapore": tx("Singapore"), "Asia/Manila": tx("Manila"),
  "Asia/Hong_Kong": tx("Hong Kong"), "Asia/Shanghai": tx("Shanghai"), "Asia/Seoul": tx("Seoul"), "Asia/Tokyo": tx("Tokyo"),
  "Australia/Sydney": tx("Sydney"), "Pacific/Auckland": tx("Auckland"),
};
/* "New York" for America/New_York, "Tokyo" for Asia/Tokyo, "UTC" for UTC. */
export const zoneCity = (z) => CITIES[z] || z.split("/").pop().replace(/_/g, " ");

/* Short zone name such as "EST" or "GMT+8", when the browser has one. */
export function zoneAbbr(ms, tz) {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms));
    return (p.find((x) => x.type === "timeZoneName") || {}).value || "";
  } catch (_) { return ""; }
}

export function zoneList() {
  try {
    if (Intl.supportedValuesOf) return Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC");
  } catch (_) { /* older browser */ }
  return [];
}

/* Fill a <select> with "Your time zone", UTC and every IANA zone the browser knows. */
export function fillZoneSelect(select, { localLabel = tx("Your time zone") } = {}) {
  const opt = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; };
  select.replaceChildren(opt("local", `${localLabel} (${LOCAL_ZONE})`), opt("UTC", "UTC"));
  const zones = zoneList();
  if (zones.length) {
    const g = document.createElement("optgroup");
    g.label = tx("All time zones");
    for (const z of zones) g.append(opt(z, z.replace(/_/g, " ")));
    select.append(g);
  }
}

export const zoneOf = (value) => (value === "local" ? LOCAL_ZONE : value);
