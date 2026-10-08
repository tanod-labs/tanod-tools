import { $, live, wireCopy, downloadButton, setStatus, announce, fmtInt, normalizeNewlines, tx } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const dirs = Array.from(document.querySelectorAll('input[name="dir"]'));
const MAX = 100000;
const MAX_PLAY = 2000;

/* International Morse code (ITU-R M.1677-1), plus the widely used ! code. */
export const CODE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-",
  "&": ".-...", ":": "---...", ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-", "\"": ".-..-.",
  "$": "...-..-", "@": ".--.-.",
};
const BACK = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
const ALIAS = { "’": "'", "‘": "'", "“": "\"", "”": "\"" };

export function toMorse(raw) {
  const unknown = new Set();
  const lines = normalizeNewlines(raw).split("\n").map((line) => line.split(/\s+/).filter(Boolean).map((word) => {
    const codes = [];
    for (const ch of word) {
      let c = ALIAS[ch] || ch;
      c = c.toUpperCase().normalize("NFKD").replace(/\p{M}+/gu, "");
      let ok = true;
      const parts = [];
      for (const b of c) { if (CODE[b]) parts.push(CODE[b]); else ok = false; }
      if (ok && parts.length) codes.push(...parts); else unknown.add(ch);
    }
    return codes.join(" ");
  }).filter(Boolean).join(" / "));
  return { text: lines.join("\n"), unknown: [...unknown] };
}

export function fromMorse(raw) {
  const unknown = new Set();
  const norm = normalizeNewlines(raw).replace(/[·•∙⋅]/g, ".").replace(/[–—−_]/g, "-");
  const lines = norm.split("\n").map((line) => line.trim().split(/\s*\/\s*| {2,}|\t+/).filter((w) => w.trim()).map((word) =>
    word.trim().split(/\s+/).map((tok) => {
      if (BACK[tok]) return BACK[tok];
      unknown.add(tok);
      return "#";
    }).join("")).join(" "));
  return { text: lines.join("\n"), unknown: [...unknown] };
}

const dir = () => dirs.find((d) => d.checked).value;
const quote = (list) => {
  const items = list.slice(0, 12).map((s) => `"${s}"`).join(", ");
  return list.length > 12 ? tx("{items} and {n} more", { items, n: list.length - 12 }) : items;
};

function update() {
  const enc = dir() === "encode";
  $("#in-l").textContent = enc ? tx("Text") : tx("Morse code");
  $("#out-l").textContent = enc ? tx("Morse code") : tx("Text");
  area.classList.toggle("mono", !enc);
  out.classList.toggle("mono", enc);
  area.placeholder = enc ? tx("Type text here, for example SOS") : tx("Paste Morse code, for example ... --- ...");
  setStatus(status, "idle");
  const raw = area.value;
  let msg = enc ? tx("Type text to begin.") : tx("Paste Morse code to begin.");
  out.value = "";
  if (raw.length > MAX) {
    setStatus(status, "error", tx("That is {n} characters; the limit is {max}.", { n: fmtInt(raw.length), max: fmtInt(MAX) }));
  } else if (raw.trim()) {
    const r = enc ? toMorse(raw) : fromMorse(raw);
    out.value = r.text;
    msg = enc ? tx("Translated to Morse code.") : tx("Decoded from Morse code.");
    if (r.unknown.length) {
      msg += " " + (enc ? tx("Left out, no Morse code for: {list}.", { list: quote(r.unknown) }) : tx("Not valid Morse, shown as #: {list}.", { list: quote(r.unknown) }));
    }
  }
  $("#report").textContent = msg;
  $("#copy").disabled = $("#dl").disabled = $("#swap").disabled = !out.value;
  $("#clear").disabled = !raw;
  $("#play").disabled = !(enc ? out.value : raw.trim());
}

/* ------------------------------------------------------------------ sound */
let audio = null;

function stopSound() {
  if (audio) { try { audio.close(); } catch (_) { /* already closed */ } }
  audio = null;
  $("#stop").hidden = true;
  $("#play").hidden = false;
}

function playSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { setStatus(status, "error", tx("Your browser can't play generated sound.")); return; }
  stopSound();
  let morse = (dir() === "encode" ? out.value : area.value).slice(0, MAX_PLAY);
  morse = morse.replace(/[·•∙⋅]/g, ".").replace(/[–—−_]/g, "-");
  const unit = 1.2 / Number($("#wpm").value);
  const ctx = new AC();
  audio = ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 600;
  gain.gain.value = 0;
  osc.connect(gain).connect(ctx.destination);
  let t = ctx.currentTime + 0.1;
  const ramp = 0.005;
  const tone = (len) => {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + ramp);
    gain.gain.setValueAtTime(0.4, t + len - ramp);
    gain.gain.linearRampToValueAtTime(0, t + len);
    t += len + unit; // one unit of silence inside a letter
  };
  const words = morse.split(/\s*[\/\n]\s*| {2,}/);
  words.forEach((w, wi) => {
    w.trim().split(/\s+/).forEach((letter, li, arr) => {
      for (const s of letter) { if (s === ".") tone(unit); else if (s === "-") tone(3 * unit); }
      if (li < arr.length - 1) t += 2 * unit; // letter gap: 3 units total
    });
    if (wi < words.length - 1) t += 6 * unit; // word gap: 7 units total
  });
  osc.start();
  osc.stop(t);
  osc.onended = () => { if (audio === ctx) stopSound(); };
  $("#play").hidden = true;
  $("#stop").hidden = false;
  $("#stop").focus();
  announce(tx("Playing."));
}

live(() => area.value, [area, ...dirs], () => { stopSound(); update(); });
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "morse-code.txt"), { id: "dl" }));
$("#swap").addEventListener("click", () => {
  const next = dir() === "encode" ? "decode" : "encode";
  area.value = out.value;
  dirs.find((d) => d.value === next).checked = true;
  stopSound();
  update();
  announce(next === "decode" ? tx("Now decoding the Morse code back to text.") : tx("Now translating the text back to Morse code."));
});
$("#clear").addEventListener("click", () => { area.value = ""; stopSound(); update(); area.focus(); });
$("#play").addEventListener("click", playSound);
$("#stop").addEventListener("click", () => { stopSound(); $("#play").focus(); });
update();
