import { $, el, tick, openTextFile, wireCopy, setStatus, announce, fmtInt, normalizeNewlines, tx, txn } from "./textcore.js?v=5";

const a = $("#a"), b = $("#b"), view = $("#view"), status = $("#status"), go = $("#go");
const MAX_FINE = 300000; // characters for word and character modes
const CONTEXT = 3;

const val = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

function ensureNl(s) { s = normalizeNewlines(s); return s && !s.endsWith("\n") ? s + "\n" : s; }
const splitLines = (v) => { const l = v.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; };

function cell(kind, no, text) {
  const sign = kind === "add" ? "+" : kind === "del" ? "−" : "";
  return el("div", { class: "diff__cell" + (kind ? " diff__cell--" + kind : " diff__cell--same") },
    el("span", { class: "diff__no" }, no === null ? "" : String(no)),
    el("span", { class: "diff__sign", "aria-hidden": "true" }, sign),
    el("span", { class: "diff__txt" }, kind ? el("span", { class: "visually-hidden" }, kind === "add" ? tx("Added: ") : tx("Removed: ")) : null, text === null ? "" : text));
}
const emptyCell = () => el("div", { class: "diff__cell diff__cell--empty", "aria-hidden": "true" }, el("span", { class: "diff__no" }), el("span", { class: "diff__sign" }), el("span", { class: "diff__txt" }));

/* Turn jsdiff line parts into rows: {l:{no,text,kind}|null, r:{...}|null}. */
function lineRows(parts) {
  const rows = [];
  let ln = 1, rn = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = splitLines(p.value);
    if (!p.added && !p.removed) {
      for (const t of lines) rows.push({ l: { no: ln++, text: t }, r: { no: rn++, text: t }, same: true });
    } else if (p.removed) {
      const next = parts[i + 1];
      const adds = next && next.added ? splitLines(next.value) : [];
      if (next && next.added) i++;
      const n = Math.max(lines.length, adds.length);
      for (let k = 0; k < n; k++) rows.push({
        l: k < lines.length ? { no: ln++, text: lines[k], kind: "del" } : null,
        r: k < adds.length ? { no: rn++, text: adds[k], kind: "add" } : null,
      });
    } else {
      for (const t of lines) rows.push({ l: null, r: { no: rn++, text: t, kind: "add" } });
    }
  }
  return rows;
}

function renderLines(parts, side) {
  const rows = lineRows(parts);
  const box = el("div", { class: "diff " + (side ? "diff--side" : "diff--inline"), id: "diff-view" });
  const frag = document.createDocumentFragment();
  const showRow = (r) => {
    if (side) {
      frag.append(el("div", { class: "diff__row" },
        r.l ? cell(r.l.kind || "", r.l.no, r.l.text) : emptyCell(),
        r.r ? cell(r.r.kind || "", r.r.no, r.r.text) : emptyCell()));
    } else {
      if (r.same) frag.append(el("div", { class: "diff__row" }, cell("", r.r.no, r.r.text)));
      else {
        if (r.l) frag.append(el("div", { class: "diff__row" }, cell("del", r.l.no, r.l.text)));
        if (r.r) frag.append(el("div", { class: "diff__row" }, cell("add", r.r.no, r.r.text)));
      }
    }
  };
  // fold long unchanged runs
  let i = 0;
  while (i < rows.length) {
    if (!rows[i].same) { showRow(rows[i++]); continue; }
    let j = i;
    while (j < rows.length && rows[j].same) j++;
    const run = rows.slice(i, j);
    const head = i === 0 ? 0 : CONTEXT, tail = j === rows.length ? 0 : CONTEXT;
    if (run.length <= head + tail + 2) run.forEach(showRow);
    else {
      run.slice(0, head).forEach(showRow);
      const hidden = run.slice(head, run.length - tail);
      const btn = el("button", { type: "button", class: "diff__fold" }, txn(hidden.length, "{n} unchanged line (show)", "{n} unchanged lines (show)"));
      btn.addEventListener("click", () => {
        const tmp = document.createDocumentFragment();
        hidden.forEach((r) => tmp.append(side
          ? el("div", { class: "diff__row" }, cell("", r.l.no, r.l.text), cell("", r.r.no, r.r.text))
          : el("div", { class: "diff__row" }, cell("", r.r.no, r.r.text))));
        btn.replaceWith(tmp);
      });
      frag.append(btn);
      run.slice(run.length - tail).forEach(showRow);
    }
    i = j;
  }
  box.append(frag);
  return box;
}

function flow(parts, keepAdd, keepDel) {
  const d = el("div", { class: "diff__flow" });
  for (const p of parts) {
    if (p.added) { if (keepAdd) d.append(el("ins", {}, p.value)); }
    else if (p.removed) { if (keepDel) d.append(el("del", {}, p.value)); }
    else d.append(p.value);
  }
  return d;
}

function count(parts, mode) {
  let add = 0, del = 0;
  for (const p of parts) {
    const n = mode === "lines" ? splitLines(p.value).length
      : mode === "words" ? (p.value.match(/[^\s]+/g) || []).length
      : Array.from(p.value).length;
    if (p.added) add += n; else if (p.removed) del += n;
  }
  return { add, del };
}

async function compare() {
  const mode = val("mode"), side = val("layout") === "side";
  const opts = { ignoreCase: $("#ic").checked };
  let sa = normalizeNewlines(a.value), sb = normalizeNewlines(b.value);
  if (mode !== "lines" && sa.length + sb.length > MAX_FINE) {
    setStatus(status, "error", tx("That is too much text to compare word by word or character by character. Use Lines, or compare shorter parts."));
    return;
  }
  setStatus(status, "working", tx("Comparing…"));
  go.disabled = true;
  await tick();
  let parts;
  try {
    if (mode === "lines") {
      parts = Diff.diffLines(ensureNl(sa), ensureNl(sb), { ignoreCase: opts.ignoreCase, ignoreWhitespace: $("#iw").checked, timeout: 20000 });
    } else if (mode === "words") {
      parts = Diff.diffWordsWithSpace(sa, sb, { ignoreCase: opts.ignoreCase, timeout: 20000 });
    } else {
      parts = Diff.diffChars(sa, sb, { ignoreCase: opts.ignoreCase, timeout: 20000 });
    }
    if (!parts) throw new Error("timeout");
  } catch (e) {
    setStatus(status, "error", tx("These texts are too different to compare in a reasonable time. Try comparing smaller parts."));
    go.disabled = false;
    return;
  }
  await tick();
  const c = count(parts, mode);
  const plural = (n) => (mode === "lines" ? txn(n, "{n} line", "{n} lines") : mode === "words" ? txn(n, "{n} word", "{n} words") : txn(n, "{n} character", "{n} characters"));
  $("#sum-add").textContent = tx("{what} added", { what: plural(c.add) });
  $("#sum-del").textContent = tx("{what} removed", { what: plural(c.del) });
  $("#sum").hidden = false;
  const result = $("#result");
  result.replaceChildren();
  if (!c.add && !c.del) {
    result.append(el("p", { class: "note" }, tx("No differences found.")));
  } else if (mode === "lines") {
    result.append(renderLines(parts, side));
  } else {
    const wrap = el("div", { class: "diff " + (side ? "diff--side" : "diff--inline"), id: "diff-view" });
    if (side) wrap.append(el("div", { class: "diff__flows" }, flow(parts, false, true), flow(parts, true, false)));
    else wrap.append(flow(parts, true, true));
    result.append(wrap);
  }
  result.hidden = false;
  setStatus(status, "done", (c.add || c.del) ? tx("Found {added} added and {removed} removed.", { added: plural(c.add), removed: plural(c.del) }) : tx("The two texts are the same."));
  announce(tx("Comparison ready."));
  go.disabled = false;
}

function toggleIw() {
  const lines = val("mode") === "lines";
  $("#iw").disabled = !lines;
  if (!lines) $("#iw").checked = false;
}
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", toggleIw));
go.addEventListener("click", compare);
$("#swap").addEventListener("click", () => { const t = a.value; a.value = b.value; b.value = t; announce(tx("Swapped.")); if (!$("#result").hidden) compare(); });
$("#clear").addEventListener("click", () => { a.value = ""; b.value = ""; $("#result").hidden = true; $("#sum").hidden = true; setStatus(status, "idle"); a.focus(); });
document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener("change", () => { if (!$("#result").hidden) compare(); }));
let target = a;
a.addEventListener("focus", () => { target = a; });
b.addEventListener("focus", () => { target = b; });
openTextFile($("#drop"), status, (text) => { target.value = text; });
void wireCopy;
toggleIw();
