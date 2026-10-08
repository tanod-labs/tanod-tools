import { $, live, wireCopy, setStatus, announce, fmtInt, tx, txn } from "./textcore.js?v=5";
import { dropzone, fmtBytes, baseName } from "./core.js?v=5";
import { parseCsv, detectDelimiter, DELIMS, saveText } from "./csvcore.js?v=5";

const MAX_BYTES = 10 * 1024 * 1024;
const area = $("#text");
const out = $("#out");
const status = $("#status");
const report = $("#report");
const warn = $("#warn");
const controls = ["#delim", "#header", "#types", "#indent"].map((s) => $(s));
let fileBase = "data";

const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/* Convert one cell when type conversion is on. Returns [value, kept-as-text reason or null]. */
function typed(s) {
  if (s === "true" || s === "TRUE" || s === "True") return [true, null];
  if (s === "false" || s === "FALSE" || s === "False") return [false, null];
  if (s === "null") return [null, null];
  if (NUM.test(s)) {
    const digits = s.replace(/^-/, "").replace(/[eE].*$/, "").replace(".", "").replace(/^0+(?=\d)/, "");
    if (digits.length > 15) return [s, "long"];
    return [Number(s), null];
  }
  if (/^-?0\d+(?:\.\d+)?$/.test(s)) return [s, "zero"];
  return [s, null];
}

/* Make header names unique and non-empty: "", "name", "name" -> "column_1", "name", "name_2". */
export function headerNames(row) {
  const seen = new Map();
  const notes = { empty: 0, dup: 0 };
  const names = row.map((h, i) => {
    let name = h.trim();
    if (!name) { name = `column_${i + 1}`; notes.empty++; }
    return name;
  });
  for (let i = 0; i < names.length; i++) {
    const base = names[i];
    if (!seen.has(base)) { seen.set(base, 1); continue; }
    let k = seen.get(base) + 1;
    while (names.includes(`${base}_${k}`)) k++;
    seen.set(base, k);
    names[i] = `${base}_${k}`;
    notes.dup++;
  }
  return { names, notes };
}

export function csvToJson(text, { delim = "auto", header = true, types = false, indent = "  " } = {}) {
  const d = delim === "auto" ? detectDelimiter(text) : delim;
  const { rows, lines, blank } = parseCsv(text, d);
  const warnings = [];
  const kept = { long: 0, zero: 0 };
  const cell = (s) => {
    if (!types) return s;
    const [v, why] = typed(s);
    if (why) kept[why]++;
    return v;
  };
  let data, cols = 0;
  const mismatch = [];
  if (header && rows.length) {
    const { names, notes } = headerNames(rows[0]);
    if (notes.empty) warnings.push(txn(notes.empty, "{n} empty column name was replaced with column_N.", "{n} empty column names were replaced with column_N."));
    if (notes.dup) warnings.push(txn(notes.dup, "{n} repeated column name was given a _2, _3 suffix so no value is lost.", "{n} repeated column names were given a _2, _3 suffix so no value is lost."));
    cols = names.length;
    data = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length !== cols) mismatch.push([lines[r], row.length]);
      const obj = {};
      for (let c = 0; c < Math.max(cols, row.length); c++) {
        if (c >= names.length) names.push(`column_${c + 1}`);
        obj[names[c]] = c < row.length ? cell(row[c]) : "";
      }
      data.push(obj);
    }
  } else {
    cols = rows.length ? rows[0].length : 0;
    rows.forEach((row, r) => { if (row.length !== cols) mismatch.push([lines[r], row.length]); });
    data = rows.map((row) => row.map(cell));
  }
  if (mismatch.length) {
    const first = mismatch.slice(0, 3).map(([l, k]) => tx("line {line} has {k}", { line: l, k })).join(", ") + (mismatch.length > 3 ? ", …" : "");
    const base = txn(mismatch.length, "{n} row has a different number of fields than the first row ({cols}): {first}.", "{n} rows have a different number of fields than the first row ({cols}): {first}.", { cols, first });
    warnings.push(header ? base + " " + tx("Missing fields are filled with empty text and extra fields get column_N names.") : base);
  }
  if (kept.zero) warnings.push(txn(kept.zero, "{n} value with a leading zero (such as 007) was kept as text, since they are usually codes or IDs.", "{n} values with a leading zero (such as 007) were kept as text, since they are usually codes or IDs."));
  if (kept.long) warnings.push(txn(kept.long, "{n} number longer than 15 digits was kept as text so it isn't rounded.", "{n} numbers longer than 15 digits were kept as text so they aren't rounded."));
  const json = JSON.stringify(data, null, indent);
  return { json, rows: data.length, cols, delim: d, blank, warnings };
}

function update() {
  const text = area.value;
  warn.hidden = true;
  if (!text.trim()) {
    out.value = "";
    report.textContent = tx("Paste CSV to begin.");
    setStatus(status, "idle");
    $("#copy").disabled = $("#dl").disabled = true;
    return;
  }
  const delimSel = $("#delim").value;
  try {
    const r = csvToJson(text, {
      delim: delimSel, header: $("#header").checked, types: $("#types").checked,
      indent: { "2": "  ", "4": "    ", min: "" }[$("#indent").value],
    });
    out.value = r.json;
    const name = DELIMS[r.delim];
    const parts = [txn(r.rows, "{n} row", "{n} rows"), txn(r.cols, "{n} column", "{n} columns"),
      delimSel === "auto" ? tx("{name} delimiter (detected)", { name }) : tx("{name} delimiter", { name })];
    if (r.blank) parts.push(txn(r.blank, "{n} blank line skipped", "{n} blank lines skipped"));
    report.textContent = parts.join(", ");
    if (r.warnings.length) { warn.hidden = false; warn.textContent = r.warnings.join(" "); }
    setStatus(status, "idle");
    $("#copy").disabled = $("#dl").disabled = false;
  } catch (err) {
    out.value = "";
    report.textContent = "";
    $("#copy").disabled = $("#dl").disabled = true;
    setStatus(status, "error", err.line ? err.message + " " + tx("Check that every opening quote has a matching closing quote.") : tx("This text couldn't be read as CSV."));
  }
}

live(() => area.value, [area, ...controls], update);
wireCopy($("#copy"), () => out.value);
$("#dl").addEventListener("click", () => saveText(out.value, fileBase + ".json", "application/json"));
$("#clear").addEventListener("click", () => { area.value = ""; fileBase = "data"; update(); area.focus(); });

dropzone($("#drop"), {
  accept: ["text/csv", ".csv", "text/plain", ".txt", ".tsv", "text/tab-separated-values"],
  typeLabel: "CSV", maxFileBytes: MAX_BYTES,
  onError: (m) => setStatus(status, "error", m + " " + tx("CSV files up to 10 MB can be opened.")),
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
