import { $, live, wireCopy, downloadButton, fmtInt, normalizeNewlines, tx, txn } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const MAX_LINES = 10000;

const MAP = {
  // Latin letters that don't decompose into a base letter plus an accent
  "ß": "ss", "æ": "ae", "ø": "o", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ł": "l", "ı": "i", "ħ": "h", "ŧ": "t",
  // Cyrillic (Russian, Ukrainian, Belarusian)
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z", "и": "i", "й": "y",
  "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
  "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
  "є": "ye", "і": "i", "ї": "yi", "ґ": "g", "ў": "u",
  // Greek
  "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k", "λ": "l",
  "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "φ": "f",
  "χ": "ch", "ψ": "ps", "ω": "o",
};

function mapChars(s) {
  let r = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const m = MAP[lower];
    if (m === undefined) { r += ch; continue; }
    r += ch !== lower && m ? m[0].toUpperCase() + m.slice(1) : m;
  }
  return r;
}

/* Latin transliteration: special letters, then strip accents, then letters that only map once bare (Greek with tonos). */
export function transliterate(s) {
  return mapChars(mapChars(s).normalize("NFKD").replace(/\p{M}+/gu, "")).normalize("NFC");
}

const STOP = new Set("a an the and or but nor of to in on at for with by from as is are into via vs".split(" "));

/* o: {sep, lower, ascii, amp, stop, max}. Returns {slug, dropped}. */
export function slugify(line, o) {
  let s = line;
  if (o.amp) s = s.replace(/&/g, " and ");
  if (o.ascii) s = transliterate(s);
  s = s.replace(/['’ʼ`´]/g, "");
  if (o.lower) s = s.toLowerCase();
  let dropped = 0;
  let words;
  if (o.ascii) {
    dropped = (s.match(/[^\x00-\x7f]/gu) || []).filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
    words = s.match(/[A-Za-z0-9]+/g) || [];
  } else {
    words = s.match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  }
  if (o.stop) {
    const kept = words.filter((w) => !STOP.has(w.toLowerCase()));
    if (kept.length) words = kept;
  }
  let slug = words.join(o.sep);
  if (o.max > 0 && slug.length > o.max) {
    let cut = "";
    for (const w of words) {
      const next = cut ? cut + o.sep + w : w;
      if (next.length > o.max) break;
      cut = next;
    }
    slug = cut || Array.from(words[0]).slice(0, o.max).join("");
  }
  return { slug, dropped };
}

function opts() {
  const max = parseInt($("#max").value, 10);
  return {
    sep: document.querySelector('input[name="sep"]:checked').value,
    lower: $("#lower").checked, ascii: $("#ascii").checked, amp: $("#amp").checked, stop: $("#stop").checked,
    max: Number.isFinite(max) && max > 0 ? max : 0,
  };
}

function update() {
  const o = opts();
  let lines = normalizeNewlines(area.value).split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const over = lines.length > MAX_LINES;
  lines = lines.slice(0, MAX_LINES);
  let dropped = 0;
  const slugs = lines.map((l) => { const r = slugify(l, o); dropped += r.dropped; return r.slug; });
  out.value = slugs.join("\n");
  const first = slugs.find((s) => s) || "";
  $("#preview-slug").textContent = first || tx("your-slug-here");
  const has = !!area.value.trim();
  const n = slugs.filter((s) => s).length;
  const parts = [];
  if (has) {
    const slugs = txn(n, "{n} slug", "{n} slugs");
    parts.push(n === 1 ? tx("{slugs}, {len} characters", { slugs, len: fmtInt(first.length) }) : slugs);
  }
  if (dropped) parts.push(txn(dropped, "{n} character with no Latin equivalent dropped (turn off ASCII only to keep them)", "{n} characters with no Latin equivalent dropped (turn off ASCII only to keep them)"));
  if (over) parts.push(tx("only the first {n} lines were converted", { n: fmtInt(MAX_LINES) }));
  if (has && !n) parts.push(tx("nothing usable left: the text has no letters or digits"));
  $("#report").textContent = has ? parts.join("; ") + "." : tx("Type a title to begin.");
  $("#copy").disabled = $("#dl").disabled = !n;
  $("#clear").disabled = !area.value;
}

const controls = [area, $("#max"), $("#lower"), $("#ascii"), $("#amp"), $("#stop"), ...document.querySelectorAll('input[name="sep"]')];
live(() => area.value, controls, update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "slugs.txt"), { id: "dl" }));
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
update();
