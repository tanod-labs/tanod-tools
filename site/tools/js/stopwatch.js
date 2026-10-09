import { $, el, copyText, textBlob, announce, tx, EN, fmtNum } from "./core.js?v=11";

/* Times are whole centiseconds. Elapsed time is measured with performance.now() deltas, never by counting ticks,
   so a throttled background tab still shows the right time when it wakes up. */
export function fmtCs(cs) {
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(c)}`;
}

const disp = $("#sw-display");
const startBtn = $("#sw-start"), lapBtn = $("#sw-lap"), resetBtn = $("#sw-reset");
let running = false;
let base = 0;        // ms accumulated before the current run
let t0 = 0;          // performance.now() when the current run began
let raf = 0, iv = 0;
let laps = [];       // {lap, time, total} in centiseconds

const elapsedMs = () => base + (running ? performance.now() - t0 : 0);
const elapsedCs = () => Math.floor(elapsedMs() / 10);

function paint() {
  disp.textContent = fmtCs(elapsedCs());
}
function loop() {
  paint();
  if (running) raf = requestAnimationFrame(loop);
}

function sync() {
  startBtn.textContent = running ? tx("Stop") : base > 0 ? tx("Resume") : tx("Start");
  startBtn.setAttribute("aria-keyshortcuts", "Space");
  lapBtn.disabled = !running;
  resetBtn.disabled = !running && base === 0 && !laps.length;
  disp.dataset.state = running ? "running" : base > 0 ? "stopped" : "idle";
}

function start() {
  if (running) return;
  running = true;
  t0 = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
  clearInterval(iv);
  iv = setInterval(paint, 250); // keeps the display fresh when frames are paused in the background
  sync();
  announce(tx("Stopwatch started."));
}
function stop() {
  if (!running) return;
  base += performance.now() - t0;
  running = false;
  cancelAnimationFrame(raf);
  clearInterval(iv);
  paint();
  sync();
  announce(tx("Stopped at {time}.", { time: fmtCs(elapsedCs()).replace(/^00:/, "") }));
}
function lap() {
  if (!running) return;
  const total = elapsedCs();
  const prev = laps.length ? laps[laps.length - 1].total : 0;
  laps.push({ lap: laps.length + 1, time: total - prev, total });
  renderLaps();
  sync();
  announce(tx("Lap {n}: {time}.", { n: lapNum(laps.length), time: fmtCs(total - prev).replace(/^00:/, "") }));
}
function reset() {
  running = false;
  base = 0;
  cancelAnimationFrame(raf);
  clearInterval(iv);
  laps = [];
  paint();
  renderLaps();
  sync();
  announce(tx("Stopwatch reset."));
}

const lapNum = (n) => (EN ? String(n) : fmtNum(n));
const markLabel = (m) => (m === "fastest" ? tx("Fastest") : m === "slowest" ? tx("Slowest") : "");

function marks() {
  if (laps.length < 2) return {};
  let fast = laps[0], slow = laps[0];
  for (const l of laps) { if (l.time < fast.time) fast = l; if (l.time > slow.time) slow = l; }
  if (fast.time === slow.time) return {};
  return { [fast.lap]: "fastest", [slow.lap]: "slowest" };
}

function renderLaps() {
  const body = $("#sw-laps");
  body.replaceChildren();
  $("#sw-lap-box").hidden = !laps.length;
  const mk = marks();
  for (const l of [...laps].reverse()) {
    body.append(el("tr", { class: mk[l.lap] ? "is-" + mk[l.lap] : false },
      el("th", { scope: "row" }, lapNum(l.lap)),
      el("td", { class: "num" }, fmtCs(l.time)),
      el("td", { class: "num" }, fmtCs(l.total)),
      el("td", {}, markLabel(mk[l.lap]))));
  }
  for (const id of ["#sw-copy", "#sw-csv"]) $(id).disabled = !laps.length;
}

export const lapsCsv = () => [tx("Lap"), tx("Lap time"), tx("Split time")].join(",") + "\n" + laps.map((l) => `${l.lap},${fmtCs(l.time)},${fmtCs(l.total)}`).join("\n") + "\n";
const lapsText = () => {
  const mk = marks();
  return laps.map((l) => `${tx("Lap {n}", { n: lapNum(l.lap) })}\t${fmtCs(l.time)}\t${fmtCs(l.total)}${mk[l.lap] ? "\t" + markLabel(mk[l.lap]) : ""}`).join("\n");
};

startBtn.addEventListener("click", () => (running ? stop() : start()));
lapBtn.addEventListener("click", lap);
resetBtn.addEventListener("click", reset);
$("#sw-copy").addEventListener("click", (e) => copyText(lapsText(), e.currentTarget));
$("#sw-csv").addEventListener("click", () => {
  const url = URL.createObjectURL(textBlob(lapsCsv(), "text/csv"));
  const a = document.createElement("a");
  a.href = url; a.download = "stopwatch-laps.csv";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

document.addEventListener("visibilitychange", paint);
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t && t.closest && t.closest("input, textarea, select, button, a, [contenteditable], summary")) return;
  const k = e.key.toLowerCase();
  if (k === " " || e.code === "Space") { e.preventDefault(); running ? stop() : start(); }
  else if (k === "l") { lap(); }
  else if (k === "r") { reset(); }
});

paint();
renderLaps();
sync();
