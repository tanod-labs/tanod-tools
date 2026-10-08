// Scientific calculator: keypad and keyboard in front of the expression engine in exprcore.js.
import { $, $$, el, announce, prefs, tx, txn } from "./core.js?v=5";
import { evaluate, CalcError } from "./exprcore.js?v=5";

const input = $("#sc-expr");
const echo = $("#sc-echo"), result = $("#sc-result"), errBox = $("#sc-error"), note = $("#sc-note");
const histList = $("#sc-hist"), histEmpty = $("#sc-hist-empty"), histClear = $("#sc-hist-clear");

let ans = null;         // last committed answer (already rounded to 12 digits)
let fresh = false;      // true right after a calculation, while the input still holds that expression
let lastExpr = "";
const history = [];

const angle = () => $('input[name="sc-angle"]:checked').value;
const saved = prefs.get("sc.angle", "deg");
const savedRadio = $(`input[name="sc-angle"][value="${saved === "rad" ? "rad" : "deg"}"]`);
if (savedRadio) savedRadio.checked = true;

const OPS = "+-−×÷*/^!%";

function clearError() {
  errBox.hidden = true;
  errBox.textContent = "";
  input.setAttribute("aria-invalid", "false");
}

function showPreview() {
  const box = $("#sc-preview");
  if (!input.value.trim()) { box.textContent = ""; return; }
  try {
    const r = evaluate(input.value, { angle: angle(), ans });
    box.textContent = "= " + r.text;
  } catch (_) { box.textContent = ""; }
}

function commit() {
  const src = input.value;
  if (!src.trim()) return;
  clearError();
  note.hidden = true;
  try {
    const r = evaluate(src, { angle: angle(), ans });
    ans = r.value;
    result.textContent = r.text;
    result.dataset.state = "done";
    echo.textContent = r.closed + " =";
    if (r.added) {
      note.hidden = false;
      note.textContent = txn(r.added, "Added {n} closing bracket at the end, so the expression was read as {expr}", "Added {n} closing brackets at the end, so the expression was read as {expr}", { expr: r.closed });
    }
    input.value = r.closed;
    lastExpr = r.closed;
    fresh = true;
    history.unshift({ expr: r.closed, text: r.text });
    if (history.length > 30) history.pop();
    renderHistory();
    $("#sc-preview").textContent = "";
  } catch (e) {
    if (!(e instanceof CalcError)) throw e;
    fresh = false;
    errBox.hidden = false;
    errBox.textContent = e.message;
    echo.textContent = src;
    input.setAttribute("aria-invalid", "true");
    announce(e.message);
  }
}

function renderHistory() {
  histList.replaceChildren(...history.map((h) =>
    el("li", {}, el("button", { type: "button", class: "sc__h", "data-expr": h.expr, "aria-label": tx("Reuse {expr} = {result}", { expr: h.expr, result: h.text }) },
      el("span", { class: "sc__hexpr" }, h.expr), el("span", { class: "sc__hres num" }, "= " + h.text)))));
  histEmpty.hidden = history.length > 0;
  histClear.hidden = history.length === 0;
}

/* Replace the selection (or insert at the caret) with text, applying the "continue from Ans" rule after a result. */
function insert(text, { focus = false } = {}) {
  clearError();
  let v = input.value, a = input.selectionStart ?? v.length, b = input.selectionEnd ?? v.length;
  if (fresh && v === lastExpr) {
    if (OPS.includes(text[0]) && text[0] !== "!" ) v = "Ans";
    else v = "";
    a = b = v.length;
  }
  fresh = false;
  if (text === "e" && /[0-9.)]$/.test(v.slice(0, a))) text = "*e"; // 2e would read as an exponent marker
  input.value = v.slice(0, a) + text + v.slice(b);
  const pos = a + text.length;
  if (focus) input.focus();
  input.setSelectionRange(pos, pos);
  note.hidden = true;
  showPreview();
}

function backspace() {
  clearError();
  fresh = false;
  const v = input.value;
  let a = input.selectionStart ?? v.length, b = input.selectionEnd ?? v.length;
  if (a === b) {
    const m = /(?:[a-z]+\(|Ans)$/i.exec(v.slice(0, a));
    a = m ? a - m[0].length : Math.max(0, a - 1);
  }
  input.value = v.slice(0, a) + v.slice(b);
  input.setSelectionRange(a, a);
  showPreview();
}

function clearAll() {
  input.value = "";
  fresh = false;
  clearError();
  note.hidden = true;
  echo.textContent = "";
  result.textContent = "0";
  result.dataset.state = "idle";
  $("#sc-preview").textContent = "";
  input.focus();
  announce(tx("Cleared."));
}

const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
$$(".sc__pad .sc__k, .sc__morepad .sc__k").forEach((b) => {
  b.addEventListener("click", () => {
    const act = b.dataset.act;
    if (act === "eval") commit();
    else if (act === "clear") clearAll();
    else if (act === "back") backspace();
    else insert(b.dataset.ins.replace("−", "-").replace("×", "*").replace("÷", "/"), { focus: fine });
  });
});

input.addEventListener("beforeinput", (ev) => {
  if (ev.inputType !== "insertText" && ev.inputType !== "insertFromPaste") return;
  const data = ev.data ?? "";
  if (!data) return;
  if (data.endsWith("=")) {
    ev.preventDefault();
    if (data.length > 1) insert(data.slice(0, -1));
    commit();
    return;
  }
  if (fresh && input.value === lastExpr) {
    ev.preventDefault();
    insert(data);
  }
});
input.addEventListener("input", () => {
  if (fresh && input.value !== lastExpr) fresh = false;
  clearError();
  note.hidden = true;
  showPreview();
});
input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); commit(); }
  else if (ev.key === "Escape") { ev.preventDefault(); clearAll(); }
});

for (const r of $$('input[name="sc-angle"]')) {
  r.addEventListener("change", () => {
    prefs.set("sc.angle", angle());
    showPreview();
    announce(angle() === "deg" ? tx("Angles are in degrees.") : tx("Angles are in radians."));
  });
}

histList.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-expr]");
  if (!b) return;
  input.value = b.dataset.expr;
  fresh = false;
  clearError();
  note.hidden = true;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  showPreview();
});
histClear.addEventListener("click", () => { history.length = 0; renderHistory(); announce(tx("History cleared.")); input.focus(); });

renderHistory();
