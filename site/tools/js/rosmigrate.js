// RouterOS v6 to v7 configuration helper: converts the constructs that changed mechanically and marks everything
// else for manual review. Conservative by design: when a conversion isn't certain, the line is commented out with a
// "# REVIEW" note rather than guessed. Pure functions; nothing is sent anywhere.
import { tx } from "./core.js?v=11";
import { parseExport, inMenu, q, InputError } from "./roscore.js?v=11";
import { parseV4, fmtV4 } from "./dev3core.js?v=11";

const HEADER_RE = /^(\d{4}-\d\d-\d\d|[a-z]{3}\/\d\d\/\d{4}) .* by RouterOS|^software id|^model|^serial number|^$/i;

/* Re-create a command line from an entry with changed arguments: changes {key: newValue | null (drop)}, rename {old: new}. */
function rebuild(e, { changes = {}, rename = {}, add = [] } = {}) {
  const parts = [e.cmd];
  if (e.find) parts.push(`[ find ${e.find} ]`);
  for (const p of e.pos) parts.push(q(p));
  for (const k of e.keys) {
    if (k in changes && changes[k] === null) continue;
    const v = k in changes ? changes[k] : e.args[k];
    parts.push(`${rename[k] || k}=${q(v)}`);
  }
  for (const [k, v] of add) parts.push(v === true ? k : `${k}=${q(v)}`);
  for (const u of e.unset) parts.push("!" + u);
  return parts.join(" ");
}

const v4net = (text) => {
  const [a, p] = text.split("/");
  const prefix = p === undefined ? 32 : Number(p);
  const addr = parseV4(a);
  const host = (1n << BigInt(32 - prefix)) - 1n;
  return { lo: addr & ~host & 0xffffffffn, hi: (addr & ~host & 0xffffffffn) | host, prefix };
};

/* Convert a v6 export. Returns {text, review: [{line, msg}], stats: {converted, kept, review}, info}. */
export function migrate(text) {
  if (!String(text).trim()) throw new InputError(tx("Paste a RouterOS v6 export first."));
  const parsed = parseExport(text);
  const info = parsed.info;
  if (!parsed.entries.some((e) => e.kind === "cmd")) throw new InputError(tx("This doesn't look like a RouterOS export: no menu lines such as /ip address were found."));
  if (info.major && info.major >= 7) throw new InputError(tx("This export already comes from RouterOS {v}. The helper converts version 6 exports.", { v: info.version }));

  const body = [];            // [{menu, line}] in export order
  const routing = [];         // [{menu, line}] emitted after everything else
  const tables = new Map();   // routing table name -> first line that needed it
  const review = [];
  const stats = { converted: 0, kept: 0, review: 0 };
  const emit = (menu, line) => body.push({ menu, line });
  const remit = (menu, line) => routing.push({ menu, line });
  const flag = (e, msg, target = emit, menu = e.menu) => {
    review.push({ line: e.line, msg });
    stats.review++;
    target(menu, `# REVIEW (line ${e.line}): ${msg}`);
  };
  const keep = (e) => { emit(e.menu, e.raw); stats.kept++; };
  const commented = (e, target = emit, menu = e.menu) => target(menu, `# v6: ${e.raw}`);
  const filterChains = new Map();   // v6 routing filter chain -> first line
  const needTable = (name, e) => { if (name && name !== "main" && !tables.has(name)) tables.set(name, e.line); };

  // addresses per interface, to place OSPF interface settings in the right area
  const addrs = inMenu(parsed, "/ip address", "add").filter((e) => e.args.address && e.args.interface)
    .map((e) => ({ iface: e.args.interface, ...(() => { try { return { a: parseV4(e.args.address.split("/")[0]) }; } catch (_) { return { a: null }; } })() }));

  // ---- OSPF state
  const ospf = { instances: new Map(), areas: new Map(), networks: [], seen: false };
  const nm = (n) => `${n}-v2`;
  // ---- BGP state
  const bgp = { instance: { as: null, "router-id": null, redistribute: [] }, networks: [], peers: [] };

  let seenWireless = false, seenUm = false;

  for (const e of parsed.entries) {
    if (e.kind === "comment") { if (!HEADER_RE.test(e.text.trim())) emit(null, e.raw); continue; }
    if (e.kind === "menu") continue;
    if (e.kind === "script") { emit(e.menu, e.raw); stats.kept++; continue; }
    const m = e.menu;

    // ------------------------------------------------ static routes
    if (m === "/ip route" && e.cmd === "add") {
      const ch = {}, rn = {};
      const notes = [];
      if (e.args["routing-mark"]) { rn["routing-mark"] = "routing-table"; needTable(e.args["routing-mark"], e); }
      if (e.args.type && e.args.type !== "unicast") {
        if (e.args.type === "blackhole") { ch.type = null; notes.push(tx("type=blackhole became the blackhole property in v7; this line uses it, check the route after import.")); }
        else { flag(e, tx("type={type} has no direct equivalent in v7 (only blackhole routes remain). Decide how to replace it.", { type: e.args.type })); commented(e); continue; }
      }
      for (const k of e.keys) if (/^bgp-|^route-tag$|^vrf-interface$|^ospf-/.test(k)) { flag(e, tx("{key} on a static route isn't supported in v7; set it with a routing filter instead.", { key: k })); commented(e); ch.__skip = true; break; }
      if (ch.__skip) continue;
      const gws = (e.args.gateway || "").split(",").filter(Boolean);
      const add = e.args.type === "blackhole" ? [["blackhole", true]] : [];
      for (const n of notes) flag(e, n);
      if (gws.length > 1) {
        flag(e, tx("v7 makes ECMP from separate routes with the same distance, so this route was split into {n}.", { n: gws.length }));
        for (const g of gws) emit(m, rebuild(e, { changes: { ...ch, gateway: g }, rename: rn, add }));
        stats.converted++;
        continue;
      }
      if (Object.keys(rn).length || Object.keys(ch).length) { commented(e); emit(m, rebuild(e, { changes: ch, rename: rn, add })); stats.converted++; }
      else keep(e);
      continue;
    }
    if (m === "/ip route rule" && e.cmd === "add") {
      commented(e, emit, "/routing rule");
      if (e.args.table) needTable(e.args.table, e);
      if (e.args["routing-mark"]) needTable(e.args["routing-mark"], e);
      emit("/routing rule", rebuild(e));
      stats.converted++;
      continue;
    }
    if (m === "/ip route vrf") { flag(e, tx("VRFs moved to /ip vrf in v7 with different settings; recreate this VRF by hand.")); commented(e); continue; }

    // ------------------------------------------------ firewall: routing marks need tables
    if (m.startsWith("/ip firewall") && e.cmd === "add") {
      if (e.args["new-routing-mark"]) needTable(e.args["new-routing-mark"], e);
      if (e.args["routing-mark"]) needTable(e.args["routing-mark"].replace(/^!/, ""), e);
      keep(e);
      continue;
    }

    // ------------------------------------------------ routing filters
    if (m === "/routing filter" && e.cmd === "add") { convertFilter(e); continue; }

    // ------------------------------------------------ OSPF
    if (m === "/routing ospf instance") { ospfInstance(e); continue; }
    if (m === "/routing ospf area" && (e.cmd === "add" || e.cmd === "set")) {
      ospf.seen = true;
      const name = e.args.name || e.pos[0] || (e.find && /default=yes/.test(e.find) ? "backbone" : null);
      if (!name) { flag(e, tx("Couldn't tell which area this line changes; convert it by hand."), remit, "/routing ospf area"); commented(e, remit, "/routing ospf area"); continue; }
      const a = ospf.areas.get(name) || { name, "area-id": name === "backbone" ? "0.0.0.0" : null, instance: "default", type: null, line: e.line };
      if (e.args["area-id"]) a["area-id"] = e.args["area-id"];
      if (e.args.instance) a.instance = e.args.instance;
      if (e.args.type) a.type = e.args.type;
      if (e.args["translator-role"] || e.args["default-cost"] || e.args["inject-summary-lsas"]) flag(e, tx("Area options such as default-cost and inject-summary-lsas weren't converted; set them on the v7 area by hand."), remit, "/routing ospf area");
      ospf.areas.set(name, a);
      stats.converted++;
      continue;
    }
    if (m === "/routing ospf network" && e.cmd === "add") {
      ospf.seen = true;
      ospf.networks.push({ network: e.args.network, area: e.args.area || "backbone", disabled: e.args.disabled, comment: e.args.comment, line: e.line, raw: e.raw });
      stats.converted++;
      continue;
    }
    if (m === "/routing ospf interface" && e.cmd === "add") { ospf.seen = true; ospf.ifaces = ospf.ifaces || []; ospf.ifaces.push(e); continue; }
    if (m.startsWith("/routing ospf") || m.startsWith("/routing ospf-v3")) {
      flag(e, m.startsWith("/routing ospf-v3") ? tx("OSPFv3 became /routing ospf with version=3 in v7; convert it by hand.") : tx("This OSPF setting ({menu}) isn't converted automatically.", { menu: m }), remit, "/routing ospf");
      commented(e, remit, "/routing ospf");
      continue;
    }

    // ------------------------------------------------ BGP
    if (m === "/routing bgp instance" && (e.cmd === "set" || e.cmd === "add")) {
      const name = e.args.name || e.pos[0] || "default";
      if (name !== "default" && e.cmd === "add") { flag(e, tx("Only the default BGP instance is converted; v7 has no instances, so merge this one into connections by hand."), remit, "/routing bgp connection"); commented(e, remit, "/routing bgp connection"); continue; }
      for (const k of ["as", "router-id"]) if (e.args[k]) bgp.instance[k] = e.args[k];
      for (const [k, v] of [["redistribute-connected", "connected"], ["redistribute-static", "static"], ["redistribute-ospf", "ospf"], ["redistribute-rip", "rip"], ["redistribute-other-bgp", "bgp"]]) {
        if (e.args[k] === "yes") bgp.instance.redistribute.push(v);
      }
      if (e.args["client-to-client-reflection"] || e.args["cluster-id"] || e.args.confederation) flag(e, tx("Route reflection and confederation settings moved to each v7 connection (cluster-id, local.role); set them by hand."), remit, "/routing bgp connection");
      if (e.args["out-filter"]) flag(e, tx("The instance-wide out-filter has no v7 equivalent; add its chain to each connection's output.filter-chain."), remit, "/routing bgp connection");
      bgp.instanceLine = e.line;
      stats.converted++;
      continue;
    }
    if (m === "/routing bgp network" && e.cmd === "add") { bgp.networks.push(e); stats.converted++; continue; }
    if (m === "/routing bgp peer" && e.cmd === "add") { bgp.peers.push(e); continue; }
    if (m.startsWith("/routing bgp")) { flag(e, tx("This BGP setting ({menu}) isn't converted automatically.", { menu: m }), remit, "/routing bgp connection"); commented(e, remit, "/routing bgp connection"); continue; }

    // ------------------------------------------------ other routing protocols
    if (/^\/routing (rip|pim|bfd|mme|prefix-lists)/.test(m)) { flag(e, tx("{menu} changed in v7 and isn't converted; recreate it by hand.", { menu: m })); commented(e); continue; }
    if (m.startsWith("/mpls")) { flag(e, tx("MPLS and LDP settings changed in v7; check this line against the v7 documentation.")); keep(e); continue; }

    // ------------------------------------------------ NTP client
    if (m === "/system ntp client" && e.cmd === "set") {
      commented(e);
      const servers = [e.args["primary-ntp"], e.args["secondary-ntp"], ...(e.args["server-dns-names"] || "").split(",")].filter((x) => x && x !== "0.0.0.0");
      const rest = { ...e };
      const ch = { "primary-ntp": null, "secondary-ntp": null, "server-dns-names": null };
      if (e.args.mode && e.args.mode !== "unicast") flag(e, tx("NTP mode {mode} isn't converted; v7 clients are unicast unless you change it.", { mode: e.args.mode }));
      ch.mode = null;
      emit(m, rebuild(rest, { changes: ch }));
      for (const sv of servers) emit("/system ntp client servers", `add address=${q(sv)}`);
      stats.converted++;
      continue;
    }

    // ------------------------------------------------ queues
    if (m === "/queue type" && e.cmd === "add" && (e.args["pcq-limit"] || e.args["pcq-total-limit"])) {
      keep(e);
      flag(e, tx("RouterOS v7 counts pcq-limit and pcq-total-limit in KiB instead of packets; check that these values still make sense."));
      continue;
    }

    // ------------------------------------------------ packages that changed
    if (m.startsWith("/tool user-manager")) { if (!seenUm) flag(e, tx("User Manager was rewritten for v7 (/user-manager) and its v6 data isn't imported this way. Migrate users with the v7 User Manager's tools.")); seenUm = true; commented(e); continue; }
    if ((m.startsWith("/interface wireless") || m.startsWith("/caps-man")) && !seenWireless) {
      seenWireless = true;
      flag(e, tx("Wireless settings are kept as they are. They work in v7 with the wireless package; Wi-Fi 6 (ax) devices use the new /interface wifi menu instead and need them recreated."));
    }
    if ((m === "/system script" || m === "/system scheduler") && e.cmd === "add") {
      const src = e.args.source || e.args["on-event"] || "";
      if (/routing-mark|\/routing (ospf|bgp|filter)|primary-ntp|\/ip route rule/.test(src)) {
        keep(e);
        flag(e, tx("This script uses commands that changed in v7 (routing marks, OSPF, BGP, routing filters or NTP). Update it by hand."));
        continue;
      }
    }
    keep(e);
  }

  // ------------------------------------------------ filters
  function convertFilter(e) {
    const a = e.args;
    const cond = [], act = [], missing = [];
    for (const k of e.keys) {
      const v = a[k];
      switch (k) {
        case "chain": case "comment": case "disabled": case "action": case "jump-target": case "prefix-length": break;
        case "prefix": {
          if (a["prefix-length"]) {
            const [lo, hi] = a["prefix-length"].split("-");
            cond.push(`dst in ${v}`, hi === undefined || lo === hi ? `dst-len == ${lo}` : `dst-len in ${lo}-${hi}`);
          } else cond.push(`dst == ${v}`);
          break;
        }
        case "set-distance": act.push(`set distance ${v}`); break;
        case "set-bgp-local-pref": act.push(`set bgp-local-pref ${v}`); break;
        case "set-bgp-prepend": act.push(`set bgp-path-prepend ${v}`); break;
        case "set-bgp-med": act.push(`set bgp-med ${v}`); break;
        default: missing.push(`${k}=${v}`);
      }
    }
    if (a["prefix-length"] && !a.prefix) missing.push(`prefix-length=${a["prefix-length"]}`);
    const action = a.action || "passthrough";
    const finals = { accept: "accept", discard: "reject", reject: "reject", passthrough: "", return: "return" };
    if (action === "jump") act.push(`jump ${a["jump-target"]}`);
    else if (action in finals) { if (finals[action]) act.push(finals[action]); }
    else missing.push(`action=${action}`);
    const menu = "/routing filter rule";
    if (!filterChains.has(a.chain)) filterChains.set(a.chain, e.line);
    commented(e, remit, menu);
    if (missing.length || !cond.length || !act.length) {
      const why = missing.length ? tx("{list} has no reliable automatic v7 equivalent (v7 filters use a scripting syntax).", { list: missing.join(", ") })
        : !cond.length ? tx("The rule has no prefix condition; write the v7 rule by hand.") : tx("The rule has no action that v7 would apply; check what it was meant to do.");
      flag(e, why, remit, menu);
      if (cond.length && act.length) remit(menu, `# add chain=${q(a.chain)} rule=${q(`if (${cond.join(" && ")}) { ${act.join("; ")} }`)}`);
      return;
    }
    if (action === "discard") review.push({ line: e.line, msg: tx("discard became reject (v7 has no separate discard).") });
    const args = [`chain=${q(a.chain)}`, `rule=${q(`if (${cond.join(" && ")}) { ${act.join("; ")} }`)}`];
    if (a.disabled === "yes") args.push("disabled=yes");
    if (a.comment) args.push(`comment=${q(a.comment)}`);
    remit(menu, `add ${args.join(" ")}`);
    stats.converted++;
  }

  function ospfInstance(e) {
    ospf.seen = true;
    const name = e.args.name || e.pos[0] || (e.find && /default=yes|name=default/.test(e.find) ? "default" : null) || "default";
    const inst = ospf.instances.get(name) || { name, args: {}, line: e.line };
    Object.assign(inst.args, e.args);
    ospf.instances.set(name, inst);
    stats.converted++;
  }

  // ------------------------------------------------ assemble OSPF
  if (ospf.seen) {
    const M = "/routing ospf instance";
    if (!ospf.instances.size) ospf.instances.set("default", { name: "default", args: {}, line: null });
    for (const inst of ospf.instances.values()) {
      const a = inst.args;
      const red = [];
      const fake = { line: inst.line || 0, menu: M };
      for (const [k, v] of [["redistribute-connected", "connected"], ["redistribute-static", "static"], ["redistribute-rip", "rip"], ["redistribute-bgp", "bgp"], ["redistribute-other-ospf", "ospf"]]) {
        if (a[k] && a[k] !== "no") {
          red.push(v);
          if (a[k] === "as-type-1") flag(fake, tx("{key}=as-type-1: v7 redistributes as type 2 by default; set type 1 with \"set ospf-ext-type type1\" in the out-filter-chain.", { key: k }), remit, M);
        }
      }
      // v6 instances filtered through the chains ospf-in and ospf-out by default; v7 only uses chains it is told about
      for (const [k, chain] of [["in-filter", "ospf-in"], ["out-filter", "ospf-out"]]) {
        if (a[k] === undefined && filterChains.has(chain)) {
          a[k] = chain;
          flag(fake, tx("v6 applied the routing filter chain {chain} to OSPF by default; the v7 instance now names it explicitly.", { chain }), remit, M);
        }
      }
      const dd = a["distribute-default"];
      const orig = !dd || dd === "never" ? "" : dd.startsWith("always") ? "always" : "if-installed";
      if (dd && /type-1/.test(dd)) flag(fake, tx("distribute-default as type 1: v7 originates the default route as type 2 unless an out filter changes it."), remit, M);
      for (const k of Object.keys(a)) if (/^metric-|^mpls-te|^routing-table$|^domain-/.test(k)) flag(fake, tx("{key} wasn't converted; set the equivalent in v7 by hand or with a routing filter.", { key: k }), remit, M);
      remit(M, `add ${[`name=${q(nm(inst.name))}`, "version=2", a["router-id"] && a["router-id"] !== "0.0.0.0" ? `router-id=${a["router-id"]}` : "",
        red.length ? `redistribute=${red.join(",")}` : "", orig ? `originate-default=${orig}` : "",
        a["in-filter"] ? `in-filter-chain=${q(a["in-filter"])}` : "", a["out-filter"] ? `out-filter-chain=${q(a["out-filter"])}` : "",
        a.disabled === "yes" ? "disabled=yes" : ""].filter(Boolean).join(" ")}`);
      stats.converted++;
    }
    // areas: every area a network uses must exist; v6 had an implicit backbone
    for (const n of ospf.networks) if (!ospf.areas.has(n.area)) ospf.areas.set(n.area, { name: n.area, "area-id": n.area === "backbone" ? "0.0.0.0" : null, instance: "default", type: null });
    const A = "/routing ospf area";
    for (const a of ospf.areas.values()) {
      if (!a["area-id"]) { flag({ line: a.line || 0 }, tx("Area {name} has no area-id in the export; set it in the line below.", { name: a.name }), remit, A); }
      remit(A, `add ${[`name=${q(nm(a.name))}`, `area-id=${a["area-id"] || "0.0.0.0"}`, `instance=${q(nm(a.instance))}`, a.type && a.type !== "default" ? `type=${a.type}` : ""].filter(Boolean).join(" ")}`);
    }
    const T = "/routing ospf interface-template";
    // per-interface settings first, in the area of the network that holds the interface's address
    for (const e of ospf.ifaces || []) {
      const a = e.args;
      commented(e, remit, T);
      if (!a.interface || a.interface === "all") {
        flag(e, tx("Settings for interface=all have no v7 equivalent; set them on each interface template instead."), remit, T);
        continue;
      }
      const own = addrs.filter((x) => x.iface === a.interface && x.a !== null);
      const net = ospf.networks.find((n) => { try { const r = v4net(n.network); return own.some((x) => x.a >= r.lo && x.a <= r.hi); } catch (_) { return false; } });
      const extra = [];
      const type = { broadcast: "broadcast", "point-to-point": "ptp", ptmp: "ptmp", nbma: "nbma" }[a["network-type"]];
      if (type) extra.push(`type=${type}`);
      for (const k of ["cost", "priority", "hello-interval", "dead-interval", "retransmit-interval", "transmit-delay"]) if (a[k]) extra.push(`${k}=${q(a[k])}`);
      if (a.passive === "yes") extra.push("passive");
      if (a.authentication && a.authentication !== "none") {
        extra.push(`auth=${a.authentication}`);
        if (a["authentication-key"]) extra.push(`auth-key=${q(a["authentication-key"])}`);
        if (a["authentication-key-id"]) extra.push(`auth-id=${a["authentication-key-id"]}`);
      }
      if (a["use-bfd"] === "yes") extra.push("use-bfd=yes");
      if (!net) {
        flag(e, tx("Couldn't find which OSPF network {iface} is in (no matching /ip address in the export). Add area= and networks= to the template below.", { iface: a.interface }), remit, T);
        remit(T, `# add interfaces=${q(a.interface)} ${extra.join(" ")}`);
        continue;
      }
      remit(T, `add ${[`area=${q(nm(net.area))}`, `interfaces=${q(a.interface)}`, `networks=${net.network}`, ...extra].join(" ")}`);
      flag(e, tx("Settings for {iface} became their own template, placed before the network templates. Check with /routing ospf interface print that the interface uses it.", { iface: a.interface }), remit, T);
      stats.converted++;
    }
    for (const n of ospf.networks) {
      remit(T, `add ${[`area=${q(nm(n.area))}`, `networks=${n.network}`, n.disabled === "yes" ? "disabled=yes" : "", n.comment ? `comment=${q(n.comment)}` : ""].filter(Boolean).join(" ")}`);
    }
  }

  // ------------------------------------------------ assemble BGP
  if (bgp.networks.length) {
    const L = "/ip firewall address-list";
    for (const e of bgp.networks) {
      commented(e, remit, L);
      remit(L, `add list=bgp-networks address=${e.args.network}${e.args.comment ? ` comment=${q(e.args.comment)}` : ""}`);
      if (e.args.synchronize === "no") flag(e, tx("v6 advertised {net} even without a matching route (synchronize=no). v7 advertises a network only while a matching route is active; add a blackhole route for it if needed.", { net: e.args.network }), remit, L);
    }
  }
  if (bgp.peers.length) {
    const C = "/routing bgp connection";
    const localAs = bgp.instance.as;
    for (const e of bgp.peers) {
      const a = e.args;
      commented(e, remit, C);
      if (a.instance && a.instance !== "default") flag(e, tx("This peer belongs to instance {name}, which wasn't converted; set as= and router-id= by hand.", { name: a.instance }), remit, C);
      const role = !localAs || !a["remote-as"] ? null : a["remote-as"] === localAs ? (a["route-reflect"] === "yes" ? "ibgp-rr" : "ibgp") : "ebgp";
      if (!role) flag(e, tx("The local or remote AS is missing, so local.role couldn't be chosen; v7 requires it."), remit, C);
      if (a["route-reflect"] === "yes") flag(e, tx("route-reflect=yes became local.role=ibgp-rr; check the cluster-id."), remit, C);
      const out = [`name=${q(a.name || `peer-${e.line}`)}`];
      if (a["remote-address"]) out.push(`remote.address=${a["remote-address"]}`);
      if (a["remote-as"]) out.push(`remote.as=${a["remote-as"]}`);
      if (a["remote-port"]) out.push(`remote.port=${a["remote-port"]}`);
      if (localAs) out.push(`as=${localAs}`);
      if (bgp.instance["router-id"] && bgp.instance["router-id"] !== "0.0.0.0") out.push(`router-id=${bgp.instance["router-id"]}`);
      out.push(`local.role=${role || "ebgp"}`);
      if (a["update-source"]) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(a["update-source"])) out.push(`local.address=${a["update-source"]}`);
        else {
          const own = addrs.find((x) => x.iface === a["update-source"] && x.a !== null);
          if (own) { out.push(`local.address=${fmtV4(own.a)}`); flag(e, tx("update-source={iface} became local.address={ip}, the first address on that interface.", { iface: a["update-source"], ip: fmtV4(own.a) }), remit, C); }
          else flag(e, tx("update-source={iface} needs an address in v7 (local.address=); add it by hand.", { iface: a["update-source"] }), remit, C);
        }
      }
      if (a["in-filter"]) out.push(`input.filter=${q(a["in-filter"])}`);
      if (a["out-filter"]) out.push(`output.filter-chain=${q(a["out-filter"])}`);
      if (bgp.networks.length) out.push("output.network=bgp-networks");
      if (bgp.instance.redistribute.length) out.push(`output.redistribute=${bgp.instance.redistribute.join(",")}`);
      if (a["default-originate"] && a["default-originate"] !== "never") out.push(`output.default-originate=${a["default-originate"]}`);
      if (a["remove-private-as"] === "yes") out.push("output.remove-private-as=yes");
      if (a["as-override"] === "yes") out.push("output.as-override=yes");
      if (a["nexthop-choice"] && a["nexthop-choice"] !== "default") out.push(`nexthop-choice=${a["nexthop-choice"]}`);
      for (const k of ["multihop", "tcp-md5-key", "hold-time", "keepalive-time", "use-bfd", "address-families", "comment", "disabled"]) if (a[k]) out.push(`${k}=${q(a[k])}`);
      const skipped = e.keys.filter((k) => !(k === "ttl" && a[k] === "default") && !["name", "remote-address", "remote-as", "remote-port", "instance", "update-source", "in-filter", "out-filter", "default-originate", "remove-private-as",
        "as-override", "nexthop-choice", "multihop", "tcp-md5-key", "hold-time", "keepalive-time", "use-bfd", "address-families", "comment", "disabled", "route-reflect"].includes(k));
      if (skipped.length) flag(e, tx("Not converted: {list}. Find the v7 connection setting for each by hand.", { list: skipped.map((k) => `${k}=${a[k]}`).join(", ") }), remit, C);
      if (/vpnv4|l2vpn/.test(a["address-families"] || "")) flag(e, tx("VPNv4 and L2VPN address families changed in v7; check this connection against the v7 documentation."), remit, C);
      remit(C, `add ${out.join(" ")}`);
      stats.converted++;
    }
  } else if (bgp.instanceLine) {
    review.push({ line: bgp.instanceLine, msg: tx("The BGP instance settings were read, but there are no peers to attach them to.") });
  }
  if (filterChains.size) {
    for (const [chain, line] of filterChains) {
      review.push({ line, msg: tx("Chain {chain}: v7 rejects routes that reach the end of a filter chain, where v6 accepted them. Add a final rule if routes should still pass.", { chain }) });
      stats.review++;
      routing.push({ menu: "/routing filter rule", line: `# REVIEW: v6 accepted routes that matched no rule in chain ${chain}; v7 rejects them. To keep the v6 behaviour, add a last rule such as:\n# add chain=${q(chain)} rule="if (dst in 0.0.0.0/0) { accept }"` });
    }
  }

  // ------------------------------------------------ render
  const lines = [
    `# RouterOS v7 configuration converted from ${info.version ? "RouterOS " + info.version : "a RouterOS v6 export"} by the Tanod Tools migration helper.`,
    "# Converted lines are preceded by the original as \"# v6: ...\". Read every \"# REVIEW\" line before applying.",
    "# The usual upgrade path is an in-place upgrade, which converts the configuration itself; use this to review",
    "# what changes, or to rebuild a v6 configuration on a new v7 router.",
  ];
  if (info.model) lines.push(`# Source model: ${info.model}`);
  if (tables.size) {
    lines.push("", "# v7 needs a routing table (with fib) for every routing mark used by routes, rules and mangle.", "/routing table");
    for (const t of tables.keys()) lines.push(`add name=${q(t)} fib`);
    stats.converted++;
  }
  let cur = null;
  const order = ["/routing filter rule", "/routing ospf instance", "/routing ospf area", "/routing ospf interface-template", "/ip firewall address-list", "/routing bgp connection", "/routing ospf"];
  const sortedRouting = [...routing].sort((x, y) => order.indexOf(x.menu) - order.indexOf(y.menu));
  for (const { menu, line } of [...body, ...(sortedRouting.length ? [{ menu: null, line: "" }, { menu: null, line: "# ---- routing protocols, converted to the v7 model" }] : []), ...sortedRouting]) {
    if (menu && menu !== cur) { lines.push(menu); cur = menu; }
    lines.push(line);
  }
  review.sort((x, y) => x.line - y.line);
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", review, stats, info };
}
