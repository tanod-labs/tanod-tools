// HEIC to JPG: the checks around the decoder. Pure functions (no DOM, no UI strings), so they can be tested with plain node.
// The decoder is the vendored ts-heic library (pure JavaScript, no WebAssembly), which is passed to decodeChecked as an argument.

export const MAX_PIXELS = 50e6;     // the biggest picture the decoder is asked to build

/* Why a file could not be converted. code: "not-heic" | "too-big" (width, height) | "unsupported" (detail) | "damaged". */
export class HeicError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    this.width = extra.width;
    this.height = extra.height;
    this.detail = extra.detail;
  }
}

const ascii = (b, s, e) => { let r = ""; for (let i = s; i < e && i < b.length; i++) r += String.fromCharCode(b[i]); return r; };
const u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

/* The brands in a file's "ftyp" box: { major, compatible: [...] }, or null when the bytes do not start with one. */
export function brandsOf(bytes) {
  if (!bytes || bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const size = u32(bytes, 0);
  const end = size >= 16 && size <= bytes.length ? size : Math.min(bytes.length, 64);
  const compatible = [];
  for (let p = 16; p + 4 <= end; p += 4) compatible.push(ascii(bytes, p, p + 4));
  return { major: ascii(bytes, 8, 12), compatible };
}

/* "heic" for a HEVC-coded HEIF photo (the kind phones make), "avif" for AVIF (also an ISO "HEIF" container, but a different
   codec), null for anything else. The HEVC brands are the ones the decoder itself accepts. */
export function heicKind(bytes) {
  const b = brandsOf(bytes);
  if (!b) return null;
  const all = [b.major, ...b.compatible];
  if (all.some((x) => x === "heic" || x === "heix" || x === "hevc" || x === "hevx")) return "heic";
  if (all.some((x) => x === "avif" || x === "avis")) return "avif";
  return null;
}

/* True when a decoded picture has big stretches that were never filled in. The decoder pre-fills its planes with zeros, and a
   zero in all three planes gives one particular colour (`empty`, [r, g, b]); a real photograph has essentially none of it. */
export function looksDamaged(rgba, empty = [0, 135, 0], share = 0.02) {
  const n = rgba.length >> 2;
  if (!n) return false;
  const [r, g, b] = empty;
  let hit = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === r && rgba[i + 1] === g && rgba[i + 2] === b) hit++;
  return hit > n * share;
}

/* Decode one HEIC file with the ts-heic module `lib`. Returns { width, height, data } (RGBA bytes, turned upright) or throws a
   HeicError. Unsupported files (10-bit, 4:2:2 or 4:4:4, lossless, monochrome, other codecs) are refused by the decoder with
   an error; a few files it cannot follow decode into a picture with empty areas, which is caught here. */
export function decodeChecked(lib, bytes) {
  if (heicKind(bytes) !== "heic") throw new HeicError("not-heic");
  const detail = (e) => String((e && e.message) || e);
  let meta;
  try { meta = lib.getHeicMetadata(bytes); } catch (e) { throw new HeicError("unsupported", { detail: detail(e) }); }
  if (meta.width * meta.height > MAX_PIXELS) throw new HeicError("too-big", { width: meta.width, height: meta.height });
  let img;
  try { img = lib.decodeHeic(bytes); } catch (e) { throw new HeicError("unsupported", { detail: detail(e) }); }
  const color = (meta.sps && meta.sps.color) || {};
  const blank = lib.yuv420ToRgba(new Uint8Array(4), new Uint8Array(1), new Uint8Array(1), 2, 2, { matrixCoeffs: color.matrixCoeffs ?? 6, fullRange: color.videoFullRange ?? true });
  if (looksDamaged(img.data, [blank[0], blank[1], blank[2]])) throw new HeicError("damaged");
  return { width: img.width, height: img.height, data: img.data };
}
