// UBL 2.1 Invoice and CreditNote (XRechnung UBL, Peppol BIS Billing 3.0, plain EN 16931) to the normalized invoice model.
// Elements are found by local name, so any namespace prefix works. Missing parts are left empty: this reads, it does not validate.
import {
  LIMITS, blankInvoice, blankParty, blankLine, blankAddress, all, one, childs, t, tb, text, block, attr, raw, dec, trimZeros,
  isoDate, typeOfCode, base64Size, profileName, price, qty,
} from "./einvoicecore.js?v=11";
import { isTurkish, applyTurkish } from "./einvoicetr.js?v=11";

const money = (e, path) => dec(t(e, path));
const priceOf = price;
const list = (arr) => arr.slice(0, LIMITS.list);

function address(a) {
  const out = blankAddress();
  if (!a) return out;
  out.street = [t(a, "StreetName"), t(a, "BuildingNumber")].filter(Boolean).join(" ");
  out.street2 = t(a, "AdditionalStreetName");
  out.street3 = all(a, "AddressLine/Line").map(text).filter(Boolean).join(", ");
  out.city = t(a, "CityName");
  out.postalCode = t(a, "PostalZone");
  out.region = t(a, "CountrySubentity") || t(a, "CitySubdivisionName");
  out.countryCode = t(a, "Country/IdentificationCode");
  return out;
}

function party(p) {
  const out = blankParty();
  if (!p) return out;
  const legal = one(p, "PartyLegalEntity");
  const pname = t(p, "PartyName/Name");
  const person = one(p, "Person");
  const personName = person ? [t(person, "FirstName"), t(person, "MiddleName"), t(person, "FamilyName")].filter(Boolean).join(" ") : "";
  out.name = t(legal, "RegistrationName") || pname || personName;
  out.tradingName = pname && pname !== out.name ? pname : "";
  for (const id of list(all(p, "PartyIdentification/ID"))) if (text(id)) out.ids.push({ scheme: attr(id, "schemeID"), value: text(id) });
  const cid = one(legal, "CompanyID");
  if (cid && text(cid)) out.legalId = { scheme: attr(cid, "schemeID"), value: text(cid) };
  out.legalForm = t(legal, "CompanyLegalForm");
  for (const ts of all(p, "PartyTaxScheme")) {
    const scheme = t(ts, "TaxScheme/ID").toUpperCase();
    const id = t(ts, "CompanyID");
    if (!id) { if (!out.taxOffice) out.taxOffice = t(ts, "TaxScheme/Name"); continue; }
    if (scheme === "VAT" || !scheme) { if (!out.vatId) out.vatId = id; } else if (!out.taxId) out.taxId = id;
  }
  const ep = one(p, "EndpointID");
  if (ep && text(ep)) out.endpoint = { scheme: attr(ep, "schemeID"), value: text(ep) };
  out.address = address(one(p, "PostalAddress"));
  const c = one(p, "Contact");
  out.contact = { name: t(c, "Name"), phone: t(c, "Telephone"), email: t(c, "ElectronicMail") };
  return out;
}

const hasParty = (p) => !!(p.name || p.ids.length || p.vatId || p.address.street || p.address.city);

function allowanceCharge(ac) {
  return {
    charge: t(ac, "ChargeIndicator").toLowerCase() === "true",
    reason: t(ac, "AllowanceChargeReason"),
    reasonCode: t(ac, "AllowanceChargeReasonCode"),
    amount: money(ac, "Amount"),
    baseAmount: money(ac, "BaseAmount"),
    percent: dec(t(ac, "MultiplierFactorNumeric")),
    vat: { category: t(ac, "TaxCategory/ID"), rate: trimZeros(t(ac, "TaxCategory/Percent")) },
  };
}

function line(le, qtyName) {
  const L = blankLine();
  L.id = t(le, "ID");
  L.note = tb(le, "Note");
  const q = one(le, qtyName);
  L.quantity = q ? qty(text(q)) : "";
  L.unit = attr(q, "unitCode");
  L.netAmount = money(le, "LineExtensionAmount");
  L.name = t(le, "Item/Name");
  L.description = tb(le, "Item/Description");
  const pr = one(le, "Price");
  L.unitPrice = priceOf(dec(t(pr, "PriceAmount")));
  const bq = one(pr, "BaseQuantity");
  L.priceBaseQuantity = bq && text(bq) ? qty(text(bq)) : "";
  const pac = childs(pr, "AllowanceCharge").find((x) => t(x, "ChargeIndicator").toLowerCase() === "false");
  if (pac) L.priceDiscount = { amount: priceOf(money(pac, "Amount")), baseAmount: priceOf(money(pac, "BaseAmount")) };
  L.sellerItemId = t(le, "Item/SellersItemIdentification/ID");
  L.buyerItemId = t(le, "Item/BuyersItemIdentification/ID");
  const std = one(le, "Item/StandardItemIdentification/ID");
  if (std && text(std)) L.standardItemId = { scheme: attr(std, "schemeID"), value: text(std) };
  for (const cc of list(all(le, "Item/CommodityClassification/ItemClassificationCode"))) if (text(cc)) L.classifications.push({ scheme: attr(cc, "listID"), code: text(cc) });
  L.originCountry = t(le, "Item/OriginCountry/IdentificationCode");
  const ctc = one(le, "Item/ClassifiedTaxCategory");
  L.vat = { category: t(ctc, "ID"), rate: trimZeros(t(ctc, "Percent")), native: "" };
  L.period = { start: isoDate(t(le, "InvoicePeriod/StartDate")), end: isoDate(t(le, "InvoicePeriod/EndDate")) };
  L.orderLineRef = t(le, "OrderLineReference/LineID");
  for (const ac of list(childs(le, "AllowanceCharge"))) {
    const a = allowanceCharge(ac);
    (a.charge ? L.charges : L.allowances).push({ reason: a.reason, reasonCode: a.reasonCode, kind: "", amount: a.amount, baseAmount: a.baseAmount, percent: a.percent });
  }
  for (const p of list(all(le, "Item/AdditionalItemProperty"))) L.properties.push({ name: t(p, "Name"), value: t(p, "Value") });
  return L;
}

export function fromUbl(root, kind) {
  const credit = kind === "CreditNote";
  const inv = blankInvoice();
  const ver = t(root, "UBLVersionID");
  inv.format = credit ? "ubl-creditnote" : "ubl-invoice";
  inv.formatLabel = `UBL${ver ? " " + ver : ""} ${credit ? "Credit Note" : "Invoice"}`;
  inv.profile = { customizationId: t(root, "CustomizationID"), profileId: t(root, "ProfileID"), name: "" };
  inv.profile.name = profileName(inv.profile.customizationId, inv.profile.profileId);
  inv.typeCode = t(root, credit ? "CreditNoteTypeCode" : "InvoiceTypeCode") || (credit ? "381" : "");
  inv.typeNative = inv.typeCode;
  inv.type = credit && !inv.typeCode ? "creditNote" : typeOfCode(inv.typeCode);
  if (credit && inv.type === "invoice") inv.type = "creditNote";
  inv.number = t(root, "ID");
  inv.issueDate = isoDate(t(root, "IssueDate"));
  inv.dueDate = isoDate(t(root, "DueDate"));
  inv.taxPointDate = isoDate(t(root, "TaxPointDate"));
  inv.deliveryDate = isoDate(t(root, "Delivery/ActualDeliveryDate"));
  inv.period = { start: isoDate(t(root, "InvoicePeriod/StartDate")), end: isoDate(t(root, "InvoicePeriod/EndDate")) };
  inv.currency = t(root, "DocumentCurrencyCode");
  inv.taxCurrency = t(root, "TaxCurrencyCode");
  inv.buyerReference = t(root, "BuyerReference");
  inv.notes = list(all(root, "Note").map(block).filter(Boolean));

  const r = inv.references;
  r.order = t(root, "OrderReference/ID");
  r.salesOrder = t(root, "OrderReference/SalesOrderID");
  r.contract = t(root, "ContractDocumentReference/ID");
  r.project = t(root, "ProjectReference/ID");
  r.despatchAdvice = t(root, "DespatchDocumentReference/ID");
  r.receiptAdvice = t(root, "ReceiptDocumentReference/ID");
  r.tender = t(root, "OriginatorDocumentReference/ID");
  r.accounting = t(root, "AccountingCost");
  for (const b of list(all(root, "BillingReference/InvoiceDocumentReference"))) {
    r.preceding.push({ number: t(b, "ID"), date: isoDate(t(b, "IssueDate")) });
  }

  inv.seller = party(one(root, "AccountingSupplierParty/Party"));
  inv.buyer = party(one(root, "AccountingCustomerParty/Party"));
  const payee = party(one(root, "PayeeParty"));
  inv.payee = hasParty(payee) ? payee : null;
  const rep = party(one(root, "TaxRepresentativeParty"));
  inv.taxRepresentative = hasParty(rep) ? rep : null;
  const d = one(root, "Delivery");
  if (d) {
    const loc = one(d, "DeliveryLocation/ID");
    const delivery = { name: t(d, "DeliveryParty/PartyName/Name"), locationId: loc ? text(loc) : "", address: address(one(d, "DeliveryLocation/Address")) };
    const a = delivery.address;
    if (delivery.name || delivery.locationId || a.street || a.city || a.postalCode) inv.delivery = delivery;
  }
  // SEPA creditor identifier (BT-90) is a seller identification with scheme SEPA
  const sepa = inv.seller.ids.find((x) => x.scheme.toUpperCase() === "SEPA");

  for (const ac of list(childs(root, "AllowanceCharge"))) {
    const a = allowanceCharge(ac);
    (a.charge ? inv.charges : inv.allowances).push({ reason: a.reason, reasonCode: a.reasonCode, kind: "", amount: a.amount, baseAmount: a.baseAmount, percent: a.percent, vat: a.vat });
  }

  const m = one(root, "LegalMonetaryTotal");
  inv.totals = {
    lineNet: money(m, "LineExtensionAmount"), allowances: money(m, "AllowanceTotalAmount"), charges: money(m, "ChargeTotalAmount"),
    taxExclusive: money(m, "TaxExclusiveAmount"), tax: "", taxInclusive: money(m, "TaxInclusiveAmount"), prepaid: money(m, "PrepaidAmount"),
    rounding: money(m, "PayableRoundingAmount"), payable: money(m, "PayableAmount"), taxInTaxCurrency: "",
  };
  for (const tt of childs(root, "TaxTotal")) {
    const cur = attr(one(tt, "TaxAmount"), "currencyID");
    const amount = money(tt, "TaxAmount");
    if (inv.taxCurrency && inv.currency && inv.taxCurrency !== inv.currency && cur === inv.taxCurrency) inv.totals.taxInTaxCurrency = amount;
    else if (!inv.totals.tax) inv.totals.tax = amount;
    for (const sub of list(childs(tt, "TaxSubtotal"))) {
      if (inv.taxCurrency && inv.currency && inv.taxCurrency !== inv.currency && cur === inv.taxCurrency) continue;
      inv.vatBreakdown.push({
        category: t(sub, "TaxCategory/ID").toUpperCase(), rate: trimZeros(t(sub, "TaxCategory/Percent")), taxable: money(sub, "TaxableAmount"),
        tax: money(sub, "TaxAmount"), exemptionReason: t(sub, "TaxCategory/TaxExemptionReason"), exemptionReasonCode: t(sub, "TaxCategory/TaxExemptionReasonCode"),
      });
    }
  }

  const pay = inv.payment;
  const means = childs(root, "PaymentMeans");
  for (const [i, pm] of means.entries()) {
    const code = one(pm, "PaymentMeansCode");
    if (i === 0) {
      pay.meansCode = code ? text(code) : "";
      pay.meansNative = pay.meansCode;
      pay.meansText = attr(code, "name");
      pay.reference = t(pm, "PaymentID");
      pay.dueDate = isoDate(t(pm, "PaymentDueDate"));
    }
    const acc = one(pm, "PayeeFinancialAccount");
    if (acc && t(acc, "ID")) pay.accounts.push({ id: t(acc, "ID"), name: t(acc, "Name"), bic: t(acc, "FinancialInstitutionBranch/ID"), bank: "" });
    const card = one(pm, "CardAccount");
    if (card && !pay.card) pay.card = { number: t(card, "PrimaryAccountNumberID"), holder: t(card, "HolderName"), network: t(card, "NetworkID") };
    const mandate = one(pm, "PaymentMandate");
    if (mandate && !pay.directDebit) {
      pay.directDebit = { mandateId: t(mandate, "ID"), creditorId: sepa ? sepa.value : "", debitedAccount: t(mandate, "PayerFinancialAccount/ID") };
    }
  }
  pay.terms = list(all(root, "PaymentTerms/Note").map(block).filter(Boolean)).join("\n");
  if (!pay.dueDate) pay.dueDate = inv.dueDate;

  for (const adr of list(all(root, "AdditionalDocumentReference"))) {
    const id = t(adr, "ID");
    const kind2 = t(adr, "DocumentTypeCode");
    if (kind2 === "130") { r.invoicedObject = id; continue; }
    const bin = one(adr, "Attachment/EmbeddedDocumentBinaryObject");
    const uri = t(adr, "Attachment/ExternalReference/URI");
    if (inv.attachments.length >= LIMITS.attachments) { inv.warnings.push({ code: "attachmentsTruncated", data: {} }); break; }
    const data = bin ? raw(bin) : "";
    inv.attachments.push({
      id, description: t(adr, "DocumentDescription"), filename: attr(bin, "filename"), mimeType: attr(bin, "mimeCode"),
      size: data ? base64Size(data) : 0, base64: data, uri,
    });
  }

  const els = childs(root, credit ? "CreditNoteLine" : "InvoiceLine");
  inv.linesTotal = els.length;
  for (const le of els.slice(0, LIMITS.lines)) inv.lines.push(line(le, credit ? "CreditedQuantity" : "InvoicedQuantity"));
  if (isTurkish(inv.profile)) applyTurkish(root, inv, els);
  return inv;
}
