import { $, el, live, openTextFile, fmtInt, tx, txn, wireCopy, announce } from "./textcore.js?v=5";
import { analyse, countLines } from "./wordcore.js?v=5";

const area = $("#text");
const status = $("#status");

const graphemer = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/* Characters as a reader sees them (grapheme clusters); falls back to code points. */
export function graphemes(text) {
  if (!graphemer) return Array.from(text);
  const out = [];
  for (const s of graphemer.segment(text)) out.push(s.segment);
  return out;
}

const enc = new TextEncoder();

export function counts(raw) {
  const text = raw.replace(/\r\n?/g, "\n");
  const g = graphemes(text);
  let nospace = 0, letters = 0, digits = 0, spaces = 0;
  for (const c of g) {
    if (/^\s+$/u.test(c)) { if (c !== "\n") spaces++; continue; }
    nospace++;
    if (/^\p{L}/u.test(c)) letters++;
    else if (/^\p{Nd}/u.test(c)) digits++;
  }
  const a = analyse(text);
  return {
    text, graphemes: g,
    chars: g.length, nospace, letters, digits, spaces,
    words: a.nWords, lines: countLines(text),
    codepoints: a.chars,
    bytes: enc.encode(text).length,
  };
}

/* ------------------------------------------------------------------ X (Twitter) weighting
   Follows the published counting rules: text is NFC-normalised, each web link counts 23,
   each emoji counts 2, characters in the common Latin/punctuation ranges count 1 and the rest 2. */
const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|dev|io|co|ly|me|app|info|edu|gov)(?:\/[^\s]*)?/giu;
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function xWeight(raw) {
  let text = raw.normalize("NFC");
  let n = 0;
  text = text.replace(URL_RE, () => { n += 23; return ""; });
  for (const g of graphemes(text)) {
    if (EMOJI.test(g)) { n += 2; continue; }
    for (const ch of g) {
      const cp = ch.codePointAt(0);
      n += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ SMS (GSM 03.38) */
const GSM = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const GSM_EXT = new Set(Array.from("^{}\\[~]|€\f"));

export function sms(text) {
  let units = 0, gsm = true;
  for (const ch of text) {
    if (GSM.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (!gsm) units = text.length; // UTF-16 code units
  const single = gsm ? 160 : 70, part = gsm ? 153 : 67;
  const parts = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / part);
  const left = parts <= 1 ? single - units : parts * part - units;
  return { encoding: gsm ? "GSM-7" : "Unicode", units, parts, left, single };
}

const LIMITS = [
  { where: tx("X (Twitter) post"), limit: 280, kind: "x" },
  { where: tx("Text message (SMS)"), kind: "sms" },
  { where: tx("Title tag (search results)"), limit: 60, note: "about" },
  { where: tx("Meta description"), limit: 160, note: "about" },
  { where: tx("YouTube title"), limit: 100 },
  { where: tx("Instagram caption"), limit: 2200 },
  { where: tx("LinkedIn post"), limit: 3000 },
];

function leftCell(left) {
  if (left >= 0) return el("td", { class: "num", "data-label": tx("Left") }, fmtInt(left));
  return el("td", { class: "num cc-over", "data-label": tx("Left") }, el("span", { class: "cc-over__mark", "aria-hidden": "true" }), tx("{n} over", { n: fmtInt(-left) }));
}

function renderLimits(c) {
  const rows = [];
  for (const L of LIMITS) {
    if (L.kind === "sms") {
      const s = sms(c.text);
      rows.push(el("tr", {},
        el("th", { scope: "row" }, L.where),
        el("td", { "data-label": tx("Limit") }, `${fmtInt(s.single)} (${s.encoding})`),
        el("td", { "data-label": tx("Used") }, `${fmtInt(s.units)} · ${txn(s.parts, "{n} message", "{n} messages")}`),
        el("td", { class: "num", "data-label": tx("Left") }, s.parts ? fmtInt(s.left) : fmtInt(s.single))));
      continue;
    }
    // Past 10,000 characters a post is far over any limit; skip the slower weighting.
    const used = L.kind === "x" ? (c.text.length > 10000 ? c.chars : xWeight(c.text)) : c.chars;
    rows.push(el("tr", {},
      el("th", { scope: "row" }, L.where),
      el("td", { "data-label": tx("Limit") }, L.note ? tx("about {n}", { n: fmtInt(L.limit) }) : fmtInt(L.limit)),
      el("td", { class: "num", "data-label": tx("Used") }, fmtInt(used)),
      leftCell(L.limit - used)));
  }
  $("#lim-body").replaceChildren(...rows);
}

const set = (id, v) => { $(id).textContent = v; };

function update() {
  const c = counts(area.value);
  set("#c-chars", fmtInt(c.chars));
  set("#c-nospace", fmtInt(c.nospace));
  set("#c-letters", fmtInt(c.letters));
  set("#c-digits", fmtInt(c.digits));
  set("#c-spaces", fmtInt(c.spaces));
  set("#c-words", fmtInt(c.words));
  set("#c-lines", fmtInt(c.lines));
  set("#c-cp", fmtInt(c.codepoints));
  set("#c-bytes", fmtInt(c.bytes));
  set("#bar-chars", fmtInt(c.chars));
  set("#bar-nospace", fmtInt(c.nospace));
  $("#clear").disabled = $("#copy").disabled = !area.value;
  renderLimits(c);
}

live(() => area.value, [area], update);
wireCopy($("#copy"), () => area.value);
$("#clear").addEventListener("click", () => {
  area.value = "";
  update();
  area.focus();
  announce(tx("Text cleared."));
});
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
