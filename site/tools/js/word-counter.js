import { $, el, live, openTextFile, fmtInt, fmtDec, fmtPct, tx, wireCopy, setStatus, announce } from "./textcore.js?v=11";
import { analyse, readability, easeLabel, density, fmtTime } from "./wordcore.js?v=11";

const area = $("#text");
const status = $("#status");
const stopToggle = $("#stop");
const phraseRadios = Array.from(document.querySelectorAll('input[name="ngram"]'));

const set = (id, v) => { $(id).textContent = v; };

function update() {
  const a = analyse(area.value);
  set("#c-words", fmtInt(a.nWords));
  set("#c-chars", fmtInt(a.chars));
  set("#c-nospace", fmtInt(a.charsNoSpace));
  set("#c-sent", fmtInt(a.sentences));
  set("#c-para", fmtInt(a.paragraphs));
  set("#c-lines", fmtInt(a.lines));
  set("#c-read", fmtTime(a.nWords / 238 * 60));
  set("#c-speak", fmtTime(a.nWords / 150 * 60));
  set("#c-avg", a.nWords ? fmtDec(a.avg) : "0");
  set("#bar-words", fmtInt(a.nWords));
  set("#bar-chars", fmtInt(a.chars));
  set("#bar-read", fmtTime(a.nWords / 238 * 60));
  const r = readability(a);
  $("#read-box").hidden = !r;
  $("#read-note").hidden = !!r;
  if (r) {
    set("#r-ease", fmtDec(r.ease));
    set("#r-ease-l", easeLabel(r.ease));
    set("#r-grade", fmtDec(Math.max(0, r.grade)));
  }
  $("#clear").disabled = $("#copy").disabled = !area.value;
  renderDensity(a);
}

function renderDensity(a) {
  const n = Number(phraseRadios.find((r) => r.checked).value);
  const body = $("#dens-body");
  const { rows, total } = density(a.words, n, stopToggle.checked);
  body.replaceChildren();
  if (!rows.length) {
    body.append(el("tr", {}, el("td", { colspan: "3", class: "dens__empty" },
      a.nWords ? (n === 1 ? tx("No keywords to show.") : tx("No phrase of this length repeats.")) : tx("Type or paste text to see keywords."))));
    return;
  }
  const top = rows[0][1];
  for (const [k, c] of rows) {
    body.append(el("tr", {},
      el("th", { scope: "row" }, k),
      el("td", { class: "num" }, fmtInt(c)),
      el("td", {}, el("span", { class: "dens__bar" }, el("i", { style: `width:${Math.max(4, Math.round(c / top * 100))}%` })),
        el("span", { class: "num dens__pct" }, fmtPct(c / total)))));
  }
}

live(() => area.value, [area, stopToggle, ...phraseRadios], update);

wireCopy($("#copy"), () => area.value);
$("#clear").addEventListener("click", () => {
  area.value = "";
  update();
  area.focus();
  announce(tx("Text cleared."));
});
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
