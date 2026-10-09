// Markdown table generator: reading pasted CSV / TSV / Markdown tables and writing GitHub-flavored Markdown. Pure functions.

/* Parse delimited text (RFC 4180 quoting, quoted fields may hold line breaks). Returns string[][] (blank lines skipped). */
export function parseDelimited(text, delim) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", quoted = false, i = 0, any = false;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "" || any) rows.push(row);
    row = []; field = ""; any = false;
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; any = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; any = true; i++; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow(); i++; continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length || any) endRow();
  return rows;
}

/* Pick the delimiter that gives the most consistent columns: tab, semicolon, pipe or comma. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",", bestScore = 0;
  for (const d of ["\t", ";", "|", ","]) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min > 0 && min * (counts.every((c) => c === counts[0]) ? 2 : 1) > bestScore) { best = d; bestScore = min * (counts.every((c) => c === counts[0]) ? 2 : 1); }
  }
  return best;
}

/* Does the text look like a Markdown table (a header row followed by a ---|--- delimiter row)? */
export function looksLikeMarkdownTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && /\|/.test(lines[0]) && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[1]) && /\|/.test(lines[1]);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; } else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/* Parse a Markdown table into { rows, aligns } (aligns: "left" | "center" | "right" | "none" per column). */
export function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((c) => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : "none"));
  const rows = [head, ...lines.slice(2).map(splitRow)];
  return normalize(rows, aligns);
}

/* Make every row the same width (the widest) and give every column an alignment. */
export function normalize(rows, aligns = []) {
  const w = Math.max(1, ...rows.map((r) => r.length), aligns.length);
  return {
    rows: rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? "")),
    aligns: Array.from({ length: w }, (_, i) => aligns[i] || "none"),
  };
}

/* Escape a cell: pipes, and line breaks as <br>. */
export function escapeCell(s) {
  return String(s).replace(/\\(?=\|)/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

const cellWidth = (s) => Array.from(s).length;

/* GitHub-flavored Markdown. opts.pad: line the columns up with spaces. opts.header: the first row is the header (always true in GFM:
   without it an empty header row is written). */
export function toMarkdown(rows, aligns, { pad = true, header = true } = {}) {
  const { rows: r0, aligns: al } = normalize(rows, aligns);
  const data = header ? r0 : [r0[0].map(() => ""), ...r0];
  const cells = data.map((row) => row.map(escapeCell));
  const widths = al.map((_, c) => Math.max(3, ...cells.map((row) => cellWidth(row[c]))));
  const fit = (s, c) => {
    if (!pad) return s;
    const gap = widths[c] - cellWidth(s);
    if (al[c] === "right") return " ".repeat(gap) + s;
    if (al[c] === "center") { const l = Math.floor(gap / 2); return " ".repeat(l) + s + " ".repeat(gap - l); }
    return s + " ".repeat(gap);
  };
  const line = (row) => "| " + row.map(fit).join(" | ") + " |";
  const rule = al.map((a, c) => {
    const w = pad ? widths[c] : 3;
    return a === "center" ? ":" + "-".repeat(w - 2) + ":" : a === "right" ? "-".repeat(w - 1) + ":" : a === "left" ? ":" + "-".repeat(w - 1) : "-".repeat(w);
  });
  return [line(cells[0]), "| " + rule.join(" | ") + " |", ...cells.slice(1).map(line)].join("\n");
}

/* Grid edits: all return new arrays. */
export const addRow = (rows, at = rows.length) => { const w = rows[0]?.length || 1; const n = rows.slice(); n.splice(at, 0, Array(w).fill("")); return n; };
export const removeRow = (rows, at) => (rows.length > 1 ? rows.filter((_, i) => i !== at) : rows);
export function addColumn(rows, aligns, at = aligns.length) {
  return { rows: rows.map((r) => { const n = r.slice(); n.splice(at, 0, ""); return n; }), aligns: [...aligns.slice(0, at), "none", ...aligns.slice(at)] };
}
export function removeColumn(rows, aligns, at) {
  if (aligns.length < 2) return { rows, aligns };
  return { rows: rows.map((r) => r.filter((_, i) => i !== at)), aligns: aligns.filter((_, i) => i !== at) };
}
