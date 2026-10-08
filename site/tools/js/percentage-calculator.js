// Percentage calculator: five question forms, each answered live with its formula.
import { $, el, announce, tx } from "./core.js?v=5";
import { parseNum, fmt } from "./calccore.js?v=5";

const f = (n) => fmt(n, 10);

/* Each row returns {value, unit, formula, extra?} or {error}. Inputs are numbers (already parsed). */
const ROWS = [
  {
    id: "p1", inputs: ["p1-a", "p1-b"],
    calc: ([p, whole]) => {
      const v = (p / 100) * whole;
      return { value: f(v), formula: `${f(p)} ÷ 100 × ${f(whole)} = ${f(v)}` };
    },
  },
  {
    id: "p2", inputs: ["p2-a", "p2-b"],
    calc: ([part, whole]) => {
      if (whole === 0) return { error: tx("The second number can't be 0: a share of nothing has no percentage.") };
      const v = (part / whole) * 100;
      return { value: f(v) + "%", formula: `${f(part)} ÷ ${f(whole)} × 100 = ${f(v)}%` };
    },
  },
  {
    id: "p3", inputs: ["p3-a", "p3-b"],
    calc: ([part, p]) => {
      if (p === 0) return { error: tx("The percentage can't be 0: no number has a 0% share equal to that.") };
      const v = part / (p / 100);
      return { value: f(v), formula: `${f(part)} ÷ (${f(p)} ÷ 100) = ${f(v)}` };
    },
  },
  {
    id: "p4", inputs: ["p4-a", "p4-b"],
    calc: ([from, to]) => {
      if (from === 0) return { error: tx("A change from 0 can't be given as a percentage, because it would mean dividing by zero. Compare the plain numbers instead.") };
      const v = ((to - from) / Math.abs(from)) * 100;
      const r = Number(v.toPrecision(10));
      const word = r > 0 ? tx("increase") : r < 0 ? tx("decrease") : tx("no change");
      return {
        value: (r > 0 ? "+" : "") + f(v) + "%",
        extra: word,
        formula: `(${f(to)} − ${f(from)}) ÷ ${from < 0 ? "|" + f(from) + "|" : f(from)} × 100 = ${(r > 0 ? "+" : "") + f(v)}%`,
      };
    },
  },
  {
    id: "p5", inputs: ["p5-a", "p5-b"], extraInputs: ["p5-op"],
    calc: ([x, p]) => {
      const up = $("#p5-op").value === "up";
      const v = x * (1 + (up ? p : -p) / 100);
      const diff = v - x;
      return {
        value: f(v),
        extra: up ? tx("up by {n}", { n: f(Math.abs(diff)) }) : tx("down by {n}", { n: f(Math.abs(diff)) }),
        formula: `${f(x)} × (1 ${up ? "+" : "−"} ${f(p)} ÷ 100) = ${f(v)}`,
      };
    },
  },
];

function render(row) {
  const out = $("#" + row.id + "-out");
  const fields = row.inputs.map((id) => $("#" + id));
  const raw = fields.map((i) => parseNum(i.value));
  fields.forEach((i, k) => i.setAttribute("aria-invalid", Number.isNaN(raw[k]) ? "true" : "false"));
  out.replaceChildren();
  out.classList.remove("is-error");
  if (raw.some((v) => Number.isNaN(v))) {
    out.classList.add("is-error");
    out.append(el("p", { class: "pc__msg" }, tx("Enter numbers only, such as 12, 0.5 or -3.")));
    return;
  }
  if (raw.some((v) => v === null)) {
    out.append(el("p", { class: "pc__empty" }, tx("Enter both numbers to see the answer.")));
    return;
  }
  const r = row.calc(raw);
  if (r.error) {
    out.classList.add("is-error");
    out.append(el("p", { class: "pc__msg" }, r.error));
    return;
  }
  out.append(
    el("p", { class: "pc__res" }, el("span", { class: "visually-hidden" }, tx("Answer:") + " "),
      el("b", { class: "num pc__val", "data-value": "" }, r.value),
      r.extra ? el("span", { class: "pc__extra" }, r.extra) : null),
    el("p", { class: "pc__formula" }, el("span", { class: "visually-hidden" }, tx("Formula:") + " "), el("code", {}, r.formula)));
}

for (const row of ROWS) {
  for (const id of [...row.inputs, ...(row.extraInputs || [])]) {
    const node = $("#" + id);
    node.addEventListener("input", () => render(row));
    node.addEventListener("change", () => render(row));
  }
  render(row);
}

$("#pc-clear").addEventListener("click", () => {
  for (const row of ROWS) {
    for (const id of row.inputs) $("#" + id).value = "";
    render(row);
  }
  $("#p1-a").focus();
  announce(tx("All fields cleared."));
});
