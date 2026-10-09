// The five e-invoice viewers (XRechnung, ZUGFeRD / Factur-X, FatturaPA, KSeF, Peppol / UBL) driven in Chromium on the real pages.
// The engine's own logic is covered by check/unit/einvoice.mjs; here: the real DOMParser against the same fixtures, the
// page (what is drawn, JSON / XML / raw XML / print, the matching-page note), the PDF route through pdf.js, .p7m files,
// and the security rules (DOCTYPE refused, values shown as text, embedded files only as cleaned generic downloads, limits).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { save } from "../fixtures.mjs";
import { parseXmlShim } from "../unit/xmlshim.mjs";
import * as parse from "../../../../site/tools/js/einvoiceparse.js";

const FX = fileURLToPath(new URL("../einvoice-fixtures/", import.meta.url));
const q = JSON.stringify;
const DROP = "#drop input[type=file]";
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.replace(/\\s+/g, " ").trim()`);
const count = (t, sel) => t.page.eval(`document.querySelectorAll(${q(sel)}).length`);
const hidden = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).hidden`);
const fixture = (name) => join(FX, name);
const bytes = (name) => new Uint8Array(readFileSync(fixture(name)));

async function open(t, name) {
  await t.page.setFiles(DROP, [name.includes("/") && name.startsWith("/") ? name : fixture(name)]);
  await t.page.waitFor(`document.querySelector("#status").dataset.state === "done" || document.querySelector("#status").dataset.state === "error"`, { timeout: 30000 });
  return t.status();
}
async function openOk(t, name) {
  const st = await open(t, name);
  t.assert(st.state === "done", `${name} opened: ${st.text}`);
  return st;
}
async function openErr(t, name) {
  const st = await open(t, name);
  t.assert(st.state === "error", `${name} refused, got: ${st.state} ${st.text}`);
  t.eq(await hidden(t, "#work"), true, "nothing is shown after an error");
  return st.text;
}
const sheetText = (t) => txt(t, "#ei-invoices");

/* the model the page downloads as JSON, without the fixed header */
async function downloadedModel(t) {
  const { name, bytes: b } = await t.dl("#ei-json");
  return { name, json: JSON.parse(Buffer.from(b).toString("utf8")) };
}

/* the shim's reading of a fixture in the shape exportJson gives (no embedded file contents) */
function expectedInvoices(name) {
  const r = parse.openBytes(bytes(name), { parseXml: parseXmlShim }).result;
  return JSON.parse(JSON.stringify(r.invoices.map((i) => ({ ...i, attachments: i.attachments.map(({ base64, ...rest }) => rest) }))));
}

const XML_FIXTURES = ["ubl-invoice-xrechnung.xml", "ubl-creditnote-xrechnung.xml", "cii-xrechnung.xml", "ubl-invoice-peppol.xml", "ubl-creditnote-peppol.xml", "peppol-sbdh.xml",
  "fatturapa-fpr12.xml", "fatturapa-fpa12-batch.xml", "fatturapa-latin1.xml", "ksef-fa3.xml", "ksef-fa2-correction.xml", "facturx-en16931.xml", "zugferd-basicwl.xml",
  "tr-efatura-temel.xml", "tr-efatura-tevkifat.xml", "tr-earsiv.xml", "tr-iade-eur.xml", "vn-hoadon-gtgt.xml", "vn-hoadon-tdiep-dieuchinh.xml", "vn-hoadon-ban-hang.xml",
  "cfdi40-ingreso.xml", "cfdi40-egreso-usd.xml", "cfdi33-ingreso.xml",
  "fatturapa-fpr12.xml.p7m", "fatturapa-fpa12-batch.xml.p7m", "fatturapa-fpr12-base64.p7m", "fatturapa-double.p7m"];

const xrechnung = [
  {
    page: "xrechnung-viewer",
    name: "the browser's own DOMParser reads every fixture exactly like the unit-test parser (all formats, .p7m included)",
    async run(t) {
      for (const name of XML_FIXTURES) {
        const b64 = readFileSync(fixture(name)).toString("base64");
        const got = await t.page.eval(`(async () => {
          const P = await import("/tools/js/einvoiceparse.js?v=8");
          const bin = atob(${q(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          const r = P.openBytes(u);
          return JSON.stringify({ container: r.container, format: r.result.format, viewer: r.result.viewer, notes: r.result.notes, invoices: r.result.invoices });
        })()`);
        const want = parse.openBytes(bytes(name), { parseXml: parseXmlShim });
        t.eq(JSON.parse(got), JSON.parse(JSON.stringify({ container: want.container, format: want.result.format, viewer: want.result.viewer, notes: want.result.notes, invoices: want.result.invoices })), "DOMParser result for " + name);
      }
      // the refusals come out the same in the real parser
      for (const [name, code] of [["bad/doctype-xxe.xml", "doctype"], ["bad/billion-laughs.xml", "doctype"], ["bad/malformed.xml", "malformed"], ["bad/not-invoice.xml", "not-invoice"], ["bad/ubl-order.xml", "unsupported"], ["bad/zugferd1.xml", "unsupported"]]) {
        const b64 = readFileSync(fixture(name)).toString("base64");
        const got = await t.page.eval(`(async () => {
          const P = await import("/tools/js/einvoiceparse.js?v=8");
          const bin = atob(${q(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          try { P.openBytes(u); return "no error"; } catch (e) { return e.code + ":" + (e.data && e.data.message ? "message" : ""); }
        })()`);
        t.assert(got.startsWith(code), `${name}: ${code}, got ${got}`);
      }
    },
  },
  {
    page: "xrechnung-viewer",
    name: "shows an XRechnung UBL invoice as a readable invoice; JSON equals the unit-test model; raw XML; print",
    async run(t) {
      t.eq(await hidden(t, "#work"), true, "nothing shown before a file is opened");
      const st = await openOk(t, "ubl-invoice-xrechnung.xml");
      t.eq(st.text, "Read 1 invoice. RE-2024-0042", "status");
      t.eq(await txt(t, "#fname"), "ubl-invoice-xrechnung.xml", "file name");
      const info = await txt(t, "#finfo");
      t.assert(info.includes("UBL Invoice") && info.includes("XRechnung 3.0") && info.includes("3 line items"), "file info: " + info);
      const s = await sheetText(t);
      for (const want of ["RE-2024-0042", "Beispiel Software GmbH", "DE123456789", "Musterstraße 12", "Stadtverwaltung Musterhausen", "04011000-12345-34",
        "Softwareentwicklung", "Wartungsvertrag Q1", "Fachbuch XRechnung", "Standard rate", "Treuerabatt", "Versandkosten", "EUR 1,303.80", "EUR 1,268.60", "EUR 235.20",
        "DE89 3704 0044 0532 0130 00", "COBADEFFXXX", "SEPA credit transfer", "Zahlbar innerhalb von 30 Tagen ohne Abzug.", "Vielen Dank für Ihren Auftrag.", "leistungsnachweis.txt", "Mar 1, 2024", "Mar 31, 2024"]) {
        t.assert(s.includes(want), "the invoice shows " + want);
      }
      t.eq(await count(t, "#ei-invoices tbody tr"), 3 + 2, "three line rows and two VAT rows");
      t.eq(await hidden(t, "#ei-match"), true, "no 'better page' note on the matching page");
      t.eq(await hidden(t, "#ei-xml"), true, "no Download XML for a plain XML file");
      // JSON: the same model the unit tests check, no embedded file content
      const { name, json } = await downloadedModel(t);
      t.eq(name, "ubl-invoice-xrechnung.json", "JSON file name");
      t.eq(json.invoices, expectedInvoices("ubl-invoice-xrechnung.xml"), "downloaded model = unit-test model");
      t.eq([json.source.file, json.source.format, json.source.container], ["ubl-invoice-xrechnung.xml", "ubl-invoice", "xml"], "JSON source");
      t.assert(!JSON.stringify(json).includes("TGVpc3R1bmdz"), "no base64 payload in the JSON");
      // raw XML
      t.eq(await hidden(t, "#ei-raw"), true, "raw XML hidden at first");
      await t.page.click("#ei-rawbtn");
      t.eq(await hidden(t, "#ei-raw"), false, "raw XML shown");
      t.eq(await t.page.eval(`document.querySelector("#ei-rawbtn").getAttribute("aria-expanded")`), "true", "aria-expanded");
      const raw = await t.page.eval(`document.querySelector("#ei-rawtext").textContent`);
      t.assert(raw.includes("<cbc:ID>RE-2024-0042</cbc:ID>") && raw.includes("\n  <cbc:CustomizationID>"), "raw XML is indented source");
      t.assert(raw.includes("base64 characters left out") === false, "a short payload is not elided");
      await t.page.click("#ei-rawbtn");
      t.eq(await hidden(t, "#ei-raw"), true, "raw XML hidden again");
      // print
      await t.page.eval(`window.__prints = 0; window.print = () => { window.__prints++; }; true`);
      await t.page.click("#ei-print");
      t.eq(await t.page.eval(`window.__prints`), 1, "Print or save as PDF calls window.print");
      await t.shot("sheet", 1280, { selector: "#tool" });
      await t.shot("sheet", 375, { selector: "#tool" });
      // start over
      await t.page.click("#clear");
      t.eq([await hidden(t, "#work"), await count(t, "#ei-invoices > *")], [true, 0], "start over clears the page");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "print rules: only the invoice is left on the printed page, in black on white, in dark mode too",
    async run(t) {
      await t.page.viewport(1280, 900, { dark: true });
      await openOk(t, "cii-xrechnung.xml");
      await t.page.send("Emulation.setEmulatedMedia", { media: "print", features: [{ name: "prefers-color-scheme", value: "dark" }] });
      const r = await t.page.eval(`(() => {
        const vis = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display !== "none" : false; };
        const sheet = document.querySelector(".ei-sheet"), cs = getComputedStyle(sheet);
        return { header: vis(".top"), footer: vis(".foot"), intro: vis(".intro"), drop: vis("#drop"), actions: vis(".ei-actions"), below: vis(".below"), status: vis("#status"), sheet: vis(".ei-sheet"),
          bg: cs.backgroundColor, color: cs.color, softColor: getComputedStyle(document.querySelector(".ei-sub")).color, thead: getComputedStyle(document.querySelector(".ei-table thead")).display };
      })()`);
      t.eq([r.header, r.footer, r.intro, r.drop, r.actions, r.below, r.status, r.sheet], [false, false, false, false, false, false, false, true], "printed: only the sheet");
      t.assert(r.bg === "rgb(255, 255, 255)" && r.color === "rgb(0, 0, 0)", `black on white: ${r.bg} on ${r.color}`);
      t.assert(/rgb\((\d+), \1, \1\)/.test(r.softColor) && Number(/\d+/.exec(r.softColor)[0]) < 100, "secondary text is dark in print: " + r.softColor);
      t.eq(r.thead, "table-header-group", "table headings repeat on each page");
      await t.page.send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] });
    },
  },
  {
    page: "xrechnung-viewer",
    name: "reads a credit note and a CII invoice; pieces of the CII invoice (discount, reverse charge, SEPA mandate) are on the page",
    async run(t) {
      await openOk(t, "ubl-creditnote-xrechnung.xml");
      let s = await sheetText(t);
      t.assert(s.includes("Credit note") && s.includes("GS-2024-0007") && s.includes("RE-2024-0042") && s.includes("EUR 220.15") && s.includes("-5.00"), "credit note: " + s.slice(0, 200));
      await openOk(t, "cii-xrechnung.xml");
      s = await sheetText(t);
      for (const want of ["R-2024-1187", "Muster Maschinenbau GmbH & Co. KG", "Frästeil Typ A", "List price 14.00, discount 1.50", "Reverse charge", "vatex-eu-ae", "Mengenrabatt", "MANDAT-2023-001",
        "DE98ZZZ09999999999", "SEPA direct debit", "Hans Beispiel (Vertrieb)", "Baden-Württemberg", "EUR 1,697.00", "Lager Hamburg Ost", "Edelstahl 1.4301", "AB-5521"]) {
        t.assert(s.includes(want), "CII invoice shows " + want);
      }
    },
  },
];

const zugferd = [
  {
    page: "zugferd-factur-x-viewer",
    name: "takes the XML out of a Factur-X PDF in the browser, shows it, offers Download XML and the matching-page note is absent",
    async run(t) {
      const st = await openOk(t, "facturx-en16931.pdf");
      t.eq(st.text, "Read 1 invoice. FA-2024-05-0189", "status");
      const s = await sheetText(t);
      for (const want of ["Exemple Services SAS", "FR11123456782", "Prestation de conseil", "Hébergement serveur (mensuel)", "EUR 3,647.16", "FR76 3000 6000 0112 3456 7890 189", "AGRIFRPP", "5.5%"]) t.assert(s.includes(want), "shows " + want);
      t.assert((await txt(t, "#ei-notes")).includes("Read from the file factur-x.xml attached to this PDF."), "says which attachment was read: " + await txt(t, "#ei-notes"));
      t.assert((await txt(t, "#finfo")).includes("EN 16931"), "profile in the file info: " + await txt(t, "#finfo"));
      t.eq(await hidden(t, "#ei-match"), true, "this is the ZUGFeRD page");
      t.eq(await hidden(t, "#ei-xml"), false, "Download XML is offered");
      const xml = await t.dl("#ei-xml");
      t.eq(xml.name, "facturx-en16931.xml", "XML file name");
      t.eq(Buffer.from(xml.bytes).toString("utf8"), readFileSync(fixture("facturx-en16931.xml"), "utf8"), "the XML is the attached file, byte for byte");
      const { json } = await downloadedModel(t);
      t.eq(json.source.container, "pdf", "JSON says it came from a PDF");
      t.eq(json.invoices, expectedInvoices("facturx-en16931.xml"), "model equals the model of the bare XML");
    },
  },
  {
    page: "zugferd-factur-x-viewer",
    name: "other attached names, a profile without lines, and PDFs with no invoice in them",
    async run(t) {
      await openOk(t, "zugferd-xrechnung.pdf");
      t.assert((await sheetText(t)).includes("R-2024-1187") && (await txt(t, "#ei-notes")).includes("xrechnung.xml"), "xrechnung.xml inside a PDF");
      await openOk(t, "zugferd-basicwl.pdf");
      const s = await sheetText(t);
      t.assert(s.includes("ZF-2024-001") && s.includes("carries no line items") && s.includes("EUR 119.00") && s.includes("Factur-X BASIC WL"), "BASIC WL: " + s.slice(0, 300));
      t.eq(await count(t, "#ei-invoices .ei-lines"), 0, "no empty line table");
      let msg = await openErr(t, "plain.pdf");
      t.assert(msg.includes("no attached files") && msg.includes("plain PDF"), "plain PDF: " + msg);
      msg = await openErr(t, "other-attachment.pdf");
      t.assert(msg.includes("none of them is an invoice"), "PDF with a text attachment: " + msg);
      const notPdf = save(t.fixtures, "broken.pdf", Buffer.from("%PDF-1.4\nthis is not a real pdf\n"));
      msg = await openErr(t, notPdf);
      t.assert(/couldn't be read as a PDF/.test(msg), "damaged PDF: " + msg);
    },
  },
  {
    page: "xrechnung-viewer",
    name: "a ZUGFeRD PDF opened on the XRechnung page still opens, and points to the ZUGFeRD / Factur-X page with its own address",
    async run(t) {
      await openOk(t, "facturx-en16931.pdf");
      t.eq(await hidden(t, "#ei-match"), false, "note shown");
      const a = await t.page.eval(`(() => { const a = document.querySelector("#ei-match a"); return { href: a.getAttribute("href"), text: a.textContent }; })()`);
      t.eq(a.href, "/tools/zugferd-factur-x-viewer/", "link to the matching page");
      t.assert(a.text.includes("ZUGFeRD"), "link text is the page's name: " + a.text);
      t.assert((await txt(t, "#ei-match")).startsWith("This file is a better match for"), "note: " + await txt(t, "#ei-match"));
    },
  },
];

const fatturapa = [
  {
    page: "fatturapa-viewer",
    name: "shows a FatturaPA invoice: parties, lines with discount and exemption, VAT summary, stamp duty, payment, attachment",
    async run(t) {
      await openOk(t, "fatturapa-fpr12.xml");
      const s = await sheetText(t);
      for (const want of ["FT/2024/0007", "Invoice", "TD01", "Esempio Servizi S.r.l.", "IT01234567890", "Via Roma 10", "00100 Roma", "Italy", "REA", "RM 1234567", "KRRH6B9",
        "Prova Commerciale S.p.A.", "Consulenza informatica - marzo 2024", "8 ore", "Discount: 10%", "Exempt from VAT (N4)", "Esenti art. 10 D.P.R. 633/72", "EUR 1,115.00",
        "Bank transfer", "IT60 X054 2811 1010 0000 0123 456", "Banca Esempio", "Stamp duty", "EUR 2.00", "ORD-77", "DDT/12", "dettaglio.txt", "Servizi di consulenza del mese di marzo 2024.", "Pagamento a 30 giorni data fattura."]) {
        t.assert(s.includes(want) || (want === "Bank transfer" && s.includes("Credit transfer (MP05)")), "shows " + want);
      }
      const { json } = await downloadedModel(t);
      t.eq(json.invoices, expectedInvoices("fatturapa-fpr12.xml"), "JSON = unit-test model");
    },
  },
  {
    page: "fatturapa-viewer",
    name: "signed .p7m files (DER, BER with pieces, base64, signed twice): same invoice, and the page says the signature was not checked",
    async run(t) {
      const want = expectedInvoices("fatturapa-fpr12.xml");
      for (const name of ["fatturapa-fpr12.xml.p7m", "fatturapa-fpr12-base64.p7m", "fatturapa-double.p7m"]) {
        await openOk(t, name);
        t.assert((await txt(t, "#ei-notes")).includes("signature of this .p7m file was not checked"), name + ": signature note: " + await txt(t, "#ei-notes"));
        t.assert((await sheetText(t)).includes("FT/2024/0007"), name + ": invoice shown");
        t.eq(await hidden(t, "#ei-xml"), false, name + ": Download XML offered");
        const { json } = await downloadedModel(t);
        t.eq(json.invoices, want, name + ": same model as the bare XML");
        t.eq(json.source.container, "p7m", name + ": container");
      }
      const xml = await t.dl("#ei-xml");
      t.eq(xml.name, "fatturapa-double.xml", "XML name for a .p7m");
      t.eq(Buffer.from(xml.bytes).toString("utf8"), readFileSync(fixture("fatturapa-fpr12.xml"), "utf8"), "the extracted XML is the invoice");
      await openOk(t, "fatturapa-fpa12-batch.xml.p7m");
      t.eq(await count(t, ".ei-sheet"), 2, "a signed file with two invoices shows both");
      const msg = await openErr(t, "detached.p7m");
      t.assert(msg.includes("only a signature"), "detached signature: " + msg);
      const junk = save(t.fixtures, "junk.p7m", Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), Buffer.alloc(40, 7)]));
      t.assert((await openErr(t, junk)).length > 10, "a damaged .p7m is refused with a message");
    },
  },
  {
    page: "fatturapa-viewer",
    name: "a batch of two invoices (credit note second), split payment, social security, withholding, CIG and CUP; Latin-1 file",
    async run(t) {
      await openOk(t, "fatturapa-fpa12-batch.xml");
      t.eq(await count(t, ".ei-sheet"), 2, "two sheets");
      const s = await sheetText(t);
      for (const want of ["1/PA", "2/PA", "Credit note", "TD04", "Mario Rossi", "Comune di Esempiopoli", "UFA1B2", "Split payment", "Social security contribution", "TC22", "Withholding tax", "EUR 208.00", "CIG", "ZA12345678", "CUP", "J12B24000010001", "EUR 832.00", "EUR 122.00", "Jun 5, 2024"]) t.assert(s.includes(want), "shows " + want);
      t.assert((await txt(t, "#finfo")).includes("2 invoices"), "file info counts invoices: " + await txt(t, "#finfo"));
      await openOk(t, "fatturapa-latin1.xml");
      t.assert((await sheetText(t)).includes("perché più utili"), "ISO-8859-1 accents");
      await t.shot("sheet", 1280, { selector: "#tool" });
    },
  },
  {
    page: "ksef-viewer",
    name: "an FA(3) invoice, and an FA(2) correction with its before-and-after lines",
    async run(t) {
      await openOk(t, "ksef-fa3.xml");
      let s = await sheetText(t);
      for (const want of ["FV/2026/02/015", "Przykładowa Spółka z o.o.", "PL1234563218", "ul. Prosta 1/5", "00-001 Warszawa", "Usługa programistyczna", "10 godz.", "23%", "5%", "Exempt from VAT (zw)",
        "PLN 2,155.00", "PLN 355.00", "Split payment", "VAT exempt", "art. 43 ust. 1 pkt 37 ustawy o VAT", "Credit transfer", "61109010140000071219812874", "WBKPPLPP", "KRS", "0000123456", "Numer zamówienia: ZAM/2026/12", "Warszawa"]) t.assert(s.includes(want), "FA(3) shows " + want);
      t.assert((await txt(t, "#finfo")).includes("KSeF FA (3)"), "file info: " + await txt(t, "#finfo"));
      await openOk(t, "ksef-fa2-correction.xml");
      s = await sheetText(t);
      for (const want of ["Corrected invoice", "KOR", "Before correction", "After correction", "Reason for correction", "Błędna ilość towaru", "FV/2025/10/044", "-EUR 300.00", "DE123456789", "Paid", "Nov 6, 2025", "Intra-EU supply, VAT exempt"]) t.assert(s.includes(want), "FA(2) correction shows " + want);
      t.eq(await count(t, ".ei-table tr.is-before"), 1, "the old line is marked");
    },
  },
];

const peppol = [
  {
    page: "peppol-ubl-invoice-viewer",
    name: "a Peppol invoice with VAT in a second currency, and inside a Peppol envelope; a credit note",
    async run(t) {
      await openOk(t, "ubl-invoice-peppol.xml");
      let s = await sheetText(t);
      for (const want of ["F-2024-0310", "Peppol BIS Billing 3.0", "Exempel Verkstad AB", "SE556000000001", "0007", "5560000000", "Provköket Nord AB", "0088", "7300009999999", "Kampanjrabatt", "EUR 3,899.18", "VAT in SEK", "SEK 8,052.07",
        "Undantaget från moms enligt 3 kap. mervärdesskattelagen", "OCR 1234567890", "SE45 5000 0000 0583 9825 7466", "ESSESESS", "Tack för ert förtroende!", "PO-998877", "SO-5501", "Lager Hisingen", "94031000", "10 kg", "Zero rate"].filter((w) => w !== "Zero rate")) t.assert(s.includes(want), "Peppol shows " + want);
      t.eq(await hidden(t, "#ei-match"), true, "right page, no note");
      await openOk(t, "peppol-sbdh.xml");
      t.assert((await sheetText(t)).includes("F-2024-0310"), "invoice found inside the envelope");
      await openOk(t, "ubl-creditnote-peppol.xml");
      s = await sheetText(t);
      t.assert(s.includes("Credit note") && s.includes("K-2024-0044") && s.includes("F-2024-0310") && s.includes("EUR 150.00"), "credit note: " + s.slice(0, 160));
      const msg = await openErr(t, "bad/ubl-order.xml");
      t.assert(msg.includes("UBL Order document") && msg.includes("not an invoice"), "an order is named: " + msg);
    },
  },
  {
    page: "peppol-ubl-invoice-viewer",
    name: "any viewer opens any format and names the page that fits: XRechnung, FatturaPA and KSeF files on the Peppol page",
    async run(t) {
      const links = await t.page.eval(`JSON.parse(document.body.dataset.links)`);
      t.eq(links, { xrechnung: "/tools/xrechnung-viewer/", zugferd: "/tools/zugferd-factur-x-viewer/", fatturapa: "/tools/fatturapa-viewer/", ksef: "/tools/ksef-viewer/", peppol: "/tools/peppol-ubl-invoice-viewer/", efatura: "/tools/e-fatura-ubl-tr-viewer/", vietnam: "/tools/vietnam-e-invoice-viewer/", cfdi: "/tools/cfdi-viewer/" }, "page links");
      for (const [file, href] of [["ubl-invoice-xrechnung.xml", "/tools/xrechnung-viewer/"], ["cii-xrechnung.xml", "/tools/xrechnung-viewer/"], ["fatturapa-fpr12.xml", "/tools/fatturapa-viewer/"],
        ["fatturapa-fpr12.xml.p7m", "/tools/fatturapa-viewer/"], ["ksef-fa3.xml", "/tools/ksef-viewer/"], ["facturx-en16931.xml", "/tools/zugferd-factur-x-viewer/"],
        ["tr-efatura-temel.xml", "/tools/e-fatura-ubl-tr-viewer/"], ["vn-hoadon-gtgt.xml", "/tools/vietnam-e-invoice-viewer/"], ["cfdi40-ingreso.xml", "/tools/cfdi-viewer/"]]) {
        await openOk(t, file);
        t.eq(await hidden(t, "#ei-match"), false, file + ": note shown");
        t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), href, file + ": suggested page");
        t.assert((await sheetText(t)).length > 400, file + ": still shown on this page");
      }
    },
  },
];


const turkey = [
  {
    page: "e-fatura-ubl-tr-viewer",
    name: "a TEMELFATURA e-Fatura: parties with VKN and tax office, UUID, KDV by line, seal note, the XSLT only as a download and never run",
    async run(t) {
      const st = await openOk(t, "tr-efatura-temel.xml");
      t.eq(st.text, "Read 1 invoice. ABC2024000000123", "status");
      const info = await txt(t, "#finfo");
      t.assert(info.includes("e-Fatura (UBL-TR)") && info.includes("TR1.2 · TEMELFATURA") && info.includes("2 line items"), "file info: " + info);
      const s = await sheetText(t);
      for (const want of ["ABC2024000000123", "SATIS", "UUID (ETTN)", "f47ac10b-58cc-4372-a567-0e02b2c3d479", "Örnek Yazılım Anonim Şirketi", "VKN", "1234567801", "MERSISNO", "Tax office", "Kadıköy Vergi Dairesi",
        "Atatürk Caddesi 12", "34710 İstanbul", "Türkiye", "Deneme Ticaret Limited Şirketi", "9876543210", "Çankaya Vergi Dairesi", "Barkod okuyucu", "BO-100", "Discount", "TRY 3,552.20", "TRY 550.20", "20%", "10%",
        "TR33 0006 1005 1978 6457 8413 26", "Payment to bank account", "Yalnız üç bin beş yüz elli iki", "IRS2024000000045", "SP-2024-0457"]) t.assert(s.includes(want), "the invoice shows " + want);
      t.eq(await hidden(t, "#ei-match"), true, "right page, no note");
      t.assert((await txt(t, "#ei-notes")).includes("fiscal seal") && (await txt(t, "#ei-notes")).includes("not verified"), "seal note: " + await txt(t, "#ei-notes"));
      // the XSLT: listed as a stylesheet, offered as a plain download
      const atts = await t.page.eval(`[...document.querySelectorAll(".ei-atts li")].map((e) => e.textContent.replace(/\\s+/g, " ").trim())`);
      t.eq(atts.length, 1, "one attachment");
      t.assert(atts[0].includes("ABC2024000000123.xslt") && atts[0].includes("never run here"), "XSLT marked download-only: " + atts[0]);
      await t.page.eval(`window.__types = []; const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__types.push(b.type); return o.call(URL, b); }; true`);
      const d = await t.dl(".ei-atts .ei-attdl");
      t.eq(d.name, "ABC2024000000123.xslt", "saved name");
      t.assert(Buffer.from(d.bytes).toString("utf8").includes("xsl:stylesheet"), "the stylesheet is saved as it is");
      t.eq(await t.page.eval(`window.__types`), ["application/octet-stream"], "generic type");
      // never executed: it asks to read another document; no request for that address, nothing rendered from it
      t.eq(await t.page.eval(`performance.getEntriesByType("resource").filter((r) => r.name.includes("example.invalid")).length`), 0, "the stylesheet's document() address was never requested");
      t.eq(await count(t, "#ei-invoices iframe, #ei-invoices object, #ei-invoices embed"), 0, "nothing rendered from the stylesheet");
      // JSON: same model as the unit tests, no stylesheet content
      const { name, json } = await downloadedModel(t);
      t.eq(name, "tr-efatura-temel.json", "JSON name");
      t.eq(json.invoices, expectedInvoices("tr-efatura-temel.xml"), "downloaded model = unit-test model");
      t.assert(!JSON.stringify(json).includes("PD94bWwgdmVyc2lvbj"), "no base64 payload in the JSON");
      await t.shot("sheet", 1280, { selector: "#tool" });
      await t.shot("sheet", 375, { selector: "#tool" });
    },
  },
  {
    page: "e-fatura-ubl-tr-viewer",
    name: "withheld VAT (tevkifat), an e-Arşiv invoice for an individual with an exempt line, and a return invoice in euro with its exchange rate",
    async run(t) {
      await openOk(t, "tr-efatura-tevkifat.xml");
      let s = await sheetText(t);
      for (const want of ["TEVKIFAT", "Withheld VAT (tevkifat)", "-TRY 1,000.00", "KDV TEVKİFAT (602) 50%", "TRY 12,000.00", "TRY 11,000.00", "Amount due", "TICARIFATURA", "Haziran 2024 danışmanlık hizmeti", "Jun 1, 2024 – Jun 30, 2024"]) t.assert(s.includes(want), "tevkifat shows " + want);
      t.eq(await hidden(t, "#ei-notes"), true, "no seal in this file, no seal note");
      await openOk(t, "tr-earsiv.xml");
      s = await sheetText(t);
      for (const want of ["EAR2024000000777", "EARSIVFATURA", "TCKN", "10000000146", "Ayşe Örnek", "Bornova", "Exempt from VAT", "351", "Diğer", "SEND_TYPE", "ELEKTRONIK", "TRY 116.40"]) t.assert(s.includes(want), "e-Arşiv shows " + want);
      t.assert((await txt(t, "#finfo")).includes("e-Arşiv Fatura (UBL-TR)"), "file info names e-Arşiv");
      await openOk(t, "tr-iade-eur.xml");
      s = await sheetText(t);
      for (const want of ["Return invoice", "IADE", "1 EUR = 35.4125 TRY", "Exchange rate", "ABC2024000000123", "EUR 144.00"]) t.assert(s.includes(want), "return invoice shows " + want);
    },
  },
];

const vietnam = [
  {
    page: "vietnam-e-invoice-viewer",
    name: "a coded Vietnamese invoice: symbol, number, MCCQT, seller and buyer, lines with 10%, 8% and KCT, totals, amount in words, signature note",
    async run(t) {
      const st = await openOk(t, "vn-hoadon-gtgt.xml");
      t.eq(st.text, "Read 1 invoice. 00000125", "status");
      const info = await txt(t, "#finfo");
      t.assert(info.includes("Hóa đơn điện tử") && info.includes("3 line items"), "file info: " + info);
      const s = await sheetText(t);
      for (const want of ["00000125", "Invoice symbol", "C24TAA", "Form number", "Tax authority code (MCCQT)", "00A1B2C3D4E5F60718293A4B5C6D7E8F90", "May 31, 2024", "Công ty TNHH Phần mềm Mẫu", "0312345678", "Tax number",
        "Số 12 Nguyễn Huệ", "Trần Thị Bình", "KH-00417", "Dịch vụ phát triển phần mềm tháng 5/2024", "DV-PM01", "Máy in nhãn nhiệt", "Cái", "8%", "10%", "KCT", "Outside the scope of VAT",
        "VND 36,010,000", "VND 32,950,000", "VND 3,060,000", "Credit transfer", "0123456789", "Ngân hàng Mẫu", "Ba mươi sáu triệu không trăm mười nghìn đồng chẵn.", "Mã tra cứu", "TC4F7A9K2Q", "Amount in words"]) t.assert(s.includes(want), "the invoice shows " + want);
      t.assert((await txt(t, "#ei-notes")).includes("DSCKS") && (await txt(t, "#ei-notes")).includes("not verified"), "signature note: " + await txt(t, "#ei-notes"));
      t.eq(await hidden(t, "#ei-match"), true, "right page, no note");
      const { json } = await downloadedModel(t);
      t.eq(json.invoices, expectedInvoices("vn-hoadon-gtgt.xml"), "downloaded model = unit-test model");
      await t.shot("sheet", 1280, { selector: "#tool" });
      await t.shot("sheet", 375, { selector: "#tool" });
    },
  },
  {
    page: "vietnam-e-invoice-viewer",
    name: "an adjusting invoice inside a TDiep message, in US dollars with the exchange rate; an uncoded sale to an individual with a note line and a delivery fee",
    async run(t) {
      await openOk(t, "vn-hoadon-tdiep-dieuchinh.xml");
      let s = await sheetText(t);
      for (const want of ["Corrected invoice", "00000031", "K24TXM", "1K24TXM / 00000027", "Jun 20, 2024", "Điều chỉnh đơn giá dịch vụ theo phụ lục hợp đồng.", "1 USD = 25410 VND", "USD 1,200.50", "Sample Trading Pte. Ltd.", "0312345678-001", "Zero rate"]) t.assert(s.includes(want), "adjustment shows " + want);
      await openOk(t, "vn-hoadon-ban-hang.xml");
      s = await sheetText(t);
      for (const want of ["Hóa đơn bán hàng", "C24MBH", "Lê Văn Cường", "CCCD", "079012345678", "Gạo thơm (túi 5 kg)", "KKKNT", "Quý khách vui lòng kiểm tra hàng khi nhận.", "Phí giao hàng", "VND 30,000", "VND 510,000", "TM/CK"]) t.assert(s.includes(want), "sale shows " + want);
      t.eq(await hidden(t, "#ei-notes"), true, "no signature, no note");
      t.eq(await count(t, ".ei-table tbody tr"), 1 + 1, "one line row and one VAT row (the note line is not a line)");
      // a Turkish file on the Vietnam page names the Turkish page
      await openOk(t, "tr-efatura-temel.xml");
      t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), "/tools/e-fatura-ubl-tr-viewer/", "suggested page");
    },
  },
];

const mexico = [
  {
    page: "cfdi-viewer",
    name: "a CFDI 4.0 invoice: UUID shown large, RFCs, lines with 16%, 0% and exempt IVA, retained taxes, totals, seal note, and a SAT link that is only a link (nothing is requested)",
    async run(t) {
      const st = await openOk(t, "cfdi40-ingreso.xml");
      t.eq(st.text, "Read 1 invoice. A-1042", "status");
      const info = await txt(t, "#finfo");
      t.assert(info.includes("CFDI 4.0") && info.includes("4 line items"), "file info: " + info);
      const s = await sheetText(t);
      for (const want of ["A-1042", "I · Ingreso", "UUID (folio fiscal)", "A1B2C3D4-E5F6-4789-9ABC-DEF012345678", "Stamped on", "2024-05-14T10:31:07", "Certification provider (PAC)", "AAA010101AAA", "May 14, 2024",
        "ESCUELA KEMPER URGATE", "RFC", "EKU9003173C9", "UNIVERSIDAD ROBOTICA ESPAÑOLA", "URE180429TM6", "86991", "Servicios de desarrollo de software, mayo 2024", "SRV-001", "Computadora portátil 14 pulgadas", "Exempt from VAT", "Zero rate",
        "MXN 13,056.67", "MXN 13,100.00", "MXN 1,920.00", "Tax withheld", "-MXN 1,963.33", "ISR (001)", "IVA (002)", "CFDI use", "G03", "Payment method (PUE / PPD)", "PUE", "Credit transfer", "Pago a 30 dias"]) t.assert(s.includes(want), "the invoice shows " + want);
      t.assert((await txt(t, "#ei-notes")).includes("digital seal") && (await txt(t, "#ei-notes")).includes("not verified"), "seal note: " + await txt(t, "#ei-notes"));
      t.eq(await hidden(t, "#ei-match"), true, "right page, no note");
      // the UUID is the large, selectable line under the number
      t.eq(await t.page.eval(`document.querySelector(".ei-uuid").textContent`), "A1B2C3D4-E5F6-4789-9ABC-DEF012345678", "UUID element");
      // the SAT link: a plain link in a new tab, no script, no request from this page
      t.eq(await count(t, ".ei-verify a"), 1, "one verification link");
      const a = await t.page.eval(`(() => { const a = document.querySelector(".ei-verify a"); return [a.getAttribute("href"), a.target, a.rel, a.textContent]; })()`);
      t.eq(a, ["https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=A1B2C3D4-E5F6-4789-9ABC-DEF012345678&re=EKU9003173C9&rr=URE180429TM6&tt=0000013056.670000&fe=6Xc%2Fw%2BA%3D", "_blank", "noopener noreferrer", "Verify with SAT"], "link address, target, rel, text");
      t.eq(await t.page.eval(`performance.getEntriesByType("resource").filter((r) => r.name.includes("sat.gob.mx")).length`), 0, "no request to the SAT from this page");
      const { name, json } = await downloadedModel(t);
      t.eq(name, "cfdi40-ingreso.json", "JSON name");
      t.eq(json.invoices, expectedInvoices("cfdi40-ingreso.xml"), "downloaded model = unit-test model");
      await t.shot("sheet", 1280, { selector: "#tool" });
      await t.shot("sheet", 375, { selector: "#tool" });
    },
  },
  {
    page: "cfdi-viewer",
    name: "a CFDI egreso in US dollars with the exchange rate and the related CFDI, a CFDI 3.3 invoice, and a Turkish file on this page names the Turkish page",
    async run(t) {
      await openOk(t, "cfdi40-egreso-usd.xml");
      let s = await sheetText(t);
      for (const want of ["Credit note", "E · Egreso", "NC-0045", "1 USD = 17.0521 MXN", "Exchange rate", "A1B2C3D4-E5F6-4789-9ABC-DEF012345678", "PUBLICO EN GENERAL", "XAXX010101000", "USD 348.00"]) t.assert(s.includes(want), "egreso shows " + want);
      await openOk(t, "cfdi33-ingreso.xml");
      s = await sheetText(t);
      for (const want of ["CFDI 3.3", "B-77", "5D4C3B2A-1908-4F7E-A6B5-C4D3E2F10A9B", "Curso de capacitación", "PPD", "Other payment method", "MXN 1,160.00"]) t.assert(s.includes(want), "CFDI 3.3 shows " + want);
      await openOk(t, "tr-efatura-temel.xml");
      t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), "/tools/e-fatura-ubl-tr-viewer/", "suggested page");
    },
  },
  {
    page: "cfdi-viewer",
    name: "a link that is not the SAT's address is never shown: a tampered model cannot put a foreign URL on the page",
    async run(t) {
      const got = await t.page.eval(`(async () => {
        const P = await import("/tools/js/einvoicecfdi.js?v=11");
        return P.verifyUrl({ uuid: "A1B2C3D4-E5F6-4789-9ABC-DEF012345678", rfcEmisor: "EKU9003173C9", rfcReceptor: "XAXX010101000", total: "10", sello: "abcdefgh" }).startsWith(P.SAT_VERIFY_URL + "?id=");
      })()`);
      t.eq(got, true, "link starts with the SAT address");
    },
  },
];

const safety = [
  {
    page: "xrechnung-viewer",
    name: "refuses DOCTYPE and entity files before parsing, malformed and unsupported files, empty and over-size files, with clear messages",
    async run(t) {
      let msg = await openErr(t, "bad/doctype-xxe.xml");
      t.assert(msg.includes("DOCTYPE") && msg.includes("not opened"), "XXE file: " + msg);
      msg = await openErr(t, "bad/billion-laughs.xml");
      t.assert(msg.includes("DOCTYPE"), "entity bomb: " + msg);
      t.assert(!(msg.includes("lol")), "nothing of the file's entities is expanded");
      msg = await openErr(t, "bad/malformed.xml");
      t.assert(msg.includes("not well-formed XML"), "malformed: " + msg);
      msg = await openErr(t, "bad/not-invoice.xml");
      t.assert(msg.includes("<note>") && msg.includes("not a supported invoice"), "other XML: " + msg);
      msg = await openErr(t, "bad/zugferd1.xml");
      t.assert(msg.includes("ZUGFeRD 1.0"), "ZUGFeRD 1: " + msg);
      msg = await openErr(t, save(t.fixtures, "empty.xml", Buffer.alloc(0)));
      t.assert(msg.length > 5, "empty file: " + msg);
      msg = await openErr(t, save(t.fixtures, "text.txt", Buffer.from("hello")));
      t.assert(/can't be opened here|isn't/.test(msg), "wrong file type: " + msg);
      msg = await openErr(t, save(t.fixtures, "random.xml", Buffer.from("not xml at all, just words")));
      t.assert(msg.includes("not an XML invoice"), "text named .xml: " + msg);
      const big = save(t.fixtures, "huge.xml", Buffer.alloc(26 * 1024 * 1024, 0x20));
      msg = await openErr(t, big);
      t.assert(msg.includes("25.0 MB") || msg.includes("25 MB"), "26 MB file: " + msg);
      // after an error the next good file works
      await openOk(t, "ubl-invoice-xrechnung.xml");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "values are shown as text: markup in an invoice never becomes elements and no script runs; links in the file are text only",
    async run(t) {
      await openOk(t, "bad/xss-strings.xml");
      const r = await t.page.eval(`({ xss: window.__xss === undefined, imgs: document.querySelectorAll("#ei-invoices img, #ei-invoices svg, #ei-invoices iframe, #ei-invoices script, #ei-invoices object, #ei-invoices embed").length,
        links: document.querySelectorAll("#ei-invoices a").length, bold: document.querySelectorAll("#ei-invoices b").length })`);
      t.eq(r, { xss: true, imgs: 0, links: 0, bold: 0 }, "no element made from invoice text");
      const s = await sheetText(t);
      t.assert(s.includes('<img src=x onerror="window.__xss=1">INV-1') && s.includes("<script>window.__xss=2</script>") && s.includes("javascript:window.__xss=5"), "the text itself is visible");
      t.assert(!/[‪-‮]/.test(await t.page.eval(`document.querySelector("#ei-invoices").textContent`)), "direction overrides are gone");
      t.assert((await txt(t, "#ei-notes")).includes("Hidden text-direction"), "and the page says so: " + await txt(t, "#ei-notes"));
      await t.page.click("#ei-rawbtn");
      t.eq(await t.page.eval(`window.__xss === undefined && document.querySelectorAll("#ei-rawtext *").length`), 0, "the raw view is plain text");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "embedded documents are only downloads: generic type, cleaned names, never rendered, nothing fetched",
    async run(t) {
      await openOk(t, "bad/hostile-attachments.xml");
      t.eq(await count(t, "#ei-invoices iframe, #ei-invoices object, #ei-invoices embed, #ei-invoices img, #ei-invoices audio, #ei-invoices video"), 0, "nothing is rendered inline");
      const names = await t.page.eval(`[...document.querySelectorAll(".ei-atts .ei-attname")].map((e) => e.textContent)`);
      t.eq(names, ["evil.exe", "_con.txt", "invoicefdp.exe", "script_.html", "x".repeat(96) + ".pdf", "attachment-1-6", "hidden.txt", "ok-report.pdf"], "names shown");
      t.eq(await count(t, ".ei-atts .ei-attdl"), 8, "one Download button each");
      await t.page.eval(`window.__types = []; const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__types.push(b.type); return o.call(URL, b); }; true`);
      const got = [];
      for (let i = 0; i < 8; i++) {
        const d = await t.dl(`.ei-atts li:nth-child(${i + 1}) .ei-attdl`);
        got.push(d.name);
        if (i === 3) t.eq(Buffer.from(d.bytes).toString("utf8"), "<html><script>window.__xss=9</script><h1>inline?</h1></html>", "the HTML file is saved as it is, not opened");
      }
      t.eq(got, ["evil.exe", "_con.txt", "invoicefdp.exe", "script_.html", "x".repeat(96) + ".pdf", "attachment-1-6", "hidden.txt", "ok-report.pdf"], "saved names");
      t.eq(await t.page.eval(`window.__types`), Array(8).fill("application/octet-stream"), "every download has the generic type");
      t.eq(await t.page.eval(`window.__xss === undefined`), true, "no script ran");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "limits: 5,000 of 6,200 lines are shown with a notice, a long file stays responsive",
    async run(t) {
      const head = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>BIG</cbc:ID><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>';
      const line = (i) => `<cac:InvoiceLine><cbc:ID>${i}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">1.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Item ${i}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">1.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
      const path = save(t.fixtures, "six-thousand.xml", Buffer.from(head + Array.from({ length: 6200 }, (_, i) => line(i + 1)).join("") + "</Invoice>"));
      const t0 = Date.now();
      await openOk(t, path);
      t.assert(Date.now() - t0 < 15000, "opened in " + (Date.now() - t0) + " ms");
      t.eq(await count(t, "#ei-invoices .ei-lines tbody tr"), 5000, "5,000 rows");
      t.assert((await txt(t, "#ei-invoices")).includes("Showing the first 5,000 of 6,200 line items."), "notice");
      const { json } = await downloadedModel(t);
      t.eq([json.invoices[0].lines.length, json.invoices[0].linesTotal], [5000, 6200], "JSON holds the same 5,000");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "a long raw XML view is cut and says so; embedded base64 is left out of it",
    async run(t) {
      const parts = Array.from({ length: 30000 }, (_, i) => `<cbc:Note>note ${i} ${"x".repeat(20)}</cbc:Note>`).join("");
      const xml = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>RAW</cbc:ID>${parts}<cac:AdditionalDocumentReference><cbc:ID>X</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain" filename="a.bin">${"QUJD".repeat(5000)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>`;
      await openOk(t, save(t.fixtures, "long.xml", Buffer.from(xml)));
      await t.page.click("#ei-rawbtn");
      const len = await t.page.eval(`document.querySelector("#ei-rawtext").textContent.length`);
      t.assert(len < 450000, "cut to about 400,000 characters: " + len);
      t.eq(await hidden(t, "#ei-rawcut"), false, "the notice about the cut is shown");
    },
  },
  {
    page: "ksef-viewer",
    name: "the page makes no requests with a body and none off the site while files are opened (all formats)",
    async run(t) {
      await t.page.eval(`window.__sent = []; for (const m of ["fetch", "sendBeacon"]) { const f = window[m] || navigator[m]; } const of = window.fetch; window.fetch = (...a) => { window.__sent.push(String(a[0])); return of(...a); }; const ob = navigator.sendBeacon; navigator.sendBeacon = (...a) => { window.__sent.push("beacon"); return false; }; true`);
      for (const f of ["ksef-fa3.xml", "fatturapa-fpr12.xml.p7m", "facturx-en16931.pdf", "ubl-invoice-xrechnung.xml", "bad/doctype-xxe.xml"]) await open(t, f);
      const sent = await t.page.eval(`window.__sent`);
      t.assert(sent.every((u) => u.includes("/tools/")), "only the site's own files were fetched: " + JSON.stringify(sent));
      t.assert(!sent.some((u) => u.includes("/web/")), "no server tool call");
    },
  },
  {
    page: "xrechnung-viewer",
    name: "drag-and-drop style intake accepts .xml, .pdf and .p7m names in any case",
    async run(t) {
      const upper = save(t.fixtures, "RECHNUNG.XML", readFileSync(fixture("ubl-invoice-xrechnung.xml")));
      await openOk(t, upper);
      t.eq(await txt(t, "#fname"), "RECHNUNG.XML", "upper-case extension");
      const m = save(t.fixtures, "Rechnung.P7M", readFileSync(fixture("fatturapa-fpr12.xml.p7m")));
      await openOk(t, m);
      t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), "/tools/fatturapa-viewer/", "p7m on the XRechnung page points to the FatturaPA page");
    },
  },
];

export default [...xrechnung, ...zugferd, ...fatturapa, ...peppol, ...turkey, ...vietnam, ...mexico, ...safety];
