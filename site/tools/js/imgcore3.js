// Tanod Tools image core, batch 3: small shared helpers for merge images, add text, filters, borders and placeholders.
// Pure pixel maths lives here so the page code stays short. Nothing here touches the network.
import { UserError, tx, fmtNum, EN } from "./core.js?v=11";
import { newCanvas, ctx2d, scaleTo, MAX_PIXELS } from "./imgcore.js?v=11";

export const MAX_SIDE = 32767; // the largest canvas side the common browsers allow

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* "#rrggbb" or "#rgb" to [r, g, b]; anything else gives black. */
export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/* Path for a rounded rectangle (works in every browser, unlike ctx.roundRect). r is clamped to half the short side. */
export function rrPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (r <= 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* A reduced copy of a bitmap for live previews: longest side at most `max`. */
export function thumbOf(bmp, max = 720) {
  const k = Math.min(1, max / bmp.width, max / bmp.height);
  return scaleTo(bmp, bmp.width, bmp.height, Math.max(1, bmp.width * k), Math.max(1, bmp.height * k));
}

/* Wait for a font to be usable before drawing text with it (the page CSS declares Archivo and Bungee lazily). */
export async function loadFont(spec) {
  try {
    if (document.fonts && document.fonts.load) await document.fonts.load(spec, "Aa");
  } catch (_) { /* fall back to whatever the browser has */ }
}

/* Plain-English size guard shared by the tools that build a canvas from typed-in sizes. */
export function sizeProblem(w, h) {
  if (w > MAX_SIDE || h > MAX_SIDE) return tx("That would be {w} × {h} pixels. No side can be longer than {max} pixels.", { w, h, max: fmtNum(MAX_SIDE, { useGrouping: false }) });
  if (w * h > MAX_PIXELS) {
    return tx("That would be {w} × {h} pixels ({mp} megapixels). The limit is {limit} megapixels.", { w, h, mp: EN ? (w * h / 1e6).toFixed(0) : fmtNum(w * h / 1e6, { maximumFractionDigits: 0 }), limit: fmtNum(MAX_PIXELS / 1e6) });
  }
  return null;
}

/* ------------------------------------------------------------------ filters
   All maths is on 8-bit RGBA ImageData, done by hand (no ctx.filter, which Safari lacked for years). Alpha is never
   changed. Order of operations (the same order for preview and full size), each step clamped to 0..255 like CSS does:

     1. brightness b      c' = c * b
     2. contrast k        c' = (c - 128) * k + 128                       (around mid-grey 128)
     3. saturation s      CSS Filter Effects "saturate" matrix
                            R' = (0.213 + 0.787s) R + (0.715 - 0.715s) G + (0.072 - 0.072s) B
                            G' = (0.213 - 0.213s) R + (0.715 + 0.285s) G + (0.072 - 0.072s) B
                            B' = (0.213 - 0.213s) R + (0.715 - 0.715s) G + (0.072 + 0.928s) B
     4. hue rotate a      CSS "hue-rotate" matrix with c = cos a, n = sin a
                            R' = (0.213 + 0.787c - 0.213n) R + (0.715 - 0.715c - 0.715n) G + (0.072 - 0.072c + 0.928n) B
                            G' = (0.213 - 0.213c + 0.143n) R + (0.715 + 0.285c + 0.140n) G + (0.072 - 0.072c - 0.283n) B
                            B' = (0.213 - 0.213c - 0.787n) R + (0.715 - 0.715c + 0.715n) G + (0.072 + 0.928c + 0.072n) B
     5. grayscale g       Y = 0.2126 R + 0.7152 G + 0.0722 B  (Rec. 709 luma, as in the CSS grayscale() matrix)
                          c' = c + (Y - c) g        (g = 1 gives R = G = B = Y)
     6. sepia e           S is the CSS sepia matrix
                            [0.393 0.769 0.189]
                            [0.349 0.686 0.168]
                            [0.272 0.534 0.131]
                          c' = c + (S c - c) e
     7. invert i          c' = c + ((255 - c) - c) i
     8. blur              three box-blur passes per axis, which approximate a Gaussian of sigma = blur * width / 2000
                          (so a preview and the full-size image blur by the same fraction of their width).
                          Colour is blurred weighted by alpha so transparent pixels do not bleed black.

   The saturate and hue-rotate matrices use the 0.213/0.715/0.072 weights printed in the CSS spec; grayscale uses the
   spec's own 0.2126/0.7152/0.0722. That is how browsers' CSS filters behave, which is what is being matched. */

export const FILTER_DEFAULTS = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, invert: 0, hue: 0, blur: 0 };

export const isNeutral = (p) => Object.keys(FILTER_DEFAULTS).every((k) => Number(p[k]) === FILTER_DEFAULTS[k]);

export const blurSigma = (value, width) => (value * width) / 2000;

/* Box sizes (odd) for n passes approximating a Gaussian of the given sigma (Kovesi / "boxes for gauss"). */
export function boxSizes(sigma, n = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* Box blur of a rows-major Float32 plane, horizontal pass, window size `size` (odd), edge pixels repeated. */
function blurRowsH(src, dst, w, y0, y1, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = y0; y < y1; y++) {
    const o = y * w;
    let sum = src[o] * (r + 1);
    for (let i = 1; i <= r; i++) sum += src[o + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = sum * inv;
      sum += src[o + Math.min(x + r + 1, w - 1)] - src[o + Math.max(x - r, 0)];
    }
  }
}

/* Vertical pass, streamed row by row so memory access stays sequential. */
function blurColsV(src, dst, w, h, y0, y1, r, sums) {
  const inv = 1 / (2 * r + 1);
  // column sums for the window centred on row y0
  for (let x = 0; x < w; x++) sums[x] = 0;
  for (let j = y0 - r; j <= y0 + r; j++) {
    const o = Math.min(Math.max(j, 0), h - 1) * w;
    for (let x = 0; x < w; x++) sums[x] += src[o + x];
  }
  for (let y = y0; y < y1; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) dst[o + x] = sums[x] * inv;
    const add = Math.min(y + r + 1, h - 1) * w, sub = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) sums[x] += src[add + x] - src[sub + x];
  }
}

/* Blur one Float32 plane in place with three box passes per axis. `step` is awaited between row chunks. */
async function blurPlane(plane, tmp, w, h, sigma, step) {
  const sizes = boxSizes(sigma, 3);
  const sums = new Float32Array(w);
  const rowsPerChunk = Math.max(8, Math.floor(400000 / w));
  for (const size of sizes) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    for (let y = 0; y < h; y += rowsPerChunk) { blurRowsH(plane, tmp, w, y, Math.min(h, y + rowsPerChunk), r); if (step) await step(); }
    for (let y = 0; y < h; y += rowsPerChunk) { blurColsV(tmp, plane, w, h, y, Math.min(h, y + rowsPerChunk), r, sums); if (step) await step(); }
  }
}

/* Apply the filters to `data` (Uint8ClampedArray RGBA, w x h) in place.
   hooks: { yieldNow: async () => void (called between chunks), progress: (0..1) => void } */
export async function applyFilters(data, w, h, p, hooks = {}) {
  const { yieldNow, progress } = hooks;
  const tonal = ["brightness", "contrast", "saturation", "grayscale", "sepia", "invert", "hue"].some((k) => Number(p[k]) !== FILTER_DEFAULTS[k]);
  const sigma = blurSigma(Number(p.blur) || 0, w);
  const doBlur = sigma >= 0.3;
  const share = doBlur ? 0.45 : 1; // how much of the progress bar the per-pixel part gets

  if (tonal) {
    const br = Number(p.brightness) / 100, ct = Number(p.contrast) / 100, sat = Number(p.saturation) / 100;
    const gray = Number(p.grayscale) / 100, sep = Number(p.sepia) / 100, inv = Number(p.invert) / 100;
    const ang = (Number(p.hue) * Math.PI) / 180, cs = Math.cos(ang), sn = Math.sin(ang);
    const doBr = br !== 1, doCt = ct !== 1, doSat = sat !== 1, doHue = Number(p.hue) !== 0, doGray = gray > 0, doSep = sep > 0, doInv = inv > 0;
    const s1 = 0.213 + 0.787 * sat, s2 = 0.715 - 0.715 * sat, s3 = 0.072 - 0.072 * sat;
    const s4 = 0.213 - 0.213 * sat, s5 = 0.715 + 0.285 * sat, s6 = 0.072 + 0.928 * sat;
    const h11 = 0.213 + cs * 0.787 - sn * 0.213, h12 = 0.715 - cs * 0.715 - sn * 0.715, h13 = 0.072 - cs * 0.072 + sn * 0.928;
    const h21 = 0.213 - cs * 0.213 + sn * 0.143, h22 = 0.715 + cs * 0.285 + sn * 0.14, h23 = 0.072 - cs * 0.072 - sn * 0.283;
    const h31 = 0.213 - cs * 0.213 - sn * 0.787, h32 = 0.715 - cs * 0.715 + sn * 0.715, h33 = 0.072 + cs * 0.928 + sn * 0.072;
    const rowsPerChunk = Math.max(16, Math.floor(600000 / w));
    for (let y0 = 0; y0 < h; y0 += rowsPerChunk) {
      const end = Math.min(h, y0 + rowsPerChunk) * w * 4;
      for (let i = y0 * w * 4; i < end; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        if (doBr) { r = c255(r * br); g = c255(g * br); b = c255(b * br); }
        if (doCt) { r = c255((r - 128) * ct + 128); g = c255((g - 128) * ct + 128); b = c255((b - 128) * ct + 128); }
        if (doSat) {
          const nr = c255(s1 * r + s2 * g + s3 * b), ng = c255(s4 * r + s5 * g + s3 * b), nb = c255(s4 * r + s2 * g + s6 * b);
          r = nr; g = ng; b = nb;
        }
        if (doHue) {
          const nr = c255(h11 * r + h12 * g + h13 * b), ng = c255(h21 * r + h22 * g + h23 * b), nb = c255(h31 * r + h32 * g + h33 * b);
          r = nr; g = ng; b = nb;
        }
        if (doGray) {
          const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r += (Y - r) * gray; g += (Y - g) * gray; b += (Y - b) * gray;
        }
        if (doSep) {
          const nr = 0.393 * r + 0.769 * g + 0.189 * b, ng = 0.349 * r + 0.686 * g + 0.168 * b, nb = 0.272 * r + 0.534 * g + 0.131 * b;
          r = c255(r + (nr - r) * sep); g = c255(g + (ng - g) * sep); b = c255(b + (nb - b) * sep);
        }
        if (doInv) { r += (255 - 2 * r) * inv; g += (255 - 2 * g) * inv; b += (255 - 2 * b) * inv; }
        data[i] = r; data[i + 1] = g; data[i + 2] = b; // typed-array store rounds to nearest
      }
      if (progress) progress(((y0 + rowsPerChunk) / h) * share);
      if (yieldNow) await yieldNow();
    }
  }

  if (doBlur) {
    let plane, tmp;
    try {
      plane = new Float32Array(w * h);
      tmp = new Float32Array(w * h);
    } catch (_) {
      throw new UserError(tx("This image is too large to blur in your browser's memory. Set the blur to 0, or use a smaller image."));
    }
    const n = w * h;
    let hasAlpha = false;
    for (let i = 3; i < n * 4; i += 4) if (data[i] !== 255) { hasAlpha = true; break; }
    const stepper = yieldNow ? async () => { await yieldNow(); } : null;
    let alphaBlur = null;
    if (hasAlpha) {
      for (let i = 0; i < n; i++) plane[i] = data[i * 4 + 3];
      await blurPlane(plane, tmp, w, h, sigma, stepper);
      alphaBlur = new Float32Array(n);
      alphaBlur.set(plane);
    }
    for (let c = 0; c < 3; c++) {
      if (hasAlpha) for (let i = 0; i < n; i++) plane[i] = (data[i * 4 + c] * data[i * 4 + 3]) / 255;
      else for (let i = 0; i < n; i++) plane[i] = data[i * 4 + c];
      await blurPlane(plane, tmp, w, h, sigma, stepper);
      if (hasAlpha) {
        for (let i = 0; i < n; i++) { const a = alphaBlur[i]; if (a > 0.5) data[i * 4 + c] = c255((plane[i] * 255) / a); }
      } else {
        for (let i = 0; i < n; i++) data[i * 4 + c] = plane[i];
      }
      if (progress) progress(share + ((c + 1) / 3) * (1 - share));
    }
  }
  if (progress) progress(1);
}

export { newCanvas, ctx2d };
