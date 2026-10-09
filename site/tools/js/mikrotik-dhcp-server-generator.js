import { $, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, tx } from "./rosui.js?v=11";
import { Script, q, checkName, checkIp4, checkCidr, checkMac, parseTime, fmtTime, inNet, fmtV4, InputError } from "./roscore.js?v=11";

const root = $("#dh");
const well = scriptWell({ out: $("#dh-out"), copy: $("#dh-copy"), download: $("#dh-dl"), name: "mikrotik-dhcp-server.rsc" });

const leases = rowEditor({
  list: $("#dh-leases"), add: $("#dh-add"), min: 0, max: 256, onChange: () => build(),
  label: (r) => rowInputs(r).name.value,
  makeRow: (v) => [
    cell(tx("Comment"), "text", { key: "name", value: v.name ?? "", placeholder: "printer" }),
    cell(tx("MAC address"), "text", { key: "mac", value: v.mac ?? "", placeholder: "AA:BB:CC:DD:EE:FF" }),
    cell(tx("IP address"), "text", { key: "ip", value: v.ip ?? "", placeholder: "192.168.88.5" }),
  ],
});
leases.addRow({ name: "printer", mac: "4C:5E:0C:12:34:56", ip: "192.168.88.5" });

/* "192.168.88.10-192.168.88.254, 192.168.88.5" -> [{lo, hi, text}] (single addresses allowed). */
function parseRanges(v) {
  const parts = String(v).split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new InputError(tx("Enter a range such as 192.168.88.10-192.168.88.254."));
  return parts.map((p) => {
    const [a, b] = p.split("-");
    const lo = checkIp4(a), hi = b === undefined ? lo : checkIp4(b);
    if (hi.value < lo.value) throw new InputError(tx("In the range {text} the first address must be the lower one.", { text: p }));
    return { lo: lo.value, hi: hi.value, text: lo.value === hi.value ? lo.text : `${lo.text}-${hi.text}` };
  });
}

const ipList = (v) => String(v).split(/[,\s]+/).filter(Boolean).map((x) => checkIp4(x).text);

function build() {
  const c = new Checker(root);
  const iface = c.get($("#dh-if"), (v) => checkName(v));
  const name = c.get($("#dh-name"), (v) => checkName(v));
  const net = c.get($("#dh-net"), (v) => checkCidr(v, { version: 4, requirePrefix: true }));
  const gw = c.get($("#dh-gw"), (v) => checkIp4(v));
  const pool = c.get($("#dh-pool"), parseRanges, []);
  const dns = c.get($("#dh-dns"), (v) => ipList(v), []);
  const ntp = c.get($("#dh-ntp"), (v) => ipList(v), []);
  const domain = c.get($("#dh-domain"), (v) => {
    const d = v.trim();
    if (d && !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(d)) throw new InputError(tx("Use a domain such as lan or home.example.com."));
    return d;
  }, "");
  const lease = c.get($("#dh-lease"), (v) => parseTime(v));

  if (net) {
    if (net.prefix > 30) c.fail($("#dh-net"), tx("A DHCP network needs room for clients: use /30 or larger."));
    if (net.hostBits) c.fail($("#dh-net"), tx("Write the network address, {net}, not a host address.", { net: net.text }));
    if (gw && !inNet(net, gw.value)) c.fail($("#dh-gw"), tx("The gateway must be inside {net}.", { net: net.text }));
    else if (gw && (gw.value === net.network || gw.value === net.last)) c.fail($("#dh-gw"), tx("The gateway can't be the network or broadcast address."));
    for (const r of pool) {
      if (!inNet(net, r.lo) || !inNet(net, r.hi)) { c.fail($("#dh-pool"), tx("The pool must be inside {net}.", { net: net.text })); break; }
      if (r.lo === net.network || r.hi === net.last) { c.fail($("#dh-pool"), tx("The pool can't include the network or broadcast address.")); break; }
      if (gw && gw.value >= r.lo && gw.value <= r.hi) { c.fail($("#dh-pool"), tx("The pool includes the gateway {ip}. Start the pool after it.", { ip: gw.text })); break; }
    }
  }
  const seenMac = new Set(), seenIp = new Set();
  const items = [];
  for (const r of leases.rows()) {
    const i = rowInputs(r);
    const comment = c.get(i.name, (v) => checkName(v, { optional: true }), "");
    const mac = c.get(i.mac, checkMac);
    const ip = c.get(i.ip, (v) => checkIp4(v));
    if (mac && seenMac.has(mac)) c.fail(i.mac, tx("This MAC address already has a lease above."));
    if (ip && seenIp.has(ip.text)) c.fail(i.ip, tx("This address is already given to another device above."));
    if (ip && net && !inNet(net, ip.value)) c.fail(i.ip, tx("This address is outside {net}.", { net: net.text }));
    if (ip && gw && ip.value === gw.value) c.fail(i.ip, tx("That is the gateway's address."));
    if (mac) seenMac.add(mac);
    if (ip) seenIp.add(ip.text);
    items.push({ comment, mac, ip });
  }
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  const size = pool.reduce((n, r) => n + Number(r.hi - r.lo + 1n), 0);
  const s = new Script().header("DHCP server");
  if ($("#dh-addr").checked) {
    s.section("/ip address", "The router's own address on the LAN interface (skip if it is already there).");
    s.raw(`:if ([:len [/ip address find address="${gw.text}/${net.prefix}" interface=${q(iface)}]] = 0) do={ /ip address add address=${gw.text}/${net.prefix} interface=${q(iface)} comment="LAN gateway" }`);
  }
  s.section("/ip pool", `Addresses handed out dynamically (${size} addresses).`);
  s.cmd("add", [["name", name], ["ranges", pool.map((r) => r.text).join(",")]]);
  s.section("/ip dhcp-server", "The server itself, bound to one interface.");
  s.cmd("add", [["name", name], ["interface", iface], ["address-pool", name], ["lease-time", fmtTime(lease)], ["disabled", "no"]]);
  s.section("/ip dhcp-server network", "Settings sent to clients: gateway, DNS, domain and NTP.");
  s.cmd("add", [["address", net.text], ["gateway", gw.text], ["dns-server", dns.join(",")], ["domain", domain], ["ntp-server", ntp.join(",")], ["comment", `${name} network`]]);
  if (items.length) {
    s.section("/ip dhcp-server lease", "Static leases: these devices always get the same address.");
    for (const it of items) s.cmd("add", [["address", it.ip.text], ["mac-address", it.mac], ["server", name], ["comment", it.comment]]);
    const inPool = items.filter((it) => pool.some((r) => it.ip.value >= r.lo && it.ip.value <= r.hi));
    if (inPool.length) notes.push({ level: "info", text: tx("{ip} is inside the dynamic pool. RouterOS won't hand it to anyone else while the lease exists, but keeping static addresses outside the pool is easier to read.", { ip: inPool[0].ip.text }) });
  }
  if ($("#dh-dnsrv").checked) {
    s.section("/ip dns", "Let LAN clients use the router as their DNS resolver.");
    s.cmd("set", [["allow-remote-requests", "yes"]]);
    notes.push({ level: "warn", text: tx("With allow-remote-requests=yes the router answers DNS on every interface. Make sure the input chain drops DNS (port 53) from the WAN, or it becomes an open resolver used in DDoS attacks.") });
    if (!dns.includes(gw.text)) notes.push({ level: "info", text: tx("The router resolves DNS, but clients are told to use other servers. Add {ip} to the DNS servers if they should use the router.", { ip: gw.text }) });
  }
  if (size < 10) notes.push({ level: "warn", text: tx("The pool has only {n} addresses.", { n: size }) });
  notes.push({ level: "info", text: tx("An interface can have only one DHCP server. If {iface} already has one, remove it or change it instead of adding this.", { iface }) });
  well.set(s.toString());
  showNotes($("#dh-notes"), notes);
  return 0;
}

/* Suggest gateway and pool when the network changes and they still hold the old suggestion. */
let lastNet = "";
$("#dh-net").addEventListener("change", () => {
  let n;
  try { n = checkCidr($("#dh-net").value, { version: 4, requirePrefix: true }); } catch (_) { return; }
  if (n.prefix > 30 || n.text === lastNet) return;
  lastNet = n.text;
  const first = n.network + 1n, last = n.last - 1n;
  $("#dh-gw").value = fmtV4(first);
  const start = n.prefix <= 28 ? first + 9n : first + 1n;
  $("#dh-pool").value = `${fmtV4(start)}-${fmtV4(last)}`;
  $("#dh-dns").value = fmtV4(first);
});

live(root, build);
