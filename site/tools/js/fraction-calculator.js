// Fraction calculator: exact BigInt arithmetic (ratcore.js) with steps, mixed numbers and repeating decimals.
import { $, $$, el, setStatus, copyText, tx, txn, EN } from "./core.js?v=11";
import { DECIMAL } from "./i18n.js?v=11";
import * as R from "./ratcore.js?v=11";

const A = $("#fc-a"), B = $("#fc-b"), C = $("#fc-c");
const status = $("#status"), res = $("#fc-res");
const mode = () => $('input[name="fc-mode"]:checked').value;
const op = () => $('input[name="fc-op"]:checked').value;
const SYM = { "+": "+", "-": "−", "*": "×", "/": "÷" };
const ft = R.fracText;
let current = null;

function setMode() {
  const calc = mode() === "calc";
  $("#fc-calc").hidden = !calc;
  $("#fc-conv").hidden = calc;
}

function parseField(input) {
  input.setAttribute("aria-invalid", "false");
  try { return R.parseRat(input.value); } catch (e) {
    if (!(e instanceof R.RatError)) throw e;
    input.setAttribute("aria-invalid", "true");
    throw e;
  }
}

/* "n/d" as typed; integers have no slash */
const raw = (p) => ft(p.raw);

function simplifySteps(n, d, steps) {
  const g = R.gcd(n, d);
  if (d === 1n) return;
  if (g > 1n) steps.push(tx("Simplify: the greatest common divisor of {n} and {d} is {g}, so divide both by {g}: {result}.", { n: n < 0n ? -n : n, d, g, result: ft(R.make(n, d)) }));
  else steps.push(tx("{frac} is already in lowest terms (the numerator and denominator share no factor above 1).", { frac: ft({ n, d }) }));
}

function calcSteps(a, b, o, r) {
  const steps = [];
  const an = a.raw.n, ad = a.raw.d, bn = b.raw.n, bd = b.raw.d;
  if (a.kind === "decimal" || a.kind === "repeating") steps.push(tx("{typed} as a fraction is {frac}.", { typed: A.value.trim(), frac: raw(a) }));
  if (b.kind === "decimal" || b.kind === "repeating") steps.push(tx("{typed} as a fraction is {frac}.", { typed: B.value.trim(), frac: raw(b) }));
  if (a.kind === "mixed") steps.push(tx("{typed} as an improper fraction is {frac}.", { typed: A.value.trim(), frac: raw(a) }));
  if (b.kind === "mixed") steps.push(tx("{typed} as an improper fraction is {frac}.", { typed: B.value.trim(), frac: raw(b) }));
  let n, d;
  if (o === "+" || o === "-") {
    const L = R.lcm(ad, bd);
    const x = an * (L / ad), y = bn * (L / bd);
    if (ad === bd) steps.push(tx("Both fractions already have the denominator {d}.", { d: ad }));
    else {
      steps.push(tx("Least common denominator of {a} and {b}: {l}.", { a: ad, b: bd, l: L }));
      steps.push(tx("Rewrite over {l}: {fa} = {x}/{l} and {fb} = {y}/{l}.", { l: L, fa: raw(a), fb: raw(b), x, y }));
    }
    n = o === "+" ? x + y : x - y;
    d = L;
    const yt = y < 0n ? "(" + y + ")" : String(y);
    steps.push(o === "+"
      ? tx("Add the numerators: {x} + {y} = {n}, so the result is {n}/{d}.", { x, y: yt, n, d })
      : tx("Subtract the numerators: {x} − {y} = {n}, so the result is {n}/{d}.", { x, y: yt, n, d }));
  } else if (o === "*") {
    n = an * bn; d = ad * bd;
    steps.push(tx("Multiply the numerators and the denominators: ({an} × {bn}) / ({ad} × {bd}) = {n}/{d}.", { an, bn, ad, bd, n, d }));
  } else {
    const rn = bn < 0n ? -bd : bd, rd = bn < 0n ? -bn : bn;
    steps.push(tx("Dividing by {frac} is multiplying by its reciprocal, {rn}/{rd}.", { frac: raw(b), rn, rd }));
    n = an * rd; d = ad * (rn < 0n ? -rn : rn);
    if (rn < 0n) n = -n;
    steps.push(tx("Cross-multiply: ({an} × {rd}) / ({ad} × {rn}) = {n}/{d}.", { an, rd, ad, rn: rn < 0n ? -rn : rn, n, d }));
  }
  simplifySteps(n, d, steps);
  const m = R.mixedText(r);
  if (m) steps.push(tx("As a mixed number {frac} = {mixed}.", { frac: ft(r), mixed: m }));
  return steps;
}

function convSteps(p, r) {
  const steps = [];
  const typed = C.value.trim();
  const plain = R.plainNumbers(typed.replace(/[−–]/g, "-")).replace(/\s/g, "");
  if (p.kind === "integer") steps.push(tx("A whole number is a fraction over 1: {typed} = {frac}.", { typed, frac: ft(r) }));
  else if (p.kind === "mixed") steps.push(tx("Whole part × denominator + numerator: {typed} = {frac}.", { typed, frac: raw(p) }));
  else if (p.kind === "decimal" && /^[+-]?\d*\.\d+$/.test(plain)) {
    const dec = plain.split(".")[1];
    const num = BigInt(plain.replace(/^[+-]/, "").replace(".", "") || "0") * (plain.startsWith("-") ? -1n : 1n);
    const den = 10n ** BigInt(dec.length);
    steps.push(txn(dec.length, "{n} digit after the point, so write it over 10^{n} = {den}: {num}/{den}.", "{n} digits after the point, so write it over 10^{n} = {den}: {num}/{den}.", { num, den }));
    simplifySteps(num, den, steps);
    return steps;
  } else if (p.kind === "decimal") steps.push(tx("{typed} is exactly {frac}.", { typed, frac: ft(r) }));
  else if (p.kind === "repeating") {
    const m = /^[+-]?(\d*)\.(\d*)\((\d+)\)$/.exec(plain);
    if (m) {
      const a = m[2].length, b = m[3].length;
      const top = BigInt((m[1] || "0") + m[2] + m[3]) - BigInt((m[1] || "0") + m[2]);
      steps.push(tx("Let x = {typed}. Multiply by 10^{ab} and by 10^{a}, then subtract the two: (10^{ab} − 10^{a}) × x = {top}.", { typed: typed.replace(/^[+-]/, ""), ab: a + b, a, top }));
      steps.push(tx("So x = {top}/{bottom}.", { top, bottom: 10n ** BigInt(a) * (10n ** BigInt(b) - 1n) }));
    }
  }
  if (p.kind !== "decimal" || steps.length === 0) simplifySteps(p.raw.n, p.raw.d, steps);
  const m = R.mixedText(r);
  if (m) steps.push(tx("As a mixed number {frac} = {mixed}.", { frac: ft(r), mixed: m }));
  return steps;
}

/* Decimal expansions come from ratcore with "." as the point; show them with the page's own decimal separator. */
const localDecimal = (text) => (EN ? text : text.replace(".", DECIMAL));

function show(r, steps) {
  current = r;
  const dec = R.decimalExpansion(r);
  $("#fc-main").textContent = ft(r);
  $("#fc-simple").textContent = ft(r);
  $("#fc-mixed").textContent = R.mixedText(r) || "–";
  $("#fc-dec").textContent = localDecimal(dec.text);
  $("#fc-dec-note").textContent = dec.truncated
    ? tx("The repeating block is longer than 300 digits, so the decimal is cut off here.")
    : dec.rep ? txn(dec.rep.length, "Digits in brackets repeat forever: {digits}… (the block is {n} digit long).", "Digits in brackets repeat forever: {digits}… (the block is {n} digits long).", { digits: localDecimal(`${dec.int}.${dec.nonrep}${dec.rep}${dec.rep}${dec.rep}`) })
    : tx("This decimal ends; it does not repeat.");
  $("#fc-steps").replaceChildren(...steps.map((s) => el("li", {}, s)));
  res.hidden = false;
}

function update() {
  setStatus(status, "idle");
  res.hidden = true;
  current = null;
  try {
    if (mode() === "calc") {
      const a = parseField(A), b = parseField(B);
      if (!a || !b) return;
      const o = op();
      if (o === "/" && b.r.n === 0n) {
        B.setAttribute("aria-invalid", "true");
        throw new R.RatError(tx("The second value is 0, and dividing by 0 has no answer. Change the second fraction or the operation."));
      }
      const r = o === "+" ? R.add(a.r, b.r) : o === "-" ? R.sub(a.r, b.r) : o === "*" ? R.mul(a.r, b.r) : R.div(a.r, b.r);
      show(r, calcSteps(a, b, o, r));
    } else {
      const p = parseField(C);
      if (!p) return;
      show(p.r, convSteps(p, p.r));
    }
  } catch (e) {
    if (!(e instanceof R.RatError)) throw e;
    setStatus(status, "error", e.message);
  }
}

for (const i of [A, B, C, ...$$('input[name="fc-op"]')]) { i.addEventListener("input", update); i.addEventListener("change", update); }
for (const i of $$('input[name="fc-mode"]')) i.addEventListener("change", () => { setMode(); update(); });
$("#fc-copy").addEventListener("click", (e) => { if (current) copyText(ft(current), e.currentTarget); });
setMode();
update();
