import { $, $$, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, tx } from "./rosui.js?v=11";
import { Script, checkName, checkIp4, checkCidr, parseRate, fmtRate, fmtV4, InputError } from "./roscore.js?v=11";

const root = $("#pp");
const well = scriptWell({ out: $("#pp-out"), copy: $("#pp-copy"), download: $("#pp-dl"), name: "mikrotik-pppoe-server.rsc" });

const profiles = rowEditor({
  list: $("#pp-profiles"), add: $("#pp-add"), min: 1, max: 32, onChange: () => build(),
  label: (r) => rowInputs(r).name.value,
  makeRow: (v) => [
    cell(tx("Profile name"), "text", { key: "name", value: v.name ?? "", placeholder: "plan-20M" }),
    cell(tx("Upload"), "text", { key: "up", value: v.up ?? "", placeholder: "5M" }),
    cell(tx("Download"), "text", { key: "down", value: v.down ?? "", placeholder: "20M" }),
  ],
});
profiles.addRow({ name: "plan-10M", up: "3M", down: "10M" });
profiles.addRow({ name: "plan-25M", up: "8M", down: "25M" });

function sync() {
  $("#pp-radius-f").hidden = !$("#pp-radius").checked;
}

function build() {
  sync();
  const c = new Checker(root);
  const iface = c.get($("#pp-if"), (v) => checkName(v));
  const service = c.get($("#pp-svc"), (v) => checkName(v));
  const net = c.get($("#pp-net"), (v) => checkCidr(v, { version: 4, requirePrefix: true }));
  if (net && (net.prefix > 29 || net.prefix < 16)) c.fail($("#pp-net"), tx("Use a pool network between /16 and /29."));
  const dns = c.get($("#pp-dns"), (v) => String(v).split(/[,\s]+/).filter(Boolean).map((x) => checkIp4(x).text), []);
  if (!dns.length) c.fail($("#pp-dns"), tx("Enter at least one DNS server for the customers."));
  const count = c.get($("#pp-count"), (v) => {
    const n = Number(String(v).trim() || 0);
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new InputError(tx("Enter a number from 0 to 500."));
    return n;
  }, 0);
  const pattern = c.get($("#pp-user"), (v) => {
    const p = String(v).trim();
    if (!p.includes("{n}")) throw new InputError(tx("Include {n} where the number goes, such as customer{n}."));
    checkName(p.replace("{n}", "1"));
    return p;
  });
  const auth = $$('input[name="pp-auth"]:checked', root).map((i) => i.value);
  if (!auth.length) c.fail($$('input[name="pp-auth"]', root)[0], tx("Choose at least one authentication method."));
  let radius = null;
  if ($("#pp-radius").checked) radius = c.get($("#pp-rad-ip"), (v) => checkIp4(v));
  const plans = [];
  const names = new Set();
  for (const r of profiles.rows()) {
    const i = rowInputs(r);
    const name = c.get(i.name, (v) => checkName(v));
    if (name && names.has(name)) c.fail(i.name, tx("Profile names must be unique."));
    if (name) names.add(name);
    plans.push({ name, up: c.get(i.up, (v) => parseRate(v)), down: c.get(i.down, (v) => parseRate(v)) });
  }
  if (!c.ok) return well.blocked(c.count);

  const local = fmtV4(net.network + 1n);
  const range = `${fmtV4(net.network + 2n)}-${fmtV4(net.last - 1n)}`;
  const notes = [];
  const s = new Script().header("PPPoE server");
  s.note("Passwords below are placeholders. Replace every CHANGE_ME value before customers connect.");
  s.section("/ip pool", `Customer addresses. The router keeps ${local} as its side of every PPPoE link.`);
  s.cmd("add", [["name", "pppoe-pool"], ["ranges", range]]);
  s.section("/ppp profile", "One profile per plan. rate-limit is rx/tx from the router's side, which is upload/download for the customer;",
    "RouterOS creates a dynamic simple queue from it for every session.");
  for (const p of plans) {
    s.cmd("add", [["name", p.name], ["local-address", local], ["remote-address", "pppoe-pool"], ["dns-server", dns.join(",")],
      ["rate-limit", `${fmtRate(p.up)}/${fmtRate(p.down)}`], ["only-one", $("#pp-one").checked ? "yes" : ""], ["change-tcp-mss", "yes"]]);
  }
  s.section("/interface pppoe-server server", "The PPPoE access concentrator on the customer-facing interface.");
  s.cmd("add", [["service-name", service], ["interface", iface], ["default-profile", plans[0].name], ["authentication", auth.join(",")],
    ["one-session-per-host", "yes"], ["max-mtu", "1480"], ["max-mru", "1480"], ["keepalive-timeout", "10"], ["disabled", "no"]]);
  if (count) {
    s.section("/ppp secret", `${count} customer accounts on ${plans[0].name}. Placeholder passwords: change them, or manage accounts in RADIUS.`);
    const width = Math.max(3, String(count).length);
    for (let n = 1; n <= count; n++) {
      const num = String(n).padStart(width, "0");
      s.cmd("add", [["name", pattern.replace("{n}", num)], ["password", `CHANGE_ME_${num}`], ["service", "pppoe"], ["profile", plans[0].name]]);
    }
    notes.push({ level: "warn", text: tx("The secrets use placeholder passwords (CHANGE_ME_001 and so on). Replace them before use: anyone who reads this script could log in otherwise.") });
  }
  if (radius) {
    s.section("/radius", "Authenticate and account PPP sessions against a RADIUS server. Set the shared secret to the one on the server.");
    s.cmd("add", [["service", "ppp"], ["address", radius.text], ["secret", "CHANGE_ME"], ["comment", "PPPoE RADIUS"]]);
    s.raw("/ppp aaa").cmd("set", [["use-radius", "yes"], ["accounting", "yes"], ["interim-update", "5m"]]);
    if ($("#pp-coa").checked) s.raw("/radius incoming").cmd("set", [["accept", "yes"]]);
    notes.push({ level: "info", text: tx("With RADIUS, the server can send the plan as the Mikrotik-Rate-Limit attribute, which overrides the profile's rate-limit.") });
  }
  if ($("#pp-nat").checked) {
    s.section("/ip firewall nat", "Masquerade customers to the internet (skip if they get public addresses).");
    s.cmd("add", [["chain", "srcnat"], ["action", "masquerade"], ["src-address", net.text], ["out-interface-list", "WAN"], ["comment", "PPPoE customers"]]);
    notes.push({ level: "info", text: tx("The NAT rule uses the interface list WAN. Create it, or change out-interface-list to your uplink.") });
  }
  if (auth.includes("pap")) notes.push({ level: "warn", text: tx("PAP sends passwords unencrypted across the access network. Keep it only for CPEs that support nothing else.") });
  notes.push({ level: "info", text: tx("Don't put an IP address or a DHCP server on {iface} for customers; PPPoE runs at layer 2 and sessions get addresses from the pool.", { iface }) });
  notes.push({ level: "warn", text: tx("FastTracked traffic skips the dynamic queues the profiles create. Turn off FastTrack for customer traffic, or the speed plans won't apply.") });
  well.set(s.toString());
  showNotes($("#pp-notes"), notes);
  return 0;
}

live(root, build, 200);
