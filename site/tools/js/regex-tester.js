import { $, el, live, fmtInt, wireCopy, MAX_TEXT_BYTES } from "./textcore.js?v=5";
import { $$, tx, txn, fmtNum } from "./core.js?v=5";

const WORKER_URL = "/tools/js/regex-worker.js";
const TIMEOUT_MS = 2000;
const MAX_LIST = 1000;
const ORDER = "dgimsuvy";

const pat = $("#r-pattern"), text = $("#r-text"), repl = $("#r-repl");
const info = $("#r-info"), view = $("#r-view"), list = $("#r-list");
const outWrap = $("#r-out-wrap"), out = $("#r-out"), flagText = $("#r-flagtext");
const flagBoxes = $$("[data-flag]");

/* Hide flags this browser's engine doesn't know (v is recent). */
for (const b of flagBoxes) {
  try { new RegExp("", b.dataset.flag); } catch (_) { b.closest("label").hidden = true; b.checked = false; }
}

const flags = () => ORDER.split("").filter((f) => flagBoxes.some((b) => b.dataset.flag === f && b.checked)).join("");

let worker = null, timer = null, job = 0;
function stop() { if (worker) worker.terminate(); worker = null; clearTimeout(timer); }

function run(payload) {
  stop();
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_URL);
    worker = w;
    timer = setTimeout(() => { w.terminate(); if (worker === w) worker = null; reject(Object.assign(new Error("timeout"), { timeout: true })); }, TIMEOUT_MS);
    w.onmessage = (e) => {
      clearTimeout(timer); w.terminate(); if (worker === w) worker = null;
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data);
    };
    w.onerror = () => { clearTimeout(timer); w.terminate(); reject(new Error(tx("The pattern could not be run."))); };
    w.postMessage(payload);
  });
}

function say(msg, err = false) {
  info.textContent = msg;
  info.classList.toggle("tt__err", err);
  pat.setAttribute("aria-invalid", err ? "true" : "false");
}

function plain() {
  view.textContent = text.value;
  list.replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "rx-none" }, tx("No matches to list."))));
  outWrap.hidden = true;
}

function render(r, src) {
  const frag = document.createDocumentFragment();
  let pos = 0;
  r.matches.forEach((m, i) => {
    if (m.index > pos) frag.append(src.slice(pos, m.index));
    if (m.text === "") frag.append(el("mark", { class: "rx-empty", title: tx("Empty match at {index}", { index: m.index }) }));
    else frag.append(el("mark", { class: i % 2 ? "rx-alt" : null }, m.text));
    pos = Math.max(pos, m.end);
  });
  if (pos < src.length) frag.append(src.slice(pos));
  view.replaceChildren(frag);

  if (!r.matches.length) { list.replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "rx-none" }, tx("No matches.")))); }
  else {
    list.replaceChildren(...r.matches.map((m, i) => el("tr", {},
      el("td", {}, String(i + 1)),
      el("td", {}, m.end > m.index ? `${m.index}–${m.end}` : String(m.index)),
      el("td", {}, m.text === "" ? el("span", { class: "rx-none" }, tx("empty")) : m.text),
      el("td", {}, m.groups.length
        ? m.groups.map((g) => el("span", { class: "rx-g" }, el("b", {}, g.name ? `${g.n} ${g.name}` : String(g.n)),
          g.value === undefined || g.value === null ? el("span", { class: "rx-none" }, tx("no match")) : g.value === "" ? el("span", { class: "rx-none" }, tx("empty")) : g.value))
        : el("span", { class: "rx-none" }, tx("none"))))));
  }
  if (typeof r.output === "string") { out.textContent = r.output; outWrap.hidden = false; } else outWrap.hidden = true;
}

async function update() {
  const id = ++job;
  const f = flags();
  flagText.textContent = "/" + f;
  if (!pat.value) { stop(); say(tx("Type a pattern.")); plain(); return; }
  try { new RegExp(pat.value, f); } catch (e) {
    stop();
    say(tx("Not a valid pattern: {error}", { error: String(e.message).replace(/^Invalid regular expression: /, "").replace(/^\/.*\/[a-z]*: /, "") }), true);
    plain();
    return;
  }
  const src = text.value;
  if (new Blob([src]).size > MAX_TEXT_BYTES) { stop(); say(tx("The test text is over 5 MB. Use a shorter sample."), true); plain(); return; }
  say(tx("Running…"));
  try {
    const r = await run({ id, mode: "list", text: src, pattern: pat.value, flags: f, replacement: repl.value !== "" ? repl.value : undefined, max: MAX_LIST });
    if (id !== job) return;
    let msg;
    if (r.capped) msg = txn(r.count, "{n} match; the first {max} are listed and highlighted.", "{n} matches; the first {max} are listed and highlighted.", { max: fmtInt(MAX_LIST) });
    else if (!f.includes("g") && r.count === 1) msg = tx("{n} match. Without the g flag only the first match is found.", { n: fmtNum(1) });
    else msg = txn(r.count, "{n} match.", "{n} matches.");
    say(msg);
    render(r, src);
  } catch (e) {
    if (id !== job) return;
    if (e.timeout) say(tx("That pattern took too long (over 2 seconds), so it was stopped. Look for nested repeats such as (a+)+ and simplify them."), true);
    else say(tx("Not a valid pattern: {error}", { error: e.message }), true);
    plain();
  }
}

live(() => text.value, [pat, text, repl, ...flagBoxes], update);
wireCopy($("#r-copy"), () => out.textContent);
update();
