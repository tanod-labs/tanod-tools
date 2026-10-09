// E-invoice viewers: from the bytes of a file to the normalized invoice model. Works out what the file is (XML, signed
// .p7m, or a PDF whose XML attachment the page extracts), refuses a DOCTYPE before parsing, parses with the browser's own
// DOMParser, recognises the format from the root element, and hands the XML to the matching reader.
// Nothing is sent anywhere; no translated text here (failures are InvoiceError codes).
import {
  LIMITS, InvoiceError, decodeBytes, assertSafeXml, lname, childs, resetHidden, hiddenCount, attr,
} from "./einvoicecore.js?v=11";
import { fromUbl } from "./einvoiceubl.js?v=11";
import { fromCii } from "./einvoicecii.js?v=11";
import { fromFatturaPA } from "./einvoiceit.js?v=11";
import { fromKsef } from "./einvoicepl.js?v=11";
import { fromVietnam, findInvoice } from "./einvoicevn.js?v=11";
import { fromCfdi, isCfdi } from "./einvoicecfdi.js?v=11";
import { unwrapP7m, looksLikeP7m } from "./p7mcore.js?v=11";

/* The pages: tool slug of each viewer (the page for a format is suggested from these). */
export const VIEWER_SLUGS = {
  xrechnung: "xrechnung-viewer",
  zugferd: "zugferd-factur-x-viewer",
  fatturapa: "fatturapa-viewer",
  ksef: "ksef-viewer",
  peppol: "peppol-ubl-invoice-viewer",
  efatura: "e-fatura-ubl-tr-viewer",
  vietnam: "vietnam-e-invoice-viewer",
  cfdi: "cfdi-viewer",
};

/* Parse with the browser's DOMParser. Returns the root element. */
export function domParse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const bad = doc.getElementsByTagName("parsererror");
  if (bad.length) {
    const msg = String(bad[0].textContent || "");
    const m = /error on line (\d+) at column (\d+):\s*([^\n]*)/i.exec(msg);
    throw new InvoiceError("malformed", m ? { line: Number(m[1]), column: Number(m[2]), message: m[3].slice(0, 200) } : { message: msg.replace(/\s+/g, " ").slice(0, 200) });
  }
  if (doc.doctype) throw new InvoiceError("doctype");
  if (!doc.documentElement) throw new InvoiceError("malformed", { message: "" });
  return doc.documentElement;
}

/* Which reader a root element needs. Throws "unsupported" for formats that are recognised but not read, "not-invoice" otherwise. */
export function detect(root, depth = 0) {
  const name = lname(root), ns = root.namespaceURI || "";
  if (name === "StandardBusinessDocument" && depth === 0) {
    const inner = Array.from(root.children).find((c) => lname(c) !== "StandardBusinessDocumentHeader");
    if (inner) return detect(inner, 1);
  }
  if (name === "Invoice" || name === "CreditNote") {
    if (/^urn:oasis:names:specification:ubl:schema:xsd:(?:Invoice|CreditNote)-2$/.test(ns) || childs(root, "AccountingSupplierParty").length || childs(root, "CustomizationID").length) {
      return { kind: "ubl", sub: name, el: root };
    }
  }
  if (name === "CrossIndustryInvoice") return { kind: "cii", el: root };
  if (name === "CrossIndustryDocument") throw new InvoiceError("unsupported", { kind: "zugferd1" });
  if (name === "FatturaElettronica") return { kind: "fatturapa", el: root };
  if (name === "FatturaElettronicaSemplificata") throw new InvoiceError("unsupported", { kind: "fsm" });
  if (name === "FakturaRR") throw new InvoiceError("unsupported", { kind: "farr" });
  if (name === "Faktura" && childs(root, "Naglowek").length) {
    const code = childs(childs(root, "Naglowek")[0], "KodFormularza")[0];
    if (/FA\s*\(?\s*1\s*\)?/i.test(attr(code, "kodSystemowy"))) throw new InvoiceError("unsupported", { kind: "fa1" });
    return { kind: "ksef", el: root };
  }
  if (isCfdi(root)) return { kind: "cfdi", el: root };
  if ((name === "HDon" && childs(root, "DLHDon").length) || name === "DLHDon" || name === "TDiep") {
    const hd = findInvoice(root);
    if (hd) return { kind: "vn", el: hd };
  }
  if (/^urn:oasis:names:specification:ubl:schema:xsd:/.test(ns)) throw new InvoiceError("unsupported", { kind: "ubl", name });
  throw new InvoiceError("not-invoice", { name });
}

/* The viewer page that fits an invoice best. */
export function viewerFor(inv) {
  if (inv.format === "fatturapa") return "fatturapa";
  if (inv.format === "ksef") return "ksef";
  if (inv.format === "ubl-tr") return "efatura";
  if (inv.format === "vn-einvoice") return "vietnam";
  if (inv.format === "cfdi") return "cfdi";
  const id = (inv.profile.customizationId || "").toLowerCase();
  if (inv.format === "cii") return id.includes("xrechnung") ? "xrechnung" : "zugferd";
  return id.includes("xrechnung") ? "xrechnung" : "peppol";
}

/* XML text to { format, formatLabel, viewer, invoices: [model, ...], notes: [codes] }. `parseXml(text)` returns the root
   element; the default is the browser's DOMParser (tests pass their own). */
export function parseXmlText(text, opts = {}) {
  if (!text || !text.trim()) throw new InvoiceError("empty");
  if (text.length > LIMITS.fileBytes) throw new InvoiceError("too-large");
  assertSafeXml(text);
  resetHidden();
  let root;
  try {
    root = (opts.parseXml || domParse)(text.replace(/^\s+/, ""));
  } catch (e) {
    if (e && e.name === "InvoiceError") throw e;
    throw new InvoiceError("malformed", { message: String((e && e.message) || e).slice(0, 200) });
  }
  const d = detect(root);
  let invoices;
  if (d.kind === "ubl") invoices = [fromUbl(d.el, d.sub)];
  else if (d.kind === "cii") invoices = [fromCii(d.el)];
  else if (d.kind === "fatturapa") invoices = fromFatturaPA(d.el);
  else if (d.kind === "vn") invoices = [fromVietnam(d.el)];
  else if (d.kind === "cfdi") invoices = [fromCfdi(d.el)];
  else invoices = [fromKsef(d.el)];
  if (!invoices.length) throw new InvoiceError("not-invoice", { name: lname(d.el) });
  for (const inv of invoices) {
    if (inv.linesTotal > inv.lines.length) inv.warnings.push({ code: "linesTruncated", data: { shown: inv.lines.length, total: inv.linesTotal } });
  }
  const first = invoices[0];
  const result = { format: first.format, formatLabel: first.formatLabel, viewer: viewerFor(first), invoices, notes: [] };
  if (first.signature === "seal") result.notes.push("sealNotChecked");
  if (first.signature === "dscks") result.notes.push("dscksNotChecked");
  if (first.signature === "sello") result.notes.push("selloNotChecked");
  if (hiddenCount()) result.notes.push("hiddenChars");
  return result;
}

/* What kind of file this is, from its first bytes: "pdf", "xml", "p7m" or "unknown". */
export function sniff(b) {
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return "xml";
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return "pdf";
  if (b[i] === 0x3c) return "xml";
  if (b[i] === 0x00 && b[i + 1] === 0x3c) return "xml";
  if (looksLikeP7m(b)) return "p7m";
  return "unknown";
}

/* Open the bytes of an XML or .p7m file: { result, xml, container, layers }. PDFs are opened by the page (see pdfCandidates). */
export function openBytes(bytes, opts = {}) {
  if (!bytes.length) throw new InvoiceError("empty");
  if (bytes.length > LIMITS.fileBytes) throw new InvoiceError("too-large");
  const kind = sniff(bytes);
  if (kind === "pdf") throw new InvoiceError("pdf");
  if (kind === "p7m") {
    const { bytes: inner, layers } = unwrapP7m(bytes);
    const xml = decodeBytes(inner);
    const result = parseXmlText(xml, opts);
    result.notes.push("signatureNotChecked");
    return { result, xml, container: "p7m", layers };
  }
  if (kind === "xml") {
    const xml = decodeBytes(bytes);
    return { result: parseXmlText(xml, opts), xml, container: "xml", layers: 0 };
  }
  throw new InvoiceError("not-invoice", { name: "" });
}

const KNOWN_PDF_NAMES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml", "zugferd_invoice.xml", "facturx.xml"];

/* Which embedded files of a PDF to try as the invoice, in order: the names ZUGFeRD and Factur-X use first, then any other
   .xml file. `files` is [{ key, filename }]; returns the keys. */
export function pdfCandidates(files) {
  const xml = files.filter((f) => /\.xml$/i.test(f.filename || ""));
  const known = (f) => KNOWN_PDF_NAMES.indexOf((f.filename || "").toLowerCase());
  return xml
    .map((f, i) => ({ f, i, k: known(f) < 0 ? 99 : known(f) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.f.key);
}
