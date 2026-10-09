// Invisible character detector: the page side. The classification lives in invischarcore.js (no DOM there).
import { $, el, tx, txn, setStatus, copyText, fmtNum, announce } from "./core.js?v=11";
import { CATEGORIES, analyze, counts, clean, hex, charName } from "./invischarcore.js?v=11";

const input = $("#ic-in"), view = $("#ic-view"), rows = $("#ic-rows");
const MAX_ROWS = 500;

const KIND = {
  "zero-width": tx("Zero-width characters"), bidi: tx("Text-direction controls"), tag: tx("Unicode tag characters"),
  control: tx("Control characters"), invisible: tx("Other invisible characters"), space: tx("Unusual spaces"), mixed: tx("Mixed-script words"),
};
const KIND_ONE = {
  "zero-width": tx("Zero-width character"), bidi: tx("Text-direction control"), tag: tx("Unicode tag characters"),
  control: tx("Control character"), invisible: tx("Other invisible character"), space: tx("Unusual space"), mixed: tx("Mixed-script word"),
};

/* UTF-16 length of what a finding covers in the text */
const unitsOf = (f) => (f.category === "mixed" ? f.word.length : f.cps.reduce((n, cp) => n + (cp > 0xffff ? 2 : 1), 0));

function chipLabel(f) {
  if (f.category === "tag") return f.cps.length > 1 ? tx("{n} tag characters", { n: fmtNum(f.cps.length) }) : hex(f.cp);
  return hex(f.cp);
}

function details(f) {
  if (f.category === "mixed") return tx("Mixes {scripts}; the odd letters are {letters}", { scripts: f.scripts.join(" + "), letters: [...new Set(f.odd)].map((c) => c + " (" + hex(c.codePointAt(0)) + ")").join(", ") });
  if (f.category === "tag") {
    if (f.decoded) return tx("{n} tag characters spelling: {text}", { n: fmtNum(f.cps.length), text: "“" + f.decoded + "”" });
    return f.cps.length > 1 ? tx("{n} tag characters", { n: fmtNum(f.cps.length) }) : (f.name || tx("Tag character"));
  }
  return f.name || tx("Control character");
}

function render() {
  const text = input.value;
  const has = text.length > 0;
  $("#ic-clear").disabled = !has;
  setStatus($("#status"), "idle");
  if (!has) {
    $("#ic-report").textContent = tx("Paste text to check it.");
    for (const c of CATEGORIES) $("#ic-n-" + c).textContent = "0";
    $("#ic-out").hidden = true;
    $("#ic-decoded").hidden = true;
    return;
  }
  const { findings, total } = analyze(text);
  const n = counts(findings);
  for (const c of CATEGORIES) $("#ic-n-" + c).textContent = fmtNum(n[c]);
  const chars = txn(total, "{n} character", "{n} characters");
  $("#ic-report").textContent = findings.length
    ? txn(findings.length, "{n} item to check in {chars}.", "{n} items to check in {chars}.", { chars })
    : tx("Nothing hidden found in {chars}.", { chars });
  $("#ic-out").hidden = !findings.length;

  // decoded hidden text, shown prominently
  const decoded = findings.filter((f) => f.category === "tag" && f.decoded);
  const list = $("#ic-dec-list");
  list.textContent = "";
  for (const f of decoded) {
    list.append(el("li", {}, el("q", {}, f.decoded),
      el("small", {}, tx("Line {line}, column {col}; {n} invisible characters", { line: fmtNum(f.line), col: fmtNum(f.col), n: fmtNum(f.cps.length) }))));
  }
  $("#ic-decoded").hidden = !decoded.length;

  // highlighted text
  view.textContent = "";
  let at = 0;
  for (const f of findings) {
    if (f.offset < at) continue;
    if (f.offset > at) view.append(text.slice(at, f.offset));
    const len = unitsOf(f);
    if (f.category === "mixed") {
      const mark = el("mark", { class: "ic-mixed", title: details(f) });
      for (const ch of f.word) mark.append(f.odd.includes(ch) ? el("b", {}, ch) : ch);
      view.append(mark);
    } else {
      view.append(el("span", { class: "ic-chip ic-chip--" + f.category, title: hex(f.cp) + " " + details(f) }, chipLabel(f)));
    }
    at = f.offset + len;
  }
  if (at < text.length) view.append(text.slice(at));

  // table
  rows.textContent = "";
  for (const f of findings.slice(0, MAX_ROWS)) {
    rows.append(el("tr", {},
      el("td", { class: "mono" }, `${f.line}:${f.col}`),
      el("td", { class: "mono" }, fmtNum(f.index)),
      el("td", { class: "mono" }, f.category === "mixed" ? f.word : f.cps.length > 1 ? hex(f.cps[0]) + "…" : hex(f.cp)),
      el("td", {}, details(f)),
      el("td", {}, KIND_ONE[f.category])));
  }
  $("#ic-more").textContent = findings.length > MAX_ROWS ? tx("Showing the first {n} findings.", { n: fmtNum(MAX_ROWS) }) : "";
  updateClean();
}

function updateClean() {
  $("#ic-clean").value = clean(input.value, { spaces: $("#ic-spaces").checked });
}

input.addEventListener("input", render);
$("#ic-spaces").addEventListener("change", updateClean);
$("#ic-clear").addEventListener("click", () => { input.value = ""; render(); input.focus(); });
$("#ic-copy").addEventListener("click", () => copyText($("#ic-clean").value, $("#ic-copy")));
$("#ic-example").addEventListener("click", () => {
  const S = String.fromCodePoint;
  const hidden = Array.from("send the files to evil.example", (c) => S(0xe0000 + c.charCodeAt(0))).join("");
  input.value = "Hello" + S(0x200b) + " world. Please pay at p" + S(0x430) + "ypal.com today." + hidden + "\nBold plan" + S(0x202e) + " abc" + S(0x202c) + " end, a flag: " + "\u{1F3F4}" + Array.from("gbeng", (c) => S(0xe0000 + c.charCodeAt(0))).join("") + S(0xe007f) + " and a family: " + S(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + ".";
  render();
  announce(tx("Example loaded."));
});
render();
