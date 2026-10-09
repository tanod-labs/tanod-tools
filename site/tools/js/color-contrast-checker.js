// Colour contrast checker: WCAG 2.x relative-luminance contrast ratio for a text and a background colour.
import { $, $$, tx, fmtNum } from "./core.js?v=11";

let ctx;
/* Let the browser parse other CSS colour syntax and names. Returns {r,g,b,a} or null. */
function cssParse(s) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  for (const sentinel of ["#010203", "#030201"]) {
    ctx.fillStyle = sentinel;
    ctx.fillStyle = s;
    const v = String(ctx.fillStyle);
    if (v === sentinel) continue;
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4), 16), a: 1 };
    const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(v);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    return null;
  }
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function num(tok, { pct = 1 } = {}) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(tok);
  if (!m) throw new Error(tx("\"{tok}\" isn't a number.", { tok }));
  return m[2] ? Number(m[1]) * pct / 100 : Number(m[1]);
}

function hue(tok) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i.exec(tok);
  if (!m) throw new Error(tx("\"{tok}\" isn't an angle.", { tok }));
  const v = Number(m[1]);
  const unit = (m[2] || "deg").toLowerCase();
  const deg = unit === "turn" ? v * 360 : unit === "rad" ? v * 180 / Math.PI : unit === "grad" ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/* A colour string (hex, rgb(), hsl() or a CSS name) to {r, g, b (0-255), a (0-1)}. Throws Error with a plain message. */
export function parseColor(input) {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error(tx("Type a colour."));
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\s*\((.*)\)$/.exec(s);
  if (fn) {
    const kind = fn[1];
    const args = fn[2].replace("/", " ").split(/[\s,]+/).filter(Boolean);
    if (args.length < 3 || args.length > 4) throw new Error(tx("{kind}() needs {need} values and an optional alpha; this has {n}.", { kind, need: 3, n: args.length }));
    const a = args[3] === undefined ? 1 : clamp(num(args[3]), 0, 1);
    if (kind.startsWith("rgb")) {
      const [r, g, b] = args.slice(0, 3).map((t) => clamp(num(t, { pct: 255 }), 0, 255));
      return { r, g, b, a };
    }
    const pctArg = (t) => clamp(num(t.endsWith("%") ? t : t + "%"), 0, 1);
    return { ...fromHsl(hue(args[0]), pctArg(args[1]), pctArg(args[2])), a };
  }
  const css = cssParse(s);
  if (css) return css;
  throw new Error(tx("That isn't a colour this tool can read. Try #777777, rgb(119, 119, 119), hsl(0, 0%, 47%) or a CSS name such as rebeccapurple."));
}

/* ------------------------------------------------------------------ WCAG 2 contrast */

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const hx = (v) => Math.round(v).toString(16).padStart(2, "0");
const toHex = (c) => "#" + hx(c.r) + hx(c.g) + hx(c.b);

/* Source-over blend of a translucent colour on an opaque one, rounded to whole channel values. */
const over = (top, under) => {
  const mix = (t, u) => Math.round(t * top.a + u * (1 - top.a));
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
};

export function contrast(fg, bg) {
  const solidBg = bg.a < 1 ? over(bg, { r: 255, g: 255, b: 255, a: 1 }) : { r: Math.round(bg.r), g: Math.round(bg.g), b: Math.round(bg.b), a: 1 };
  const solidFg = fg.a < 1 ? over(fg, solidBg) : { r: Math.round(fg.r), g: Math.round(fg.g), b: Math.round(fg.b), a: 1 };
  const L1 = luminance(solidFg), L2 = luminance(solidBg);
  return { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), solidFg, solidBg };
}

/* Two decimals, but never rounded up across a WCAG threshold (4.499 shows as 4.49, not 4.50). */
function ratioText(ratio) {
  let v = Math.round(ratio * 100) / 100;
  for (const t of [3, 4.5, 7]) if (ratio < t && v >= t) v = Math.floor(ratio * 100) / 100;
  return fmtNum(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ page */

const fgIn = $("#cc-fg"), bgIn = $("#cc-bg"), fgPick = $("#cc-fg-pick"), bgPick = $("#cc-bg-pick");
const info = $("#cc-info"), ratioEl = $("#cc-ratio"), rawEl = $("#cc-raw"), note = $("#cc-note"), sample = $("#cc-sample");

function bad(input, msg) {
  input.setAttribute("aria-invalid", "true");
  info.textContent = msg;
  info.classList.add("tt__err");
  ratioEl.textContent = "–";
  ratioEl.removeAttribute("data-ratio");
  rawEl.textContent = "";
  rawEl.removeAttribute("title");
  for (const b of $$(".col-badge")) { b.textContent = ""; b.classList.remove("is-pass", "is-fail"); }
  note.hidden = true;
}

function check() {
  let fg, bg;
  try { fg = parseColor(fgIn.value); } catch (e) { return bad(fgIn, tx("Text colour: {msg}", { msg: e.message })); }
  try { bg = parseColor(bgIn.value); } catch (e) { return bad(bgIn, tx("Background colour: {msg}", { msg: e.message })); }
  fgIn.setAttribute("aria-invalid", "false");
  bgIn.setAttribute("aria-invalid", "false");
  info.textContent = "";
  info.classList.remove("tt__err");
  const r = contrast(fg, bg);
  ratioEl.textContent = ratioText(r.ratio) + ":1";
  ratioEl.dataset.ratio = String(r.ratio);
  const raw = tx("Unrounded: {value}", { value: fmtNum(Number(r.ratio.toFixed(6)), { maximumFractionDigits: 6 }) + ":1" });
  rawEl.textContent = raw;
  ratioEl.title = raw;
  for (const b of $$(".col-badge")) {
    const ok = r.ratio >= Number(b.dataset.min);
    b.textContent = ok ? tx("Pass") : tx("Fail");
    b.classList.toggle("is-pass", ok);
    b.classList.toggle("is-fail", !ok);
  }
  sample.style.color = toHex(r.solidFg);
  sample.style.background = toHex(r.solidBg);
  const notes = [];
  if (bg.a < 1) notes.push(tx("The background is partly transparent, so it is assumed to sit on white: it shows as {hex}.", { hex: toHex(r.solidBg) }));
  if (fg.a < 1) notes.push(tx("The text colour is partly transparent, so it was blended with the background before measuring, as a screen would show it: {hex}.", { hex: toHex(r.solidFg) }));
  note.textContent = notes.join(" ");
  note.hidden = !notes.length;
  if (document.activeElement !== fgPick) fgPick.value = toHex(fg);
  if (document.activeElement !== bgPick) bgPick.value = toHex(bg);
}

for (const i of [fgIn, bgIn]) i.addEventListener("input", check);
fgPick.addEventListener("input", () => { fgIn.value = fgPick.value; check(); });
bgPick.addEventListener("input", () => { bgIn.value = bgPick.value; check(); });
$("#cc-swap").addEventListener("click", () => { [fgIn.value, bgIn.value] = [bgIn.value, fgIn.value]; check(); });

check();
