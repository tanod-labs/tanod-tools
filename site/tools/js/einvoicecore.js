// E-invoice viewers, shared parts: limits, errors, reading bytes as text, the DOCTYPE guard, small XML helpers, decimal
// arithmetic, dates, cleaning of displayed text, file names, the normalized invoice model and its JSON export.
// No DOM and no translated text in this file (messages are codes; the page turns them into words), so it runs in Node too.
// Nothing here sends anything anywhere. The format readers (einvoiceubl.js, einvoicecii.js, einvoiceit.js,
// einvoicepl.js) fill the model defined here; einvoiceparse.js picks the reader.

export const LIMITS = {
  fileBytes: 25 * 1024 * 1024,   // largest file opened (an XML file, a PDF or a .p7m)
  lines: 5000,                   // line items read and shown; the rest are counted, not read
  invoices: 200,                 // invoices read from one FatturaPA file (a file can hold a batch)
  list: 200,                     // notes, references, VAT rows and similar lists
  attachments: 50,
  rawChars: 400000,              // characters of XML shown in the raw view
  depth: 64,                     // nesting followed when reading a PDF's or a signature's structure
};

export class InvoiceError extends Error {
  /* code: "empty" | "too-large" | "doctype" | "malformed" | "not-invoice" | "unsupported" | "no-xml" | "p7m" | ...; data: details for the message */
  constructor(code, data = {}) {
    super(code);
    this.name = "InvoiceError";
    this.code = code;
    this.data = data;
  }
}

/* ------------------------------------------------------------------ bytes to text */

const utf8 = () => new TextDecoder("utf-8");

/* Read the bytes of an XML file as text: byte-order marks, UTF-16 without a mark, and the encoding named in the XML
   declaration (ISO-8859-1, windows-1252 and so on) are honoured; anything else is read as UTF-8. */
export function decodeBytes(bytes) {
  const b = bytes;
  let text;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = utf8().decode(b.subarray(3));
  else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder("utf-16le").decode(b.subarray(2));
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder("utf-16be").decode(b.subarray(2));
  else if (b.length >= 4 && b[0] === 0x3c && b[1] === 0x00 && b[2] === 0x3f && b[3] === 0x00) text = new TextDecoder("utf-16le").decode(b);
  else if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x3c && b[2] === 0x00 && b[3] === 0x3f) text = new TextDecoder("utf-16be").decode(b);
  else {
    let head = "";
    for (let i = 0; i < Math.min(b.length, 300); i++) head += String.fromCharCode(b[i]);
    const m = /^\s*<\?xml[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head);
    const label = m ? m[1].toLowerCase() : "utf-8";
    let dec;
    try { dec = /^utf-?(16|32)/.test(label) ? utf8() : new TextDecoder(label); } catch (_) { dec = utf8(); }
    text = dec.decode(b);
  }
  return text.replace(/^﻿/, "");
}

/* Refuse a document that declares a DOCTYPE or entities, before anything parses it. Entities are how an XML file can
   read local files or blow up in memory; invoices never need them. Checked on the decoded text, which is exactly what
   the parser is given. */
export function assertSafeXml(text) {
  if (/<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(text)) throw new InvoiceError("doctype");
}

/* ------------------------------------------------------------------ XML helpers (work on DOM elements and on the test shim) */

export const lname = (e) => {
  if (e.localName) return e.localName;
  const n = e.nodeName || "";
  const i = n.indexOf(":");
  return i < 0 ? n : n.slice(i + 1);
};

export function kids(e) { return e ? Array.from(e.children) : []; }

/* First child element with this local name. */
export function child(e, name) {
  if (!e) return null;
  for (const c of e.children) if (lname(c) === name) return c;
  return null;
}

/* All child elements with this local name. */
export function childs(e, name) {
  if (!e) return [];
  const out = [];
  for (const c of e.children) if (lname(c) === name) out.push(c);
  return out;
}

/* All elements at the end of a "a/b/c" path of local names, fanning out at every step. */
export function all(e, path) {
  let cur = e ? [e] : [];
  for (const step of path.split("/")) {
    const next = [];
    for (const x of cur) for (const c of x.children) if (lname(c) === step) next.push(c);
    cur = next;
    if (!cur.length) break;
  }
  return cur;
}

/* First element at the end of a path. */
export function one(e, path) { return all(e, path)[0] || null; }

/* Characters that hide or reorder text on screen (direction overrides and isolates), and control characters. */
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g;
const state = { hidden: 0 };
export const hiddenCount = () => state.hidden;
export const resetHidden = () => { state.hidden = 0; };

/* Text for display: control characters and direction overrides removed (counted), whitespace collapsed. */
export function clean(s) {
  s = String(s ?? "");
  if (HIDDEN.test(s)) { state.hidden++; HIDDEN.lastIndex = 0; s = s.replace(HIDDEN, ""); }
  HIDDEN.lastIndex = 0;
  return s.replace(/\s+/g, " ").trim();
}

/* Like clean, but keeps line breaks (notes, descriptions). */
export function cleanBlock(s) {
  s = String(s ?? "");
  if (HIDDEN.test(s)) { state.hidden++; HIDDEN.lastIndex = 0; s = s.replace(HIDDEN, ""); }
  HIDDEN.lastIndex = 0;
  return s.replace(/\r\n?/g, "\n").replace(/[ \t\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const text = (e) => (e ? clean(e.textContent) : "");
export const block = (e) => (e ? cleanBlock(e.textContent) : "");
/* Text of the first element at a path ("" when there is none). */
export const t = (e, path) => text(one(e, path));
export const tb = (e, path) => block(one(e, path));
/* An attribute by name, "" when missing. */
export function attr(e, name) {
  if (!e) return "";
  const v = e.getAttribute ? e.getAttribute(name) : null;
  return v == null ? "" : clean(v);
}
/* Raw text, no cleaning (base64 payloads). */
export const raw = (e) => (e ? String(e.textContent) : "");

/* ------------------------------------------------------------------ decimals (strings in, strings out, exact) */

const DEC = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/* A decimal number as written: "+5" -> "5", ".5" -> "0.5", "5." -> "5". Anything else comes back trimmed and unchanged. */
export function dec(s) {
  s = String(s ?? "").trim();
  const m = DEC.exec(s);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) return s;
  const sign = m[1] === "-" ? "-" : "";
  const int = m[2] === "" ? "0" : m[2].replace(/^0+(?=\d)/, "");
  const frac = m[3] || "";
  return sign + int + (frac ? "." + frac : "");
}

export const isDec = (s) => { const m = DEC.exec(String(s ?? "").trim()); return !!m && !(m[2] === "" && !m[3]); };

/* "19.00" -> "19", "5.50" -> "5.5": for rates. */
export function trimZeros(s) {
  s = dec(s);
  return isDec(s) && s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/* A unit price as written, with zeros beyond the second decimal dropped: "60.00000000" -> "60.00", "12.5000" -> "12.50"; "0.0125" stays. */
export function price(s) {
  s = dec(s);
  if (!isDec(s) || !s.includes(".")) return s;
  const [int, frac] = s.split(".");
  return int + "." + frac.replace(/0+$/, "").padEnd(2, "0");
}

/* A quantity as written, without trailing zeros: "8.00000000" -> "8", "1.50" -> "1.5". */
export const qty = (s) => trimZeros(s);

function toBig(s) {
  const m = DEC.exec(String(s).trim());
  if (!m || (m[2] === "" && !m[3])) return null;
  const frac = m[3] || "";
  return { n: BigInt((m[1] === "-" ? "-" : "") + (m[2] || "0") + frac), scale: frac.length };
}

/* Exact sum of decimal strings; entries that are not numbers are skipped. "" when nothing was added. */
export function sumDec(list) {
  let n = 0n, scale = 0, any = false;
  for (const s of list) {
    const d = toBig(s);
    if (!d) continue;
    any = true;
    if (d.scale > scale) { n *= 10n ** BigInt(d.scale - scale); scale = d.scale; }
    n += d.n * 10n ** BigInt(scale - d.scale);
  }
  if (!any) return "";
  const neg = n < 0n;
  let digits = (neg ? -n : n).toString();
  if (scale) {
    digits = digits.padStart(scale + 1, "0");
    digits = digits.slice(0, -scale) + "." + digits.slice(-scale);
  }
  return (neg ? "-" : "") + digits;
}

/* Exact comparison of two decimal strings: -1, 0, 1, or null when either is not a number. */
export function cmpDec(a, b) {
  const x = toBig(a), y = toBig(b);
  if (!x || !y) return null;
  const s = Math.max(x.scale, y.scale);
  const p = x.n * 10n ** BigInt(s - x.scale), q = y.n * 10n ** BigInt(s - y.scale);
  return p < q ? -1 : p > q ? 1 : 0;
}

/* The same number with a flipped sign ("" stays ""). */
export function negDec(s) {
  s = dec(s);
  if (!isDec(s) || /^[+-]?0*\.?0*$/.test(s)) return s;
  return s.startsWith("-") ? s.slice(1) : "-" + s;
}

/* ------------------------------------------------------------------ dates */

/* An ISO date (YYYY-MM-DD) from the forms invoices use: 2024-03-01, 2024-03-01+01:00, 2024-03-01T10:00:00Z, 20240301,
   20240301103000 (CII formats 102, 203, 204). A month alone (CII 610) gives YYYY-MM. Anything else comes back as written. */
export function isoDate(s, format = "") {
  s = String(s ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T +\-Z])/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (format === "610" && (m = /^(\d{4})(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}`;
  if ((m = /^(\d{4})(\d{2})(\d{2})(?:\d{4,6})?$/.exec(s)) && (!format || ["102", "203", "204"].includes(format))) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

/* ------------------------------------------------------------------ names */

/* A safe name for a file the visitor will download: no path, no characters Windows refuses, no direction overrides, no
   leading or trailing dots or spaces, no reserved device names, at most 100 characters (the extension is kept). */
export function safeFileName(name, fallback = "attachment") {
  let n = String(name ?? "").normalize("NFC");
  n = n.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "");
  n = n.split(/[\\/]+/).pop();
  n = n.replace(/[<>:"|?*]/g, "_").replace(/\s+/g, " ").trim();
  n = n.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(n)) n = "_" + n;
  if (n.length > 100) {
    const m = /(\.[A-Za-z0-9]{1,10})$/.exec(n);
    const ext = m ? m[1] : "";
    n = n.slice(0, 100 - ext.length) + ext;
  }
  return n || fallback;
}

/* The size in bytes of a base64 text, without decoding it. */
export function base64Size(b64) {
  let len = 0, pad = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) continue;
    len++;
    if (c === 61) pad++;
  }
  return Math.max(0, Math.floor(len * 3 / 4) - pad);
}

/* Bytes of a base64 text (whitespace allowed). Null when it is not base64. */
export function base64Bytes(b64) {
  const s = String(b64).replace(/\s+/g, "");
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ the normalized model */

export const blankAddress = () => ({ street: "", street2: "", street3: "", postalCode: "", city: "", region: "", countryCode: "" });
export const blankContact = () => ({ name: "", phone: "", email: "" });
export const blankParty = () => ({
  name: "", tradingName: "", ids: [], legalId: null, vatId: "", taxId: "", legalForm: "", endpoint: null,
  address: blankAddress(), contact: blankContact(), taxOffice: "",
});
export const blankLine = () => ({
  id: "", note: "", name: "", description: "", quantity: "", unit: "", unitPrice: "", priceBaseQuantity: "", netAmount: "",
  vat: { category: "", rate: "", native: "" },
  sellerItemId: "", buyerItemId: "", standardItemId: null, classifications: [], originCountry: "",
  period: { start: "", end: "" }, orderLineRef: "", allowances: [], charges: [], priceDiscount: null, properties: [], before: false,
});
export const blankInvoice = () => ({
  format: "", formatLabel: "", profile: { customizationId: "", profileId: "", name: "" },
  type: "invoice", typeCode: "", typeNative: "",
  number: "", issueDate: "", dueDate: "", taxPointDate: "", deliveryDate: "", period: { start: "", end: "" },
  currency: "", taxCurrency: "", buyerReference: "",
  references: { order: "", salesOrder: "", contract: "", project: "", despatchAdvice: "", receiptAdvice: "", tender: "", invoicedObject: "", accounting: "", preceding: [] },
  notes: [],
  seller: blankParty(), buyer: blankParty(), payee: null, taxRepresentative: null, delivery: null,
  lines: [], linesTotal: 0,
  allowances: [], charges: [],
  totals: { lineNet: "", allowances: "", charges: "", taxExclusive: "", tax: "", taxInclusive: "", prepaid: "", rounding: "", payable: "", taxInTaxCurrency: "" },
  vatBreakdown: [],
  markings: [],
  payment: { meansCode: "", meansNative: "", meansText: "", reference: "", terms: "", dueDate: "", paid: false, paidDate: "", accounts: [], card: null, directDebit: null, instalments: [] },
  attachments: [],
  extra: [],
  warnings: [],
  codes: [],                 // identifying codes shown with the header: [{ key, value }] (UUID / ETTN, invoice symbol, tax authority code)
  withholding: [], withholdingTotal: "",   // withheld tax (Turkish tevkifat): [{ name, code, percent, taxable, amount }]
  signature: "",             // "seal" (Turkish mali muhur), "dscks" (Vietnamese digital signature) or "sello" (Mexican CFDI seal and SAT stamp) when the file carries one; never verified
  links: [],                 // plain links the page offers for the visitor to click, never fetched: [{ key, url }] (the SAT verification page of a CFDI)
});

/* Semantic document type from the codes used in the formats. */
const TYPE_BY_CODE = {
  "380": "invoice", "326": "invoice", "393": "invoice", "751": "invoice", "82": "invoice", "395": "invoice",
  "381": "creditNote", "396": "creditNote", "261": "creditNote", "81": "creditNote", "83": "creditNote",
  "383": "debitNote", "80": "debitNote", "84": "debitNote",
  "384": "correction", "385": "correction",
  "389": "selfBilled", "386": "prepayment", "875": "prepayment", "876": "prepayment", "877": "prepayment",
};
export const typeOfCode = (code) => TYPE_BY_CODE[String(code).trim()] || "invoice";

/* A readable profile name from the customization and profile identifiers of UBL and CII invoices. */
export function profileName(customizationId, profileId = "") {
  const c = String(customizationId || "").toLowerCase();
  let m;
  if (c.includes("xrechnung")) return "XRechnung" + ((m = /xrechnung[_-]?(\d+\.\d+)/.exec(c)) ? " " + m[1] : "") + (c.includes("extension") ? " (extension)" : "");
  if (c.includes("peppol.eu:2017:poacc:billing:3.0")) return "Peppol BIS Billing 3.0";
  if (c.includes("peppol")) return "Peppol";
  if (c.includes("factur-x.eu") || c.includes("facturx")) {
    const lvl = /1p0:([a-z0-9]+)/.exec(c);
    const names = { minimum: "MINIMUM", basicwl: "BASIC WL", basic: "BASIC", extended: "EXTENDED" };
    return "Factur-X " + (lvl ? names[lvl[1]] || lvl[1].toUpperCase() : "EN 16931");
  }
  if (c.includes("zugferd")) {
    const lvl = /(?:2p\d|1p0):([a-z0-9]+)/.exec(c);
    const names = { minimum: "MINIMUM", basicwl: "BASIC WL", basic: "BASIC", comfort: "EN 16931", extended: "EXTENDED" };
    return "ZUGFeRD " + (lvl ? names[lvl[1]] || lvl[1].toUpperCase() : "EN 16931");
  }
  if (c.includes("nlcius")) return "NLCIUS";
  if (c.includes("cius-ro")) return "CIUS-RO";
  if (c.includes("en16931")) return "EN 16931";
  return String(customizationId || "").slice(0, 80);
}

/* Whether a string looks like an IBAN. */
export const looksLikeIban = (s) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(String(s).replace(/\s+/g, "").toUpperCase());

/* ------------------------------------------------------------------ export and display text */

/* The JSON of the result: format, source and the invoices, with the embedded files' contents left out (name, type and
   size stay). Plain data: amounts are strings with the exact decimals of the invoice. */
export function exportJson(result, source = {}) {
  const invoices = result.invoices.map((inv) => ({
    ...inv,
    attachments: inv.attachments.map(({ base64, ...rest }) => rest),
  }));
  return JSON.stringify({
    generator: "Tanod Tools e-invoice viewer",
    note: "Normalized from the invoice file in the browser; fields follow the EN 16931 business terms. Amounts are strings with the exact decimals of the source.",
    source: { ...source, format: result.format, formatLabel: result.formatLabel },
    invoices,
  }, null, 2);
}

/* XML text re-indented for reading, cut at `limit` characters. Long base64 runs (embedded files) are shortened. The
   text is only ever shown with textContent. */
export function prettyXml(src, limit = LIMITS.rawChars) {
  let s = String(src);
  let cut = false;
  s = s.replace(/>\s*[A-Za-z0-9+/=\r\n]{3000,}\s*</g, (m) => `>[${m.replace(/[^A-Za-z0-9+/=]/g, "").length} base64 characters left out]<`);
  if (s.length > limit * 2) { s = s.slice(0, limit * 2); cut = true; }
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[^>]*>|<[^>]*>|[^<]+/g;
  const out = [];
  let depth = 0, open = -1, size = 0, m;
  const push = (line) => { out.push(line); size += line.length + 1; };
  while ((m = re.exec(s)) && size < limit) {
    const tok = m[0];
    const pad = "  ".repeat(Math.min(depth, 40));
    if (tok.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      if (open >= 0 && open === out.length - 1) { out[open] += tok; size += tok.length; } else push("  ".repeat(Math.min(depth, 40)) + tok);
      open = -1;
    } else if (tok.startsWith("<!") || tok.startsWith("<?")) {
      push(pad + tok);
      open = -1;
    } else if (tok[0] === "<") {
      push(pad + tok);
      if (tok.endsWith("/>")) open = -1; else { open = out.length - 1; depth++; }
    } else {
      const body = tok.trim();
      if (!body) continue;
      if (open >= 0 && open === out.length - 1) { out[open] += body; size += body.length; } else push(pad + body);
    }
  }
  if (cut || size >= limit) return { text: out.join("\n"), cut: true };
  return { text: out.join("\n"), cut: false };
}
