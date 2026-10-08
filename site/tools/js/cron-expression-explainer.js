import { $, $$, el, debounce, tx, txn, EN, LOCALE, dateFormat } from "./core.js?v=5";
import { fillZoneSelect, zoneOf, wallFields, offsetMinutes, utcFromFields, fmtOffset, pad, resolveWall } from "./tzcore.js?v=5";
import { parseCron, describe, nextRuns, fieldSummary, MACROS, DAYS, SEARCH_YEARS } from "./croncore.js?v=5";

/* ------------------------------------------------------------------ page */

const input = $("#c-in"), info = $("#c-info"), say = $("#c-say"), note = $("#c-note");
const tzSel = $("#c-tz"), fromIn = $("#c-from"), countSel = $("#c-count");
const runsList = $("#c-runs"), runsInfo = $("#c-runs-info"), runsNote = $("#c-runs-note");
const cells = $$("#c-fields > div");
fillZoneSelect(tzSel);

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
function rel(ms) {
  const s = (ms - Date.now()) / 1000, a = Math.abs(s);
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 60) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 730) return rtf.format(Math.round(s / (86400 * 30.44)), "month");
  return rtf.format(Math.round(s / (86400 * 365.25)), "year");
}

/* Run times as people read them on non-English pages: weekday, date and 24-hour time in the zone. */
function runTime(t, zone) {
  return dateFormat({ weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(t);
}

function fromInstant(tz) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(fromIn.value);
  if (!m) return { ms: Date.now(), now: true };
  return { ms: resolveWall({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: 0 }, tz).ms, now: false };
}

function clearOutput() {
  say.textContent = "";
  note.hidden = true;
  runsList.replaceChildren();
  runsInfo.textContent = "";
  runsNote.hidden = true;
}

function update() {
  let p;
  for (const c of cells) { c.classList.remove("is-bad"); c.querySelector("dd").replaceChildren(); }
  try {
    p = parseCron(input.value);
  } catch (e) {
    clearOutput();
    info.textContent = e.message;
    info.classList.add("tt__err");
    input.setAttribute("aria-invalid", "true");
    if (e.field >= 0) cells[e.field].classList.add("is-bad");
    return;
  }
  input.setAttribute("aria-invalid", "false");
  info.classList.remove("tt__err");
  info.textContent = p.macro ? tx("{macro} is the same as {expr}.", { macro: p.macro, expr: MACROS[p.macro] }) : "";
  p.fields.forEach((f, i) => {
    cells[i].querySelector("dd").append(f.raw, el("span", { class: "help cron-sum" }, fieldSummary(f, i)));
  });
  say.textContent = describe(p);
  const [, , dom, , dow] = p.fields;
  const notes = [...p.notes];
  if (!dom.all && !dow.all) {
    notes.push(!dom.star && !dow.star
      ? tx("Both day fields are set, so cron runs on any day that matches either one, not only days that match both. This is how Vixie cron and cronie work.")
      : tx("One day field starts with *, so cron treats it as unrestricted for the day rule and runs only on days that match both fields."));
  }
  note.textContent = notes.join(" ");
  note.hidden = !notes.length;

  const tz = zoneOf(tzSel.value);
  const from = fromInstant(tz);
  const count = Number(countSel.value);
  const r = nextRuns(p, from.ms, tz, count);
  runsList.replaceChildren(...r.runs.map((t) => {
    const f = wallFields(t, tz);
    const wd = DAYS[new Date(utcFromFields(f.y, f.mo, f.d)).getUTCDay()].slice(0, 3);
    return el("li", {},
      el("time", { datetime: new Date(t).toISOString() }, EN ? `${wd} ${pad(f.y, 4)}-${pad(f.mo)}-${pad(f.d)} ${pad(f.h)}:${pad(f.mi)}` : runTime(t, tz)),
      el("span", { class: "cron-rel" }, `UTC${fmtOffset(offsetMinutes(t, tz))} · ${rel(t)}`));
  }));
  const zname = tz.replace(/_/g, " ");
  const fromText = from.now ? tx("now") : fromIn.value.replace("T", " ");
  if (!r.runs.length) runsInfo.textContent = tx("This schedule never runs: no date in the next {years} years matches it (for example, 31 February doesn't exist).", { years: SEARCH_YEARS });
  else if (r.runs.length < count) runsInfo.textContent = txn(r.runs.length, "Only {n} run in the next {years} years, from {from}, in {zone}.", "Only {n} runs in the next {years} years, from {from}, in {zone}.", { years: SEARCH_YEARS, from: fromText, zone: zname });
  else runsInfo.textContent = tx("Next {n} runs from {from}, in {zone}.", { n: count, from: fromText, zone: zname });
  const dst = [];
  if (r.skipped) dst.push(txn(r.skipped, "{n} scheduled time falls in an hour skipped when clocks spring forward, so it is left out. Vixie cron and cronie run such jobs soon after the change.", "{n} scheduled times fall in an hour skipped when clocks spring forward, so they are left out. Vixie cron and cronie run such jobs soon after the change."));
  if (r.repeated) dst.push(txn(r.repeated, "{n} scheduled time falls in an hour that happens twice when clocks go back; each is listed once, at its first occurrence.", "{n} scheduled times fall in an hour that happens twice when clocks go back; each is listed once, at its first occurrence."));
  runsNote.textContent = dst.join(" ");
  runsNote.hidden = !dst.length;
}

const slow = debounce(update, 120);
input.addEventListener("input", slow);
for (const c of [tzSel, fromIn, countSel]) { c.addEventListener("input", update); c.addEventListener("change", update); }
for (const b of $$("[data-cron]")) b.addEventListener("click", () => { input.value = b.dataset.cron; update(); input.focus(); });
update();
