import { $, $$, el, debounce, announce, copyText, textBlob, tx, EN, fmtNum } from "./core.js?v=5";
import {
  parseHex, hexToRgb, hexToOklch, oklchToHex, wrapHue, contrastRatio, fmtRatio, wcagLabel,
} from "./colorcore.js?v=5";

const pick = $("#cp-pick"), hexIn = $("#cp-hex"), msg = $("#cp-msg");
const harmonies = $("#cp-harmonies"), randomOut = $("#cp-random-out");
const which = $("#cp-which"), out = $("#cp-out");

/* hue offsets in degrees from the base; "mono" steps lightness instead */
const SCHEMES = [
  { id: "analogous", name: tx("Analogous"), note: tx("Neighbours on the wheel: hues 60 and 30 degrees either side of the base."), hues: [-60, -30, 0, 30, 60] },
  { id: "complementary", name: tx("Complementary"), note: tx("The base and the hue directly opposite it, 180 degrees away."), hues: [0, 180] },
  { id: "split", name: tx("Split-complementary"), note: tx("The base and the two hues beside its complement, at 150 and 210 degrees."), hues: [0, 150, 210] },
  { id: "triadic", name: tx("Triadic"), note: tx("Three hues spaced 120 degrees apart."), hues: [0, 120, 240] },
  { id: "tetradic", name: tx("Tetradic"), note: tx("Four hues spaced 90 degrees apart."), hues: [0, 90, 180, 270] },
  { id: "mono", name: tx("Monochromatic"), note: tx("The base hue with three tints toward white and three shades toward black."), mono: true },
];

let base = "#1636a3";
const palettes = {}; // id -> [hex]
let random = []; // [{hex, locked}]

function schemeColours(s, hex) {
  const [L, C, h] = hexToOklch(hex);
  if (s.mono) {
    const up = (1 - L) * 0.28, down = L * 0.28;
    const steps = [L + up * 3, L + up * 2, L + up, L, L - down, L - down * 2, L - down * 3];
    return steps.map((l) => oklchToHex([Math.min(0.98, Math.max(0.05, l)), C, h]));
  }
  return s.hues.map((d) => (d === 0 ? hex : oklchToHex([L, C, wrapHue(h + d)])));
}

/* ------------------------------------------------------------------ swatch markup */

function ratioLine(name, ratio) {
  return el("p", { class: "gen-sw__c" },
    el("span", {}, name + " "),
    el("b", { class: "mono" }, fmtRatio(ratio)),
    " ",
    el("span", { class: "gen-sw__tag" }, wcagLabel(ratio)));
}

function swatch(hex, { lock, onLock, locked } = {}) {
  const [r, g, b] = hexToRgb(hex);
  const onWhite = contrastRatio(hex, "#ffffff"), onBlack = contrastRatio(hex, "#000000");
  const ink = onWhite >= onBlack ? "#ffffff" : "#000000";
  const copyBtn = el("button", { class: "btn btn--sm", type: "button", "aria-label": tx("Copy {hex}", { hex }) }, tx("Copy hex"));
  copyBtn.addEventListener("click", () => copyText(hex, copyBtn));
  const actions = el("div", { class: "gen-sw__act" }, copyBtn);
  if (lock) {
    const lk = el("button", { class: "btn btn--sm gen-lock", type: "button", "aria-pressed": locked ? "true" : "false", "aria-label": tx("Lock {hex}", { hex }) }, locked ? tx("Locked") : tx("Lock"));
    lk.addEventListener("click", () => {
      const on = lk.getAttribute("aria-pressed") !== "true";
      lk.setAttribute("aria-pressed", String(on));
      lk.textContent = on ? tx("Locked") : tx("Lock");
      onLock(on);
    });
    actions.append(lk);
  }
  return el("li", { class: "gen-sw", dataset: { hex } },
    el("div", { class: "gen-sw__chip", style: `background:${hex};color:${ink}`, "aria-hidden": "true" }, "Aa"),
    el("div", { class: "gen-sw__body" },
      el("p", { class: "gen-sw__hex mono" }, hex),
      el("p", { class: "gen-sw__rgb mono" }, `rgb(${r}, ${g}, ${b})`),
      ratioLine(tx("White text"), onWhite),
      ratioLine(tx("Black text"), onBlack),
      actions));
}

/* ------------------------------------------------------------------ rendering */

function renderHarmonies() {
  harmonies.textContent = "";
  for (const s of SCHEMES) {
    const cols = schemeColours(s, base);
    palettes[s.id] = cols;
    const headId = "cp-h-" + s.id;
    harmonies.append(el("section", { class: "gen-group", dataset: { scheme: s.id }, "aria-labelledby": headId },
      el("h2", { class: "util-h", id: headId }, s.name),
      el("p", { class: "help" }, s.note),
      el("ul", { class: "gen-sws" }, cols.map((c) => swatch(c)))));
  }
  const [L, C, h] = hexToOklch(base);
  msg.textContent = tx("Base in OKLCH: lightness {l}%, chroma {c}, hue {h} degrees.", EN ? { l: (L * 100).toFixed(1), c: C.toFixed(3), h: h.toFixed(1) } : { l: fmtNum(L * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), c: fmtNum(C, { minimumFractionDigits: 3, maximumFractionDigits: 3 }), h: fmtNum(h, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  msg.dataset.hue = h.toFixed(3);
}

function renderRandom() {
  randomOut.textContent = "";
  palettes.random = random.map((s) => s.hex);
  randomOut.append(el("ul", { class: "gen-sws", "aria-label": tx("Random palette") }, random.map((s, i) =>
    swatch(s.hex, { lock: true, locked: s.locked, onLock: (on) => { s.locked = on; } }))));
}

function randoms(n) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => v / 4294967296);
}

function drawRandom() {
  const start = randoms(1)[0] * 360;
  const next = [];
  for (let i = 0; i < 5; i++) {
    if (random[i] && random[i].locked) { next.push(random[i]); continue; }
    const [a, b, c] = randoms(3);
    const L = 0.45 + a * 0.42, C = 0.04 + b * 0.16, h = wrapHue(start + i * 72 + (c - 0.5) * 36);
    next.push({ hex: oklchToHex([L, C, h]), locked: false });
  }
  random = next;
  renderRandom();
  refreshExport();
  announce(tx("Random palette drawn."));
}

/* ------------------------------------------------------------------ export */

const NAMES = { analogous: tx("Analogous"), complementary: tx("Complementary"), split: tx("Split-complementary"), triadic: tx("Triadic"), tetradic: tx("Tetradic"), mono: tx("Monochromatic"), random: tx("Random palette") };

function exportText(fmt, cols, id) {
  if (fmt === "json") return JSON.stringify(cols) + "\n";
  if (fmt === "list") return cols.join("\n") + "\n";
  return `:root {\n${cols.map((c, i) => `  --${id === "mono" ? "shade" : "color"}-${i + 1}: ${c};`).join("\n")}\n}\n`;
}

function refreshExport() {
  const id = which.value;
  const fmt = $('input[name="cp-fmt"]:checked').value;
  out.value = exportText(fmt, palettes[id] || [], id);
}

function fillWhich() {
  const keep = which.value;
  which.textContent = "";
  for (const id of Object.keys(NAMES)) which.append(el("option", { value: id }, NAMES[id]));
  if (keep) which.value = keep;
}

function download() {
  const fmt = $('input[name="cp-fmt"]:checked').value;
  const ext = fmt === "css" ? "css" : fmt === "json" ? "json" : "txt";
  const url = URL.createObjectURL(textBlob(out.value, fmt === "json" ? "application/json" : fmt === "css" ? "text/css" : "text/plain"));
  const a = el("a", { href: url, download: `palette-${which.value}.${ext}` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  announce(tx("Palette downloaded."));
}

/* ------------------------------------------------------------------ base colour */

function setBase(hex, { fromText = false } = {}) {
  base = hex;
  pick.value = hex;
  if (!fromText) hexIn.value = hex;
  hexIn.removeAttribute("aria-invalid");
  renderHarmonies();
  refreshExport();
}

hexIn.addEventListener("input", () => {
  const hex = parseHex(hexIn.value);
  if (!hex) {
    hexIn.setAttribute("aria-invalid", "true");
    msg.textContent = tx("That is not a HEX colour. Use three or six digits, such as #1636a3 or f60.");
    delete msg.dataset.hue;
    return;
  }
  setBase(hex, { fromText: true });
});
hexIn.addEventListener("blur", () => { const h = parseHex(hexIn.value); if (h) hexIn.value = h; });
pick.addEventListener("input", () => setBase(pick.value.toLowerCase()));

$("#cp-random").addEventListener("click", drawRandom);
which.addEventListener("change", refreshExport);
$$('input[name="cp-fmt"]').forEach((r) => r.addEventListener("change", refreshExport));
$("#cp-copy").addEventListener("click", (e) => copyText(out.value, e.currentTarget));
$("#cp-dl").addEventListener("click", download);

/* Space draws a new random palette unless focus is in a field or on a control that uses Space itself. */
document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target;
  if (t && t.closest && t.closest("input, textarea, select, button, a, summary, [contenteditable], [role='button']")) return;
  e.preventDefault();
  drawRandom();
});

fillWhich();
setBase(base);
drawRandom();
