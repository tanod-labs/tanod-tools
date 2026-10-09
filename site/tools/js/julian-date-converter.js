// Julian date, Modified Julian date, GPS week and Unix time, converted all at once (aviationcore.js).
import { $, $$, tx, fmtNum } from "./core.js?v=11";
import { jdFromMs, msFromJd, mjdFromJd, jdFromMjd, gpsFromMs, msFromGps, gpsMinusUtc, dayOfYear } from "./aviationcore.js?v=11";
import { fillStats, invalid, readNum } from "./avui.js?v=11";
import { fmtWall, wallFields, pad, utcFromFields } from "./tzcore.js?v=11";

const msg = $("#jd-msg");
const ids = { date: ["jd-date", "jd-time"], jd: ["jd-jd"], mjd: ["jd-mjd"], gps: ["jd-week", "jd-sow"], unix: ["jd-unix"] };
const mode = () => $('input[name="jd-mode"]:checked').value;
const MAX_MS = 8.64e15;

function source() {
  const m = mode();
  const els = ids[m].map((i) => $("#" + i));
  invalid(els, false);
  const fail = (e, text) => { invalid(e); msg.textContent = text; return null; };
  if (m === "date") {
    const dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec($("#jd-date").value), tm = /^(\d\d):(\d\d)(?::(\d\d))?/.exec($("#jd-time").value || "00:00");
    if (!dm || !tm) return fail(els, tx("Choose a date and a time."));
    return utcFromFields(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], +(tm[3] || 0));
  }
  const v = els.map(readNum);
  if (v.some((x) => x === null)) return fail([], tx("Enter a value to convert."));
  if (v.some(Number.isNaN)) return fail(els, tx("Enter a number."));
  let ms;
  if (m === "jd") ms = msFromJd(v[0]);
  else if (m === "mjd") ms = msFromJd(jdFromMjd(v[0]));
  else if (m === "unix") ms = Math.round(v[0] * 1000);
  else {
    if (!Number.isInteger(v[0]) || v[0] < 0) return fail([els[0]], tx("The GPS week must be a whole number of 0 or more."));
    if (v[1] < 0 || v[1] >= 604800) return fail([els[1]], tx("The seconds of week must be from 0 up to 604,800."));
    ms = msFromGps(v[0], v[1]);
  }
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) return fail(els, tx("That value is outside the range of dates the browser can handle."));
  return ms;
}

const dec = (n, d) => fmtNum(n, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });

function update() {
  msg.textContent = "";
  const ms = source();
  if (ms === null) { fillStats($("#jd-stats"), []); return; }
  lastMs = ms;
  const jd = jdFromMs(ms);
  const rows = [
    [tx("Date and time (UTC)"), fmtWall(ms, "UTC")],
    [tx("Julian date"), dec(jd, 6)],
    [tx("Modified Julian date"), dec(mjdFromJd(jd), 6)],
    [tx("Days since J2000.0"), dec(jd - 2451545, 6)],
    [tx("Unix time (seconds)"), dec(ms / 1000, 3)],
    [tx("Day of the year"), String(dayOfYear(ms))],
  ];
  const g = gpsFromMs(ms);
  if (g) {
    const gpsMs = ms + gpsMinusUtc(ms) * 1000;
    rows.push(
      [tx("GPS week (full count)"), fmtNum(g.week, { useGrouping: false })],
      [tx("GPS week (10-bit, as broadcast)"), tx("{week} (rollover {n})", { week: fmtNum(g.mod1024, { useGrouping: false }), n: g.rollovers })],
      [tx("GPS day of week and seconds of week"), tx("day {d}, {s} s", { d: g.dow, s: fmtNum(g.sow, { maximumFractionDigits: 3, useGrouping: false }) })],
      [tx("GPS time"), fmtWall(gpsMs, "UTC") + ` (UTC + ${gpsMinusUtc(ms)} s)`],
    );
  } else {
    rows.push([tx("GPS week"), tx("GPS time began on 1980-01-06, so there is no GPS week for this date.")]);
  }
  fillStats($("#jd-stats"), rows);
}

function setNow() {
  const w = wallFields(Date.now(), "UTC");
  $("#jd-date").value = `${String(w.y).padStart(4, "0")}-${pad(w.mo)}-${pad(w.d)}`;
  $("#jd-time").value = `${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
  $('input[name="jd-mode"][value="date"]').checked = true;
  showPanel();
  update();
}
function showPanel() {
  for (const k of Object.keys(ids)) $("#jd-p-" + k).hidden = k !== mode();
}
/* Switching the kind of input carries the current instant over, so the new box starts with the same moment. */
function carryOver(ms) {
  const m = mode();
  if (ms === null) return;
  const jd = jdFromMs(ms);
  if (m === "date") {
    const w = wallFields(ms, "UTC");
    $("#jd-date").value = w.y >= 0 && w.y <= 9999 ? `${String(w.y).padStart(4, "0")}-${pad(w.mo)}-${pad(w.d)}` : "";
    $("#jd-time").value = `${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
  } else if (m === "jd") $("#jd-jd").value = dec(jd, 6);
  else if (m === "mjd") $("#jd-mjd").value = dec(mjdFromJd(jd), 6);
  else if (m === "unix") $("#jd-unix").value = dec(ms / 1000, 3);
  else {
    const g = gpsFromMs(ms);
    if (g) { $("#jd-week").value = String(g.week); $("#jd-sow").value = dec(g.sow, 3); }
  }
}
let lastMs = null;
$$('input[name="jd-mode"]').forEach((r) => r.addEventListener("change", () => { showPanel(); carryOver(lastMs); update(); }));
$$(".opts input").forEach((i) => i.addEventListener("input", update));
$("#jd-now").addEventListener("click", setNow);
setNow();

