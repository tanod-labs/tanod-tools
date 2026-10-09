// Numbers in English words: cardinal, ordinal and currency amounts. Integers are BigInt and decimals are digit
// strings, so there is no floating-point rounding anywhere. Pure functions (no DOM, no UI strings).

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/* short scale: 10^3, 10^6, ... */
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion", "sextillion", "septillion", "octillion",
  "nonillion", "decillion"];
export const MAX_DIGITS = SCALES.length * 3; // 36 digits: up to 999 decillion ... 10^36 - 1

/* Words for 0..999 (hyphenated tens: twenty-one). and: British "one hundred and five". */
function below1000(n, and, inner) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(ONES[h] + " hundred");
  if (r) {
    const rw = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? "-" + ONES[r % 10] : "");
    if (h && and) parts.push("and");
    parts.push(rw);
  }
  return parts.join(" ");
}

/* Cardinal words for a non-negative BigInt. */
export function cardinal(n, { and = false } = {}) {
  if (typeof n !== "bigint") n = BigInt(n);
  if (n < 0n) return "minus " + cardinal(-n, { and });
  if (n === 0n) return "zero";
  if (n >= 10n ** BigInt(MAX_DIGITS)) throw new RangeError("too large");
  const groups = [];
  let rest = n;
  while (rest > 0n) { groups.push(Number(rest % 1000n)); rest /= 1000n; }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    let w = below1000(g, and);
    if (SCALES[i]) w += " " + SCALES[i];
    // British "and" also goes before a last group below 100: one thousand and five
    if (and && i === 0 && words.length && g < 100) w = "and " + w;
    words.push(w);
  }
  return words.join(" ");
}

const ORD_IRREG = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/* Ordinal words (first, second, ... one hundred twenty-third) for a non-negative BigInt. */
export function ordinal(n, { and = false } = {}) {
  if (typeof n !== "bigint") n = BigInt(n);
  if (n < 0n) throw new RangeError("negative");
  const w = cardinal(n, { and });
  const m = /^(.*?)([a-z]+)$/.exec(w);
  let last = m[2], head = m[1];
  // hyphenated tens: "twenty-one" -> head "...twenty-", last "one"
  if (last === "zero") last = "zeroth";
  else if (ORD_IRREG[last]) last = ORD_IRREG[last];
  else if (last.endsWith("y")) last = last.slice(0, -1) + "ieth";
  else last += "th";
  return head + last;
}

/* Clean up what a person typed. decimal: "." or "," as the decimal mark of the page (the other one groups digits).
   Returns { neg, int: "123", frac: "45" } or null when it isn't a plain number. */
export function parseDecimal(s, decimal = ".") {
  let t = String(s ?? "").trim().replace(/[−–]/g, "-").replace(/[\s\xa0_']/g, "");
  if (!t) return null;
  const group = decimal === "," ? "." : ",";
  if (t.includes(decimal)) {
    if (t.split(decimal).length > 2) return null;
    t = t.split(group).join("");
  } else t = t.split(group).join("");
  t = t.replace(decimal, ".");
  const m = /^([-+]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  return { neg: m[1] === "-", int: (m[2] || "0").replace(/^0+(?=\d)/, ""), frac: m[3] || "" };
}

/* Digits after the decimal point, one by one: "point one four" . */
export function decimalWords(frac) {
  return [...frac].map((d) => ONES[+d]).join(" ");
}

/* Cardinal words for a decimal string pair from parseDecimal. */
export function numberWords(p, { and = false } = {}) {
  const w = cardinal(BigInt(p.int), { and });
  const out = p.frac ? w + " point " + decimalWords(p.frac) : w;
  return p.neg && (BigInt(p.int) !== 0n || /[1-9]/.test(p.frac)) ? "minus " + out : out;
}

/* [code, major singular, major plural, minor singular, minor plural, minor digits] */
export const CURRENCIES = {
  USD: ["dollar", "dollars", "cent", "cents", 2],
  EUR: ["euro", "euros", "cent", "cents", 2],
  GBP: ["pound", "pounds", "penny", "pence", 2],
  PHP: ["peso", "pesos", "centavo", "centavos", 2],
  INR: ["rupee", "rupees", "paisa", "paise", 2],
  AUD: ["Australian dollar", "Australian dollars", "cent", "cents", 2],
  CAD: ["Canadian dollar", "Canadian dollars", "cent", "cents", 2],
  NZD: ["New Zealand dollar", "New Zealand dollars", "cent", "cents", 2],
  SGD: ["Singapore dollar", "Singapore dollars", "cent", "cents", 2],
  CHF: ["Swiss franc", "Swiss francs", "rappen", "rappen", 2],
  JPY: ["yen", "yen", "sen", "sen", 0],
  CNY: ["yuan", "yuan", "fen", "fen", 2],
  MXN: ["Mexican peso", "Mexican pesos", "centavo", "centavos", 2],
  ZAR: ["rand", "rand", "cent", "cents", 2],
  BRL: ["real", "reais", "centavo", "centavos", 2],
  KWD: ["Kuwaiti dinar", "Kuwaiti dinars", "fils", "fils", 3],
};

/* Round a digit string "12.3456" to `digits` decimals, half up. Returns { int, frac } (BigInt-safe strings). */
export function roundTo(p, digits) {
  if (p.frac.length <= digits) return { int: p.int, frac: p.frac.padEnd(digits, "0") };
  const keep = p.frac.slice(0, digits);
  const up = p.frac.charCodeAt(digits) >= 53; // '5'
  let n = BigInt(p.int + keep) + (up ? 1n : 0n);
  let s = n.toString().padStart(digits + 1, "0");
  return { int: digits ? s.slice(0, -digits) : s, frac: digits ? s.slice(-digits) : "" };
}

/* "One thousand two hundred thirty-four dollars and fifty-six cents" for a parsed amount.
   opts.and: British "and"; opts.fraction: write the minor units as "56/100" instead of words;
   opts.round: round extra decimals half up (otherwise throws RangeError("decimals")). */
export function currencyWords(p, code, { and = false, fraction = false, round = false } = {}) {
  const cur = CURRENCIES[code];
  if (!cur) throw new RangeError("currency");
  const digits = cur[4];
  if (p.frac.replace(/0+$/, "").length > digits && !round) throw new RangeError("decimals");
  const r = roundTo(p, digits);
  const major = BigInt(r.int), minor = digits ? BigInt(r.frac) : 0n;
  const majorW = cardinal(major, { and }) + " " + (major === 1n ? cur[0] : cur[1]);
  const neg = p.neg && (major !== 0n || minor !== 0n);
  let out;
  if (!digits) out = majorW;
  else if (fraction) out = majorW + " and " + r.frac + "/" + "1".padEnd(digits + 1, "0");
  else if (minor === 0n) out = majorW;
  else {
    const minorW = cardinal(minor, { and }) + " " + (minor === 1n ? cur[2] : cur[3]);
    out = major === 0n ? minorW : majorW + " and " + minorW;
  }
  return (neg ? "minus " : "") + out;
}

/* Capitalisation: "lower", "sentence", "title", "upper". Title case keeps small joining words lower. */
export function applyCase(s, mode) {
  if (mode === "upper") return s.toUpperCase();
  if (mode === "sentence") return s.charAt(0).toUpperCase() + s.slice(1);
  if (mode === "title") return s.replace(/(^|[ \-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/ (And|Of)\b/g, (m, w) => " " + w.toLowerCase());
  return s;
}
