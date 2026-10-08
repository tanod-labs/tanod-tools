import { $, el, live, openTextFile, wireCopy, downloadButton, setStatus, announce, normalizeNewlines, tx } from "./textcore.js?v=5";

const area = $("#text");
const status = $("#status");
const undoBtn = $("#undo");

const SMALL = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "of", "in"]);
const TOKEN = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

const cap = (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1);

function titleLine(line) {
  const toks = line.match(TOKEN) || [];
  let i = 0;
  return line.replace(TOKEN, (w) => {
    const lw = w.toLocaleLowerCase();
    const first = i === 0, last = i === toks.length - 1;
    i++;
    return (!first && !last && SMALL.has(lw)) ? lw : cap(lw);
  });
}

function sentenceCase(text) {
  const lower = text.toLocaleLowerCase();
  let out = "", start = true;
  for (const ch of lower) {
    if (start && /[\p{L}]/u.test(ch)) { out += ch.toLocaleUpperCase(); start = false; continue; }
    out += ch;
    if (/[.!?\n]/.test(ch)) start = true;
    else if (/[\p{L}\p{N}]/u.test(ch)) start = false;
  }
  return out.replace(/\bi\b(?=['’ ,.;!?]|$)/gm, "I");
}

function wordsOf(line) {
  return line
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .match(/[\p{L}\p{N}\p{M}]+/gu) || [];
}
const perLine = (fn) => (text) => text.split("\n").map(fn).join("\n");

export const MODES = {
  upper: (t) => t.toLocaleUpperCase(),
  lower: (t) => t.toLocaleLowerCase(),
  title: perLine(titleLine),
  sentence: sentenceCase,
  camel: perLine((l) => wordsOf(l).map((w, i) => i ? cap(w.toLocaleLowerCase()) : w.toLocaleLowerCase()).join("")),
  pascal: perLine((l) => wordsOf(l).map((w) => cap(w.toLocaleLowerCase())).join("")),
  snake: perLine((l) => wordsOf(l).map((w) => w.toLocaleLowerCase()).join("_")),
  kebab: perLine((l) => wordsOf(l).map((w) => w.toLocaleLowerCase()).join("-")),
  constant: perLine((l) => wordsOf(l).map((w) => w.toLocaleUpperCase()).join("_")),
  alternating: (t) => { let i = 0; let out = ""; for (const ch of t) { if (/\p{L}/u.test(ch)) { out += i % 2 ? ch.toLocaleUpperCase() : ch.toLocaleLowerCase(); i++; } else out += ch; } return out; },
  inverse: (t) => { let out = ""; for (const ch of t) { const u = ch.toLocaleUpperCase(), l = ch.toLocaleLowerCase(); out += ch === u && u !== l ? l : ch === l && u !== l ? u : ch; } return out; },
};
const NAMES = {
  upper: tx("UPPER CASE"), lower: tx("lower case"), title: tx("Title Case"), sentence: tx("Sentence case"), camel: "camelCase",
  pascal: "PascalCase", snake: "snake_case", kebab: "kebab-case", constant: "CONSTANT_CASE", alternating: tx("aLtErNaTiNg"), inverse: tx("iNVERSE"),
};

let history = [];
const updateButtons = () => {
  const has = !!area.value;
  document.querySelectorAll("[data-mode]").forEach((b) => { b.disabled = !has; });
  $("#copy").disabled = $("#dl").disabled = $("#clear").disabled = !has;
  undoBtn.disabled = !history.length;
};

document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  const mode = b.dataset.mode;
  const before = area.value;
  area.value = MODES[mode](normalizeNewlines(before));
  if (area.value !== before) { history.push(before); if (history.length > 20) history.shift(); }
  updateButtons();
  const msg = tx("Converted to {name}.", { name: NAMES[mode] });
  setStatus(status, "done", msg);
  announce(msg);
}));
undoBtn.addEventListener("click", () => {
  if (!history.length) return;
  area.value = history.pop();
  updateButtons();
  setStatus(status, "idle");
  announce(tx("Undone."));
});
area.addEventListener("input", () => { updateButtons(); setStatus(status, "idle"); });
$("#clear").addEventListener("click", () => { area.value = ""; history = []; updateButtons(); setStatus(status, "idle"); area.focus(); });
wireCopy($("#copy"), () => area.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => area.value, "converted-text.txt"), { id: "dl" }));
openTextFile($("#drop"), status, (text) => { area.value = text; history = []; updateButtons(); });
void el; void live;
updateButtons();
