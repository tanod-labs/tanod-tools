// Time zone converter and meeting planner, built on tzcore.js (the browser's own time-zone data).
import { $, $$, el, announce, prefs, tx, txn, EN, dateFormat, listText } from "./core.js?v=11";
import { parseDate, isoDate, dayNumber, weekdayName } from "./calccore.js?v=11";
import { fillZoneSelect, zoneOf, zoneCity, utcFromFields, resolveWall, wallToInstants, wallFields, offsetMinutes, fmtOffset, pad, zoneAbbr, isZone } from "./tzcore.js?v=11";

const dateEl = $("#tzc-date"), timeEl = $("#tzc-time"), fromEl = $("#tzc-from"), addEl = $("#tzc-add");
const rowsEl = $("#tzc-rows"), msgEl = $("#tzc-msg");
const DEFAULT_ZONES = ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wd3 = (k) => weekdayName(k, "short");

/* Some browsers list zones under their older IANA names (Asia/Calcutta); show and use the current names. */
const RENAMED = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Godthab": "America/Nuuk", "Pacific/Enderbury": "Pacific/Kanton", "America/Buenos_Aires": "America/Argentina/Buenos_Aires", "Atlantic/Faeroe": "Atlantic/Faroe" };
function modernNames(select) {
  const group = select.querySelector("optgroup");
  if (!group) return;
  const have = new Set(Array.from(group.children, (o) => o.value));
  for (const o of Array.from(group.children)) {
    const modern = RENAMED[o.value];
    if (!modern) continue;
    if (have.has(modern) || !isZone(modern)) continue;
    o.value = modern;
    o.textContent = modern.replace(/_/g, " ");
    have.add(modern);
  }
  const sorted = Array.from(group.children).sort((a, b) => a.value.localeCompare(b.value));
  group.replaceChildren(...sorted);
}
fillZoneSelect(fromEl);
fillZoneSelect(addEl);
modernNames(fromEl);
modernNames(addEl);
addEl.prepend(Object.assign(document.createElement("option"), { value: "", textContent: tx("Choose a place…"), selected: true }));
const src = () => zoneOf(fromEl.value);

const stored = prefs.get("tz.zones", null);
let zones = Array.isArray(stored) ? stored.filter((z) => typeof z === "string" && isZone(z)) : [...DEFAULT_ZONES];
const savedFmt = prefs.get("tz.fmt", "24");
$(`input[name="tzc-fmt"][value="${savedFmt === "12" ? "12" : "24"}"]`).checked = true;
const fmt12 = () => $('input[name="tzc-fmt"]:checked').value === "12";

const city = zoneCity;
const clock = (h, mi) => {
  if (!fmt12()) return `${pad(h)}:${pad(mi)}`;
  if (!EN) return dateFormat({ hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, h, mi)));
  return `${h % 12 || 12}:${pad(mi)} ${h < 12 ? "AM" : "PM"}`;
};
const dateText = (f) => EN
  ? `${wd3(dow(f))} ${f.d} ${MON[f.mo - 1]} ${f.y}`
  : dateFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(utcFromFields(f.y, f.mo, f.d)));
const dow = (f) => (((dayNumber({ y: f.y, m: f.mo, d: f.d }) + 4) % 7) + 7) % 7;
const abbr = (ms, z) => { const a = zoneAbbr(ms, z); return /^[A-Z]{2,5}$/.test(a) ? a : ""; };

function setNow() {
  const f = wallFields(Date.now(), src());
  dateEl.value = isoDate({ y: f.y, m: f.mo, d: f.d });
  timeEl.value = `${pad(f.h)}:${pad(f.mi)}`;
}

let planKey = "";

function render() {
  const z = src();
  const date = parseDate(dateEl.value);
  const tm = /^(\d\d):(\d\d)/.exec(timeEl.value);
  const note = $("#tzc-note"), amb = $("#tzc-amb");
  note.hidden = true;
  amb.hidden = true;
  $("#tzc-plan-wrap").hidden = true;
  msgEl.textContent = "";
  if (!date || !tm) {
    rowsEl.replaceChildren();
    msgEl.textContent = tx("Choose a date and a time to see the conversion.");
    return;
  }
  const f = { y: date.y, mo: date.m, d: date.d, h: +tm[1], mi: +tm[2], s: 0 };
  const list = wallToInstants(f, z);
  let ms;
  const wallTxt = `${isoDate(date)} ${pad(f.h)}:${pad(f.mi)}`;
  if (list.length === 0) {
    const r = resolveWall(f, z);
    ms = r.ms;
    const g = wallFields(ms, z);
    const len = offsetMinutes(ms, z) - offsetMinutes(ms - 864e5, z);
    const lenText = len % 60 === 0 ? txn(len / 60, "{n} hour", "{n} hours") : txn(len, "{n} minute", "{n} minutes");
    note.hidden = false;
    $("#tzc-note-t").textContent = tx("{when} doesn't exist in {place}: clocks there skip forward by {len} at that moment. It is treated as {time} (UTC{offset}) on the same date, and that is the time converted below.", { when: wallTxt, place: city(z), len: lenText, time: `${pad(g.h)}:${pad(g.mi)}`, offset: fmtOffset(offsetMinutes(ms, z)) });
  } else if (list.length > 1) {
    amb.hidden = false;
    const box = $("#tzc-amb-opts");
    const key = list.join(",");
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.replaceChildren(...list.map((t, k) => {
        const off = offsetMinutes(t, z), ab = abbr(t, z);
        const radio = el("input", { type: "radio", name: "tzc-amb", value: String(k) });
        if (k === 0) radio.checked = true;
        radio.addEventListener("change", render);
        const vars = { offset: fmtOffset(off), abbr: ab ? " (" + ab + ")" : "" };
        return el("label", {}, radio, k === 0 ? tx("Earlier: UTC{offset}{abbr}", vars) : tx("Later: UTC{offset}{abbr}", vars));
      }));
    }
    const idx = Number($('input[name="tzc-amb"]:checked')?.value ?? 0);
    ms = list[Math.min(idx, list.length - 1)];
    note.hidden = false;
    $("#tzc-note-t").textContent = tx("{when} happens twice in {place} because clocks go back. Choose which one you mean; the earlier one is UTC{first} and the later one is UTC{second}.", { when: wallTxt, place: city(z), first: fmtOffset(offsetMinutes(list[0], z)), second: fmtOffset(offsetMinutes(list[1], z)) });
  } else ms = list[0];

  // rows: the source first, then the list
  const sf = wallFields(ms, z);
  const srcDay = dayNumber({ y: sf.y, m: sf.mo, d: sf.d });
  const entries = [{ zone: z, source: true }, ...zones.filter((q) => q !== z).map((q) => ({ zone: q }))];
  rowsEl.replaceChildren(...entries.map(({ zone, source }) => {
    const w = wallFields(ms, zone);
    const diff = dayNumber({ y: w.y, m: w.mo, d: w.d }) - srcDay;
    const marker = source ? tx("Selected time") : diff === 0 ? tx("Same day") : diff === 1 ? tx("Next day") : diff === -1 ? tx("Previous day") : diff > 0 ? tx("+{n} days", { n: diff }) : tx("-{n} days", { n: -diff });
    const off = offsetMinutes(ms, zone), ab = abbr(ms, zone);
    return el("li", { class: "tzc__row" + (source ? " is-source" : ""), "data-zone": zone, "data-day": String(diff) },
      el("div", { class: "tzc__place" }, el("b", {}, city(zone)), el("span", { class: "tzc__id" }, zone === "UTC" ? tx("Coordinated Universal Time") : zone)),
      el("div", { class: "tzc__time num" }, clock(w.h, w.mi)),
      el("div", { class: "tzc__date" }, dateText(w), el("span", { class: "tzc__day" }, marker)),
      el("div", { class: "tzc__off num" }, `UTC${fmtOffset(off)}`, ab ? el("span", { class: "tzc__abbr" }, ab) : null),
      source ? el("span", { class: "tzc__src" }, tx("From")) : el("button", { type: "button", class: "btn btn--quiet btn--sm tzc__rm", "data-zone": zone, "aria-label": tx("Remove {place}", { place: city(zone) }) }, tx("Remove")));
  }));
  renderPlan(entries.map((e) => e.zone), ms, f);
}

function renderPlan(zs, ms, f) {
  const z = zs[0];
  const t0 = resolveWall({ y: f.y, mo: f.mo, d: f.d, h: 0, mi: 0, s: 0 }, z).ms;
  const sel = Math.floor((ms - t0) / 3600000);
  const works = (t, zone) => { const w = wallFields(t, zone); const m = w.h * 60 + w.mi; return m >= 540 && m < 1020; };
  const times = Array.from({ length: 24 }, (_, k) => t0 + k * 3600000);
  const allWork = times.map((t) => zs.every((zone) => works(t, zone)));
  const rows = zs.map((zone, i) => el("tr", {},
    el("th", { scope: "row" }, city(zone), el("small", {}, ` UTC${fmtOffset(offsetMinutes(ms, zone))}`)),
    ...times.map((t, k) => {
      const w = wallFields(t, zone);
      const wk = works(t, zone);
      const cls = ["tzc__c", wk ? "is-work" : "", k === sel ? "is-sel" : "", w.h === 0 && w.mi === 0 ? "is-mid" : ""].filter(Boolean).join(" ");
      const hour = fmt12() ? (w.h < 12 ? tx("{h}a", { h: w.h % 12 || 12 }) : tx("{h}p", { h: w.h % 12 || 12 })) : pad(w.h);
      return el("td", { class: cls }, hour, w.mi ? el("small", {}, ":" + pad(w.mi)) : null,
        w.h === 0 && w.mi === 0 ? el("small", { class: "tzc__dm" }, wd3(dow(w))) : null,
        el("span", { class: "visually-hidden" }, " " + (wk ? (k === sel ? tx("working hours, selected time") : tx("working hours")) : (k === sel ? tx("outside working hours, selected time") : tx("outside working hours")))));
    })));
  const all = el("tr", { class: "tzc__all" }, el("th", { scope: "row" }, tx("Everyone")),
    ...allWork.map((a) => el("td", { class: "tzc__c" + (a ? " is-all" : "") }, a ? "✓" : "", el("span", { class: "visually-hidden" }, a ? tx("everyone working") : tx("not everyone working")))));
  $("#tzc-plan").replaceChildren(el("caption", { class: "visually-hidden" }, txn(zs.length, "Hourly cells for {n} place, starting at midnight on {date} in {place}", "Hourly cells for {n} places, starting at midnight on {date} in {place}", { date: isoDate({ y: f.y, m: f.mo, d: f.d }), place: city(z) })), el("tbody", {}, ...rows, all));
  // summary of shared hours
  const runs = [];
  allWork.forEach((a, k) => { if (a) { if (runs.length && runs[runs.length - 1].end === k) runs[runs.length - 1].end = k + 1; else runs.push({ start: k, end: k + 1 }); } });
  const label = (k) => { const w = wallFields(t0 + k * 3600000, z); return clock(w.h, w.mi); };
  const spans = runs.map((r) => tx("from {start} to {end}", { start: label(r.start), end: label(r.end) }));
  $("#tzc-plan-sum").textContent = zs.length < 2 ? tx("Add places to compare their working hours.")
    : runs.length ? tx("Everyone is in working hours (09:00 to 17:00 local) {spans} {place} time on this date.", { spans: EN ? spans.join(" and ") : listText(spans), place: city(z) })
    : tx("No hour on this date is inside 09:00 to 17:00 local time in all of these places. Try another start time or a shorter list.");
  $("#tzc-plan-wrap").hidden = false;
}

function addZone() {
  const raw = addEl.value;
  if (!raw) { msgEl.textContent = tx("Choose a place from the list first."); return; }
  const z = zoneOf(raw);
  if (!isZone(z)) { msgEl.textContent = tx("That time zone isn't known to this browser."); return; }
  if (zones.includes(z) || z === src()) { render(); msgEl.textContent = tx("{place} is already shown.", { place: city(z) }); return; }
  zones.push(z);
  prefs.set("tz.zones", zones);
  addEl.value = "";
  render();
  announce(tx("{place} added.", { place: city(z) }));
}

rowsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button.tzc__rm");
  if (!b) return;
  zones = zones.filter((q) => q !== b.dataset.zone);
  prefs.set("tz.zones", zones);
  render();
  announce(tx("{place} removed.", { place: city(b.dataset.zone) }));
  const next = $("#tzc-add"); if (next) next.focus();
});
$("#tzc-addbtn").addEventListener("click", addZone);
$("#tzc-now").addEventListener("click", () => { setNow(); render(); });
for (const i of [dateEl, timeEl, fromEl]) { i.addEventListener("input", render); i.addEventListener("change", render); }
for (const r of $$('input[name="tzc-fmt"]')) r.addEventListener("change", () => { prefs.set("tz.fmt", r.value); render(); });

setNow();
render();
