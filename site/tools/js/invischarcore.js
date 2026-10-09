// Invisible character detector: classification of hidden and look-alike characters. Pure functions, no DOM and no
// UI strings; the tool module adds the wording. Positions are code points (1-based) plus line and column.

/* category ids, in display order */
export const CATEGORIES = ["zero-width", "bidi", "tag", "control", "invisible", "space", "mixed"];
/* categories whose characters the "clean" copy removes (spaces are optionally replaced, mixed words are left alone) */
export const REMOVABLE = new Set(["zero-width", "bidi", "tag", "control", "invisible"]);

const NAMES = {
  0x00ad: "SOFT HYPHEN", 0x034f: "COMBINING GRAPHEME JOINER", 0x061c: "ARABIC LETTER MARK",
  0x115f: "HANGUL CHOSEONG FILLER", 0x1160: "HANGUL JUNGSEONG FILLER", 0x17b4: "KHMER VOWEL INHERENT AQ",
  0x17b5: "KHMER VOWEL INHERENT AA", 0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x200b: "ZERO WIDTH SPACE", 0x200c: "ZERO WIDTH NON-JOINER", 0x200d: "ZERO WIDTH JOINER",
  0x200e: "LEFT-TO-RIGHT MARK", 0x200f: "RIGHT-TO-LEFT MARK",
  0x202a: "LEFT-TO-RIGHT EMBEDDING", 0x202b: "RIGHT-TO-LEFT EMBEDDING", 0x202c: "POP DIRECTIONAL FORMATTING",
  0x202d: "LEFT-TO-RIGHT OVERRIDE", 0x202e: "RIGHT-TO-LEFT OVERRIDE",
  0x2060: "WORD JOINER", 0x2061: "FUNCTION APPLICATION", 0x2062: "INVISIBLE TIMES", 0x2063: "INVISIBLE SEPARATOR",
  0x2064: "INVISIBLE PLUS",
  0x2066: "LEFT-TO-RIGHT ISOLATE", 0x2067: "RIGHT-TO-LEFT ISOLATE", 0x2068: "FIRST STRONG ISOLATE", 0x2069: "POP DIRECTIONAL ISOLATE",
  0x206a: "INHIBIT SYMMETRIC SWAPPING", 0x206b: "ACTIVATE SYMMETRIC SWAPPING", 0x206c: "INHIBIT ARABIC FORM SHAPING",
  0x206d: "ACTIVATE ARABIC FORM SHAPING", 0x206e: "NATIONAL DIGIT SHAPES", 0x206f: "NOMINAL DIGIT SHAPES",
  0x3164: "HANGUL FILLER", 0xfeff: "ZERO WIDTH NO-BREAK SPACE (BYTE ORDER MARK)", 0xffa0: "HALFWIDTH HANGUL FILLER",
  0x00a0: "NO-BREAK SPACE", 0x1680: "OGHAM SPACE MARK", 0x202f: "NARROW NO-BREAK SPACE", 0x205f: "MEDIUM MATHEMATICAL SPACE",
  0x3000: "IDEOGRAPHIC SPACE",
  0x2000: "EN QUAD", 0x2001: "EM QUAD", 0x2002: "EN SPACE", 0x2003: "EM SPACE", 0x2004: "THREE-PER-EM SPACE",
  0x2005: "FOUR-PER-EM SPACE", 0x2006: "SIX-PER-EM SPACE", 0x2007: "FIGURE SPACE", 0x2008: "PUNCTUATION SPACE",
  0x2009: "THIN SPACE", 0x200a: "HAIR SPACE",
  0x007f: "DELETE",
};
const C0 = ["NULL", "START OF HEADING", "START OF TEXT", "END OF TEXT", "END OF TRANSMISSION", "ENQUIRY", "ACKNOWLEDGE", "BELL",
  "BACKSPACE", "CHARACTER TABULATION", "LINE FEED", "LINE TABULATION", "FORM FEED", "CARRIAGE RETURN", "SHIFT OUT", "SHIFT IN",
  "DATA LINK ESCAPE", "DEVICE CONTROL ONE", "DEVICE CONTROL TWO", "DEVICE CONTROL THREE", "DEVICE CONTROL FOUR",
  "NEGATIVE ACKNOWLEDGE", "SYNCHRONOUS IDLE", "END OF TRANSMISSION BLOCK", "CANCEL", "END OF MEDIUM", "SUBSTITUTE", "ESCAPE",
  "INFORMATION SEPARATOR FOUR", "INFORMATION SEPARATOR THREE", "INFORMATION SEPARATOR TWO", "INFORMATION SEPARATOR ONE"];

export const hex = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

/* The Unicode name of a character this module knows about, or "" . */
export function charName(cp) {
  if (NAMES[cp]) return NAMES[cp];
  if (cp < 0x20) return C0[cp];
  if (cp >= 0x80 && cp <= 0x9f) return "C1 CONTROL";
  if (cp >= 0xfe00 && cp <= 0xfe0f) return "VARIATION SELECTOR-" + (cp - 0xfe00 + 1);
  if (cp >= 0xe0100 && cp <= 0xe01ef) return "VARIATION SELECTOR-" + (cp - 0xe0100 + 17);
  if (cp === 0xe0001) return "LANGUAGE TAG";
  if (cp === 0xe007f) return "CANCEL TAG";
  if (cp >= 0xe0020 && cp <= 0xe007e) return "TAG " + tagAscii(cp);
  if (cp >= 0xe0000 && cp <= 0xe007f) return "TAG (UNASSIGNED)";
  return "";
}

function tagAscii(cp) {
  const ch = String.fromCharCode(cp - 0xe0000);
  const lc = /[a-z]/.test(ch) ? "LATIN SMALL LETTER " + ch.toUpperCase() : /[A-Z]/.test(ch) ? "LATIN CAPITAL LETTER " + ch
    : /[0-9]/.test(ch) ? "DIGIT " + ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"][+ch]
    : ch === " " ? "SPACE" : JSON.stringify(ch);
  return lc;
}

/* Category of a single code point, ignoring context: one of CATEGORIES (not "mixed"), or null for ordinary text. */
export function categoryOf(cp) {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || cp === 0x180e) return "zero-width";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x061c) return "bidi";
  if (cp >= 0xe0000 && cp <= 0xe007f) return "tag";
  if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f)) return "control";
  if (cp === 0xad || cp === 0x34f || cp === 0x115f || cp === 0x1160 || cp === 0x17b4 || cp === 0x17b5 || cp === 0x3164 || cp === 0xffa0
    || (cp >= 0x2061 && cp <= 0x2064) || (cp >= 0x206a && cp <= 0x206f) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)
    || (cp >= 0x180b && cp <= 0x180d)) return "invisible";
  if (cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000) return "space";
  return null;
}

const RE_PICT = /\p{Extended_Pictographic}/u;
const RE_MOD = /\p{Emoji_Modifier}/u;
const isPict = (cp) => cp !== undefined && RE_PICT.test(String.fromCodePoint(cp));
const isMod = (cp) => cp !== undefined && RE_MOD.test(String.fromCodePoint(cp));
const isTagLetterOrDigit = (cp) => (cp >= 0xe0061 && cp <= 0xe007a) || (cp >= 0xe0030 && cp <= 0xe0039);

/* Length of a well-formed emoji tag sequence that starts with the tags at index i (after U+1F3F4): 2 to 6 tag letters or
   digits, then CANCEL TAG. Returns the number of code points to skip, or 0. */
function flagTagRun(cps, i) {
  let j = i;
  while (j < cps.length && isTagLetterOrDigit(cps[j])) j++;
  const n = j - i;
  return n >= 2 && n <= 6 && cps[j] === 0xe007f ? n + 1 : 0;
}

/* Is the ZWJ at index i joining two emoji? (an emoji or emoji + modifier / VS16 before it, an emoji after it) */
function zwjBetweenEmoji(cps, i) {
  let k = i - 1;
  while (k >= 0 && (cps[k] === 0xfe0f || isMod(cps[k]))) k--;
  return k >= 0 && isPict(cps[k]) && isPict(cps[i + 1]);
}

/* Is the variation selector at index i (FE0E or FE0F) attached to an emoji or to a keycap base? */
function vsAfterEmoji(cps, i) {
  const p = cps[i - 1];
  if (p === undefined) return false;
  if (isPict(p)) return true;
  return ((p >= 0x30 && p <= 0x39) || p === 0x23 || p === 0x2a) && cps[i + 1] === 0x20e3;
}

const SCRIPTS = [["Latin", /\p{Script=Latin}/u], ["Cyrillic", /\p{Script=Cyrillic}/u], ["Greek", /\p{Script=Greek}/u], ["Armenian", /\p{Script=Armenian}/u]];
const scriptOf = (ch) => { for (const [n, re] of SCRIPTS) if (re.test(ch)) return n; return null; };
const RE_WORD = /[\p{L}\p{M}\p{N}_'’]+/gu;

/* Decode a run of tag characters to the ASCII they spell (E0020..E007E), "" for tags that map to no printable character. */
export function decodeTags(cps) {
  let s = "";
  for (const cp of cps) if (cp >= 0xe0020 && cp <= 0xe007e) s += String.fromCharCode(cp - 0xe0000);
  return s;
}

/* Analyse text. Returns:
   findings  [{ category, cp, cps, index (1-based code point position), offset (UTF-16 index), line, col, name, decoded?, script? , word? }]
   total     number of code points
   Consecutive tag characters form one finding (cps lists them all, decoded is the ASCII they spell).
   Not flagged: well-formed emoji tag sequences (U+1F3F4 + 2-6 tags + U+E007F), ZWJ between two emoji, FE0F / FE0E after an emoji or keycap base. */
export function analyze(text) {
  const cps = Array.from(text, (c) => c.codePointAt(0));
  const findings = [];
  // line and column of each code point
  let line = 1, col = 1, off = 0;
  const where = [];
  for (let i = 0; i < cps.length; i++) {
    where.push({ line, col, off });
    off += cps[i] > 0xffff ? 2 : 1;
    if (cps[i] === 0x0a) { line++; col = 1; } else if (cps[i] === 0x0d && cps[i + 1] !== 0x0a) { line++; col = 1; } else col++;
  }
  const add = (i, category, extra = {}) => findings.push({ category, cp: cps[i], cps: [cps[i]], index: i + 1, offset: where[i].off, line: where[i].line, col: where[i].col, name: charName(cps[i]), ...extra });

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp === 0x1f3f4) {
      const skip = flagTagRun(cps, i + 1);
      if (skip) { i += skip; continue; }
    }
    const cat = categoryOf(cp);
    if (!cat) continue;
    if (cp === 0x200d && zwjBetweenEmoji(cps, i)) continue;
    if ((cp === 0xfe0f || cp === 0xfe0e) && vsAfterEmoji(cps, i)) continue;
    if (cat === "tag") {
      let j = i;
      while (j + 1 < cps.length && categoryOf(cps[j + 1]) === "tag") j++;
      const run = cps.slice(i, j + 1);
      add(i, "tag", { cps: run, decoded: decodeTags(run), name: run.length > 1 ? "" : charName(cp) });
      i = j;
      continue;
    }
    add(i, cat);
  }

  // words that mix Latin with Cyrillic, Greek or Armenian letters
  for (const m of text.matchAll(RE_WORD)) {
    const word = m[0];
    const scripts = new Set();
    const odd = [];
    for (const ch of word) {
      const s = scriptOf(ch);
      if (s) { scripts.add(s); if (s !== "Latin") odd.push(ch); }
    }
    if (scripts.has("Latin") && scripts.size > 1) {
      const idx = Array.from(text.slice(0, m.index)).length;
      findings.push({
        category: "mixed", cp: word.codePointAt(0), cps: Array.from(word, (c) => c.codePointAt(0)), index: idx + 1,
        offset: m.index, line: where[idx]?.line ?? 1, col: where[idx]?.col ?? 1, name: "",
        word, scripts: [...scripts], odd,
      });
    }
  }
  findings.sort((a, b) => a.offset - b.offset);
  return { findings, total: cps.length };
}

/* Counts per category: { "zero-width": n, ... } (every category present). A tag run counts as its length. */
export function counts(findings) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const f of findings) out[f.category] += f.category === "tag" ? f.cps.length : 1;
  return out;
}

/* The text with the invisible characters removed (zero-width, bidi, tag, control, other invisible).
   Options: spaces - replace unusual spaces with an ordinary space. Mixed-script words are never changed. */
export function clean(text, { spaces = false, keep = [] } = {}) {
  const cps = Array.from(text, (c) => c.codePointAt(0));
  const drop = new Set();
  const spaceAt = new Set();
  const { findings } = analyze(text);
  for (const f of findings) {
    if (f.category === "mixed" || keep.includes(f.category)) continue;
    if (f.category === "space") { if (spaces) spaceAt.add(f.index - 1); continue; }
    for (let k = 0; k < f.cps.length; k++) drop.add(f.index - 1 + k);
  }
  let out = "";
  for (let i = 0; i < cps.length; i++) {
    if (drop.has(i)) continue;
    out += spaceAt.has(i) ? " " : String.fromCodePoint(cps[i]);
  }
  return out;
}
