import { $, $$, el, copyText, tx, EN, LOCALE, dateFormat } from "./core.js?v=5";
import { fillZoneSelect, zoneOf, wallFields, offsetMinutes, fmtOffset, fmtWall, weekday, zoneAbbr, resolveWall, pad, fmtYear } from "./tzcore.js?v=5";

const MAX_MS = 8.64e15;
const UNIT_EXP = { s: 9n, ms: 6n, us: 3n, ns: 0n };
const UNIT_NAME = { s: tx("seconds"), ms: tx("milliseconds"), us: tx("microseconds"), ns: tx("nanoseconds") };
const FRAC_DIGITS = { s: 0, ms: 3, us: 6, ns: 9 };
const INT32_MAX = 2147483647, INT32_MIN = -2147483648;

const tzSel = $("#tz");
fillZoneSelect(tzSel);
const tz = () => zoneOf(tzSel.value);

/* ------------------------------------------------------------------ live clock */

let paused = false;
function tickNow() {
  if (paused) return;
  const now = Date.now();
  $("#now-s").textContent = String(Math.floor(now / 1000));
  $("#now-ms").textContent = String(now);
}
$("#now-copy-s").addEventListener("click", (e) => copyText($("#now-s").textContent, e.currentTarget));
$("#now-copy-ms").addEventListener("click", (e) => copyText($("#now-ms").textContent, e.currentTarget));
$("#now-pause").addEventListener("click", (e) => {
  paused = !paused;
  e.currentTarget.setAttribute("aria-pressed", String(paused));
  e.currentTarget.textContent = paused ? tx("Resume") : tx("Pause");
  tickNow();
});

/* ------------------------------------------------------------------ timestamp to date */

const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };

/* Parse "1700000000", "-1", "1700000000.25" into {ms, subNs, unit, detected} or throw an Error with a plain message. */
export function parseTimestamp(raw, unitChoice) {
  const s = raw.trim().replace(/[\s_,]/g, "");
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(tx("A Unix timestamp is a whole number of seconds (or milliseconds), optionally negative, like 1700000000."));
  const neg = m[1] === "-";
  const int = BigInt(m[2]);
  let unit = unitChoice;
  if (unit === "auto") unit = int < 10n ** 11n ? "s" : int < 10n ** 14n ? "ms" : int < 10n ** 17n ? "us" : "ns";
  const exp = UNIT_EXP[unit];
  const frac = (m[3] || "").slice(0, Number(exp));
  let ns = int * 10n ** exp + (frac ? BigInt(frac.padEnd(Number(exp), "0")) : 0n);
  if (neg) ns = -ns;
  const msBig = floorDiv(ns, 1000000n);
  if (msBig > BigInt(MAX_MS) || msBig < -BigInt(MAX_MS)) throw new Error(tx("That is too far from 1970 to show as a date (read as {unit}). Browsers handle about 270,000 years either way.", { unit: UNIT_NAME[unit] }));
  const ms = Number(msBig);
  const subNs = Number(ns - msBig * 1000000n);
  return { ms, subNs, unit, detected: unitChoice === "auto", fracDigits: Math.max(FRAC_DIGITS[unit], m[3] && unit === "s" ? Math.min(9, m[3].length) : 0) };
}

function isoUtc(ms, subNs, digits) {
  const base = new Date(ms).toISOString().replace(/\.\d{3}Z$/, "");
  if (!digits) return base + "Z";
  const msPart = ((ms % 1000) + 1000) % 1000;
  const nine = String(msPart * 1000000 + subNs).padStart(9, "0");
  return base + "." + nine.slice(0, digits) + "Z";
}

function isoZone(ms, zone, digits, subNs) {
  const f = wallFields(ms, zone);
  const off = offsetMinutes(ms, zone);
  let frac = "";
  if (digits) {
    const msPart = ((ms % 1000) + 1000) % 1000;
    frac = "." + String(msPart * 1000000 + subNs).padStart(9, "0").slice(0, digits);
  }
  return `${fmtYear(f.y)}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}${frac}${off === 0 && zone === "UTC" ? "Z" : fmtOffset(off)}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rfc2822(ms, zone) {
  const f = wallFields(ms, zone);
  if (f.y < 0 || f.y > 9999) return tx("Not representable (RFC 2822 needs a year from 0 to 9999)");
  return `${weekday(ms, zone)}, ${pad(f.d)} ${MON[f.mo - 1]} ${pad(f.y, 4)} ${pad(f.h)}:${pad(f.mi)}:${pad(f.s)} ${fmtOffset(offsetMinutes(ms, zone), "")}`;
}

function zoneLine(ms, zone) {
  const off = offsetMinutes(ms, zone);
  const abbr = zone === "UTC" ? "" : zoneAbbr(ms, zone);
  const named = abbr && !/^(GMT|UTC)/.test(abbr) ? ", " + abbr : "";
  if (!EN) return `${dateFormat({ dateStyle: "full", timeStyle: "medium", hourCycle: "h23", timeZone: zone }).format(ms)} UTC${fmtOffset(off)}${named}`;
  return `${fmtWall(ms, zone)} (${weekday(ms, zone)}) UTC${fmtOffset(off)}${named}`;
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
function relative(ms) {
  const diff = (ms - Date.now()) / 1000;
  const a = Math.abs(diff);
  if (a < 60) return rtf.format(Math.round(diff), "second");
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30.44)), "month");
  return rtf.format(Math.round(diff / (86400 * 365.25)), "year");
}

const tsIn = $("#ts-in"), tsUnit = $("#ts-unit"), tsInfo = $("#ts-detected"), tsOut = $("#ts-out"), tsNote = $("#ts-note");
let current = null;

function setInfo(node, input, msg, err = false) {
  node.textContent = msg;
  node.classList.toggle("tt__err", err);
  if (input) input.setAttribute("aria-invalid", err ? "true" : "false");
}

function showTs() {
  current = null;
  tsNote.hidden = true;
  if (!tsIn.value.trim()) { tsOut.hidden = true; setInfo(tsInfo, tsIn, tx("Type or paste a timestamp.")); return; }
  let r;
  try { r = parseTimestamp(tsIn.value, tsUnit.value); } catch (e) { tsOut.hidden = true; setInfo(tsInfo, tsIn, e.message, true); return; }
  current = r;
  const zone = tz();
  setInfo(tsInfo, tsIn, r.detected ? tx("Read as {unit} (detected from its length).", { unit: UNIT_NAME[r.unit] }) : tx("Read as {unit}.", { unit: UNIT_NAME[r.unit] }));
  $("#o-utc").textContent = zoneLine(r.ms, "UTC");
  $("#o-zone-l").textContent = zone === "UTC" ? tx("Time zone: UTC") : zone.replace(/_/g, " ");
  $("#o-zone").textContent = zoneLine(r.ms, zone);
  $("#o-zone").parentElement.hidden = zone === "UTC";
  $("#o-iso").textContent = isoUtc(r.ms, r.subNs, r.fracDigits);
  $("#o-isoz").textContent = isoZone(r.ms, zone, r.fracDigits, r.subNs);
  $("#o-rfc").textContent = rfc2822(r.ms, zone);
  $("#o-rel").textContent = relative(r.ms);
  const secs = Math.floor(r.ms / 1000);
  $("#o-s").textContent = String(secs);
  $("#o-ms").textContent = String(r.ms);
  tsOut.hidden = false;
  const notes = [];
  if (secs === INT32_MAX) notes.push(tx("This is the largest value a signed 32-bit time_t can hold: 03:14:07 UTC on 19 January 2038. One second later, 32-bit systems overflow."));
  else if (secs > INT32_MAX) notes.push(tx("This is after 03:14:07 UTC on 19 January 2038, so it doesn't fit in a signed 32-bit time_t (the year 2038 problem). 64-bit systems are fine."));
  else if (secs < INT32_MIN) notes.push(tx("This is before 20:45:52 UTC on 13 December 1901, below the range of a signed 32-bit time_t."));
  if (r.ms < 0) notes.push(tx("Negative timestamps are moments before 1 January 1970."));
  if (notes.length) { tsNote.textContent = notes.join(" "); tsNote.hidden = false; }
}

/* ------------------------------------------------------------------ date to timestamp */

const dDate = $("#d-date"), dTime = $("#d-time"), dInfo = $("#d-info"), dOut = $("#d-out"), dNote = $("#d-note");

function showDate() {
  dNote.hidden = true;
  const dm = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(dDate.value);
  if (!dm) { dOut.hidden = true; setInfo(dInfo, null, tx("Pick a date.")); return; }
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(dTime.value || "00:00");
  if (!tm) { dOut.hidden = true; setInfo(dInfo, null, tx("Enter a time, or leave it at 00:00:00."), true); return; }
  const f = { y: +dm[1], mo: +dm[2], d: +dm[3], h: +tm[1], mi: +tm[2], s: +(tm[3] || 0) };
  const zone = tz();
  const r = resolveWall(f, zone);
  const secs = Math.floor(r.ms / 1000);
  $("#d-s").textContent = String(secs);
  $("#d-ms").textContent = String(r.ms);
  $("#d-iso").textContent = isoUtc(r.ms, 0, 0);
  dOut.hidden = false;
  const typed = `${fmtYear(f.y)}-${pad(f.mo)}-${pad(f.d)} ${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}`;
  const zname = zone.replace(/_/g, " ");
  setInfo(dInfo, null, tx("{typed} in {zone} (UTC{offset}).", { typed, zone: zname, offset: fmtOffset(offsetMinutes(r.ms, zone)) }));
  if (r.kind === "gap") {
    dNote.textContent = tx("{typed} doesn't exist in {zone}: the clocks jumped forward and skipped it. It was read as {read} (UTC{offset}), moved forward by the length of the gap, as most software does.", { typed, zone: zname, read: fmtWall(r.ms, zone), offset: fmtOffset(offsetMinutes(r.ms, zone)) });
    dNote.hidden = false;
  } else if (r.kind === "overlap") {
    dNote.textContent = tx("{typed} happens twice in {zone} because the clocks went back. This is the first time (UTC{offset}). The second is {second} (UTC{secondOffset}).", { typed, zone: zname, offset: fmtOffset(offsetMinutes(r.ms, zone)), second: Math.floor(r.other / 1000), secondOffset: fmtOffset(offsetMinutes(r.other, zone)) });
    dNote.hidden = false;
  }
}

$("#d-now").addEventListener("click", () => {
  const f = wallFields(Date.now(), tz());
  dDate.value = `${pad(f.y, 4)}-${pad(f.mo)}-${pad(f.d)}`;
  dTime.value = `${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}`;
  showDate();
});

/* ------------------------------------------------------------------ copy buttons on result rows */

for (const row of $$(".dv-rows > div")) {
  const label = row.querySelector("dt").textContent;
  row.append(el("button", {
    type: "button", class: "btn btn--sm btn--quiet dv-copy", "aria-label": tx("Copy {label}", { label }),
    onclick: (e) => copyText(row.querySelector("dd").textContent, e.currentTarget),
  }, tx("Copy")));
}

for (const [node, fn] of [[tsIn, showTs], [tsUnit, showTs], [dDate, showDate], [dTime, showDate]]) {
  node.addEventListener("input", fn);
  node.addEventListener("change", fn);
}
tzSel.addEventListener("change", () => { showTs(); showDate(); });

tickNow();
setInterval(() => {
  tickNow();
  if (current && !tsOut.hidden) $("#o-rel").textContent = relative(current.ms);
}, 1000);
showTs();
showDate();
