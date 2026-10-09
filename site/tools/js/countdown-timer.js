import { $, $$, copyText, prefs, tx, txn, EN, fmtNum, dateFormat, listText } from "./core.js?v=11";
import { LOCAL_ZONE, fillZoneSelect, zoneOf, isZone, resolveWall, wallFields, fmtWall, fmtOffset, offsetMinutes, weekday, pad } from "./tzcore.js?v=11";

const MAX_SECONDS = 99 * 3600 + 59 * 60 + 59;
const BASE_TITLE = document.title;
const announceEl = $("#ct-announce");
const say = (msg) => { announceEl.textContent = ""; setTimeout(() => { announceEl.textContent = msg; }, 30); };

/* ------------------------------------------------------------------ helpers */

export function hms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
const spoken = (secs) => {
  const m = Math.floor(secs / 60), s = secs % 60, h = Math.floor(m / 60);
  const parts = [];
  if (h) parts.push(txn(h, "{n} hour", "{n} hours"));
  if (m % 60) parts.push(txn(m % 60, "{n} minute", "{n} minutes"));
  if (s || !parts.length) parts.push(txn(s, "{n} second", "{n} seconds"));
  return EN ? parts.join(" ") : listText(parts);
};

/* ------------------------------------------------------------------ sound and wake lock */

let actx = null;
const mute = $("#ct-mute");
mute.checked = prefs.get("ct-mute", false) === true;
mute.addEventListener("change", () => prefs.set("ct-mute", mute.checked));

function prepareAudio() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    if (!actx) actx = new C();
    if (actx.state === "suspended") actx.resume().catch(() => {});
  } catch (_) { actx = null; }
}
function beeps() {
  if (mute.checked) return;
  prepareAudio();
  if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      const osc = actx.createOscillator(), gain = actx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      const t = t0 + i * 0.4;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(actx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch (_) { /* audio unavailable */ }
}

const wake = $("#ct-wake");
let sentinel = null;
if (!("wakeLock" in navigator)) {
  wake.disabled = true;
  $("#ct-wake-help").textContent = tx("This browser has no screen wake lock, so the screen may dim on its own.");
}
let wanted = () => false;
async function syncWake() {
  if (!("wakeLock" in navigator)) return;
  try {
    if (wake.checked && wanted() && !sentinel && document.visibilityState === "visible") {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
      $("#ct-wake-help").textContent = tx("The screen will stay on while the countdown is running.");
    } else if ((!wake.checked || !wanted()) && sentinel) {
      await sentinel.release();
      sentinel = null;
    }
  } catch (_) {
    sentinel = null;
    $("#ct-wake-help").textContent = tx("Your browser did not allow keeping the screen on right now. The countdown still works.");
  }
}
wake.addEventListener("change", syncWake);
document.addEventListener("visibilitychange", () => { syncWake(); tickAll(); });

/* ------------------------------------------------------------------ mode */

const mode = () => $('input[name="ct-mode"]:checked').value;
function syncMode() {
  $("#ct-timer").hidden = mode() !== "timer";
  $("#ct-date").hidden = mode() !== "date";
  syncWake();
}
$$('input[name="ct-mode"]').forEach((r) => r.addEventListener("change", syncMode));

/* ------------------------------------------------------------------ duration timer */

const digits = $("#ct-digits");
const startBtn = $("#ct-start");
const resetBtn = $("#ct-reset");
const err = $("#ct-err");
const inputs = ["#ct-h", "#ct-m", "#ct-s"].map((s) => $(s));
let state = "idle";            // idle | running | paused | finished
let endAt = 0, remaining = 0;  // performance.now() deadline while running; ms left otherwise
let lastSecs = -1;
let timerId = 0;

function readInputs() {
  const v = inputs.map((i) => (i.value.trim() === "" ? 0 : Number(i.value)));
  inputs.forEach((i, k) => i.setAttribute("aria-invalid", Number.isInteger(v[k]) && v[k] >= 0 ? "false" : "true"));
  if (v.some((x) => !Number.isInteger(x) || x < 0)) return { error: tx("Hours, minutes and seconds must be whole numbers of 0 or more.") };
  const total = v[0] * 3600 + v[1] * 60 + v[2];
  if (total > MAX_SECONDS) return { error: tx("The longest timer is 99 hours, 59 minutes and 59 seconds.") };
  return { total };
}

function showIdle() {
  const r = readInputs();
  err.textContent = r.error || "";
  err.hidden = !r.error;
  digits.textContent = r.error ? "--:--:--" : hms(r.total);
}

function setState(s) {
  state = s;
  digits.dataset.state = s;
  startBtn.textContent = s === "running" ? tx("Pause") : s === "paused" ? tx("Resume") : tx("Start");
  resetBtn.disabled = s === "idle";
  inputs.forEach((i) => { i.disabled = s === "running" || s === "paused"; });
  $$(".ct-preset").forEach((b) => { b.disabled = s === "running" || s === "paused"; });
  $("#ct-done").hidden = s !== "finished";
  syncWake();
}

function setTitle(secs) { document.title = tx("{time} left - Countdown timer", { time: hms(secs).replace(/^00:/, "") }); }

function tickTimer() {
  if (state !== "running") return;
  const rem = Math.max(0, endAt - performance.now());
  const secs = Math.ceil(rem / 1000);
  digits.textContent = hms(secs);
  if (secs !== lastSecs) {
    lastSecs = secs;
    if (secs > 0) {
      setTitle(secs);
      if (secs === 10 || secs === 5) say(tx("{n} seconds left", { n: fmtNum(secs) }));
      else if (secs % 60 === 0) say(tx("{time} left", { time: spoken(secs) }));
    }
  }
  if (rem <= 0) finish();
}

function finish() {
  clearInterval(timerId);
  remaining = 0;
  setState("finished");
  digits.textContent = "00:00:00";
  document.title = tx("Time's up - Countdown timer");
  say(tx("Time's up."));
  beeps();
}

function startPause() {
  if (state === "running") {
    remaining = Math.max(0, endAt - performance.now());
    clearInterval(timerId);
    setState("paused");
    digits.textContent = hms(Math.ceil(remaining / 1000));
    say(tx("Paused at {time}.", { time: spoken(Math.ceil(remaining / 1000)) }));
    return;
  }
  prepareAudio(); // browsers only allow sound after a click, so set it up here
  if (state === "idle" || state === "finished") {
    const r = readInputs();
    if (r.error) { err.textContent = r.error; err.hidden = false; return; }
    if (r.total === 0) { err.textContent = tx("Set a time above zero, or pick a preset."); err.hidden = false; inputs[2].setAttribute("aria-invalid", "true"); return; }
    err.hidden = true;
    remaining = r.total * 1000;
    say(tx("Timer started for {time}.", { time: spoken(r.total) }));
  } else say(tx("Resumed."));
  endAt = performance.now() + remaining;
  lastSecs = -1;
  setState("running");
  tickTimer();
  clearInterval(timerId);
  timerId = setInterval(tickTimer, 200);
}

function reset() {
  clearInterval(timerId);
  setState("idle");
  document.title = BASE_TITLE;
  showIdle();
}

startBtn.addEventListener("click", startPause);
resetBtn.addEventListener("click", reset);
inputs.forEach((i) => i.addEventListener("input", () => { if (state === "idle" || state === "finished") { if (state === "finished") reset(); showIdle(); } }));
$$(".ct-preset").forEach((b) => b.addEventListener("click", () => {
  if (state === "finished") reset();
  const min = Number(b.dataset.min);
  inputs[0].value = "0"; inputs[1].value = String(min); inputs[2].value = "0";
  showIdle();
}));

/* ------------------------------------------------------------------ countdown to a date */

const dDate = $("#ct-dd"), dTime = $("#ct-dt"), dZone = $("#ct-dz");
const dMsg = $("#ct-date-msg");
fillZoneSelect(dZone);
let target = null;       // {ms, tz}
let dLast = -1;

function parseWall() {
  const d = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(dDate.value);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dTime.value || "00:00");
  if (!d || !t) return null;
  return { y: +d[1], mo: +d[2], d: +d[3], h: +t[1], mi: +t[2], s: +(t[3] || 0) };
}

function zoneName(tz) { return tz.replace(/_/g, " "); }

function readTarget() {
  target = null;
  dDate.setAttribute("aria-invalid", "false");
  const f = parseWall();
  if (!f) {
    if (dDate.value) dDate.setAttribute("aria-invalid", "true");
    return { msg: dDate.value ? tx("That date could not be read. Use the date picker or the form 2026-12-31.") : tx("Pick a date and a time to count down to.") };
  }
  const tz = zoneOf(dZone.value);
  const r = resolveWall(f, tz);
  target = { ms: r.ms, tz, kind: r.kind };
  return { ok: true };
}

/* Weekday, date and time of an instant on the wall clock of a zone. English keeps "Mon 2026-12-31 23:59". */
function whenText(ms, tz, seconds) {
  if (EN) return `${weekday(ms, tz)} ${fmtWall(ms, tz, { seconds })}`;
  const o = { timeZone: tz, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (seconds) o.second = "2-digit";
  return dateFormat(o).format(new Date(ms));
}

/* The zone-qualified moment, e.g. "Mon 2026-12-31 23:59 in Europe/London". */
function targetName() {
  const { ms, tz } = target;
  return tx("{when} in {zone}", { when: whenText(ms, tz, wallFields(ms, tz).s !== 0), zone: zoneName(tz) });
}

function targetText() {
  const { ms, tz, kind } = target;
  const off = fmtOffset(offsetMinutes(ms, tz));
  const parts = [];
  if (tz !== LOCAL_ZONE) parts.push(tx("{target} (UTC{offset}); that is {local} where you are ({zone}).", { target: targetName(), offset: off, local: whenText(ms, LOCAL_ZONE, false), zone: zoneName(LOCAL_ZONE) }));
  else parts.push(tx("{target} (UTC{offset}).", { target: targetName(), offset: off }));
  if (kind === "gap") parts.push(tx("That clock time is skipped by a daylight-saving change in this zone, so the later equivalent moment is used."));
  if (kind === "overlap") parts.push(tx("That clock time happens twice because the clocks go back, and the first one is used."));
  return parts.join(" ");
}

function writeHash() {
  if (!target) return;
  const f = parseWall();
  const to = `${String(f.y).padStart(4, "0")}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}${f.s ? ":" + pad(f.s) : ""}`;
  try { history.replaceState(null, "", `#to=${to}&tz=${encodeURIComponent(target.tz).replace(/%2F/gi, "/")}`); } catch (_) { /* ignore */ }
}

function tickDate() {
  const boxes = ["#ct-days", "#ct-hours", "#ct-mins", "#ct-secs"].map((s) => $(s));
  if (!target) { boxes.forEach((b) => { b.textContent = "-"; }); return; }
  const rem = target.ms - Date.now();
  const secs = Math.max(0, Math.ceil(rem / 1000));
  const parts = [Math.floor(secs / 86400), Math.floor((secs % 86400) / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  boxes.forEach((b, i) => { b.textContent = EN ? String(parts[i]) : fmtNum(parts[i]); });
  $("#ct-date-box").dataset.state = rem <= 0 ? "past" : "running";
  if (secs !== dLast) {
    const prev = dLast;
    dLast = secs;
    if (prev > 0 && rem > 0) {
      if (secs === 10 || secs === 5) say(tx("{n} seconds left", { n: fmtNum(secs) }));
      else if (secs % 60 === 0 && secs <= 3600) say(tx("{time} left", { time: spoken(secs) }));
    }
    if (prev > 0 && rem <= 0) { say(tx("The countdown has reached its date. Time's up.")); beeps(); syncWake(); }
  }
}

function updateDate({ share = true } = {}) {
  const r = readTarget();
  dLast = -1;
  if (!r.ok) {
    dMsg.textContent = r.msg;
    $("#ct-target").textContent = "";
    $("#ct-share").disabled = true;
  } else {
    const past = target.ms <= Date.now();
    dMsg.textContent = past ? tx("That moment has already passed, so there is nothing to count down to. Choose a later date or time.") : "";
    $("#ct-target").textContent = targetText();
    $("#ct-share").disabled = false;
    if (share) writeHash();
    if (!past) say(tx("Counting down to {target}.", { target: targetName() }));
  }
  tickDate();
  syncWake();
}

wanted = () => (state === "running") || (mode() === "date" && !!target && target.ms > Date.now());

for (const e of [dDate, dTime, dZone]) e.addEventListener("change", () => updateDate());
$("#ct-share").addEventListener("click", (e) => {
  writeHash();
  copyText(location.href, e.currentTarget);
});

/* #to=2026-12-31T23:59&tz=Europe/London */
export function parseHash(hash) {
  const h = hash.replace(/^#/, "");
  const p = {};
  for (const part of h.split("&")) {
    const i = part.indexOf("=");
    if (i > 0) { try { p[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch (_) { /* ignore */ } }
  }
  const m = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(p.to || "");
  if (!m) return p.to ? { bad: true } : null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}${m[6] ? ":" + m[6] : ""}`, tz: p.tz || "" };
}

function applyHash() {
  const h = parseHash(location.hash);
  if (!h) return;
  $('input[name="ct-mode"][value="date"]').checked = true;
  syncMode();
  if (h.bad) { dMsg.textContent = tx("The link's date could not be read. Expected something like #to=2026-12-31T23:59&tz=Europe/London."); return; }
  dDate.value = h.date;
  dTime.value = h.time;
  let tz = h.tz && isZone(h.tz) ? h.tz : "local";
  if (tz === LOCAL_ZONE) tz = "local";
  if (tz !== "local" && ![...dZone.options].some((o) => o.value === tz)) dZone.append(new Option(zoneName(tz), tz));
  dZone.value = tz;
  updateDate({ share: false });
  if (h.tz && !isZone(h.tz)) dMsg.textContent = tx("The time zone \"{tz}\" in the link is not known to this browser, so your own time zone is used.", { tz: h.tz }) + (dMsg.textContent ? " " + dMsg.textContent : "");
}
window.addEventListener("hashchange", applyHash);

/* ------------------------------------------------------------------ loop */

function tickAll() { tickTimer(); tickDate(); }
setInterval(tickDate, 250);

setState("idle");
showIdle();
syncMode();
updateDate({ share: false });
applyHash();
