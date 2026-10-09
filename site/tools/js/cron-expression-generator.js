import { $, $$, el, copyText, tx, txn, txf, EN, LOCALE, dateFormat } from "./core.js?v=11";
import { fillZoneSelect, zoneOf, wallFields, offsetMinutes, utcFromFields, fmtOffset, pad, resolveWall } from "./tzcore.js?v=11";
import { parseCron, describe, nextRuns, MONTHS, DAYS, monthName, dayName, SEARCH_YEARS } from "./croncore.js?v=11";
import { CRON_FIELDS, defaultField, fieldText, fieldFromParsed } from "./dev3core.js?v=11";

const UNITS = [
  { every: tx("Every minute"), stepLabel: tx("Every N minutes"), stepMode: tx("Every N minutes, from a start"), specific: tx("Specific minutes") },
  { every: tx("Every hour"), stepLabel: tx("Every N hours"), stepMode: tx("Every N hours, from a start"), specific: tx("Specific hours") },
  { every: tx("Every day of the month"), stepLabel: tx("Every N days"), stepMode: tx("Every N days, from a start"), specific: tx("Specific days") },
  { every: tx("Every month"), stepLabel: tx("Every N months"), stepMode: tx("Every N months, from a start"), specific: tx("Specific months") },
  { every: tx("Every day of the week"), stepLabel: tx("Every N days"), stepMode: tx("Every N days, from a start"), specific: tx("Specific weekdays") },
];
const valueLabel = (i, v) => (i === 3 ? monthName(v - 1, "long", true) : i === 4 ? dayName(v, "long", true) : String(v));
const chipLabel = (i, v) => (i === 3 ? monthName(v - 1, "short", true) : i === 4 ? dayName(v, "short", true) : String(v));
const order = (i) => {
  const d = CRON_FIELDS[i];
  const v = Array.from({ length: d.max - d.min + 1 }, (_, k) => d.min + k);
  return i === 4 ? [1, 2, 3, 4, 5, 6, 0] : v;
};

const state = CRON_FIELDS.map((_, i) => defaultField(i));
const exprEl = $("#g-expr"), say = $("#g-say"), info = $("#g-info"), note = $("#g-note");
const tzSel = $("#g-tz"), fromIn = $("#g-from"), countSel = $("#g-count");
const runsList = $("#g-runs"), runsInfo = $("#g-runs-info"), runsNote = $("#g-runs-note");
const loadIn = $("#g-load"), loadInfo = $("#g-load-info");
const host = $("#g-fields");
fillZoneSelect(tzSel);

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/* Run times as people read them on non-English pages: weekday, date and 24-hour time in the zone. */
function runTime(t, zone) {
  return dateFormat({ weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(t);
}
function rel(ms) {
  const s = (ms - Date.now()) / 1000, a = Math.abs(s);
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 60) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 730) return rtf.format(Math.round(s / (86400 * 30.44)), "month");
  return rtf.format(Math.round(s / (86400 * 365.25)), "year");
}

/* ------------------------------------------------------------------ field panels */

function select(id, label, options, value) {
  const s = el("select", { id });
  for (const [v, t] of options) s.append(el("option", { value: String(v) }, t));
  s.value = String(value);
  return el("div", { class: "field" }, el("label", { for: id }, label), s);
}

function panel(i) {
  const d = CRON_FIELDS[i], f = state[i], u = UNITS[i], k = d.key;
  const modes = [["every", u.every], ["step", u.stepMode], ["values", u.specific], ["range", tx("Between two values")]];
  if (f.mode === "custom") modes.push(["custom", tx("Custom (kept as typed)")]);
  const vals = order(i).map((v) => [v, valueLabel(i, v)]);
  const body = el("div", { class: "cg-body" });
  if (f.mode === "step") {
    body.append(
      el("div", { class: "field" }, el("label", { for: `g-${k}-step` }, u.stepLabel),
        el("input", { type: "number", id: `g-${k}-step`, min: "1", max: String(d.max - d.min), step: "1", value: String(f.step), inputmode: "numeric" })),
      select(`g-${k}-start`, tx("Starting at"), vals, f.start));
  } else if (f.mode === "values") {
    const chips = el("div", { class: "cg-chips", role: "group", "aria-label": tx("{field} values", { field: d.label }) });
    for (const v of order(i)) {
      const input = el("input", { type: "checkbox", id: `g-${k}-v${v}`, value: String(v) });
      input.checked = f.values.includes(v);
      chips.append(el("label", { class: "cg-chip", title: valueLabel(i, v) }, input, el("span", {}, chipLabel(i, v))));
    }
    body.append(chips);
  } else if (f.mode === "range") {
    body.append(select(`g-${k}-from`, tx("Between"), vals, f.from), select(`g-${k}-to`, tx("and"), vals, f.to));
  } else if (f.mode === "custom") {
    body.append(el("p", { class: "help" }, ...txf("Kept as typed: {code}. Pick another mode to replace it.", { code: el("code", {}, f.custom) })));
  }
  const node = el("fieldset", { class: "cg-field", "data-field": k },
    el("legend", {}, d.label),
    select(`g-${k}-mode`, tx("Run"), modes, f.mode),
    body);
  return node;
}

function renderPanels() {
  host.replaceChildren(...CRON_FIELDS.map((_, i) => panel(i)));
}

function readPanel(i) {
  const d = CRON_FIELDS[i], f = state[i], k = d.key;
  const g = (s) => $(`#g-${k}-${s}`);
  if (f.mode === "step") { f.step = g("step").value; f.start = Number(g("start").value); }
  else if (f.mode === "values") f.values = $$(`#g-fields [data-field="${k}"] .cg-chip input:checked`).map((c) => Number(c.value));
  else if (f.mode === "range") { f.from = Number(g("from").value); f.to = Number(g("to").value); }
}

host.addEventListener("change", (e) => {
  const fs = e.target.closest("[data-field]");
  if (!fs) return;
  const i = CRON_FIELDS.findIndex((d) => d.key === fs.dataset.field);
  if (e.target.id === `g-${CRON_FIELDS[i].key}-mode`) {
    const keep = state[i];
    state[i] = { ...defaultField(i), mode: e.target.value, custom: keep.custom };
    if (state[i].mode === "step" && i === 0) state[i].step = 15;
    fs.replaceWith(panel(i));
    $(`#g-${CRON_FIELDS[i].key}-mode`).focus();
  } else readPanel(i);
  update();
});
host.addEventListener("input", (e) => {
  if (e.target.type !== "number") return;
  const i = CRON_FIELDS.findIndex((d) => d.key === e.target.closest("[data-field]").dataset.field);
  readPanel(i);
  update();
});

/* ------------------------------------------------------------------ output */

function fromInstant(tz) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(fromIn.value);
  if (!m) return { ms: Date.now(), now: true };
  return { ms: resolveWall({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: 0 }, tz).ms, now: false };
}

let expression = "";

function clearOutput() {
  expression = "";
  exprEl.textContent = "—";
  say.textContent = "";
  note.hidden = true;
  runsList.replaceChildren();
  runsInfo.textContent = "";
  runsNote.hidden = true;
}

function update() {
  for (const fs of $$(".cg-field")) fs.classList.remove("is-bad");
  const parts = [];
  for (let i = 0; i < 5; i++) {
    try { parts.push(fieldText(i, state[i])); } catch (e) {
      clearOutput();
      info.textContent = e.message;
      info.classList.add("tt__err");
      $$(".cg-field")[i].classList.add("is-bad");
      return;
    }
  }
  info.classList.remove("tt__err");
  expression = parts.join(" ");
  exprEl.textContent = expression;
  let p;
  try { p = parseCron(expression); } catch (e) {
    clearOutput();
    info.textContent = e.message;
    info.classList.add("tt__err");
    return;
  }
  const custom = state.filter((f) => f.mode === "custom").length;
  info.textContent = custom ? txn(custom, "{n} field uses syntax the controls can't show, so it is kept exactly as typed.", "{n} fields use syntax the controls can't show, so they are kept exactly as typed.") : "";
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
  if (!r.runs.length) runsInfo.textContent = tx("This schedule never runs: no date in the next {years} years matches it.", { years: SEARCH_YEARS });
  else if (r.runs.length < count) runsInfo.textContent = txn(r.runs.length, "Only {n} run in the next {years} years, from {from}, in {zone}.", "Only {n} runs in the next {years} years, from {from}, in {zone}.", { years: SEARCH_YEARS, from: fromText, zone: zname });
  else runsInfo.textContent = tx("Next {n} runs from {from}, in {zone}.", { n: count, from: fromText, zone: zname });
  const dst = [];
  if (r.skipped) dst.push(txn(r.skipped, "{n} scheduled time falls in an hour skipped when clocks spring forward, so it is left out.", "{n} scheduled times fall in an hour skipped when clocks spring forward, so they are left out."));
  if (r.repeated) dst.push(txn(r.repeated, "{n} scheduled time falls in an hour that happens twice when clocks go back; each is listed once, at its first occurrence.", "{n} scheduled times fall in an hour that happens twice when clocks go back; each is listed once, at its first occurrence."));
  runsNote.textContent = dst.join(" ");
  runsNote.hidden = !dst.length;
}

/* ------------------------------------------------------------------ loading an expression */

function load(text) {
  let p;
  try { p = parseCron(text); } catch (e) {
    loadIn.setAttribute("aria-invalid", "true");
    loadInfo.classList.add("tt__err");
    loadInfo.textContent = e.message;
    return false;
  }
  loadIn.setAttribute("aria-invalid", "false");
  loadInfo.classList.remove("tt__err");
  p.fields.forEach((f, i) => { state[i] = fieldFromParsed(i, f); });
  renderPanels();
  update();
  const changed = state.filter((f) => f.mode === "custom").length;
  loadInfo.textContent = changed ? tx("Loaded. Fields shown as Custom use syntax the controls can't edit.") : tx("Loaded into the controls.");
  return true;
}

$("#g-load-btn").addEventListener("click", () => load(loadIn.value));
loadIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); load(loadIn.value); } });
for (const b of $$("[data-cron]")) b.addEventListener("click", () => { loadIn.value = ""; loadInfo.textContent = ""; load(b.dataset.cron); });
$("#g-copy").addEventListener("click", (e) => { if (expression) copyText(expression, e.currentTarget); });
for (const c of [tzSel, fromIn, countSel]) { c.addEventListener("input", update); c.addEventListener("change", update); }

load("30 9 * * 1-5");
loadInfo.textContent = tx("Paste a five-field expression or a shortcut such as @daily.");
