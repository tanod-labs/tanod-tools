// Shared helpers for the calculators: number parsing and formatting, and calendar date arithmetic.
// Dates are handled as plain year/month/day numbers (no time zone, no daylight saving), so a
// day is always a day. Everything runs in the browser.
import { txn, EN, LOCALE, parseNum as parseLocal, dateFormat, listText } from "./i18n.js?v=11";

/* ------------------------------------------------------------------ numbers */

/* Parse what a person typed: allows spaces, thousands commas, a leading + and the Unicode minus.
   Returns null for an empty field and NaN for something that isn't a number. */
export function parseNum(s) {
  if (!EN) return parseLocal(s); // decimal comma on es, pt-BR, fr, de and id pages
  const t = String(s ?? "").trim().replace(/[\s,_]/g, "").replace(/−/g, "-");
  if (!t) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/* Round to `sig` significant figures. Returns a Number, so binary noise such as
   0.30000000000000004 becomes 0.3. */
export const roundSig = (n, sig = 10) => (n === 0 || !Number.isFinite(n) ? n : Number(n.toPrecision(sig)));

/* Format for display: at most `sig` significant figures, trailing zeros dropped, grouping commas
   (unless group is false), and e-notation only for very large or very small magnitudes. */
export function fmt(n, sig = 10, { group = true } = {}) {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  const r = roundSig(n, sig);
  const a = Math.abs(r);
  if (a >= 1e15 || a < 1e-6) {
    return r.toExponential(sig - 1).replace(/\.?0+e/, "e").replace("e+", "e");
  }
  return r.toLocaleString(LOCALE, { maximumSignificantDigits: Math.min(21, sig), useGrouping: group });
}

/* ------------------------------------------------------------------ calendar dates
   A date is {y, m, d} with m 1..12. Day numbers count days since 1970-01-01 in the proleptic
   Gregorian calendar (integer arithmetic only, valid for years 1..9999). */

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export function dayNumber({ y, m, d }) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* 0 = Sunday .. 6 = Saturday. 1970-01-01 was a Thursday. */
export const weekday = (date) => (((dayNumber(date) + 4) % 7) + 7) % 7;

/* "YYYY-MM-DD" (as an <input type=date> gives it) to {y, m, d}, or null. */
export function parseDate(s) {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!mm) return null;
  const y = +mm[1], m = +mm[2], d = +mm[3];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
export const isoDate = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/* A UTC Date for a calendar date, valid for years 1..9999 (Date.UTC maps years 0-99 to 1900-1999). */
function utcDate({ y, m, d }) {
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(y, m - 1, d);
  return t;
}

/* Weekday name for 0 = Sunday .. 6 = Saturday: English table on English pages, Intl elsewhere. */
export function weekdayName(wd, style = "long") {
  if (EN) return style === "long" ? WEEKDAYS[wd] : WEEKDAYS[wd].slice(0, 3);
  return dateFormat({ weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + wd)));
}

/* "Thursday, 8 October 2026" */
export const longDate = (date) => EN
  ? `${WEEKDAYS[weekday(date)]}, ${date.d} ${MONTHS[date.m - 1]} ${date.y}`
  : dateFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(date));

/* "October 2026" */
export const monthYear = (date) => EN
  ? `${MONTHS[date.m - 1]} ${date.y}`
  : dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(date));

/* "Thu 8 Oct 2026" from calendar fields {y, m, d} */
export const shortDate = (date) => EN
  ? `${WEEKDAYS[weekday(date)].slice(0, 3)} ${date.d} ${MONTHS[date.m - 1].slice(0, 3)} ${date.y}`
  : dateFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utcDate(date));

/* Today's date on this device's clock and time zone. */
export function today() {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
}

export const cmpDate = (a, b) => dayNumber(a) - dayNumber(b);

/* Add whole months; a day that doesn't exist in the target month is clamped to its last day
   (31 January + 1 month = 28 or 29 February). */
export function addMonths({ y, m, d }, n) {
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = idx - ny * 12 + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}
export const addDays = (date, n) => fromDayNumber(dayNumber(date) + n);

/* Calendar difference from a to b (a <= b) as {years, months, days}: the largest number of whole
   months that, added to a with month-end clamping, doesn't pass b, then the days left over. */
export function diffYMD(a, b) {
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (months < 0) months = 0;
  while (months > 0 && cmpDate(addMonths(a, months), b) > 0) months--;
  const anchor = addMonths(a, months);
  return { years: Math.floor(months / 12), months: months % 12, days: dayNumber(b) - dayNumber(anchor), totalMonths: months };
}

/* Monday-to-Friday days among the `count` consecutive days starting at day number `start`. */
export function weekdaysIn(start, count) {
  if (count <= 0) return 0;
  const full = Math.floor(count / 7);
  let n = full * 5;
  const first = (((start + 4) % 7) + 7) % 7;
  for (let i = 0; i < count - full * 7; i++) {
    const wd = (first + i) % 7;
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/* "a, b, c" in English; "a, b y c" and the like on other pages. */
export const joinParts = (parts) => (EN ? parts.join(", ") : listText(parts));

export function ymdParts({ years, months, days }) {
  const parts = [];
  if (years) parts.push(txn(years, "{n} year", "{n} years"));
  if (months) parts.push(txn(months, "{n} month", "{n} months"));
  if (days || !parts.length) parts.push(txn(days, "{n} day", "{n} days"));
  return parts;
}

export const ymdText = (ymd) => joinParts(ymdParts(ymd));
