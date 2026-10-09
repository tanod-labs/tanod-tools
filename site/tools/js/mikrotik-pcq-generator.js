import { $, live, Checker, showNotes, scriptWell, radio, tx } from "./rosui.js?v=11";
import { Script, checkName, checkCidrs, parseRate, fmtRate, humanRate, InputError } from "./roscore.js?v=11";

const root = $("#pcq");
const well = scriptWell({ out: $("#pcq-out"), copy: $("#pcq-copy"), download: $("#pcq-dl"), name: "mikrotik-pcq.rsc" });

function mask(v) {
  const s = String(v).trim().replace(/^\//, "");
  if (!/^\d+$/.test(s) || Number(s) < 8 || Number(s) > 32) throw new InputError(tx("Use a prefix length from 8 to 32; 32 shapes each address on its own."));
  return Number(s);
}

function sync() {
  const m = radio("pcq-method", root);
  $("#pcq-simple-f").hidden = m !== "simple";
  $("#pcq-tree-f").hidden = m !== "tree";
}

function build() {
  sync();
  const c = new Checker(root);
  const method = radio("pcq-method", root);
  const downRate = c.get($("#pcq-down-rate"), (v) => parseRate(v, { optional: true, allowZero: true }));
  const upRate = c.get($("#pcq-up-rate"), (v) => parseRate(v, { optional: true, allowZero: true }));
  const downMax = c.get($("#pcq-down-max"), (v) => parseRate(v, { optional: method === "simple" }));
  const upMax = c.get($("#pcq-up-max"), (v) => parseRate(v, { optional: method === "simple" }));
  const m = c.get($("#pcq-mask"), mask);
  const prefix = c.get($("#pcq-name"), (v) => checkName(v), "pcq");
  let targets, wan, lan;
  if (method === "simple") targets = c.get($("#pcq-target"), (v) => checkCidrs(v, { version: 4, requirePrefix: true }), []);
  else {
    wan = c.get($("#pcq-wan"), (v) => checkName(v));
    lan = c.get($("#pcq-lan"), (v) => checkName(v));
    if (wan && wan === lan) c.fail($("#pcq-lan"), tx("The LAN and WAN lists must differ."));
  }
  if ((downMax && !upMax) || (!downMax && upMax)) c.fail(downMax ? $("#pcq-up-max") : $("#pcq-down-max"), tx("Set both totals, or leave both empty."));
  if (!c.ok) return well.blocked(c.count);

  const notes = [];
  const tDown = `${prefix}-download`, tUp = `${prefix}-upload`;
  const s = new Script().header(method === "simple" ? "PCQ: equal sharing per client with one simple queue" : "PCQ: equal sharing per client with a queue tree");
  s.note("FastTracked connections bypass simple queues, queue trees and mangle. Disable FastTrack (/ip firewall filter disable [find action=fasttrack-connection]) or this shaping won't apply.");
  s.section("/queue type", "Download is classified by destination address (the client), upload by source address.",
    m === 32 ? "Each client address gets its own sub-queue." : `Each /${m} block of addresses shares one sub-queue.`);
  s.cmd("add", [["name", tDown], ["kind", "pcq"], ["pcq-classifier", "dst-address"], ["pcq-rate", downRate ? fmtRate(downRate) : "0"], ["pcq-dst-address-mask", m === 32 ? "" : String(m)]]);
  s.cmd("add", [["name", tUp], ["kind", "pcq"], ["pcq-classifier", "src-address"], ["pcq-rate", upRate ? fmtRate(upRate) : "0"], ["pcq-src-address-mask", m === 32 ? "" : String(m)]]);
  if (method === "simple") {
    s.section("/queue simple", "One queue for the whole LAN; PCQ splits it per client. queue=upload-type/download-type.");
    s.cmd("add", [["name", `${prefix}-lan`], ["target", targets.map((t) => t.text).join(",")], ["queue", `${tUp}/${tDown}`],
      ["max-limit", downMax ? `${fmtRate(upMax)}/${fmtRate(downMax)}` : ""], ["comment", "PCQ per-client shaping"]]);
    if (!downMax) notes.push({ level: "warn", text: tx("Without a total max-limit, the queue never fills, so PCQ only enforces the per-client rate and shares nothing. Set the totals to just under your real link speed.") });
  } else {
    s.section("/ip firewall mangle", "Mark connections from LAN to WAN, then mark their packets by direction.",
      "In the forward chain replies are already de-NATed, so PCQ sees the clients' own addresses.");
    s.cmd("add", [["chain", "forward"], ["action", "mark-connection"], ["new-connection-mark", `${prefix}-conn`], ["connection-mark", "no-mark"],
      ["in-interface-list", lan], ["out-interface-list", wan], ["passthrough", "yes"], ["comment", "PCQ: mark LAN-to-WAN connections"]]);
    s.cmd("add", [["chain", "forward"], ["action", "mark-packet"], ["new-packet-mark", `${prefix}-up`], ["connection-mark", `${prefix}-conn`],
      ["in-interface-list", lan], ["passthrough", "no"], ["comment", "PCQ: upload packets"]]);
    s.cmd("add", [["chain", "forward"], ["action", "mark-packet"], ["new-packet-mark", `${prefix}-down`], ["connection-mark", `${prefix}-conn`],
      ["in-interface-list", wan], ["passthrough", "no"], ["comment", "PCQ: download packets"]]);
    s.section("/queue tree", "parent=global shapes before source NAT, while upload packets still carry private addresses.");
    s.cmd("add", [["name", `${prefix}-download`], ["parent", "global"], ["packet-mark", `${prefix}-down`], ["queue", tDown], ["max-limit", fmtRate(downMax)]]);
    s.cmd("add", [["name", `${prefix}-upload`], ["parent", "global"], ["packet-mark", `${prefix}-up`], ["queue", tUp], ["max-limit", fmtRate(upMax)]]);
    notes.push({ level: "info", text: tx("Connections opened from the internet (port forwards) aren't marked, so they aren't shaped.") });
  }
  if (downMax) {
    const each = downRate || 0;
    notes.push({ level: "info", text: each ? tx("Each client is capped at {rate} download; the {total} total is shared equally among active clients, so at most {n} clients get the full rate at once.", { rate: humanRate(each), total: humanRate(downMax), n: Math.max(1, Math.floor(downMax / each)) })
      : tx("With pcq-rate 0, the {total} download total is divided equally among the clients active at that moment: 10 active clients get about {share} each.", { total: humanRate(downMax), share: humanRate(downMax / 10) }) });
  }
  well.set(s.toString());
  showNotes($("#pcq-notes"), notes);
  return 0;
}

live(root, build);
