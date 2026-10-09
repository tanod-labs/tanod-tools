import { $, el, fmtBytes, baseName, extOf, tx, txn, fmtNum } from "./core.js?v=11";
import {
  batchTool, decode, newCanvas, ctx2d, release, encodeCanvas, crc32, concatBytes, ascii, UserError, LABEL, dims,
} from "./imgcore.js?v=11";


const keepOrient = $("#keep-orient");

/* ------------------------------------------------------------------ EXIF (TIFF) reader */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const ORIENTATION = {
  1: tx("Normal"), 2: tx("Mirrored"), 3: tx("Rotated 180°"), 4: tx("Mirrored vertically"), 5: tx("Mirrored, rotated 90° anticlockwise"),
  6: tx("Rotated 90° clockwise"), 7: tx("Mirrored, rotated 90° clockwise"), 8: tx("Rotated 90° anticlockwise"),
};

/* b: bytes, base: offset of the TIFF header, end: end of the EXIF data. Never throws; returns what it could read. */
function parseTiff(b, base, end) {
  const info = { make: "", model: "", software: "", date: "", lens: "", artist: "", copyright: "", orientation: 1, gps: null, gpsPresent: false, other: 0, thumbnail: false, valid: false };
  try {
    if (base + 8 > end) return info;
    const le = b[base] === 0x49 && b[base + 1] === 0x49;
    if (!le && !(b[base] === 0x4d && b[base + 1] === 0x4d)) return info;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    if (u16(base + 2) !== 42) return info;
    info.valid = true;
    const valPos = (e, type, count) => ((TYPE_SIZE[type] || 1) * count <= 4 ? e + 8 : base + u32(e + 8));
    const str = (e, type, count) => {
      const o = valPos(e, type, count);
      if (o < base || o + count > end) return "";
      let s = "";
      for (let i = 0; i < count && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
      return s.trim();
    };
    const rationals = (e, count) => {
      const o = valPos(e, 5, count);
      const r = [];
      for (let i = 0; i < count && o + i * 8 + 8 <= end; i++) { const d = u32(o + i * 8 + 4); r.push(d ? u32(o + i * 8) / d : 0); }
      return r;
    };
    let gpsLat = null, gpsLon = null, latRef = "", lonRef = "", gpsTags = 0;
    const seen = new Set();
    const readIfd = (off, kind) => {
      const o = base + off;
      if (off < 8 || o + 2 > end || seen.has(off)) return 0;
      seen.add(off);
      const n = u16(o);
      if (n > 400) return 0;
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        if (e + 12 > end) break;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        if (kind === "ifd0" || kind === "exif") {
          if (tag === 0x8769 && kind === "ifd0") { readIfd(u32(e + 8), "exif"); continue; }
          if (tag === 0x8825 && kind === "ifd0") { info.gpsPresent = true; readIfd(u32(e + 8), "gps"); continue; }
          if (tag === 0xa005) { continue; } // interoperability pointer
        }
        if (kind === "ifd0") {
          if (tag === 0x010f) { info.make = str(e, type, count); continue; }
          if (tag === 0x0110) { info.model = str(e, type, count); continue; }
          if (tag === 0x0131) { info.software = str(e, type, count); continue; }
          if (tag === 0x0132) { if (!info.date) info.date = str(e, type, count); continue; }
          if (tag === 0x013b) { info.artist = str(e, type, count); continue; }
          if (tag === 0x8298) { info.copyright = str(e, type, count); continue; }
          if (tag === 0x0112 && type === 3) { info.orientation = u16(e + 8); continue; }
        } else if (kind === "exif") {
          if (tag === 0x9003) { info.date = str(e, type, count); continue; }
          if (tag === 0xa434) { info.lens = str(e, type, count); continue; }
          if (tag === 0xa433 && !info.lens) { info.lens = str(e, type, count); continue; }
        } else if (kind === "gps") {
          if (tag === 1) { latRef = str(e, type, count); continue; }
          if (tag === 3) { lonRef = str(e, type, count); continue; }
          if (tag === 2 && type === 5 && count >= 3) { gpsLat = rationals(e, 3); continue; }
          if (tag === 4 && type === 5 && count >= 3) { gpsLon = rationals(e, 3); continue; }
          gpsTags++;
        } else if (kind === "ifd1") {
          if (tag === 0x0201 || tag === 0x0202) info.thumbnail = true;
        }
        info.other++;
      }
      return u32(o + 2 + n * 12);
    };
    const next = readIfd(u32(base + 4), "ifd0");
    if (next) readIfd(next, "ifd1");
    if (gpsLat && gpsLon) {
      const dec = (v) => v[0] + v[1] / 60 + v[2] / 3600;
      let lat = dec(gpsLat), lon = dec(gpsLon);
      if (/^s/i.test(latRef)) lat = -lat;
      if (/^w/i.test(lonRef)) lon = -lon;
      if (Number.isFinite(lat) && Number.isFinite(lon)) info.gps = { lat, lon };
    }
    info.other += gpsTags;
  } catch (_) { /* partial read is fine */ }
  return info;
}

/* The smallest possible EXIF block: one IFD with only the Orientation tag. 26 bytes, big-endian. */
function minimalTiff(orientation) {
  const t = new Uint8Array(26);
  const dv = new DataView(t.buffer);
  t.set([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]);
  dv.setUint16(8, 1); dv.setUint16(10, 0x0112); dv.setUint16(12, 3); dv.setUint32(14, 1); dv.setUint16(18, orientation);
  return t;
}

/* ------------------------------------------------------------------ format scanners */

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function damaged(name) { return new UserError(tx("\"{name}\" looks damaged, so its metadata couldn't be read safely.", { name })); }

function scanJpeg(b, name) {
  const segs = [];
  let p = 2, sos = -1;
  const r = { kind: "jpeg", segs, exif: null, xmp: false, iptc: false, icc: false, comments: 0, otherApp: 0, trailing: 0, eoi: 0 };
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) throw damaged(name);
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xda) { sos = p; break; }
    if (m === 0xd9) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = u16(b, p + 2);
    if (len < 2 || p + 2 + len > b.length) throw damaged(name);
    const seg = { m, start: p, end: p + 2 + len, keep: true, kind: "other" };
    const d = p + 4, head = ascii(b, d, Math.min(d + 40, seg.end));
    if (m === 0xe0) { if (head.startsWith("JFIF\0")) seg.kind = "jfif"; else { seg.keep = false; seg.kind = "app0"; r.otherApp++; } }
    else if (m === 0xe1) {
      seg.keep = false;
      if (head.startsWith("Exif\0\0")) { seg.kind = "exif"; if (!r.exif) r.exif = parseTiff(b, d + 6, seg.end); }
      else if (head.startsWith("http://ns.adobe.com/xap/1.0/") || head.startsWith("http://ns.adobe.com/xmp/extension/")) { seg.kind = "xmp"; r.xmp = true; }
      else r.otherApp++;
    } else if (m === 0xe2) { if (head.startsWith("ICC_PROFILE\0")) { seg.kind = "icc"; r.icc = true; } else { seg.keep = false; r.otherApp++; } }
    else if (m === 0xed) { seg.keep = false; seg.kind = "iptc"; r.iptc = true; }
    else if (m === 0xee && head.startsWith("Adobe")) { seg.kind = "adobe"; }
    else if (m >= 0xe0 && m <= 0xef) { seg.keep = false; r.otherApp++; }
    else if (m === 0xfe) { seg.keep = false; seg.kind = "com"; r.comments++; }
    segs.push(seg);
    p += 2 + len;
  }
  if (sos < 0) throw damaged(name);
  r.sos = sos;
  // the first FF D9 after the scan header is the end of the image; anything beyond is trailing data
  let i = sos + 2 + u16(b, sos + 2);
  r.eoi = 0;
  while (i < b.length - 1) {
    i = b.indexOf(0xff, i);
    if (i < 0 || i + 1 >= b.length) break;
    if (b[i + 1] === 0xd9) { r.eoi = i + 2; break; }
    i += b[i + 1] === 0xff ? 1 : 2;
  }
  r.trailing = r.eoi ? b.length - r.eoi : 0;
  return r;
}

function scanPng(b, name) {
  const r = { kind: "png", chunks: [], exif: null, xmp: false, texts: [], time: false, icc: false, trailing: 0 };
  let p = 8;
  while (p + 12 <= b.length) {
    const len = u32be(b, p);
    if (p + 12 + len > b.length) throw damaged(name);
    const type = ascii(b, p + 4, p + 8);
    const c = { type, start: p, end: p + 12 + len, keep: true };
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      c.keep = false;
      let k = p + 8;
      while (k < p + 8 + len && b[k] !== 0) k++;
      const kw = ascii(b, p + 8, Math.min(k, p + 8 + 80));
      r.texts.push(kw);
      if (kw.startsWith("XML:com.adobe.xmp")) r.xmp = true;
    } else if (type === "eXIf") { c.keep = false; r.exif = parseTiff(b, p + 8, p + 8 + len); }
    else if (type === "tIME") { c.keep = false; r.time = true; }
    else if (type === "iCCP") r.icc = true;
    r.chunks.push(c);
    p += 12 + len;
    if (type === "IEND") { r.trailing = b.length - p; break; }
  }
  if (!r.chunks.length || r.chunks[r.chunks.length - 1].type !== "IEND") throw damaged(name);
  return r;
}

function scanWebp(b, name) {
  const r = { kind: "webp", chunks: [], exif: null, xmp: false, icc: false, hasVp8x: false };
  const total = Math.min(b.length, 8 + u32le(b, 4));
  let p = 12;
  while (p + 8 <= total) {
    const type = ascii(b, p, p + 4);
    const size = u32le(b, p + 4);
    const end = p + 8 + size + (size & 1);
    if (p + 8 + size > b.length) throw damaged(name);
    const c = { type, start: p, end: Math.min(end, b.length), keep: true };
    if (type === "VP8X") r.hasVp8x = true;
    else if (type === "EXIF") {
      c.keep = false;
      let d = p + 8;
      if (ascii(b, d, d + 6) === "Exif\0\0") d += 6;
      r.exif = parseTiff(b, d, p + 8 + size);
    } else if (type === "XMP ") { c.keep = false; r.xmp = true; }
    else if (type === "ICCP") r.icc = true;
    r.chunks.push(c);
    p = end;
  }
  return r;
}

/* ------------------------------------------------------------------ strippers (lossless) */

function wantOrientation(scan) {
  const o = scan.exif && scan.exif.orientation;
  return keepOrient.checked && o >= 2 && o <= 8 ? o : 0;
}

function stripJpeg(b, scan) {
  const kept = scan.segs.filter((s) => s.keep).map((s) => b.subarray(s.start, s.end));
  const o = wantOrientation(scan);
  if (o) {
    const tiff = minimalTiff(o);
    const seg = new Uint8Array(4 + 6 + tiff.length);
    seg.set([0xff, 0xe1, 0, 2 + 6 + tiff.length]);
    seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
    seg.set(tiff, 10);
    const at = scan.segs.length && scan.segs[0].keep && scan.segs[0].kind === "jfif" ? 1 : 0;
    kept.splice(at, 0, seg);
  }
  return concatBytes([new Uint8Array([0xff, 0xd8]), ...kept, b.subarray(scan.sos, scan.eoi || b.length)]);
}

function pngChunkBytes(type, data) {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function stripPng(b, scan) {
  const parts = [b.subarray(0, 8)];
  const o = wantOrientation(scan);
  let placed = !o;
  for (const c of scan.chunks) {
    if (!placed && c.type === "IDAT") { parts.push(pngChunkBytes("eXIf", minimalTiff(o))); placed = true; }
    if (c.keep) parts.push(b.subarray(c.start, c.end));
  }
  return concatBytes(parts);
}

function stripWebp(b, scan) {
  const o = wantOrientation(scan) && scan.hasVp8x ? wantOrientation(scan) : 0;
  const parts = [];
  for (const c of scan.chunks) {
    if (!c.keep) continue;
    let bytes = b.subarray(c.start, c.end);
    if (c.type === "VP8X") {
      bytes = bytes.slice();
      bytes[8] &= ~(0x08 | 0x04); // EXIF and XMP flags off
      if (o) bytes[8] |= 0x08;
    }
    parts.push(bytes);
  }
  if (o) {
    const tiff = minimalTiff(o);
    const chunk = new Uint8Array(8 + tiff.length);
    chunk.set([0x45, 0x58, 0x49, 0x46]);
    new DataView(chunk.buffer).setUint32(4, tiff.length, true);
    chunk.set(tiff, 8);
    parts.push(chunk);
  }
  const body = concatBytes(parts);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  return concatBytes([head, body]);
}

/* ------------------------------------------------------------------ report */

function dateText(s) {
  const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d:\d\d(?::\d\d)?)/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : s;
}

function buildReport(scan, type) {
  const rows = [];
  const flags = [];
  const kept = [];
  const e = scan && scan.exif;
  if (e && e.gps) rows.push({ k: tx("Location (GPS)"), v: `${e.gps.lat.toFixed(6)}, ${e.gps.lon.toFixed(6)}`, flag: true });
  else if (e && e.gpsPresent) rows.push({ k: tx("Location (GPS)"), v: tx("GPS block present, no coordinates"), flag: true });
  if (e) {
    const cam = [e.make, e.model].filter(Boolean).join(" ");
    if (cam) rows.push({ k: tx("Camera"), v: cam });
    if (e.lens) rows.push({ k: tx("Lens"), v: e.lens });
    if (e.date) rows.push({ k: tx("Date taken"), v: dateText(e.date) });
    if (e.software) rows.push({ k: tx("Software"), v: e.software });
    if (e.artist) rows.push({ k: tx("Artist"), v: e.artist });
    if (e.copyright) rows.push({ k: tx("Copyright"), v: e.copyright });
    if (e.orientation !== 1) rows.push({ k: tx("Orientation"), v: `${ORIENTATION[e.orientation] || tx("Value {n}", { n: e.orientation })} (${e.orientation})` });
    if (e.other) rows.push({ k: tx("Other EXIF"), v: txn(e.other, "{n} other tag", "{n} other tags") });
    if (e.thumbnail) flags.push(tx("Embedded thumbnail"));
  }
  if (scan && scan.xmp) flags.push(tx("XMP present"));
  if (scan && scan.iptc) flags.push(tx("IPTC present"));
  if (scan && scan.kind === "png") {
    if (scan.texts.length) rows.push({ k: tx("PNG text chunks"), v: [...new Set(scan.texts)].slice(0, 6).join(", ") + (scan.texts.length > 6 ? ", …" : "") });
    if (scan.exif) flags.push(tx("eXIf chunk"));
    if (scan.time) flags.push(tx("Modification time (tIME)"));
  }
  if (scan && scan.kind === "jpeg") {
    if (scan.comments) flags.push(txn(scan.comments, "{n} comment", "{n} comments"));
    if (scan.otherApp) flags.push(txn(scan.otherApp, "{n} other application block", "{n} other application blocks"));
  }
  if (scan && scan.trailing) flags.push(tx("{size} of extra data after the image", { size: fmtBytes(scan.trailing) }));
  if (scan && scan.icc) kept.push(tx("ICC colour profile present (kept)"));
  return { rows, flags, kept, any: rows.length > 0 || flags.length > 0, type, reencode: !scan };
}

async function analyse(item) {
  const bytes = new Uint8Array(await item.file.arrayBuffer());
  const type = item.info.type;
  let scan = null;
  if (type === "jpeg") scan = scanJpeg(bytes, item.file.name);
  else if (type === "png") scan = scanPng(bytes, item.file.name);
  else if (type === "webp") scan = scanWebp(bytes, item.file.name);
  item.scan = scan;
  item.report = buildReport(scan, type);
}

function detail(item) {
  const r = item.report;
  if (!r) return null;
  const box = el("div", { class: "exif" });
  if (r.reencode) {
    box.append(el("p", { class: "exif__none" }, item.info.type === "gif"
      ? tx("{format} files can't be cleaned in place here. The image will be re-drawn and saved as PNG, which carries no EXIF or text metadata (only the first frame of a GIF is kept).", { format: LABEL[item.info.type] })
      : tx("{format} files can't be cleaned in place here. The image will be re-drawn and saved as PNG, which carries no EXIF or text metadata.", { format: LABEL[item.info.type] })));
    return box;
  }
  if (!r.any) box.append(el("p", { class: "exif__none" }, tx("No EXIF, XMP, IPTC or text metadata found. The file will be saved as an unchanged copy.")));
  if (r.rows.length) {
    const dl = el("dl", { class: "exif__rows" });
    for (const row of r.rows) dl.append(el("div", { class: row.flag ? "is-flag" : null }, el("dt", {}, row.k), el("dd", {}, row.v)));
    box.append(dl);
  }
  const tags = [...r.flags, ...r.kept];
  if (tags.length) box.append(el("ul", { class: "exif__flags" }, tags.map((t) => el("li", {}, t))));
  return box;
}

/* ------------------------------------------------------------------ tool */

const mimeOf = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Cleaning"), zipName: "clean-images.zip",
  analyse,
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  detail,
  summaryText: (items) => {
    const gps = items.filter((i) => i.report && i.report.rows.some((r) => r.flag)).length;
    return txn(items.length, "{n} image", "{n} images") + (gps ? " · " + tx("{n} with a location", { n: fmtNum(gps) }) : "");
  },
  async process(item) {
    const type = item.info.type;
    if (!item.scan) {
      const bmp = await decode(item.file);
      const canvas = newCanvas(bmp.width, bmp.height);
      ctx2d(canvas).drawImage(bmp, 0, 0);
      bmp.close();
      try {
        const blob = await encodeCanvas(canvas, "png");
        return { blob, name: baseName(item.file.name) + "-clean.png", reencoded: true, note: tx("re-encoded as PNG · {size}", { size: fmtBytes(blob.size) }) };
      } finally { release(canvas); }
    }
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const out = type === "jpeg" ? stripJpeg(bytes, item.scan) : type === "png" ? stripPng(bytes, item.scan) : stripWebp(bytes, item.scan);
    // verify the result: nothing identifying may remain
    const check = type === "jpeg" ? scanJpeg(out, item.file.name) : type === "png" ? scanPng(out, item.file.name) : scanWebp(out, item.file.name);
    if (check.xmp || (check.exif && (check.exif.gps || check.exif.gpsPresent || check.exif.make || check.exif.model)) || (check.texts && check.texts.length) || check.iptc) {
      throw new UserError(tx("\"{name}\" could not be cleaned safely, so no file was produced.", { name: item.file.name }));
    }
    const ext = extOf(item.file.name) || (type === "jpeg" ? "jpg" : type);
    const removed = bytes.length - out.length;
    const kept = wantOrientation(item.scan) ? " · " + tx("orientation kept") : "";
    return {
      blob: new Blob([out], { type: mimeOf[type] }),
      name: `${baseName(item.file.name)}-clean.${ext}`,
      note: (removed > 0 ? tx("{size} removed", { size: fmtBytes(removed) }) : tx("nothing to remove")) + kept,
    };
  },
  doneText: (outputs) => txn(outputs.length, "Metadata removed from {n} image. The pixels were not re-encoded.", "Metadata removed from {n} images. The pixels were not re-encoded."),
  resultNote: (outputs) => outputs.some((o) => o.reencoded) ? tx("Files marked re-encoded were redrawn and saved as PNG; the others keep their original image data.") : null,
});
