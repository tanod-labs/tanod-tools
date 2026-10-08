// Fixture generation and output inspection for the tools check. Uses the vendored pdf-lib in Node.
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../../../site/", import.meta.url));
export const PDFLib = await import(join(SITE, "tools/vendor/pdf-lib/pdf-lib.esm.min.js"));

/* A PDF whose page n (1-based) is (400 + n) points wide, so order survives a round trip and can be
   checked by width. label is drawn on each page. */
export async function makePdf(pages, { label = "Fixture", title } = {}) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([400 + n, 560]);
    page.drawText(`${label} page ${n}`, { x: 40, y: 480, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: 40, y: 80, width: 200, height: 120, color: rgb(0.95, 0.75, 0.1) });
  }
  if (title) doc.setTitle(title);
  doc.setAuthor("Fixture Author");
  return doc.save();
}

/* A PDF that pdf-lib reports as encrypted (trailer carries /Encrypt). */
export async function makeEncryptedPdf() {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const s = bytes.toString("latin1").replace("trailer\n<<", "trailer\n<<\n/Encrypt 1 0 R");
  return Buffer.from(s, "latin1");
}

export async function pdfInfo(bytes) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    pages: doc.getPageCount(),
    widths: doc.getPages().map((p) => Math.round(p.getWidth())),
    sizes: doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
    rotations: doc.getPages().map((p) => p.getRotation().angle),
    title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(),
    keywords: doc.getKeywords(), creator: doc.getCreator(), producer: doc.getProducer(),
    doc,
  };
}

/* ------------------------------------------------------------------ images */

let CRC;
function crc32(buf) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/* RGBA PNG with a gradient and a solid block; extra chunks (e.g. tEXt, eXIf) can be injected. */
export function makePng(w, h, { alpha = false, extraChunks = [] } = {}) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const block = x < w / 3 && y < h / 3;
      raw[i] = block ? 22 : Math.round((x / w) * 255);
      raw[i + 1] = block ? 54 : Math.round((y / h) * 255);
      raw[i + 2] = block ? 163 : 120;
      raw[i + 3] = alpha && x > (2 * w) / 3 ? 96 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extraChunks.map(([t, d]) => chunk(t, Buffer.from(d))),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function pngChunks(buf) {
  const out = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    out.push(buf.toString("latin1", p + 4, p + 8));
    p += 12 + len;
  }
  return out;
}

/* A minimal big-endian EXIF (TIFF) block with Make, Model, Orientation, DateTime and a GPS IFD. */
export function makeExifTiff({ orientation = 1, lat = [14, 35, 0], lon = [120, 59, 0] } = {}) {
  const entries0 = [];
  const data = [];
  // We build with absolute offsets from TIFF start.
  const asciiVals = { 0x010f: "FixtureCam\0", 0x0110: "Model X100\0", 0x0132: "2026:01:02 03:04:05\0" };
  const ifd0Count = 5; // Make, Model, Orientation, DateTime, GPS pointer
  const ifd0Start = 8;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  let cursor = ifd0Start + ifd0Size;
  const gpsCount = 4;
  const gpsStart = cursor + Object.values(asciiVals).reduce((s, v) => s + v.length + (v.length % 2), 0);
  const gpsSize = 2 + gpsCount * 12 + 4;
  let gcursor = gpsStart + gpsSize;
  const buf = Buffer.alloc(gcursor + 48 + 64);
  buf.write("MM", 0, "latin1"); buf.writeUInt16BE(42, 2); buf.writeUInt32BE(8, 4);
  buf.writeUInt16BE(ifd0Count, ifd0Start);
  let e = ifd0Start + 2;
  const put = (tag, type, count, valueOrOffset, inline16) => {
    buf.writeUInt16BE(tag, e); buf.writeUInt16BE(type, e + 2); buf.writeUInt32BE(count, e + 4);
    if (inline16 !== undefined) { buf.writeUInt16BE(inline16, e + 8); } else buf.writeUInt32BE(valueOrOffset, e + 8);
    e += 12;
  };
  for (const tag of [0x010f, 0x0110]) {
    const v = asciiVals[tag]; buf.write(v, cursor, "latin1"); put(tag, 2, v.length, cursor); cursor += v.length + (v.length % 2);
  }
  put(0x0112, 3, 1, 0, orientation);
  { const v = asciiVals[0x0132]; buf.write(v, cursor, "latin1"); put(0x0132, 2, v.length, cursor); cursor += v.length + (v.length % 2); }
  put(0x8825, 4, 1, gpsStart);
  buf.writeUInt32BE(0, e);
  // GPS IFD
  buf.writeUInt16BE(gpsCount, gpsStart);
  e = gpsStart + 2;
  put(0x0001, 2, 2, 0); buf.write("N\0", e - 4, "latin1");
  put(0x0002, 5, 3, gcursor); for (const [i, v] of lat.entries()) { buf.writeUInt32BE(v, gcursor + i * 8); buf.writeUInt32BE(1, gcursor + i * 8 + 4); } gcursor += 24;
  put(0x0003, 2, 2, 0); buf.write("E\0", e - 4, "latin1");
  put(0x0004, 5, 3, gcursor); for (const [i, v] of lon.entries()) { buf.writeUInt32BE(v, gcursor + i * 8); buf.writeUInt32BE(1, gcursor + i * 8 + 4); } gcursor += 24;
  buf.writeUInt32BE(0, e);
  return buf.subarray(0, gcursor);
}

/* Insert an APP1 Exif segment right after SOI of a JPEG. */
export function jpegWithExif(jpeg, tiff) {
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, body, jpeg.subarray(2)]);
}

export function jpegSegments(buf) {
  const out = [];
  let p = 2;
  while (p < buf.length && buf[p] === 0xff) {
    const m = buf[p + 1];
    if (m === 0xda) { out.push("SOS"); break; }
    const len = buf.readUInt16BE(p + 2);
    out.push(m >= 0xe0 && m <= 0xef ? "APP" + (m - 0xe0) + (m === 0xe1 ? ":" + buf.toString("latin1", p + 4, p + 8) : "") : "0x" + m.toString(16));
    p += 2 + len;
  }
  return out;
}

/* Width/height/format for PNG, JPEG, WebP, GIF, BMP and ICO buffers. */
export function imageInfo(buf) {
  buf = Buffer.from(buf);
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25], bitDepth: buf[24] };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p < buf.length) {
      if (buf[p] !== 0xff) { p++; continue; }
      const m = buf[p + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { format: "jpeg", height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
      }
      p += 2 + buf.readUInt16BE(p + 2);
    }
    return { format: "jpeg" };
  }
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const kind = buf.toString("latin1", 12, 16);
    if (kind === "VP8X") return { format: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return { format: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf.toString("latin1", 0, 3) === "GIF") return { format: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString("latin1", 0, 2) === "BM") return { format: "bmp", width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  if (buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
    const n = buf.readUInt16LE(4);
    const entries = [];
    for (let i = 0; i < n; i++) {
      const o = 6 + i * 16;
      const size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
      entries.push({ width: buf[o] || 256, height: buf[o + 1] || 256, inner: imageInfo(buf.subarray(off, off + size)) });
    }
    return { format: "ico", count: n, entries };
  }
  return { format: "unknown" };
}

/* Read the store-only zips the tools produce. */
export function unzip(buf) {
  buf = Buffer.from(buf);
  const files = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 30, p + 30 + nlen);
    const start = p + 30 + nlen + xlen;
    const raw = buf.subarray(start, start + size);
    files.push({ name, data: method === 8 ? inflateSync(raw) : raw });
    p = start + size;
  }
  return files;
}

export function save(dir, name, bytes) {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}
export const read = (p) => readFileSync(p);
