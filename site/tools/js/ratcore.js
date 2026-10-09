// Exact rational arithmetic on BigInt for the fraction calculator. A rational is {n, d} with d > 0 and
// gcd(n, d) = 1. Nothing is rounded: every result is an exact fraction.

import { tx, EN } from "./i18n.js?v=11";

export class RatError extends Error {}
const fail = (m) => { throw new RatError(m); };

const abs = (a) => (a < 0n ? -a : a);
export function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
export const lcm = (a, b) => (a === 0n || b === 0n ? 0n : abs(a * b) / gcd(a, b));

export function make(n, d = 1n) {
  if (d === 0n) fail(tx("A denominator can't be 0."));
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const add = (a, b) => make(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) => make(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => make(a.n * b.n, a.d * b.d);
export function div(a, b) {
  if (b.n === 0n) fail(tx("Dividing by 0 has no answer."));
  return make(a.n * b.d, a.d * b.n);
}
export const eq = (a, b) => a.n === b.n && a.d === b.d;

/* ------------------------------------------------------------------ parsing */

/* What was typed with "." as the decimal point and no digit grouping. English pages: commas and underscores are
   dropped ("1,000" is 1000). Pages with a decimal comma: "0,75" is 0.75 and "1.000" is a thousand (a dot is also
   read as a decimal point unless exactly three digits follow it). Spaces between a whole number and a fraction stay. */
export function plainNumbers(text) {
  if (EN) return text.replace(/[,_]/g, "");
  return text.replace(/_/g, "").replace(/\d[\d.,]*/g, (tok) => {
    if (tok.includes(",")) return tok.replace(/\./g, "").replace(",", ".");
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(tok)) return tok.replace(/\./g, "");
    return tok;
  });
}

/* A decimal string such as "0.75", ".5", "1.2e-3", "12" (no sign) to an exact rational. */
function decimal(txt) {
  const m = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(txt);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = m[2] || "";
  let n = BigInt((m[1] || "0") + frac);
  let d = 10n ** BigInt(frac.length);
  if (m[3]) {
    const e = Number(m[3]);
    if (Math.abs(e) > 400) fail(tx("That exponent is too large. Keep it between -400 and 400."));
    if (e >= 0) n *= 10n ** BigInt(e); else d *= 10n ** BigInt(-e);
  }
  return make(n, d);
}

/* "0.(142857)", "3.(3)", "0.1(6)" (repeating decimal) to an exact rational, or null. */
function repeating(txt) {
  const m = /^(\d*)\.(\d*)\((\d+)\)$/.exec(txt);
  if (!m) return null;
  const nonrep = m[2], rep = m[3];
  const whole = BigInt((m[1] || "0") + nonrep + rep) - BigInt((m[1] || "0") + nonrep);
  const den = 10n ** BigInt(nonrep.length) * (10n ** BigInt(rep.length) - 1n);
  return make(whole, den);
}

/* What a person types, to {r, raw, kind}: r is the exact value, raw the fraction as typed (not reduced, so steps
   can show it), kind one of "integer", "decimal", "fraction", "mixed", "repeating".
   Accepts: 3, -3, 0.75, .5, 1.2e-3, 3/4, -3/4, 3/-4, 1.5/3, 1 1/2, -1 1/2 (= -3/2), 0.(3), 1,000 (commas ignored).
   Returns null for empty input; throws RatError with a plain message otherwise. */
export function parseRat(input) {
  let s = plainNumbers(String(input ?? "").trim().replace(/[−–]/g, "-")).replace(/\s+/g, " ");
  if (!s) return null;
  const bad = () => fail(tx("\"{text}\" isn't a number or fraction. Try 3/4, 1 1/2, 0.75 or 5.", { text: String(input).trim() }));
  let m = /^([+-]?)(\d+) (\d+)\/(\d+)$/.exec(s);
  if (m) {
    const w = BigInt(m[2]), nn = BigInt(m[3]), dd = BigInt(m[4]);
    if (dd === 0n) fail(tx("A denominator can't be 0 (in {text}).", { text: s }));
    const sign = m[1] === "-" ? -1n : 1n;
    const num = sign * (w * dd + nn);
    return { r: make(num, dd), raw: { n: num, d: dd }, kind: "mixed" };
  }
  s = s.replace(/ /g, "");
  m = /^([+-]?)(.+)\/([+-]?)(.+)$/.exec(s);
  if (m) {
    const a = decimal(m[2]), b = decimal(m[4]);
    if (!a || !b) bad();
    if (b.n === 0n) fail(tx("A denominator can't be 0 (in {text}).", { text: s }));
    const sign = (m[1] === "-" ? -1n : 1n) * (m[3] === "-" ? -1n : 1n);
    const plain = /^\d+$/.test(m[2]) && /^\d+$/.test(m[4]);
    const r = make(sign * a.n * b.d, a.d * b.n);
    return { r, raw: plain ? { n: sign * BigInt(m[2]), d: BigInt(m[4]) } : r, kind: "fraction" };
  }
  m = /^([+-]?)(.+)$/.exec(s);
  const sign = m[1] === "-" ? -1n : 1n;
  const rep = repeating(m[2]);
  if (rep) return { r: make(sign * rep.n, rep.d), raw: make(sign * rep.n, rep.d), kind: "repeating" };
  const v = decimal(m[2]);
  if (!v) bad();
  const r = make(sign * v.n, v.d);
  return { r, raw: r, kind: /^\d+$/.test(m[2]) ? "integer" : "decimal" };
}

/* ------------------------------------------------------------------ output */

const big = (n) => n.toString();
export const fracText = (r) => (r.d === 1n ? big(r.n) : `${big(r.n)}/${big(r.d)}`);

/* Mixed-number text: "3 1/7", "-3 1/7" (the sign applies to the whole number), or null when the value is a whole
   number or smaller than 1 in size. */
export function mixedText(r) {
  const a = abs(r.n);
  if (r.d === 1n || a < r.d) return null;
  return `${r.n < 0n ? "-" : ""}${big(a / r.d)} ${big(a % r.d)}/${big(r.d)}`;
}

/* Decimal expansion by long division. Returns {text, int, nonrep, rep, exact, truncated}:
   text is "0.(142857)" with the repeating part in brackets, "0.75" when it terminates, "-3" for integers.
   At most `limit` fractional digits are produced; if the cycle is longer, `truncated` is true and the digits end in "…". */
export function decimalExpansion(r, limit = 300) {
  const neg = r.n < 0n;
  const n = abs(r.n);
  const int = n / r.d;
  let rem = n % r.d;
  const sign = neg ? "-" : "";
  if (rem === 0n) return { text: sign + big(int), int: big(int), nonrep: "", rep: "", exact: true, truncated: false };
  const seen = new Map();
  let digits = "";
  while (rem !== 0n && digits.length < limit) {
    const key = rem.toString();
    if (seen.has(key)) break;
    seen.set(key, digits.length);
    rem *= 10n;
    digits += (rem / r.d).toString();
    rem %= r.d;
  }
  if (rem === 0n) return { text: `${sign}${big(int)}.${digits}`, int: big(int), nonrep: digits, rep: "", exact: true, truncated: false };
  const at = seen.get(rem.toString());
  if (at === undefined) return { text: `${sign}${big(int)}.${digits}…`, int: big(int), nonrep: digits, rep: "", exact: false, truncated: true };
  const nonrep = digits.slice(0, at), rep = digits.slice(at);
  return { text: `${sign}${big(int)}.${nonrep}(${rep})`, int: big(int), nonrep, rep, exact: false, truncated: false };
}
