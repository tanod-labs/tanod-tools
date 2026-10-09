// RouterOS firewall and service audit: heuristic checks on an /export, for hardening your own router.
// Pure functions; nothing is sent anywhere.
import { tx } from "./core.js?v=11";
import { parseExport, inMenu, settingsOf, parsePorts, portsCover, maskSecrets, InputError } from "./roscore.js?v=11";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];

/* Keys that don't decide whether a rule matches a packet. */
const NON_MATCH = new Set(["chain", "action", "comment", "disabled", "log", "log-prefix", "jump-target", "reject-with", "address-list",
  "address-list-timeout", "new-connection-mark", "new-packet-mark", "new-routing-mark", "passthrough", "place-before", "to-addresses",
  "to-ports", "hw-offload", "new-priority", "new-dscp", "new-mss", "new-ttl", "route-dst", "sniff-id", "sniff-target", "sniff-target-port"]);
const LIST_KEYS = new Set(["connection-state", "connection-nat-state"]);
const PORT_KEYS = new Set(["dst-port", "src-port", "port"]);
const TERMINAL = new Set(["accept", "drop", "reject", "tarpit"]);
const PROTO_NUM = { 1: "icmp", 6: "tcp", 17: "udp", 47: "gre", 50: "ipsec-esp", 51: "ipsec-ah", 58: "icmpv6" };

const proto = (v) => PROTO_NUM[v] || v;
const matchers = (r) => Object.keys(r.args).filter((k) => !NON_MATCH.has(k));
const enabled = (r) => r.args.disabled !== "yes";

/* Does rule A match every packet rule B matches (so B can never be reached after a terminal A)? */
export function covers(a, b) {
  for (const k of matchers(a)) {
    const av = a.args[k], bv = b.args[k];
    if (bv === undefined) return false;
    if (av === bv) continue;
    if (av.startsWith("!") || bv.startsWith("!")) return false;
    if (LIST_KEYS.has(k)) {
      const as = new Set(av.split(","));
      if (!bv.split(",").every((x) => as.has(x))) return false;
      continue;
    }
    if (PORT_KEYS.has(k)) {
      try { if (portsCover(parsePorts(av), parsePorts(bv))) continue; } catch (_) { /* named ports: compare as text */ }
      return false;
    }
    if (k === "protocol" && proto(av) === proto(bv)) continue;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ the model */

function model(parsed) {
  const filter = inMenu(parsed, "/ip firewall filter", "add").filter(enabled);
  const nat = inMenu(parsed, "/ip firewall nat", "add").filter(enabled);
  const lists = {};
  for (const m of inMenu(parsed, "/interface list member", "add").filter(enabled)) (lists[m.args.list] ||= new Set()).add(m.args.interface);
  const listNames = new Set([...inMenu(parsed, "/interface list", "add").map((e) => e.args.name), ...Object.keys(lists), "all", "none", "dynamic", "static"]);
  // interfaces facing the internet: masquerade out-interfaces, DHCP and PPPoE clients, lists called WAN
  const wanIf = new Set();
  const wanLists = new Set([...listNames].filter((n) => /wan|internet|uplink|isp/i.test(n)));
  for (const r of nat) {
    if (r.args.chain !== "srcnat" || !/masquerade|src-nat/.test(r.args.action || "")) continue;
    if (r.args["out-interface"] && !r.args["out-interface"].startsWith("!")) wanIf.add(r.args["out-interface"]);
    if (r.args["out-interface-list"] && !r.args["out-interface-list"].startsWith("!")) wanLists.add(r.args["out-interface-list"]);
  }
  for (const d of inMenu(parsed, "/ip dhcp-client", "add").filter(enabled)) if (d.args.interface) wanIf.add(d.args.interface);
  for (const p of inMenu(parsed, "/interface pppoe-client", "add").filter(enabled)) if (p.args.name) wanIf.add(p.args.name);
  for (const l of wanLists) for (const i of lists[l] || []) wanIf.add(i);
  const lanLists = new Set([...listNames].filter((n) => /lan|local|trusted|mgmt|management/i.test(n) && !wanLists.has(n)));
  const chains = {};
  for (const r of filter) (chains[r.args.chain] ||= []).push(r);
  return { parsed, filter, nat, lists, wanIf, wanLists, lanLists, chains };
}

/* Is the packet's in-interface (a WAN) matched by this rule's interface condition? true, false or null (unknown). */
function ifaceMatch(M, r) {
  const il = r.args["in-interface-list"], ii = r.args["in-interface"];
  let res = true;
  if (il) {
    const neg = il.startsWith("!"), name = il.replace(/^!/, "");
    let inList = name === "all" ? true : M.wanLists.has(name) ? true : M.lanLists.has(name) ? false
      : M.lists[name] ? [...M.lists[name]].some((i) => M.wanIf.has(i)) : null;
    if (inList === null) return null;
    res = neg ? !inList : inList;
  }
  if (ii && res) {
    const neg = ii.startsWith("!"), name = ii.replace(/^!/, "");
    const isWan = M.wanIf.has(name) ? true : M.wanIf.size ? false : null;
    if (isWan === null) return null;
    res = neg ? !isWan : isWan;
  }
  return res;
}

/* Evaluate a new connection from the internet to the router: chain input, protocol, destination port.
   Returns {verdict: "accept" | "drop" | "fall-through", rule}. Rules whose other conditions can't be judged count as
   matching when they accept (the packet may get through) and as not matching when they drop. */
export function evaluate(M, chain, pkt, depth = 0) {
  for (const r of M.chains[chain] || []) {
    const act = r.args.action || "accept";
    const res = ruleMatch(M, r, pkt);
    if (res === false) continue;
    if (res === null && act !== "accept" && act !== "jump") continue;
    if (act === "jump" && depth < 8) {
      const sub = evaluate(M, r.args["jump-target"], pkt, depth + 1);
      if (sub.verdict !== "fall-through") return sub;
      continue;
    }
    if (act === "return") return { verdict: "fall-through", rule: null };
    if (TERMINAL.has(act)) return { verdict: act === "accept" ? "accept" : "drop", rule: r, exact: res === true };
  }
  return { verdict: chain === "input" || chain === "forward" || chain === "output" ? "default-accept" : "fall-through", rule: null };
}

function ruleMatch(M, r, pkt) {
  let unknown = false;
  for (const k of matchers(r)) {
    const v = r.args[k];
    const neg = v.startsWith("!");
    const val = v.replace(/^!/, "");
    let m;
    switch (k) {
      case "connection-state": m = val.split(",").includes("new"); break;
      case "connection-nat-state": m = false; break;            // a new packet to the router isn't dstnat'ed
      case "protocol": m = proto(val) === pkt.proto; break;
      case "dst-port": {
        if (!pkt.port) { m = null; break; }
        try { m = parsePorts(val).ranges.some(([lo, hi]) => pkt.port >= lo && pkt.port <= hi); } catch (_) { m = null; }
        break;
      }
      case "in-interface": case "in-interface-list": {
        if (k === "in-interface-list" && r.args["in-interface"]) continue;
        const x = ifaceMatch(M, r);
        if (x === null) { unknown = true; continue; }
        if (!x) return false;
        continue;
      }
      case "src-address": case "src-address-list": case "src-mac-address":
        return pkt.anySource ? false : null;                      // restricted to some sources
      case "dst-address-type": m = val === "local" ? true : null; break;
      case "dst-address": m = /^127\./.test(val) ? false : null; break;   // loopback never arrives from the internet
      case "ipsec-policy": m = val.split(",").includes("none"); break;      // a plain packet matches only "none"
      case "connection-mark": case "packet-mark": case "routing-mark": m = val === "no-mark"; break;
      case "dst-address-list": m = null; break;
      default: m = null;
    }
    if (m === null) { unknown = true; continue; }
    if (neg ? m : !m) return false;
  }
  return unknown ? null : true;
}

/* The first rule that drops (almost) everything still unmatched in a chain from a WAN: the chain's default deny. */
function defaultDeny(M, chain) {
  for (const r of M.chains[chain] || []) {
    const act = r.args.action;
    if (!["drop", "reject", "tarpit"].includes(act)) continue;
    const ks = matchers(r);
    const scoped = ks.every((k) => ["in-interface", "in-interface-list", "connection-state", "connection-nat-state"].includes(k));
    if (!scoped) continue;
    if (r.args["connection-state"] && !r.args["connection-state"].split(",").includes("new")) continue;
    const x = ks.some((k) => k.startsWith("in-interface")) ? ifaceMatch(M, r) : true;
    if (x === true) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ the audit */

const SERVICES = [
  { name: "telnet", port: 23, plain: true }, { name: "ftp", port: 21, plain: true }, { name: "www", port: 80, plain: true },
  { name: "ssh", port: 22 }, { name: "www-ssl", port: 443, off: true }, { name: "api", port: 8728 }, { name: "api-ssl", port: 8729 },
  { name: "winbox", port: 8291 },
];
const RISKY_FORWARDS = { 21: "FTP", 22: "SSH", 23: "Telnet", 135: "MS RPC", 139: "NetBIOS", 445: "SMB", 1433: "MS SQL", 3306: "MySQL", 3389: "RDP",
  5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8291: "WinBox", 9200: "Elasticsearch", 27017: "MongoDB" };

function versionLess(info, a, b, c) {
  if (!info.major) return false;
  const v = [info.major, info.minor || 0, info.patch || 0];
  const w = [a, b, c];
  for (let i = 0; i < 3; i++) if (v[i] !== w[i]) return v[i] < w[i];
  return false;
}

/* Audit an export. users: optional text of /user print (exports don't include users). */
export function audit(text, { users = "" } = {}) {
  if (!String(text).trim()) throw new InputError(tx("Paste the output of /export (or /export hide-sensitive) first."));
  const parsed = parseExport(text);
  const cmds = parsed.entries.filter((e) => e.kind === "cmd");
  if (!cmds.length || !parsed.entries.some((e) => e.kind === "cmd" && e.menu.startsWith("/"))) {
    throw new InputError(tx("This doesn't look like a RouterOS export: no menu lines such as /ip firewall filter were found."));
  }
  const M = model(parsed);
  const out = [];
  const add = (sev, id, title, why, fix, rules = []) => out.push({ sev, id, title, why, fix, lines: rules.filter(Boolean).map((r) => ({ line: r.line, raw: maskSecrets(r.raw) })) });
  const info = parsed.info;

  // ---- version
  if (info.major === 6 && versionLess(info, 6, 42, 1)) {
    add("critical", "version-winbox", tx("RouterOS {v} has the WinBox credential leak (CVE-2018-14847)", { v: info.version }),
      tx("Versions before 6.42.1 let anyone who can reach the WinBox port read the user database, including passwords. Routers on these versions were taken over in large numbers."),
      tx("Upgrade RouterOS (System > Packages > Check for updates), then change every password."), []);
  } else if (info.major === 6) {
    add("info", "version-v6", tx("RouterOS {v} is a version 6 release", { v: info.version }),
      tx("Version 6 now receives only critical fixes. Version 7 brings WireGuard, the newer routing engine and current security fixes."),
      tx("Plan the upgrade; the v6 to v7 migration helper shows what changes in your configuration."), []);
  }

  // ---- firewall structure
  const input = M.chains.input || [];
  const forward = M.chains.forward || [];
  const deny = defaultDeny(M, "input");
  if (!M.filter.length) {
    add("critical", "no-filter", tx("There are no firewall filter rules"),
      tx("Without filter rules RouterOS accepts every packet, so every service on the router is reachable from the internet and nothing stops traffic from the WAN to the LAN."),
      "/ip firewall filter\nadd chain=input action=accept connection-state=established,related,untracked\nadd chain=input action=drop connection-state=invalid\nadd chain=input action=accept in-interface-list=LAN\nadd chain=input action=drop", []);
  } else if (!deny) {
    add(input.length ? "high" : "critical", "input-no-drop", tx("The input chain doesn't end with a drop rule"),
      tx("RouterOS accepts any packet that reaches the end of a chain. Without a final drop (or a drop of everything not coming from the LAN), the input chain only blocks what it lists, and everything else, including new services, is open to the internet."),
      "/ip firewall filter\nadd chain=input action=drop in-interface-list=!LAN comment=\"drop all not coming from LAN\"", input.slice(-1));
  }

  for (const [chain, list] of [["input", input], ["forward", forward]]) {
    if (!list.length) continue;
    const est = list.findIndex((r) => (r.args.action || "accept") === "accept" && r.args["connection-state"] && ["established", "related"].every((s) => r.args["connection-state"].split(",").includes(s)));
    const firstDrop = list.findIndex((r) => ["drop", "reject", "tarpit"].includes(r.args.action));
    if (est < 0) {
      add("medium", `${chain}-no-established`, chain === "input" ? tx("The input chain doesn't accept established and related connections") : tx("The forward chain doesn't accept established and related connections"),
        tx("A rule accepting connection-state=established,related near the top lets replies through after one check, so the rest of the chain only deals with new connections. Without it, replies must match the other rules, which is slow and often breaks things such as DNS replies to the router."),
        `/ip firewall filter\nadd chain=${chain} action=accept connection-state=established,related,untracked place-before=0`, []);
    } else if (firstDrop >= 0 && firstDrop < est && chain === "forward") {
      add("low", `${chain}-late-established`, tx("Established and related traffic is accepted only after a drop rule"),
        tx("Every reply packet is checked against the rules above it first. Moving the accept rule to the top saves CPU and avoids dropping replies by accident."),
        tx("Move the established,related accept rule to the top of the chain."), [list[est]]);
    }
    if (!list.some((r) => ["drop", "reject"].includes(r.args.action) && r.args["connection-state"] && r.args["connection-state"].split(",").includes("invalid"))) {
      add("low", `${chain}-no-invalid`, chain === "input" ? tx("The input chain doesn't drop invalid packets") : tx("The forward chain doesn't drop invalid packets"),
        tx("Packets connection tracking marks as invalid don't belong to any known connection. Dropping them early blocks some scans and spoofed packets."),
        `/ip firewall filter\nadd chain=${chain} action=drop connection-state=invalid`, []);
    }
  }

  // accept-everything rules on input
  for (const r of input) {
    if ((r.args.action || "accept") !== "accept") continue;
    const ks = matchers(r);
    const onlyIface = ks.every((k) => k === "in-interface" || k === "in-interface-list");
    if (onlyIface && (!ks.length || ifaceMatch(M, r) === true)) {
      add("critical", "input-accept-all", tx("A rule accepts all traffic to the router from the internet"),
        tx("This accept rule has no protocol, port or source condition and matches traffic from the WAN, so every service on the router is reachable from the internet. Rules below it can't block anything."),
        tx("Remove the rule, or limit it to the LAN (in-interface-list=LAN) or to specific ports and source addresses."), [r]);
      break;
    }
  }

  // forward protection for NAT routers
  const masq = M.nat.find((r) => r.args.chain === "srcnat" && r.args.action === "masquerade");
  if (masq && M.filter.length) {
    const fwdDeny = defaultDeny(M, "forward") || forward.find((r) => ["drop", "reject"].includes(r.args.action) && r.args["connection-nat-state"] === "!dstnat" && (!r.args["in-interface-list"] || ifaceMatch(M, r) === true));
    if (!fwdDeny) {
      add("medium", "forward-open", tx("New connections from the WAN to the LAN aren't dropped"),
        tx("Masquerade hides the LAN for outgoing traffic, but it doesn't stop anyone on the WAN side (your ISP's network, or a neighbour on a shared segment) from sending packets to your private addresses through the router. The default configuration drops new WAN connections that aren't port forwards."),
        "/ip firewall filter\nadd chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface-list=WAN", []);
    }
  }

  // ---- shadowed rules
  let shadowCount = 0;
  for (const list of Object.values(M.chains)) {
    for (let j = 1; j < list.length && shadowCount < 12; j++) {
      const b = list[j];
      for (let i = 0; i < j; i++) {
        const a = list[i];
        if (!TERMINAL.has(a.args.action || "accept")) continue;
        if (!covers(a, b)) continue;
        if (!matchers(a).length && ["drop", "reject"].includes(a.args.action) && j === list.length - 1 && ["drop", "reject"].includes(b.args.action) && !matchers(b).length) break;
        shadowCount++;
        add("low", "shadowed", tx("Rule on line {b} can never match", { b: b.line }),
          tx("An earlier rule (line {a}) in the same chain matches every packet this rule would, and ends processing with {action}. This rule never counts a packet; it is probably in the wrong place.", { a: a.line, action: a.args.action || "accept" }),
          tx("Move the rule above line {a}, or remove it if it is no longer needed.", { a: a.line }), [a, b]);
        break;
      }
    }
  }

  // ---- services
  const svc = {};
  for (const e of inMenu(parsed, "/ip service", "set")) {
    let name = e.pos[0];
    if (!name && e.find) { const m = e.find.match(/name="?([\w-]+)"?/); if (m) name = m[1]; }
    if (name) svc[name] = { ...(svc[name] || {}), ...e.args, entry: e };
  }
  const pkt = (p, port) => ({ proto: p, port, anySource: true });
  for (const s of SERVICES) {
    const conf = svc[s.name] || {};
    const disabled = conf.disabled === "yes" || (s.off && conf.disabled !== "no");
    if (disabled) continue;
    const port = Number(conf.port || s.port);
    const restricted = !!(conf.address && conf.address.trim() && !/(^|,)0\.0\.0\.0\/0(,|$)/.test(conf.address));
    const ev = M.filter.length ? evaluate(M, "input", pkt("tcp", port)) : { verdict: "default-accept" };
    const exposed = ev.verdict === "accept" || ev.verdict === "default-accept";
    const svcName = s.name;
    if (exposed && !restricted) {
      add(s.plain ? "critical" : "high", `svc-${svcName}`, tx("{service} (TCP {port}) is reachable from the internet", { service: svcName, port }),
        s.plain ? tx("This service sends passwords in clear text and is open to anyone on the internet. Exposed management services are scanned and brute-forced within minutes of going online.")
          : tx("Anyone on the internet can reach this management service and try passwords against it. Exposed management services are scanned and brute-forced within minutes of going online."),
        s.plain ? `/ip service\nset ${svcName} disabled=yes` : `/ip service\nset ${svcName} address=<management subnet>\n# and make the input chain drop everything not from the LAN`,
        [ev.rule || conf.entry]);
    } else if (exposed && restricted) {
      add("medium", `svc-${svcName}`, tx("{service} relies only on its address list ({address})", { service: svcName, address: conf.address }),
        tx("The firewall lets the internet reach this service; only the service's own address restriction turns other sources away, after the TCP connection is already open. A firewall drop is the stronger first layer."),
        tx("Drop the port in the input chain for everything except the management subnets."), [ev.rule, conf.entry]);
    } else if (s.plain) {
      add("low", `svc-${svcName}`, tx("{service} is enabled", { service: svcName }),
        tx("The firewall blocks it from the internet, but it sends passwords in clear text on the LAN. Turn off services you don't use."),
        `/ip service\nset ${svcName} disabled=yes`, [conf.entry]);
    }
  }

  // ---- DNS, proxy, socks, upnp, snmp, bandwidth test
  const dns = settingsOf(parsed, "/ip dns");
  if (dns["allow-remote-requests"] === "yes") {
    const ev = M.filter.length ? evaluate(M, "input", pkt("udp", 53)) : { verdict: "default-accept" };
    if (ev.verdict !== "drop") {
      add("high", "dns-open", tx("The router is an open DNS resolver"),
        tx("allow-remote-requests=yes makes the router answer DNS queries on every interface, and the input chain doesn't drop DNS from the internet. Open resolvers are abused to amplify DDoS attacks, which can get your connection blocked by your ISP."),
        "/ip firewall filter\nadd chain=input action=drop protocol=udp dst-port=53 in-interface-list=WAN\nadd chain=input action=drop protocol=tcp dst-port=53 in-interface-list=WAN",
        [inMenu(parsed, "/ip dns", "set").find((e) => e.args["allow-remote-requests"]), ev.rule]);
    }
  }
  for (const [menu, label, def, id] of [["/ip proxy", "Web proxy", 8080, "proxy"], ["/ip socks", "SOCKS proxy", 1080, "socks"]]) {
    const st = settingsOf(parsed, menu);
    if (st.enabled !== "yes") continue;
    const port = Number(String(st.port || def).split(",")[0]);
    const ev = M.filter.length ? evaluate(M, "input", pkt("tcp", port)) : { verdict: "default-accept" };
    const entry = inMenu(parsed, menu, "set").find((e) => e.args.enabled === "yes");
    if (ev.verdict !== "drop") {
      add("high", `${id}-open`, tx("{label} is enabled and reachable from the internet (TCP {port})", { label, port }),
        tx("An open proxy lets anyone relay traffic through your router: spam, attacks and abuse that will be traced to your address. Compromised MikroTik routers are often found with an attacker-enabled proxy."),
        `${menu}\nset enabled=no`, [entry, ev.rule]);
    } else {
      add("low", `${id}-on`, tx("{label} is enabled", { label }),
        tx("The firewall blocks it from the internet. If you didn't turn it on yourself, treat it as a sign of compromise: check users, scheduler and scripts."),
        `${menu}\nset enabled=no`, [entry]);
    }
  }
  const upnp = settingsOf(parsed, "/ip upnp");
  if (upnp.enabled === "yes") {
    add("medium", "upnp", tx("UPnP is enabled"),
      tx("UPnP lets any device on the LAN open ports from the internet to itself without asking. Malware uses it to make infected devices reachable."),
      "/ip upnp\nset enabled=no", [inMenu(parsed, "/ip upnp", "set").find((e) => e.args.enabled)]);
  }
  const snmp = settingsOf(parsed, "/snmp");
  if (snmp.enabled === "yes") {
    const communities = inMenu(parsed, "/snmp community").filter((e) => e.cmd === "add" || e.cmd === "set");
    const renamed = communities.some((e) => e.args.name && e.args.name !== "public");
    const ev = M.filter.length ? evaluate(M, "input", pkt("udp", 161)) : { verdict: "default-accept" };
    if (!renamed || ev.verdict !== "drop") {
      add(ev.verdict !== "drop" ? "high" : "medium", "snmp", ev.verdict !== "drop" ? tx("SNMP is reachable from the internet") : tx("SNMP uses the default community"),
        tx("SNMP v1/v2c sends the community name in clear text, and \"public\" is the first one anyone tries. It exposes interfaces, addresses, routes and neighbours."),
        "/snmp community\nset [ find default=yes ] name=<a long random name> addresses=<monitoring server>/32\n# or use SNMPv3 with authentication and encryption",
        [inMenu(parsed, "/snmp", "set").find((e) => e.args.enabled), ev.rule]);
    }
  }
  const bw = settingsOf(parsed, "/tool bandwidth-server");
  if (bw.enabled !== "no" && cmds.length > 5) {
    const ev = M.filter.length ? evaluate(M, "input", pkt("tcp", 2000)) : { verdict: "default-accept" };
    add(ev.verdict !== "drop" ? "medium" : "low", "btest", tx("The bandwidth test server is on"),
      ev.verdict !== "drop" ? tx("It is on by default and reachable from the internet, where it can be used to saturate your link.") : tx("It is on by default. The firewall blocks it from the internet, but it is rarely needed on a production router."),
      "/tool bandwidth-server\nset enabled=no", []);
  }

  // ---- layer 2 access
  const mac = settingsOf(parsed, "/tool mac-server");
  const macWb = settingsOf(parsed, "/tool mac-server mac-winbox");
  const nd = settingsOf(parsed, "/ip neighbor discovery-settings");
  const l2 = [];
  if (!mac["allowed-interface-list"] || mac["allowed-interface-list"] === "all") l2.push("MAC Telnet");
  if (!macWb["allowed-interface-list"] || macWb["allowed-interface-list"] === "all") l2.push("MAC WinBox");
  if (!nd["discover-interface-list"] || nd["discover-interface-list"] === "all") l2.push(tx("neighbour discovery"));
  if (l2.length && (info.major !== 6 || !versionLess(info, 6, 41, 0))) {
    add("low", "l2-access", tx("Layer 2 access isn't limited to the LAN: {list}", { list: l2.join(", ") }),
      tx("MAC Telnet, MAC WinBox and neighbour discovery work below IP, so firewall rules don't apply to them. On all interfaces they also answer on the WAN side, where your ISP's other customers may share the segment."),
      "/tool mac-server set allowed-interface-list=LAN\n/tool mac-server mac-winbox set allowed-interface-list=LAN\n/ip neighbor discovery-settings set discover-interface-list=LAN", []);
  }

  // ---- port forwards to risky services
  for (const r of M.nat) {
    if (r.args.action !== "dst-nat" || r.args["src-address"] || r.args["src-address-list"]) continue;
    let ports;
    try { ports = parsePorts(r.args["to-ports"] || r.args["dst-port"] || ""); } catch (_) { continue; }
    const hit = Object.keys(RISKY_FORWARDS).map(Number).filter((p) => ports.ranges.some(([lo, hi]) => p >= lo && p <= hi));
    if (hit.length) {
      add("medium", "risky-forward", tx("{service} is forwarded from the internet to {ip}", { service: hit.map((p) => RISKY_FORWARDS[p]).join(", "), ip: r.args["to-addresses"] || "?" }),
        tx("Remote access and database services published to the whole internet are among the first things attackers scan for and brute-force."),
        tx("Restrict the rule with src-address-list= to known addresses, or reach the service through a VPN such as WireGuard instead."), [r]);
    }
  }

  // ---- users
  const userAdds = inMenu(parsed, "/user", "add").map((e) => e.args.name);
  const printed = [...String(users).matchAll(/name="?([^"\s]+)"?/g)].map((m) => m[1]);
  for (const line of String(users).split("\n")) {     // the table form of /user print: "0  admin  full ..."
    const m = line.match(/(?:^|\s)([A-Za-z0-9._@-]+)\s+(full|read|write)(\s|$)/);
    if (m && !/^(NAME|GROUP)$/i.test(m[1])) printed.push(m[1]);
  }
  const all = [...userAdds, ...printed];
  if (all.includes("admin")) {
    add("medium", "admin-user", tx("The default \"admin\" account exists"),
      tx("Every brute-force attempt against a MikroTik router starts with the user name admin. Creating your own full-access user and removing or disabling admin takes that guess away."),
      "/user add name=<your-name> group=full password=<long passphrase>\n/user disable admin   # after logging in as the new user", []);
  } else if (!all.length) {
    add("info", "users-unknown", tx("User accounts weren't checked"),
      tx("An export doesn't include users. Paste the output of /user print into the optional box to check for the default admin account."), "", []);
  }

  out.sort((a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev));
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, out.filter((f) => f.sev === s).length]));
  return { info, findings: out, counts, stats: { rules: M.filter.length, nat: M.nat.length, wan: [...M.wanIf], lines: parsed.entries.length } };
}
