import { $, $$, el, prefs, tx, dateFormat } from "./core.js?v=11";
import { parseUtcLocal, deadlines, remaining, CONTENTS } from "./cracore.js?v=11";
import { pad } from "./utcdate.js?v=11";

const KEY = "cra-clock";
const aware = $("#cl-aware"), fix = $("#cl-fix"), notified = $("#cl-notified"), utcBox = $("#cl-utc");
const result = $("#cl-result"), stagesEl = $("#cl-stages"), emptyNote = $("#cl-empty"), remember = $("#cl-remember"), keepHelp = $("#cl-keep-h");
const kindOf = () => $('input[name="cl-kind"]:checked').value;
const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { return ""; } })();

/* datetime-local text <-> timestamp, in the browser's zone or in UTC as ticked */
function parseInput(v) {
  if (!v) return null;
  if (utcBox.checked) return parseUtcLocal(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function toInput(ms) {
  const d = new Date(ms);
  return utcBox.checked
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmtLocal = (ms) => dateFormat({ dateStyle: "full", timeStyle: "long" }).format(ms);
const fmtUtc = (ms) => dateFormat({ dateStyle: "full", timeStyle: "long", timeZone: "UTC" }).format(ms);

function span(r) {
  const x = { d: r.days, h: r.hours, m: r.minutes };
  return r.days ? tx("{d} d {h} h {m} min", x) : tx("{h} h {m} min", x);
}

/* The sentence for what each report holds; one literal tx() per item so the build can translate them. */
function itemText(id) {
  switch (id) {
    case "v-exploited": return tx("That a vulnerability in your product is being actively exploited.");
    case "v-states": return tx("Where applicable, the EU Member States where you know the product is made available.");
    case "v-product": return tx("General information about the product concerned.");
    case "v-nature": return tx("The general nature of the exploit and of the vulnerability.");
    case "v-measures": case "i-measures": return tx("Any corrective or mitigating measures you have taken.");
    case "v-users": case "i-users": return tx("Corrective or mitigating measures that users can take.");
    case "v-sensitivity": case "i-sensitivity": return tx("Where applicable, how sensitive you consider the information to be.");
    case "v-description": return tx("A description of the vulnerability, including its severity and impact.");
    case "v-actor": return tx("Where available, information about any malicious actor who has exploited or is exploiting the vulnerability.");
    case "v-update": return tx("Details of the security update or other corrective measure made available.");
    case "i-severe": return tx("That a severe incident has an impact on the security of your product.");
    case "i-malicious": return tx("Whether the incident is suspected of being caused by unlawful or malicious acts.");
    case "i-nature": return tx("The general nature of the incident.");
    case "i-assessment": return tx("Your initial assessment of the incident.");
    case "i-description": return tx("A detailed description of the incident, including its severity and impact.");
    case "i-cause": return tx("The type of threat or root cause that is likely to have triggered the incident.");
    case "i-mitigation": return tx("The mitigation measures applied and those that are ongoing.");
    default: return id;
  }
}

function stageText(kind, stage) {
  if (stage === "early") return [tx("Early warning"), tx("Within 24 hours of becoming aware.")];
  if (stage === "notification") return [tx("Notification"), tx("Within 72 hours of becoming aware.")];
  return kind === "vulnerability"
    ? [tx("Final report"), tx("No later than 14 days after a fix or mitigation is available.")]
    : [tx("Final report"), tx("Within one month after the 72-hour notification.")];
}

function basisNote(basis) {
  if (basis === "fix-pending") return tx("Not set yet. Enter the time a fix or mitigation became available.");
  if (basis === "notification-deadline") return tx("Counted from the latest time the notification can be filed. Enter the time you actually filed it to update this.");
  return "";
}

let state = null;   // {kind, aware, fix, notified} in ms
let rows = [];      // [{at, node}] for the live countdown

function readState() {
  const a = parseInput(aware.value);
  if (a === null) return null;
  return { kind: kindOf(), aware: a, fix: parseInput(fix.value), notified: parseInput(notified.value) };
}

function countdown(node, at) {
  const r = remaining(at, Date.now());
  node.textContent = r.overdue ? tx("Overdue by {time}", { time: span(r) }) : tx("{time} left", { time: span(r) });
  node.classList.toggle("is-overdue", r.overdue);
}

function render() {
  state = readState();
  const kind = kindOf();
  $("#cl-fix-wrap").hidden = kind !== "vulnerability";
  $("#cl-notified-wrap").hidden = kind !== "incident";
  if (!state) { result.hidden = true; emptyNote.hidden = false; stagesEl.replaceChildren(); rows = []; return; }
  emptyNote.hidden = true;
  result.hidden = false;
  const ds = deadlines(kind, state.aware, { fixAt: state.fix, notifiedAt: state.notified });
  rows = [];
  $("#cl-summary").textContent = tx("{kind}. You became aware on {time}.", {
    kind: kind === "vulnerability" ? tx("Actively exploited vulnerability") : tx("Severe incident"),
    time: fmtLocal(state.aware),
  });
  stagesEl.replaceChildren(...ds.map((d, i) => {
    const [name, rule] = stageText(kind, d.stage);
    const when = d.at === null
      ? el("p", { class: "cl-when cl-when--open" }, basisNote(d.basis))
      : el("div", { class: "cl-when" },
        el("p", {}, el("span", { class: "cl-when__tag" }, ZONE ? tx("Your time zone ({zone})", { zone: ZONE }) : tx("Your time zone")), el("strong", {}, fmtLocal(d.at))),
        el("p", {}, el("span", { class: "cl-when__tag" }, tx("UTC")), el("strong", {}, fmtUtc(d.at))),
        el("p", { class: "cl-left" }));
    if (d.at !== null) rows.push({ at: d.at, node: when.querySelector(".cl-left") });
    const note = d.at !== null && basisNote(d.basis);
    const ids = CONTENTS[kind][d.stage];
    const boxes = ids.map((id, j) => {
      const cid = `cl-c-${d.stage}-${j}`;
      return el("li", {}, el("input", { type: "checkbox", id: cid }), el("label", { for: cid }, itemText(id)));
    });
    return el("li", { class: "cl-stage" },
      el("h3", {}, el("span", { class: "cl-stage__n" }, String(i + 1)), name),
      el("p", { class: "cl-rule" }, rule),
      when,
      note ? el("p", { class: "cl-basis" }, note) : null,
      el("p", { class: "cl-incl" }, i === 0 ? tx("Include:") : tx("Include, unless you already provided it:")),
      el("ul", { class: "cl-check" }, ...boxes));
  }));
  $("#cl-foot").textContent = tx("File each report through ENISA's Single Reporting Platform: one submission reaches ENISA and the CSIRT designated as coordinator. Outside the EU, report through your EU authorised representative. The regulation and ENISA's guidance prevail over this page.");
  for (const r of rows) countdown(r.node, r.at);
  save();
}

function save() {
  if (!remember.checked || !state) return;
  prefs.set(KEY, { kind: state.kind, aware: state.aware, fix: state.fix, notified: state.notified, utc: utcBox.checked });
}

function updateKeepHelp() {
  keepHelp.textContent = remember.checked
    ? tx("Saved in this browser only, on this device. Untick the box or press the button to delete it.")
    : tx("Nothing is stored unless you tick the box.");
}

function restore() {
  const s = prefs.get(KEY, null);
  if (!s || typeof s.aware !== "number") return;
  remember.checked = true;
  utcBox.checked = !!s.utc;
  $(`input[name="cl-kind"][value="${s.kind === "incident" ? "incident" : "vulnerability"}"]`).checked = true;
  aware.value = toInput(s.aware);
  if (typeof s.fix === "number") fix.value = toInput(s.fix);
  if (typeof s.notified === "number") notified.value = toInput(s.notified);
}

for (const i of [aware, fix, notified]) i.addEventListener("input", render);
for (const r of $$('input[name="cl-kind"]')) r.addEventListener("change", render);
utcBox.addEventListener("change", () => {
  // keep the same moment: re-read the fields in the old mode, write them in the new one
  const old = !utcBox.checked;
  const keep = [aware, fix, notified].map((i) => {
    if (!i.value) return null;
    utcBox.checked = old;
    const ms = parseInput(i.value);
    utcBox.checked = !old;
    return ms;
  });
  [aware, fix, notified].forEach((i, k) => { if (keep[k] !== null) i.value = toInput(keep[k]); });
  render();
});
$("#cl-now").addEventListener("click", () => { aware.value = toInput(Date.now()); render(); });
remember.addEventListener("change", () => {
  updateKeepHelp();
  if (remember.checked) save(); else prefs.set(KEY, null);
});
$("#cl-forget").addEventListener("click", () => {
  prefs.set(KEY, null);
  try { localStorage.removeItem("tt:" + KEY); } catch (_) { /* storage blocked */ }
  remember.checked = false;
  for (const i of [aware, fix, notified]) i.value = "";
  utcBox.checked = false;
  updateKeepHelp();
  render();
});
$("#cl-print").addEventListener("click", () => window.print());

setInterval(() => { for (const r of rows) countdown(r.node, r.at); }, 10000);
restore();
updateKeepHelp();
render();
