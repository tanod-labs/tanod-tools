import { $, live, Checker, showNotes, scriptWell, tx } from "./rosui.js?v=11";
import { Script, LOCKOUT, q, checkNames, checkCidrs, parsePorts, InputError } from "./roscore.js?v=11";

const f = {
  wan: $("#fw-wan"), lan: $("#fw-lan"), mgmt: $("#fw-mgmt"), open: $("#fw-open"),
  svc: $("#fw-svc"), lanAll: $("#fw-lanall"), ping: $("#fw-ping"), fast: $("#fw-fast"), nat: $("#fw-nat"),
  ipsec: $("#fw-ipsec"), v6: $("#fw-v6"), extra: $("#fw-extra"), replace: $("#fw-replace"),
};
const well = scriptWell({ out: $("#fw-out"), copy: $("#fw-copy"), download: $("#fw-dl"), name: "mikrotik-firewall.rsc" });

/* "udp/13231, tcp/8443" -> [{proto, ports}] */
function parseOpen(s) {
  const out = [];
  for (const item of String(s).split(/[,\s]+/).filter(Boolean)) {
    const m = item.toLowerCase().match(/^(tcp|udp)[/:](.+)$/);
    if (!m) throw new InputError(tx("Write each open port as protocol/port, such as udp/13231 or tcp/8443."));
    out.push({ proto: m[1], ports: parsePorts(m[2]).text });
  }
  return out;
}

/* Add a list or member only when it doesn't exist yet, so the script can be pasted on a router with defconf. */
const ensure = (s, find, add) => s.raw(`:if ([:len [${find}]] = 0) do={ ${add} }`);

function build() {
  const c = new Checker($("#fw"));
  const wan = c.get(f.wan, (v) => checkNames(v), []);
  const lan = c.get(f.lan, (v) => checkNames(v), []);
  const mgmt = c.get(f.mgmt, (v) => checkCidrs(v, { version: 4 }), []);
  const open = c.get(f.open, parseOpen, []);
  const both = wan.filter((x) => lan.includes(x));
  if (both.length) c.fail(f.lan, tx("{name} can't be both WAN and LAN.", { name: both[0] }));
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  const s = new Script().header("Firewall baseline");
  s.note(LOCKOUT);

  s.section("/interface list", "Interface lists: WAN = internet-facing, LAN = trusted local side.",
    "Lists and members are only added when missing, so this is safe on a router with the default configuration.");
  ensure(s, '/interface list find name="WAN"', "/interface list add name=WAN comment=\"internet-facing interfaces\"");
  ensure(s, '/interface list find name="LAN"', "/interface list add name=LAN comment=\"local interfaces\"");
  for (const i of wan) ensure(s, `/interface list member find list="WAN" interface=${q(i)}`, `/interface list member add list=WAN interface=${q(i)}`);
  for (const i of lan) ensure(s, `/interface list member find list="LAN" interface=${q(i)}`, `/interface list member add list=LAN interface=${q(i)}`);

  s.section("/ip firewall address-list", "Management subnets: the only sources allowed to reach WinBox and SSH.");
  for (const m of mgmt) ensure(s, `/ip firewall address-list find list="mgmt" address=${m.text}`, `/ip firewall address-list add list=mgmt address=${m.text} comment="router management"`);
  if (mgmt.some((m) => m.prefix === 0)) notes.push({ level: "warn", text: tx("0.0.0.0/0 in the management list lets the whole internet reach WinBox and SSH.") });
  if (mgmt.some((m) => m.hostBits)) notes.push({ level: "info", text: tx("Some management entries had host bits set; the script uses their network address.") });

  if (f.replace.checked) {
    s.section("/ip firewall filter", "REPLACE MODE: remove every static filter and NAT rule first. Only do this on a router you can reach from the LAN or with Safe Mode on.");
    s.cmd("remove", [], { find: "dynamic=no" });
    s.raw("/ip firewall nat");
    s.cmd("remove", [], { find: "dynamic=no" });
    notes.push({ level: "warn", text: tx("Replace mode deletes all existing filter and NAT rules, including port forwards. Copy anything you want to keep first.") });
  } else {
    notes.push({ level: "info", text: tx("The rules are added after any rules the router already has. Check the order with /ip firewall filter print, or use replace mode on a fresh router.") });
  }

  s.section("/ip firewall filter", "INPUT chain: traffic addressed to the router itself.");
  s.cmd("add", { chain: "input", action: "accept", "connection-state": "established,related,untracked", comment: "input: accept established, related, untracked" });
  s.cmd("add", { chain: "input", action: "drop", "connection-state": "invalid", comment: "input: drop invalid" });
  if (f.ping.checked) s.cmd("add", { chain: "input", action: "accept", protocol: "icmp", "icmp-options": "8:0", limit: "5,10:packet", comment: "input: ping, rate limited" });
  s.cmd("add", { chain: "input", action: "accept", "dst-address": "127.0.0.1", comment: "input: local loopback (CAPsMAN)" });
  s.cmd("add", { chain: "input", action: "accept", "src-address-list": "mgmt", protocol: "tcp", "dst-port": "8291,22", comment: "input: WinBox and SSH from management subnets" });
  if (f.ipsec.checked) {
    s.cmd("add", { chain: "input", action: "accept", protocol: "udp", "dst-port": "500,4500", comment: "input: IKE for IPsec" });
    s.cmd("add", { chain: "input", action: "accept", protocol: "ipsec-esp", comment: "input: IPsec ESP" });
  }
  for (const o of open) s.cmd("add", { chain: "input", action: "accept", protocol: o.proto, "dst-port": o.ports, comment: `input: open ${o.proto}/${o.ports}` });
  if (f.lanAll.checked) {
    s.cmd("add", { chain: "input", action: "accept", "in-interface-list": "LAN", comment: "input: accept everything from LAN" });
  } else {
    s.cmd("add", { chain: "input", action: "accept", "in-interface-list": "LAN", protocol: "udp", "dst-port": "53,67,123", comment: "input: DNS, DHCP and NTP from LAN" });
    s.cmd("add", { chain: "input", action: "accept", "in-interface-list": "LAN", protocol: "tcp", "dst-port": "53", comment: "input: DNS over TCP from LAN" });
    s.cmd("add", { chain: "input", action: "accept", "in-interface-list": "LAN", protocol: "icmp", comment: "input: ICMP from LAN" });
    notes.push({ level: "warn", text: tx("With the LAN untrusted, only the management subnets reach WinBox and SSH. Make sure the computer you manage from is in one of them.") });
  }
  s.cmd("add", { chain: "input", action: "drop", comment: "input: drop everything else" });

  s.blank().note("FORWARD chain: traffic passing through the router.");
  if (f.ipsec.checked) {
    s.cmd("add", { chain: "forward", action: "accept", "ipsec-policy": "in,ipsec", comment: "forward: accept in ipsec policy" });
    s.cmd("add", { chain: "forward", action: "accept", "ipsec-policy": "out,ipsec", comment: "forward: accept out ipsec policy" });
  }
  if (f.fast.checked) {
    s.cmd("add", { chain: "forward", action: "fasttrack-connection", "connection-state": "established,related", "hw-offload": "yes", comment: "forward: fasttrack established and related" });
    notes.push({ level: "info", text: tx("FastTrack is on: fasttracked traffic skips queues, mangle and IPsec policies. Turn it off if you shape traffic with simple queues or queue trees.") });
  }
  s.cmd("add", { chain: "forward", action: "accept", "connection-state": "established,related,untracked", comment: "forward: accept established, related, untracked" });
  s.cmd("add", { chain: "forward", action: "drop", "connection-state": "invalid", comment: "forward: drop invalid" });
  s.cmd("add", { chain: "forward", action: "drop", "connection-state": "new", "connection-nat-state": "!dstnat", "in-interface-list": "WAN", comment: "forward: drop new connections from WAN that are not port forwards" });

  if (f.nat.checked) {
    s.section("/ip firewall nat", "Source NAT: hide the LAN behind the WAN address (not for traffic matching an IPsec policy).");
    s.cmd("add", { chain: "srcnat", action: "masquerade", "out-interface-list": "WAN", "ipsec-policy": "out,none", comment: "masquerade to the internet" });
  }

  if (f.svc.checked) {
    const addr = mgmt.map((m) => m.text).join(",");
    s.section("/ip service", "Router services: turn off the plain-text and unused ones, and limit WinBox and SSH to management subnets.");
    for (const name of ["telnet", "ftp", "www", "www-ssl", "api", "api-ssl"]) s.cmd("set", { disabled: "yes" }, { pos: [name] });
    s.cmd("set", { address: addr, disabled: "no" }, { pos: ["winbox"] });
    s.cmd("set", { address: addr, disabled: "no" }, { pos: ["ssh"] });
    notes.push({ level: "info", text: tx("WebFig (www and www-ssl) and the API are turned off. Untick the services option if you use them.") });
  }

  if (f.extra.checked) {
    s.section("/ip neighbor discovery-settings", "Hardening: discovery, MAC access and helper services only where they are needed.");
    s.cmd("set", { "discover-interface-list": "LAN" });
    s.raw("/tool mac-server").cmd("set", { "allowed-interface-list": "LAN" });
    s.raw("/tool mac-server mac-winbox").cmd("set", { "allowed-interface-list": "LAN" });
    s.raw("/tool bandwidth-server").cmd("set", { enabled: "no" });
    s.raw("/ip proxy").cmd("set", { enabled: "no" });
    s.raw("/ip socks").cmd("set", { enabled: "no" });
    s.raw("/ip upnp").cmd("set", { enabled: "no" });
    s.raw("/ip ssh").cmd("set", { "strong-crypto": "yes" });
  }

  if (f.v6.checked) ipv6(s);

  well.set(s.toString());
  showNotes($("#fw-notes"), notes);
  return 0;
}

function ipv6(s) {
  s.section("/ipv6 firewall address-list", "IPv6: addresses that should never appear as source or destination.");
  for (const [a, c] of [["::/128", "unspecified"], ["::1/128", "loopback"], ["fec0::/10", "site-local"], ["::ffff:0.0.0.0/96", "ipv4-mapped"],
    ["::/96", "ipv4 compatible"], ["100::/64", "discard only"], ["2001:db8::/32", "documentation"], ["2001:10::/28", "ORCHID"], ["3ffe::/16", "6bone"]]) {
    ensure(s, `/ipv6 firewall address-list find list="bad_ipv6" address=${a}`, `/ipv6 firewall address-list add list=bad_ipv6 address=${a} comment="${c}"`);
  }
  s.section("/ipv6 firewall filter", "IPv6 INPUT chain. ICMPv6 must stay open: neighbour discovery and path MTU discovery depend on it.");
  const add = (o) => s.cmd("add", o);
  add({ chain: "input", action: "accept", "connection-state": "established,related,untracked", comment: "v6 input: accept established, related, untracked" });
  add({ chain: "input", action: "drop", "connection-state": "invalid", comment: "v6 input: drop invalid" });
  add({ chain: "input", action: "accept", protocol: "icmpv6", comment: "v6 input: accept ICMPv6" });
  add({ chain: "input", action: "accept", protocol: "udp", "dst-port": "33434-33534", comment: "v6 input: accept UDP traceroute" });
  add({ chain: "input", action: "accept", protocol: "udp", "dst-port": "546", "src-address": "fe80::/10", comment: "v6 input: accept DHCPv6 client prefix delegation" });
  add({ chain: "input", action: "drop", "in-interface-list": "!LAN", comment: "v6 input: drop everything not coming from LAN" });
  s.blank().note("IPv6 FORWARD chain.");
  add({ chain: "forward", action: "accept", "connection-state": "established,related,untracked", comment: "v6 forward: accept established, related, untracked" });
  add({ chain: "forward", action: "drop", "connection-state": "invalid", comment: "v6 forward: drop invalid" });
  add({ chain: "forward", action: "drop", "src-address-list": "bad_ipv6", comment: "v6 forward: drop bad source addresses" });
  add({ chain: "forward", action: "drop", "dst-address-list": "bad_ipv6", comment: "v6 forward: drop bad destination addresses" });
  add({ chain: "forward", action: "drop", protocol: "icmpv6", "hop-limit": "equal:1", comment: "v6 forward: RFC 4890 drop hop-limit=1" });
  add({ chain: "forward", action: "accept", protocol: "icmpv6", comment: "v6 forward: accept ICMPv6" });
  add({ chain: "forward", action: "drop", "in-interface-list": "!LAN", comment: "v6 forward: drop everything else not coming from LAN" });
}

live($("#fw"), build);
