import { $, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, radio, tx } from "./rosui.js?v=11";
import { Script, LOCKOUT, q, checkName, checkIp4, checkCidrs, InputError } from "./roscore.js?v=11";

const root = $("#lb");
const well = scriptWell({ out: $("#lb-out"), copy: $("#lb-copy"), download: $("#lb-dl"), name: "mikrotik-load-balancing.rsc" });

const wans = rowEditor({
  list: $("#lb-wans"), add: $("#lb-add"), min: 2, max: 8, onChange: () => build(),
  label: (r) => rowInputs(r).name.value,
  makeRow: (v) => [
    cell(tx("Name"), "text", { key: "name", value: v.name ?? "", placeholder: "isp1" }),
    cell(tx("Interface"), "text", { key: "iface", value: v.iface ?? "", placeholder: "ether1" }),
    cell(tx("Gateway (IP, or the interface for PPPoE)"), "text", { key: "gw", value: v.gw ?? "", placeholder: "203.0.113.1" }),
    cell(tx("Check host"), "text", { key: "mon", value: v.mon ?? "", placeholder: "1.1.1.1" }),
    cell(tx("Weight"), "text", { key: "weight", value: v.weight ?? "1", inputmode: "numeric" }),
  ],
});
wans.addRow({ name: "isp1", iface: "ether1", gw: "203.0.113.1", mon: "1.1.1.1", weight: "1" });
wans.addRow({ name: "isp2", iface: "pppoe-out1", gw: "pppoe-out1", mon: "9.9.9.9", weight: "1" });

function sync() {
  const pcc = radio("lb-mode", root) === "pcc";
  $("#lb-pcc-f").hidden = !pcc;
  for (const r of wans.rows()) rowInputs(r).weight.closest(".ros-cell").hidden = !pcc;
}

function build() {
  sync();
  const c = new Checker(root);
  const pcc = radio("lb-mode", root) === "pcc";
  const lanList = pcc ? c.get($("#lb-lan"), (v) => checkName(v)) : null;
  const locals = pcc ? c.get($("#lb-local"), (v) => checkCidrs(v, { version: 4 }), []) : [];
  const classifier = $("#lb-class").value;
  const list = [];
  const seen = { name: new Set(), iface: new Set(), mon: new Set() };
  for (const r of wans.rows()) {
    const i = rowInputs(r);
    const name = c.get(i.name, (v) => {
      const n = checkName(v, { max: 24 });
      if (!/^[A-Za-z0-9_-]+$/.test(n)) throw new InputError(tx("Use letters, digits, - and _ only; the name becomes part of routing table names."));
      return n;
    });
    const iface = c.get(i.iface, (v) => checkName(v));
    const gw = c.get(i.gw, (v) => (/^[\d.]+$/.test(v.trim()) ? checkIp4(v).text : checkName(v)));
    const mon = c.get(i.mon, (v) => checkIp4(v));
    const weight = pcc ? c.get(i.weight, (v) => {
      const n = Number(String(v).trim());
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new InputError(tx("Use a whole number from 1 to 10."));
      return n;
    }) : 1;
    for (const [k, v, input] of [["name", name, i.name], ["iface", iface, i.iface], ["mon", mon && mon.text, i.mon]]) {
      if (v && seen[k].has(v)) c.fail(input, tx("Each WAN needs its own value here."));
      if (v) seen[k].add(v);
    }
    if (mon && /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(mon.text)) c.fail(i.mon, tx("Use a public address that answers ping, such as 1.1.1.1 or 9.9.9.9."));
    list.push({ name, iface, gw, mon, weight });
  }
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  const s = new Script().header(pcc ? "PCC load balancing with recursive failover" : "Dual-WAN failover with recursive routes");
  s.note(LOCKOUT);
  s.note("Turn off add-default-route on the DHCP and PPPoE clients of these WANs (or give their default routes a higher distance), or they compete with the routes below.");
  if (pcc) {
    s.section("/routing table", "RouterOS v7 needs a routing table (with fib) for every routing mark.");
    for (const w of list) s.cmd("add", [["name", `to-${w.name}`], ["fib", true]]);
    s.section("/ip firewall address-list", "Local networks: traffic to them is never balanced.");
    for (const n of locals) s.raw(`:if ([:len [/ip firewall address-list find list="pcc-local" address=${n.text}]] = 0) do={ /ip firewall address-list add list=pcc-local address=${n.text} }`);
    s.section("/ip firewall mangle", "1) leave local traffic alone, 2) connections that came in on a WAN answer through the same WAN,",
      "3) split new LAN connections between the WANs, 4) route each marked connection through its WAN.");
    s.cmd("add", [["chain", "prerouting"], ["action", "accept"], ["dst-address-list", "pcc-local"], ["comment", "PCC: local traffic"]]);
    for (const w of list) {
      s.cmd("add", [["chain", "prerouting"], ["action", "mark-connection"], ["new-connection-mark", `${w.name}-conn`], ["connection-mark", "no-mark"],
        ["in-interface", w.iface], ["passthrough", "yes"], ["comment", `PCC: inbound on ${w.name}`]]);
    }
    const total = list.reduce((n, w) => n + w.weight, 0);
    let k = 0;
    for (const w of list) {
      for (let j = 0; j < w.weight; j++, k++) {
        s.cmd("add", [["chain", "prerouting"], ["action", "mark-connection"], ["new-connection-mark", `${w.name}-conn`], ["connection-mark", "no-mark"],
          ["in-interface-list", lanList], ["dst-address-type", "!local"], ["per-connection-classifier", `${classifier}:${total}/${k}`], ["passthrough", "yes"], ["comment", `PCC: share ${k + 1}/${total} to ${w.name}`]]);
      }
    }
    for (const w of list) {
      s.cmd("add", [["chain", "prerouting"], ["action", "mark-routing"], ["new-routing-mark", `to-${w.name}`], ["connection-mark", `${w.name}-conn`],
        ["in-interface-list", lanList], ["passthrough", "no"], ["comment", `PCC: route ${w.name} connections`]]);
      s.cmd("add", [["chain", "output"], ["action", "mark-routing"], ["new-routing-mark", `to-${w.name}`], ["connection-mark", `${w.name}-conn`],
        ["passthrough", "no"], ["comment", `PCC: router replies via ${w.name}`]]);
    }
  }
  s.section("/ip route", "Check hosts: each one is reachable only through its own WAN. If that path dies, the host stops answering",
    "and the recursive routes through it are switched off (check-gateway=ping).");
  for (const w of list) s.cmd("add", [["dst-address", `${w.mon.text}/32`], ["gateway", w.gw], ["scope", "10"], ["comment", `check host for ${w.name}`]]);
  const order = (first) => [first, ...list.filter((x) => x !== first)];
  if (pcc) {
    s.blank().note("Per-WAN tables: each WAN first, the others as backup.");
    for (const w of list) {
      order(w).forEach((x, d) => s.cmd("add", [["dst-address", "0.0.0.0/0"], ["gateway", x.mon.text], ["routing-table", `to-${w.name}`], ["target-scope", "11"],
        ["check-gateway", "ping"], ["distance", String(d + 1)], ["comment", `to-${w.name}: via ${x.name}`]]));
    }
  }
  s.blank().note("Main table: the router's own traffic and anything unmarked, in order of preference.");
  list.forEach((x, d) => s.cmd("add", [["dst-address", "0.0.0.0/0"], ["gateway", x.mon.text], ["target-scope", "11"], ["check-gateway", "ping"],
    ["distance", String(d + 1)], ["comment", `default via ${x.name}`]]));
  s.section("/ip firewall filter", "Never let a check host's pings leave through another WAN; otherwise a dead link could look alive.");
  for (const w of list) s.cmd("add", [["chain", "output"], ["action", "drop"], ["dst-address", w.mon.text], ["protocol", "icmp"], ["out-interface", `!${w.iface}`], ["comment", `check host ${w.name} only via ${w.iface}`]]);
  if ($("#lb-fast").checked) {
    s.blank().note(pcc ? "FastTrack skips mangle, so fasttracked packets would ignore the routing marks. Disable it." : "Optional for failover; FastTrack is fine without PCC.");
    if (pcc) s.raw("disable [ find action=fasttrack-connection ]");
  }
  if ($("#lb-nat").checked) {
    s.section("/ip firewall nat", "Masquerade on every WAN.");
    for (const w of list) s.cmd("add", [["chain", "srcnat"], ["action", "masquerade"], ["out-interface", w.iface], ["comment", `masquerade ${w.name}`]]);
  }

  if (pcc && !$("#lb-fast").checked) notes.push({ level: "warn", text: tx("FastTrack is still on: fasttracked packets skip the routing marks and may leave through the wrong WAN.") });
  notes.push({ level: "info", text: tx("Each check host is reachable only through its own WAN (the output drop rules enforce it). Pick hosts you don't need otherwise, and that reliably answer ping.") });
  if (pcc) notes.push({ level: "info", text: classifier === "both-addresses-and-ports"
    ? tx("both-addresses-and-ports spreads load best, but one client's connections to the same site can leave through different WANs, which breaks sites that tie a login to the IP address.")
    : tx("both-addresses keeps every connection between one client and one server on the same WAN, which keeps logins and banking sessions working.") });
  if (list.some((w) => !/^[\d.]+$/.test(w.gw))) notes.push({ level: "info", text: tx("A gateway given as an interface name only works for point-to-point links such as PPPoE or LTE. A DHCP WAN needs its gateway IP, and that changes if the ISP changes it.") });
  well.set(s.toString());
  showNotes($("#lb-notes"), notes);
  return 0;
}

live(root, build, 200);
