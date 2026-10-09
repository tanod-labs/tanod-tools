import { $, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, radio, tx } from "./rosui.js?v=11";
import { Script, LOCKOUT, q, checkName, checkIp4, checkCidrs, parsePorts, inNet, InputError } from "./roscore.js?v=11";

const root = $("#pf");
const well = scriptWell({ out: $("#pf-out"), copy: $("#pf-copy"), download: $("#pf-dl"), name: "mikrotik-port-forwarding.rsc" });

const rows = rowEditor({
  list: $("#pf-rows"), add: $("#pf-add"), min: 1, max: 64, onChange: () => build(),
  label: (r) => rowInputs(r).name.value,
  makeRow: (v) => [
    cell(tx("Name"), "text", { key: "name", value: v.name ?? "", placeholder: "web" }),
    cell(tx("Protocol"), "select", { key: "proto", value: v.proto || "tcp", options: [["tcp", "TCP"], ["udp", "UDP"], ["both", "TCP + UDP"]] }),
    cell(tx("Public port"), "text", { key: "ext", value: v.ext ?? "", placeholder: "443", inputmode: "numeric" }),
    cell(tx("Internal IP"), "text", { key: "ip", value: v.ip ?? "", placeholder: "192.168.88.10" }),
    cell(tx("Internal port"), "text", { key: "int", value: v.int ?? "", placeholder: tx("same"), inputmode: "numeric" }),
  ],
});
rows.addRow({ name: "https-server", proto: "tcp", ext: "443", ip: "192.168.88.10" });
rows.addRow({ name: "nvr", proto: "tcp", ext: "8443", ip: "192.168.88.20", int: "443" });

function syncMode() {
  const mode = radio("pf-mode", root);
  $("#pf-wan-f").hidden = !(mode === "list" || mode === "iface");
  $("#pf-wan-l").textContent = mode === "iface" ? tx("WAN interface") : tx("WAN interface list");
  $("#pf-ip-f").hidden = mode !== "ip";
  $("#pf-lan-f").hidden = !$("#pf-hair").checked;
}

function build() {
  syncMode();
  const c = new Checker(root);
  const mode = radio("pf-mode", root);
  const hair = $("#pf-hair").checked;
  const wan = mode === "list" || mode === "iface" ? c.get($("#pf-wan"), (v) => checkName(v)) : null;
  const pub = mode === "ip" ? c.get($("#pf-ip"), (v) => checkIp4(v)) : null;
  const lans = hair ? c.get($("#pf-lan"), (v) => checkCidrs(v, { version: 4 }), []) : [];
  const allowed = c.get($("#pf-src"), (v) => checkCidrs(v, { version: 4, optional: true }), []);
  if (hair && (mode === "list" || mode === "iface")) c.fail($("#pf-hair"), tx("Hairpin NAT needs the rule to match your public address. Choose \"Public IP\" or \"Any router address\" above."));

  const items = [];
  const seen = new Map();
  for (const r of rows.rows()) {
    const i = rowInputs(r);
    const name = c.get(i.name, (v) => checkName(v, { optional: true }), "");
    const ext = c.get(i.ext, (v) => parsePorts(v));
    const ip = c.get(i.ip, (v) => checkIp4(v));
    const int = c.get(i.int, (v) => parsePorts(v, { optional: true, single: true }));
    if (ext && int && (ext.ranges.length > 1 || ext.count > 1)) c.fail(i.int, tx("Leave the internal port empty when the public port is a list or range; the ports are forwarded unchanged."));
    const protos = i.proto.value === "both" ? ["tcp", "udp"] : [i.proto.value];
    if (ext) {
      for (const p of protos) {
        for (const [lo, hi] of ext.ranges) {
          for (const [key, other] of seen) {
            if (key.p === p && lo <= key.hi && hi >= key.lo) { c.fail(i.ext, tx("{proto} port {port} is already forwarded in row \"{row}\".", { proto: p.toUpperCase(), port: lo, row: other || "?" })); }
          }
          seen.set({ p, lo, hi }, name || ext.text);
        }
      }
    }
    items.push({ name, ext, ip, int, protos, row: r });
  }
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  const s = new Script().header("Port forwarding (destination NAT)");
  s.note(LOCKOUT);
  if (allowed.length) {
    s.section("/ip firewall address-list", "Sources allowed to use these port forwards.");
    const list = hair ? [...allowed, ...lans.filter((l) => !allowed.some((a) => a.text === l.text))] : allowed;
    for (const a of list) s.raw(`:if ([:len [/ip firewall address-list find list="pf-allowed" address=${a.text}]] = 0) do={ /ip firewall address-list add list=pf-allowed address=${a.text} comment="port forward sources" }`);
    if (hair) notes.push({ level: "info", text: tx("The LAN subnets were added to the allowed sources so hairpin NAT keeps working.") });
  }
  const match = mode === "list" ? [["in-interface-list", wan]] : mode === "iface" ? [["in-interface", wan]]
    : mode === "ip" ? [["dst-address", pub.text]] : [["dst-address-type", "local"]];
  s.section("/ip firewall nat", "Destination NAT: send the public port to the internal server.");
  for (const it of items) {
    const label = it.name || `${it.ip.text}:${(it.int || it.ext).text}`;
    for (const p of it.protos) {
      s.cmd("add", [["chain", "dstnat"], ["action", "dst-nat"], ...match, ["protocol", p], ["dst-port", it.ext.text],
        ...(allowed.length ? [["src-address-list", "pf-allowed"]] : []),
        ["to-addresses", it.ip.text], ["to-ports", it.int && it.int.text !== it.ext.text ? it.int.text : ""], ["comment", `port forward: ${label}`]]);
    }
  }
  if (hair) {
    s.blank().note("Hairpin NAT: LAN clients reaching the public address are masqueraded, so the server's replies come back through the router instead of going straight to the client.");
    for (const it of items) {
      const label = it.name || it.ip.text;
      for (const p of it.protos) {
        for (const l of lans) {
          s.cmd("add", [["chain", "srcnat"], ["action", "masquerade"], ["protocol", p], ["src-address", l.text], ["dst-address", it.ip.text],
            ["dst-port", (it.int || it.ext).text], ["comment", `hairpin: ${label}`]]);
        }
      }
      if (!lans.some((l) => inNet(l, it.ip.value))) notes.push({ level: "warn", text: tx("{ip} isn't inside the LAN subnets you entered, so hairpin NAT won't apply to it.", { ip: it.ip.text }) });
    }
  }
  if (mode === "local") notes.push({ level: "warn", text: tx("\"Any router address\" also catches these ports on the router's own addresses. Don't forward a port the router itself uses, such as 8291 for WinBox.") });
  if (mode === "ip") notes.push({ level: "info", text: tx("If your public IP changes, update the rules, or use \"Any router address\" instead.") });
  if (items.some((it) => it.ext && it.ext.ranges.some(([lo, hi]) => (lo <= 8291 && hi >= 8291) || (lo <= 22 && hi >= 22)))) {
    notes.push({ level: "warn", text: tx("Port 22 or 8291 is forwarded. If the router manages over that port, it will now reach the internal server instead.") });
  }
  notes.push({ level: "info", text: tx("A forward chain that drops new WAN connections \"not DSTNATed\" lets these through automatically. With a stricter forward chain, accept connection-nat-state=dstnat before the drop.") });
  well.set(s.toString());
  showNotes($("#pf-notes"), notes);
  return 0;
}

live(root, build);
