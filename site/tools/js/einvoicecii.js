// UN/CEFACT Cross Industry Invoice (CII D16B: XRechnung CII, ZUGFeRD 2 and Factur-X, EN 16931) to the normalized invoice model.
// Elements are found by local name, so any namespace prefix works. Missing parts are left empty: this reads, it does not validate.
import {
  LIMITS, blankInvoice, blankParty, blankLine, blankAddress, all, one, childs, t, tb, text, block, attr, raw, dec, trimZeros,
  isoDate, typeOfCode, base64Size, profileName, price, qty,
} from "./einvoicecore.js?v=11";

const money = (e, path) => dec(t(e, path));
const list = (arr) => arr.slice(0, LIMITS.list);

/* A CII date: <udt:DateTimeString format="102">20240301</udt:DateTimeString> (or a plain date inside the element). */
function cdate(e) {
  if (!e) return "";
  const s = one(e, "DateTimeString") || one(e, "DateString") || one(e, "DateTime");
  return s ? isoDate(text(s), attr(s, "format")) : isoDate(text(e));
}

function address(a) {
  const out = blankAddress();
  if (!a) return out;
  out.street = t(a, "LineOne");
  out.street2 = t(a, "LineTwo");
  out.street3 = t(a, "LineThree");
  out.city = t(a, "CityName");
  out.postalCode = t(a, "PostcodeCode");
  out.region = t(a, "CountrySubDivisionName");
  out.countryCode = t(a, "CountryID");
  return out;
}

function party(p) {
  const out = blankParty();
  if (!p) return out;
  const org = one(p, "SpecifiedLegalOrganization");
  out.name = t(p, "Name");
  const trade = t(org, "TradingBusinessName");
  out.tradingName = trade && trade !== out.name ? trade : "";
  for (const id of all(p, "ID")) if (text(id)) out.ids.push({ scheme: attr(id, "schemeID"), value: text(id) });
  for (const id of all(p, "GlobalID")) if (text(id)) out.ids.push({ scheme: attr(id, "schemeID"), value: text(id) });
  const lid = one(org, "ID");
  if (lid && text(lid)) out.legalId = { scheme: attr(lid, "schemeID"), value: text(lid) };
  out.legalForm = t(p, "Description");
  for (const reg of all(p, "SpecifiedTaxRegistration/ID")) {
    const scheme = attr(reg, "schemeID").toUpperCase();
    if (!text(reg)) continue;
    if (scheme === "VA") { if (!out.vatId) out.vatId = text(reg); } else if (scheme === "FC" || scheme === "") { if (!out.taxId) out.taxId = text(reg); }
  }
  out.address = address(one(p, "PostalTradeAddress"));
  const c = one(p, "DefinedTradeContact");
  const person = t(c, "PersonName"), dept = t(c, "DepartmentName");
  out.contact = {
    name: person && dept ? `${person} (${dept})` : person || dept,
    phone: t(c, "TelephoneUniversalCommunication/CompleteNumber"),
    email: t(c, "EmailURIUniversalCommunication/URIID"),
  };
  const ep = one(p, "URIUniversalCommunication/URIID");
  if (ep && text(ep)) out.endpoint = { scheme: attr(ep, "schemeID"), value: text(ep) };
  return out;
}

const hasParty = (p) => !!(p.name || p.ids.length || p.vatId || p.address.street || p.address.city);

function allowanceCharge(ac) {
  return {
    charge: t(ac, "ChargeIndicator/Indicator").toLowerCase() === "true",
    reason: t(ac, "Reason"), reasonCode: t(ac, "ReasonCode"),
    amount: money(ac, "ActualAmount"), baseAmount: money(ac, "BasisAmount"), percent: dec(t(ac, "CalculationPercent")),
    vat: { category: t(ac, "CategoryTradeTax/CategoryCode"), rate: trimZeros(t(ac, "CategoryTradeTax/RateApplicablePercent")) },
  };
}

function line(li) {
  const L = blankLine();
  L.id = t(li, "AssociatedDocumentLineDocument/LineID");
  L.note = all(li, "AssociatedDocumentLineDocument/IncludedNote/Content").map(block).filter(Boolean).join("\n");
  const prod = one(li, "SpecifiedTradeProduct");
  L.name = t(prod, "Name");
  L.description = tb(prod, "Description");
  L.sellerItemId = t(prod, "SellerAssignedID");
  L.buyerItemId = t(prod, "BuyerAssignedID");
  const gid = one(prod, "GlobalID");
  if (gid && text(gid)) L.standardItemId = { scheme: attr(gid, "schemeID"), value: text(gid) };
  for (const cc of list(all(prod, "DesignatedProductClassification/ClassCode"))) if (text(cc)) L.classifications.push({ scheme: attr(cc, "listID"), code: text(cc) });
  L.originCountry = t(prod, "OriginTradeCountry/ID");
  for (const p of list(all(prod, "ApplicableProductCharacteristic"))) L.properties.push({ name: t(p, "Description"), value: t(p, "Value") });

  const agr = one(li, "SpecifiedLineTradeAgreement");
  L.orderLineRef = t(agr, "BuyerOrderReferencedDocument/LineID");
  const net = one(agr, "NetPriceProductTradePrice");
  L.unitPrice = price(money(net, "ChargeAmount"));
  const bq = one(net, "BasisQuantity");
  L.priceBaseQuantity = bq && text(bq) ? qty(text(bq)) : "";
  const gross = one(agr, "GrossPriceProductTradePrice");
  const gac = all(gross, "AppliedTradeAllowanceCharge").find((x) => t(x, "ChargeIndicator/Indicator").toLowerCase() === "false");
  if (gac) L.priceDiscount = { amount: price(money(gac, "ActualAmount")), baseAmount: price(money(gross, "ChargeAmount")) };

  const q = one(li, "SpecifiedLineTradeDelivery/BilledQuantity");
  L.quantity = q ? qty(text(q)) : "";
  L.unit = attr(q, "unitCode");

  const st = one(li, "SpecifiedLineTradeSettlement");
  const tax = one(st, "ApplicableTradeTax");
  L.vat = { category: t(tax, "CategoryCode"), rate: trimZeros(t(tax, "RateApplicablePercent")), native: "" };
  L.period = { start: cdate(one(st, "BillingSpecifiedPeriod/StartDateTime")), end: cdate(one(st, "BillingSpecifiedPeriod/EndDateTime")) };
  for (const ac of list(childs(st, "SpecifiedTradeAllowanceCharge"))) {
    const a = allowanceCharge(ac);
    (a.charge ? L.charges : L.allowances).push({ reason: a.reason, reasonCode: a.reasonCode, kind: "", amount: a.amount, baseAmount: a.baseAmount, percent: a.percent });
  }
  L.netAmount = money(st, "SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount");
  return L;
}

export function fromCii(root) {
  const inv = blankInvoice();
  inv.format = "cii";
  inv.formatLabel = "UN/CEFACT CII";
  const ctx = one(root, "ExchangedDocumentContext");
  inv.profile = {
    customizationId: t(ctx, "GuidelineSpecifiedDocumentContextParameter/ID"),
    profileId: t(ctx, "BusinessProcessSpecifiedDocumentContextParameter/ID"),
    name: "",
  };
  inv.profile.name = profileName(inv.profile.customizationId, inv.profile.profileId);
  const doc = one(root, "ExchangedDocument");
  inv.number = t(doc, "ID");
  inv.typeCode = t(doc, "TypeCode");
  inv.typeNative = inv.typeCode;
  inv.type = typeOfCode(inv.typeCode);
  inv.issueDate = cdate(one(doc, "IssueDateTime"));
  inv.notes = list(all(doc, "IncludedNote/Content").map(block).filter(Boolean));

  const trade = one(root, "SupplyChainTradeTransaction");
  const agr = one(trade, "ApplicableHeaderTradeAgreement");
  const del = one(trade, "ApplicableHeaderTradeDelivery");
  const set = one(trade, "ApplicableHeaderTradeSettlement");

  inv.buyerReference = t(agr, "BuyerReference");
  inv.seller = party(one(agr, "SellerTradeParty"));
  inv.buyer = party(one(agr, "BuyerTradeParty"));
  const rep = party(one(agr, "SellerTaxRepresentativeTradeParty"));
  inv.taxRepresentative = hasParty(rep) ? rep : null;
  const payee = party(one(set, "PayeeTradeParty"));
  inv.payee = hasParty(payee) ? payee : null;

  const r = inv.references;
  r.order = t(agr, "BuyerOrderReferencedDocument/IssuerAssignedID");
  r.salesOrder = t(agr, "SellerOrderReferencedDocument/IssuerAssignedID");
  r.contract = t(agr, "ContractReferencedDocument/IssuerAssignedID");
  r.project = t(agr, "SpecifiedProcurementProject/ID");
  r.despatchAdvice = t(del, "DespatchAdviceReferencedDocument/IssuerAssignedID");
  r.receiptAdvice = t(del, "ReceivingAdviceReferencedDocument/IssuerAssignedID");
  r.accounting = t(set, "ReceivableSpecifiedTradeAccountingAccount/ID");
  for (const b of list(all(set, "InvoiceReferencedDocument"))) {
    r.preceding.push({ number: t(b, "IssuerAssignedID"), date: cdate(one(b, "FormattedIssueDateTime")) });
  }
  for (const d of list(all(agr, "AdditionalReferencedDocument"))) {
    const code = t(d, "TypeCode"), id = t(d, "IssuerAssignedID");
    if (code === "130") { r.invoicedObject = id; continue; }
    if (code === "50") { r.tender = id; continue; }
    if (inv.attachments.length >= LIMITS.attachments) { inv.warnings.push({ code: "attachmentsTruncated", data: {} }); break; }
    const bin = one(d, "AttachmentBinaryObject");
    const data = bin ? raw(bin) : "";
    inv.attachments.push({
      id, description: t(d, "Name"), filename: attr(bin, "filename"), mimeType: attr(bin, "mimeCode"),
      size: data ? base64Size(data) : 0, base64: data, uri: t(d, "URIID"),
    });
  }

  const ship = party(one(del, "ShipToTradeParty"));
  const deliveryDate = cdate(one(del, "ActualDeliverySupplyChainEvent/OccurrenceDateTime"));
  inv.deliveryDate = deliveryDate;
  if (hasParty(ship)) inv.delivery = { name: ship.name, locationId: ship.ids.length ? ship.ids[0].value : "", address: ship.address };

  inv.currency = t(set, "InvoiceCurrencyCode");
  inv.taxCurrency = t(set, "TaxCurrencyCode");
  inv.period = { start: cdate(one(set, "BillingSpecifiedPeriod/StartDateTime")), end: cdate(one(set, "BillingSpecifiedPeriod/EndDateTime")) };

  for (const ac of list(childs(set, "SpecifiedTradeAllowanceCharge"))) {
    const a = allowanceCharge(ac);
    (a.charge ? inv.charges : inv.allowances).push({ reason: a.reason, reasonCode: a.reasonCode, kind: "", amount: a.amount, baseAmount: a.baseAmount, percent: a.percent, vat: a.vat });
  }
  for (const tax of list(childs(set, "ApplicableTradeTax"))) {
    inv.vatBreakdown.push({
      category: t(tax, "CategoryCode").toUpperCase(), rate: trimZeros(t(tax, "RateApplicablePercent")), taxable: money(tax, "BasisAmount"),
      tax: money(tax, "CalculatedAmount"), exemptionReason: t(tax, "ExemptionReason"), exemptionReasonCode: t(tax, "ExemptionReasonCode"),
    });
  }

  const m = one(set, "SpecifiedTradeSettlementHeaderMonetarySummation");
  inv.totals = {
    lineNet: money(m, "LineTotalAmount"), allowances: money(m, "AllowanceTotalAmount"), charges: money(m, "ChargeTotalAmount"),
    taxExclusive: money(m, "TaxBasisTotalAmount"), tax: "", taxInclusive: money(m, "GrandTotalAmount"), prepaid: money(m, "TotalPrepaidAmount"),
    rounding: money(m, "RoundingAmount"), payable: money(m, "DuePayableAmount"), taxInTaxCurrency: "",
  };
  for (const tt of childs(m, "TaxTotalAmount")) {
    const cur = attr(tt, "currencyID");
    if (inv.taxCurrency && inv.currency && inv.taxCurrency !== inv.currency && cur === inv.taxCurrency) inv.totals.taxInTaxCurrency = dec(text(tt));
    else if (!inv.totals.tax) inv.totals.tax = dec(text(tt));
  }

  const pay = inv.payment;
  pay.reference = t(set, "PaymentReference");
  const creditorRef = t(set, "CreditorReferenceID");
  for (const [i, pm] of childs(set, "SpecifiedTradeSettlementPaymentMeans").entries()) {
    if (i === 0) {
      pay.meansCode = t(pm, "TypeCode");
      pay.meansNative = pay.meansCode;
      pay.meansText = t(pm, "Information");
    }
    const acc = one(pm, "PayeePartyCreditorFinancialAccount");
    const iban = t(acc, "IBANID") || t(acc, "ProprietaryID");
    if (iban) pay.accounts.push({ id: iban, name: t(acc, "AccountName"), bic: t(pm, "PayeeSpecifiedCreditorFinancialInstitution/BICID"), bank: "" });
    const card = one(pm, "ApplicableTradeSettlementFinancialCard");
    if (card && !pay.card) pay.card = { number: t(card, "ID"), holder: t(card, "CardholderName"), network: "" };
    const debtor = t(pm, "PayerPartyDebtorFinancialAccount/IBANID");
    if (debtor && !pay.directDebit) pay.directDebit = { mandateId: "", creditorId: creditorRef, debitedAccount: debtor };
  }
  const terms = childs(set, "SpecifiedTradePaymentTerms");
  pay.terms = list(terms.map((x) => tb(x, "Description")).filter(Boolean)).join("\n");
  for (const x of terms) {
    if (!inv.dueDate) inv.dueDate = cdate(one(x, "DueDateDateTime"));
    const mandate = t(x, "DirectDebitMandateID");
    if (mandate) {
      if (!pay.directDebit) pay.directDebit = { mandateId: mandate, creditorId: creditorRef, debitedAccount: "" };
      else if (!pay.directDebit.mandateId) pay.directDebit.mandateId = mandate;
    }
  }
  pay.dueDate = inv.dueDate;

  const items = childs(trade, "IncludedSupplyChainTradeLineItem");
  inv.linesTotal = items.length;
  for (const li of items.slice(0, LIMITS.lines)) inv.lines.push(line(li));
  if (!items.length && /minimum|basicwl|basic wl/i.test(inv.profile.name + " " + inv.profile.customizationId)) inv.warnings.push({ code: "noLines", data: { profile: inv.profile.name } });
  return inv;
}
