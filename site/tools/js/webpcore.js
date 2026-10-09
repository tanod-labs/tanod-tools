// WebP helpers for Image to WebP: what kind of WebP a file is and how its size changed. Pure functions (no DOM, no UI
// strings), so they can be tested with plain node.

const ascii = (b, s, e) => { let r = ""; for (let i = s; i < e && i < b.length; i++) r += String.fromCharCode(b[i]); return r; };
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

/* Read a WebP file's header. Returns { kind: "lossy" | "lossless" | "unknown", alpha, animated }, or null when the bytes
   are not a WebP file. The container is RIFF; the first chunk says how the picture is stored: "VP8 " is lossy, "VP8L" is
   lossless, "VP8X" is the extended form whose flags are followed by the same chunks (an "ALPH" chunk adds transparency to
   a lossy picture). */
export function webpInfo(bytes) {
  if (!bytes || bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
  let kind = "unknown", alpha = false, animated = false;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = ascii(bytes, p, p + 4);
    const size = u32(bytes, p + 4);
    if (id === "VP8X") {
      alpha = !!(bytes[p + 8] & 0x10);
      animated = !!(bytes[p + 8] & 0x02);
    } else if (id === "ALPH") {
      alpha = true;
    } else if (id === "VP8 ") {
      kind = "lossy";
      break;
    } else if (id === "VP8L") {
      kind = "lossless";
      if (bytes[p + 8] === 0x2f && p + 13 <= bytes.length) alpha = alpha || !!((u32(bytes, p + 9) >>> 28) & 1);
      break;
    } else if (id === "ANMF") {
      animated = true;
    }
    p += 8 + size + (size & 1);
  }
  return { kind, alpha, animated };
}

/* How a size changed. Returns { pct, dir }: pct is the whole-number percentage of the original, and dir is "smaller",
   "larger" or "same" (a change that rounds to 0% counts as the same). */
export function sizeChange(before, after) {
  if (!(before > 0) || !(after >= 0)) return { pct: 0, dir: "same" };
  const pct = Math.round((Math.abs(after - before) / before) * 100);
  if (pct === 0) return { pct: 0, dir: "same" };
  return { pct, dir: after < before ? "smaller" : "larger" };
}

/* The encoder quality (0..1) for a slider value in percent; always at least 1% and at most 100%. */
export function qualityValue(percent) {
  const v = Number(percent);
  if (!Number.isFinite(v)) return 0.8;
  return Math.min(100, Math.max(1, Math.round(v))) / 100;
}

/* Total of before and after sizes over a list of { before, after } pairs. */
export function totalSizes(pairs) {
  let before = 0, after = 0;
  for (const p of pairs) { before += p.before; after += p.after; }
  return { before, after };
}
