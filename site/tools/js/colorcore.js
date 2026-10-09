// Colour maths shared by the colour tools: sRGB, linear light, OKLab and OKLCH (Bjorn Ottosson's published
// matrices, https://bottosson.github.io/posts/oklab/), WCAG contrast, and chroma-reducing gamut mapping.
import { tx, EN, fmtNum } from "./i18n.js?v=11";

/* "#abc", "abc", "#AABBCC" and "aabbcc" -> "#aabbcc". Anything else (including 4 and 8 digit forms) -> null. */
export function parseHex(input) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(input).trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h;
}

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);

/* [r, g, b] in 0..1 gamma-encoded -> [L, a, b] */
export function srgbToOklab([r, g, b]) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/* [L, a, b] -> linear-light [r, g, b], not clamped */
export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToSrgb(lab) { return oklabToLinear(lab).map(fromLinear); }

export function oklabToOklch([L, a, b]) {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}
export function oklchToOklab([L, C, h]) {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex);
  return oklabToOklch(srgbToOklab([r / 255, g / 255, b / 255]));
}

const EPS = 1e-6;
const inGamut = (rgb) => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/* OKLCH -> "#rrggbb". Colours outside sRGB keep their lightness and hue and lose chroma (bisection) until they fit. */
export function oklchToHex([L, C, h]) {
  if (L >= 1) return "#ffffff";
  if (L <= 0) return "#000000";
  let rgb = oklabToSrgb(oklchToOklab([L, C, h]));
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToSrgb(oklchToOklab([L, mid, h])))) lo = mid; else hi = mid;
    }
    rgb = oklabToSrgb(oklchToOklab([L, lo, h]));
  }
  return rgbToHex(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255);
}

export const wrapHue = (h) => ((h % 360) + 360) % 360;

/* ------------------------------------------------------------------ WCAG 2 contrast */

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/* Truncate (never round up) to 2 decimals, as WCAG asks, and drop a trailing ".00". */
export function fmtRatio(r) {
  const v = Math.floor(r * 100 + 1e-9) / 100;
  if (!EN) return fmtNum(v, { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) + ":1";
  return (Number.isInteger(v) ? String(v) : v.toFixed(2)) + ":1";
}
/* Text label for normal-size text: AAA (7), AA (4.5), "AA large text only" (3), or fails. */
export function wcagLabel(r) {
  if (r >= 7) return "AAA";
  if (r >= 4.5) return "AA";
  if (r >= 3) return tx("AA large text only");
  return tx("Fails AA");
}
