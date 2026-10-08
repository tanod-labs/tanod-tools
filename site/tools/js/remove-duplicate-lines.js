import { $, live, openTextFile, wireCopy, downloadButton, setStatus, announce, fmtInt, normalizeNewlines, tx, txn, EN, LOCALE } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const optIds = ["#ci", "#trim", "#noempty", "#keep", "#sort"];
const opts = optIds.map((s) => $(s));

function randInt(n) {
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
  return buf[0] % n;
}

const COLL = EN ? undefined : LOCALE;

export function process(raw, o) {
  let lines = normalizeNewlines(raw).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  if (o.trim) lines = lines.map((l) => l.trim());
  let emptyRemoved = 0;
  if (o.noempty) {
    const kept = lines.filter((l) => l.trim() !== "");
    emptyRemoved = lines.length - kept.length;
    lines = kept;
  }
  const key = (l) => (o.ci ? l.toLocaleLowerCase() : l);
  const seen = new Set();
  let kept = [];
  let dups = 0;
  const order = o.keep === "last" ? lines.map((_, i) => lines.length - 1 - i) : lines.map((_, i) => i);
  const keepIdx = [];
  for (const i of order) {
    const l = lines[i];
    if (l.trim() === "" && !o.noempty) { keepIdx.push(i); continue; } // empty lines are never treated as duplicates
    const k = key(l);
    if (seen.has(k)) { dups++; continue; }
    seen.add(k);
    keepIdx.push(i);
  }
  keepIdx.sort((a, b) => a - b);
  kept = keepIdx.map((i) => lines[i]);
  switch (o.sort) {
    case "az": kept.sort(new Intl.Collator(COLL).compare); break;
    case "za": kept.sort((a, b) => new Intl.Collator(COLL).compare(b, a)); break;
    case "natural": kept.sort(new Intl.Collator(COLL, { numeric: true, sensitivity: "base" }).compare); break;
    case "length": kept = kept.map((l, i) => [l, i]).sort((a, b) => a[0].length - b[0].length || a[1] - b[1]).map((x) => x[0]); break;
    case "reverse": kept.reverse(); break;
    case "shuffle": for (let i = kept.length - 1; i > 0; i--) { const j = randInt(i + 1); [kept[i], kept[j]] = [kept[j], kept[i]]; } break;
    default: break;
  }
  return { text: kept.join("\n"), total, out: kept.length, dups, emptyRemoved };
}

function update() {
  const r = process(area.value, {
    ci: $("#ci").checked, trim: $("#trim").checked, noempty: $("#noempty").checked,
    keep: $("#keep").value, sort: $("#sort").value,
  });
  out.value = r.text;
  $("#shuffle").hidden = $("#sort").value !== "shuffle";
  const has = !!area.value;
  $("#report").textContent = has
    ? (r.emptyRemoved
      ? txn(r.dups, "{lines} in, {out} out, {n} duplicate removed, {empty} empty removed", "{lines} in, {out} out, {n} duplicates removed, {empty} empty removed", { lines: txn(r.total, "{n} line", "{n} lines"), out: fmtInt(r.out), empty: fmtInt(r.emptyRemoved) })
      : txn(r.dups, "{lines} in, {out} out, {n} duplicate removed", "{lines} in, {out} out, {n} duplicates removed", { lines: txn(r.total, "{n} line", "{n} lines"), out: fmtInt(r.out) }))
    : tx("Paste lines to begin.");
  $("#copy").disabled = $("#dl").disabled = $("#use").disabled = !has;
  $("#clear").disabled = !has;
}

live(() => area.value, [area, ...opts], update);
$("#shuffle").addEventListener("click", update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "lines.txt"), { id: "dl" }));
$("#use").addEventListener("click", () => { area.value = out.value; $("#sort").value = "none"; update(); announce(tx("Result moved into the input.")); });
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
openTextFile($("#drop"), status, (text) => { area.value = text; update(); });
update();
