// Moon phase calendar for a month: phase and illumination per day, and the exact times of the principal phases.
import { $, el, tx, dateFormat, LOCALE } from "./core.js?v=11";
import { moonPhase, quarters } from "./astrocore.js?v=11";
import { fillZoneSelect, zoneOf, wallFields, resolveWall, pad } from "./tzcore.js?v=11";
import { readNum, fInt, fillStats, PHASE_NAMES, PHASE_GLYPH } from "./avui.js?v=11";

const monthEl = $("#mc-month"), yearEl = $("#mc-year"), tzEl = $("#mc-tz");
const msg = $("#mc-msg"), res = $("#mc-res");
fillZoneSelect(tzEl);
tzEl.value = "local";

for (let m = 0; m < 12; m++) monthEl.append(el("option", { value: m + 1 }, dateFormat({ month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, m, 15)))));

const QUARTER_PHASE = ["new_moon", "first_quarter", "full_moon", "last_quarter"];
const FIRST_DAY = LOCALE.startsWith("en") ? 0 : 1;      // Sunday first on English pages, Monday elsewhere
function daysIn(y, m) { const t = new Date(Date.UTC(2000, 0, 1)); t.setUTCFullYear(y, m, 0); return t.getUTCDate(); }

function head() {
  const names = [];
  for (let i = 0; i < 7; i++) {
    const dow = (FIRST_DAY + i) % 7;
    names.push(dateFormat({ weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + dow))));       // 2023-01-01 is a Sunday
  }
  $("#mc-head").replaceChildren(el("tr", {}, names.map((n) => el("th", { scope: "col" }, n))));
}

function update() {
  const y = readNum(yearEl), m = Number(monthEl.value);
  res.hidden = true;
  if (y === null || Number.isNaN(y) || !Number.isInteger(y) || y < 1 || y > 9999) {
    yearEl.setAttribute("aria-invalid", "true");
    msg.textContent = tx("Enter a year from 1 to 9999.");
    return;
  }
  yearEl.setAttribute("aria-invalid", "false");
  msg.textContent = "";
  const tz = zoneOf(tzEl.value);
  const n = daysIn(y, m);
  const cells = [];
  const first = new Date(Date.UTC(2000, 0, 1)); first.setUTCFullYear(y, m - 1, 1);
  const lead = (first.getUTCDay() - FIRST_DAY + 7) % 7;
  for (let i = 0; i < lead; i++) cells.push(el("td", { class: "mc__empty" }));
  const startMs = resolveWall({ y, mo: m, d: 1, h: 0, mi: 0, s: 0 }, tz).ms;
  const nx = new Date(Date.UTC(2000, 0, 1)); nx.setUTCFullYear(y, m, 1);
  const endMs = resolveWall({ y: nx.getUTCFullYear(), mo: nx.getUTCMonth() + 1, d: 1, h: 0, mi: 0, s: 0 }, tz).ms;
  const qs = quarters(startMs, endMs).filter((q) => q.t >= startMs && q.t < endMs);
  const qDays = new Set(qs.map((q) => wallFields(q.t, tz).d));
  for (let d = 1; d <= n; d++) {
    const noon = resolveWall({ y, mo: m, d, h: 12, mi: 0, s: 0 }, tz).ms;
    const ph = moonPhase(noon);
    const label = `${PHASE_NAMES[ph.phase]}, ${fInt(ph.illumination * 100)} %`;
    cells.push(el("td", { class: qDays.has(d) ? "mc__key" : "", title: label },
      el("span", { class: "mc__d" }, String(d)), el("span", { class: "mc__g", "aria-hidden": "true" }, PHASE_GLYPH[ph.phase]),
      el("span", { class: "mc__p" }, `${fInt(ph.illumination * 100)}%`), el("span", { class: "visually-hidden" }, label)));
  }
  while (cells.length % 7) cells.push(el("td", { class: "mc__empty" }));
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(el("tr", {}, cells.slice(i, i + 7)));
  $("#mc-body").replaceChildren(...rows);
  $("#mc-title").textContent = dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  fillStats($("#mc-phases"), qs.map((q) => {
    const w = wallFields(q.t, tz);
    const when = dateFormat({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1) + dateUtc(w))) + `, ${pad(w.h)}:${pad(w.mi)}`;
    return [`${PHASE_GLYPH[QUARTER_PHASE[q.quarter]]} ${PHASE_NAMES[QUARTER_PHASE[q.quarter]]}`, when];
  }));
  head();
  res.hidden = false;
}
function dateUtc(w) { const t = new Date(Date.UTC(2000, 0, 1)); t.setUTCFullYear(w.y, w.mo - 1, w.d); return t.getTime() - Date.UTC(2000, 0, 1); }

function setThisMonth() {
  const w = wallFields(Date.now(), zoneOf(tzEl.value));
  monthEl.value = String(w.mo);
  yearEl.value = String(w.y);
  update();
}
function shift(dir) {
  let m = Number(monthEl.value) + dir, y = readNum(yearEl);
  if (y === null || Number.isNaN(y)) y = wallFields(Date.now(), zoneOf(tzEl.value)).y;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  monthEl.value = String(m);
  yearEl.value = String(y);
  update();
}
monthEl.addEventListener("change", update);
yearEl.addEventListener("input", update);
tzEl.addEventListener("change", update);
$("#mc-prev").addEventListener("click", () => shift(-1));
$("#mc-next").addEventListener("click", () => shift(1));
$("#mc-today").addEventListener("click", setThisMonth);
setThisMonth();
