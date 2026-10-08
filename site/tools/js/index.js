// Tools index: search-as-you-type filter over the category boards.
import { $, $$, txn, tx } from "./core.js?v=5";

const input = $("#find");
const count = $("#find-count");
const rows = $$(".stops li");
const routes = $$(".route");

function norm(s) { return s.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[^\w\s]/g, " "); }

function apply() {
  const terms = norm(input.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const li of rows) {
    const words = li.dataset.words || "";
    const hit = terms.every((t) => words.includes(t));
    li.hidden = !hit;
    if (hit) shown++;
  }
  for (const r of routes) r.classList.toggle("is-empty", !r.querySelector(".stops li:not([hidden])"));
  count.textContent = !terms.length ? "" : shown ? txn(shown, "{n} tool match", "{n} tools match") : tx("No tool matches that. Try a shorter word, like pdf, image or text.");
}

input.addEventListener("input", apply);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = $(".stops li:not([hidden]) a");
    if (first) { e.preventDefault(); first.click(); }
  } else if (e.key === "Escape" && input.value) {
    input.value = "";
    apply();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    input.focus();
  }
});
if (input.value) apply();
