// Date difference calculator: whole-day calendar arithmetic (no clock time), so daylight saving can't shift a day.
import { $, el, setStatus, tx, txn, fmtNum, EN } from "./core.js?v=11";
import { parseDate, isoDate, today, dayNumber, diffYMD, addMonths, addDays, longDate, ymdParts, joinParts, weekdaysIn, fmt } from "./calccore.js?v=11";

const A = $("#dd-a"), B = $("#dd-b"), AT = $("#dd-at"), BT = $("#dd-bt"), incl = $("#dd-incl");
const status = $("#status"), res = $("#dd-res");
const set = (id, v) => { $(id).textContent = v; };
const mins = (t) => { const m = /^(\d\d):(\d\d)/.exec(t); return m ? +m[1] * 60 + +m[2] : null; };

function update() {
  let a = parseDate(A.value), b = parseDate(B.value);
  const useTimes = !!(AT.value || BT.value);
  incl.disabled = useTimes;
  $("#dd-times-help").textContent = useTimes
    ? tx("Using times: the result is in days, hours and minutes, so Include the end date doesn't apply.")
    : tx("Times are optional. Leave them empty to count whole days.");
  if (!a || !b) {
    res.hidden = true;
    setStatus(status, (A.value && !a) || (B.value && !b) ? "error" : "idle", tx("That isn't a valid date."));
    return;
  }
  setStatus(status, "idle");
  let ta = useTimes ? mins(AT.value) ?? 0 : 0, tb = useTimes ? mins(BT.value) ?? 0 : 0;
  let swapped = false;
  if (dayNumber(b) * 1440 + tb < dayNumber(a) * 1440 + ta) { [a, b, ta, tb] = [b, a, tb, ta]; swapped = true; }
  let total = (dayNumber(b) - dayNumber(a)) * 1440 + (tb - ta); // minutes
  let endDate = b, remMin = tb - ta;
  if (remMin < 0) { endDate = addDays(b, -1); remMin += 1440; }
  const inclusive = !useTimes && incl.checked;
  if (inclusive) { endDate = addDays(endDate, 1); total += 1440; }
  const ymd = diffYMD(a, endDate);
  const days = Math.floor(total / 1440);
  let parts = ymdParts(ymd);
  if (useTimes) {
    const h = Math.floor(remMin / 60), m = remMin % 60;
    if (h || m) parts = [...(ymd.years || ymd.months || ymd.days ? parts : []), ...[h ? txn(h, "{n} hour", "{n} hours") : "", m ? txn(m, "{n} minute", "{n} minutes") : ""].filter(Boolean)];
  }
  const main = joinParts(parts);
  set("#dd-main", main);
  set("#dd-days", fmtNum(days));
  $("#dd-weeks").replaceChildren(fmtNum(Math.floor(days / 7)), days % 7 ? el("small", {}, " " + txn(days % 7, "+ {n} day", "+ {n} days")) : "");
  set("#dd-biz", fmtNum(weekdaysIn(dayNumber(a), days)));
  $("#dd-hours-box").hidden = !useTimes;
  if (useTimes) set("#dd-hours", fmt(total / 60, 10));
  const notes = [];
  if (swapped) notes.push(tx("The end date is before the start date, so the gap is counted from the end date to the start date."));
  const span = { a: longDate(a), b: longDate(b) };
  notes.push(inclusive ? tx("Counting from {a} to {b}, both days included.", span)
    : useTimes ? tx("Counting from {a} up to {b}.", span) : tx("Counting from {a} up to {b}, not including the end date.", span));
  notes.push(tx("Business days are Monday to Friday; public holidays are not taken off."));
  set("#dd-note", notes.join(" "));
  res.hidden = false;
}

/* ------------------------------------------------------------------ add or subtract */

const AD = $("#ad-date"), N = $("#ad-n"), unit = $("#ad-unit");
function updateAdd() {
  const d = parseDate(AD.value);
  const n = Number(N.value);
  const note = $("#ad-note");
  note.hidden = true;
  N.setAttribute("aria-invalid", "false");
  if (!d || N.value === "" || !Number.isInteger(n) || n < 0) {
    set("#ad-out", "-");
    if (N.value !== "" && (!Number.isInteger(n) || n < 0)) {
      N.setAttribute("aria-invalid", "true");
      note.hidden = false;
      note.textContent = tx("Enter a whole number of 0 or more, and pick Add or Subtract.");
    }
    return;
  }
  const sign = document.querySelector('input[name="ad-op"]:checked').value === "sub" ? -1 : 1;
  let out;
  if (unit.value === "days") out = addDays(d, sign * n);
  else if (unit.value === "weeks") out = addDays(d, sign * n * 7);
  else out = addMonths(d, sign * n * (unit.value === "years" ? 12 : 1));
  if (out.y < 1 || out.y > 9999) {
    set("#ad-out", "-");
    note.hidden = false;
    note.textContent = tx("That falls outside the years 1 to 9999, which this calculator covers.");
    return;
  }
  set("#ad-out", longDate(out));
  if ((unit.value === "months" || unit.value === "years") && out.d !== d.d) {
    note.hidden = false;
    note.textContent = tx("The {day} doesn't exist in that month, so its last day is used.", { day: EN ? ordinal(d.d) : fmtNum(d.d) });
  }
}
function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return n + s;
}

const t = isoDate(today());
A.value = t;
AD.value = t;
for (const i of [A, B, AT, BT, incl]) { i.addEventListener("input", update); i.addEventListener("change", update); }
for (const i of [AD, N, unit, ...document.querySelectorAll('input[name="ad-op"]')]) { i.addEventListener("input", updateAdd); i.addEventListener("change", updateAdd); }
update();
updateAdd();

