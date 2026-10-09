import { $, live, openTextFile, wireCopy, downloadButton, announce, fmtInt, normalizeNewlines, tx, txn, EN, LOCALE } from "./textcore.js?v=11";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const by = $("#by");
const dirRadios = Array.from(document.querySelectorAll('input[name="dir"]'));
const checks = ["#ci", "#dedupe", "#noempty", "#trim"].map((s) => $(s));

function randInt(n) {
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
  return buf[0] % n;
}

/* Sort lines. o: {by, desc, ci, dedupe, noempty, trim}. Equal lines keep their input order (stable). */
export function sortLines(raw, o) {
  let lines = normalizeNewlines(raw).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  if (o.trim) lines = lines.map((l) => l.trim());
  let empty = 0;
  if (o.noempty) {
    const kept = lines.filter((l) => l.trim() !== "");
    empty = lines.length - kept.length;
    lines = kept;
  }
  let dups = 0;
  if (o.dedupe) {
    const seen = new Set();
    lines = lines.filter((l) => {
      const k = o.ci ? l.toLocaleLowerCase() : l;
      if (seen.has(k)) { dups++; return false; }
      seen.add(k);
      return true;
    });
  }
  const sign = o.desc ? -1 : 1;
  let cmp = null;
  if (o.by === "alpha" || o.by === "natural") {
    const coll = new Intl.Collator(EN ? undefined : LOCALE, { numeric: o.by === "natural", sensitivity: o.ci ? "accent" : "variant" });
    cmp = coll.compare;
  } else if (o.by === "code") {
    cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  } else if (o.by === "length") {
    const len = (s) => Array.from(s).length;
    cmp = (a, b) => len(a) - len(b);
  }
  if (cmp) {
    lines = lines.map((l, i) => [l, i]).sort((a, b) => sign * cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0]);
  } else if (o.by === "reverse") {
    lines.reverse();
  } else if (o.by === "shuffle") {
    for (let i = lines.length - 1; i > 0; i--) { const j = randInt(i + 1); [lines[i], lines[j]] = [lines[j], lines[i]]; }
  }
  return { text: lines.join("\n"), total, out: lines.length, dups, empty };
}

const DIR_LABELS = { length: [tx("Shortest first"), tx("Longest first")] };

function update() {
  const method = by.value;
  const [a, z] = DIR_LABELS[method] || [tx("A to Z"), tx("Z to A")];
  $("#asc-l").textContent = a;
  $("#desc-l").textContent = z;
  $("#dir-field").hidden = method === "reverse" || method === "shuffle";
  $("#shuffle").hidden = method !== "shuffle";
  const r = sortLines(area.value, {
    by: method, desc: dirRadios.find((x) => x.checked).value === "desc",
    ci: $("#ci").checked, dedupe: $("#dedupe").checked, noempty: $("#noempty").checked, trim: $("#trim").checked,
  });
  out.value = r.text;
  const has = !!area.value;
  const extra = [];
  if (r.dups) extra.push(txn(r.dups, "{n} duplicate removed", "{n} duplicates removed"));
  if (r.empty) extra.push(tx("{n} empty removed", { n: fmtInt(r.empty) }));
  $("#report").textContent = has
    ? txn(r.out, "{n} line sorted", "{n} lines sorted") + (extra.length ? ", " + extra.join(", ") : "")
    : tx("Paste lines to begin.");
  $("#copy").disabled = $("#dl").disabled = $("#use").disabled = $("#clear").disabled = !has;
}

live(() => area.value, [area, by, ...dirRadios, ...checks], update);
$("#shuffle").addEventListener("click", update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "sorted-lines.txt"), { id: "dl" }));
$("#use").addEventListener("click", () => { area.value = out.value; update(); announce(tx("Result moved into the input.")); });
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
