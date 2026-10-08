// Date calculator: add or subtract years/months/weeks/days or business days. Pure calendar arithmetic on day numbers.
import { $, $$, setStatus, tx, fmtNum, EN } from "./core.js?v=5";
import { parseDate, isoDate, today, dayNumber, fromDayNumber, addMonths, addDays, weekday, weekdayName, longDate, monthYear, isLeap } from "./calccore.js?v=5";

const START = $("#dc-start");
const status = $("#status"), res = $("#dc-res");
const kind = () => $('input[name="dc-kind"]:checked').value;
const sign = () => ($('input[name="dc-op"]:checked').value === "sub" ? -1 : 1);
const text = (id, v) => { $(id).textContent = v; };

/* ISO 8601 week: Monday-based, week 1 holds the year's first Thursday. */
export function isoWeek(date) {
  const dn = dayNumber(date);
  const mon0 = (weekday(date) + 6) % 7; // 0 = Monday
  const thursday = dn - mon0 + 3;
  const ty = fromDayNumber(thursday).y;
  const week = Math.floor((thursday - dayNumber({ y: ty, m: 1, d: 1 })) / 7) + 1;
  return { week, year: ty };
}
const dayOfYear = (d) => dayNumber(d) - dayNumber({ y: d.y, m: 1, d: 1 }) + 1;

function count(inputEl, max) {
  const raw = inputEl.value.trim();
  inputEl.setAttribute("aria-invalid", "false");
  if (raw === "") return 0;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > max) {
    inputEl.setAttribute("aria-invalid", "true");
    return NaN;
  }
  return n;
}

/* Move by `n` business days (Monday to Friday) from a date; each step lands on the next weekday in that direction. */
export function addBusinessDays(date, n) {
  let dn = dayNumber(date);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    dn += step;
    const wd = (((dn + 4) % 7) + 7) % 7;
    if (wd !== 0 && wd !== 6) left--;
  }
  return fromDayNumber(dn);
}

function update() {
  const start = parseDate(START.value);
  const biz = kind() === "biz";
  $("#dc-cal").hidden = biz;
  $("#dc-biz").hidden = !biz;
  res.hidden = true;
  setStatus(status, "idle");
  if (!start) {
    if (START.value) setStatus(status, "error", tx("That isn't a valid date."));
    return;
  }
  const s = sign();
  let out, note = "";
  const bad = (m) => setStatus(status, "error", m);
  if (biz) {
    const b = count($("#dc-b"), 100000);
    if (Number.isNaN(b)) return bad(tx("Enter a whole number of business days from 0 to 100,000."));
    out = addBusinessDays(start, s * b);
    const wd = weekday(start);
    const first = { weekday: weekdayName(wd), date: longDate(addBusinessDays(start, s)) };
    note = b === 0
      ? tx("Zero business days returns the start date itself.")
      : (wd === 0 || wd === 6) ? (s > 0 ? tx("The start date is a {weekday}, so the first business day after it is {date}.", first) : tx("The start date is a {weekday}, so the first business day before it is {date}.", first)) : "";
    note = (note ? note + " " : "") + tx("Saturdays and Sundays are skipped; public holidays are not.");
  } else {
    const y = count($("#dc-y"), 9999), m = count($("#dc-m"), 99999), w = count($("#dc-w"), 999999), d = count($("#dc-d"), 9999999);
    if ([y, m, w, d].some(Number.isNaN)) return bad(tx("Enter whole numbers of 0 or more. To go back in time, choose Subtract."));
    const months = y * 12 + m;
    const afterMonths = months ? addMonths(start, s * months) : start;
    if (afterMonths.y < 1 || afterMonths.y > 9999) return bad(tx("That falls outside the years 1 to 9999, which this calculator covers."));
    out = addDays(afterMonths, s * (w * 7 + d));
    if (months && afterMonths.d !== start.d) {
      note = tx("The {day} doesn't exist in {month}, so its last day (the {last}) was used.", { day: dayWord(start.d), month: monthYear(afterMonths), last: dayWord(afterMonths.d) });
    }
    if (months && (w || d)) note += (note ? " " : "") + tx("Months and years were applied first, then weeks and days.");
  }
  if (out.y < 1 || out.y > 9999) return bad(tx("That falls outside the years 1 to 9999, which this calculator covers."));
  const iw = isoWeek(out);
  text("#dc-main", longDate(out));
  text("#dc-iso", isoDate(out));
  text("#dc-wd", weekdayName(weekday(out)));
  text("#dc-week", String(iw.week));
  if (iw.year !== out.y) $("#dc-week").append(Object.assign(document.createElement("small"), { textContent: " " + tx("(ISO year {year})", { year: iw.year }) }));
  text("#dc-doy", `${dayOfYear(out)}`);
  $("#dc-doy").append(Object.assign(document.createElement("small"), { textContent: " " + tx("of {n}", { n: fmtNum(isLeap(out.y) ? 366 : 365) }) }));
  const span = dayNumber(out) - dayNumber(start);
  text("#dc-span", (span > 0 ? "+" : "") + fmtNum(span));
  text("#dc-note", note);
  res.hidden = false;
}

const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const dayWord = (n) => (EN ? n + ord(n) : fmtNum(n));

START.value = isoDate(today());
for (const i of $$("#dc-start, .dc__fields input, input[name='dc-op'], input[name='dc-kind']")) {
  i.addEventListener("input", update);
  i.addEventListener("change", update);
}
$("#dc-today").addEventListener("click", () => { START.value = isoDate(today()); update(); });
update();
