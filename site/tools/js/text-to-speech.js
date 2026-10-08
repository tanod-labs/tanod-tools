import { $, el, setStatus, fmtNum, tx, txn, EN, LANG, LOCALE } from "./core.js?v=5";

const MAX_CHARS = 100000;
const CHUNK = 200;

/* Split text into sentence-sized pieces of about 200 characters or fewer, as {start, end} ranges into the text.
   Chrome stops speaking an utterance after roughly 15 seconds, so long text is spoken piece by piece. */
export function planChunks(text, max = CHUNK) {
  const segs = [];
  const re = /[^\n]*?(?:[.!?…]+["'”’)\]]*(?=\s|$)|[。！？]+|\n+|$)\s*/g;
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) break;
    if (!m[0]) { re.lastIndex++; continue; }
    segs.push([m.index, m.index + m[0].length]);
  }
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (const [s, e] of segs) {
    if (e - s > max) {
      flush();
      let a = s;
      while (e - a > max) {
        const win = text.slice(a, a + max);
        let cut = 0;
        for (const m of win.matchAll(/[,;:，、]\s*(?=\S)/g)) if (m.index + m[0].length >= max * 0.4) cut = m.index + m[0].length;
        if (!cut) { const sp = win.search(/\s\S*$/); cut = sp >= max * 0.4 ? sp + 1 : max; }
        out.push({ start: a, end: a + cut });
        a += cut;
      }
      cur = { start: a, end: e };
    } else if (cur && e - cur.start > max) { flush(); cur = { start: s, end: e }; }
    else if (cur) cur.end = e;
    else cur = { start: s, end: e };
  }
  flush();
  return out.filter((c) => text.slice(c.start, c.end).trim());
}

/* ------------------------------------------------------------------ page */

const synth = window.speechSynthesis;
const supported = !!synth && typeof window.SpeechSynthesisUtterance === "function";
const area = $("#tts-text");
const sel = $("#tts-voice");
const vstat = $("#tts-voice-status");
const status = $("#status");
const btn = { play: $("#tts-play"), pause: $("#tts-pause"), resume: $("#tts-resume"), stop: $("#tts-stop") };
let voices = [];
let chunks = [];
let session = 0, idx = 0, active = false, paused = false;

function setVoiceStatus(state, text) { vstat.dataset.state = state; vstat.textContent = text; }

function langName(code) {
  try {
    const n = new Intl.DisplayNames([EN ? "en" : LOCALE], { type: "language" }).of(code);
    if (n && n !== code) return n;
  } catch (_) { /* fall through */ }
  return code || tx("Other");
}

function pickDefault(list) {
  const nav = (navigator.language || "en").toLowerCase();
  const prim = nav.split("-")[0];
  const best = (f) => list.findIndex(f);
  const page = LANG.toLowerCase(), pagePrim = page.split("-")[0] === "id" ? "in" : page.split("-")[0];
  const primOf = (v) => v.lang.toLowerCase().split(/[-_]/)[0];
  const primIs = (v) => primOf(v) === pagePrim || (pagePrim === "in" && primOf(v) === "id");
  /* On a localized page, a voice in the page language comes first; English pages keep the logic below. */
  const pageTries = EN ? [] : [
    (v) => v.localService && v.lang.toLowerCase().replace("_", "-") === page,
    (v) => v.localService && primIs(v) && v.default,
    (v) => v.localService && primIs(v),
    (v) => primIs(v) && v.default,
    (v) => primIs(v),
  ];
  const tries = [
    ...pageTries,
    (v) => v.localService && v.lang.toLowerCase() === nav,
    (v) => v.localService && v.lang.toLowerCase().split(/[-_]/)[0] === prim && v.default,
    (v) => v.localService && v.lang.toLowerCase().split(/[-_]/)[0] === prim,
    (v) => v.localService && v.default,
    (v) => v.localService,
    (v) => v.default,
    () => true,
  ];
  for (const f of tries) { const i = best(f); if (i >= 0) return i; }
  return 0;
}

function loadVoices() {
  if (!supported) return;
  const prevUri = voices[Number(sel.value)] && voices[Number(sel.value)].voiceURI;
  const all = Array.from(synth.getVoices() || []);
  if (!all.length) return;
  voices = all.slice().sort((a, b) => {
    const la = langName(a.lang), lb = langName(b.lang);
    return la.localeCompare(lb) || (b.localService - a.localService) || a.name.localeCompare(b.name);
  });
  sel.replaceChildren();
  const groups = new Map();
  voices.forEach((v, i) => {
    const key = langName(v.lang);
    if (!groups.has(key)) { const g = el("optgroup", { label: key }); groups.set(key, g); sel.append(g); }
    groups.get(key).append(el("option", { value: String(i) }, `${v.name} (${v.lang})${v.localService ? "" : " " + tx("(online)")}`));
  });
  const keep = prevUri ? voices.findIndex((v) => v.voiceURI === prevUri) : -1;
  sel.value = String(keep >= 0 ? keep : pickDefault(voices));
  const online = voices.filter((v) => !v.localService).length;
  setVoiceStatus("ready", online
    ? txn(voices.length, "{n} voice found, {online} of them online.", "{n} voices found, {online} of them online.", { online: fmtNum(online) })
    : txn(voices.length, "{n} voice found.", "{n} voices found."));
  sel.disabled = false;
  voiceNote();
  update();
}

function voiceNote() {
  const v = voices[Number(sel.value)];
  $("#tts-online").hidden = !(v && !v.localService);
}

/* ------------------------------------------------------------------ reading state */

function follow(start, end) {
  const text = area.value;
  const box = $("#tts-follow");
  box.replaceChildren(text.slice(0, start), el("mark", {}, text.slice(start, end)), text.slice(end));
  const m = box.querySelector("mark");
  if (m && (m.offsetTop > box.scrollTop + box.clientHeight - 24 || m.offsetTop < box.scrollTop)) box.scrollTop = Math.max(0, m.offsetTop - 24);
}

function update() {
  const text = area.value;
  chunks = planChunks(text);
  const n = text.length;
  $("#tts-count").textContent = txn(n, "{n} character", "{n} characters");
  const parts = $("#tts-parts");
  parts.dataset.parts = String(chunks.length);
  parts.textContent = !chunks.length ? tx("Nothing to read yet.") : txn(chunks.length, "Will be read in {n} part.", "Will be read in {n} parts.");
  const ready = supported && voices.length > 0;
  btn.play.disabled = !ready || !chunks.length || active;
  btn.pause.disabled = !active || paused;
  btn.resume.disabled = !active || !paused;
  btn.stop.disabled = !active;
  $("#tts-follow").hidden = !active;
}

function end(msg) {
  session++;
  active = false; paused = false;
  setStatus(status, msg ? "done" : "idle", msg || "");
  update();
}

function speakNext(mySession) {
  if (mySession !== session) return;
  if (idx >= chunks.length) return end(tx("Finished reading."));
  const c = chunks[idx];
  const u = new SpeechSynthesisUtterance(area.value.slice(c.start, c.end));
  const v = voices[Number(sel.value)];
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = Number($("#tts-rate").value);
  u.pitch = Number($("#tts-pitch").value);
  u.volume = Number($("#tts-vol").value);
  u.onstart = () => {
    if (mySession !== session) return;
    follow(c.start, c.end); // sentence-level highlight until word boundaries arrive
    setStatus(status, "working", tx("Reading part {i} of {n}.", { i: fmtNum(idx + 1), n: fmtNum(chunks.length) }));
  };
  u.onboundary = (e) => {
    if (mySession !== session || e.name === "sentence") return;
    const text = area.value;
    const s = c.start + e.charIndex;
    let eEnd = e.charLength > 0 ? s + e.charLength : s + (text.slice(s).search(/\s|$/) || 1);
    if (eEnd <= s) eEnd = Math.min(text.length, s + 1);
    follow(s, eEnd);
  };
  u.onend = () => { if (mySession === session) { idx++; speakNext(mySession); } };
  u.onerror = (e) => {
    if (mySession !== session) return;
    if (e.error === "interrupted" || e.error === "canceled") return;
    end();
    setStatus(status, "error", e.error ? tx("The browser could not speak this text ({error}). Try another voice.", { error: e.error }) : tx("The browser could not speak this text. Try another voice."));
  };
  try { synth.speak(u); } catch (_) { end(); setStatus(status, "error", tx("The browser refused to start speaking. Try again, or pick another voice.")); }
}

function play() {
  if (!supported || !voices.length) return;
  update();
  if (!chunks.length) { setStatus(status, "error", tx("Type or paste some text first.")); return; }
  if (synth.speaking || synth.pending) synth.cancel();
  session++;
  const my = session;
  idx = 0; active = true; paused = false;
  setStatus(status, "working", tx("Starting."));
  update();
  setTimeout(() => speakNext(my), synth.speaking ? 80 : 0);
}

function stop() {
  if (!supported) return;
  session++;
  synth.cancel();
  active = false; paused = false;
  setStatus(status, "idle");
  update();
}

btn.play.addEventListener("click", play);
btn.stop.addEventListener("click", stop);
btn.pause.addEventListener("click", () => { synth.pause(); paused = true; setStatus(status, "working", tx("Paused.")); update(); });
btn.resume.addEventListener("click", () => { synth.resume(); paused = false; setStatus(status, "working", tx("Reading part {i} of {n}.", { i: fmtNum(idx + 1), n: fmtNum(chunks.length) })); update(); });
area.addEventListener("input", () => {
  if (area.value.length > MAX_CHARS) area.value = area.value.slice(0, MAX_CHARS);
  if (!active) update();
  else { stop(); update(); }
});
sel.addEventListener("change", voiceNote);
for (const [id, out, fmt] of [["#tts-rate", "#tts-rate-v", (v) => (EN ? v.toFixed(1) : fmtNum(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })) + "x"], ["#tts-pitch", "#tts-pitch-v", (v) => (EN ? v.toFixed(1) : fmtNum(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))], ["#tts-vol", "#tts-vol-v", (v) => Math.round(v * 100) + "%"]]) {
  const f = () => { $(out).textContent = fmt(Number($(id).value)); };
  $(id).addEventListener("input", f);
  f();
}
$("#tts-clear").addEventListener("click", () => { stop(); area.value = ""; update(); area.focus(); });
window.addEventListener("pagehide", () => { if (supported) synth.cancel(); });

if (!supported) {
  setVoiceStatus("unsupported", tx("This browser does not support speech synthesis (the Web Speech API), so this tool cannot speak. Try a current version of Chrome, Edge, Safari or Firefox."));
  for (const e of [sel, ...Object.values(btn), $("#tts-rate"), $("#tts-pitch"), $("#tts-vol")]) e.disabled = true;
  update();
} else {
  setVoiceStatus("loading", tx("Looking for voices..."));
  sel.disabled = true;
  if (synth.addEventListener) synth.addEventListener("voiceschanged", loadVoices); else synth.onvoiceschanged = loadVoices;
  loadVoices();
  setTimeout(() => {
    if (!voices.length) setVoiceStatus("none", tx("No speech voices were found. Your browser or operating system may have none installed. Add a text-to-speech voice in your device's language or accessibility settings, then reload this page."));
  }, 1500);
  update();
}
