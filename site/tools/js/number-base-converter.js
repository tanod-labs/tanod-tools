// Number base converter: whole numbers of any size (BigInt) between bases 2 to 36, plus two's complement views.
import { $, el, debounce, copyText, setStatus, UserError, friendlyError, tx, txn, fmtNum, EN } from "./core.js?v=5";
import { fmtNum as fmtExact } from "./i18n.js?v=5";

const MAX_DIGITS = 4096;
const NAMES = { 2: tx("binary"), 8: tx("octal"), 10: tx("decimal"), 16: tx("hexadecimal") };
const PREFIX = { 2: /^0b/i, 8: /^0o/i, 16: /^0x/i };
const WIDTHS = [8, 16, 32, 64];

function allowed(base) {
  if (base <= 10) return tx("0 to {last}", { last: base - 1 });
  const last = String.fromCharCode(55 + base - 1);
  return base > 11 ? tx("0 to 9 and A to {last}", { last }) : tx("0 to 9 and A");
}
const baseName = (b) => (NAMES[b] ? NAMES[b] : tx("base-{n}", { n: b }));

/* Parse text in the given base to a BigInt. Throws UserError with the 1-based position of the first problem. */
export function parseNumber(text, base) {
  let i = 0;
  const n = text.length;
  while (i < n && /\s/.test(text[i])) i++;
  let neg = false;
  if (text[i] === "-" || text[i] === "−" || text[i] === "+") { neg = text[i] !== "+"; i++; }
  while (i < n && text[i] === " ") i++;
  const rest = text.slice(i);
  const pfx = PREFIX[base] && PREFIX[base].exec(rest);
  if (pfx) i += 2;
  let digits = "";
  let hint = "";
  if (!pfx) {
    if (/^0x/i.test(rest)) hint = tx("It looks like a hexadecimal number (0x prefix): choose Hexadecimal.");
    else if (/^0b[01]/i.test(rest) && base < 12) hint = tx("It looks like a binary number (0b prefix): choose Binary.");
    else if (/^0o/i.test(rest)) hint = tx("It looks like an octal number (0o prefix): choose Octal.");
  }
  for (; i < n; i++) {
    const c = text[i];
    if (c === " " || c === "_" || c === "\t") continue;
    if (/\s/.test(c)) continue;
    const pos = i + 1;
    if (c === ".") throw new UserError(tx("\".\" at position {pos} looks like a fraction. This converter handles whole numbers only; fractions are not converted.", { pos }));
    if (c === ",") throw new UserError(tx("\",\" at position {pos} isn't a digit. Remove thousands separators (spaces and underscores are fine).", { pos }));
    const code = c.charCodeAt(0);
    let v = -1;
    if (code >= 48 && code <= 57) v = code - 48;
    else if (code >= 65 && code <= 90) v = code - 55;
    else if (code >= 97 && code <= 122) v = code - 87;
    if (v < 0 || v >= base) {
      throw new UserError(tx("\"{c}\" at position {pos} isn't a valid {base} digit (use {allowed}).", { c, pos, base: baseName(base), allowed: allowed(base) }) + (hint ? " " + hint : ""));
    }
    digits += c;
  }
  if (!digits) throw new UserError(neg ? tx("Type some digits after the minus sign.") : tx("Type a number to convert."));
  if (digits.length > MAX_DIGITS) throw new UserError(tx("That number has {n} digits; the limit is {max}.", { n: fmtNum(digits.length), max: fmtNum(MAX_DIGITS) }));
  let value;
  if (base === 10) value = BigInt(digits);
  else if (base === 2 || base === 8 || base === 16) value = BigInt((base === 2 ? "0b" : base === 8 ? "0o" : "0x") + digits);
  else {
    const B = BigInt(base);
    let k = 1;
    while (base ** (k + 1) < 2 ** 53) k++;
    value = 0n;
    for (let s = 0; s < digits.length; s += k) {
      const chunk = digits.slice(s, s + k);
      value = value * B ** BigInt(chunk.length) + BigInt(parseInt(chunk, base));
    }
  }
  return neg ? -value : value;
}

function group(s, size, sep) {
  let out = "";
  for (let i = s.length; i > 0; i -= size) out = s.slice(Math.max(0, i - size), i) + (out ? sep + out : "");
  return out;
}

export function toBase(value, base, { grouped = false, upper = true } = {}) {
  const neg = value < 0n;
  let s = (neg ? -value : value).toString(base);
  if (upper) s = s.toUpperCase();
  if (grouped) s = base === 10 ? group(s, 3, ",") : group(s, base === 8 ? 3 : 4, " ");
  return (neg ? "-" : "") + s;
}

const bitLength = (v) => (v === 0n ? 0 : v.toString(2).length);

/* Two's complement rows: {bits, fits, hex, bin, signed, unsigned} */
export function twos(value, bits) {
  const W = BigInt(bits);
  const min = -(1n << (W - 1n)), max = (1n << W) - 1n;
  if (value < min || value > max) return { bits, fits: false, min, max: (1n << (W - 1n)) - 1n, umax: max };
  const pat = value < 0n ? value + (1n << W) : value;
  const signed = pat >= 1n << (W - 1n) ? pat - (1n << W) : pat;
  return {
    bits, fits: true,
    hex: pat.toString(16).toUpperCase().padStart(bits / 4, "0"),
    bin: group(pat.toString(2).padStart(bits, "0"), 4, " "),
    signed, unsigned: pat,
  };
}

/* ------------------------------------------------------------------ UI */

const status = $("#status");
const inEl = $("#nb-in"), fromEl = $("#nb-from"), baseEl = $("#nb-base");

function fromBase() {
  if (fromEl.value !== "other") return Number(fromEl.value);
  const b = Number(baseEl.value);
  if (!Number.isInteger(b) || b < 2 || b > 36) throw new UserError(tx("Choose a base from 2 to 36."));
  return b;
}

function update() {
  $("#nb-base-field").hidden = fromEl.value !== "other";
  const text = inEl.value;
  if (!text.trim()) {
    $("#nb-out").hidden = $("#nb-tc").hidden = true;
    setStatus(status, "idle");
    inEl.setAttribute("aria-invalid", "false");
    return;
  }
  let base, value;
  try {
    base = fromBase();
    value = parseNumber(text, base);
  } catch (err) {
    $("#nb-out").hidden = $("#nb-tc").hidden = true;
    inEl.setAttribute("aria-invalid", "true");
    setStatus(status, "error", friendlyError(err));
    return;
  }
  inEl.setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const o = { grouped: $("#nb-group").checked, upper: $("#nb-upper").checked };
  const rows = [[2, tx("Binary")], [8, tx("Octal")], [10, tx("Decimal")], [16, tx("Hexadecimal")]];
  if (![2, 8, 10, 16].includes(base)) rows.push([base, tx("Base {n}", { n: base })]);
  $("#nb-rows").replaceChildren(...rows.map(([b, label]) => {
    const s = toBase(value, b, o);
    return el("div", { "data-base": String(b) }, el("dt", {}, label), el("dd", { id: "nb-v-" + b }, s),
      el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Copy {label}", { label: EN ? label.toLowerCase() : label }), onclick: (e) => copyText(s, e.currentTarget) }, tx("Copy")));
  }));
  const mag = value < 0n ? -value : value;
  const signedBits = value < 0n ? bitLength(-value - 1n) + 1 : bitLength(value) + 1;
  const unsignedBits = Math.max(1, bitLength(mag));
  /* English has always said "1 bits" for -1, so its plural form is pinned to "bits" here. */
  $("#nb-info").textContent = value < 0n
    ? txn(EN ? 2 : signedBits, "Needs {n} bit as a signed integer.", "Needs {n} bits as a signed integer.", { n: fmtNum(signedBits) })
    : txn(unsignedBits, "Needs {n} bit unsigned, {signed} as a signed integer.", "Needs {n} bits unsigned, {signed} as a signed integer.", { signed: fmtNum(signedBits) });
  $("#nb-out").hidden = false;
  const fmt = (v) => (EN ? v.toLocaleString("en-US") : fmtExact(v)).replace(/^-/, "−");
  $("#nb-tc-body").replaceChildren(...WIDTHS.map((w) => {
    const t = twos(value, w);
    if (!t.fits) {
      return el("tr", { "data-bits": String(w) }, el("th", { scope: "row" }, String(w)),
        el("td", { colspan: "2", class: "dv-soft" }, tx("Doesn't fit in {w} bits (signed {min} to {max}, unsigned 0 to {umax}).", { w, min: fmt(t.min), max: fmt(t.max), umax: fmt(t.umax) })));
    }
    return el("tr", { "data-bits": String(w) }, el("th", { scope: "row" }, String(w)),
      el("td", {}, el("span", { class: "dv-bits", "data-hex": "" }, t.hex), el("br"), el("span", { class: "dv-bits dv-soft", "data-bin": "" }, t.bin)),
      el("td", {},
        el("span", { class: "dv-nowrap" }, el("span", { class: "dv-label" }, tx("signed")), el("span", { class: "dv-bits", "data-signed": "" }, fmt(t.signed))), el("br"),
        el("span", { class: "dv-nowrap" }, el("span", { class: "dv-label" }, tx("unsigned")), el("span", { class: "dv-bits", "data-unsigned": "" }, fmt(t.unsigned)))));
  }));
  $("#nb-tc").hidden = false;
}

const updateSoon = debounce(update, 60);
inEl.addEventListener("input", () => (inEl.value.length > 500 ? updateSoon() : update()));
for (const c of [fromEl, baseEl, $("#nb-group"), $("#nb-upper")]) { c.addEventListener("input", update); c.addEventListener("change", update); }
update();
