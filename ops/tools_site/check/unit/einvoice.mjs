// Unit tests for the e-invoice viewers' engine, run with plain node:
//   node ops/tools_site/check/unit/einvoice.mjs
// einvoicecore (text, decimals, dates, names, export), the four format readers through einvoiceparse (XRechnung/Peppol UBL,
// CII, FatturaPA, KSeF), the .p7m reader (p7mcore) and the refusals (DOCTYPE, malformed, unsupported). The XML comes from
// check/einvoice-fixtures/ (written for this site, not copied). Node has no DOMParser, so the readers get the small test
// parser in xmlshim.mjs; check/tests/einvoice.mjs runs the same fixtures through the real DOMParser in Chromium and
// compares. Reference values are literals worked out from the fixtures, not the code's own output.
import { readFileSync } from "node:fs";
import { parseXmlShim } from "./xmlshim.mjs";
import * as core from "../../../../site/tools/js/einvoicecore.js";
import * as parse from "../../../../site/tools/js/einvoiceparse.js";
import * as p7m from "../../../../site/tools/js/p7mcore.js";
import * as vn from "../../../../site/tools/js/einvoicevn.js";
import * as cfdi from "../../../../site/tools/js/einvoicecfdi.js";

const FX = new URL("../einvoice-fixtures/", import.meta.url);
const bytes = (name) => new Uint8Array(readFileSync(new URL(name, FX)));
const textOf = (name) => readFileSync(new URL(name, FX), "utf8");
const parseXml = parseXmlShim;
const open = (name) => parse.openBytes(bytes(name), { parseXml });
const first = (name) => open(name).result.invoices[0];

let n = 0, bad = 0;
const eq = (a, b, msg) => {
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
};
const ok = (cond, msg) => {
  n++;
  if (!cond) { bad++; console.log(`FAIL ${msg}`); }
};
const codeOf = (fn) => {
  try { fn(); return "(no error)"; } catch (e) { return e && e.code ? e.code : "(" + (e && e.message) + ")"; }
};
const errOf = (fn) => {
  try { fn(); return null; } catch (e) { return e; }
};

/* every figure on an invoice adds up, so the fixtures are self-consistent and the reader did not lose a line or a row */
function consistent(inv, label) {
  const sum = core.sumDec;
  if (inv.totals.lineNet && inv.lines.length === inv.linesTotal && !inv.lines.some((l) => l.before)) eq(sum(inv.lines.map((l) => l.netAmount)), inv.totals.lineNet, label + ": line amounts add up to the line total");
  if (inv.vatBreakdown.length && inv.totals.taxExclusive) eq(sum(inv.vatBreakdown.map((v) => v.taxable)), inv.totals.taxExclusive, label + ": VAT bases add up to the total without VAT");
  if (inv.vatBreakdown.length && inv.totals.tax) eq(sum(inv.vatBreakdown.map((v) => v.tax)), inv.totals.tax, label + ": VAT rows add up to the VAT total");
  if (inv.totals.taxExclusive && inv.totals.tax && inv.totals.taxInclusive) eq(sum([inv.totals.taxExclusive, inv.totals.tax]), inv.totals.taxInclusive, label + ": net + VAT = gross");
}

/* ------------------------------------------------------------------ decimals, dates, names, text */
{
  eq(core.dec("+5"), "5", "dec drops a plus sign");
  eq(core.dec(".5"), "0.5", "dec adds the leading zero");
  eq(core.dec("5."), "5", "dec drops a bare point");
  eq(core.dec("007.50"), "7.50", "dec drops leading zeros, keeps decimals");
  eq(core.dec(" 12.340 "), "12.340", "dec trims and keeps trailing zeros");
  eq(core.dec("-0.5"), "-0.5", "dec keeps a minus");
  eq(core.dec("abc"), "abc", "dec leaves a non-number as written");
  eq(core.dec(""), "", "dec of nothing");
  eq(core.isDec("1.5") && core.isDec("-2") && !core.isDec("1,5") && !core.isDec("") && !core.isDec("."), true, "isDec");
  eq(core.trimZeros("19.00"), "19", "trimZeros 19.00");
  eq(core.trimZeros("5.50"), "5.5", "trimZeros 5.50");
  eq(core.trimZeros("100"), "100", "trimZeros leaves integers (no zeros eaten)");
  eq(core.price("60.00000000"), "60.00", "price keeps two decimals");
  eq(core.price("12.5000"), "12.50", "price pads to two");
  eq(core.price("0.0125"), "0.0125", "price keeps real decimals");
  eq(core.price("7"), "7", "price of an integer");
  eq(core.qty("8.00000000"), "8", "qty trims zeros");
  eq(core.sumDec(["1.10", "2.205", "-0.3"]), "3.005", "sumDec is exact");
  eq(core.sumDec(["0.1", "0.2"]), "0.3", "sumDec has no float error");
  eq(core.sumDec(["x", ""]), "", "sumDec of nothing numeric");
  eq(core.sumDec(["-1.5", "1.5"]), "0.0", "sumDec to zero keeps the scale");
  eq(core.sumDec(["99999999999999999999.99", "0.01"]), "100000000000000000000.00", "sumDec beyond float precision");
  eq([core.cmpDec("1.0", "1"), core.cmpDec("2", "10"), core.cmpDec("-1", "-2"), core.cmpDec("a", "1")], [0, -1, 1, null], "cmpDec");
  eq([core.negDec("5.00"), core.negDec("-5.00"), core.negDec("0.00"), core.negDec("")], ["-5.00", "5.00", "0.00", ""], "negDec");

  eq(core.isoDate("2024-03-01"), "2024-03-01", "ISO date");
  eq(core.isoDate("2024-03-01+01:00"), "2024-03-01", "date with a zone");
  eq(core.isoDate("2024-03-01T10:15:00Z"), "2024-03-01", "date and time");
  eq(core.isoDate("20240301"), "2024-03-01", "CII 102");
  eq(core.isoDate("20240301103000", "204"), "2024-03-01", "CII 204");
  eq(core.isoDate("202403", "610"), "2024-03", "CII 610 month");
  eq(core.isoDate("1 March"), "1 March", "unknown date forms are kept");
  eq(core.isoDate(""), "", "no date");

  eq(core.safeFileName("../../etc/cron.d/evil.exe"), "evil.exe", "no path");
  eq(core.safeFileName("C:\\Windows\\System32\\con.txt"), "_con.txt", "windows path and a reserved device name");
  eq(core.safeFileName("invoice\u202Efdp.exe"), "invoicefdp.exe", "direction override removed (the real extension shows)");
  eq(core.safeFileName("<script>alert(1)</script>.html"), "script_.html", "markup characters");
  eq(core.safeFileName("a:b*c?d\"e|f.txt"), "a_b_c_d_e_f.txt", "characters Windows refuses");
  eq(core.safeFileName("x".repeat(300) + ".pdf").length, 100, "long names cut to 100");
  ok(core.safeFileName("x".repeat(300) + ".pdf").endsWith(".pdf"), "long names keep the extension");
  eq(core.safeFileName(""), "attachment", "empty name");
  eq(core.safeFileName("   "), "attachment", "blank name");
  eq(core.safeFileName("...hidden.txt"), "hidden.txt", "leading dots");
  eq(core.safeFileName("report. "), "report", "trailing dots and spaces");
  eq(core.safeFileName("NUL"), "_NUL", "bare device name");
  eq(core.safeFileName("lpt1.txt"), "_lpt1.txt", "device name with extension");
  eq(core.safeFileName("Rechnung März 2024 – Büro.pdf"), "Rechnung März 2024 – Büro.pdf", "ordinary names with accents are kept");
  eq(core.safeFileName("a\u0000b\u001fc.txt"), "abc.txt", "control characters");
  eq(core.safeFileName(null, "x.bin"), "x.bin", "fallback");

  eq(core.base64Size("TGVpc3R1bmdzbmFjaHdlaXMgRmVicnVhciAyMDI0Cg=="), 31, "base64Size");
  eq(core.base64Size("QQ==\nQQ=="), 2, "base64Size ignores whitespace");
  eq(Array.from(core.base64Bytes("TWFu")), [77, 97, 110], "base64Bytes");
  eq(core.base64Bytes("not base64!"), null, "base64Bytes of junk");
  eq(core.looksLikeIban("DE89 3704 0044 0532 0130 00"), true, "IBAN with spaces");
  eq(core.looksLikeIban("61109010140000071219812874"), false, "a Polish NRB is not an IBAN");

  eq(core.clean("  a \n b\t c  "), "a b c", "clean collapses whitespace");
  eq(core.clean("x\u202Ey\u2066z\u0007"), "xyz", "clean removes direction overrides and controls");
  eq(core.cleanBlock("a  b\r\n\r\n\r\n\r\nc\n d"), "a b\n\nc\nd", "cleanBlock keeps line breaks, caps blank lines");
}

/* ------------------------------------------------------------------ bytes to text */
{
  const enc = new TextEncoder();
  eq(core.decodeBytes(enc.encode("<a>é€</a>")), "<a>é€</a>", "UTF-8");
  eq(core.decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode("<a>é</a>")])), "<a>é</a>", "UTF-8 with a byte-order mark");
  eq(core.decodeBytes(Buffer.from("\ufeff<a>é€</a>", "utf16le")), "<a>é€</a>", "UTF-16 LE with a mark");
  const be = Buffer.from("\ufeff<a>é€</a>", "utf16le"); be.swap16();
  eq(core.decodeBytes(be), "<a>é€</a>", "UTF-16 BE with a mark");
  eq(core.decodeBytes(Buffer.from('<?xml version="1.0"?><a>é</a>', "utf16le")), '<?xml version="1.0"?><a>é</a>', "UTF-16 LE without a mark");
  eq(core.decodeBytes(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>caf\u00e9 \u00e0 \u00f9</a>', "latin1")), '<?xml version="1.0" encoding="ISO-8859-1"?><a>café à ù</a>', "ISO-8859-1 as declared");
  eq(core.decodeBytes(Buffer.from('<?xml version="1.0" encoding="windows-1252"?><a>\u201cq\u201d</a>'.replace("\u201c", "\x93").replace("\u201d", "\x94"), "latin1")), '<?xml version="1.0" encoding="windows-1252"?><a>“q”</a>', "windows-1252 quotes");
  eq(core.decodeBytes(enc.encode('<?xml version="1.0" encoding="no-such-charset"?><a>é</a>')), '<?xml version="1.0" encoding="no-such-charset"?><a>é</a>', "unknown encoding label falls back to UTF-8");
  eq(core.decodeBytes(enc.encode('<?xml version="1.0" encoding="UTF-16"?><a>é</a>')), '<?xml version="1.0" encoding="UTF-16"?><a>é</a>', "UTF-16 named but not used: read as UTF-8");
  eq(core.decodeBytes(bytes("fatturapa-latin1.xml")).includes("per l'attività di marzo, perché più utili."), true, "the latin1 fixture reads correctly");
  eq(codeOf(() => core.assertSafeXml('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')), "doctype", "DOCTYPE refused");
  eq(codeOf(() => core.assertSafeXml("<a/><!ENTITY x 'y'>")), "doctype", "ENTITY refused");
  eq(codeOf(() => core.assertSafeXml("<a><!doctype html></a>")), "doctype", "lower-case doctype refused");
  eq(codeOf(() => core.assertSafeXml("<a>\n<!DOCTYPE\nx></a>")), "doctype", "doctype split over lines refused");
  eq(codeOf(() => core.assertSafeXml('<a b="1"><![CDATA[ <b> ]]><!-- note --></a>')), "(no error)", "CDATA and comments are fine");
  eq(codeOf(() => core.assertSafeXml("<a>&lt;!DOCTYPE&gt; is text</a>")), "(no error)", "escaped text is fine");
}

/* ------------------------------------------------------------------ XRechnung UBL invoice */
{
  const r = open("ubl-invoice-xrechnung.xml");
  const inv = r.result.invoices[0];
  eq([r.container, r.result.format, r.result.viewer, r.result.invoices.length, r.result.notes], ["xml", "ubl-invoice", "xrechnung", 1, []], "UBL: format, viewer, count");
  eq([inv.profile.name, inv.type, inv.typeCode], ["XRechnung 3.0", "invoice", "380"], "UBL: profile and type");
  eq([inv.number, inv.issueDate, inv.dueDate, inv.deliveryDate, inv.currency, inv.buyerReference], ["RE-2024-0042", "2024-03-01", "2024-03-31", "2024-02-29", "EUR", "04011000-12345-34"], "UBL: header facts");
  eq(inv.period, { start: "2024-02-01", end: "2024-02-29" }, "UBL: invoice period");
  eq([inv.references.order, inv.references.contract, inv.references.project, inv.references.despatchAdvice], ["PO-4711", "VTR-2023-17", "PRJ-9", "LS-2024-118"], "UBL: references");
  eq(inv.notes, ["Vielen Dank für Ihren Auftrag."], "UBL: note");
  eq([inv.seller.name, inv.seller.tradingName, inv.seller.vatId, inv.seller.legalId, inv.seller.legalForm],
    ["Beispiel Software GmbH", "Beispiel Software", "DE123456789", { scheme: "", value: "HRB 123456 B" }, "Amtsgericht Charlottenburg, Geschäftsführer: Erika Mustermann"], "UBL: seller identity");
  eq(inv.seller.address, { street: "Musterstraße 12", street2: "Hinterhaus", street3: "", postalCode: "10115", city: "Berlin", region: "", countryCode: "DE" }, "UBL: seller address");
  eq(inv.seller.contact, { name: "Erika Mustermann", phone: "+49 30 1234567", email: "rechnung@beispiel-software.example" }, "UBL: seller contact");
  eq(inv.seller.endpoint, { scheme: "EM", value: "rechnung@beispiel-software.example" }, "UBL: seller endpoint");
  eq([inv.buyer.name, inv.buyer.endpoint, inv.buyer.address.city], ["Stadtverwaltung Musterhausen", { scheme: "0204", value: "04011000-12345-34" }, "Musterhausen"], "UBL: buyer");
  eq(inv.delivery.address.street, "Am Marktplatz 3", "UBL: delivery address");
  eq([inv.payee, inv.taxRepresentative], [null, null], "UBL: no payee or representative");
  eq(inv.lines.length, 3, "UBL: three lines");
  eq(inv.linesTotal, 3, "UBL: lines counted");
  const l1 = inv.lines[0];
  eq([l1.id, l1.name, l1.description, l1.note, l1.quantity, l1.unit, l1.unitPrice, l1.netAmount, l1.vat, l1.sellerItemId, l1.orderLineRef],
    ["1", "Softwareentwicklung", "Entwicklung Modul Schnittstellen", "Schnittstellen zum Fachverfahren", "10", "HUR", "95.00", "950.00", { category: "S", rate: "19", native: "" }, "SW-DEV", "10"], "UBL: line 1");
  eq([inv.lines[2].vat.rate, inv.lines[2].standardItemId, inv.lines[1].unit], ["7", { scheme: "0160", value: "9783000000007" }, "MON"], "UBL: lines 2 and 3");
  eq(inv.allowances.map((a) => [a.reason, a.reasonCode, a.amount, a.vat]), [["Treuerabatt", "95", "100.00", { category: "S", rate: "19" }]], "UBL: allowance");
  eq(inv.charges.map((a) => [a.reason, a.reasonCode, a.amount]), [["Versandkosten", "FC", "10.00"]], "UBL: charge");
  eq(inv.totals, { lineNet: "1358.60", allowances: "100.00", charges: "10.00", taxExclusive: "1268.60", tax: "235.20", taxInclusive: "1503.80", prepaid: "200.00", rounding: "", payable: "1303.80", taxInTaxCurrency: "" }, "UBL: totals");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax]), [["S", "19", "1220.00", "231.80"], ["S", "7", "48.60", "3.40"]], "UBL: VAT breakdown");
  eq([inv.payment.meansCode, inv.payment.reference, inv.payment.terms, inv.payment.dueDate], ["58", "RE-2024-0042", "Zahlbar innerhalb von 30 Tagen ohne Abzug.", "2024-03-31"], "UBL: payment");
  eq(inv.payment.accounts, [{ id: "DE89370400440532013000", name: "Beispiel Software GmbH", bic: "COBADEFFXXX", bank: "" }], "UBL: bank account");
  eq(inv.attachments.length, 1, "UBL: one attachment");
  const att = inv.attachments[0];
  eq([att.id, att.description, att.filename, att.mimeType, att.size, att.uri], ["LN-2024-02", "Leistungsnachweis Februar", "leistungsnachweis.txt", "text/plain", 31, ""], "UBL: attachment facts");
  eq(new TextDecoder().decode(core.base64Bytes(att.base64)), "Leistungsnachweis Februar 2024\n", "UBL: attachment content");
  consistent(inv, "UBL");
  const json = JSON.parse(core.exportJson(r.result, { file: "x.xml" }));
  eq(json.invoices[0].attachments, [{ id: "LN-2024-02", description: "Leistungsnachweis Februar", filename: "leistungsnachweis.txt", mimeType: "text/plain", size: 31, uri: "" }], "JSON: the file's content is left out");
  eq([json.source.file, json.source.format, json.invoices[0].number, json.invoices[0].totals.payable], ["x.xml", "ubl-invoice", "RE-2024-0042", "1303.80"], "JSON: source and model");
  ok(!core.exportJson(r.result).includes("TGVpc3R1bmdz"), "JSON: no base64 payload anywhere");
}

/* ------------------------------------------------------------------ UBL credit notes */
{
  const inv = first("ubl-creditnote-xrechnung.xml");
  eq([inv.format, inv.type, inv.typeCode, inv.number, inv.issueDate], ["ubl-creditnote", "creditNote", "381", "GS-2024-0007", "2024-03-15"], "credit note: identity");
  eq(inv.references.preceding, [{ number: "RE-2024-0042", date: "2024-03-01" }], "credit note: the invoice it corrects");
  eq(inv.lines.map((l) => [l.quantity, l.unitPrice, l.netAmount]), [["2", "95.00", "190.00"], ["1", "-5.00", "-5.00"]], "credit note: credited quantities and a negative line");
  eq([inv.totals.taxExclusive, inv.totals.tax, inv.totals.payable], ["185.00", "35.15", "220.15"], "credit note: totals");
  consistent(inv, "credit note");
  const p = first("ubl-creditnote-peppol.xml");
  eq([p.type, p.number, p.references.preceding, p.totals.payable, p.lines[0].name], ["creditNote", "K-2024-0044", [{ number: "F-2024-0310", date: "2024-04-10" }], "150.00", "Frakt (återbetalning)"], "Peppol credit note");
  consistent(p, "Peppol credit note");
}

/* ------------------------------------------------------------------ Peppol BIS Billing 3.0 UBL */
{
  const r = open("ubl-invoice-peppol.xml");
  const inv = r.result.invoices[0];
  eq([r.result.viewer, inv.profile.name, inv.profile.profileId], ["peppol", "Peppol BIS Billing 3.0", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"], "Peppol: viewer and profile");
  eq([inv.currency, inv.taxCurrency, inv.totals.tax, inv.totals.taxInTaxCurrency, inv.totals.payable], ["EUR", "SEK", "700.18", "8052.07", "3899.18"], "Peppol: VAT in a second currency");
  eq(inv.notes, ["Leverans enligt offert 2024-17.", "Tack för ert förtroende!"], "Peppol: two notes, accents intact");
  eq([inv.references.order, inv.references.salesOrder, inv.buyerReference], ["PO-998877", "SO-5501", "PK-2024-33"], "Peppol: order references");
  eq([inv.seller.ids, inv.seller.legalId, inv.seller.vatId], [[{ scheme: "0007", value: "5560000000" }], { scheme: "0007", value: "5560000000" }, "SE556000000001"], "Peppol: seller identifiers");
  eq([inv.buyer.endpoint, inv.buyer.address.city, inv.buyer.name], [{ scheme: "0088", value: "7300009999999" }, "Göteborg", "Provköket Nord AB"], "Peppol: buyer");
  eq([inv.delivery.name, inv.delivery.locationId], ["Provköket Nord, Lager Hisingen", "7300009999001"], "Peppol: delivery party and location");
  eq(inv.lines[0].allowances.map((a) => [a.reason, a.amount]), [["Kampanjrabatt", "90.00"]], "Peppol: a line discount");
  eq([inv.lines[0].netAmount, inv.lines[0].classifications, inv.lines[0].buyerItemId], ["2590.00", [{ scheme: "STI", code: "94031000" }], "PK-BANK-180"], "Peppol: line classification and buyer item id");
  eq(inv.lines.map((l) => l.unit), ["C62", "KGM", "C62", "C62"], "Peppol: unit codes");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax]), [["S", "25", "2710.00", "677.50"], ["S", "12", "189.00", "22.68"], ["E", "0", "300.00", "0.00"]], "Peppol: VAT rows (the tax-currency total is not a row)");
  eq(inv.vatBreakdown[2].exemptionReason, "Undantaget från moms enligt 3 kap. mervärdesskattelagen", "Peppol: exemption reason");
  eq([inv.payment.meansCode, inv.payment.meansText, inv.payment.reference, inv.payment.accounts[0].id, inv.payment.accounts[0].bic], ["30", "Credit transfer", "OCR 1234567890", "SE4550000000058398257466", "ESSESESS"], "Peppol: payment");
  consistent(inv, "Peppol");
  const s = open("peppol-sbdh.xml");
  eq([s.result.format, s.result.viewer, s.result.invoices[0].number, s.result.invoices[0].totals.payable], ["ubl-invoice", "peppol", "F-2024-0310", "3899.18"], "Peppol: invoice inside a Standard Business Document envelope");
  eq(JSON.stringify(s.result.invoices[0]), JSON.stringify(inv), "Peppol: the envelope changes nothing in the model");
}

/* ------------------------------------------------------------------ CII (XRechnung CII, Factur-X, ZUGFeRD) */
{
  const r = open("cii-xrechnung.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, inv.profile.name, inv.profile.profileId], ["cii", "xrechnung", "XRechnung 3.0", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"], "CII: format, viewer, profile");
  eq([inv.number, inv.typeCode, inv.issueDate, inv.dueDate, inv.deliveryDate, inv.currency, inv.buyerReference], ["R-2024-1187", "380", "2024-03-18", "2024-04-15", "2024-03-12", "EUR", "991-12345-67"], "CII: header facts (dates in format 102)");
  eq(inv.period, { start: "2024-03-01", end: "2024-03-15" }, "CII: billing period");
  eq(inv.notes, ["Lieferung frei Haus. Reklamationen innerhalb von 8 Tagen."], "CII: note");
  eq([inv.references.order, inv.references.salesOrder, inv.references.contract, inv.references.despatchAdvice], ["B-2024-77", "AB-5521", "RV-2022-4", "LS-889"], "CII: references");
  eq([inv.seller.name, inv.seller.tradingName, inv.seller.vatId, inv.seller.taxId, inv.seller.legalId, inv.seller.ids], ["Muster Maschinenbau GmbH & Co. KG", "Muster Maschinenbau", "DE811111111", "99/123/45678", { scheme: "0002", value: "12345678200010" }, [{ scheme: "", value: "K-1001" }]], "CII: seller identity (VAT id and tax number told apart)");
  eq(inv.seller.address, { street: "Industriestraße 5", street2: "Halle 3", street3: "", postalCode: "70173", city: "Stuttgart", region: "Baden-Württemberg", countryCode: "DE" }, "CII: seller address");
  eq(inv.seller.contact, { name: "Hans Beispiel (Vertrieb)", phone: "+49 711 987654", email: "vertrieb@muster-maschinenbau.example" }, "CII: seller contact");
  eq([inv.buyer.name, inv.buyer.vatId, inv.buyer.address.city], ["Einkauf Beispiel GmbH", "DE222222222", "Hamburg"], "CII: buyer");
  eq([inv.delivery.name, inv.delivery.address.street], ["Lager Hamburg Ost", "Billbrookdeich 20"], "CII: ship-to");
  const l = inv.lines[0];
  eq([l.id, l.name, l.description, l.note, l.quantity, l.unit, l.unitPrice, l.netAmount, l.sellerItemId, l.buyerItemId, l.originCountry, l.orderLineRef],
    ["1", "Frästeil Typ A", "Gefräst aus Vollmaterial", "Charge 2024-03-A", "100", "C62", "12.50", "1250.00", "FT-A-100", "4711-A", "DE", "3"], "CII: line 1");
  eq([l.priceDiscount, l.standardItemId, l.properties], [{ amount: "1.50", baseAmount: "14.00" }, { scheme: "0160", value: "4012345000009" }, [{ name: "Material", value: "Edelstahl 1.4301" }]], "CII: list price, discount, GTIN, characteristics");
  eq(inv.lines[2].vat, { category: "AE", rate: "0", native: "" }, "CII: reverse-charge line");
  eq(inv.allowances.map((a) => [a.reason, a.reasonCode, a.amount, a.vat]), [["Mengenrabatt", "95", "30.00", { category: "S", rate: "19" }]], "CII: document allowance");
  eq(inv.totals, { lineNet: "1480.00", allowances: "30.00", charges: "", taxExclusive: "1450.00", tax: "247.00", taxInclusive: "1697.00", prepaid: "", rounding: "", payable: "1697.00", taxInTaxCurrency: "" }, "CII: totals");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax, v.exemptionReasonCode]), [["S", "19", "1300.00", "247.00", ""], ["AE", "0", "150.00", "0.00", "vatex-eu-ae"]], "CII: VAT rows");
  eq(inv.vatBreakdown[1].exemptionReason, "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)", "CII: exemption reason");
  eq(inv.payment.directDebit, { mandateId: "MANDAT-2023-001", creditorId: "DE98ZZZ09999999999", debitedAccount: "DE02120300000000202051" }, "CII: SEPA direct debit");
  eq([inv.payment.meansCode, inv.payment.reference, inv.payment.dueDate, inv.payment.terms], ["59", "R-2024-1187", "2024-04-15", "Der Betrag wird am Fälligkeitstag per SEPA-Lastschrift eingezogen."], "CII: payment");
  consistent(inv, "CII");

  const fx = open("facturx-en16931.xml");
  const f = fx.result.invoices[0];
  eq([fx.result.viewer, f.profile.name, f.number, f.issueDate, f.dueDate, f.deliveryDate], ["zugferd", "EN 16931", "FA-2024-05-0189", "2024-05-21", "2024-06-20", "2024-05-20"], "Factur-X: viewer, profile, dates");
  eq([f.seller.vatId, f.seller.legalId, f.seller.address.city, f.buyer.legalId, f.references.order, f.buyerReference], ["FR11123456782", { scheme: "0002", value: "12345678200010" }, "Paris", { scheme: "0002", value: "98765432100019" }, "BC-2024-0615", "SERVICE-ACHATS-12"], "Factur-X: parties");
  eq(f.lines.map((x) => [x.name, x.quantity, x.unit, x.unitPrice, x.netAmount, x.vat.rate]), [["Prestation de conseil", "5", "DAY", "650.00", "3250.00", "20"], ["Hébergement serveur (mensuel)", "3", "MON", "49.90", "149.70", "20"], ["Livre technique", "2", "C62", "32.00", "64.00", "5.5"]], "Factur-X: lines");
  eq(f.totals, { lineNet: "3463.70", allowances: "0.00", charges: "0.00", taxExclusive: "3463.70", tax: "683.46", taxInclusive: "4147.16", prepaid: "500.00", rounding: "", payable: "3647.16", taxInTaxCurrency: "" }, "Factur-X: totals with a prepayment");
  eq([f.payment.accounts[0], f.payment.meansCode, f.payment.reference], [{ id: "FR7630006000011234567890189", name: "Exemple Services SAS", bic: "AGRIFRPP", bank: "" }, "30", "FA-2024-05-0189"], "Factur-X: payment");
  ok(f.payment.terms.includes("Pénalité de retard : trois fois le taux d'intérêt légal"), "Factur-X: payment terms text");
  consistent(f, "Factur-X");

  const w = open("zugferd-basicwl.xml");
  const wi = w.result.invoices[0];
  eq([w.result.viewer, wi.profile.name, wi.lines.length, wi.warnings], ["zugferd", "Factur-X BASIC WL", 0, [{ code: "noLines", data: { profile: "Factur-X BASIC WL" } }]], "BASIC WL: no lines, and it says so");
  eq([wi.totals.taxExclusive, wi.totals.payable, wi.seller.address.city, wi.vatBreakdown.length], ["100.00", "119.00", "Köln", 1], "BASIC WL: the rest is read");
}

/* ------------------------------------------------------------------ FatturaPA */
{
  const r = open("fatturapa-fpr12.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, inv.profile.name, inv.typeNative, inv.type, inv.number, inv.issueDate, inv.currency], ["fatturapa", "fatturapa", "FatturaPA FPR12", "TD01", "invoice", "FT/2024/0007", "2024-03-15", "EUR"], "FatturaPA: identity (prefixed root, unqualified children)");
  eq(inv.notes, ["Servizi di consulenza del mese di marzo 2024.", "Pagamento a 30 giorni data fattura."], "FatturaPA: causali");
  eq([inv.seller.name, inv.seller.vatId, inv.seller.taxId, inv.seller.legalId, inv.seller.contact.email], ["Esempio Servizi S.r.l.", "IT01234567890", "01234567890", { scheme: "REA", value: "RM 1234567" }, "amministrazione@esempio-servizi.example"], "FatturaPA: seller");
  eq(inv.seller.address, { street: "Via Roma 10", street2: "", street3: "", postalCode: "00100", city: "Roma", region: "RM", countryCode: "IT" }, "FatturaPA: seller address");
  eq([inv.buyer.name, inv.buyer.vatId, inv.buyer.endpoint], ["Prova Commerciale S.p.A.", "IT09876543210", { scheme: "SDI", value: "KRRH6B9" }], "FatturaPA: buyer and recipient code");
  eq(inv.lines.map((l) => [l.id, l.name, l.quantity, l.unit, l.unitPrice, l.netAmount, l.vat.rate, l.vat.native, l.vat.category]),
    [["1", "Consulenza informatica - marzo 2024", "8", "ore", "60.00", "480.00", "22", "", "S"], ["2", "Licenza software annuale", "1", "", "300.00", "270.00", "22", "", "S"], ["3", "Corso di formazione (esente)", "1", "", "200.00", "200.00", "0", "N4", "E"]], "FatturaPA: lines");
  eq([inv.lines[0].sellerItemId, inv.lines[1].allowances], ["CONS-01", [{ reason: "", reasonCode: "", kind: "", amount: "", baseAmount: "", percent: "10.00" }]], "FatturaPA: article code and a 10% line discount");
  eq(inv.totals, { lineNet: "950.00", allowances: "", charges: "", taxExclusive: "950.00", tax: "165.00", taxInclusive: "1115.00", prepaid: "", rounding: "", payable: "1115.00", taxInTaxCurrency: "" }, "FatturaPA: totals");
  eq(inv.vatBreakdown, [{ category: "S", rate: "22", taxable: "750.00", tax: "165.00", exemptionReason: "", exemptionReasonCode: "" }, { category: "E", rate: "0", taxable: "200.00", tax: "0.00", exemptionReason: "Esenti art. 10 D.P.R. 633/72", exemptionReasonCode: "N4" }], "FatturaPA: VAT summary with the exemption");
  eq([inv.payment.meansNative, inv.payment.meansCode, inv.payment.dueDate, inv.payment.accounts], ["MP05", "30", "2024-04-14", [{ id: "IT60X0542811101000000123456", name: "", bic: "", bank: "Banca Esempio" }]], "FatturaPA: payment by bank transfer");
  eq([inv.references.order, inv.references.despatchAdvice], ["ORD-77", "DDT/12"], "FatturaPA: order and transport document");
  eq(inv.extra.map((e) => [e.key, e.value, e.amount]), [["taxRegime", "RF01", ""], ["stampDuty", "", "2.00"], ["paymentTerms", "TP02", ""]], "FatturaPA: tax regime, stamp duty, payment conditions");
  eq(inv.attachments.map((a) => [a.filename, a.mimeType, a.description, a.size]), [["dettaglio.txt", "TXT", "Dettaglio ore", 25]], "FatturaPA: attachment");
  consistent(inv, "FatturaPA");

  const b = open("fatturapa-fpa12-batch.xml");
  eq([b.result.invoices.length, b.result.invoices.map((i) => i.number), b.result.invoices.map((i) => i.type), b.result.invoices.map((i) => i.typeNative)], [2, ["1/PA", "2/PA"], ["invoice", "creditNote"], ["TD01", "TD04"]], "FPA12 batch: two invoices, one a credit note");
  const [i1, i2] = b.result.invoices;
  eq([i1.profile.name, i1.seller.name, i1.seller.taxId, i1.buyer.name, i1.buyer.endpoint.value], ["FatturaPA FPA12", "Mario Rossi", "RSSMRA80A01H501U", "Comune di Esempiopoli", "UFA1B2"], "FPA12: a natural person as seller, a municipality as buyer");
  eq(i1.markings, ["splitPayment"], "FPA12: split payment (EsigibilitaIVA S)");
  eq(i1.charges.map((c) => [c.kind, c.reasonCode, c.amount, c.baseAmount, c.percent]), [["socialSecurity", "TC22", "40.00", "1000.00", "4.00"]], "FPA12: social security fund contribution");
  eq(i1.extra.filter((e) => e.key === "withholding" || e.label).map((e) => [e.key || e.label, e.value, e.amount]), [["withholding", "RT01, 20%, A", "208.00"], ["CIG", "ZA12345678", ""], ["CUP", "J12B24000010001", ""]], "FPA12: withholding tax, CIG and CUP");
  eq([i1.totals.taxExclusive, i1.totals.tax, i1.totals.taxInclusive, i1.totals.payable, i1.totals.charges], ["1040.00", "228.80", "1268.80", "832.00", "40.00"], "FPA12: totals (the payment amount is what is actually paid)");
  eq([i2.references.preceding, i2.totals.taxInclusive, i2.notes, i2.markings], [[{ number: "1/PA", date: "2024-05-06" }], "122.00", ["Storno parziale dell'onorario di cui alla fattura 1/PA."], ["splitPayment"]], "FPA12: the credit note");
  consistent(i1, "FPA12 invoice");
  consistent(i2, "FPA12 credit note");
  eq(JSON.stringify(parse.openBytes(bytes("fatturapa-latin1.xml"), { parseXml }).result.invoices[0].notes[0]), JSON.stringify("Servizi di consulenza per l'attività di marzo, perché più utili."), "FatturaPA: ISO-8859-1 file read with the right accents");
}

/* ------------------------------------------------------------------ KSeF */
{
  const r = open("ksef-fa3.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, inv.profile.name, inv.profile.profileId, inv.type, inv.typeNative], ["ksef", "ksef", "KSeF FA (3)", "1-0E", "invoice", "VAT"], "KSeF FA(3): format and type");
  eq([inv.number, inv.issueDate, inv.deliveryDate, inv.currency], ["FV/2026/02/015", "2026-02-20", "2026-02-19", "PLN"], "KSeF: identity");
  eq([inv.seller.name, inv.seller.vatId, inv.seller.address, inv.seller.contact], ["Przykładowa Spółka z o.o.", "PL1234563218", { street: "ul. Prosta 1/5", street2: "00-001 Warszawa", street3: "", postalCode: "", city: "", region: "", countryCode: "PL" }, { name: "", phone: "+48 22 123 45 67", email: "faktury@przyklad.example" }], "KSeF: seller");
  eq([inv.buyer.name, inv.buyer.vatId], ["Wzorcowy Nabywca S.A.", "PL9876543210"], "KSeF: buyer");
  eq(inv.lines.map((l) => [l.id, l.name, l.quantity, l.unit, l.unitPrice, l.netAmount, l.vat.rate, l.vat.native, l.vat.category]),
    [["1", "Usługa programistyczna", "10", "godz.", "150.00", "1500.00", "23", "", "S"], ["2", "Książka „Faktury w KSeF”", "5", "szt.", "40.00", "200.00", "5", "", "S"], ["3", "Szkolenie zwolnione z VAT", "1", "szt.", "100.00", "100.00", "", "zw", "E"]], "KSeF: lines");
  eq([inv.lines[0].sellerItemId, inv.lines[1].standardItemId], ["USL-PRG", { scheme: "GTIN", value: "5900000000007" }], "KSeF: index and GTIN");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax, v.exemptionReason]), [["S", "23", "1500.00", "345.00", ""], ["S", "5", "200.00", "10.00", ""], ["E", "", "100.00", "0.00", "art. 43 ust. 1 pkt 37 ustawy o VAT"]], "KSeF: VAT groups with rates taken from the lines");
  eq(inv.totals, { lineNet: "1800.00", allowances: "", charges: "", taxExclusive: "1800.00", tax: "355.00", taxInclusive: "2155.00", prepaid: "", rounding: "", payable: "2155.00", taxInTaxCurrency: "" }, "KSeF: totals");
  eq(inv.markings, ["splitPayment", "exemption"], "KSeF: split payment and exemption markings");
  eq([inv.payment.meansNative, inv.payment.meansCode, inv.payment.dueDate, inv.payment.accounts], ["6", "30", "2026-03-06", [{ id: "61109010140000071219812874", name: "", bic: "WBKPPLPP", bank: "Bank Przykładowy S.A." }]], "KSeF: transfer to an account");
  eq(inv.notes, ["Numer zamówienia: ZAM/2026/12", "Dziękujemy za współpracę."], "KSeF: additional description and footer");
  eq(inv.extra.map((e) => [e.key || e.label, e.value]), [["KRS", "0000123456"], ["REGON", "123456785"], ["BDO", "000123456"], ["placeOfIssue", "Warszawa"]], "KSeF: registers and place of issue");
  consistent(inv, "KSeF");

  const k = open("ksef-fa2-correction.xml").result.invoices[0];
  eq([k.profile.name, k.type, k.typeNative, k.number, k.currency], ["KSeF FA (2)", "correction", "KOR", "KFV/2025/11/003", "EUR"], "KSeF FA(2): a correction invoice");
  eq(k.lines.map((l) => [l.before, l.quantity, l.netAmount, l.vat.category, l.vat.rate, l.vat.native]), [[true, "10", "1500.00", "K", "0", "0 WDT"], [false, "8", "1200.00", "K", "0", "0 WDT"]], "KSeF: before-and-after lines of a correction");
  eq(k.references.preceding, [{ number: "FV/2025/10/044", date: "2025-10-30" }], "KSeF: the corrected invoice");
  eq(k.extra.map((e) => [e.key || e.label, e.value]), [["correctionReason", "Błędna ilość towaru na fakturze pierwotnej."], ["KSeF", "1234563218-20251030-ABCDEF123456-AB"]], "KSeF: reason and the corrected invoice's KSeF number");
  eq([k.buyer.vatId, k.totals.taxExclusive, k.totals.payable, k.totals.lineNet, k.payment.paid, k.payment.paidDate], ["DE123456789", "-300.00", "-300.00", "", true, "2025-11-06"], "KSeF: EU buyer, negative difference, paid");
}

/* ------------------------------------------------------------------ Turkey: e-Fatura and e-Arsiv (UBL-TR) */
{
  const r = open("tr-efatura-temel.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, r.result.formatLabel, inv.profile, inv.type, inv.typeNative], ["ubl-tr", "efatura", "e-Fatura (UBL-TR)", { customizationId: "TR1.2", profileId: "TEMELFATURA", name: "TR1.2 · TEMELFATURA" }, "invoice", "SATIS"], "UBL-TR: format, profile and invoice type");
  eq([inv.number, inv.issueDate, inv.currency, inv.codes], ["ABC2024000000123", "2024-05-14", "TRY", [{ key: "uuid", value: "f47ac10b-58cc-4372-a567-0e02b2c3d479" }]], "UBL-TR: number, date and the UUID (ETTN)");
  eq([inv.seller.name, inv.seller.ids, inv.seller.taxOffice, inv.seller.address, inv.seller.contact], ["Örnek Yazılım Anonim Şirketi", [{ scheme: "VKN", value: "1234567801" }, { scheme: "MERSISNO", value: "0123456789012345" }], "Kadıköy Vergi Dairesi",
    { street: "Atatürk Caddesi 12", street2: "", street3: "", postalCode: "34710", city: "İstanbul", region: "Kadıköy", countryCode: "TR" }, { name: "", phone: "+90 216 555 01 01", email: "fatura@ornek-yazilim.example" }], "UBL-TR: seller with VKN, tax office and the country named Türkiye");
  eq([inv.buyer.name, inv.buyer.ids, inv.buyer.taxOffice], ["Deneme Ticaret Limited Şirketi", [{ scheme: "VKN", value: "9876543210" }], "Çankaya Vergi Dairesi"], "UBL-TR: buyer");
  eq(inv.lines.map((l) => [l.id, l.name, l.quantity, l.unit, l.unitPrice, l.netAmount, l.vat.category, l.vat.rate]), [["1", "Barkod okuyucu", "10", "C62", "260.00", "2500.00", "S", "20"], ["2", "Etiket rulosu", "4", "C62", "125.50", "502.00", "S", "10"]], "UBL-TR: lines with VAT read from each line's own tax total");
  eq(inv.lines[0].allowances, [{ reason: "", reasonCode: "", kind: "", amount: "100.00", baseAmount: "2600.00", percent: "" }], "UBL-TR: a line discount shows its amount (the rate is a fraction and is left out)");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax]), [["S", "20", "2500.00", "500.00"], ["S", "10", "502.00", "50.20"]], "UBL-TR: KDV rows");
  eq(inv.totals, { lineNet: "3002.00", allowances: "", charges: "", taxExclusive: "3002.00", tax: "550.20", taxInclusive: "3552.20", prepaid: "", rounding: "", payable: "3552.20", taxInTaxCurrency: "" }, "UBL-TR: totals");
  consistent(inv, "UBL-TR e-Fatura");
  eq([inv.payment.meansCode, inv.payment.dueDate, inv.payment.accounts.map((a) => a.id)], ["42", "2024-06-13", ["TR330006100519786457841326"]], "UBL-TR: payment");
  eq([inv.references.order, inv.references.despatchAdvice], ["SP-2024-0457", "IRS2024000000045"], "UBL-TR: order and despatch references");
  eq(inv.signature, "seal", "UBL-TR: the fiscal seal in the extension is noticed ...");
  eq(r.result.notes, ["sealNotChecked"], "... and the file says it was not verified");
  eq(inv.attachments.map((a) => [a.filename, a.mimeType, a.kind]), [["ABC2024000000123.xslt", "application/xml", "stylesheet"]], "UBL-TR: the embedded XSLT is an attachment marked as a stylesheet, to be offered for download only");
  ok(core.base64Bytes(inv.attachments[0].base64).length === inv.attachments[0].size, "UBL-TR: the XSLT's size is its decoded size");
  eq(JSON.parse(core.exportJson(r.result)).invoices[0].attachments[0].base64, undefined, "UBL-TR: JSON export leaves the XSLT's content out");

  const w = open("tr-efatura-tevkifat.xml");
  const t = w.result.invoices[0];
  eq([t.profile.profileId, t.type, t.typeNative, t.markings, w.result.notes, t.signature], ["TICARIFATURA", "invoice", "TEVKIFAT", ["vatWithholding"], [], ""], "UBL-TR withholding: ticari profile, TEVKIFAT, marked, no seal in this file");
  eq([t.withholdingTotal, t.withholding], ["1000.00", [{ name: "KDV TEVKİFAT", code: "602", percent: "50", taxable: "2000.00", amount: "1000.00" }]], "UBL-TR withholding: tevkifat total and its row");
  eq(t.extra, [{ key: "vatWithholding", label: "", value: "KDV TEVKİFAT (602) 50%", amount: "1000.00" }], "UBL-TR withholding: listed under additional information");
  eq([t.totals.tax, t.totals.taxInclusive, t.totals.payable, t.vatBreakdown.length], ["2000.00", "12000.00", "11000.00", 1], "UBL-TR withholding: the amount due is what the file says (VAT incl. less the withheld part)");
  eq([t.period, t.seller.taxOffice, t.lines[0].unit], [{ start: "2024-06-01", end: "2024-06-30" }, "Çankaya Vergi Dairesi", "MON"], "UBL-TR withholding: period, tax office, unit");
  consistent(t, "UBL-TR tevkifat");

  const a = open("tr-earsiv.xml").result.invoices[0];
  eq([a.formatLabel, a.profile.profileId, a.type, a.number], ["e-Arşiv Fatura (UBL-TR)", "EARSIVFATURA", "invoice", "EAR2024000000777"], "e-Arsiv: profile");
  eq([a.buyer.name, a.buyer.ids, a.buyer.address.countryCode], ["Ayşe Örnek", [{ scheme: "TCKN", value: "10000000146" }], "TR"], "e-Arsiv: an individual buyer by TCKN, named from cac:Person");
  eq(a.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax, v.exemptionReasonCode, v.exemptionReason]), [["S", "10", "64.00", "6.40", "", ""], ["E", "0", "46.00", "0.00", "351", "Diğer"]], "e-Arsiv: a zero-rate line with an exemption code is exempt");
  eq([a.lines[1].vat], [{ category: "E", rate: "0", native: "351" }], "e-Arsiv: the exemption code on the line");
  eq(a.extra, [{ key: "", label: "SEND_TYPE", value: "ELEKTRONIK", amount: "" }], "e-Arsiv: a reference with no file is a fact, not an attachment");
  eq(a.attachments, [], "e-Arsiv: no attachments");
  consistent(a, "e-Arsiv");

  const i = open("tr-iade-eur.xml").result.invoices[0];
  eq([i.type, i.typeNative, i.currency, i.references.preceding, i.extra], ["return", "IADE", "EUR", [{ number: "ABC2024000000123", date: "2024-05-14" }], [{ key: "exchangeRate", label: "", value: "1 EUR = 35.4125 TRY", amount: "" }]], "UBL-TR return invoice: IADE, foreign currency with the exchange rate, the invoice it returns");
  consistent(i, "UBL-TR iade");

  // a file in the UBL-TR profile is not confused with other UBL, and other UBL keeps its own format
  eq(core.typeOfCode("SATIS"), "invoice", "unknown type codes are plain invoices");
  eq(first("ubl-invoice-xrechnung.xml").format, "ubl-invoice", "XRechnung stays UBL");
  eq(first("ubl-invoice-xrechnung.xml").codes, [], "XRechnung has no extra codes");

  // the embedded XSLT is only ever text; nothing here evaluates it
  const x = new TextDecoder().decode(core.base64Bytes(inv.attachments[0].base64));
  ok(x.includes("document('https://xslt-must-not-run.example.invalid/x.xml')"), "the test stylesheet really asks to read another document (the page tests prove it is never run)");
  // TR seal found under the extension only, or as cac:Signature
  const base = textOf("tr-earsiv.xml");
  eq(parse.parseXmlText(base.replace("<cbc:UBLVersionID>", "<cac:Signature><cbc:ID>S1</cbc:ID></cac:Signature><cbc:UBLVersionID>"), { parseXml }).invoices[0].signature, "seal", "UBL-TR: a cac:Signature also counts as a seal");
  // withheld VAT without the TEVKIFAT type code is still shown
  eq(parse.parseXmlText(textOf("tr-efatura-tevkifat.xml").replace("<cbc:InvoiceTypeCode>TEVKIFAT", "<cbc:InvoiceTypeCode>SATIS"), { parseXml }).invoices[0].withholdingTotal, "1000.00", "UBL-TR: withholding is read whatever the type code says");
  // other taxes (not KDV) are listed, not counted as VAT
  const otv = textOf("tr-efatura-tevkifat.xml").replace("</cac:TaxSubtotal>\n  </cac:TaxTotal>\n  <cac:LegalMonetaryTotal>", '</cac:TaxSubtotal><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">10000.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">300.00</cbc:TaxAmount><cbc:Percent>3</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>ÖTV</cbc:Name><cbc:TaxTypeCode>9999</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>\n  </cac:TaxTotal>\n  <cac:LegalMonetaryTotal>');
  const o = parse.parseXmlText(otv, { parseXml }).invoices[0];
  eq([o.vatBreakdown.length, o.totals.tax, o.extra.filter((e) => e.label === "ÖTV").map((e) => [e.value, e.amount])], [1, "2000.00", [["9999 · 3%", "300.00"]]], "UBL-TR: another tax type is listed apart and not added to the VAT");
}

/* ------------------------------------------------------------------ Vietnam: hoa don dien tu (Decree 123/2020, Circular 78/2021) */
{
  const r = open("vn-hoadon-gtgt.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, r.result.formatLabel, inv.profile, inv.type], ["vn-einvoice", "vietnam", "Hóa đơn điện tử", { customizationId: "2.0.0", profileId: "", name: "Hóa đơn giá trị gia tăng · v2.0.0" }, "invoice"], "Vietnam: format, title and schema version");
  eq([inv.number, inv.issueDate, inv.currency, inv.codes], ["00000125", "2024-05-31", "VND", [{ key: "symbol", value: "C24TAA" }, { key: "form", value: "1" }, { key: "taxAuthorityCode", value: "00A1B2C3D4E5F60718293A4B5C6D7E8F90" }]], "Vietnam: number, symbol (KHHDon), form (KHMSHDon) and the tax authority code (MCCQT)");
  eq([inv.seller.name, inv.seller.taxId, inv.seller.address.street, inv.seller.contact.phone, inv.seller.contact.email], ["Công ty TNHH Phần mềm Mẫu", "0312345678", "Số 12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh", "028 3822 0000", "hoadon@phanmem-mau.example"], "Vietnam: seller (NBan)");
  eq([inv.buyer.name, inv.buyer.taxId, inv.buyer.contact.name, inv.buyer.ids], ["Công ty Cổ phần Thương mại Thử nghiệm", "0109876543", "Trần Thị Bình", [{ scheme: "MKHang", value: "KH-00417" }]], "Vietnam: buyer (NMua) with the contact person and customer code");
  eq(inv.lines.map((l) => [l.id, l.name, l.unit, l.quantity, l.unitPrice, l.netAmount, l.vat.category, l.vat.rate, l.vat.native, l.sellerItemId]),
    [["1", "Dịch vụ phát triển phần mềm tháng 5/2024", "Tháng", "1", "25000000", "25000000", "S", "10", "", "DV-PM01"], ["2", "Máy in nhãn nhiệt", "Cái", "3", "2400000", "7000000", "S", "8", "", "MI-200"], ["3", "Sách giáo khoa", "Quyển", "10", "95000", "950000", "O", "", "KCT", ""]], "Vietnam: lines (DSHHDVu) with 10%, 8% and KCT");
  eq(inv.lines[1].allowances, [{ reason: "", reasonCode: "", kind: "", amount: "200000", baseAmount: "", percent: "" }], "Vietnam: line discount (STCKhau)");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax, v.exemptionReasonCode]), [["S", "10", "25000000", "2500000", ""], ["S", "8", "7000000", "560000", ""], ["O", "", "950000", "0", "KCT"]], "Vietnam: VAT by rate (THTTLTSuat)");
  eq(inv.totals, { lineNet: "", allowances: "200000", charges: "", taxExclusive: "32950000", tax: "3060000", taxInclusive: "36010000", prepaid: "", rounding: "", payable: "36010000", taxInTaxCurrency: "" }, "Vietnam: totals (TToan)");
  consistent(inv, "Vietnam GTGT");
  eq([inv.payment.meansNative, inv.payment.meansCode, inv.payment.accounts], ["2", "30", [{ id: "0123456789", name: "", bic: "", bank: "Ngân hàng Mẫu - Chi nhánh Sài Gòn" }]], "Vietnam: bank transfer to the seller's account");
  eq(inv.extra.map((e) => [e.key || e.label, e.value]), [["Mã tra cứu", "TC4F7A9K2Q"], ["amountInWords", "Ba mươi sáu triệu không trăm mười nghìn đồng chẵn."]], "Vietnam: other information (TTKhac) and the amount in words");
  eq([inv.signature, r.result.notes], ["dscks", ["dscksNotChecked"]], "Vietnam: the digital signatures are noticed and the file says they were not verified");

  const d = open("vn-hoadon-tdiep-dieuchinh.xml");
  const adj = d.result.invoices[0];
  eq([d.result.viewer, adj.type, adj.typeCode, adj.number, adj.currency, adj.codes.map((c) => c.value)], ["vietnam", "correction", "2", "00000031", "USD", ["K24TXM", "1", "00F0E1D2C3B4A5968778695A4B3C2D1E0F"]], "Vietnam: an invoice inside a TDiep message, an adjustment (TCHDon 2)");
  eq([adj.references.preceding, adj.notes, adj.extra], [[{ number: "1K24TXM / 00000027", date: "2024-06-20" }], ["Điều chỉnh đơn giá dịch vụ theo phụ lục hợp đồng."], [{ key: "exchangeRate", label: "", value: "1 USD = 25410 VND", amount: "" }]], "Vietnam: the adjusted invoice, its note, the exchange rate");
  eq([adj.seller.taxId, adj.buyer.name, adj.buyer.taxId, adj.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax]), adj.payment.meansCode, adj.payment.meansNative], ["0312345678-001", "Sample Trading Pte. Ltd.", "", [["Z", "0", "1200.50", "0.00"]], "30", "CK"], "Vietnam: zero rate, a foreign buyer with no tax code, payment written as text");
  consistent(adj, "Vietnam adjustment");

  const b = open("vn-hoadon-ban-hang.xml");
  const sale = b.result.invoices[0];
  eq([b.result.notes, sale.signature, sale.codes, sale.profile.name], [[], "", [{ key: "symbol", value: "C24MBH" }, { key: "form", value: "2" }], "Hóa đơn bán hàng · v2.0.1"], "Vietnam: an invoice with no tax authority code and no signature");
  eq([sale.buyer.name, sale.buyer.ids, sale.buyer.contact.name], ["Lê Văn Cường", [{ scheme: "CCCD", value: "079012345678" }], ""], "Vietnam: an individual buyer with a citizen ID");
  eq([sale.linesTotal, sale.lines.length, sale.notes, sale.lines[0].vat], [1, 1, ["Quý khách vui lòng kiểm tra hàng khi nhận."], { category: "O", rate: "", native: "KKKNT" }], "Vietnam: a note line (TChat 4) is a note, not a line");
  eq([sale.charges, sale.totals.charges, sale.totals.payable, sale.payment.meansCode, sale.payment.meansNative], [[{ reason: "Phí giao hàng", reasonCode: "", kind: "", amount: "30000", baseAmount: "", percent: "", vat: { category: "", rate: "" } }], "30000", "510000", "ZZZ", "TM/CK"], "Vietnam: a delivery fee (DSLPhi), payment by cash or transfer");

  // VAT codes
  eq(["10%", "8%", "0%", "5.5%", "KHAC:3.5%", "KCT", "kkknt", "10", "", "xyz"].map((c) => { const v = vn.vatOf(c); return [v.category, v.rate, v.native]; }),
    [["S", "10", ""], ["S", "8", ""], ["Z", "0", ""], ["S", "5.5", ""], ["S", "3.5", "KHAC"], ["O", "", "KCT"], ["O", "", "KKKNT"], ["S", "10", ""], ["", "", ""], ["", "", "xyz"]], "Vietnam: VAT rate codes");
  eq(vn.findInvoice(parseXml("<TDiep><DLieu/></TDiep>")), null, "Vietnam: a TDiep with no invoice");
  eq(errOf(() => parse.parseXmlText("<TDiep><DLieu/></TDiep>", { parseXml })).code, "not-invoice", "Vietnam: ... is not an invoice");
  eq(errOf(() => parse.parseXmlText("<HDon><x/></HDon>", { parseXml })).data, { name: "HDon" }, "Vietnam: an HDon with no DLHDon is not read");
  eq(first("ksef-fa3.xml").codes, [], "other formats have no codes");

  // limit
  const head = '<HDon><DLHDon><TTChung><SHDon>1</SHDon></TTChung><NDHDon><DSHHDVu>';
  const row = (i) => `<HHDVu><TChat>1</TChat><STT>${i}</STT><THHDVu>Hàng ${i}</THHDVu><SLuong>1</SLuong><DGia>1</DGia><ThTien>1</ThTien><TSuat>10%</TSuat></HHDVu>`;
  const big = parse.parseXmlText(head + Array.from({ length: 6100 }, (_, i) => row(i + 1)).join("") + "</DSHHDVu></NDHDon></DLHDon></HDon>", { parseXml }).invoices[0];
  eq([big.lines.length, big.linesTotal, big.warnings], [5000, 6100, [{ code: "linesTruncated", data: { shown: 5000, total: 6100 } }]], "Vietnam: 5,000 of 6,100 lines are read, the rest counted and reported");
}

/* ------------------------------------------------------------------ Mexico: CFDI 4.0 and 3.3 */
{
  const UUID = "A1B2C3D4-E5F6-4789-9ABC-DEF012345678";
  const r = open("cfdi40-ingreso.xml");
  const inv = r.result.invoices[0];
  eq([r.result.format, r.result.viewer, r.result.formatLabel, inv.profile, inv.type, inv.typeNative], ["cfdi", "cfdi", "CFDI", { customizationId: "4.0", profileId: "", name: "CFDI 4.0" }, "invoice", "I · Ingreso"], "CFDI 4.0: format, version and voucher type");
  eq([inv.number, inv.issueDate, inv.currency], ["A-1042", "2024-05-14", "MXN"], "CFDI: Serie-Folio, date, currency");
  eq(inv.codes, [{ key: "cfdiUuid", value: UUID }, { key: "stampDate", value: "2024-05-14T10:31:07" }, { key: "pac", value: "AAA010101AAA" }], "CFDI: UUID, stamping time and certification provider from the TimbreFiscalDigital");
  eq([inv.seller.name, inv.seller.ids, inv.buyer.name, inv.buyer.ids, inv.buyer.address.postalCode], ["ESCUELA KEMPER URGATE", [{ scheme: "RFC", value: "EKU9003173C9" }], "UNIVERSIDAD ROBOTICA ESPAÑOLA", [{ scheme: "RFC", value: "URE180429TM6" }], "86991"], "CFDI: parties by RFC, the buyer's fiscal postal code");
  eq(inv.lines.map((l) => [l.id, l.name, l.quantity, l.unit, l.unitPrice, l.netAmount, l.vat.category, l.vat.rate, l.sellerItemId]),
    [["1", "Servicios de desarrollo de software, mayo 2024", "1", "Servicio", "10000.00", "10000.00", "S", "16", "SRV-001"], ["2", "Computadora portátil 14 pulgadas", "2", "Pieza", "1250.00", "2500.00", "S", "16", "LAP-14"],
      ["3", "Libro de texto", "3", "Pieza", "300.00", "900.00", "Z", "0", ""], ["4", "Cuota de inscripción", "1", "Servicio", "200.00", "200.00", "E", "", ""]], "CFDI: lines with 16%, 0% and exempt IVA");
  eq([inv.lines[0].allowances, inv.lines[0].classifications], [[{ reason: "", reasonCode: "", kind: "", amount: "500.00", baseAmount: "", percent: "" }], [{ scheme: "SAT", code: "80111601" }]], "CFDI: line discount and ClaveProdServ");
  eq(inv.vatBreakdown.map((v) => [v.category, v.rate, v.taxable, v.tax]), [["S", "16", "12000.00", "1920.00"], ["Z", "0", "900.00", "0.00"], ["E", "", "200.00", "0"]], "CFDI: IVA rows (Tasa 0.160000 is 16%, Exento is exempt)");
  eq(inv.totals, { lineNet: "13600.00", allowances: "500.00", charges: "", taxExclusive: "13100.00", tax: "1920.00", taxInclusive: "15020.00", prepaid: "", rounding: "", payable: "13056.67", taxInTaxCurrency: "" }, "CFDI: totals, the amount due is the file's Total (after the retained taxes)");
  consistent(inv, "CFDI 4.0");
  eq([inv.withholdingTotal, inv.withholding.map((w) => [w.name, w.code, w.amount])], ["1963.33", [["ISR", "001", "950.00"], ["IVA", "002", "1013.33"]]], "CFDI: retained taxes");
  eq(inv.extra.map((e) => [e.key, e.value, e.amount]), [["taxWithheld", "ISR (001)", "950.00"], ["taxWithheld", "IVA (002)", "1013.33"], ["cfdiPaymentMethod", "PUE", ""], ["placeOfIssue", "86991", ""], ["cfdiUse", "G03", ""], ["taxRegime", "601", ""], ["buyerTaxRegime", "601", ""], ["export", "01", ""]], "CFDI: additional information");
  eq([inv.payment.meansNative, inv.payment.meansCode, inv.payment.terms], ["03", "30", "Pago a 30 dias"], "CFDI: FormaPago 03 is a transfer");
  eq([inv.signature, r.result.notes], ["sello", ["selloNotChecked"]], "CFDI: the seal and the SAT stamp are noticed and the file says they were not verified");
  eq(inv.links, [{ key: "satVerify", url: `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${UUID}&re=EKU9003173C9&rr=URE180429TM6&tt=0000013056.670000&fe=6Xc%2Fw%2BA%3D` }], "CFDI: the SAT verification link (total padded as in the SAT's QR code, last 8 characters of the Sello, encoded)");

  const e = open("cfdi40-egreso-usd.xml").result.invoices[0];
  eq([e.type, e.typeNative, e.currency, e.number, e.references.preceding, e.extra.find((x) => x.key === "exchangeRate").value], ["creditNote", "E · Egreso", "USD", "NC-0045", [{ number: UUID, date: "" }], "1 USD = 17.0521 MXN"], "CFDI egreso: credit note in USD with the exchange rate and the related CFDI");
  eq([e.buyer.ids, e.links[0].url.endsWith("&tt=0000000348.000000&fe=Q0ZESQ%3D%3D")], [[{ scheme: "RFC", value: "XAXX010101000" }], true], "CFDI egreso: generic RFC and the link's total");
  consistent(e, "CFDI egreso");

  const o = open("cfdi33-ingreso.xml");
  const a = o.result.invoices[0];
  eq([o.result.viewer, a.profile.name, a.number, a.payment.meansCode, a.payment.meansNative, a.vatBreakdown.map((v) => [v.rate, v.taxable, v.tax])], ["cfdi", "CFDI 3.3", "B-77", "ZZZ", "99", [["16", "1000.00", "160.00"]]], "CFDI 3.3 (namespace cfd/3) opens too; the missing Base is added up from the lines");
  consistent(a, "CFDI 3.3");

  // helpers
  eq(["0.160000", "0.106667", "0.000000", "0.08", "0.265", "", "x", "-0.1"].map(cfdi.percentOf), ["16", "10.6667", "0", "8", "26.5", "", "", ""], "CFDI: rates as percentages");
  const ok = { uuid: UUID, rfcEmisor: "EKU9003173C9", rfcReceptor: "XAXX010101000", total: "1160", sello: "abcdefghijklmnop" };
  eq(cfdi.verifyUrl(ok), `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${UUID}&re=EKU9003173C9&rr=XAXX010101000&tt=0000001160.000000&fe=ijklmnop`, "CFDI: verification URL");
  eq([{ uuid: "x" }, { rfcEmisor: "<script>" }, { rfcReceptor: "A&B=1" }, { total: "-5" }, { total: "abc" }, { total: "12345678901" }, { total: "1.1234567" }, { sello: "" }].map((o2) => cfdi.verifyUrl({ ...ok, ...o2 })),
    ["", "", "", "", "", "", "", ""], "CFDI: no link from a malformed UUID, RFC, total or missing seal (nothing odd reaches the address)");
  // 3.3 / 4.0 only in the SAT namespace; the same element anywhere else is not a CFDI
  const plain = textOf("cfdi40-ingreso.xml");
  eq(errOf(() => parse.parseXmlText(plain.replace('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"', 'xmlns:cfdi="http://example.invalid/cfd"'), { parseXml })).code, "not-invoice", "CFDI: another namespace is not read");
  eq(errOf(() => parse.parseXmlText(plain.replace('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"', 'xmlns:cfdi="http://www.sat.gob.mx/cfd/2"'), { parseXml })).code, "not-invoice", "CFDI: only versions 3 and 4");
  eq(errOf(() => parse.parseXmlText(plain.replace("<?xml", '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><?xml'), { parseXml })).code != null, true, "CFDI: a DOCTYPE is refused");
  eq(errOf(() => parse.parseXmlText(plain.replace('<cfdi:Receptor Rfc="URE180429TM6"', '<!DOCTYPE c [<!ENTITY a "b">]><cfdi:Receptor Rfc="URE180429TM6"'), { parseXml })).code, "doctype", "CFDI: an entity declaration inside is refused");
  // a comprobante with nothing in it still opens without a link or a crash
  const bare = parse.parseXmlText('<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"/>', { parseXml }).invoices[0];
  eq([bare.number, bare.codes, bare.links, bare.lines, bare.signature, bare.type], ["", [], [], [], "", "invoice"], "CFDI: an empty comprobante");
  // hidden characters in text are removed
  const sneaky = parse.parseXmlText(plain.replace('Nombre="ESCUELA KEMPER URGATE"', 'Nombre="ESCUELA \u202eKEMPER"'), { parseXml });
  eq([sneaky.invoices[0].seller.name, sneaky.notes.includes("hiddenChars")], ["ESCUELA KEMPER", true], "CFDI: direction overrides removed and noted");
  // limit
  const row = (i) => `<cfdi:Concepto ClaveProdServ="1" Cantidad="1" ClaveUnidad="H87" Descripcion="P${i}" ValorUnitario="1" Importe="1"/>`;
  const big = parse.parseXmlText('<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"><cfdi:Conceptos>' + Array.from({ length: 6100 }, (_, i) => row(i + 1)).join("") + "</cfdi:Conceptos></cfdi:Comprobante>", { parseXml }).invoices[0];
  eq([big.lines.length, big.linesTotal, big.warnings], [5000, 6100, [{ code: "linesTruncated", data: { shown: 5000, total: 6100 } }]], "CFDI: 5,000 of 6,100 lines are read, the rest counted and reported");
}

/* ------------------------------------------------------------------ signed .p7m files */
{
  const xml = Buffer.from(readFileSync(new URL("fatturapa-fpr12.xml", FX)));
  const same = (name, expected) => Buffer.from(p7m.unwrapP7m(bytes(name)).bytes).equals(expected);
  ok(same("fatturapa-fpr12.xml.p7m", xml), "p7m: a DER signed file gives the exact XML bytes");
  ok(same("fatturapa-fpa12-batch.xml.p7m", Buffer.from(readFileSync(new URL("fatturapa-fpa12-batch.xml", FX)))), "p7m: a BER file (indefinite lengths, content in pieces) gives the exact XML bytes");
  ok(same("fatturapa-fpr12-base64.p7m", xml), "p7m: base64 text of a signed file");
  const dbl = p7m.unwrapP7m(bytes("fatturapa-double.p7m"));
  eq(dbl.layers, 2, "p7m: a signature on a signature has two layers");
  ok(Buffer.from(dbl.bytes).equals(xml), "p7m: and the invoice comes out");
  eq(p7m.unwrapP7m(bytes("fatturapa-fpr12.xml.p7m")).layers, 1, "p7m: one layer");
  eq(codeOf(() => p7m.unwrapP7m(bytes("detached.p7m"))), "p7m", "p7m: a detached signature has no invoice");
  eq(errOf(() => p7m.unwrapP7m(bytes("detached.p7m"))).data.reason, "detached", "p7m: ... and says so");
  eq(p7m.looksLikeP7m(bytes("fatturapa-fpr12.xml.p7m")) && p7m.looksLikeP7m(bytes("fatturapa-fpr12-base64.p7m")) && !p7m.looksLikeP7m(bytes("fatturapa-fpr12.xml")) && !p7m.looksLikeP7m(bytes("plain.pdf")), true, "p7m: recognised by content");
  const pem = Buffer.from("-----BEGIN PKCS7-----\n" + Buffer.from(bytes("fatturapa-fpr12.xml.p7m")).toString("base64").replace(/(.{64})/g, "$1\n") + "\n-----END PKCS7-----\n");
  ok(Buffer.from(p7m.unwrapP7m(pem).bytes).equals(xml), "p7m: PEM text");
  const r = open("fatturapa-fpr12.xml.p7m");
  eq([r.container, r.layers, r.result.notes, r.result.invoices[0].number, r.xml.slice(0, 5)], ["p7m", 1, ["signatureNotChecked"], "FT/2024/0007", "<?xml"], "p7m: opened as an invoice, with the note that nothing was verified");

  // hand-built structures
  const der = (tag, body) => {
    const len = body.length;
    const l = len < 128 ? [len] : len < 256 ? [0x81, len] : len < 65536 ? [0x82, len >> 8, len & 255] : [0x83, len >> 16, (len >> 8) & 255, len & 255];
    return Buffer.concat([Buffer.from([tag, ...l]), body]);
  };
  const ber = (tag, body) => Buffer.concat([Buffer.from([tag, 0x80]), body, Buffer.from([0, 0])]);
  const OID_SIGNED = Buffer.from("06092a864886f70d010702", "hex");
  const OID_DATA = Buffer.from("06092a864886f70d010701", "hex");
  const cms = (content, { indef = false, pieces = 0, detached = false, version = 1 } = {}) => {
    const enc = indef ? ber : der;
    const parts = [];
    for (let i = 0; pieces && i < content.length; i += pieces) parts.push(der(0x04, content.subarray(i, i + pieces)));
    const octet = pieces ? ber(0x24, Buffer.concat(parts)) : der(0x04, content);
    const encap = enc(0x30, Buffer.concat([OID_DATA, detached ? Buffer.alloc(0) : enc(0xa0, octet)]));
    const sd = enc(0x30, Buffer.concat([der(0x02, Buffer.from([version])), der(0x31, Buffer.alloc(0)), encap, der(0x31, Buffer.alloc(0))]));
    return enc(0x30, Buffer.concat([OID_SIGNED, enc(0xa0, sd)]));
  };
  const payload = Buffer.from('<?xml version="1.0"?><a>' + "x".repeat(3000) + "</a>");
  for (const [label, opts] of [["definite lengths", {}], ["indefinite lengths", { indef: true }], ["pieces of 7 bytes", { pieces: 7 }], ["indefinite lengths and pieces", { indef: true, pieces: 1000 }]]) {
    ok(Buffer.from(p7m.unwrapP7m(cms(payload, opts)).bytes).equals(payload), "p7m: built with " + label);
  }
  const tiny = Buffer.from("<a/>");
  ok(Buffer.from(p7m.unwrapP7m(Buffer.concat([cms(tiny), Buffer.from([0, 0, 0, 0])])).bytes).equals(tiny), "p7m: padding after the structure is ignored");
  ok(Buffer.from(p7m.unwrapP7m(cms(Buffer.from(tiny.toString("base64")))).bytes).equals(tiny), "p7m: XML stored as base64 text inside the signature");
  const three = cms(cms(cms(tiny)));
  const t3 = p7m.unwrapP7m(three);
  eq([t3.layers, Buffer.from(t3.bytes).equals(tiny)], [3, true], "p7m: three nested signatures");
  eq(errOf(() => p7m.unwrapP7m(cms(tiny, { detached: true }))).data.reason, "detached", "p7m: built detached");
  eq(errOf(() => p7m.unwrapP7m(Buffer.from("hello world, not a signature"))).data.reason, "notSigned", "p7m: text that is not base64 CMS");
  eq(errOf(() => p7m.unwrapP7m(Buffer.from("<?xml version='1.0'?><a/>"))).data.reason, "notSigned", "p7m: an XML file is not a signature");
  eq(errOf(() => p7m.unwrapP7m(cms(payload).subarray(0, 200))).data.reason, "truncated", "p7m: cut off");
  eq(errOf(() => p7m.unwrapP7m(cms(payload, { indef: true }).subarray(0, 100))).data.reason, "truncated", "p7m: cut off inside an indefinite item");
  eq(errOf(() => p7m.unwrapP7m(der(0x30, Buffer.concat([Buffer.from("06092a864886f70d010701", "hex"), der(0xa0, der(0x04, tiny))])))).data.reason, "notSigned", "p7m: plain CMS data, not signed data");
  let deep = Buffer.from([5, 0]);
  for (let i = 0; i < 60; i++) deep = ber(0x30, deep);
  eq(errOf(() => p7m.unwrapP7m(deep)).data.reason, "deep", "p7m: deep nesting stops before it is read");
  let nest = der(0x30, Buffer.concat([OID_SIGNED, der(0xa0, deep)]));
  eq(errOf(() => p7m.unwrapP7m(nest)).data.reason, "deep", "p7m: nesting past the limit stops");
  const many = der(0x30, Buffer.concat([OID_SIGNED, der(0xa0, der(0x30, Buffer.concat([der(0x02, Buffer.from([1])), der(0x31, Buffer.alloc(0)), der(0x30, Buffer.concat([OID_DATA, der(0xa0, der(0x04, Buffer.alloc(0)))])), der(0x31, Buffer.alloc(0)), der(0x31, Buffer.alloc(0)), Buffer.alloc(0)])))]));
  eq(errOf(() => p7m.unwrapP7m(many)).data.reason, "content", "p7m: an empty content");
  const nulls = Buffer.alloc(600000);
  for (let i = 0; i < nulls.length; i += 2) nulls[i] = 5;
  const flood = der(0x30, Buffer.concat([OID_SIGNED, der(0xa0, der(0x30, Buffer.concat([der(0x02, Buffer.from([1])), der(0x31, nulls), der(0x30, Buffer.concat([OID_DATA, der(0xa0, der(0x04, tiny))]))])))]));
  eq(errOf(() => p7m.unwrapP7m(flood)).data.reason, "big", "p7m: too many items stops");
  eq(p7m.oidOf(Uint8Array.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), { tag: 6, start: 2, end: 11 }), "1.2.840.113549.1.7.2", "p7m: OID decoding");
}

/* ------------------------------------------------------------------ what is not an invoice, and what is refused */
{
  const calls = [];
  const spy = (t) => { calls.push(t); return parseXmlShim(t); };
  eq(codeOf(() => parse.openBytes(bytes("bad/doctype-xxe.xml"), { parseXml: spy })), "doctype", "refuses a DOCTYPE with an external entity");
  eq(codeOf(() => parse.openBytes(bytes("bad/billion-laughs.xml"), { parseXml: spy })), "doctype", "refuses an entity-expansion bomb");
  eq(calls.length, 0, "the parser is never called for a document with a DOCTYPE");
  eq(codeOf(() => parse.parseXmlText("<?xml version='1.0'?><!DOCTYPE Invoice SYSTEM 'http://example.invalid/x.dtd'><Invoice/>", { parseXml: spy })), "doctype", "refuses a DOCTYPE with only an external DTD");
  eq(codeOf(() => parse.parseXmlText('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><!-- <!ENTITY x "y"> --></Invoice>', { parseXml: spy })), "doctype", "refuses an ENTITY even inside a comment (strict on purpose)");
  eq(calls.length, 0, "still never called");
  const mal = errOf(() => open("bad/malformed.xml"));
  eq(mal.code, "malformed", "a file that is cut off is malformed");
  ok(typeof mal.data.message === "string" && mal.data.message.length > 0, "malformed: carries the parser's message");
  eq(codeOf(() => parse.parseXmlText("<a><b></a>", { parseXml })), "malformed", "mismatched tags are malformed");
  eq(codeOf(() => parse.parseXmlText("   \n ", { parseXml })), "empty", "blank text is empty");
  eq(codeOf(() => parse.openBytes(new Uint8Array(0), { parseXml })), "empty", "no bytes is empty");
  eq(errOf(() => open("bad/not-invoice.xml")).data, { name: "note" }, "other XML names its root element");
  eq(errOf(() => open("bad/ubl-order.xml")).data, { kind: "ubl", name: "Order" }, "a UBL order is recognised, and not an invoice");
  eq(errOf(() => open("bad/zugferd1.xml")).data, { kind: "zugferd1" }, "ZUGFeRD 1.0 is recognised as unsupported");
  eq(errOf(() => parse.parseXmlText('<FatturaElettronicaSemplificata versione="FSM10"/>', { parseXml })).data, { kind: "fsm" }, "simplified FatturaPA is recognised as unsupported");
  eq(errOf(() => parse.parseXmlText('<FakturaRR xmlns="x"><Naglowek/></FakturaRR>', { parseXml })).data, { kind: "farr" }, "KSeF FA_RR is recognised as unsupported");
  eq(errOf(() => parse.parseXmlText('<Faktura xmlns="http://crd.gov.pl/wzor/2021/11/29/11089/"><Naglowek><KodFormularza kodSystemowy="FA (1)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek></Faktura>', { parseXml })).data, { kind: "fa1" }, "KSeF FA(1) is recognised as unsupported");
  eq(codeOf(() => parse.openBytes(Buffer.from("just some text, not XML"), { parseXml })), "not-invoice", "plain text is not an invoice");
  eq(codeOf(() => parse.openBytes(bytes("plain.pdf"), { parseXml })), "pdf", "a PDF is left to the page");
  eq(codeOf(() => parse.openBytes(Buffer.alloc(core.LIMITS.fileBytes + 1, 0x20), { parseXml })), "too-large", "over 25 MB");
  eq(core.LIMITS.fileBytes, 25 * 1024 * 1024, "the size limit is 25 MB");
  eq(core.LIMITS.lines, 5000, "the line limit is 5,000");
  eq(codeOf(() => parse.parseXmlText("<Invoice><x/></Invoice>", { parseXml })), "not-invoice", "an <Invoice> that is not UBL is not read");

  // sniffing
  eq([parse.sniff(bytes("plain.pdf")), parse.sniff(bytes("ubl-invoice-xrechnung.xml")), parse.sniff(bytes("fatturapa-fpr12.xml.p7m")), parse.sniff(bytes("fatturapa-fpr12-base64.p7m")), parse.sniff(Buffer.from("hello")), parse.sniff(Buffer.from("\ufeff<a/>", "utf16le")), parse.sniff(Uint8Array.from([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e])), parse.sniff(Buffer.from("  \n<a/>"))],
    ["pdf", "xml", "p7m", "p7m", "unknown", "xml", "xml", "xml"], "sniff by content");

  // hostile content stays text
  const x = open("bad/xss-strings.xml");
  const inv = x.result.invoices[0];
  eq(inv.number, '<img src=x onerror="window.__xss=1">INV-1', "markup in a value is kept as text");
  ok(inv.notes[0].includes("<script>window.__xss=2</script>"), "script text kept as text");
  eq(inv.lines[0].name, '<img src=x onerror="window.__xss=8">', "markup in a line name");
  eq(inv.seller.name.startsWith('<img src=x onerror="window.__xss=7"> Seller '), true, "markup in the seller name");
  ok(!/[\u202A-\u202E]/.test(inv.seller.name), "direction override removed from the name");
  eq(inv.seller.name.endsWith("gnp.exe"), true, "... the letters stay");
  eq(x.result.notes, ["hiddenChars"], "the file notes that hidden characters were removed");
  eq(inv.attachments.map((a) => [a.id, a.uri, a.size]), [["REF-1", "javascript:window.__xss=5", 0]], "an external reference is data, never followed");

  const h = open("bad/hostile-attachments.xml").result.invoices[0];
  eq(h.attachments.length, 8, "eight attachments read");
  eq(h.attachments.map((a) => core.safeFileName(a.filename, "attachment-" + a.id)),
    ["evil.exe", "_con.txt", "invoicefdp.exe", "script_.html", "x".repeat(96) + ".pdf", "attachment-A6", "hidden.txt", "ok-report.pdf"], "attachment names after cleaning");
  eq(h.attachments.map((a) => a.mimeType), ["application/x-msdownload", "text/plain", "application/pdf", "text/html", "application/pdf", "image/svg+xml", "image/png", "application/pdf"], "declared types are data only");
  eq(h.attachments.map((a) => a.size), [11, 30, 19, 60, 9, 66, 8, 13], "sizes come from the base64 text");
}

/* ------------------------------------------------------------------ limits */
{
  const head = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>BIG</cbc:ID>';
  const line = (i) => `<cac:InvoiceLine><cbc:ID>${i}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">1.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Item ${i}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">1.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
  const t0 = Date.now();
  const xml = head + Array.from({ length: 6200 }, (_, i) => line(i + 1)).join("") + "</Invoice>";
  const inv = parse.parseXmlText(xml, { parseXml }).invoices[0];
  eq([inv.lines.length, inv.linesTotal, inv.lines[4999].id, inv.warnings], [5000, 6200, "5000", [{ code: "linesTruncated", data: { shown: 5000, total: 6200 } }]], "5,000 of 6,200 lines are read, the rest counted and reported");
  ok(Date.now() - t0 < 8000, "a 6,200-line invoice reads in a few seconds: " + (Date.now() - t0) + " ms");
  const few = parse.parseXmlText(head + line(1) + line(2) + "</Invoice>", { parseXml }).invoices[0];
  eq([few.lines.length, few.warnings], [2, []], "a small invoice has no warning");
  const notes = head + Array.from({ length: 500 }, (_, i) => `<cbc:Note>n${i}</cbc:Note>`).join("") + "</Invoice>";
  eq(parse.parseXmlText(notes, { parseXml }).invoices[0].notes.length, core.LIMITS.list, "notes are capped");
  const att = head + Array.from({ length: 80 }, (_, i) => `<cac:AdditionalDocumentReference><cbc:ID>D${i}</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain" filename="f${i}.txt">QQ==</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`).join("") + "</Invoice>";
  const ai = parse.parseXmlText(att, { parseXml }).invoices[0];
  eq([ai.attachments.length, ai.warnings.map((w) => w.code)], [core.LIMITS.attachments, ["attachmentsTruncated"]], "attachments are capped and reported");
  const dl = (i) => `<DettaglioLinee><NumeroLinea>${i}</NumeroLinea><Descrizione>L${i}</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>1.00</PrezzoUnitario><PrezzoTotale>1.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>`;
  const big3 = (n) => `<DatiBeniServizi>${Array.from({ length: n }, (_, i) => dl(i + 1)).join("")}</DatiBeniServizi>`;
  const body3 = (n) => `<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2024-01-01</Data><Numero>N</Numero></DatiGeneraliDocumento></DatiGenerali>${big3(n)}</FatturaElettronicaBody>`;
  const fb = parse.parseXmlText(`<FatturaElettronica versione="FPR12"><FatturaElettronicaHeader/>${body3(3000)}${body3(3000)}${body3(3000)}</FatturaElettronica>`, { parseXml });
  eq([fb.invoices.map((i) => i.lines.length), fb.invoices.map((i) => i.linesTotal), fb.invoices.map((i) => i.warnings.length)], [[3000, 2000, 0], [3000, 3000, 3000], [0, 1, 1]], "FatturaPA: the 5,000-line limit is shared by all invoices of a file");
  const fp = textOf("fatturapa-fpa12-batch.xml");
  const body = fp.slice(fp.indexOf("<FatturaElettronicaBody>"), fp.indexOf("</FatturaElettronicaBody>") + "</FatturaElettronicaBody>".length);
  const many = fp.replace(/<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/, Array.from({ length: 250 }, () => body).join(""));
  const mr = parse.parseXmlText(many, { parseXml });
  eq([mr.invoices.length, mr.invoices[core.LIMITS.invoices - 1].warnings.map((w) => w.code)], [core.LIMITS.invoices, ["invoicesTruncated"]], "invoices in one FatturaPA file are capped and reported");
}

/* ------------------------------------------------------------------ which page fits a file, PDF candidates, raw view */
{
  const v = (name) => open(name).result.viewer;
  eq(["ubl-invoice-xrechnung.xml", "ubl-creditnote-xrechnung.xml", "cii-xrechnung.xml", "ubl-invoice-peppol.xml", "ubl-creditnote-peppol.xml", "facturx-en16931.xml", "zugferd-basicwl.xml", "fatturapa-fpr12.xml", "fatturapa-fpa12-batch.xml.p7m", "ksef-fa3.xml", "ksef-fa2-correction.xml"].map(v),
    ["xrechnung", "xrechnung", "xrechnung", "peppol", "peppol", "zugferd", "zugferd", "fatturapa", "fatturapa", "ksef", "ksef"], "the page that fits each fixture");
  eq(parse.viewerFor({ format: "ubl-invoice", profile: { customizationId: "urn:cen.eu:en16931:2017" } }), "peppol", "plain EN 16931 UBL goes to the Peppol / UBL page");
  eq(parse.viewerFor({ format: "cii", profile: { customizationId: "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended" } }), "zugferd", "Factur-X EXTENDED goes to the ZUGFeRD / Factur-X page");
  eq(Object.keys(parse.VIEWER_SLUGS), ["xrechnung", "zugferd", "fatturapa", "ksef", "peppol", "efatura", "vietnam", "cfdi"], "eight viewers");
  eq(["tr-efatura-temel.xml", "tr-efatura-tevkifat.xml", "tr-earsiv.xml", "tr-iade-eur.xml", "vn-hoadon-gtgt.xml", "vn-hoadon-tdiep-dieuchinh.xml", "vn-hoadon-ban-hang.xml"].map(v),
    ["efatura", "efatura", "efatura", "efatura", "vietnam", "vietnam", "vietnam"], "the page that fits the Turkish and Vietnamese fixtures");
  eq(["cfdi40-ingreso.xml", "cfdi40-egreso-usd.xml", "cfdi33-ingreso.xml"].map(v), ["cfdi", "cfdi", "cfdi"], "the page that fits the CFDI fixtures");

  eq(parse.pdfCandidates([{ key: "a", filename: "notes.txt" }, { key: "b", filename: "other.xml" }, { key: "c", filename: "Factur-X.xml" }, { key: "d", filename: "XRECHNUNG.XML" }, { key: "e", filename: "zugferd-invoice.xml" }]), ["c", "e", "d", "b"], "embedded files to try: the known names first, then other XML, no text files");
  eq(parse.pdfCandidates([{ key: "a", filename: "notes.txt" }]), [], "no XML among the attachments");
  eq(parse.pdfCandidates([]), [], "no attachments");

  const p = core.prettyXml('<?xml version="1.0"?><a x="1"><b>text</b><c/><d><e>1</e></d><!-- hi --></a>');
  eq(p, { text: '<?xml version="1.0"?>\n<a x="1">\n  <b>text</b>\n  <c/>\n  <d>\n    <e>1</e>\n  </d>\n  <!-- hi -->\n</a>', cut: false }, "raw view: minified XML is indented");
  const b64 = "QUJD".repeat(2000);
  const q = core.prettyXml(`<a><file>${b64}</file><n>1</n></a>`);
  eq(q.text, "<a>\n  <file>[8000 base64 characters left out]</file>\n  <n>1</n>\n</a>", "raw view: embedded files are left out of the display");
  const big = core.prettyXml("<a>" + "<b>x</b>".repeat(100000) + "</a>", 1000);
  ok(big.cut && big.text.length < 1500, "raw view: long documents are cut");
  eq(core.prettyXml("<a>\n  <b>1</b>\n</a>").text, "<a>\n  <b>1</b>\n</a>", "raw view: already indented text stays the same");
}

console.log(`${n - bad}/${n} e-invoice unit checks passed`);
process.exit(bad ? 1 : 0);
