import { $, el, icon, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, radio, tx } from "./rosui.js?v=11";
import { copyText, textBlob, announce } from "./core.js?v=11";
import { Script, checkName, checkCidr, checkCidrs, checkIp, parsePorts, fmtV4, inNet, InputError } from "./roscore.js?v=11";

const root = $("#wg");
const well = scriptWell({ out: $("#wg-out"), copy: $("#wg-copy"), download: $("#wg-dl"), name: "mikrotik-wireguard.rsc" });

/* ------------------------------------------------------------------ keys (Web Crypto X25519, never leaves the page) */

const b64 = (u8) => btoa(String.fromCharCode(...u8));
let x25519 = null;   // null = unknown, true / false after the first try

export async function keyPair() {
  const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const priv = pkcs8.slice(pkcs8.length - 32);
  // WireGuard clamps private keys; clamping doesn't change the public key (X25519 clamps internally).
  priv[0] &= 248; priv[31] &= 127; priv[31] |= 64;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { priv: b64(priv), pub: b64(pub) };
}
const psk = () => b64(crypto.getRandomValues(new Uint8Array(32)));

async function supported() {
  if (x25519 !== null) return x25519;
  try { await keyPair(); x25519 = true; } catch (_) { x25519 = false; }
  return x25519;
}

function checkKey(v) {
  const s = String(v).trim();
  let ok = /^[A-Za-z0-9+/]{43}=$/.test(s);
  if (ok) { try { ok = atob(s).length === 32; } catch (_) { ok = false; } }
  if (!ok) throw new InputError(tx("A WireGuard key is 44 characters of base64 ending in =."));
  return s;
}

/* ------------------------------------------------------------------ peers */

const peers = rowEditor({
  list: $("#wg-peers"), add: $("#wg-add"), min: 1, max: 64,
  onChange: async () => { await fillKeys(); build(); },
  label: (r) => rowInputs(r).name.value,
  makeRow: (v) => [
    cell(tx("Peer name"), "text", { key: "name", value: v.name ?? "", placeholder: "laptop" }),
    cell(tx("Tunnel address"), "text", { key: "addr", value: v.addr ?? "", placeholder: "10.66.0.2" }),
    cell(tx("Networks behind this peer"), "text", { key: "nets", value: v.nets ?? "", placeholder: tx("optional, site-to-site") }),
    cell(tx("Peer public key"), "text", { key: "pub", value: v.pub ?? "", placeholder: tx("base64 key…"), cls: "wg-pub" }),
  ],
});
peers.addRow({ name: "laptop", addr: "10.66.0.2" });
peers.addRow({ name: "phone", addr: "10.66.0.3" });

let routerKeys = null;

async function fillKeys(force = false) {
  const gen = radio("wg-keys", root) === "browser" && (await supported());
  if (!gen) return;
  if (!routerKeys || force) routerKeys = await keyPair();
  for (const r of peers.rows()) {
    if (!r.dataset.priv || force) {
      const k = await keyPair();
      r.dataset.priv = k.priv;
      r.dataset.pub = k.pub;
      r.dataset.psk = psk();
    }
  }
}

/* ------------------------------------------------------------------ build */

function hostOrIp(v) {
  const s = String(v).trim();
  if (!s) throw new InputError(tx("Enter the router's public address or DNS name, as clients will reach it."));
  if (/^[0-9.]+$/.test(s) || s.includes(":")) return checkIp(s.replace(/^\[|\]$/g, "")).text;
  if (!/^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(s)) throw new InputError(tx("Enter a host name such as vpn.example.com, or an IP address."));
  return s;
}

function sync(gen) {
  for (const r of peers.rows()) rowInputs(r).pub.closest(".ros-cell").hidden = gen;
  $("#wg-nokeys").hidden = !(radio("wg-keys", root) === "browser" && x25519 === false);
  $("#wg-nets-f").hidden = radio("wg-route", root) !== "split";
}

function build() {
  const gen = radio("wg-keys", root) === "browser" && x25519 === true;
  sync(gen);
  const c = new Checker(root);
  const name = c.get($("#wg-if"), (v) => checkName(v));
  const port = c.get($("#wg-port"), (v) => parsePorts(v, { single: true }));
  const tun = c.get($("#wg-tun"), (v) => checkCidr(v, { version: 4, requirePrefix: true }));
  if (tun && !tun.hostBits) c.fail($("#wg-tun"), tx("Enter the router's own address in the tunnel, such as {ex}.", { ex: `${fmtV4(tun.network + 1n)}/${tun.prefix}` }));
  const endpoint = c.get($("#wg-end"), hostOrIp);
  const dns = c.get($("#wg-dns"), (v) => String(v).split(/[,\s]+/).filter(Boolean).map((x) => checkIp(x).text), []);
  const mtu = c.get($("#wg-mtu"), (v) => {
    const n = Number(String(v).trim());
    if (!Number.isInteger(n) || n < 1280 || n > 1500) throw new InputError(tx("Use an MTU from 1280 to 1500; 1420 suits most links."));
    return n;
  });
  const split = radio("wg-route", root) === "split";
  const lanNets = split ? c.get($("#wg-nets"), (v) => checkCidrs(v, { optional: true }), []) : [];
  const list = [];
  const seen = new Set();
  for (const r of peers.rows()) {
    const i = rowInputs(r);
    const pname = c.get(i.name, (v) => checkName(v));
    const addr = c.get(i.addr, (v) => {
      const a = checkCidr(v, { version: 4 });
      if (a.prefix !== 32) throw new InputError(tx("Give each peer one address (a /32)."));
      return a;
    });
    if (addr && tun) {
      if (!inNet(tun, addr.addr)) c.fail(i.addr, tx("The address must be inside the tunnel network {net}.", { net: tun.text }));
      else if (addr.addr === tun.addr) c.fail(i.addr, tx("That is the router's own tunnel address."));
    }
    if (addr && seen.has(addr.text)) c.fail(i.addr, tx("Another peer already uses this address."));
    if (addr) seen.add(addr.text);
    const nets = c.get(i.nets, (v) => checkCidrs(v, { optional: true }), []);
    const pub = gen ? r.dataset.pub : c.get(i.pub, checkKey);
    list.push({ name: pname, addr, nets, pub, priv: gen ? r.dataset.priv : null, psk: $("#wg-psk").checked ? (r.dataset.psk || (r.dataset.psk = psk())) : null });
  }
  if (!c.ok) { renderPeers([]); return well.blocked(c.count); }

  const notes = [];
  const s = new Script().header("WireGuard VPN server");
  s.note(gen ? "Keys were generated in your browser and appear only in this script and the peer files. Treat them as passwords."
    : "No private key is set, so RouterOS generates one. Read the router's public key with /interface wireguard print and put it in each peer's config.");
  s.section("/interface wireguard");
  s.cmd("add", [["name", name], ["listen-port", port.text], ["mtu", String(mtu)], ["private-key", gen ? routerKeys.priv : ""], ["comment", "WireGuard VPN"]]);
  s.section("/ip address", "The router's address inside the tunnel.");
  s.cmd("add", [["address", tun.hostText], ["interface", name], ["comment", "WireGuard tunnel"]]);
  s.section("/interface wireguard peers", "One entry per peer. allowed-address is what the router accepts from, and routes to, that peer.");
  for (const p of list) {
    s.cmd("add", [["interface", name], ["public-key", p.pub], ["preshared-key", p.psk || ""],
      ["allowed-address", [p.addr.text, ...p.nets.map((n) => n.text)].join(",")], ["comment", p.name]]);
  }
  const routed = list.filter((p) => p.nets.length);
  if (routed.length) {
    s.section("/ip route", "Routes to the networks behind site-to-site peers.");
    for (const p of routed) for (const n of p.nets) s.cmd("add", [["dst-address", n.text], ["gateway", name], ["comment", `via WireGuard peer ${p.name}`]]);
  }
  s.section("/ip firewall filter", `Let the internet reach WireGuard on UDP ${port.text}. MOVE THIS RULE ABOVE your input chain's drop rules`,
    "(RouterOS appends new rules at the end of the chain).");
  s.cmd("add", [["chain", "input"], ["action", "accept"], ["protocol", "udp"], ["dst-port", port.text], ["comment", "allow WireGuard"]]);
  if ($("#wg-lan").checked) {
    s.section("/interface list member", "Treat the tunnel like the LAN in the firewall (reach the router's DNS and the LAN).");
    s.raw(`:if ([:len [/interface list member find list="LAN" interface=${name}]] = 0) do={ /interface list member add list=LAN interface=${name} }`);
  }
  well.set(s.toString());

  if (!split) notes.push({ level: "info", text: tx("Full tunnel: peers send all their traffic through the router. It reaches the internet only if your masquerade rule covers the tunnel addresses (a rule with out-interface-list=WAN and no src-address does).") });
  if (dns.length && tun && dns.includes(fmtV4(tun.addr))) notes.push({ level: "info", text: tx("Peers use the router as DNS: it needs allow-remote-requests=yes in /ip dns, and the firewall must accept DNS from the tunnel (adding the tunnel to the LAN list does that).") });
  notes.push({ level: "warn", text: tx("The firewall rule is added at the end of the input chain. If your chain ends with a drop rule, move this rule above it, or WireGuard can't connect.") });
  showNotes($("#wg-notes"), notes);
  renderPeers(list.map((p) => ({ name: p.name, text: clientConf(p, { gen, mtu, dns, endpoint, port: port.text, split, tun, lanNets }) })));
  return 0;
}

function clientConf(p, o) {
  const allowed = o.split ? [o.tun.text, ...o.lanNets.map((n) => n.text)] : ["0.0.0.0/0"];
  const lines = [
    `# WireGuard peer "${p.name}", for the WireGuard app or wg-quick`,
    "[Interface]",
    `PrivateKey = ${p.priv || "<this peer's private key>"}`,
    `Address = ${p.addr.text}`,
    ...(o.dns.length ? [`DNS = ${o.dns.join(", ")}`] : []),
    `MTU = ${o.mtu}`,
    "",
    "[Peer]",
    `PublicKey = ${o.gen ? routerKeys.pub : "<router public key from /interface wireguard print>"}`,
    ...(p.psk ? [`PresharedKey = ${p.psk}`] : []),
    `Endpoint = ${o.endpoint.includes(":") ? `[${o.endpoint}]` : o.endpoint}:${o.port}`,
    `AllowedIPs = ${allowed.join(", ")}`,
    "PersistentKeepalive = 25",
  ];
  return lines.join("\n") + "\n";
}

function renderPeers(items) {
  const box = $("#wg-confs");
  box.textContent = "";
  box.hidden = !items.length;
  for (const it of items) {
    const id = `wg-conf-${it.name.replace(/[^\w-]+/g, "_")}`;
    const area = el("textarea", { id, class: "mono gen-out ros-out ros-out--short", rows: "11", readonly: true, spellcheck: "false", wrap: "off" });
    area.value = it.text;
    const copy = el("button", { class: "btn btn--sm", type: "button" }, tx("Copy"));
    copy.addEventListener("click", () => copyText(area.value, copy));
    const dl = el("button", { class: "btn btn--sm", type: "button" }, icon("i-download"), tx("Download {file}", { file: `${it.name}.conf` }));
    dl.addEventListener("click", () => {
      const url = URL.createObjectURL(textBlob(area.value, "text/plain"));
      const a = el("a", { href: url, download: `${it.name.replace(/[^\w.-]+/g, "_")}.conf`, hidden: true });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      announce(tx("The file is downloading."));
    });
    box.append(el("div", { class: "wg-conf" }, el("label", { for: id, class: "label" }, tx("Peer config: {name}", { name: it.name })), area, el("div", { class: "actions" }, copy, dl)));
  }
}

$("#wg-regen").addEventListener("click", async () => { await fillKeys(true); build(); announce(tx("New keys generated.")); });

(async () => {
  await fillKeys();
  $("#wg-regen").hidden = !x25519;
  root.addEventListener("change", async (e) => { if (e.target.name === "wg-keys") { await fillKeys(); $("#wg-regen").hidden = !(x25519 && radio("wg-keys", root) === "browser"); build(); } });
  live(root, build, 200);
})();
