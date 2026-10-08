// Age calculator: calendar arithmetic on dates only, so time zones and daylight saving can't shift a day.
import { $, el, setStatus, tx, txn, fmtNum } from "./core.js?v=5";
import { parseDate, isoDate, today, dayNumber, diffYMD, addMonths, cmpDate, longDate, ymdText } from "./calccore.js?v=5";

const dob = $("#ag-dob"), on = $("#ag-on"), status = $("#status"), res = $("#ag-res");
const fmtInt = (n) => fmtNum(n);
const set = (id, v) => { $(id).textContent = v; };

function update() {
  const a = parseDate(dob.value), b = parseDate(on.value);
  dob.setAttribute("aria-invalid", "false");
  on.setAttribute("aria-invalid", "false");
  if (!a || !b) {
    res.hidden = true;
    if (dob.value && !a) { dob.setAttribute("aria-invalid", "true"); setStatus(status, "error", tx("That date of birth isn't a valid date.")); }
    else if (on.value && !b) { on.setAttribute("aria-invalid", "true"); setStatus(status, "error", tx("The Age on date isn't a valid date.")); }
    else setStatus(status, "idle");
    return;
  }
  if (cmpDate(a, b) > 0) {
    res.hidden = true;
    dob.setAttribute("aria-invalid", "true");
    setStatus(status, "error", tx("The date of birth ({dob}) is after the Age on date ({on}). Check the year, or change the Age on date.", { dob: longDate(a), on: longDate(b) }));
    return;
  }
  setStatus(status, "idle");
  const d = diffYMD(a, b);
  const days = dayNumber(b) - dayNumber(a);
  set("#ag-main", ymdText(d));
  set("#ag-months", fmtInt(d.totalMonths));
  $("#ag-weeks").replaceChildren(fmtInt(Math.floor(days / 7)), days % 7 ? el("small", {}, " " + txn(days % 7, "+ {n} day", "+ {n} days")) : "");
  set("#ag-days", fmtInt(days));
  const thisYear = addMonths(a, 12 * d.years);
  let until = 0;
  if (cmpDate(thisYear, b) === 0 && d.years > 0) {
    set("#ag-next", txn(d.years, "Today: {n} year old", "Today: {n} years old"));
  } else {
    const next = addMonths(a, 12 * (d.years + 1));
    set("#ag-next", tx("{date} (turns {n})", { date: longDate(next), n: fmtInt(d.years + 1) }));
    until = dayNumber(next) - dayNumber(b);
  }
  set("#ag-until", fmtInt(until));
  set("#ag-togo", txn(until, "day to go", "days to go"));
  $("#ag-leap").hidden = !(a.m === 2 && a.d === 29);
  res.hidden = false;
}

on.value = isoDate(today());
for (const i of [dob, on]) { i.addEventListener("input", update); i.addEventListener("change", update); }
$("#ag-today").addEventListener("click", () => { on.value = isoDate(today()); update(); on.focus(); });
update();
