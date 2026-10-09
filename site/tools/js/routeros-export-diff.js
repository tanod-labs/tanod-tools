/* global Diff */
import { $, el, live, Checker, tx } from "./rosui.js?v=11";
import { txn, copyText, fmtNum } from "./core.js?v=11";
import { parseExport, maskSecrets, InputError } from "./roscore.js?v=11";

const root = $("#xd");
const CONTEXT = 3;
let lastDiff = "";

/* An export as ordered sections: [{menu, lines: [text]}]. Line continuations are joined, whitespace collapsed,
   the header (date, software id, serial) dropped. */
export function sections(text, { comments = false, secrets = true } = {}) {
  const parsed = parseExport(text);
  const map = new Map();
  const get = (menu) => { if (!map.has(menu)) map.set(menu, []); return map.get(menu); };
  for (const e of parsed.entries) {
    if (e.kind === "comment") {
      if (!comments || /by RouterOS|^software id|^serial number|^model\s*=/i.test(e.text) || !e.text.trim()) continue;
      get(e.menu || "#").push(e.raw);
      continue;
    }
    if (e.kind === "menu") { get(e.menu); continue; }
    let line = e.kind === "cmd" ? e.raw.replace(/^\/\S+(\s+[a-z0-9-]+)*?\s+(?=(add|set|remove|enable|disable|move|unset)\b)/, "") : e.raw;
    line = line.replace(/\s+/g, " ").trim();
    if (secrets) line = maskSecrets(line);
    get(e.menu || "/").push(line);
  }
  return { info: parsed.info, list: [...map].map(([menu, lines]) => ({ menu, lines })).filter((s) => s.lines.length || s.menu !== "/") };
}

function renderLines(parts) {
  const ul = el("ul", { class: "ros-lines" });
  const rows = [];
  for (const p of parts) for (const v of p.value) rows.push({ v, k: p.added ? "add" : p.removed ? "del" : "" });
  let i = 0;
  while (i < rows.length) {
    if (rows[i].k) { ul.append(line(rows[i])); i++; continue; }
    let j = i;
    while (j < rows.length && !rows[j].k) j++;
    const run = rows.slice(i, j);
    const head = i === 0 ? 0 : CONTEXT, tail = j === rows.length ? 0 : CONTEXT;
    if (run.length <= head + tail + 1) run.forEach((r) => ul.append(line(r)));
    else {
      run.slice(0, head).forEach((r) => ul.append(line(r)));
      const hidden = run.slice(head, run.length - tail);
      const btn = el("button", { type: "button", class: "ros-fold" }, txn(hidden.length, "{n} unchanged line (show)", "{n} unchanged lines (show)"));
      const li = el("li", { class: "ros-fold-li" }, btn);
      btn.addEventListener("click", () => li.replaceWith(...hidden.map(line)));
      ul.append(li);
      run.slice(run.length - tail).forEach((r) => ul.append(line(r)));
    }
    i = j;
  }
  return ul;
}

function line(r) {
  return el("li", { class: r.k ? "is-" + r.k : "", "data-sign": r.k === "add" ? "+" : r.k === "del" ? "-" : " " },
    r.k ? el("span", { class: "visually-hidden" }, r.k === "add" ? tx("Added: ") : tx("Removed: ")) : null, r.v);
}

function run() {
  const c = new Checker(root);
  const out = $("#xd-res");
  const ta = $("#xd-a").value, tb = $("#xd-b").value;
  out.textContent = "";
  lastDiff = "";
  $("#xd-copy").hidden = true;
  if (!ta.trim() && !tb.trim()) { out.hidden = true; return; }
  const opts = { comments: !$("#xd-nocomments").checked, secrets: $("#xd-mask").checked };
  let A, B;
  try { A = ta.trim() ? sections(ta, opts) : null; } catch (e) { if (!(e instanceof InputError)) throw e; c.fail($("#xd-a"), e.message); }
  try { B = tb.trim() ? sections(tb, opts) : null; } catch (e) { if (!(e instanceof InputError)) throw e; c.fail($("#xd-b"), e.message); }
  if (!c.ok) { out.hidden = true; return; }
  out.hidden = false;
  const box = el("div", { class: "ros-diff" });
  if (!A || !B) {
    const S = A || B;
    out.append(el("p", { class: "result__title" }, tx("Paste a second export to compare. Meanwhile, here is this one by section."),
      el("span", { class: "result__size" }, [S.info.version ? `RouterOS ${S.info.version}` : "", txn(S.list.length, "{n} section", "{n} sections")].filter(Boolean).join(" · "))));
    for (const s of S.list) {
      const d = el("details", { class: "ros-sec" }, el("summary", {}, s.menu, el("span", {}, txn(s.lines.length, "{n} line", "{n} lines"))));
      d.append(renderLines([{ value: s.lines }]));
      box.append(d);
    }
    out.append(box);
    return;
  }
  const order = [...A.list.map((s) => s.menu), ...B.list.map((s) => s.menu).filter((m) => !A.list.some((s) => s.menu === m))];
  const get = (S, m) => (S.list.find((s) => s.menu === m) || { lines: [] }).lines;
  let changed = 0, adds = 0, dels = 0;
  const text = [];
  for (const m of order) {
    const parts = Diff.diffArrays(get(A, m), get(B, m));
    const add = parts.filter((p) => p.added).reduce((n, p) => n + p.value.length, 0);
    const del = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.length, 0);
    if (!add && !del && !$("#xd-all").checked) continue;
    if (add || del) {
      changed++; adds += add; dels += del;
      text.push(m);
      for (const p of parts) if (p.added || p.removed) for (const v of p.value) text.push(`${p.added ? "+" : "-"} ${v}`);
      text.push("");
    }
    const label = !get(A, m).length ? tx("new section") : !get(B, m).length ? tx("section removed") : add || del ? tx("+{add} −{del}", { add: fmtNum(add), del: fmtNum(del) }) : tx("unchanged");
    const d = el("details", { class: "ros-sec", "data-changed": String(!!(add || del)), open: !!(add || del) }, el("summary", {}, m, el("span", {}, label)));
    d.append(renderLines(parts));
    box.append(d);
  }
  const vers = [A.info.version, B.info.version];
  out.append(el("p", { class: "result__title" }, changed
    ? [txn(changed, "{n} section changed", "{n} sections changed"), txn(adds, "{n} line added", "{n} lines added"), txn(dels, "{n} line removed", "{n} lines removed")].join(" · ")
    : tx("No differences in the configuration."),
    vers[0] || vers[1] ? el("span", { class: "result__size" }, `RouterOS ${vers[0] || "?"} → ${vers[1] || "?"}`) : null));
  out.append(box);
  if (changed) { lastDiff = text.join("\n"); $("#xd-copy").hidden = false; }
}

for (const side of ["a", "b"]) {
  $(`#xd-file-${side}`).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { new Checker(root).fail($(`#xd-${side}`), tx("That file is larger than 8 MB; an export is usually far smaller.")); return; }
    $(`#xd-${side}`).value = await f.text();
    run();
  });
}
$("#xd-copy").addEventListener("click", () => { if (lastDiff) copyText(lastDiff, $("#xd-copy")); });
live(root, run, 400);
