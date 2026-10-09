import { $, el, live, Checker, showNotes, scriptWell, radio, tx } from "./rosui.js?v=11";
import { EN, fmtNum } from "./core.js?v=11";
import { parseRate, fmtRate, humanRate, parseTime, InputError } from "./roscore.js?v=11";
import { simulateBurst, burstEstimate, thresholdFor, burstProblems } from "./rosqueue.js?v=11";

const root = $("#bc");
const well = scriptWell({ out: $("#bc-out"), copy: $("#bc-copy"), download: $("#bc-dl"), name: "mikrotik-burst.rsc" });
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const secs = (s) => (EN ? (Math.round(s * 100) / 100) + " s" : tx("{n} s", { n: fmtNum(Math.round(s * 100) / 100) }));

function wholeSeconds(v) {
  const t = parseTime(v);
  if (t > 3600) throw new InputError(tx("Keep burst-time to an hour or less."));
  return t;
}

function read(c, dir) {
  const g = (k) => $(`#bc-${dir}-${k}`);
  return {
    max: c.get(g("max"), (v) => parseRate(v)),
    burst: c.get(g("burst"), (v) => parseRate(v)),
    threshold: c.get(g("thr"), (v) => parseRate(v)),
    time: c.get(g("time"), wholeSeconds),
  };
}

function chart(cfg, sim) {
  const W = 640, H = 260, L = 64, R = 12, T = 14, B = 34;
  const tMax = sim.points.length * sim.step;
  const yMax = Math.max(cfg.burst, cfg.max, cfg.threshold) * 1.12;
  const x = (t) => L + (t / tMax) * (W - L - R);
  const y = (r) => T + (1 - r / yMax) * (H - T - B);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ros-chart", role: "img", "aria-labelledby": "bc-chart-t" });
  s.append(svg("rect", { x: L, y: T, width: W - L - R, height: H - T - B, class: "ax" }));
  const used = [];
  for (const r of [cfg.max, cfg.burst, cfg.threshold]) {
    if (used.some((u) => Math.abs(u - y(r)) < 13)) continue;   // don't print labels on top of each other
    used.push(y(r));
    const t = svg("text", { x: L - 6, y: y(r) + 4, "text-anchor": "end" });
    t.textContent = fmtRate(r);
    s.append(t);
  }
  for (let k = 0; k <= 3; k++) {
    const t = svg("text", { x: x(k * cfg.time), y: H - 12, "text-anchor": k === 0 ? "start" : k === 3 ? "end" : "middle" });
    t.textContent = `${k * cfg.time}s`;
    s.append(t);
  }
  s.append(svg("path", { d: `M${L} ${y(cfg.threshold)}H${W - R}`, class: "thr" }));
  let d = "";
  sim.points.forEach((p, i) => { d += (i ? `H${x(p.t)}V${y(p.rate)}` : `M${x(p.t)} ${y(p.rate)}`); });
  d += `H${x(tMax)}`;
  s.append(svg("path", { d, class: "rate" }));
  s.append(svg("path", { d: sim.points.map((p, i) => `${i ? "L" : "M"}${x(p.t + sim.step)} ${y(p.avg)}`).join(""), class: "avg" }));
  return s;
}

function build() {
  const c = new Checker(root);
  const up = read(c, "up"), down = read(c, "down");
  const want = c.get($("#bc-want"), (v) => (v.trim() ? parseTime(v) : null));
  if (!c.ok) { $("#bc-facts").hidden = true; $("#bc-chart").textContent = ""; return well.blocked(c.count); }

  const notes = [...burstProblems(up, "upload"), ...burstProblems(down, "download")];
  const dir = radio("bc-dir", root) || "down";
  const cfg = dir === "up" ? up : down;
  const sim = simulateBurst(cfg);
  const facts = $("#bc-facts");
  facts.textContent = "";
  facts.hidden = false;
  const row = (k, v, key) => facts.append(el("div", { class: key ? "is-key" : "" }, el("dt", {}, k), el("dd", {}, v)));
  for (const [label, x] of [[tx("Client upload"), up], [tx("Client download"), down]]) {
    const s = simulateBurst(x);
    row(tx("{dir}: burst from idle lasts", { dir: label }), secs(s.burstSecs), true);
  }
  const bytes = sim.burstSecs * cfg.burst / 8;
  row(tx("Data sent during that burst"), bytes >= 1e6 ? tx("{n} MB", { n: fmtNum(Math.round(bytes / 1e5) / 10) }) : tx("{n} kB", { n: fmtNum(Math.round(bytes / 100) / 10) }));
  row(tx("Estimate (threshold × time ÷ burst-limit)"), secs(burstEstimate(cfg)));
  row(tx("Idle time that restores the full burst"), secs(cfg.time));
  if (want) {
    for (const [label, x] of [[tx("Client upload"), up], [tx("Client download"), down]]) {
      const thr = thresholdFor(x, want);
      row(tx("{dir}: threshold for a {n}-second burst", { dir: label, n: fmtNum(want) }), thr < x.max ? fmtRate(Math.round(thr / 1000) * 1000) : tx("not possible below max-limit"));
    }
  }
  const box = $("#bc-chart");
  box.textContent = "";
  box.append(chart(cfg, sim));
  $("#bc-chart-t").textContent = tx("{dir}: a client that was idle starts a big transfer and gets {burst} for {secs}, then {max}.", {
    dir: dir === "up" ? tx("Client upload") : tx("Client download"), burst: humanRate(cfg.burst), secs: secs(sim.burstSecs), max: humanRate(cfg.max),
  });

  const pair = (k) => `${fmtRate(up[k])}/${fmtRate(down[k])}`;
  const lines = [
    "# Burst settings. Pairs are upload/download, as seen from the client (target).",
    `# From idle, a client bursts for about ${Math.round(sim.burstSecs * 100) / 100}s (${dir === "up" ? "upload" : "download"}).`,
    "/queue simple",
    `add name=client1 target=192.168.88.10/32 max-limit=${pair("max")} burst-limit=${pair("burst")} burst-threshold=${pair("threshold")} burst-time=${up.time}s/${down.time}s`,
    "",
    "# The same limits as a PPP profile or RADIUS rate-limit (rx/tx from the router's side = upload/download):",
    `# rate-limit="${pair("max")} ${pair("burst")} ${pair("threshold")} ${up.time}/${down.time}"`,
  ];
  well.set(lines.join("\n") + "\n");
  showNotes($("#bc-notes"), notes);
  return 0;
}

live(root, build);
