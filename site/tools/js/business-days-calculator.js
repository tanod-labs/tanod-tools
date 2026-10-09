// Business days calculator: whole-day calendar arithmetic on day numbers (no clock time, no network).
import { $, el, setStatus, tx, fmtNum, listText } from "./core.js?v=11";
import { parseDate, isoDate, today, dayNumber, fromDayNumber, addDays, longDate, weekdayName } from "./calccore.js?v=11";

const WEEKENDS = { "sat-sun": [0, 6], "fri-sat": [5, 6], sun: [0] };
const MAX_DAYS = 100000;
const MIN_DN = dayNumber({ y: 1, m: 1, d: 1 }), MAX_DN = dayNumber({ y: 9999, m: 12, d: 31 });

const status = $("#status"), res = $("#bd-res"), we = $("#bd-we");
const set = (sel, v) => { $(sel).textContent = v; };
const mode = () => document.querySelector('input[name="bd-mode"]:checked').value;
const wdOf = (dn) => (((dn + 4) % 7) + 7) % 7; // 0 = Sunday .. 6 = Saturday

/* One checkbox per day of the week for the custom weekend, labelled in the page language (Monday first). */
const wdBoxes = [];
for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
  const box = el("input", { type: "checkbox", value: String(wd) });
  box.checked = wd === 0 || wd === 6;
  box.addEventListener("change", update);
  wdBoxes.push(box);
  $("#bd-wd").append(el("label", { class: "check" }, box, weekdayName(wd)));
}

/* The weekend as a Set of 0..6, from the select or from the custom checkboxes. */
function weekendDays() {
  return new Set(we.value === "custom" ? wdBoxes.filter((b) => b.checked).map((b) => +b.value) : WEEKENDS[we.value]);
}

/* Holidays: one YYYY-MM-DD per line; anything after the date on a line is ignored; lines starting with # are comments. */
function readHolidays() {
  const days = new Set(), bad = [];
  for (const raw of $("#bd-hol").value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d{4}-\d{2}-\d{2})(?:[\s,;#].*)?$/.exec(line);
    const date = m && parseDate(m[1]);
    if (date) days.add(dayNumber(date)); else bad.push(line.length > 24 ? line.slice(0, 24) + "…" : line);
  }
  return { days, bad };
}

function show(main, label, cal, wk, hd, notes) {
  set("#bd-main-l", label);
  set("#bd-main", main);
  set("#bd-cal", fmtNum(cal));
  set("#bd-wk", fmtNum(wk));
  set("#bd-hd", fmtNum(hd));
  set("#bd-note", notes.join(" "));
  res.hidden = false;
}

function fail(msg, input) {
  res.hidden = true;
  setStatus(status, "error", msg);
  if (input) input.setAttribute("aria-invalid", "true");
}

function update() {
  $("#bd-count").hidden = mode() !== "count";
  $("#bd-add").hidden = mode() !== "add";
  $("#bd-wd-f").hidden = we.value !== "custom";
  for (const i of [$("#bd-a"), $("#bd-b"), $("#bd-s"), $("#bd-n"), $("#bd-hol")]) i.setAttribute("aria-invalid", "false");
  setStatus(status, "idle");

  const weekend = weekendDays();
  if (weekend.size >= 7) return fail(tx("Leave at least one day of the week as a working day."));
  const { days: holidays, bad } = readHolidays();
  if (bad.length) return fail(tx("These holiday lines aren't dates in YYYY-MM-DD form: {lines}", { lines: bad.slice(0, 3).join("; ") }), $("#bd-hol"));
  const notes = [tx("Weekend: {days}.", { days: listText([...weekend].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => weekdayName(d))) })];

  if (mode() === "count") {
    let a = parseDate($("#bd-a").value), b = parseDate($("#bd-b").value);
    if (!a || !b) return fail(tx("That isn't a valid date."), !a ? $("#bd-a") : $("#bd-b"));
    let incStart = $("#bd-ins").checked, incEnd = $("#bd-ine").checked;
    if (dayNumber(b) < dayNumber(a)) {
      [a, b, incStart, incEnd] = [b, a, incEnd, incStart];
      notes.unshift(tx("The end date is before the start date, so the two dates were swapped."));
    }
    const lo = dayNumber(a) + (incStart ? 0 : 1), hi = dayNumber(b) - (incEnd ? 0 : 1);
    let weekendN = 0, holidayN = 0;
    for (let n = lo; n <= hi; n++) {
      if (weekend.has(wdOf(n))) weekendN++;
      else if (holidays.has(n)) holidayN++;
    }
    const cal = Math.max(0, hi - lo + 1);
    notes.unshift(cal ? tx("Counted days run from {a} to {b}.", { a: longDate(fromDayNumber(lo)), b: longDate(fromDayNumber(hi)) }) : tx("No days are left to count."));
    const ignored = [...holidays].filter((n) => n < lo || n > hi || weekend.has(wdOf(n))).length;
    if (ignored) notes.push(tx("Some listed holidays fall on a weekend or outside the counted days, so they change nothing."));
    return show(fmtNum(cal - weekendN - holidayN), tx("Business days"), cal, weekendN, holidayN, notes);
  }

  /* add or subtract: step away from the start date, counting only working days */
  const start = parseDate($("#bd-s").value);
  if (!start) return fail(tx("That isn't a valid date."), $("#bd-s"));
  const raw = $("#bd-n").value.trim(), count = Number(raw);
  if (!/^\d+$/.test(raw) || count > MAX_DAYS) return fail(tx("Enter a whole number from 0 to 100,000."), $("#bd-n"));
  const dir = document.querySelector('input[name="bd-op"]:checked').value === "sub" ? -1 : 1;
  const s = dayNumber(start);
  let cur = s, counted = 0, weekendN = 0, holidayN = 0;
  while (counted < count) {
    cur += dir;
    if (cur < MIN_DN || cur > MAX_DN) return fail(tx("That falls outside the years 1 to 9999, which this calculator covers."), $("#bd-n"));
    if (weekend.has(wdOf(cur))) weekendN++;
    else if (holidays.has(cur)) holidayN++;
    else counted++;
  }
  notes.unshift(dir > 0 ? tx("Counting forward from {a}; the start date itself is not counted.", { a: longDate(start) })
    : tx("Counting back from {a}; the start date itself is not counted.", { a: longDate(start) }));
  return show(longDate(fromDayNumber(cur)), tx("Result date"), Math.abs(cur - s), weekendN, holidayN, notes);
}

/* Sensible starting values: today, and two weeks ahead. */
const t0 = today();
$("#bd-a").value = $("#bd-s").value = isoDate(t0);
$("#bd-b").value = isoDate(addDays(t0, 14));

for (const sel of ["#bd-a", "#bd-b", "#bd-s", "#bd-n", "#bd-hol", "#bd-we", "#bd-ins", "#bd-ine"]) {
  $(sel).addEventListener("input", update);
  $(sel).addEventListener("change", update);
}
for (const r of document.querySelectorAll('input[name="bd-mode"], input[name="bd-op"]')) r.addEventListener("change", update);
update();
