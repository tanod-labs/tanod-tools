// Markdown table generator: an editable grid that writes a GitHub-flavored Markdown table. Parsing and writing are in mdtablecore.js.
import { $, el, tx, setStatus, copyText, announce, fmtNum } from "./core.js?v=11";
import { parseDelimited, detectDelimiter, looksLikeMarkdownTable, parseMarkdownTable, normalize, toMarkdown, addRow, removeRow, addColumn, removeColumn } from "./mdtablecore.js?v=11";

const grid = $("#mt-grid"), out = $("#mt-out"), status = $("#status");
const MAX_CELLS = 20000;
const DELIMS = { tab: "\t", comma: ",", semicolon: ";", pipe: "|" };
let rows = [["Item", "Qty", "Price"], ["Apples", "3", "1.50"], ["Pears", "12", "0.80"]];
let aligns = ["left", "right", "right"];

const ALIGN_NAMES = () => [["none", tx("Default")], ["left", tx("Left")], ["center", tx("Centre")], ["right", tx("Right")]];

function writeOutput() {
  out.value = toMarkdown(rows, aligns, { pad: $("#mt-pad").checked });
  $("#mt-report").textContent = tx("Table size: {rows} rows by {cols} columns", { rows: fmtNum(rows.length), cols: fmtNum(aligns.length) });
}

function cellInput(r, c) {
  const input = el("input", {
    type: "text", value: rows[r][c], autocomplete: "off", spellcheck: "false",
    "aria-label": r === 0 ? tx("Header, column {col}", { col: c + 1 }) : tx("Row {row}, column {col}", { row: r, col: c + 1 }),
  });
  input.dataset.r = r; input.dataset.c = c;
  input.addEventListener("input", () => { rows[r][c] = input.value; writeOutput(); });
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData && e.clipboardData.getData("text");
    if (!text || !/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return; // a plain single value pastes normally
    e.preventDefault();
    fillFrom(r, c, parseDelimited(text.replace(/\r?\n$/, ""), "\t"));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const next = grid.querySelector(`input[data-r="${r + 1}"][data-c="${c}"]`);
      if (next) next.focus(); else { rows = addRow(rows); build(); focusCell(rows.length - 1, c); }
    }
  });
  return input;
}

function focusCell(r, c) {
  const i = grid.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
  if (i) i.focus();
}

/* paste a block of cells with its top left corner at (r, c), growing the grid when needed */
function fillFrom(r, c, block) {
  const width = Math.max(aligns.length, c + Math.max(...block.map((b) => b.length)));
  const height = Math.max(rows.length, r + block.length);
  if (width * height > MAX_CELLS) return setStatus(status, "error", tx("That table is too large (more than {n} cells).", { n: fmtNum(MAX_CELLS) }));
  const t = normalize(rows, aligns);
  rows = t.rows.map((row) => row.concat(Array(width - row.length).fill("")));
  aligns = t.aligns.concat(Array(width - t.aligns.length).fill("none"));
  while (rows.length < height) rows.push(Array(width).fill(""));
  block.forEach((line, i) => line.forEach((v, j) => { rows[r + i][c + j] = v; }));
  setStatus(status, "idle");
  build();
  announce(tx("Pasted {n} cells.", { n: fmtNum(block.reduce((n, l) => n + l.length, 0)) }));
}

function build() {
  grid.textContent = "";
  const ctl = el("tr", { class: "is-ctl" });
  aligns.forEach((a, c) => {
    const sel = el("select", { "aria-label": tx("Alignment of column {col}", { col: c + 1 }) });
    for (const [v, label] of ALIGN_NAMES()) sel.append(el("option", { value: v, selected: v === a }, label));
    sel.addEventListener("change", () => { aligns[c] = sel.value; writeOutput(); });
    const rm = el("button", { type: "button", class: "btn btn--sm btn--quiet mt-x", "aria-label": tx("Remove column {col}", { col: c + 1 }), disabled: aligns.length < 2 }, "×");
    rm.addEventListener("click", () => { ({ rows, aligns } = removeColumn(rows, aligns, c)); build(); });
    ctl.append(el("td", {}, el("div", { class: "mt-ctl-col" }, sel, rm)));
  });
  ctl.append(el("td", {}));
  grid.append(ctl);
  rows.forEach((row, r) => {
    const tr = el("tr", { class: r === 0 ? "is-head" : "" });
    row.forEach((_, c) => tr.append(el("td", {}, cellInput(r, c))));
    const rm = el("button", { type: "button", class: "btn btn--sm btn--quiet mt-x", "aria-label": r === 0 ? tx("Remove the header row") : tx("Remove row {row}", { row: r }), disabled: rows.length < 2 }, "×");
    rm.addEventListener("click", () => { rows = removeRow(rows, r); build(); });
    tr.append(el("td", {}, rm));
    grid.append(tr);
  });
  writeOutput();
}

function importText() {
  const text = $("#mt-paste").value;
  if (!text.trim()) return;
  let t;
  if (looksLikeMarkdownTable(text)) t = parseMarkdownTable(text);
  else {
    const d = $("#mt-delim").value;
    const delim = d === "auto" ? detectDelimiter(text) : DELIMS[d];
    const parsed = parseDelimited(text, delim);
    if (!parsed.length) return;
    t = normalize(parsed, []);
  }
  if (t.rows.length * t.aligns.length > MAX_CELLS) return setStatus(status, "error", tx("That table is too large (more than {n} cells).", { n: fmtNum(MAX_CELLS) }));
  setStatus(status, "idle");
  rows = t.rows; aligns = t.aligns;
  build();
  announce(tx("The grid now has {rows} rows and {cols} columns.", { rows: fmtNum(rows.length), cols: fmtNum(aligns.length) }));
}

$("#mt-paste").addEventListener("input", () => { $("#mt-import").disabled = !$("#mt-paste").value.trim(); });
$("#mt-import").addEventListener("click", importText);
$("#mt-add-row").addEventListener("click", () => { rows = addRow(rows); build(); focusCell(rows.length - 1, 0); });
$("#mt-add-col").addEventListener("click", () => { ({ rows, aligns } = addColumn(rows, aligns)); build(); focusCell(0, aligns.length - 1); });
$("#mt-clear").addEventListener("click", () => { rows = [["", ""], ["", ""]]; aligns = ["none", "none"]; build(); focusCell(0, 0); });
$("#mt-pad").addEventListener("change", writeOutput);
$("#mt-copy").addEventListener("click", () => copyText(out.value, $("#mt-copy")));
build();
