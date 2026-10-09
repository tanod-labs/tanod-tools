// Expression engine for the scientific calculator: tokenizer, Pratt-style parser, AST, evaluator.
// No eval and no Function constructor: the text is turned into a tree and the tree is walked.
//
// Rules (also described on the page):
//   precedence, loosest to tightest:  + -   <   * / ÷ and implicit multiplication   <   unary + -   <   ^ (right-associative)   <   ! and %
//   so  -2^2 = -4,  2^-1 = 0.5,  2^3^2 = 512,  6/2(1+2) = 9  (implicit multiplication ranks with × and ÷, left to right)
//   % always means "divide by 100":  50% = 0.5,  200*10% = 20,  200+10% = 200.1
//   n! is defined for whole numbers 0..170;  numbers take no thousands commas;  1e-3 is an exponent, 2*e is Euler's number.

import { tx } from "./i18n.js?v=11";

export class CalcError extends Error {}
const fail = (msg) => { throw new CalcError(msg); };

const FUNCS = {
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1,
  ln: 1, log: 1, log2: 1, sqrt: 1, cbrt: 1, abs: 1, exp: 1, floor: 1, ceil: 1, round: 1,
};
const CONSTS = { pi: Math.PI, e: Math.E };
const PRETTY = { "*": "×", "/": "÷", "-": "−" };

/* ------------------------------------------------------------------ tokenizer */

export function tokenize(src) {
  const toks = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) fail(tx("A lone \".\" isn't a number. Type digits such as 0.5 or .5."));
      const text = m[0];
      if (s[i + text.length] === ".") fail(tx("\"{text}\" has two decimal points.", { text: /^[\d.]+/.exec(s.slice(i))[0] }));
      toks.push({ t: "num", v: Number(text), text, pos: i });
      i += text.length;
      continue;
    }
    if (c === "," ) fail(tx("Commas aren't accepted. Write 1000, not 1,000, and use a decimal point for decimals."));
    if (c === "π") { toks.push({ t: "id", v: "pi", pos: i }); i++; continue; }
    if (c === "√") { toks.push({ t: "id", v: "sqrt", pos: i }); i++; continue; }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(i));
      // names are letters, optionally ending in digits (log2); digits after another letter run would be a number
      let name = m[0].toLowerCase();
      if (!(name in FUNCS) && !(name in CONSTS) && name !== "ans") {
        const letters = /^[A-Za-z]+/.exec(s.slice(i))[0].toLowerCase();
        name = letters;
        toks.push({ t: "id", v: name, pos: i });
        i += letters.length;
        continue;
      }
      toks.push({ t: "id", v: name, pos: i });
      i += m[0].length;
      continue;
    }
    const op = { "+": "+", "-": "-", "−": "-", "–": "-", "*": "*", "×": "*", "·": "*", "/": "/", "÷": "/", "^": "^", "!": "!", "%": "%", "(": "(", ")": ")" }[c];
    if (!op) fail(tx("\"{c}\" isn't something this calculator understands.", { c }));
    toks.push({ t: "op", v: op, pos: i });
    i++;
  }
  return toks;
}

/* ------------------------------------------------------------------ parser */

const startsOperand = (tk) => tk && (tk.t === "num" || tk.t === "id" || (tk.t === "op" && tk.v === "("));
const show = (tk) => (tk ? (tk.t === "num" ? tk.text : tk.t === "id" ? tk.v : PRETTY[tk.v] || tk.v) : "the end");

export function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  let depth = 0;
  const enter = () => { if (++depth > 200) fail(tx("That expression is nested too deeply.")); };
  const leave = () => { depth--; };

  function expr() {
    enter();
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      left = { k: "bin", op, l: left, r: term() };
    }
    leave();
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = toks[p++].v;
        left = { k: "bin", op, l: left, r: unary() };
      } else if (startsOperand(peek())) {
        const prev = toks[p - 1];
        if (peek().t === "num" && prev.t === "num") fail(tx("Two numbers in a row ({a} {b}). Put an operator between them.", { a: prev.text, b: peek().text }));
        left = { k: "bin", op: "*", l: left, r: unary(), implicit: true };
      } else return left;
    }
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      const op = toks[p++].v;
      enter();
      const arg = unary();
      leave();
      return op === "-" ? { k: "neg", a: arg } : arg;
    }
    return power();
  }
  function power() {
    let base = postfix();
    if (isOp("^")) {
      p++;
      enter();
      const exp = unary(); // right-associative, and 2^-1 works
      leave();
      base = { k: "bin", op: "^", l: base, r: exp };
    }
    return base;
  }
  function postfix() {
    let node = primary();
    while (isOp("!") || isOp("%")) {
      node = { k: toks[p++].v === "!" ? "fact" : "pct", a: node };
    }
    return node;
  }
  function primary() {
    const tk = peek();
    if (!tk) fail(tx("The expression ends too soon. It needs a number or bracket here."));
    if (tk.t === "num") { p++; return { k: "num", v: tk.v, text: tk.text }; }
    if (tk.t === "id") {
      p++;
      if (tk.v === "ans") return { k: "ans" };
      if (tk.v in CONSTS) return { k: "num", v: CONSTS[tk.v], name: tk.v };
      if (tk.v in FUNCS) {
        if (!isOp("(")) fail(tx("{name} needs brackets around its input, for example {name}(30).", { name: tk.v }));
        p++;
        enter();
        const arg = expr();
        leave();
        if (!isOp(")")) fail(tx("Missing \")\" after {name}(…).", { name: tk.v }));
        p++;
        return { k: "fn", name: tk.v, a: arg };
      }
      fail(tx("\"{name}\" isn't a function or constant here. Known names: pi, e, Ans, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, ln, log, log2, sqrt, cbrt, abs, exp, floor, ceil, round.", { name: tk.v }));
    }
    if (tk.v === "(") {
      p++;
      enter();
      const inner = expr();
      leave();
      if (!isOp(")")) fail(tx("A bracket is not closed."));
      p++;
      return inner;
    }
    if (tk.v === ")") {
      const prev = toks[p - 1];
      if (prev && prev.t === "op" && prev.v === "(") fail(tx("Empty brackets: put a number or expression between ( and )."));
      if (prev && prev.t === "op" && prev.v !== ")" && prev.v !== "!" && prev.v !== "%") fail(tx("A number is missing between {op} and ).", { op: PRETTY[prev.v] || prev.v }));
      fail(tx("Unexpected \")\": there is no open bracket to close."));
    }
    fail(tx("{op} can't go here. An expression needs a number, constant or bracket in this position.", { op: PRETTY[tk.v] || tk.v }));
  }

  const tree = expr();
  if (p < toks.length) {
    const tk = toks[p];
    if (tk.t === "op" && tk.v === ")") fail(tx("Unexpected \")\": there is no open bracket to close."));
    fail(tx("Unexpected {token}.", { token: show(tk) }));
  }
  return tree;
}

/* ------------------------------------------------------------------ evaluator */

const RAD = Math.PI / 180;
const tiny = (v) => (Math.abs(v) < 1e-15 ? 0 : v);

function trig(name, x, deg) {
  if (deg) {
    const a = ((x % 360) + 360) % 360;
    if (name === "sin") {
      if (a % 180 === 0) return 0;
      if (a === 90) return 1;
      if (a === 270) return -1;
    } else if (name === "cos") {
      if (a % 180 === 90) return 0;
      if (a === 0) return 1;
      if (a === 180) return -1;
    } else if (a % 180 === 90) fail(tx("tan is undefined at {x}° (90° plus a multiple of 180°).", { x: fmtPlain(x) }));
    else if (a % 180 === 0) return 0;
    else if (a === 45 || a === 225) return 1;
    else if (a === 135 || a === 315) return -1;
    x = x * RAD;
  }
  const v = Math[name](x);
  if (name === "tan" && Math.abs(v) > 1e15) fail(tx("tan is undefined at that angle (the result would be infinite)."));
  return tiny(v);
}
const fmtPlain = (n) => String(Number(n.toPrecision(12)));

function applyFn(name, x, deg) {
  switch (name) {
    case "sin": case "cos": case "tan": return trig(name, x, deg);
    case "asin": case "acos": {
      if (x < -1 || x > 1) fail(tx("{name} needs a value from −1 to 1.", { name }));
      const v = Math[name](x);
      return deg ? v / RAD : v;
    }
    case "atan": return deg ? Math.atan(x) / RAD : Math.atan(x);
    case "sinh": case "cosh": case "tanh": return Math[name](x);
    case "ln": if (x <= 0) fail(tx("{name} needs a number greater than 0.", { name: "ln" })); return Math.log(x);
    case "log": if (x <= 0) fail(tx("{name} needs a number greater than 0.", { name: "log" })); return Number(Math.log10(x));
    case "log2": if (x <= 0) fail(tx("{name} needs a number greater than 0.", { name: "log2" })); return Math.log2(x);
    case "sqrt": if (x < 0) fail(tx("The square root of a negative number isn't a real number.")); return Math.sqrt(x);
    case "cbrt": return Math.cbrt(x);
    case "abs": return Math.abs(x);
    case "exp": return Math.exp(x);
    case "floor": return Math.floor(x);
    case "ceil": return Math.ceil(x);
    case "round": return Math.sign(x) * Math.round(Math.abs(x)); // halves round away from zero
  }
  fail(tx("Unknown function {name}.", { name }));
}

const TOO_BIG = tx("The result is too large to show (beyond about 1.8e308).");

function evalNode(n, ctx) {
  switch (n.k) {
    case "num": return n.v;
    case "ans":
      if (ctx.ans === null || ctx.ans === undefined) fail(tx("There is no previous answer yet. Calculate something first, then use Ans."));
      return ctx.ans;
    case "neg": return -evalNode(n.a, ctx);
    case "pct": return evalNode(n.a, ctx) / 100;
    case "fact": {
      const x = evalNode(n.a, ctx);
      if (!Number.isInteger(x) || x < 0) fail(tx("Factorial (!) works on whole numbers from 0 to 170."));
      if (x > 170) fail(tx("Factorial is limited to 170! because 171! is larger than the biggest number this calculator can hold."));
      let r = 1;
      for (let i = 2; i <= x; i++) r *= i;
      return r;
    }
    case "fn": {
      const v = applyFn(n.name, evalNode(n.a, ctx), ctx.angle === "deg");
      if (!Number.isFinite(v)) fail(Number.isNaN(v) ? tx("That has no real result.") : TOO_BIG);
      return v;
    }
    case "bin": {
      const a = evalNode(n.l, ctx), b = evalNode(n.r, ctx);
      let v;
      if (n.op === "+" || n.op === "-") {
        v = n.op === "+" ? a + b : a - b;
        // cancellation noise such as 0.1 + 0.2 - 0.3 = 5.5e-17 reads as 0
        if (v !== 0 && Math.abs(v) < 1e-15 * Math.max(Math.abs(a), Math.abs(b))) v = 0;
      } else if (n.op === "*") v = a * b;
      else if (n.op === "/") {
        if (b === 0) fail(a === 0 ? tx("0 ÷ 0 is undefined.") : tx("Division by zero is undefined."));
        v = a / b;
      } else {
        if (a === 0 && b < 0) fail(tx("Division by zero is undefined (0 to a negative power)."));
        v = Math.pow(a, b);
        if (Number.isNaN(v)) fail(tx("A negative number to a fractional power has no real result."));
      }
      if (!Number.isFinite(v)) fail(TOO_BIG);
      return v;
    }
  }
  fail(tx("Could not evaluate that."));
}

/* ------------------------------------------------------------------ public API */

/* Round to 12 significant digits so binary noise (0.1 + 0.2) disappears. */
export const round12 = (v) => (v === 0 ? 0 : Number(v.toPrecision(12)));

/* Text for a result: plain digits normally, e-notation at 1e15 and above or below 1e-6. */
export function formatResult(v) {
  const r = round12(v);
  if (r === 0) return "0";
  const a = Math.abs(r);
  if (a >= 1e15 || a < 1e-6) return r.toExponential().replace("e+", "e");
  return String(r);
}

/* Evaluate text. Returns {value, text, closed, added} where `closed` is the input with missing closing
   brackets added and `added` how many were added. Throws CalcError with a plain-English message. */
export function evaluate(src, { angle = "deg", ans = null } = {}) {
  const text = String(src).trim();
  if (!text) fail(tx("Type an expression first."));
  if (text.length > 500) fail(tx("That expression is longer than 500 characters."));
  const toks = tokenize(text);
  let open = 0;
  for (const tk of toks) if (tk.t === "op") { if (tk.v === "(") open++; else if (tk.v === ")" && open > 0) open--; }
  const closed = text + ")".repeat(open);
  const all = open ? [...toks, ...Array.from({ length: open }, () => ({ t: "op", v: ")", pos: -1 }))] : toks;
  let tree;
  try { tree = parse(all); } catch (e) { if (e instanceof RangeError) fail(tx("That expression is nested too deeply.")); throw e; }
  let value;
  try { value = evalNode(tree, { angle, ans }); } catch (e) { if (e instanceof RangeError) fail(tx("That expression is nested too deeply.")); throw e; }
  value = round12(value);
  if (!Number.isFinite(value)) fail(TOO_BIG);
  return { value, text: formatResult(value), closed, added: open };
}
