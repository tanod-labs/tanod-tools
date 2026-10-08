import { $, live, openTextFile, wireCopy, downloadButton, setStatus, announce, fmtInt, normalizeNewlines, tx, txn } from "./textcore.js?v=5";

const area = $("#text");
const find = $("#find");
const repl = $("#repl");
const out = $("#out");
const status = $("#status");
const info = $("#info");
const WORKER_URL = "/tools/js/regex-worker.js";
const TIMEOUT_MS = 2000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WB_L = "(?<![\\p{L}\\p{N}_])", WB_R = "(?![\\p{L}\\p{N}_])";

/* Build {pattern, flags} from the controls, or throw a SyntaxError. */
function build() {
  const regex = $("#regex").checked, matchCase = $("#case").checked, whole = $("#whole").checked;
  let pattern, flags;
  if (regex) {
    pattern = find.value;
    if (whole) pattern = `\\b(?:${pattern})\\b`;
    flags = "gm" + (matchCase ? "" : "i");
  } else {
    pattern = escapeRe(find.value);
    if (whole) pattern = WB_L + pattern + WB_R;
    flags = "gu" + (matchCase ? "" : "i");
  }
  new RegExp(pattern, flags); // validates
  return { pattern, flags };
}

let job = 0, worker = null, timer = null;
function stopWorker() {
  if (worker) worker.terminate();
  worker = null;
  clearTimeout(timer);
}

/* Run in a same-origin worker with a timeout; resolves {count, output} or rejects with an Error whose .timeout is set. */
function inWorker(payload) {
  stopWorker();
  return new Promise((resolve, reject) => {
    worker = new Worker(WORKER_URL);
    const w = worker;
    timer = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      reject(Object.assign(new Error("timeout"), { timeout: true }));
    }, TIMEOUT_MS);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      if (worker === w) worker = null;
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data);
    };
    w.onerror = () => { clearTimeout(timer); w.terminate(); reject(new Error(tx("The pattern could not be run."))); };
    w.postMessage(payload);
  });
}

function countLiteral(text, b) {
  const re = new RegExp(b.pattern, b.flags);
  let n = 0, m;
  while ((m = re.exec(text)) !== null) { n++; if (m[0] === "") re.lastIndex++; }
  return n;
}

const TOO_LONG = tx("That pattern took too long (over 2 seconds), so it was stopped. Try a simpler pattern, such as fewer nested repeats like (a+)+.");

function showInfo(msg, isErr = false) {
  info.textContent = msg;
  info.classList.toggle("tt__err", isErr);
  find.setAttribute("aria-invalid", isErr ? "true" : "false");
}

function hideOut() { $("#out-wrap").hidden = true; out.value = ""; setStatus(status, "idle"); }

async function refresh() {
  hideOut();
  const id = ++job;
  const has = find.value !== "";
  $("#go").disabled = true;
  if (!has) { stopWorker(); showInfo(tx("Type what to find.")); return; }
  let b;
  try { b = build(); } catch (e) { stopWorker(); showInfo(tx("Not a valid pattern: {error}", { error: String(e.message).replace(/^Invalid regular expression: /, "") }), true); return; }
  const text = normalizeNewlines(area.value);
  if (!$("#regex").checked) {
    const n = countLiteral(text, b);
    showInfo(txn(n, "{n} match", "{n} matches"));
    $("#go").disabled = n === 0;
    return;
  }
  showInfo(tx("Checking pattern…"));
  try {
    const r = await inWorker({ id, text, pattern: b.pattern, flags: b.flags });
    if (id !== job) return;
    showInfo(txn(r.count, "{n} match", "{n} matches"));
    $("#go").disabled = r.count === 0;
  } catch (e) {
    if (id !== job) return;
    showInfo(e.timeout ? TOO_LONG : tx("Not a valid pattern: {error}", { error: e.message }), true);
  }
}

$("#go").addEventListener("click", async () => {
  const id = ++job;
  const text = normalizeNewlines(area.value);
  let b;
  try { b = build(); } catch (e) { return; }
  const regex = $("#regex").checked;
  setStatus(status, "working", tx("Replacing…"));
  let count, output;
  try {
    if (regex) {
      const r = await inWorker({ id, text, pattern: b.pattern, flags: b.flags, replacement: repl.value, replace: true });
      count = r.count; output = r.output;
    } else {
      const re = new RegExp(b.pattern, b.flags);
      count = 0;
      output = text.replace(re, () => { count++; return repl.value; });
    }
  } catch (e) {
    setStatus(status, "error", e.timeout ? TOO_LONG : tx("Replace failed: {error}", { error: e.message }));
    return;
  }
  if (id !== job) return;
  out.value = output;
  $("#out-wrap").hidden = false;
  const done = txn(count, "Replaced {n} match.", "Replaced {n} matches.");
  setStatus(status, "done", done);
  announce(done);
});

live(() => area.value, [area, find, $("#case"), $("#whole"), $("#regex")], refresh);
repl.addEventListener("input", hideOut);
$("#regex").addEventListener("change", () => {
  $("#regex-help").hidden = !$("#regex").checked;
});
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "replaced-text.txt"), { id: "dl" }));
$("#use").addEventListener("click", () => { area.value = out.value; refresh(); announce(tx("Result moved into the text box.")); });
$("#clear").addEventListener("click", () => { area.value = ""; refresh(); area.focus(); });
openTextFile($("#drop"), status, (text) => { area.value = text; refresh(); });
refresh();
