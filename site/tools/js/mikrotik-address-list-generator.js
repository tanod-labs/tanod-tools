import { $, el, live, Checker, showNotes, scriptWell, tx } from "./rosui.js?v=11";
import { txn, fmtNum } from "./core.js?v=11";
import { Script, q, checkName, parseTime, fmtTime, parseAddrItem, mergeIntervals, rangeToCidrs, fmtListAddr, InputError } from "./roscore.js?v=11";

const root = $("#al");
const well = scriptWell({ out: $("#al-out"), copy: $("#al-copy"), download: $("#al-dl"), name: () => `${($("#al-name").value.trim() || "address-list").replace(/[^\w.-]+/g, "_")}.rsc` });

/* Tokens with their line numbers: anything after # or ; on a line is a comment. */
export function tokens(text) {
  const out = [];
  String(text).replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
    const body = line.replace(/[#;].*$/, "");
    for (const t of body.split(/[\s,]+/)) if (t) out.push({ text: t, line: i + 1 });
  });
  return out;
}

/* Parse, dedupe and (optionally) merge. Returns {v4: [{addr, prefix}], v6: [...], stats, bad: [{text, line, msg}]}. */
export function plan(text, { merge = true } = {}) {
  const toks = tokens(text);
  const bad = [];
  const items = { 4: [], 6: [] };
  let hostBits = 0;
  for (const t of toks) {
    try {
      const it = parseAddrItem(t.text);
      if (it.hostBits) hostBits++;
      items[it.version].push(it);
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      bad.push({ ...t, msg: e.message });
    }
  }
  const out = {};
  let unique = 0;
  for (const v of [4, 6]) {
    const bits = v === 4 ? 32 : 128;
    const key = (it) => `${it.lo}-${it.hi}`;
    const seen = new Map();
    for (const it of items[v]) seen.set(key(it), it);
    const uniq = [...seen.values()].sort((a, b) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : a.hi < b.hi ? 1 : -1));
    unique += uniq.length;
    const intervals = merge ? mergeIntervals(uniq) : uniq;
    out[v] = intervals.flatMap((r) => rangeToCidrs(r.lo, r.hi, bits));
  }
  return { v4: out[4], v6: out[6], bad, stats: { tokens: toks.length, valid: items[4].length + items[6].length, unique, hostBits, result: out[4].length + out[6].length } };
}

function build() {
  const c = new Checker(root);
  const name = c.get($("#al-name"), (v) => checkName(v));
  const timeout = c.get($("#al-timeout"), (v) => parseTime(v, { optional: true }));
  const comment = $("#al-comment").value.trim();
  if (comment.length > 255) c.fail($("#al-comment"), tx("Keep the comment under 255 characters."));
  const text = $("#al-in").value;
  if (!text.trim()) c.fail($("#al-in"), tx("Paste addresses, networks or ranges, one per line."));
  if (!c.ok) { renderStats(null); return well.blocked(c.count); }

  const p = plan(text, { merge: $("#al-merge").checked });
  if (!p.v4.length && !p.v6.length) {
    c.fail($("#al-in"), tx("None of the entries is a valid IPv4 or IPv6 address, network or range."));
    renderStats(p);
    return well.blocked(1);
  }
  const s = new Script().header(`Address list "${name}"`);
  const skip = $("#al-skip").checked;
  const extra = [["timeout", timeout ? fmtTime(timeout) : ""], ["comment", comment]];
  for (const [v, list, menu] of [[4, p.v4, "/ip firewall address-list"], [6, p.v6, "/ipv6 firewall address-list"]]) {
    if (!list.length) continue;
    s.section(menu, `${list.length} ${v === 4 ? "IPv4" : "IPv6"} entries.`);
    if ($("#al-replace").checked) s.raw(`remove [ find list=${q(name)} ]`);
    for (const e of list) {
      const args = [["list", name], ["address", fmtListAddr(v, e.addr, e.prefix)], ...extra];
      const line = "add " + args.filter(([, x]) => x).map(([k, x]) => `${k}=${q(x)}`).join(" ");
      s.raw(skip ? `:do { ${line} } on-error={}` : line);
    }
  }
  well.set(s.toString());

  const notes = [];
  if (p.bad.length) {
    const shown = p.bad.slice(0, 5).map((b) => tx("line {line}: \"{text}\"", { line: b.line, text: b.text })).join("; ");
    notes.push({ level: "warn", text: txn(p.bad.length, "{n} entry was skipped because it isn't an address: {list}", "{n} entries were skipped because they aren't addresses: {list}", { list: shown + (p.bad.length > 5 ? " …" : "") }) });
  }
  if (p.stats.hostBits) notes.push({ level: "info", text: txn(p.stats.hostBits, "{n} network had host bits set and was written as its network address.", "{n} networks had host bits set and were written as their network addresses.") });
  if (timeout) notes.push({ level: "info", text: tx("Entries with a timeout are removed automatically when it runs out.") });
  if (!skip) notes.push({ level: "info", text: tx("An import stops at the first entry that already exists. Tick \"Skip entries that already exist\" if the list may already hold some of them.") });
  showNotes($("#al-notes"), notes);
  renderStats(p);
  return 0;
}

function renderStats(p) {
  const box = $("#al-stats");
  box.textContent = "";
  box.hidden = !p;
  if (!p) return;
  const row = (k, v, key) => el("div", { class: key ? "is-key" : "" }, el("dt", {}, k), el("dd", {}, fmtNum(v)));
  box.append(row(tx("Entries read"), p.stats.tokens), row(tx("Not addresses (skipped)"), p.bad.length),
    row(tx("Duplicates removed"), p.stats.valid - p.stats.unique), row(tx("Entries in the script"), p.stats.result, true));
}

live(root, build, 250);
