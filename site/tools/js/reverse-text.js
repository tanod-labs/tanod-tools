import { $, live, openTextFile, wireCopy, downloadButton, announce, fmtInt, normalizeNewlines, tx, txn } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const modes = Array.from(document.querySelectorAll('input[name="mode"]'));

const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
/* Visible characters (grapheme clusters), so emoji sequences and combining accents stay whole. */
const chars = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));
const flip = (s) => chars(s).reverse().join("");

export function reverse(raw, mode) {
  const text = normalizeNewlines(raw);
  switch (mode) {
    case "words": return text.split("\n").map((l) => l.split(/(\s+)/).reverse().join("")).join("\n");
    case "each": return text.split("\n").map((l) => l.split(/(\s+)/).map((t) => (/^\s*$/.test(t) ? t : flip(t))).join("")).join("\n");
    case "lines": return text.split("\n").reverse().join("\n");
    default: return flip(text);
  }
}

export function isPalindrome(text) {
  const core = text.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  return core.length >= 2 && core === flip(core);
}

function update() {
  const mode = modes.find((m) => m.checked).value;
  out.value = reverse(area.value, mode);
  const has = !!area.value;
  let msg = tx("Type text to begin.");
  if (has) {
    const n = chars(area.value).length;
    msg = txn(n, "{n} character reversed.", "{n} characters reversed.");
    if (mode === "lines") { const l = normalizeNewlines(area.value).split("\n").length; msg = txn(l, "{n} line in reverse order.", "{n} lines in reverse order."); }
    if (mode === "words") msg = tx("Word order reversed on each line.");
    if (mode === "each") msg = tx("Each word spelled backwards.");
    if (isPalindrome(area.value)) msg += " " + tx("It reads the same both ways: a palindrome.");
  }
  $("#report").textContent = msg;
  $("#copy").disabled = $("#dl").disabled = $("#use").disabled = $("#clear").disabled = !has;
}

live(() => area.value, [area, ...modes], update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "reversed-text.txt"), { id: "dl" }));
$("#use").addEventListener("click", () => { area.value = out.value; update(); announce(tx("Result moved into the input.")); });
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
