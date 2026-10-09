// Shared page wiring for the MikroTik tools: live forms, field errors, row editors, notes and the script well
// (copy and .rsc download). Everything runs in the browser and nothing is sent anywhere.
import { $, $$, el, icon, debounce, copyText, textBlob, announce, tx } from "./core.js?v=11";
import { InputError } from "./roscore.js?v=11";

export { $, $$, el, icon, tx };

let uid = 0;
export const nextId = (prefix) => `${prefix}-${++uid}`;

/* Re-run fn whenever anything inside root changes (debounced for typing), and once now. */
export function live(root, fn, ms = 160) {
  const later = debounce(fn, ms);
  root.addEventListener("input", later);
  root.addEventListener("change", fn);
  fn();
}

/* ------------------------------------------------------------------ field errors */

function errNode(input) {
  const id = (input.id || (input.id = nextId("f"))) + "-err";
  let node = document.getElementById(id);
  if (!node) {
    node = el("p", { class: "ros-err", id, hidden: true });
    const host = input.closest(".field, .ros-cell") || input.parentElement;
    host.append(node);
  }
  return node;
}

/* Collects input problems for one pass over a form. */
export class Checker {
  constructor(root) {
    this.root = root;
    this.count = 0;
    this.first = null;
    for (const n of $$(".ros-err", root)) { n.hidden = true; n.textContent = ""; }
    for (const i of $$('[aria-invalid="true"]', root)) i.removeAttribute("aria-invalid");
  }
  /* Run parse(input.value); on InputError mark the field and return fallback. */
  get(input, parse, fallback = undefined) {
    try {
      return parse(input.value);
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      this.fail(input, e.message);
      return fallback;
    }
  }
  fail(input, msg) {
    const node = errNode(input);
    node.textContent = msg;
    node.hidden = false;
    input.setAttribute("aria-invalid", "true");
    const ids = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    ids.add(node.id);
    input.setAttribute("aria-describedby", [...ids].join(" "));
    this.count++;
    if (!this.first) this.first = input;
  }
  get ok() { return this.count === 0; }
}

/* ------------------------------------------------------------------ notes */

/* notes: [{level: "warn" | "info", text}] rendered as a list; the list hides itself when empty. */
export function showNotes(box, notes) {
  box.textContent = "";
  for (const n of notes) {
    box.append(el("li", { class: "ros-note ros-note--" + (n.level || "info") },
      icon(n.level === "warn" ? "i-alert" : "i-check"),
      el("span", {}, n.text)));
  }
  box.hidden = !notes.length;
}

/* ------------------------------------------------------------------ the script well */

/* out: the readonly textarea; copy / download: buttons; name: file name or a function returning one. */
export function scriptWell({ out, copy, download, name }) {
  copy.addEventListener("click", () => { if (out.value) copyText(out.value, copy); });
  download.addEventListener("click", () => {
    if (!out.value) return;
    const url = URL.createObjectURL(textBlob(out.value, "text/plain"));
    const a = el("a", { href: url, download: typeof name === "function" ? name() : name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    announce(tx("The .rsc file is downloading."));
  });
  return {
    set(text) {
      out.value = text;
      copy.disabled = download.disabled = !text;
      out.classList.toggle("is-empty", !text);
    },
    blocked(n) {
      out.value = "";
      out.placeholder = tx("Fix the highlighted fields to see the script.");
      copy.disabled = download.disabled = true;
      out.classList.add("is-empty");
      return n;
    },
  };
}

/* ------------------------------------------------------------------ row editors */

/* A list of rows the visitor can add to and remove from. makeRow(values) returns the row's cells (an array of
   nodes); the editor wraps them, adds a remove button and calls onChange after any add or remove. */
export function rowEditor({ list, add, makeRow, min = 0, max = 64, onChange = () => {}, label = () => "" }) {
  function refresh() {
    const rows = $$(":scope > .ros-row", list);
    rows.forEach((r, i) => {
      const b = r.querySelector(".ros-row__rm");
      b.disabled = rows.length <= min;
      b.setAttribute("aria-label", tx("Remove row {n}", { n: i + 1 }) + (label(r) ? ` (${label(r)})` : ""));
    });
    add.disabled = rows.length >= max;
  }
  function addRow(values = {}, focus = false) {
    const cells = makeRow(values);
    const rm = el("button", { type: "button", class: "btn btn--sm btn--icon ros-row__rm" }, icon("i-x"));
    const row = el("li", { class: "ros-row" }, el("div", { class: "ros-row__cells" }, ...cells), rm);
    rm.addEventListener("click", () => {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      refresh();
      onChange();
      const f = next && next.querySelector("input, select");
      (f || add).focus();
    });
    list.append(row);
    refresh();
    if (focus) { const f = row.querySelector("input, select"); if (f) f.focus(); }
    return row;
  }
  add.addEventListener("click", () => { addRow({}, true); onChange(); });
  return { addRow, rows: () => $$(":scope > .ros-row", list), clear() { list.textContent = ""; refresh(); } };
}

/* A labelled cell for a row editor. kind: "text" | "select" | "check"; opts.options for selects. */
export function cell(labelText, kind, opts = {}) {
  const id = nextId(opts.prefix || "r");
  let input;
  if (kind === "select") {
    input = el("select", { id, class: opts.cls || "" }, ...(opts.options || []).map(([v, t]) => el("option", { value: v, selected: v === opts.value }, t)));
  } else if (kind === "check") {
    input = el("input", { type: "checkbox", id, checked: !!opts.value, class: opts.cls || "" });
    if (opts.key) input.dataset.k = opts.key;
    return el("div", { class: "ros-cell ros-cell--check" + (opts.wide ? " ros-cell--wide" : "") }, el("label", { class: "check", for: id }, input, labelText));
  } else {
    input = el("input", {
      type: "text", id, value: opts.value ?? "", placeholder: opts.placeholder || "", autocomplete: "off", spellcheck: "false",
      autocapitalize: "off", class: "mono " + (opts.cls || ""), inputmode: opts.inputmode || null,
    });
  }
  if (opts.key) input.dataset.k = opts.key;
  return el("div", { class: "ros-cell" + (opts.wide ? " ros-cell--wide" : "") }, el("label", { for: id }, labelText), input);
}

/* The inputs of a row keyed by data-k. */
export function rowInputs(row) {
  const out = {};
  for (const i of $$("[data-k]", row)) out[i.dataset.k] = i;
  return out;
}

/* Read the value of a radio group. */
export const radio = (name, root = document) => ($(`input[name="${name}"]:checked`, root) || {}).value;
