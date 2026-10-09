import { $, live, Checker, showNotes, scriptWell, rowEditor, cell, rowInputs, tx } from "./rosui.js?v=11";
import { Script, LOCKOUT, q, checkName, checkCidr, fmtV4, InputError } from "./roscore.js?v=11";

const root = $("#vl");
const well = scriptWell({ out: $("#vl-out"), copy: $("#vl-copy"), download: $("#vl-dl"), name: "mikrotik-vlans.rsc" });

const vlans = rowEditor({
  list: $("#vl-vlans"), add: $("#vl-vadd"), min: 1, max: 64, onChange: () => build(),
  label: (r) => rowInputs(r).id.value,
  makeRow: (v) => [
    cell(tx("VLAN ID"), "text", { key: "id", value: v.id ?? "", placeholder: "10", inputmode: "numeric" }),
    cell(tx("Name"), "text", { key: "name", value: v.name ?? "", placeholder: "staff" }),
    cell(tx("Router address (optional)"), "text", { key: "addr", value: v.addr ?? "", placeholder: "10.10.10.1/24" }),
  ],
});
const ports = rowEditor({
  list: $("#vl-ports"), add: $("#vl-padd"), min: 1, max: 64, onChange: () => build(),
  label: (r) => rowInputs(r).iface.value,
  makeRow: (v) => [
    cell(tx("Port"), "text", { key: "iface", value: v.iface ?? "", placeholder: "ether2" }),
    cell(tx("Mode"), "select", { key: "mode", value: v.mode || "access", options: [["access", tx("Access (untagged)")], ["trunk", tx("Trunk (tagged)")], ["hybrid", tx("Hybrid")]] }),
    cell(tx("Untagged VLAN (PVID)"), "text", { key: "pvid", value: v.pvid ?? "", placeholder: "10", inputmode: "numeric" }),
    cell(tx("Tagged VLANs"), "text", { key: "tagged", value: v.tagged ?? "", placeholder: tx("10,20 or all") }),
  ],
});
vlans.addRow({ id: "10", name: "staff", addr: "10.10.10.1/24" });
vlans.addRow({ id: "20", name: "guests", addr: "10.10.20.1/24" });
vlans.addRow({ id: "99", name: "mgmt", addr: "10.10.99.1/24" });
ports.addRow({ iface: "ether1", mode: "trunk", tagged: "all" });
ports.addRow({ iface: "ether2", mode: "access", pvid: "10" });
ports.addRow({ iface: "ether3", mode: "access", pvid: "20" });
ports.addRow({ iface: "ether4", mode: "hybrid", pvid: "10", tagged: "99" });

function vlanId(v) {
  const s = String(v).trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 4094) throw new InputError(tx("A VLAN ID is a number from 1 to 4094."));
  return Number(s);
}

/* Show only the cells that apply to each port's mode. */
function syncRows() {
  for (const r of ports.rows()) {
    const i = rowInputs(r);
    i.pvid.closest(".ros-cell").hidden = i.mode.value === "trunk";
    i.tagged.closest(".ros-cell").hidden = i.mode.value === "access";
  }
}

function build() {
  syncRows();
  const c = new Checker(root);
  const bridge = c.get($("#vl-bridge"), (v) => checkName(v));
  const defs = [];
  const ids = new Set();
  for (const r of vlans.rows()) {
    const i = rowInputs(r);
    const id = c.get(i.id, vlanId);
    if (id && ids.has(id)) c.fail(i.id, tx("VLAN {id} is listed twice.", { id }));
    if (id) ids.add(id);
    const name = c.get(i.name, (v) => checkName(v, { optional: true, max: 40 }), "");
    const addr = c.get(i.addr, (v) => {
      const a = checkCidr(v, { version: 4, requirePrefix: true, optional: true });
      if (a && !a.hostBits && a.prefix < 31) throw new InputError(tx("Enter the router's own address in the VLAN, such as {ex}, not the network address.", { ex: `${fmtV4(a.network + 1n)}/${a.prefix}` }));
      return a;
    });
    defs.push({ id, name, addr, iface: id ? (name ? `vlan${id}-${name.replace(/\s+/g, "-")}` : `vlan${id}`) : "" });
  }
  const members = [];
  const seenPorts = new Set();
  for (const r of ports.rows()) {
    const i = rowInputs(r);
    const iface = c.get(i.iface, (v) => checkName(v));
    if (iface && iface === bridge) c.fail(i.iface, tx("The bridge itself is added to VLANs automatically; list physical ports here."));
    if (iface && seenPorts.has(iface)) c.fail(i.iface, tx("{name} is listed twice.", { name: iface }));
    if (iface) seenPorts.add(iface);
    const mode = i.mode.value;
    let pvid = null, tagged = [];
    if (mode !== "trunk") {
      pvid = c.get(i.pvid, vlanId);
      if (pvid && !ids.has(pvid)) c.fail(i.pvid, tx("VLAN {id} isn't in the VLAN list above.", { id: pvid }));
    }
    if (mode !== "access") {
      tagged = c.get(i.tagged, (v) => {
        const t = String(v).trim().toLowerCase();
        if (t === "all") return [...ids];
        const list = t.split(/[,\s]+/).filter(Boolean).map(vlanId);
        if (!list.length) throw new InputError(tx("List the VLAN IDs this port carries tagged, or write all."));
        for (const id of list) if (!ids.has(id)) throw new InputError(tx("VLAN {id} isn't in the VLAN list above.", { id }));
        return list;
      }, []);
      if (pvid && tagged.includes(pvid)) c.fail(i.tagged, tx("VLAN {id} is already this port's untagged VLAN; a port can't carry it tagged as well.", { id: pvid }));
    }
    members.push({ iface, mode, pvid, tagged: tagged.filter((x) => x !== pvid) });
  }
  if (!c.ok) return well.blocked(c.count);

  const exists = $("#vl-exists").checked;
  const notes = [];
  const s = new Script().header("Bridge VLAN filtering");
  s.note(LOCKOUT, "VLAN filtering is switched on in the LAST step, after every port and VLAN is in place. If you manage the router over this bridge, connect through a port that will still reach a router address afterwards.");
  s.section("/interface bridge", exists ? "The bridge already exists; VLAN filtering stays off until the end." : "One bridge for all VLANs; VLAN filtering stays off until the end.");
  if (exists) s.cmd("set", [["vlan-filtering", "no"]], { pos: [bridge] });
  else s.cmd("add", [["name", bridge], ["vlan-filtering", "no"], ["comment", "VLAN-aware bridge"]]);

  s.section("/interface bridge port", "Access ports accept untagged frames into their PVID; trunk ports accept only tagged frames; hybrid ports take both.",
    "ingress-filtering drops frames for VLANs a port isn't a member of.");
  for (const m of members) {
    const frame = m.mode === "access" ? "admit-only-untagged-and-priority-tagged" : m.mode === "trunk" ? "admit-only-vlan-tagged" : "admit-all";
    const args = [["pvid", m.pvid ? String(m.pvid) : ""], ["frame-types", frame], ["ingress-filtering", "yes"]];
    const comment = m.mode === "access" ? `access VLAN ${m.pvid}` : m.mode === "trunk" ? "trunk" : `hybrid: untagged ${m.pvid}, tagged ${m.tagged.join(",")}`;
    if ($("#vl-inbridge").checked) s.cmd("set", [...args, ["comment", comment]], { find: `interface=${q(m.iface)}` });
    else s.cmd("add", [["bridge", bridge], ["interface", m.iface], ...args, ["comment", comment]]);
  }

  s.section("/interface bridge vlan", "VLAN membership. The bridge itself is tagged in every VLAN that has a router address.");
  for (const d of defs) {
    const tagged = members.filter((m) => m.tagged.includes(d.id)).map((m) => m.iface);
    if (d.addr) tagged.unshift(bridge);
    const untagged = members.filter((m) => m.pvid === d.id).map((m) => m.iface);
    if (!tagged.length && !untagged.length) notes.push({ level: "info", text: tx("VLAN {id} has no ports.", { id: d.id }) });
    s.cmd("add", [["bridge", bridge], ["vlan-ids", String(d.id)], ["tagged", tagged.join(",")], ["untagged", untagged.join(",")], ["comment", d.name]]);
  }

  const l3 = defs.filter((d) => d.addr);
  if (l3.length) {
    s.section("/interface vlan", "Router interfaces in each VLAN that has an address.");
    for (const d of l3) s.cmd("add", [["interface", bridge], ["name", d.iface], ["vlan-id", String(d.id)]]);
    s.section("/ip address");
    for (const d of l3) s.cmd("add", [["address", d.addr.hostText], ["interface", d.iface], ["comment", d.name || `VLAN ${d.id}`]]);
  }
  if ($("#vl-tagonly").checked) {
    s.section("/interface bridge", "The router itself only accepts tagged frames from the bridge: untagged management on the bridge stops working.");
    s.cmd("set", [["frame-types", "admit-only-vlan-tagged"], ["ingress-filtering", "yes"]], { pos: [bridge] });
    notes.push({ level: "warn", text: tx("With the bridge set to tagged frames only, any IP address on the bridge itself stops answering. Manage the router through a VLAN interface.") });
  }
  s.section("/interface bridge", "LAST STEP: turn VLAN filtering on. Keep Safe Mode on until you have reconnected.");
  s.cmd("set", [["vlan-filtering", "yes"]], { pos: [bridge] });

  const mgmt = l3.length ? l3.map((d) => `VLAN ${d.id} (${d.addr.hostText})`).join(", ") : "";
  notes.unshift({ level: "warn", text: mgmt
    ? tx("After VLAN filtering is on, the router answers on {list}. Your computer must be on one of those VLANs, through an access port or a tagged trunk, or you lose access.", { list: mgmt })
    : tx("No VLAN has a router address, so the router can only be managed through an address on the bridge itself (untagged, PVID 1) or another interface. Make sure one stays reachable.") });
  if (members.some((m) => m.pvid === 1) || ids.has(1)) notes.push({ level: "info", text: tx("VLAN 1 is the bridge's default PVID. Using it for real traffic works but is easy to confuse with untagged traffic; a separate ID is clearer.") });
  if ($("#vl-inbridge").checked) notes.push({ level: "info", text: tx("The port lines use set [ find interface=… ], so each port must already be in {bridge}.", { bridge }) });
  else notes.push({ level: "info", text: tx("If a port is already in a bridge (the default configuration puts ether2 to ether5 in \"bridge\"), adding it fails. Tick \"Ports are already in the bridge\" or remove them first.") });
  notes.push({ level: "info", text: tx("Many MikroTik switches offload bridge VLAN filtering to the switch chip only on some models and RouterOS versions. Check the H flag in /interface bridge port print; without it, VLAN filtering runs on the CPU.") });
  well.set(s.toString());
  showNotes($("#vl-notes"), notes);
  return 0;
}

live(root, build, 200);
