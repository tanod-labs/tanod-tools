// Localized runs of the five e-invoice viewers, in every language by i18n.mjs: labels, status and refusal messages come from the page's
// language table, amounts, dates, percentages and units follow the locale, and the "better page for this file" link points at the
// localized address of the matching viewer. i18n.mjs adds the string-table and leftover-English checks to each.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { toolPath } from "../server.mjs";

const FX = fileURLToPath(new URL("../einvoice-fixtures/", import.meta.url));
const q = JSON.stringify;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const plural = (t, v, n) => (typeof v === "object" ? v[new Intl.PluralRules(t.lang).select(n)] ?? v.other : v);
const flat = (s) => String(s).replace(/\s+/g, " ").trim();
const sheet = (t) => t.page.eval(`document.querySelector("#ei-invoices").textContent.replace(/\\s+/g, " ").trim()`);

async function open(t, name) {
  await t.page.setFiles("#drop input[type=file]", [join(FX, name)]);
  await t.page.waitFor(`["done", "error"].includes(document.querySelector("#status").dataset.state)`, { timeout: 30000 });
  return t.status();
}
const money = (t, v, cur) => flat(new Intl.NumberFormat(t.lang, { style: "currency", currency: cur, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));
const date = (t, y, m, d) => flat(new Intl.DateTimeFormat(t.lang, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))));

async function common(t, file, number, labels) {
  const st = await open(t, file);
  t.assert(st.state === "done", "opened: " + st.text);
  const read = fill(plural(t, await t.tx("Read {n} invoice.|Read {n} invoices."), 1), { n: t.num(1) });
  t.eq(flat(st.text), `${read} ${number}`, "status in the page language");
  const s = await sheet(t);
  for (const key of ["Seller", "Buyer", "Amount due", "Payment", "Line items"]) {
    t.assert(s.toLowerCase().includes((await t.tx(key)).toLowerCase()), `label "${key}" translated: ${await t.tx(key)}`);
  }
  for (const w of labels) t.assert(s.includes(w), "shows " + w);
  return s;
}

export default [
  {
    page: "xrechnung-viewer",
    name: "XRechnung: labels, amounts and dates in the page language; the refusal of a DOCTYPE and the note pointing to the FatturaPA page are translated and localized",
    async run(t) {
      await common(t, "ubl-invoice-xrechnung.xml", "RE-2024-0042", [await t.tx("Invoice"), money(t, "1303.80", "EUR"), money(t, "1268.60", "EUR"), date(t, 2024, 3, 1), date(t, 2024, 3, 31)]);
      const vat = flat(new Intl.NumberFormat(t.lang, { style: "percent", maximumFractionDigits: 3 }).format(0.19));
      t.assert((await sheet(t)).includes(vat), "VAT rate formatted for the locale: " + vat);
      t.assert((await sheet(t)).includes(flat(new Intl.NumberFormat(t.lang, { style: "unit", unit: "hour", unitDisplay: "short" }).format(10))), "hours written the way the language writes them");
      // refusal text
      const st = await open(t, "bad/doctype-xxe.xml");
      t.eq(flat(st.text), flat(await t.tx("This file declares a DOCTYPE or an entity, so it was not opened. Real invoices never need one, and such declarations are how XML files are used to attack the programs that read them.")), "DOCTYPE message");
      // another format: the link goes to the localized address
      await open(t, "fatturapa-fpr12.xml");
      const href = await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`);
      t.eq(href, toolPath(t.lang, "fatturapa-viewer"), "link to the matching viewer in this language");
      const note = (await t.tx("This file is a better match for {link}.")).replace("{link}", await t.page.eval(`document.querySelector("#ei-match a").textContent`));
      t.eq(flat(await t.text("#ei-match")), flat(note), "the note is translated");
      await t.shot("sheet", 375);
    },
  },
  {
    page: "zugferd-factur-x-viewer",
    name: "ZUGFeRD / Factur-X: a PDF's invoice read in the page language, units and amounts localized, the name of the attached file noted",
    async run(t) {
      const s = await common(t, "facturx-en16931.pdf", "FA-2024-05-0189", [money(t, "3647.16", "EUR"), money(t, "4147.16", "EUR")]);
      const days = flat(new Intl.NumberFormat(t.lang, { style: "unit", unit: "day", unitDisplay: "short" }).format(5));
      t.assert(s.includes(days), "days: " + days);
      const note = fill(await t.tx("Read from the file {name} attached to this PDF."), { name: "factur-x.xml" });
      t.eq(flat(await t.text("#ei-notes")), flat(note), "attachment note");
      const msg = await open(t, "plain.pdf");
      t.eq(flat(msg.text), flat(await t.tx("This PDF has no attached files. It is a plain PDF, not a ZUGFeRD or Factur-X invoice, so there is no invoice data to show.")), "plain PDF message");
    },
  },
  {
    page: "fatturapa-viewer",
    name: "FatturaPA: a signed .p7m opened, the signature note, payment means and the split-payment batch in the page language",
    async run(t) {
      await common(t, "fatturapa-fpr12.xml.p7m", "FT/2024/0007", [money(t, "1115.00", "EUR"), date(t, 2024, 3, 15), await t.tx("Credit transfer")]);
      t.eq(flat(await t.text("#ei-notes")), flat(await t.tx("The digital signature of this .p7m file was not checked. This page only unwraps the XML; it does not say who signed it or whether it was changed.")), "signature note");
      await open(t, "fatturapa-fpa12-batch.xml");
      const s = await sheet(t);
      for (const key of ["Split payment", "Credit note", "Withholding tax", "Social security contribution"]) t.assert(s.includes(await t.tx(key)), `shows "${key}": ${await t.tx(key)}`);
      const n2 = fill(plural(t, await t.tx("{n} invoice|{n} invoices"), 2), { n: t.num(2) });
      t.assert(flat(await t.text("#finfo")).includes(n2), "file info counts invoices: " + n2);
    },
  },
  {
    page: "ksef-viewer",
    name: "KSeF: an FA(3) invoice and an FA(2) correction in the page language",
    async run(t) {
      await common(t, "ksef-fa3.xml", "FV/2026/02/015", [money(t, "2155.00", "PLN"), await t.tx("Split payment"), await t.tx("VAT exempt"), flat(new Intl.NumberFormat(t.lang, { style: "percent", maximumFractionDigits: 3 }).format(0.23))]);
      await open(t, "ksef-fa2-correction.xml");
      const s = await sheet(t);
      for (const key of ["Corrected invoice", "Before correction", "After correction", "Reason for correction"]) t.assert(s.includes(await t.tx(key)), `shows "${key}"`);
      t.assert(s.includes(fill(await t.tx("Paid on {date}"), { date: date(t, 2025, 11, 6) })), "paid on date, localized");
    },
  },
  {
    page: "peppol-ubl-invoice-viewer",
    name: "Peppol / UBL: VAT in a second currency, delivery and VAT categories in the page language",
    async run(t) {
      const s = await common(t, "ubl-invoice-peppol.xml", "F-2024-0310", [money(t, "3899.18", "EUR"), money(t, "8052.07", "SEK"), fill(await t.tx("VAT in {currency}"), { currency: "SEK" }), await t.tx("Exempt from VAT"), await t.tx("Delivery")]);
      t.assert(s.includes(t.num(10) + " kg"), "kilograms: " + t.num(10) + " kg");
      await open(t, "ubl-creditnote-peppol.xml");
      t.assert((await sheet(t)).includes(await t.tx("Credit note")), "credit note title");
    },
  },
  {
    page: "e-fatura-ubl-tr-viewer",
    name: "e-Fatura / UBL-TR: labels, amounts and dates in the page language; the fiscal-seal note, the stylesheet note, withheld VAT and the return invoice are translated",
    async run(t) {
      await common(t, "tr-efatura-temel.xml", "ABC2024000000123", [money(t, "3552.20", "TRY"), date(t, 2024, 5, 14), await t.tx("Tax office"), await t.tx("Payment to bank account"), "VKN", "f47ac10b-58cc-4372-a567-0e02b2c3d479"]);
      t.eq(flat(await t.text("#ei-notes")), flat(await t.tx("This invoice carries a fiscal seal or e-signature (mali mühür). It was not verified: this page does not say who sealed the invoice or whether it was changed.")), "seal note");
      t.assert((await sheet(t)).includes(flat(await t.tx("The sender's XSLT stylesheet for drawing this invoice. Download only: it is never run here."))), "stylesheet note");
      await open(t, "tr-efatura-tevkifat.xml");
      let s = await sheet(t);
      t.assert(s.includes(await t.tx("Withheld VAT (tevkifat)")), "withheld VAT label");
      await open(t, "tr-iade-eur.xml");
      s = await sheet(t);
      for (const key of ["Return invoice", "Exchange rate"]) t.assert(s.includes(await t.tx(key)), `shows "${key}": ${await t.tx(key)}`);
      await open(t, "vn-hoadon-gtgt.xml");
      const href = await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`);
      t.eq(href, toolPath(t.lang, "vietnam-e-invoice-viewer"), "link to the Vietnam viewer in this language");
    },
  },
  {
    page: "vietnam-e-invoice-viewer",
    name: "Vietnam e-invoice: labels, amounts and dates in the page language; the signature note, the codes and the adjusting invoice are translated",
    async run(t) {
      await common(t, "vn-hoadon-gtgt.xml", "00000125", [flat(new Intl.NumberFormat(t.lang, { style: "currency", currency: "VND", currencyDisplay: "code" }).format(36010000)), date(t, 2024, 5, 31), await t.tx("Invoice symbol"), await t.tx("Form number"), "C24TAA", "00A1B2C3D4E5F60718293A4B5C6D7E8F90", await t.tx("Amount in words")]);
      t.eq(flat(await t.text("#ei-notes")), flat(await t.tx("This invoice carries digital signatures (DSCKS). They were not verified: this page does not say who signed the invoice or whether it was changed.")), "signature note");
      await open(t, "vn-hoadon-tdiep-dieuchinh.xml");
      const s = await sheet(t);
      for (const key of ["Corrected invoice", "Exchange rate"]) t.assert(s.includes(await t.tx(key)), `shows "${key}": ${await t.tx(key)}`);
      await open(t, "tr-earsiv.xml");
      t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), toolPath(t.lang, "e-fatura-ubl-tr-viewer"), "link to the e-Fatura viewer in this language");
    },
  },
  {
    page: "cfdi-viewer",
    name: "Mexico CFDI: labels, amounts and dates in the page language; the UUID, the SAT link text, the seal note and the retained taxes are translated",
    async run(t) {
      await common(t, "cfdi40-ingreso.xml", "A-1042", [money(t, "13056.67", "MXN"), date(t, 2024, 5, 14), await t.tx("Stamped on"), await t.tx("Certification provider (PAC)"), await t.tx("CFDI use"), await t.tx("Credit transfer"), "A1B2C3D4-E5F6-4789-9ABC-DEF012345678", "RFC"]);
      t.eq(flat(await t.text("#ei-notes")), flat(await t.tx("This CFDI carries a digital seal (sello) and the SAT stamp (timbre fiscal). They were not verified: this page does not say whether they are valid or whether the file was changed. Use the SAT link to check the invoice.")), "seal note");
      t.eq(flat(await t.text(".ei-verify a")), flat(await t.tx("Verify with SAT")), "SAT link text");
      t.assert(flat(await t.text(".ei-verify")).includes(flat(await t.tx("Opens the SAT's own check page in a new tab. This page sends nothing; the details are only sent when you click."))), "SAT link hint");
      const s = await sheet(t);
      for (const key of ["Tax withheld", "Payment method (PUE / PPD)", "Buyer's tax regime", "Export"]) t.assert(s.includes(await t.tx(key)), `shows "${key}": ${await t.tx(key)}`);
      await open(t, "cfdi40-egreso-usd.xml");
      const e = await sheet(t);
      for (const key of ["Credit note", "Exchange rate"]) t.assert(e.includes(await t.tx(key)), `shows "${key}": ${await t.tx(key)}`);
      await open(t, "tr-earsiv.xml");
      t.eq(await t.page.eval(`document.querySelector("#ei-match a").getAttribute("href")`), toolPath(t.lang, "e-fatura-ubl-tr-viewer"), "link to the e-Fatura viewer in this language");
    },
  },
];
