import { $, $$, el, debounce, copyText, tx, txn, EN } from "./core.js?v=5";
import { parseCidr, subnetInfo, kindOfSubnet, splitSubnet, fmtV4, fmtV6, fmtV6Full, fmtBig, IpError } from "./dev3core.js?v=5";

const input = $("#s-in"), info = $("#s-info"), result = $("#s-result"), rows = $("#s-rows"), note = $("#s-note");
const splitIn = $("#s-split"), splitInfo = $("#s-split-info"), tableWrap = $("#s-table-wrap"), table = $("#s-table");

function row(k, label, value, { copy = true, node = null } = {}) {
  const dd = el("dd", {});
  if (node) dd.append(...node); else dd.textContent = value;
  const r = el("div", { "data-k": k }, el("dt", {}, label), dd);
  if (copy) r.append(el("button", { type: "button", class: "btn btn--sm btn--quiet dv-copy", "aria-label": tx("Copy {label}", { label: EN ? label.toLowerCase() : label }),
    onclick: (e) => copyText(value, e.currentTarget) }, tx("Copy")));
  return r;
}

/* 32 bits as dotted octets with the network part in bold. */
function binary(v, prefix) {
  const nodes = [];
  let run = "", cls = null;
  const flush = () => { if (run) nodes.push(cls ? el("b", { class: "sn-net" }, run) : document.createTextNode(run)); run = ""; };
  for (let i = 0; i < 32; i++) {
    if (i && i % 8 === 0) run += ".";
    const isNet = i < prefix;
    if (cls !== isNet) { flush(); cls = isNet; }
    run += (v >> BigInt(31 - i)) & 1n ? "1" : "0";
  }
  flush();
  return nodes;
}
const plainBin = (v) => [24n, 16n, 8n, 0n].map((s) => ((v >> s) & 255n).toString(2).padStart(8, "0")).join(".");

function render4(i) {
  const p = i.prefix;
  const cidr = `${fmtV4(i.network)}/${p}`;
  const list = [
    row("network", tx("Network"), cidr),
    row("netmask", tx("Netmask"), fmtV4(i.mask)),
    row("wildcard", tx("Wildcard mask"), fmtV4(i.hostMask)),
    row("broadcast", tx("Broadcast"), i.broadcast === null ? (i.mode === "p2p" ? tx("None (point-to-point, RFC 3021)") : tx("None (single host)")) : fmtV4(i.broadcast), { copy: i.broadcast !== null }),
    row("first", tx("First usable host"), fmtV4(i.first)),
    row("last", tx("Last usable host"), fmtV4(i.lastHost)),
    row("total", tx("Total addresses"), fmtBig(i.total)),
    row("usable", tx("Usable hosts"), fmtBig(i.usable)),
    row("type", tx("Address type"), kindOfSubnet(i), { copy: false }),
    row("bin-addr", tx("Address (binary)"), plainBin(i.addr), { node: binary(i.addr, p) }),
    row("bin-mask", tx("Netmask (binary)"), plainBin(i.mask), { node: binary(i.mask, p) }),
    row("bin-net", tx("Network (binary)"), plainBin(i.network), { node: binary(i.network, p) }),
  ];
  rows.replaceChildren(...list);
  const notes = [];
  if (i.normalised) notes.push(tx("The address you typed ({addr}) has host bits set, so the network was normalised to {network}. Your address is {offset} past the network address.", { addr: fmtV4(i.addr), network: cidr, offset: fmtBig(i.addr - i.network) }));
  if (i.mode === "p2p") notes.push(tx("A /31 has two addresses and both are usable. RFC 3021 allows this on point-to-point links, so there is no network or broadcast address to give up."));
  if (i.mode === "single") notes.push(tx("A /32 is a single host: the network, the first and the last address are all the same one."));
  if (p === 0) notes.push(tx("A /0 covers the entire IPv4 address space; it is what a default route matches."));
  return notes;
}

function render6(i) {
  const p = i.prefix;
  const list = [
    row("addr", tx("Address"), fmtV6(i.addr)),
    row("addr-full", tx("Address, expanded"), fmtV6Full(i.addr)),
  ];
  if ((i.addr >> 32n) === 0xffffn) list.push(row("addr-mixed", tx("Mixed notation"), `::ffff:${fmtV4(i.addr & 0xffffffffn)}`));
  list.push(
    row("network", tx("Network"), `${fmtV6(i.network)}/${p}`),
    row("network-full", tx("Network, expanded"), `${fmtV6Full(i.network)}/${p}`),
    row("first", tx("First address"), fmtV6(i.first)),
    row("last", tx("Last address"), fmtV6(i.last)),
    row("count", tx("Address count"), `${fmtBig(i.total)}`),
    row("power", tx("As a power of two"), `2^${128 - p}`),
    row("type", tx("Address type"), kindOfSubnet(i), { copy: false }),
  );
  rows.replaceChildren(...list);
  const notes = [];
  if (i.normalised) notes.push(tx("The address you typed ({addr}) has host bits set, so the network was normalised to {network}.", { addr: fmtV6(i.addr), network: `${fmtV6(i.network)}/${p}` }));
  notes.push(tx("IPv6 has no broadcast address, so every address in the range can be assigned. The first one is the subnet-router anycast address, which most networks leave unused."));
  if (p === 0) notes.push(tx("A /0 covers the entire IPv6 address space."));
  return notes;
}

function renderSplit(i) {
  const raw = splitIn.value.trim();
  splitIn.setAttribute("aria-invalid", "false");
  splitInfo.classList.remove("tt__err");
  tableWrap.hidden = true;
  splitInfo.textContent = "";
  if (!raw) return;
  const to = Number(raw);
  if (!Number.isInteger(to) || to <= i.prefix || to > i.bits) {
    splitInfo.textContent = tx("Enter a whole number from {min} to {max} (longer than the current /{prefix}).", { min: i.prefix + 1, max: i.bits, prefix: i.prefix });
    if (i.prefix === i.bits) splitInfo.textContent = tx("A /{prefix} can't be split any further.", { prefix: i.prefix });
    splitInfo.classList.add("tt__err");
    splitIn.setAttribute("aria-invalid", "true");
    return;
  }
  const s = splitSubnet(i, to);
  const v4 = i.version === 4;
  const head = el("tr", {}, el("th", { scope: "col" }, "#"), el("th", { scope: "col" }, tx("Subnet")), el("th", { scope: "col" }, v4 ? tx("Usable hosts") : tx("Range")));
  if (v4) head.append(el("th", { scope: "col" }, tx("Broadcast")));
  table.tHead.replaceChildren(head);
  table.tBodies[0].replaceChildren(...s.rows.map((r, n) => {
    const sub = subnetInfo({ version: i.version, addr: r.network, prefix: to });
    const tr = el("tr", {}, el("td", {}, String(n + 1)), el("td", {}, `${v4 ? fmtV4(sub.network) : fmtV6(sub.network)}/${to}`));
    if (v4) {
      tr.append(el("td", {}, sub.first === sub.lastHost ? fmtV4(sub.first) : `${fmtV4(sub.first)} – ${fmtV4(sub.lastHost)}`),
        el("td", {}, sub.broadcast === null ? tx("none") : fmtV4(sub.broadcast)));
    } else tr.append(el("td", {}, `${fmtV6(sub.network)} – ${fmtV6(sub.last)}`));
    return tr;
  }));
  tableWrap.hidden = false;
  splitInfo.textContent = txn(s.total === 1n ? 1 : 2, "{n} subnet of {size} addresses each.", "{n} subnets of {size} addresses each.", { n: fmtBig(s.total), size: fmtBig(1n << BigInt(i.bits - to)) }) +
    (s.capped ? " " + tx("Only the first {n} are listed; the table stops at 256 rows.", { n: s.rows.length }) : "");
}

function update() {
  let parsed;
  try { parsed = parseCidr(input.value); } catch (e) {
    if (!(e instanceof IpError)) throw e;
    result.hidden = true;
    info.textContent = e.message;
    info.classList.add("tt__err");
    input.setAttribute("aria-invalid", "true");
    return;
  }
  input.setAttribute("aria-invalid", "false");
  info.classList.remove("tt__err");
  const i = subnetInfo(parsed);
  const notes = i.version === 4 ? render4(i) : render6(i);
  const net = `${i.version === 4 ? fmtV4(i.network) : fmtV6(i.network)}/${i.prefix}`;
  info.textContent = i.version === 4
    ? (parsed.hadPrefix ? tx("IPv4 subnet {network}.", { network: net }) : tx("IPv4 subnet {network} (no prefix given, so a single host).", { network: net }))
    : (parsed.hadPrefix ? tx("IPv6 subnet {network}.", { network: net }) : tx("IPv6 subnet {network} (no prefix given, so a single host).", { network: net }));
  note.textContent = notes.join(" ");
  note.hidden = !notes.length;
  result.hidden = false;
  renderSplit(i);
}

input.addEventListener("input", debounce(update, 100));
splitIn.addEventListener("input", debounce(update, 100));
for (const b of $$("[data-sn]")) b.addEventListener("click", () => { input.value = b.dataset.sn; update(); input.focus(); });
update();
