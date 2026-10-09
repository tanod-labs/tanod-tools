import { $, live, Checker, showNotes, scriptWell, radio, tx } from "./rosui.js?v=11";
import { txn, fmtNum } from "./core.js?v=11";
import { Script, checkName, checkCidr, parseRate, fmtRate, humanRate, parseTime, fmtTime, fmtV4, InputError } from "./roscore.js?v=11";
import { simulateBurst, burstProblems } from "./rosqueue.js?v=11";

const root = $("#sq");
const well = scriptWell({ out: $("#sq-out"), copy: $("#sq-copy"), download: $("#sq-dl"), name: "mikrotik-simple-queues.rsc" });
const MAX_QUEUES = 2048;

/* "192.168.88.10 alice" lines -> [{target, name}] */
function parseTargets(text) {
  const out = [];
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    const body = line.replace(/#.*$/, "").trim();
    if (!body) return;
    const [addr, ...rest] = body.split(/\s+/);
    let c;
    try { c = checkCidr(addr, { version: 4 }); } catch (e) {
      if (e instanceof InputError) throw new InputError(tx("Line {line}: {error}", { line: i + 1, error: e.message }));
      throw e;
    }
    const label = rest.join(" ");
    if (label) checkName(label);
    out.push({ target: c.text, name: label, c });
  });
  if (!out.length) throw new InputError(tx("Enter at least one address or network."));
  return out;
}

function sync() {
  const mode = radio("sq-mode", root);
  $("#sq-list-f").hidden = mode !== "list";
  $("#sq-net-f").hidden = mode !== "subnet";
  $("#sq-burst-f").hidden = !$("#sq-burst").checked;
  $("#sq-parent-f").hidden = !$("#sq-parent").checked;
}

function dirPair(c, k) {
  return [c.get($(`#sq-up-${k}`), (v) => parseRate(v, { optional: k !== "max" })), c.get($(`#sq-down-${k}`), (v) => parseRate(v, { optional: k !== "max" }))];
}

function build() {
  sync();
  const c = new Checker(root);
  const mode = radio("sq-mode", root);
  const prefix = c.get($("#sq-prefix"), (v) => checkName(v, { optional: true }), "");
  let targets = [];
  if (mode === "list") targets = c.get($("#sq-list"), parseTargets, []);
  else {
    const net = c.get($("#sq-net"), (v) => checkCidr(v, { version: 4, requirePrefix: true }));
    if (net) {
      if (net.prefix < 21) c.fail($("#sq-net"), tx("Use a /21 or smaller network (up to 2046 hosts) for one queue per host."));
      else if (net.prefix > 30) c.fail($("#sq-net"), tx("Use a /30 or larger network; for a single address choose the address list mode."));
      else {
        const skip = new Set(String($("#sq-skip").value).split(/[,\s]+/).filter(Boolean));
        for (let a = net.network + 1n; a < net.last; a++) {
          const ip = fmtV4(a);
          if (!skip.has(ip)) targets.push({ target: `${ip}/32`, name: "" });
        }
      }
    }
    for (const s of String($("#sq-skip").value).split(/[,\s]+/).filter(Boolean)) {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) { c.fail($("#sq-skip"), tx("List single addresses to skip, such as 192.168.88.1.")); break; }
    }
  }
  const [upMax, downMax] = dirPair(c, "max");
  const [upAt, downAt] = dirPair(c, "at");
  const burstOn = $("#sq-burst").checked;
  let upB, downB, upT, downT, time;
  if (burstOn) {
    [upB, downB] = dirPair(c, "burst");
    [upT, downT] = dirPair(c, "thr");
    time = c.get($("#sq-time"), (v) => parseTime(v));
    if (!c.ok) return well.blocked(c.count);
    if (!upB && !downB) c.fail($("#sq-up-burst"), tx("Enter a burst-limit for upload, download or both."));
  }
  const parentOn = $("#sq-parent").checked;
  let pName, pTarget, pUp, pDown;
  if (parentOn) {
    pName = c.get($("#sq-pname"), (v) => checkName(v));
    pTarget = c.get($("#sq-ptarget"), (v) => checkCidr(v, { version: 4, requirePrefix: true }));
    pUp = c.get($("#sq-pup"), (v) => parseRate(v));
    pDown = c.get($("#sq-pdown"), (v) => parseRate(v));
  }
  if (targets.length > MAX_QUEUES) c.fail(mode === "list" ? $("#sq-list") : $("#sq-net"), tx("That is more than {n} queues. Use PCQ for large groups instead.", { n: MAX_QUEUES }));
  if (!c.ok) return well.blocked(c.count);

  const names = new Set();
  for (const t of targets) {
    t.queue = t.name || `${prefix}${t.target.replace(/\/32$/, "")}`;
    if (names.has(t.queue)) { c.fail(mode === "list" ? $("#sq-list") : $("#sq-prefix"), tx("Two queues would be called \"{name}\". Queue names must be unique.", { name: t.queue })); break; }
    names.add(t.queue);
  }
  if (!c.ok) return well.blocked(c.count);

  const notes = [
    ...burstProblems({ max: upMax, burst: burstOn ? upB : 0, threshold: upT, time, limitAt: upAt }, "upload"),
    ...burstProblems({ max: downMax, burst: burstOn ? downB : 0, threshold: downT, time, limitAt: downAt }, "download"),
  ];
  const s = new Script().header("Simple queues");
  s.note("Rates are upload/download as seen from the target (the client).",
    "FastTracked connections bypass simple queues: disable FastTrack or exclude these clients from it.");
  s.section("/queue simple");
  if (parentOn) {
    s.cmd("add", [["name", pName], ["target", pTarget.text], ["max-limit", `${fmtRate(pUp)}/${fmtRate(pDown)}`], ["comment", "parent: total for the group"]]);
    if (targets.some((t) => !(t.c ? t.c.network >= pTarget.network && t.c.last <= pTarget.last : true))) {
      notes.push({ level: "warn", text: tx("Some targets are outside the parent's target network. A child queue only sees traffic that its parent also matches.") });
    }
    const sumAtDown = (downAt || 0) * targets.length;
    if (downAt && sumAtDown > pDown) notes.push({ level: "info", text: tx("The guaranteed download rates (limit-at) add up to {sum}, more than the parent's {max}. They can't all be met at once.", { sum: humanRate(sumAtDown), max: humanRate(pDown) }) });
    if (downMax > pDown || upMax > pUp) notes.push({ level: "warn", text: tx("A client's max-limit is above the parent's, so the parent is what really limits it.") });
  }
  const pair = (a, b) => `${fmtRate(a || 0)}/${fmtRate(b || 0)}`;
  for (const t of targets) {
    s.cmd("add", [
      ["name", t.queue], ["target", t.target], ["parent", parentOn ? pName : ""],
      ["max-limit", pair(upMax, downMax)],
      ["limit-at", upAt || downAt ? pair(upAt, downAt) : ""],
      ["burst-limit", burstOn ? pair(upB, downB) : ""],
      ["burst-threshold", burstOn ? pair(upT, downT) : ""],
      ["burst-time", burstOn ? `${fmtTime(time)}/${fmtTime(time)}` : ""],
    ]);
  }
  if (burstOn && downB && downT && downT < downMax) {
    const sim = simulateBurst({ max: downMax, burst: downB, threshold: downT, time });
    notes.push({ level: "info", text: tx("From idle, a client downloads at {burst} for about {secs} s, then at {max}.", { burst: humanRate(downB), secs: fmtNum(Math.round(sim.burstSecs * 10) / 10), max: humanRate(downMax) }) });
  }
  notes.push({ level: "info", text: txn(targets.length, "{n} queue.", "{n} queues.") + " " + tx("Simple queues are checked top to bottom; with hundreds of clients, PCQ or a queue tree costs less CPU.") });
  well.set(s.toString());
  showNotes($("#sq-notes"), notes);
  return 0;
}

live(root, build, 220);
