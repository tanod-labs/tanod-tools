import { loadScript } from "./vendorload.js?v=11";
import { initFormatter, loadFailed, $, $$ } from "./fmtcore.js?v=11";
import { tx } from "./core.js?v=11";

/* ---------------------------------------------------------------- minifier
   A tokenizer, not a pile of regular expressions: strings, url(...) and comments are recognised first, so
   nothing inside them is touched. Only whitespace and comments are removed, plus the last ";" in a block.
   No value is rewritten (no colour shortening, no unit or zero trimming). */

const WS = " \t\n\r\f";
const SPECIAL = "{};,:()[]>~+\"'";
const isHex = (c) => /[0-9a-fA-F]/.test(c);
const URLISH = /(^|[^\w-])(url|url-prefix|domain)$/i;

export function minifyCss(src, { keepLicence = true } = {}) {
  const n = src.length;
  const out = [];
  let i = 0, pending = false, glue = false, lastKind = "", lastText = "";
  let paren = 0, bracket = 0, stmtFirst = null, stmtKind = null;

  const skipString = (j) => {
    const q = src[j];
    j++;
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") j += 2;
      else if (ch === q) return j + 1;
      else if (ch === "\n") return j; // unterminated string ends at the line break
      else j++;
    }
    return n;
  };
  const skipEscape = (j) => { // j is at a backslash; a hex escape swallows one trailing whitespace
    j++;
    if (j < n && isHex(src[j])) {
      let k = 0;
      while (j < n && k < 6 && isHex(src[j])) { j++; k++; }
      if (src.startsWith("\r\n", j)) j += 2; else if (j < n && WS.includes(src[j])) j++;
      return j;
    }
    return Math.min(j + 1, n);
  };
  /* Does the statement starting here end in "{" (a rule or at-rule block, so its text is a selector or
     prelude) or in ";" / "}" (a declaration)? Decided once per statement. */
  const kind = () => {
    if (stmtKind) return stmtKind;
    let p = 0, b = 0;
    for (let j = i; j < n;) {
      const ch = src[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === '"' || ch === "'") { j = skipString(j); continue; }
      if (ch === "/" && src[j + 1] === "*") { const e = src.indexOf("*/", j + 2); j = e < 0 ? n : e + 2; continue; }
      if (ch === "(") p++;
      else if (ch === ")") { if (p) p--; } else if (ch === "[") b++;
      else if (ch === "]") { if (b) b--; } else if (!p && !b) {
        if (ch === "{") return (stmtKind = "block");
        if (ch === ";" || ch === "}") return (stmtKind = "decl");
      }
      j++;
    }
    return (stmtKind = "decl");
  };
  const emit = (text, k, stripBefore = false, stripAfter = false) => {
    if (pending && !glue && out.length && !stripBefore) out.push(" ");
    out.push(text);
    lastKind = k; lastText = text;
    pending = false;
    glue = stripAfter;
    if (stmtFirst === null) stmtFirst = text;
  };
  const endStatement = () => { if (paren === 0) { stmtFirst = null; stmtKind = null; } };

  while (i < n) {
    const c = src[i];
    if (WS.includes(c)) { while (i < n && WS.includes(src[i])) i++; pending = true; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      if (keepLicence && src[i + 2] === "!") emit(src.slice(i, end), "comment", true, true);
      else pending = true;
      i = end;
      continue;
    }
    if (c === '"' || c === "'") { const e = skipString(i); emit(src.slice(i, e), "str"); i = e; continue; }
    if (c === "{") { emit("{", "{", true, true); paren = 0; bracket = 0; i++; stmtFirst = null; stmtKind = null; continue; }
    if (c === "}") {
      if (lastKind === ";") out.pop();
      emit("}", "}", true, true); paren = 0; bracket = 0; i++; stmtFirst = null; stmtKind = null; continue;
    }
    if (c === ";") {
      if (paren === 0 && (lastKind === ";" || lastKind === "{")) { pending = false; i++; continue; }
      emit(";", ";", true, true); i++; endStatement(); continue;
    }
    if (c === ",") { emit(",", ",", true, true); i++; continue; }
    if (c === "(") {
      if (lastKind === "word" && !pending && URLISH.test(lastText)) {
        let k = i + 1;
        while (k < n && WS.includes(src[k])) k++;
        if (k < n && src[k] !== '"' && src[k] !== "'") { // unquoted url(...): copy as is
          let m = k;
          while (m < n && src[m] !== ")") m += src[m] === "\\" ? 2 : 1;
          emit("(" + src.slice(k, Math.min(m, n)).trimEnd() + (m < n ? ")" : ""), "url");
          i = Math.min(m + 1, n);
          continue;
        }
      }
      emit("(", "(", false, true); paren++; i++; continue;
    }
    if (c === ")") { emit(")", ")", true, false); if (paren) paren--; i++; continue; }
    if (c === "[") { emit("[", "[", false, true); bracket++; i++; continue; }
    if (c === "]") { emit("]", "]", true, false); if (bracket) bracket--; i++; continue; }
    if (c === ":") {
      const flat = paren === 0 && bracket === 0;
      const tight = flat ? (stmtFirst !== null && stmtFirst[0] === "@" ? false : kind() === "decl") : (paren > 0 && bracket === 0 && stmtFirst !== null && stmtFirst[0] === "@");
      emit(":", ":", tight, tight); i++; continue;
    }
    if ((c === ">" || c === "~" || c === "+") && paren === 0 && bracket === 0 && kind() === "block") {
      emit(c, c, true, true); i++; continue;
    }
    // a word: anything up to whitespace, a delimiter, a quote or a comment
    let j = i;
    while (j < n) {
      const ch = src[j];
      if (WS.includes(ch) || SPECIAL.includes(ch) || (ch === "/" && src[j + 1] === "*")) break;
      j = ch === "\\" ? skipEscape(j) : j + 1;
    }
    if (j === i) j = i + 1; // a delimiter that was left as an ordinary character (>, ~, + inside a value)
    emit(src.slice(i, j), "word");
    i = j;
  }
  return out.join("");
}

/* ---------------------------------------------------------------- page */

let lib = null;
const ready = () => (lib ? Promise.resolve(lib) : loadScript("/tools/vendor/js-beautify/beautifier.min.js", "beautifier").then((l) => { lib = l; return l; }, loadFailed));

/* The browser's own reading of a stylesheet, for an independent comparison of before and after. Selectors are
   compared exactly as the browser normalises them (so a lost descendant space shows up). Values it keeps
   verbatim (var(), custom properties, @supports conditions) are compared with insignificant whitespace
   removed, outside strings. */
const looseWs = (s) => s.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([^"']+)/g,
  (m, str, other) => str || other.replace(/\s+/g, " ").replace(/ ?([,;:(){}]) ?/g, "$1"));
function ruleText(rule) {
  if (rule.style && rule.selectorText !== undefined) {
    let s = rule.selectorText + "{";
    for (const name of rule.style) s += `${name}:${looseWs(rule.style.getPropertyValue(name)).trim()}${rule.style.getPropertyPriority(name)};`;
    if (rule.cssRules) for (const r of rule.cssRules) s += ruleText(r);
    return s + "}";
  }
  const css = rule.cssText;
  if (rule.cssRules) {
    const head = css.slice(0, css.indexOf("{"));
    return looseWs(head).trim() + "{" + Array.from(rule.cssRules, ruleText).join("") + "}";
  }
  return looseWs(css).trim();
}
function sheetText(css) {
  const s = new CSSStyleSheet();
  s.replaceSync(css.replace(/@import\b[^;]*;?/gi, ""));
  return Array.from(s.cssRules, ruleText).join("\n");
}
function sameInBrowser(a, b) {
  try { return sheetText(a) === sheetText(b); } catch (_) { return true; /* no CSSStyleSheet constructor: nothing to compare */ }
}

if (document.querySelector("#f-in")) {
  const SAMPLE = `/*! Example v1.0 | MIT */
/* layout */
.card > .title,
.card ~ .note {
  margin : 0 auto ;
  width: calc( 100% - 2 * var(--gap , 8px) );
  background: url( "img/a b.png" ) no-repeat ;
  font-family: "Helvetica Neue" , Arial , sans-serif;
}

@media screen and (min-width : 600px) {
  .card:is(.a , .b) a:hover { color: #336699 !important; }
}
`;
  const modeNow = () => $("input[name='mode']:checked").value;
  const sync = () => {
    const min = modeNow() === "min";
    $("#o-licence").disabled = !min;
    $("#o-indent-field").hidden = min;
  };
  sync();
  $$("input[name='mode']").forEach((r) => r.addEventListener("change", sync));
  initFormatter({
    label: "CSS",
    ready,
    loaded: () => !!lib,
    triggers: $$("input[name='mode'], input[name='indent'], #o-licence"),
    sample: SAMPLE,
    filename: "styles.css",
    mime: "text/css",
    done: (r) => (r.mode === "min" ? tx("Minified.") : tx("Beautified.")),
    format(text) {
      const min = modeNow() === "min";
      let out;
      if (min) out = minifyCss(text, { keepLicence: $("#o-licence").checked });
      else {
        const ind = $("input[name='indent']:checked").value;
        out = lib.css(text, { indent_size: ind === "tab" ? 1 : Number(ind), indent_char: ind === "tab" ? "\t" : " ", indent_with_tabs: ind === "tab", end_with_newline: false });
      }
      const ok = sameInBrowser(text, out);
      return {
        out,
        mode: min ? "min" : "beautify",
        warn: !ok,
        note: ok ? "" : tx("Your browser reads the result differently from the original. Compare the two before using it, and keep the original if in doubt."),
      };
    },
  });
}
