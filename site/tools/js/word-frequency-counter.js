// Word frequency counter: most common words and 2-3 word phrases. The counting is in wordfreqcore.js (no DOM).
import { $, el, tx, txn, setStatus, copyText, announce, textBlob } from "./core.js?v=11";
import { LANG, fmtNum } from "./i18n.js?v=11";
import { frequencies, frequencyCsv, STOP_LANGS } from "./wordfreqcore.js?v=11";

const input = $("#wf-in"), res = $("#wf-res");
/* stop-word languages are named in their own language, so they need no translation */
const NAMES = { en: "English", es: "Español", fr: "Français", de: "Deutsch", "pt-BR": "Português", it: "Italiano", id: "Bahasa Indonesia",
  tr: "Türkçe", vi: "Tiếng Việt", ru: "Русский", pl: "Polski", hi: "हिन्दी" };
for (const code of STOP_LANGS) $("#wf-stop").append(el("option", { value: code }, NAMES[code]));
const n = () => Number(document.querySelector('input[name="wf-n"]:checked').value);
let last = null;

const pct = (v) => fmtNum(v / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function render() {
  const text = input.value;
  $("#wf-clear").disabled = !text;
  setStatus($("#status"), "idle");
  const f = frequencies(text, { lang: $("#wf-stop").value, n: n(), numbers: $("#wf-num").checked });
  last = f;
  $("#wf-th").textContent = n() === 1 ? tx("Word") : tx("Phrase");
  if (!text.trim() || !f.words) {
    res.hidden = true;
    $("#wf-report").textContent = text.trim() ? tx("No words found in this text.") : tx("Paste text to begin.");
    return;
  }
  const top = Number($("#wf-top").value);
  const shown = top ? f.rows.slice(0, top) : f.rows;
  $("#wf-words").textContent = fmtNum(f.words);
  $("#wf-total").textContent = fmtNum(f.total);
  $("#wf-unique").textContent = fmtNum(f.unique);
  $("#wf-report").textContent = f.rows.length
    ? tx("Showing {shown} of {all}.", { shown: fmtNum(shown.length), all: fmtNum(f.rows.length) })
    : tx("Everything was left out by the options you chose.");
  const body = $("#wf-rows");
  body.textContent = "";
  const frag = document.createDocumentFragment();
  shown.forEach((r, i) => frag.append(el("tr", {}, el("td", {}, fmtNum(i + 1)), el("td", {}, r.phrase), el("td", {}, fmtNum(r.count)), el("td", {}, pct(r.pct)))));
  body.append(frag);
  $("#wf-copy").disabled = $("#wf-csv").disabled = !f.rows.length;
  res.hidden = false;
}

for (const sel of ["#wf-in", "#wf-stop", "#wf-top", "#wf-num"]) {
  $(sel).addEventListener("input", render);
  $(sel).addEventListener("change", render);
}
for (const r of document.querySelectorAll('input[name="wf-n"]')) r.addEventListener("change", render);
$("#wf-clear").addEventListener("click", () => { input.value = ""; render(); input.focus(); });
$("#wf-copy").addEventListener("click", () => {
  const top = Number($("#wf-top").value);
  const rows = top ? last.rows.slice(0, top) : last.rows;
  copyText(rows.map((r) => r.phrase + "\t" + r.count).join("\n"), $("#wf-copy"));
});
$("#wf-csv").addEventListener("click", () => {
  const url = URL.createObjectURL(textBlob(String.fromCharCode(0xfeff) + frequencyCsv(last.rows), "text/csv"));
  const a = el("a", { href: url, download: "word-frequency.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});
$("#wf-example").addEventListener("click", () => {
  input.value = "The quick brown fox jumps over the lazy dog. The dog sleeps, and the fox runs away. A quick fox is a happy fox, and a lazy dog is a happy dog too.";
  render();
  announce(tx("Example loaded."));
});
render();
