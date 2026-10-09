import { $, live, wireCopy, setStatus, announce, tx, txn } from "./textcore.js?v=11";
import { dropzone, fmtBytes, baseName, UserError } from "./core.js?v=11";
import { toCsv, parseJsonText, RawNumber, saveText } from "./csvcore.js?v=11";

const MAX_BYTES = 10 * 1024 * 1024;
const area = $("#text");
const out = $("#out");
const status = $("#status");
const report = $("#report");
const controls = ["#delim", "#nested", "#headrow", "#bom", "#crlf"].map((s) => $(s));
let fileBase = "data";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof RawNumber);
const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : v instanceof RawNumber ? "number" : isObj(v) ? "object" : typeof v);
const kindName = (k) => (k === "null" ? tx("null") : k === "array" ? tx("an array") : k === "number" ? tx("a number") : k === "object" ? tx("an object") : k === "string" ? tx("a string") : k === "boolean" ? tx("a boolean") : k);

/* JSON text for a value, keeping exact number source text. */
function jsonText(v) {
  if (v instanceof RawNumber) return v.s;
  if (Array.isArray(v)) return "[" + v.map(jsonText).join(",") + "]";
  if (isObj(v)) return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ":" + jsonText(x)).join(",") + "}";
  return JSON.stringify(v);
}

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof RawNumber) return v.s;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return jsonText(v);
}

/* Flatten nested objects into dot paths; arrays stay as JSON text. */
function flatten(obj, flat, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k;
    if (flat && isObj(v) && Object.keys(v).length) flatten(v, flat, key, out);
    else out[key] = v;
  }
  return out;
}

export function jsonToCsv(text, { delim = ",", nested = "flatten", headRow = true, eol = "\n" } = {}) {
  const data = parseJsonText(text);
  const flat = nested === "flatten";
  let rows, shape, cols;
  const list = Array.isArray(data) ? data : isObj(data) ? [data] : null;
  if (!list) throw new UserError(tx("The JSON is {kind}. Use an array of objects (one per row), an array of arrays, or a single object.", { kind: kindName(kind(data)) }));
  if (!list.length) throw new UserError(tx("The array is empty, so there are no rows to write."));
  if (list.every(Array.isArray)) {
    shape = "arrays";
    rows = list.map((r) => r.map(cellText));
    cols = Math.max(...rows.map((r) => r.length));
  } else if (list.every(isObj)) {
    shape = "objects";
    const objs = list.map((o) => flatten(o, flat));
    const keys = [];
    const seen = new Set();
    for (const o of objs) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    rows = objs.map((o) => keys.map((k) => cellText(o[k])));
    if (headRow) rows.unshift(keys);
    cols = keys.length;
  } else if (list.every((v) => !isObj(v) && !Array.isArray(v))) {
    shape = "values";
    rows = list.map((v) => [cellText(v)]);
    if (headRow) rows.unshift(["value"]);
    cols = 1;
  } else {
    const first = kind(list[0]);
    const bad = list.findIndex((v) => kind(v) !== first && !(first === "object" && isObj(v)));
    throw new UserError(tx("The array mixes types: item 1 is {first} but item {n} is {other}. Each item should be the same kind (all objects or all arrays).", { first: kindName(first), n: bad + 1, other: kindName(kind(list[bad])) }));
  }
  const records = list.length;
  return { csv: toCsv(rows, delim, eol), records, cols, shape };
}

let current = "";
function update() {
  const text = area.value;
  if (!text.trim()) {
    out.value = ""; current = "";
    report.textContent = tx("Paste JSON to begin.");
    setStatus(status, "idle");
    $("#copy").disabled = $("#dl").disabled = true;
    return;
  }
  try {
    const r = jsonToCsv(text, {
      delim: $("#delim").value, nested: $("#nested").value, headRow: $("#headrow").checked,
      eol: $("#crlf").checked ? "\r\n" : "\n",
    });
    current = r.csv;
    out.value = r.csv;
    const what = { objects: tx("objects"), arrays: tx("arrays"), values: tx("values") }[r.shape];
    const vars = { rows: txn(r.records, "{n} row", "{n} rows"), what, cols: txn(r.cols, "{n} column", "{n} columns") };
    report.textContent = r.shape === "arrays" ? tx("{rows} from {what}, {cols} (arrays are written as they are, with no header row)", vars) : tx("{rows} from {what}, {cols}", vars);
    setStatus(status, "idle");
    $("#copy").disabled = $("#dl").disabled = false;
  } catch (err) {
    out.value = ""; current = "";
    report.textContent = "";
    $("#copy").disabled = $("#dl").disabled = true;
    setStatus(status, "error", err instanceof UserError || err.line !== undefined ? err.message : tx("This JSON couldn't be converted."));
  }
}

live(() => area.value, [area, ...controls], update);
wireCopy($("#copy"), () => current);
$("#dl").addEventListener("click", () => {
  const body = ($("#bom").checked ? "﻿" : "") + current;
  saveText(new Blob([body], { type: "text/csv;charset=utf-8" }), fileBase + ".csv");
});
$("#clear").addEventListener("click", () => { area.value = ""; fileBase = "data"; update(); area.focus(); });

dropzone($("#drop"), {
  accept: ["application/json", ".json", "text/plain", ".txt"],
  typeLabel: "JSON", maxFileBytes: MAX_BYTES,
  onError: (m) => setStatus(status, "error", m + " " + tx("JSON files up to 10 MB can be opened.")),
  onFiles: async ([file]) => {
    try {
      area.value = await file.text();
      fileBase = baseName(file.name);
      update();
      announce(tx("Opened {name}, {size}.", { name: file.name, size: fmtBytes(file.size) }));
    } catch (_) { setStatus(status, "error", tx("That file couldn't be read as text.")); }
  },
});
update();
