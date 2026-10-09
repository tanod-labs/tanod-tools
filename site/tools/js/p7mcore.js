// A small BER/DER reader that unwraps the invoice from a signed .p7m file (CMS / PKCS#7 SignedData), the way Italian
// FatturaPA files are signed. It only finds the signed content; it does NOT check the signature, the certificate or
// anything else about who signed. It reads definite and indefinite lengths, constructed OCTET STRINGs in pieces, raw
// DER, base64 text and PEM text, and signatures wrapped in signatures. No DOM; works in Node too.
import { InvoiceError, LIMITS } from "./einvoicecore.js?v=11";

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const MAX_NODES = 200000;
const MAX_DEPTH = 24;
const fail = (reason) => new InvoiceError("p7m", { reason });

/* One BER item: { cls, tag, constructed, start, end, kids } where start..end is the value (for a constructed item,
   `kids` are its items). Reads the item at `pos` and no further than `limit`. */
function readItem(b, pos, limit, st, depth) {
  if (depth > MAX_DEPTH) throw fail("deep");
  if (++st.n > MAX_NODES) throw fail("big");
  if (pos + 2 > limit) throw fail("truncated");
  const first = b[pos++];
  const cls = first >> 6, constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let c, n = 0;
    do {
      if (pos >= limit || ++n > 4) throw fail("tag");
      c = b[pos++];
      tag = tag * 128 + (c & 0x7f);
    } while (c & 0x80);
  }
  if (pos >= limit) throw fail("truncated");
  let len = b[pos++], indefinite = false;
  if (len === 0x80) {
    if (!constructed) throw fail("length");
    indefinite = true;
  } else if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || pos + n > limit) throw fail("length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[pos++];
  }
  const node = { cls, tag, constructed, start: pos, end: pos, kids: null };
  if (!constructed) {
    node.end = pos + len;
    if (node.end > limit) throw fail("truncated");
    return node;
  }
  const kids = [];
  let p = pos;
  if (!indefinite) {
    const end = pos + len;
    if (end > limit) throw fail("truncated");
    while (p < end) {
      const k = readItem(b, p, end, st, depth + 1);
      kids.push(k);
      p = k.end;
    }
    node.end = end;
  } else {
    for (;;) {
      if (p + 2 > limit) throw fail("truncated");
      if (b[p] === 0 && b[p + 1] === 0) { p += 2; break; }
      const k = readItem(b, p, limit, st, depth + 1);
      kids.push(k);
      p = k.end;
    }
    node.end = p;
  }
  node.kids = kids;
  return node;
}

export function parseBer(bytes, pos = 0) {
  return readItem(bytes, pos, bytes.length, { n: 0 }, 0);
}

export function oidOf(b, node) {
  if (node.tag !== 6 || node.end <= node.start) return "";
  const out = [];
  let v = 0;
  for (let i = node.start; i < node.end; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      if (!out.length) out.push(Math.min(2, Math.floor(v / 40)), v - 40 * Math.min(2, Math.floor(v / 40)));
      else out.push(v);
      v = 0;
    }
  }
  return out.join(".");
}

/* The bytes of an OCTET STRING item, joining the pieces of a constructed one. */
function octets(b, node, st = { size: 0 }, depth = 0) {
  if (depth > 8) throw fail("deep");
  if (!node.constructed) {
    st.size += node.end - node.start;
    if (st.size > LIMITS.fileBytes) throw fail("big");
    return [b.subarray(node.start, node.end)];
  }
  const out = [];
  for (const k of node.kids) {
    if (k.tag !== 4 || k.cls !== 0) throw fail("content");
    out.push(...octets(b, k, st, depth + 1));
  }
  return out;
}

function join(parts) {
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* The content signed inside a CMS SignedData given as BER/DER bytes. */
export function cmsContent(der) {
  const root = parseBer(der, 0);
  if (root.tag !== 16 || !root.kids || root.kids.length < 2 || oidOf(der, root.kids[0]) !== OID_SIGNED_DATA) throw fail("notSigned");
  const wrap = root.kids[1];
  if (wrap.cls !== 2 || wrap.tag !== 0 || !wrap.kids || !wrap.kids.length) throw fail("notSigned");
  const sd = wrap.kids[0];
  if (sd.tag !== 16 || !sd.kids || sd.kids.length < 3) throw fail("notSigned");
  const encap = sd.kids[2];
  if (encap.tag !== 16 || !encap.kids) throw fail("notSigned");
  if (encap.kids.length < 2) throw fail("detached");
  const holder = encap.kids[1];
  if (holder.cls !== 2 || holder.tag !== 0 || !holder.kids || !holder.kids.length) throw fail("content");
  const oct = holder.kids[0];
  if (oct.tag !== 4) throw fail("content");
  return join(octets(der, oct));
}

/* Base64 or PEM text to bytes (null when it is neither). */
function fromBase64Text(bytes) {
  let s = "";
  const n = Math.min(bytes.length, LIMITS.fileBytes);
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode(...bytes.subarray(i, Math.min(n, i + 8192)));
  s = s.replace(/-----BEGIN [A-Z0-9 ]+-----/g, "").replace(/-----END [A-Z0-9 ]+-----/g, "").replace(/\s+/g, "");
  if (s.length < 8 || s.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

/* DER bytes of a CMS file whatever it is stored as: raw DER, PEM or base64 text; null when it is none of these. */
export function toDer(bytes) {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x30) return bytes.subarray(i);
  const dec = fromBase64Text(bytes);
  return dec && dec[0] === 0x30 ? dec : null;
}

/* Whether the bytes are a CMS SignedData file (raw, PEM or base64). */
export function looksLikeP7m(bytes) {
  const der = toDer(bytes);
  if (!der) return false;
  try {
    const root = parseBer(der, 0);
    return root.tag === 16 && !!root.kids && root.kids.length >= 2 && oidOf(der, root.kids[0]) === OID_SIGNED_DATA;
  } catch (_) {
    return false;
  }
}

const startsLikeXml = (b) => {
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  return b[i] === 0x3c;
};

/* The invoice inside a signed .p7m file: { bytes, layers } where layers counts the signatures that wrapped it. Throws
   InvoiceError("p7m", { reason }) when the file is not a signed file with its content inside. */
export function unwrapP7m(bytes) {
  let data = toDer(bytes);
  if (!data) throw fail("notSigned");
  let layers = 0;
  for (;;) {
    let content = cmsContent(data);
    layers++;
    if (!content.length) throw fail("content");
    if (!startsLikeXml(content)) {
      const text = fromBase64Text(content);
      if (text && (text[0] === 0x30 || startsLikeXml(text))) content = text;
    }
    if (content[0] === 0x30 && layers < 6) { data = content; continue; }
    return { bytes: content, layers };
  }
}
