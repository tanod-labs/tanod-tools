// Roman numeral converter: strict standard form (1-3999), optional overline (vinculum) range to 3,999,999.
import { $, $$, el, prefs, tx, txn, fmtNum, EN, parseNum, listText } from "./core.js?v=11";

const BAR = "̅"; // combining overline
const PLAIN = [["M", 1000], ["CM", 900], ["D", 500], ["CD", 400], ["C", 100], ["XC", 90], ["L", 50], ["XL", 40], ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
const VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const STRICT = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const ALLOWED = { I: "VX", X: "LC", C: "DM" };
const PAIRS = { I: tx("V or X"), X: tx("L or C"), C: tx("D or M") };

const bar = (s) => Array.from(s, (c) => c + BAR).join("");

/* Parts of a number 1..3999 as [{sym, value}] */
function plainParts(n) {
  const out = [];
  for (const [sym, v] of PLAIN) while (n >= v) { out.push({ sym, value: v }); n -= v; }
  return out;
}

export function toRoman(n) {
  if (n >= 4000) {
    const th = Math.floor(n / 1000), rest = n % 1000;
    const g = plainParts(th);
    const parts = [{ sym: bar(g.map((p) => p.sym).join("")), value: th * 1000, group: true }, ...plainParts(rest)];
    return { text: parts.map((p) => p.sym).join(""), parts };
  }
  const parts = plainParts(n);
  return { text: parts.map((p) => p.sym).join(""), parts };
}

/* Read letters literally: add each symbol, subtract it when the next one is larger. */
function lenient(s) {
  let t = 0, top = 0;
  for (let i = s.length - 1; i >= 0; i--) { // from the right: a symbol smaller than one already seen is subtracted
    const v = VAL[s[i]];
    if (v < top) t -= v; else { t += v; top = v; }
  }
  return t;
}

/* Validate ordinary letters. maxM is how many Ms the context allows. Returns {value, parts} or {reason}. */
function checkPlain(s, { allowM = true } = {}) {
  const bad = [...new Set(s.replace(/[IVXLCDM]/g, "").split(""))];
  if (bad.length) {
    if (/\d/.test(bad.join(""))) return { reason: tx("That contains digits. Type the number in the Number box; this box takes Roman letters (I, V, X, L, C, D, M).") };
    const quoted = bad.map((c) => `"${c}"`);
    return { reason: txn(bad.length, "{list} is not a Roman numeral letter. The letters are I, V, X, L, C, D and M.", "{list} are not Roman numeral letters. The letters are I, V, X, L, C, D and M.", { list: EN ? quoted.join(", ") : listText(quoted) }) };
  }
  if (STRICT.test(s)) {
    if (!allowM && lenient(s) >= 1000) return { reason: tx("After an overlined part, the ordinary letters can only make up 1 to 999, so M is not used there. Write the thousands under the overline.") };
    return { value: lenient(s), parts: (s.match(/CM|CD|XC|XL|IX|IV|[MDCLXVI]/g) || []).map((sym) => ({ sym, value: lenient(sym) })) };
  }
  const hint = () => {
    const v = lenient(s);
    return v >= 1 && v <= 3999 ? " " + tx("Read literally it adds up to {value}, which is written {roman}.", { value: v, roman: toRoman(v).text }) : "";
  };
  let m;
  if ((m = /(I{4,}|X{4,}|C{4,}|M{4,})/.exec(s))) {
    const ch = m[1][0], run = m[1];
    const text = {
      I: tx("I can't appear more than three times in a row ({run}); 4 is IV.", { run }),
      X: tx("X can't appear more than three times in a row ({run}); 40 is XL.", { run }),
      C: tx("C can't appear more than three times in a row ({run}); 400 is CD.", { run }),
      M: tx("M can't appear more than three times in a row ({run}); 4000 is written with an overline, I̅V̅ (tick the extended range).", { run }),
    }[ch];
    return { reason: text + (ch === "M" ? "" : hint()) };
  }
  if (/V.*V|L.*L|D.*D/.test(s)) {
    const ch = /(V).*V|(L).*L|(D).*D/.exec(s).slice(1).find(Boolean);
    return { reason: tx("{ch} is never repeated: V, L and D each appear at most once ({ch}{ch} would be {to}).", { ch, to: { V: "X", L: "C", D: "M" }[ch] }) + hint() };
  }
  for (let i = 0; i < s.length - 1; i++) {
    if (VAL[s[i]] < VAL[s[i + 1]]) {
      const pair = s[i] + s[i + 1];
      if ("VLD".includes(s[i])) return { reason: tx("{ch} is never placed before a larger symbol ({pair}); only I, X and C can be subtracted.", { ch: s[i], pair }) };
      if (!ALLOWED[s[i]].includes(s[i + 1])) {
        return { reason: tx("{ch} can only be placed before {allowed}, so {pair} is not a valid pair.", { ch: s[i], allowed: PAIRS[s[i]], pair }) + hint() };
      }
      if (i > 0 && s[i - 1] === s[i]) return { reason: tx("A subtracted symbol appears once: {run} is not allowed.", { run: s[i - 1] + pair }) + hint() };
    }
  }
  return { reason: tx("{text} breaks the standard pattern. Numerals are written place by place (thousands, hundreds, tens, ones), so after a pair such as CM, XC or IV the same symbol cannot return.", { text: s }) + hint() };
}

/* Any user text to {value, parts, text} or {reason}. Accepts lowercase, spaces, overline marks or [brackets] for thousands. */
export function parseRoman(input) {
  let s = String(input).replace(/\s+/g, "").toUpperCase().replace(/[̄]/g, BAR);
  if (!s) return { empty: true };
  let group = "", rest = s;
  const br = /^\[([^\]]*)\](.*)$/.exec(s);
  if (br) { group = br[1]; rest = br[2]; }
  else if (s.includes(BAR)) {
    const m = new RegExp(`^((?:[IVXLCDM]${BAR})+)([^${BAR}]*)$`).exec(s);
    if (!m) return { reason: tx("Overlined letters must come first, followed by ordinary letters.") };
    group = m[1].replaceAll(BAR, ""); rest = m[2];
  }
  if (s.includes("[") && !br) return { reason: tx("Use brackets as [IV] around the letters that carry the overline, at the start.") };
  if (!group) {
    const r = checkPlain(rest);
    if (r.reason) return r;
    return { value: r.value, parts: r.parts, text: rest };
  }
  const g = checkPlain(group);
  if (g.reason) return { reason: tx("Inside the overline: {reason}", { reason: g.reason }) };
  if (g.value < 4) return { reason: tx("An overline starts at 4000 (I̅V̅). One to three thousand are written M, MM and MMM.") };
  const r = rest ? checkPlain(rest, { allowM: false }) : { value: 0, parts: [] };
  if (r.reason) return r;
  const parts = [{ sym: bar(group), value: g.value * 1000, group: true }, ...r.parts];
  return { value: g.value * 1000 + r.value, parts, text: parts.map((p) => p.sym).join("") };
}

/* ------------------------------------------------------------------ page */

const num = $("#rn-num"), rom = $("#rn-rom"), ext = $("#rn-ext");
const msg = $("#rn-msg"), res = $("#rn-res");
let source = "num";

ext.checked = !!prefs.get("rn.ext", false);

function clear(withMsg = "") {
  res.hidden = true;
  msg.textContent = withMsg;
}

function showResult(value, parts, text) {
  $("#rn-main").textContent = `${text} = ${fmtNum(value)}`;
  $("#rn-parts").replaceChildren(...parts.map((p) =>
    el("li", {}, el("span", { class: "rn__sym" }, p.sym), el("span", { class: "num" }, fmtNum(p.value)), p.group ? el("span", { class: "rn__x" }, tx("thousands, overlined")) : null)));
  $("#rn-sum").textContent = `${parts.map((p) => p.sym).join(" + ")} = ${parts.map((p) => p.value).join(" + ")} = ${value}`;
  res.hidden = false;
}

function fromNumber() {
  num.setAttribute("aria-invalid", "false");
  rom.setAttribute("aria-invalid", "false");
  let raw = num.value.trim().replace(/[\s,_]/g, "").replace(/−/g, "-");
  if (!EN) { // "1.994" is 1994 on a page with a decimal comma, "3,5" is 3.5
    const p = parseNum(num.value);
    if (p !== null && Number.isFinite(p)) raw = String(p);
  }
  if (!raw) { rom.value = ""; clear(); return; }
  let err = "";
  if (/^-\d/.test(raw)) err = tx("Roman numerals have no negative numbers. Enter a positive whole number.");
  else if (/^\d*[.]\d*$/.test(raw) && /\d/.test(raw)) err = tx("Roman numerals are for whole numbers; there are no decimals or fractions here.");
  else if (!/^\d+$/.test(raw)) err = tx("Enter a whole number using digits only, such as 1994.");
  else {
    const n = Number(raw);
    if (n === 0) err = tx("There is no Roman numeral for 0. The Roman system had no zero symbol; medieval writers used the word nulla when a table needed one.");
    else if (n > 3999999) err = tx("The largest number this converter writes is 3,999,999 (with overlines).");
    else if (n > 3999 && !ext.checked) err = tx("Standard Roman numerals stop at 3999 (MMMCMXCIX). Tick the extended range to write 4000 and above with an overline.");
    else {
      const r = toRoman(n);
      rom.value = r.text;
      clear(n > 3999 ? tx("Each overlined letter counts 1000 times its usual value (a later convention, used less consistently than the standard letters).") : "");
      showResult(n, r.parts, r.text);
      return;
    }
  }
  rom.value = "";
  num.setAttribute("aria-invalid", "true");
  clear(err);
}

function fromRoman(final) {
  num.setAttribute("aria-invalid", "false");
  rom.setAttribute("aria-invalid", "false");
  const r = parseRoman(rom.value);
  if (r.empty) { num.value = ""; clear(); return; }
  if (r.reason) {
    num.value = "";
    rom.setAttribute("aria-invalid", "true");
    clear(r.reason);
    return;
  }
  num.value = String(r.value);
  clear(r.value > 3999 ? tx("Each overlined letter counts 1000 times its usual value (a later convention, used less consistently than the standard letters).") : "");
  showResult(r.value, r.parts, r.text);
  if (final) rom.value = r.text;
}

num.addEventListener("input", () => { source = "num"; fromNumber(); });
rom.addEventListener("input", () => { source = "rom"; fromRoman(false); });
rom.addEventListener("change", () => { source = "rom"; fromRoman(true); });
ext.addEventListener("change", () => { prefs.set("rn.ext", ext.checked); if (source === "num") fromNumber(); else fromRoman(false); });
for (const b of $$("#rn-years button")) b.addEventListener("click", () => { num.value = b.dataset.n; source = "num"; fromNumber(); });

fromNumber();
