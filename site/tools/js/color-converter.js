import { $, $$, el, copyText, tx, EN, fmtNum } from "./core.js?v=5";

/* The 148 CSS named colours; their values are read from the browser's own CSS parser. */
const NAMES = ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" ");

let ctx;
/* Let the browser parse other CSS colour syntax. Returns {r,g,b,a} or null. */
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

let nameMap;
function namesFor(hex6) {
  if (!nameMap) {
    nameMap = new Map();
    for (const n of NAMES) {
      const c = cssParse(n);
      if (!c) continue;
      const h = toHex(c, false);
      nameMap.set(h, [...(nameMap.get(h) || []), n]);
    }
  }
  return nameMap.get(hex6) || [];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function num(tok, { pct = 1, allowPct = true } = {}) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(tok);
  if (!m) throw new Error(tx("\"{tok}\" isn't a number.", { tok }));
  if (m[2] && !allowPct) throw new Error(tx("\"{tok}\" can't be a percentage here.", { tok }));
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

const alphaOf = (tok) => (tok === undefined ? 1 : clamp(num(tok, { pct: 1 }), 0, 1));

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}
function fromHsv(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
}

/* Parse a colour string into {r, g, b (0-255, may be fractional), a (0-1), via}. Throws Error with a plain message. */
export function parseColor(input) {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error(tx("Type a colour."));
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1, via: "hex" };
  }
  const fn = /^(rgba?|hsla?|hsv|hsb|cmyk)\s*\((.*)\)$/.exec(s);
  if (fn) {
    const kind = fn[1];
    const args = fn[2].replace("/", " ").split(/[\s,]+/).filter(Boolean);
    const need = kind === "cmyk" ? 4 : 3;
    if (args.length < need || args.length > need + 1) throw new Error(kind === "cmyk" ? tx("{kind}() needs {need} values; this has {n}.", { kind, need, n: args.length }) : tx("{kind}() needs {need} values and an optional alpha; this has {n}.", { kind, need, n: args.length }));
    const a = alphaOf(args[need]);
    if (kind.startsWith("rgb")) {
      const [r, g, b] = args.slice(0, 3).map((t) => clamp(num(t, { pct: 255 }), 0, 255));
      return { r, g, b, a, via: "rgb" };
    }
    const pctArg = (t) => clamp(num(t.endsWith("%") ? t : t + "%", { pct: 1 }), 0, 1);
    if (kind.startsWith("hsl")) return { ...fromHsl(hue(args[0]), pctArg(args[1]), pctArg(args[2])), a, via: "hsl" };
    if (kind === "hsv" || kind === "hsb") return { ...fromHsv(hue(args[0]), pctArg(args[1]), pctArg(args[2])), a, via: "hsv" };
    const [c, m, y, k] = args.slice(0, 4).map(pctArg);
    return { r: 255 * (1 - c) * (1 - k), g: 255 * (1 - m) * (1 - k), b: 255 * (1 - y) * (1 - k), a, via: "cmyk" };
  }
  const css = cssParse(s);
  if (css) return { ...css, via: /^[a-z]+$/.test(s) ? "name" : "css" };
  throw new Error(tx("That isn't a colour this tool can read. Try #1636a3, rgb(22, 54, 163), hsl(226, 76%, 36%), cmyk(87%, 67%, 0%, 36%) or a CSS name such as rebeccapurple."));
}

/* ------------------------------------------------------------------ formatting */

const r1 = (v) => { const x = Math.round(v * 10) / 10; return String(Object.is(x, -0) ? 0 : x); };
const h2 = (v) => Math.round(v).toString(16).padStart(2, "0");
const aText = (a) => String(Math.round(a * 1000) / 1000);

export function toHex(c, withAlpha = c.a < 1) {
  return "#" + h2(c.r) + h2(c.g) + h2(c.b) + (withAlpha ? h2(c.a * 255) : "");
}

export function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function toHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
}

export function toCmyk({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: (1 - r - k) / (1 - k) * 100, m: (1 - g - k) / (1 - k) * 100, y: (1 - b - k) / (1 - k) * 100, k: k * 100 };
}

export function formats(c) {
  const hsl = toHsl(c), hsv = toHsv(c), cmyk = toCmyk(c);
  const alpha = c.a < 1;
  return {
    hex: toHex(c),
    rgb: alpha ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${aText(c.a)})` : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`,
    hsl: alpha ? `hsla(${r1(hsl.h)}, ${r1(hsl.s)}%, ${r1(hsl.l)}%, ${aText(c.a)})` : `hsl(${r1(hsl.h)}, ${r1(hsl.s)}%, ${r1(hsl.l)}%)`,
    hsv: `hsv(${r1(hsv.h)}, ${r1(hsv.s)}%, ${r1(hsv.v)}%)`,
    cmyk: `cmyk(${r1(cmyk.c)}%, ${r1(cmyk.m)}%, ${r1(cmyk.y)}%, ${r1(cmyk.k)}%)`,
  };
}

/* ------------------------------------------------------------------ WCAG contrast */

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/* Source-over blend of a (possibly translucent) colour on an opaque one, rounded to whole channel values. */
export function over(top, under) {
  const mix = (t, u) => Math.round(t * top.a + u * (1 - top.a));
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

export function contrast(fg, bg) {
  const solidBg = bg.a < 1 ? over(bg, { r: 255, g: 255, b: 255, a: 1 }) : { r: Math.round(bg.r), g: Math.round(bg.g), b: Math.round(bg.b), a: 1 };
  const solidFg = fg.a < 1 ? over(fg, solidBg) : { r: Math.round(fg.r), g: Math.round(fg.g), b: Math.round(fg.b), a: 1 };
  const L1 = luminance(solidFg), L2 = luminance(solidBg);
  return { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), solidFg, solidBg };
}

/* Two decimals, but never rounded up across a WCAG threshold (4.499 shows as 4.49, not 4.50). */
export function ratioText(ratio) {
  let v = Math.round(ratio * 100) / 100;
  for (const t of [3, 4.5, 7]) if (ratio < t && v >= t) v = Math.floor(ratio * 100) / 100;
  return (EN ? String(v) : fmtNum(v, { maximumFractionDigits: 2 })) + ":1";
}

/* ------------------------------------------------------------------ page */

const cIn = $("#c-in"), cPick = $("#c-pick"), cInfo = $("#c-info"), swatch = $("#c-swatch");
const kFg = $("#k-fg"), kBg = $("#k-bg"), kFgPick = $("#k-fg-pick"), kBgPick = $("#k-bg-pick");
const kInfo = $("#k-info"), kRatio = $("#k-ratio"), kNote = $("#k-note"), sample = $("#k-sample");
let current = null;

const VIA = { hex: "HEX", rgb: "RGB", hsl: "HSL", hsv: "HSV", cmyk: "CMYK", name: tx("CSS colour name"), css: tx("CSS colour (read by your browser)") };

function flag(node, input, msg, err) {
  node.textContent = msg;
  node.classList.toggle("tt__err", err);
  input.setAttribute("aria-invalid", err ? "true" : "false");
}

function convert(fromPicker = false) {
  let c;
  try { c = parseColor(cIn.value); } catch (e) {
    current = null;
    flag(cInfo, cIn, e.message, true);
    $("#c-out").hidden = true;
    return;
  }
  current = c;
  const f = formats(c);
  $("#o-hex").textContent = f.hex;
  $("#o-rgb").textContent = f.rgb;
  $("#o-hsl").textContent = f.hsl;
  $("#o-hsv").textContent = f.hsv;
  $("#o-cmyk").textContent = f.cmyk;
  const names = c.a === 1 ? namesFor(toHex(c, false)) : [];
  $("#o-name").textContent = names.join(", ");
  $("#o-name").parentElement.hidden = !names.length;
  $("#c-out").hidden = false;
  swatch.style.background = f.rgb;
  if (!fromPicker) cPick.value = toHex(c, false);
  flag(cInfo, cIn, c.a < 1 ? tx("Read as {via}, {pct}% opaque.", { via: VIA[c.via], pct: EN ? Math.round(c.a * 1000) / 10 : fmtNum(Math.round(c.a * 1000) / 10) }) : tx("Read as {via}.", { via: VIA[c.via] }), false);
}

function check() {
  let fg, bg;
  try { fg = parseColor(kFg.value); } catch (e) { return bad(kFg, tx("Text colour: {msg}", { msg: e.message })); }
  try { bg = parseColor(kBg.value); } catch (e) { return bad(kBg, tx("Background colour: {msg}", { msg: e.message })); }
  kFg.setAttribute("aria-invalid", "false"); kBg.setAttribute("aria-invalid", "false");
  kInfo.textContent = ""; kInfo.classList.remove("tt__err");
  const r = contrast(fg, bg);
  kRatio.textContent = ratioText(r.ratio);
  for (const b of $$(".col-badge")) {
    const ok = r.ratio >= Number(b.dataset.min);
    b.textContent = ok ? tx("Pass") : tx("Fail");
    b.classList.toggle("is-pass", ok);
    b.classList.toggle("is-fail", !ok);
  }
  sample.style.color = toHex(r.solidFg, false);
  sample.style.background = toHex(r.solidBg, false);
  const notes = [];
  if (bg.a < 1) notes.push(tx("The background is partly transparent, so it is assumed to sit on white: it shows as {hex}.", { hex: toHex(r.solidBg, false) }));
  if (fg.a < 1) notes.push(tx("The text colour is partly transparent, so it was blended with the background before measuring, as a screen would show it: {hex}.", { hex: toHex(r.solidFg, false) }));
  kNote.textContent = notes.join(" ");
  kNote.hidden = !notes.length;
  if (document.activeElement !== kFgPick) kFgPick.value = toHex(fg, false);
  if (document.activeElement !== kBgPick) kBgPick.value = toHex(bg, false);
  return null;
}

function bad(input, msg) {
  input.setAttribute("aria-invalid", "true");
  kInfo.textContent = msg;
  kInfo.classList.add("tt__err");
  kRatio.textContent = "–";
  for (const b of $$(".col-badge")) { b.textContent = ""; b.classList.remove("is-pass", "is-fail"); }
  return null;
}

/* copy buttons */
for (const row of $$("#c-out > div")) {
  const label = row.querySelector("dt").textContent;
  row.append(el("button", { type: "button", class: "btn btn--sm btn--quiet dv-copy", "aria-label": tx("Copy {label}", { label }),
    onclick: (e) => copyText(row.querySelector("dd").textContent, e.currentTarget) }, tx("Copy")));
}

cIn.addEventListener("input", () => convert());
cPick.addEventListener("input", () => { cIn.value = cPick.value; convert(true); });
for (const i of [kFg, kBg]) i.addEventListener("input", check);
kFgPick.addEventListener("input", () => { kFg.value = kFgPick.value; check(); });
kBgPick.addEventListener("input", () => { kBg.value = kBgPick.value; check(); });
$("#k-swap").addEventListener("click", () => { [kFg.value, kBg.value] = [kBg.value, kFg.value]; check(); });
$("#k-use").addEventListener("click", () => { if (current) { kFg.value = toHex(current); check(); kFg.focus(); } });

convert();
check();
