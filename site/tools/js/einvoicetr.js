// Turkish e-Fatura and e-Arsiv invoices (UBL-TR, the GIB profile of UBL 2.1; CustomizationID TR1.2, ProfileID TEMELFATURA,
// TICARIFATURA, EARSIVFATURA and so on) on top of the generic UBL reader in einvoiceubl.js. The generic reader has already filled
// the model; this file corrects what UBL-TR does differently: VAT sits in each line's own TaxTotal (there is no
// ClassifiedTaxCategory), tax types are told apart by TaxTypeCode (0015 is KDV, the VAT), withheld tax (tevkifat) has its own
// WithholdingTaxTotal, the invoice scenario is the ProfileID and the kind of invoice is the InvoiceTypeCode (SATIS, IADE,
// TEVKIFAT, ISTISNA ...), the UUID (ETTN) is shown, the tax office is the name of the party's tax scheme, and the XSLT that
// the sender embeds to draw the invoice is marked so the page offers it as a download only. The XSLT is never executed here,
// and the fiscal seal (mali muhur) in the UBL extension is never verified; a file that carries one gets a note.
// No DOM and no translated text. Elements are found by local name.
import {
  LIMITS, all, one, childs, t, attr, raw, dec, trimZeros, sumDec, cmpDec, isDec,
} from "./einvoicecore.js?v=11";

const PROFILES = new Set([
  "TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT", "YOLCUBERABERFATURA", "KAMU", "HKS", "ENERJI", "ILAC_TIBBICIHAZ", "IDIS", "OZELFATURA",
]);

/* Whether the profile identifiers say this is a UBL-TR invoice. */
export function isTurkish(profile) {
  return /^TR\d/i.test(profile.customizationId || "") || PROFILES.has(String(profile.profileId || "").toUpperCase());
}

const money = (e, path) => dec(t(e, path));
const VAT_CODE = "0015";
const isVat = (sub) => {
  const code = t(sub, "TaxCategory/TaxScheme/TaxTypeCode");
  return code === VAT_CODE || (!code && /kdv|vergisi/i.test(t(sub, "TaxCategory/TaxScheme/Name")));
};

/* The VAT category, rate and exemption code of one subtotal: a rate above zero is the standard category, zero with an
   exemption reason code is exempt, zero without one is the zero rate. */
function vatOf(sub) {
  const rate = trimZeros(t(sub, "TaxCategory/Percent") || t(sub, "Percent"));
  const reasonCode = t(sub, "TaxCategory/TaxExemptionReasonCode");
  const category = isDec(rate) && cmpDec(rate, "0") > 0 ? "S" : reasonCode || t(sub, "TaxCategory/TaxExemptionReason") ? "E" : "Z";
  return { category, rate, reasonCode, reason: t(sub, "TaxCategory/TaxExemptionReason") };
}

const sealFound = (root) => all(root, "UBLExtensions/UBLExtension/ExtensionContent/Signature").length > 0 || childs(root, "Signature").length > 0;

const isStylesheet = (adr, bin) => /\.xslt?$/i.test(attr(bin, "filename")) || /^xslt?$/i.test(t(adr, "DocumentType")) || /^xslt?$/i.test(t(adr, "DocumentTypeCode"));

export function applyTurkish(root, inv, lineEls) {
  const cust = inv.profile.customizationId, pid = inv.profile.profileId;
  const archive = /^EARSIV/i.test(pid);
  inv.format = "ubl-tr";
  inv.formatLabel = archive ? "e-Arşiv Fatura (UBL-TR)" : "e-Fatura (UBL-TR)";
  inv.profile.name = [cust, pid].filter(Boolean).join(" · ");

  // the kind of invoice: the InvoiceTypeCode is SATIS (sale), IADE (return), TEVKIFAT (withholding), ISTISNA (exempt), ...
  const code = (inv.typeCode || "").toUpperCase();
  inv.type = /IADE/.test(code) ? "return" : "invoice";
  if (/ISTISNA|IHRACKAYITLI/.test(code)) inv.markings.push("exemption");

  // UBL-TR names the country (Türkiye) and gives no code
  for (const [path, p] of [["AccountingSupplierParty/Party", inv.seller], ["AccountingCustomerParty/Party", inv.buyer]]) {
    const name = t(root, `${path}/PostalAddress/Country/Name`).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!p.address.countryCode && /^turk[iı]ye$|^turkey$/.test(name)) p.address.countryCode = "TR";
  }

  const uuid = t(root, "UUID");
  if (uuid) inv.codes.push({ key: "uuid", value: uuid });
  if (sealFound(root)) inv.signature = "seal";

  // lines: VAT is in the line's own TaxTotal
  inv.lines.forEach((L, i) => {
    const le = lineEls[i];
    const subs = all(le, "TaxTotal/TaxSubtotal");
    const sub = subs.find(isVat) || (subs.length === 1 ? subs[0] : null);
    if (sub) {
      const v = vatOf(sub);
      L.vat = { category: v.category, rate: v.rate, native: v.reasonCode };
    }
    // UBL-TR gives the discount rate as a fraction; only the amount is shown
    for (const a of [...L.allowances, ...L.charges]) a.percent = "";
  });

  // document VAT rows and totals: KDV rows only; other taxes (ÖTV and the like) are listed under additional information
  inv.vatBreakdown = [];
  const vatTax = [];
  for (const tt of childs(root, "TaxTotal")) {
    for (const sub of childs(tt, "TaxSubtotal").slice(0, LIMITS.list)) {
      const name = t(sub, "TaxCategory/TaxScheme/Name"), tcode = t(sub, "TaxCategory/TaxScheme/TaxTypeCode");
      if (isVat(sub)) {
        const v = vatOf(sub);
        inv.vatBreakdown.push({ category: v.category, rate: v.rate, taxable: money(sub, "TaxableAmount"), tax: money(sub, "TaxAmount"), exemptionReason: v.reason, exemptionReasonCode: v.reasonCode });
        vatTax.push(money(sub, "TaxAmount"));
      } else {
        const pct = trimZeros(t(sub, "Percent") || t(sub, "TaxCategory/Percent"));
        inv.extra.push({ key: "", label: name || tcode || "Tax", value: [tcode, pct ? `${pct}%` : ""].filter(Boolean).join(" · "), amount: money(sub, "TaxAmount") });
      }
    }
  }
  if (vatTax.length) inv.totals.tax = sumDec(vatTax);

  // withheld VAT (tevkifat)
  const wh = [];
  for (const w of childs(root, "WithholdingTaxTotal")) {
    for (const sub of childs(w, "TaxSubtotal").slice(0, LIMITS.list)) {
      wh.push({
        name: t(sub, "TaxCategory/TaxScheme/Name"), code: t(sub, "TaxCategory/TaxScheme/TaxTypeCode"),
        percent: trimZeros(t(sub, "Percent") || t(sub, "TaxCategory/Percent")), taxable: money(sub, "TaxableAmount"), amount: money(sub, "TaxAmount"),
      });
    }
  }
  inv.withholding = wh;
  inv.withholdingTotal = money(childs(root, "WithholdingTaxTotal")[0], "TaxAmount") || sumDec(wh.map((x) => x.amount));
  for (const w of wh) {
    const what = [w.name, w.code ? `(${w.code})` : "", w.percent ? `${w.percent}%` : ""].filter(Boolean).join(" ");
    inv.extra.push({ key: "vatWithholding", label: "", value: what, amount: w.amount });
  }
  if (wh.length && !inv.markings.includes("vatWithholding")) inv.markings.push("vatWithholding");

  // foreign-currency invoices carry the rate used for the conversion
  const fx = one(root, "PricingExchangeRate");
  if (fx && t(fx, "CalculationRate")) {
    inv.extra.push({ key: "exchangeRate", label: "", value: `1 ${t(fx, "SourceCurrencyCode")} = ${dec(t(fx, "CalculationRate"))} ${t(fx, "TargetCurrencyCode")}`, amount: "" });
  }

  // references that carry no file (the e-Arsiv delivery type and similar) are facts, not attachments
  inv.attachments = inv.attachments.filter((a) => a.base64 || a.uri);
  for (const adr of all(root, "AdditionalDocumentReference")) {
    const bin = one(adr, "Attachment/EmbeddedDocumentBinaryObject");
    const uri = t(adr, "Attachment/ExternalReference/URI");
    if (bin || uri || t(adr, "DocumentTypeCode") === "130") {
      // the embedded XSLT: the sender's own drawing of the invoice; marked so the page only offers it for download
      if (bin && isStylesheet(adr, bin)) {
        const data = raw(bin), name = attr(bin, "filename");
        const a = inv.attachments.find((x) => x.base64 === data && x.filename === name);
        if (a) a.kind = "stylesheet";
      }
      continue;
    }
    const id = t(adr, "ID");
    const label = t(adr, "DocumentTypeCode") || t(adr, "DocumentType");
    if (id && inv.extra.length < LIMITS.list) inv.extra.push({ key: "", label: label || "ID", value: id, amount: "" });
  }
  return inv;
}
