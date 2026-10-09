// Tanod Tools UI strings and locale formatting. The page language comes from <html lang>; English pages load
// nothing extra. Other languages load one generated string table for the page (ops/tools_site/build.py writes it
// to /tools/js/i18n/<lang>/<page>.js and links it with <link rel="modulepreload" data-strings>), so this module
// finishes loading before any tool module that imports it runs. No eval, no inline script.
//
// Strings are keyed by their English text. In code, only ever pass a double-quoted string literal as the first
// argument of tx/txf and the first two arguments of txn: the build extracts them with a regular expression.
//   tx("Merge PDFs")                                  -> "Unir PDF"
//   tx("Adding {name}…", { name })                    -> placeholders in braces
//   txn(n, "{n} page", "{n} pages")                   -> plural by Intl.PluralRules; {n} is fmtNum(n)
//   txf("{n} of {limit} left", { n: el("strong") })   -> an array of strings and nodes, for el(...) children

const root = document.documentElement;
export const LANG = root.getAttribute("lang") || "en";
export const EN = LANG === "en";
/* English keeps the en-US formatting the tools always had; other pages format for their own language. */
export const LOCALE = EN ? "en-US" : LANG;

let table = {};
if (!EN) {
  const link = document.querySelector("link[data-strings]");
  globalThis.__ttMissing = [];
  if (link) {
    try {
      table = (await import(link.href)).default || {};
    } catch (err) {
      console.warn("strings not loaded", err);
    }
  }
}

const pluralRules = new Intl.PluralRules(LOCALE);
/* CLDR puts 0 in Portuguese "one", but Brazilian usage is "0 arquivos": zero takes the plural there. */
const pluralCategory = (n) => (n === 0 && LANG === "pt-BR" ? "other" : pluralRules.select(n));

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

function look(key) {
  if (EN) return key;
  const v = table[key];
  if (v === undefined) {
    if (!globalThis.__ttMissing.includes(key)) globalThis.__ttMissing.push(key);
    return key;
  }
  return v;
}

/* Translate an English UI string; {name} placeholders are filled from vars. */
export function tx(s, vars) {
  let v = look(s);
  if (typeof v === "object") v = v.other ?? s;
  return fill(v, vars);
}

/* Plural: txn(3, "{n} file", "{n} files", vars). {n} is the formatted count unless vars sets it. */
export function txn(n, one, other, vars) {
  const key = one + "|" + other;
  const all = Object.assign({ n: fmtNum(n) }, vars);
  if (EN) return fill(n === 1 ? one : other, all);
  let v = look(key);
  if (v === key) v = n === 1 ? one : other;
  else if (typeof v === "object") v = v[pluralCategory(n)] ?? v.other;
  return fill(v, all);
}

/* Like tx, but placeholders may be DOM nodes: returns [string | Node, ...] to spread into el(...). */
export function txf(s, vars = {}) {
  let v = look(s);
  if (typeof v === "object") v = v.other ?? s;
  const out = [];
  let last = 0;
  v.replace(/\{(\w+)\}/g, (m, k, at) => {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) return m;
    if (at > last) out.push(v.slice(last, at));
    const x = vars[k];
    out.push(x instanceof Node ? x : String(x));
    last = at + m.length;
    return m;
  });
  if (last < v.length) out.push(v.slice(last));
  return out;
}

/* ------------------------------------------------------------------ numbers and dates */

const nfCache = new Map();
export function numberFormat(opts = {}) {
  const k = JSON.stringify(opts);
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat(LOCALE, opts));
  return nfCache.get(k);
}

/* Format a number for display in the page's language (en-US on English pages). */
export const fmtNum = (n, opts) => numberFormat(opts).format(n);

/* The page's decimal separator: "." or ",". */
export const DECIMAL = numberFormat().formatToParts(1.5).find((p) => p.type === "decimal")?.value || ".";

/* Parse a number typed on this page. Returns null for an empty field and NaN for something that isn't a number.
   English pages: "." is the decimal point; commas, spaces and underscores group digits.
   Pages whose language writes a decimal comma (es, pt-BR, fr, de, id, it, tr, vi, ru, pl): "," is the decimal point and ".", spaces and
   apostrophes group digits; a lone "." is still read as a decimal point unless it is followed by exactly three
   digits after a non-zero whole part (so "12.5" is 12.5, "0.125" is 0.125 and "1.000" is a thousand). */
export function parseNum(s) {
  let t = String(s ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return null;
  if (DECIMAL === ",") {
    t = t.replace(/[\s  _']/g, "");
    if (t.includes(",")) {
      if ((t.match(/,/g) || []).length > 1) return NaN;
      t = t.replace(/\./g, "").replace(",", ".");
    } else {
      const dots = (t.match(/\./g) || []).length;
      if (dots > 1 || /^[-+]?[1-9]\d{0,2}\.\d{3}(?!\d)/.test(t) && !/e/i.test(t)) {
        if (!/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) return NaN;
        t = t.replace(/\./g, "");
      }
    }
  } else {
    t = t.replace(/[\s,_]/g, "");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

const dfCache = new Map();
export function dateFormat(opts = {}) {
  const k = JSON.stringify(opts);
  if (!dfCache.has(k)) dfCache.set(k, new Intl.DateTimeFormat(LOCALE, opts));
  return dfCache.get(k);
}

/* "a, b and c" in the page's language. */
export function listText(items, type = "conjunction") {
  return new Intl.ListFormat(LOCALE, { style: "long", type }).format(items.map(String));
}
