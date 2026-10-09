// Text from PDF pages: turns the items pdf.js reports for a page into plain text lines and paragraphs.
// Pure functions (no DOM, no UI strings), so they can be tested with plain node.
//
// An item looks like { str, transform: [a, b, c, d, e, f], width, height, hasEOL }: the text of one run, where it
// starts (e, f = x and baseline y in points, y growing upwards), the font height, and whether pdf.js saw a line
// break after it. Items with no str (marked-content markers) are ignored. Items keep the order of the PDF's content
// stream, which is the reading order for most documents and for columns; they are not re-sorted by position.

const LIGATURES = { "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st" };

/* Make extracted text paste-ready: ligature glyphs back to letters, no-break spaces to spaces, soft hyphens and
   control characters dropped, Unicode line and paragraph separators to line breaks. */
export function cleanText(s) {
  return String(s)
    .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c])
    .replace(/\u00a0/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/* The usual line spacing: the median of the smaller half of the gaps, so that a few big gaps (paragraphs, headings)
   and a few unusually small ones do not move it. */
const usualGap = (gaps) => {
  const s = [...gaps].sort((a, b) => a - b).slice(0, Math.ceil(gaps.length / 2));
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* How far a run's baseline lies along the normal of its text direction, so that lines read top to bottom whichever way the
   text is turned: for ordinary horizontal text that is just the y position. */
function baseline(t) {
  const a = Number(t[0]) || 0, b = Number(t[1]) || 0, e = Number(t[4]) || 0, f = Number(t[5]) || 0;
  if (Math.abs(b) <= Math.abs(a) * 0.2) return f;
  return (a * f - b * e) / (Math.hypot(a, b) || 1);
}

/* The text of one page. Lines break where pdf.js reports an end of line or where the baseline moves by more than half
   a font height; a blank line is added where the gap between two lines is clearly bigger than this page's usual line
   spacing (worked out once there are enough lines to tell; a few lines are compared with their font height) (a new paragraph, a heading, the next column). Returns { text, lines } where lines is the number of text lines. */
export function pageText(items) {
  const lines = [];
  let cur = null;
  const flush = () => { if (cur) { lines.push(cur); cur = null; } };
  for (const it of items || []) {
    if (!it || typeof it.str !== "string") continue;
    if (it.str === "") { if (it.hasEOL) flush(); continue; }
    const t = it.transform || [];
    const y = baseline(t);
    const size = Math.abs(Number(it.height)) || Math.abs(Number(t[3])) || 0;
    if (cur && Math.abs(y - cur.y) > 0.5 * Math.max(size, cur.size, 1)) flush();
    if (!cur) cur = { text: "", y, size: 0 };
    cur.text += it.str;
    if (size > cur.size) cur.size = size;
    if (it.hasEOL) flush();
  }
  flush();

  const kept = lines.map((l) => ({ ...l, text: cleanText(l.text).replace(/[ \t]+$/, "") })).filter((l) => l.text.trim() !== "");
  const gaps = [];
  for (let i = 1; i < kept.length; i++) {
    const dy = kept[i - 1].y - kept[i].y;
    if (dy > 0) gaps.push(dy);
  }
  const usual = gaps.length >= 3 ? usualGap(gaps) : 0;
  const out = [];
  kept.forEach((l, i) => {
    if (i) {
      const prev = kept[i - 1];
      const dy = prev.y - l.y;
      const unit = Math.max(1, Math.min(prev.size || l.size, l.size || prev.size));
      const gap = usual ? usual * 1.3 : unit * 1.6;
      if (dy > Math.max(gap, unit * 1.05) || dy < -unit) out.push("");
    }
    out.push(l.text);
  });
  return { text: out.join("\n"), lines: kept.length };
}

/* The pages as one text. pages: [{ n, text }] with 1-based page numbers. With marks, every page starts with
   label(n) (for example "--- Page 3 ---"); without, pages with no text are left out. Pages are separated by a blank line. */
export function joinPages(pages, { marks = false, label = (n) => `--- Page ${n} ---` } = {}) {
  const parts = [];
  for (const p of pages) {
    const text = p.text || "";
    if (marks) parts.push(text ? `${label(p.n)}\n\n${text}` : label(p.n));
    else if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/* Words in a text: Intl.Segmenter where the browser has it (it also splits Chinese, Japanese and Thai), otherwise runs of letters and digits. */
export function countWords(text, seg = segmenter) {
  const s = String(text);
  if (seg) {
    let n = 0;
    for (const part of seg.segment(s)) if (part.isWordLike) n++;
    return n;
  }
  return (s.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'\u2019-]*/gu) || []).length;
}

/* Characters, counted as code points, without line breaks. */
export function countChars(text) {
  let n = 0;
  for (const ch of String(text)) if (ch !== "\n" && ch !== "\r") n++;
  return n;
}

/* A file name for the .txt download: the PDF's name without its extension. */
export function txtName(pdfName) {
  const base = String(pdfName || "").replace(/[\\/]+/g, "_").replace(/\.pdf$/i, "").replace(/\.+$/, "");
  return (base || "document") + ".txt";
}
