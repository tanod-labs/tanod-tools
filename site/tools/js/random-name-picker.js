import { $, el, copyText, setStatus, announce, tx, txn, txf, EN, fmtNum, listText } from "./core.js?v=11";
import { randIndex, shuffle, sampleIndices } from "./randcore.js?v=11";

const SIZE = 800;            // canvas drawing size; CSS scales it down
const LABEL_LIMIT = 100;     // above this many names the wheel is drawn without labels
const SPIN_MS = 3400;
const TAU = Math.PI * 2;

/* Whole numbers in text keep plain digits on English pages (no thousands separators), as before. */
const dig = (v) => (EN ? String(v) : fmtNum(v));
const spoken = (list) => (EN ? list.join(", ") : listText(list));

const area = $("#rp-names");
const status = $("#status");
const canvas = $("#rp-wheel");
const ctx = canvas.getContext("2d");
const goBtn = $("#rp-go");
let rot = -Math.PI / 2;      // current wheel rotation
let spinning = false;
let lastTeamsText = "";
let histCount = 0;

/* ------------------------------------------------------------------ names */

export function parseNames(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function duplicates(names) {
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m].filter(([, c]) => c > 1);
}

function updateInfo() {
  const names = parseNames(area.value);
  const dups = duplicates(names);
  let s = names.length ? txn(names.length, "{n} name", "{n} names") : tx("No names yet");
  if (dups.length) {
    const shown = dups.slice(0, 3).map(([n, c]) => tx("{name} x{count}", { name: n, count: dig(c) })).join(", ") + (dups.length > 3 ? ", ..." : "");
    s += ". " + txn(dups.length, "{n} name appears more than once ({shown}); each copy counts as its own entry.", "{n} names appear more than once ({shown}); each copy counts as its own entry.", { shown });
  } else if (names.length) s += ".";
  $("#rp-info").textContent = s;
  canvas.setAttribute("aria-label", names.length ? txn(names.length, "Wheel showing {n} name", "Wheel showing {n} names") : tx("Empty wheel: add names to fill it"));
  return names;
}

/* ------------------------------------------------------------------ wheel */

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function fit(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo ? text.slice(0, lo).trimEnd() + "…" : "…";
}

function drawWheel(names, angle = rot) {
  const c = SIZE / 2, R = c - 22;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const fills = [css("--enamel"), css("--surface-2"), css("--enamel-wash")];
  const inks = [css("--ink"), css("--text"), css("--text")];
  const frame = css("--frame");
  const n = names.length;
  ctx.lineJoin = "round";
  if (!n) {
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU);
    ctx.fillStyle = css("--surface-2"); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = frame; ctx.stroke();
    ctx.fillStyle = css("--text-soft");
    ctx.font = `700 34px ${css("--font-text")}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(tx("Add names"), c, c - 64); // two lines, clear of the hub drawn below
    ctx.fillText(tx("to fill the wheel"), c, c + 64);
  } else {
    const a = TAU / n;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    for (let i = 0; i < n; i++) {
      const k = n > 1 && n % 2 && i === n - 1 ? 2 : i % 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i * a, (i + 1) * a); ctx.closePath();
      ctx.fillStyle = fills[k]; ctx.fill();
      if (n <= 400) { ctx.lineWidth = n > 100 ? 1 : 3; ctx.strokeStyle = frame; ctx.stroke(); }
    }
    if (n <= LABEL_LIMIT) {
      const size = Math.max(11, Math.min(34, Math.floor((TAU * R * 0.6 / n) * 0.62)));
      ctx.font = `700 ${size}px ${css("--font-text")}`;
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        const k = n > 1 && n % 2 && i === n - 1 ? 2 : i % 2;
        ctx.save();
        ctx.rotate((i + 0.5) * a);
        ctx.fillStyle = inks[k];
        ctx.fillText(fit(names[i], R - 30 - 52), R - 30, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.lineWidth = 8; ctx.strokeStyle = frame; ctx.stroke();
  }
  // hub and pointer (the pointer stays at the top; the wheel turns beneath it)
  ctx.beginPath(); ctx.arc(c, c, 26, 0, TAU);
  ctx.fillStyle = css("--surface"); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = frame; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c - 22, 2); ctx.lineTo(c + 22, 2); ctx.lineTo(c, 46); ctx.closePath();
  ctx.fillStyle = css("--route"); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = frame; ctx.stroke();
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function spinTo(names, index) {
  const n = names.length;
  const a = TAU / n;
  const jitter = randIndex(801) / 1000 - 0.4; // land anywhere in the middle 80% of the slice
  const desired = -Math.PI / 2 - (index + 0.5 + jitter) * a;
  const delta = (((desired - rot) % TAU) + TAU) % TAU + TAU * 3;
  const from = rot, to = rot + delta;
  if (reduced()) { rot = to; drawWheel(names); return Promise.resolve(); }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / SPIN_MS);
      const e = 1 - Math.pow(1 - p, 3.2);
      rot = from + (to - from) * e;
      drawWheel(names);
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
    // keep the result on time even if the tab is hidden and frames are paused
    setTimeout(() => { if (rot !== to) { rot = to; drawWheel(names); resolve(); } }, SPIN_MS + 400);
  });
}

/* ------------------------------------------------------------------ actions */

function mode() { return document.querySelector('input[name="rp-mode"]:checked').value; }

function fail(msg, field) {
  area.setAttribute("aria-invalid", field === area ? "true" : "false");
  for (const id of ["#rp-winners", "#rp-teams"]) $(id).setAttribute("aria-invalid", field && field.id === id.slice(1) ? "true" : "false");
  $("#rp-result").replaceChildren();
  $("#rp-result").dataset.state = "empty";
  setStatus(status, "error", msg);
  announce(msg);
}

function addHistory(text) {
  histCount++;
  const list = $("#rp-history");
  list.prepend(el("li", {}, text));
  while (list.children.length > 50) list.lastChild.remove();
  $("#rp-hist-box").hidden = false;
}

async function pick() {
  if (spinning) return;
  const names = updateInfo();
  for (const e of [area, $("#rp-winners"), $("#rp-teams")]) e.setAttribute("aria-invalid", "false");
  if (!names.length) return fail(tx("Add at least one name, one per line, then try again."), area);
  setStatus(status, "idle");
  if (mode() === "teams") return makeTeams(names);
  const k = Number($("#rp-winners").value);
  if (!Number.isInteger(k) || k < 1) return fail(tx("Winners must be a whole number of 1 or more."), $("#rp-winners"));
  /* k > names.length >= 1, so k is always 2 or more here. */
  if (k > names.length) return fail(txn(names.length, "You asked for {k} winners but the list has only {n} name. Add names or lower the number.", "You asked for {k} winners but the list has only {n} names. Add names or lower the number.", { k: fmtNum(k) }), $("#rp-winners"));
  const idx = sampleIndices(names.length, k);
  const winners = idx.map((i) => names[i]);
  spinning = true;
  goBtn.disabled = true; area.readOnly = true;
  goBtn.textContent = tx("Spinning…");
  const result = $("#rp-result");
  result.replaceChildren();
  result.dataset.state = "spinning";
  await spinTo(names, idx[0]);
  spinning = false;
  goBtn.disabled = false; area.readOnly = false;
  goBtn.textContent = tx("Pick");
  result.dataset.state = "done";
  result.replaceChildren(
    el("p", { class: "rp-label" }, k === 1 ? tx("Winner") : tx("{k} winners", { k: dig(k) })),
    k === 1 ? el("p", { class: "rp-win" }, winners[0]) : el("ol", { class: "rp-wins" }, winners.map((w) => el("li", {}, w))));
  announce(k === 1 ? tx("Winner: {names}.", { names: winners[0] }) : tx("{k} winners: {names}.", { k: dig(k), names: spoken(winners) }));
  addHistory(k === 1 ? tx("Winner: {names}", { names: winners[0] }) : tx("{k} winners: {names}", { k: dig(k), names: winners.join(", ") }));
  if ($("#rp-remove").checked) {
    const drop = new Set(idx);
    area.value = names.filter((_, i) => !drop.has(i)).join("\n");
    area.dispatchEvent(new Event("input", { bubbles: true }));
    $("#rp-info").textContent += " " + txn(k, "{n} name removed from the list.", "{n} names removed from the list.");
  }
}

const teamsSummary = (nNames, t) => txn(t, "{names} in {n} team", "{names} in {n} teams", { names: txn(nNames, "{n} name", "{n} names") });

function makeTeams(names) {
  const t = Number($("#rp-teams").value);
  if (!Number.isInteger(t) || t < 1) return fail(tx("Teams must be a whole number of 1 or more."), $("#rp-teams"));
  /* t > names.length >= 1, so t is always 2 or more here. */
  if (t > names.length) return fail(txn(names.length, "You asked for {t} teams but the list has only {n} name. Lower the number of teams or add names.", "You asked for {t} teams but the list has only {n} names. Lower the number of teams or add names.", { t: fmtNum(t) }), $("#rp-teams"));
  const order = shuffle(names.slice());
  const teams = Array.from({ length: t }, () => []);
  order.forEach((n, i) => teams[i % t].push(n)); // dealing one by one keeps sizes within 1 of each other
  const result = $("#rp-result");
  result.dataset.state = "done";
  const grid = el("div", { class: "rp-teams" }, teams.map((m, i) => el("section", { class: "rp-team" },
    el("h3", { class: "rp-team__h" }, ...txf("Team {n} {count}", { n: dig(i + 1), count: el("span", {}, `(${dig(m.length)})`) })),
    el("ul", {}, m.map((n) => el("li", {}, n))))));
  lastTeamsText = teams.map((m, i) => tx("Team {n}: {names}", { n: dig(i + 1), names: m.join(", ") })).join("\n");
  const copy = el("button", { class: "btn btn--sm", type: "button" }, tx("Copy teams"));
  copy.addEventListener("click", () => copyText(lastTeamsText, copy));
  result.replaceChildren(el("p", { class: "rp-label" }, teamsSummary(names.length, t)), grid, el("div", { class: "actions" }, copy));
  announce(txn(t, "{names} split into {n} team.", "{names} split into {n} teams.", { names: txn(names.length, "{n} name", "{n} names") }));
  addHistory(tx("Teams ({n}): {teams}", { n: dig(t), teams: teams.map((m) => m.join(", ")).join(" | ") }));
}

/* ------------------------------------------------------------------ wiring */

function syncMode() {
  const teams = mode() === "teams";
  $("#rp-win-box").hidden = teams;
  $("#rp-team-box").hidden = !teams;
  $("#rp-remove-box").hidden = teams;
  goBtn.textContent = teams ? tx("Split into teams") : tx("Pick");
}

document.querySelectorAll('input[name="rp-mode"]').forEach((r) => r.addEventListener("change", syncMode));
goBtn.addEventListener("click", pick);
area.addEventListener("input", () => {
  if (spinning) return;
  const names = updateInfo();
  drawWheel(names);
});
$("#rp-clear-hist").addEventListener("click", () => {
  $("#rp-history").replaceChildren();
  $("#rp-hist-box").hidden = true;
});
$("#rp-sample").addEventListener("click", () => {
  area.value = ["Amara", "Bruno", "Chen", "Dalia", "Emre", "Farah"].join("\n");
  area.dispatchEvent(new Event("input", { bubbles: true }));
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawWheel(parseNames(area.value)));

syncMode();
drawWheel(updateInfo());
document.fonts && document.fonts.ready.then(() => { if (!spinning) drawWheel(parseNames(area.value)); });
