// Zulu (UTC) time converter with the browser's time zones, and METAR-style DDHHMMZ time groups.
import { $, tx } from "./core.js?v=11";
import { fillZoneSelect, zoneOf, wallFields, resolveWall, fmtWall, offsetMinutes, fmtOffset, pad, zoneCity } from "./tzcore.js?v=11";
import { fillStats, invalid, duration } from "./avui.js?v=11";

const dateEl = $("#zt-date"), timeEl = $("#zt-time"), fromEl = $("#zt-from"), toEl = $("#zt-to"), note = $("#zt-note");
const grp = $("#zt-grp"), refEl = $("#zt-ref"), gmsg = $("#zt-grp-msg");
fillZoneSelect(fromEl);
fillZoneSelect(toEl);
fromEl.value = "local";
toEl.value = "UTC";

const iso = (f) => `${String(f.y).padStart(4, "0")}-${pad(f.mo)}-${pad(f.d)}`;
const zname = (sel) => (sel.value === "local" ? tx("Your time zone") : sel.value === "UTC" ? "UTC" : zoneCity(sel.value));
const offTxt = (ms, tz) => (tz === "UTC" ? "UTC" : "UTC" + fmtOffset(offsetMinutes(ms, tz)));
const show = (ms, tz) => `${fmtWall(ms, tz, { seconds: false })} (${offTxt(ms, tz)})`;
const groupText = (ms) => { const f = wallFields(ms, "UTC"); return `${pad(f.d)}${pad(f.h)}${pad(f.mi)}Z`; };
const longUtc = (ms) => `${fmtWall(ms, "UTC", { seconds: false })} Z`;

function setNow() {
  const f = wallFields(Date.now(), zoneOf(fromEl.value));
  dateEl.value = iso(f);
  timeEl.value = `${pad(f.h)}:${pad(f.mi)}`;
  update();
}

function update() {
  note.hidden = true;
  const dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(dateEl.value), tm = /^(\d\d):(\d\d)/.exec(timeEl.value);
  if (!dm || !tm) { fillStats($("#zt-stats"), []); note.hidden = false; note.textContent = tx("Choose a date and a time to see the conversion."); return; }
  const r = resolveWall({ y: +dm[1], mo: +dm[2], d: +dm[3], h: +tm[1], mi: +tm[2], s: 0 }, zoneOf(fromEl.value));
  if (r.kind !== "ok") {
    note.hidden = false;
    note.textContent = r.kind === "gap" ? tx("That clock time does not exist in this zone on that day because the clocks jump forward. The nearest valid time is used.") : tx("That clock time happens twice because the clocks go back. The earlier one is used.");
  }
  const to = zoneOf(toEl.value), from = zoneOf(fromEl.value);
  fillStats($("#zt-stats"), [
    [tx("Zulu (UTC)"), longUtc(r.ms)],
    [tx("Time group"), groupText(r.ms)],
    [zname(toEl), show(r.ms, to)],
    [zname(fromEl), show(r.ms, from)],
  ]);
}

function resolveGroup(d, h, mi, ref) {
  let best = null;
  for (const off of [-1, 0, 1]) {
    const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + off;
    const t = new Date(Date.UTC(y, m, 1));
    const ms = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), d, h, mi);
    if (new Date(ms).getUTCDate() !== d) continue;       // the month has no such day
    if (best === null || Math.abs(ms - ref.getTime()) < Math.abs(best - ref.getTime())) best = ms;
  }
  return best;
}

function updateGroup() {
  invalid([grp], false);
  const m = /^(\d{2})(\d{2})(\d{2})Z?$/i.exec(grp.value.trim());
  if (!grp.value.trim()) { fillStats($("#zt-grp-stats"), []); gmsg.textContent = tx("Type a time group such as 081405Z."); return; }
  if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] > 23 || +m[3] > 59) { fillStats($("#zt-grp-stats"), []); invalid([grp]); gmsg.textContent = tx("A time group is day, hour and minute: DDHHMM, optionally followed by Z. For example 081405Z."); return; }
  const rm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(refEl.value);
  const ref = rm ? new Date(Date.UTC(+rm[1], +rm[2] - 1, +rm[3], 12)) : new Date();
  const ms = resolveGroup(+m[1], +m[2], +m[3], ref);
  if (ms === null) { fillStats($("#zt-grp-stats"), []); invalid([grp]); gmsg.textContent = tx("That day does not exist in the months around the reference date."); return; }
  gmsg.textContent = "";
  const to = zoneOf(toEl.value);
  const rows = [[tx("Zulu (UTC)"), longUtc(ms)], [zname(toEl), show(ms, to)]];
  if (!rm) {
    const diff = (Date.now() - ms) / 1000;
    rows.push([tx("Compared with now"), diff >= 0 ? tx("{time} ago", { time: duration(diff) }) : tx("in {time}", { time: duration(-diff) })]);
  }
  fillStats($("#zt-grp-stats"), rows);
}

for (const e of [dateEl, timeEl, fromEl, toEl]) e.addEventListener("input", () => { update(); updateGroup(); });
grp.addEventListener("input", updateGroup);
refEl.addEventListener("input", updateGroup);
$("#zt-now").addEventListener("click", () => { setNow(); updateGroup(); });
$("#zt-swap").addEventListener("click", () => {
  const a = fromEl.value;
  fromEl.value = toEl.value;
  toEl.value = a;
  update();
  updateGroup();
});
setNow();
updateGroup();

