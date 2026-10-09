// FatturaPA (the Italian FatturaElettronica, versions 1.2.x: FPR12 for businesses and consumers, FPA12 for public bodies)
// to the normalized invoice model. A file can hold several invoices (one FatturaElettronicaBody each). Elements are found by
// local name; the XML itself arrives already unwrapped from a signed .p7m by p7mcore.js. Reads, does not validate.
import {
  LIMITS, blankInvoice, blankLine, blankParty, blankAddress, all, one, childs, t, tb, block, attr, raw, dec, trimZeros, isoDate,
  sumDec, base64Size, price, qty,
} from "./einvoicecore.js?v=11";

const money = (e, path) => dec(t(e, path));
const list = (arr) => arr.slice(0, LIMITS.list);

/* TipoDocumento -> semantic type */
const TD = {
  TD01: "invoice", TD02: "prepayment", TD03: "prepayment", TD04: "creditNote", TD05: "debitNote", TD06: "invoice",
  TD07: "invoice", TD08: "creditNote", TD09: "debitNote", TD16: "invoice", TD17: "invoice", TD18: "invoice", TD19: "invoice",
  TD20: "selfBilled", TD21: "selfBilled", TD22: "invoice", TD23: "invoice", TD24: "invoice", TD25: "invoice", TD26: "invoice",
  TD27: "selfBilled", TD28: "invoice", TD29: "invoice",
};

/* ModalitaPagamento -> UN/CEFACT payment means code (EN 16931), "ZZZ" for the Italian instruments that have none */
const MP = {
  MP01: "10", MP02: "20", MP03: "21", MP04: "10", MP05: "30", MP06: "ZZZ", MP07: "ZZZ", MP08: "48", MP09: "49", MP10: "49",
  MP11: "49", MP12: "ZZZ", MP13: "ZZZ", MP14: "ZZZ", MP15: "30", MP16: "49", MP17: "49", MP18: "ZZZ", MP19: "59", MP20: "59",
  MP21: "59", MP22: "ZZZ", MP23: "ZZZ",
};

/* VAT category from AliquotaIVA and Natura (the Italian exemption code); approximate, the native code is always kept */
function category(rate, natura) {
  const n = natura.toUpperCase();
  if (n) {
    if (n === "N3.1") return "G";
    if (n === "N3.2") return "K";
    if (n.startsWith("N3")) return "Z";
    if (n.startsWith("N4")) return "E";
    if (n.startsWith("N6")) return "AE";
    return "O";
  }
  const r = Number(rate);
  return Number.isFinite(r) && r > 0 ? "S" : "Z";
}

function anagrafica(a) {
  const den = t(a, "Denominazione");
  if (den) return den;
  return [t(a, "Titolo"), t(a, "Nome"), t(a, "Cognome")].filter(Boolean).join(" ");
}

function sede(s) {
  const out = blankAddress();
  if (!s) return out;
  out.street = [t(s, "Indirizzo"), t(s, "NumeroCivico")].filter(Boolean).join(" ");
  out.postalCode = t(s, "CAP");
  out.city = t(s, "Comune");
  out.region = t(s, "Provincia");
  out.countryCode = t(s, "Nazione");
  return out;
}

function party(p) {
  const out = blankParty();
  if (!p) return out;
  const da = one(p, "DatiAnagrafici");
  out.name = anagrafica(one(da, "Anagrafica"));
  const cc = t(da, "IdFiscaleIVA/IdPaese"), code = t(da, "IdFiscaleIVA/IdCodice");
  out.vatId = code ? cc + code : "";
  out.taxId = t(da, "CodiceFiscale");
  const eori = t(da, "Anagrafica/CodEORI");
  if (eori) out.ids.push({ scheme: "EORI", value: eori });
  out.address = sede(one(p, "Sede"));
  out.contact = { name: "", phone: t(p, "Contatti/Telefono"), email: t(p, "Contatti/Email") };
  const rea = one(p, "IscrizioneREA");
  if (rea && t(rea, "NumeroREA")) out.legalId = { scheme: "REA", value: [t(rea, "Ufficio"), t(rea, "NumeroREA")].filter(Boolean).join(" ") };
  return out;
}

function line(le) {
  const L = blankLine();
  L.id = t(le, "NumeroLinea");
  L.name = tb(le, "Descrizione");
  L.quantity = qty(t(le, "Quantita"));
  L.unit = t(le, "UnitaMisura");
  L.unitPrice = price(t(le, "PrezzoUnitario"));
  L.netAmount = money(le, "PrezzoTotale");
  const rate = trimZeros(t(le, "AliquotaIVA")), natura = t(le, "Natura");
  L.vat = { category: category(rate, natura), rate, native: natura };
  for (const c of list(all(le, "CodiceArticolo"))) {
    const type = t(c, "CodiceTipo"), value = t(c, "CodiceValore");
    if (!value) continue;
    if (!L.sellerItemId && !/^(EAN|GTIN|UPC)/i.test(type)) L.sellerItemId = value;
    else if (!L.standardItemId) L.standardItemId = { scheme: type, value };
  }
  L.period = { start: isoDate(t(le, "DataInizioPeriodo")), end: isoDate(t(le, "DataFinePeriodo")) };
  L.orderLineRef = "";
  for (const s of list(childs(le, "ScontoMaggiorazione"))) {
    const o = { reason: "", reasonCode: "", kind: "", amount: money(s, "Importo"), baseAmount: "", percent: dec(t(s, "Percentuale")) };
    (t(s, "Tipo").toUpperCase() === "MG" ? L.charges : L.allowances).push(o);
  }
  for (const a of list(childs(le, "AltriDatiGestionali"))) {
    const v = t(a, "RiferimentoTesto") || t(a, "RiferimentoNumero") || isoDate(t(a, "RiferimentoData"));
    L.properties.push({ name: t(a, "TipoDato"), value: v });
  }
  const ref = t(le, "RiferimentoAmministrazione");
  if (ref) L.properties.push({ name: "RiferimentoAmministrazione", value: ref });
  return L;
}

function fromBody(body, header, versione, budget) {
  const inv = blankInvoice();
  const tx = one(header, "DatiTrasmissione");
  const format = t(tx, "FormatoTrasmissione") || versione;
  inv.format = "fatturapa";
  inv.formatLabel = "FatturaPA";
  inv.profile = { customizationId: format, profileId: "", name: `FatturaPA ${format}`.trim() };

  inv.seller = party(one(header, "CedentePrestatore"));
  inv.buyer = party(one(header, "CessionarioCommittente"));
  const rep = party(one(header, "RappresentanteFiscale"));
  inv.taxRepresentative = rep.name || rep.vatId ? rep : null;
  const code = t(tx, "CodiceDestinatario");
  if (code) inv.buyer.endpoint = { scheme: "SDI", value: code };
  const pec = t(tx, "PECDestinatario");
  if (pec) inv.extra.push({ key: "pec", label: "", value: pec, amount: "" });
  const regime = t(one(header, "CedentePrestatore"), "DatiAnagrafici/RegimeFiscale");
  if (regime) inv.extra.push({ key: "taxRegime", label: "", value: regime, amount: "" });
  if (t(header, "SoggettoEmittente").toUpperCase() === "CC") inv.markings.push("selfBilling");

  const g = one(body, "DatiGenerali/DatiGeneraliDocumento");
  inv.typeNative = t(g, "TipoDocumento");
  inv.typeCode = inv.typeNative;
  inv.type = TD[inv.typeNative.toUpperCase()] || "invoice";
  inv.currency = t(g, "Divisa");
  inv.issueDate = isoDate(t(g, "Data"));
  inv.number = t(g, "Numero");
  inv.notes = list(all(g, "Causale").map(block).filter(Boolean));

  for (const s of list(childs(g, "ScontoMaggiorazione"))) {
    const o = { reason: "", reasonCode: "", kind: "", amount: money(s, "Importo"), baseAmount: "", percent: dec(t(s, "Percentuale")), vat: { category: "", rate: "" } };
    (t(s, "Tipo").toUpperCase() === "MG" ? inv.charges : inv.allowances).push(o);
  }
  for (const c of list(childs(g, "DatiCassaPrevidenziale"))) {
    const rate = trimZeros(t(c, "AliquotaIVA")), natura = t(c, "Natura");
    inv.charges.push({
      reason: "", reasonCode: t(c, "TipoCassa"), kind: "socialSecurity", amount: money(c, "ImportoContributoCassa"),
      baseAmount: money(c, "ImponibileCassa"), percent: dec(t(c, "AlCassa")), vat: { category: category(rate, natura), rate },
    });
  }
  for (const r of list(childs(g, "DatiRitenuta"))) {
    inv.extra.push({ key: "withholding", label: "", value: [t(r, "TipoRitenuta"), t(r, "AliquotaRitenuta") ? trimZeros(t(r, "AliquotaRitenuta")) + "%" : "", t(r, "CausalePagamento")].filter(Boolean).join(", "), amount: money(r, "ImportoRitenuta") });
  }
  const bollo = one(g, "DatiBollo");
  if (bollo) inv.extra.push({ key: "stampDuty", label: "", value: "", amount: money(bollo, "ImportoBollo") });

  const dg = one(body, "DatiGenerali");
  const r = inv.references;
  for (const o of list(childs(dg, "DatiOrdineAcquisto"))) {
    if (!r.order) r.order = t(o, "IdDocumento");
    else if (t(o, "IdDocumento")) inv.extra.push({ key: "", label: "Order", value: t(o, "IdDocumento"), amount: "" });
    if (t(o, "CodiceCIG")) inv.extra.push({ key: "", label: "CIG", value: t(o, "CodiceCIG"), amount: "" });
    if (t(o, "CodiceCUP")) inv.extra.push({ key: "", label: "CUP", value: t(o, "CodiceCUP"), amount: "" });
    if (t(o, "CodiceCommessaConvenzione")) inv.extra.push({ key: "", label: "Commessa/Convenzione", value: t(o, "CodiceCommessaConvenzione"), amount: "" });
  }
  for (const c of list(childs(dg, "DatiContratto"))) {
    if (!r.contract) r.contract = t(c, "IdDocumento");
    if (t(c, "CodiceCIG")) inv.extra.push({ key: "", label: "CIG", value: t(c, "CodiceCIG"), amount: "" });
    if (t(c, "CodiceCUP")) inv.extra.push({ key: "", label: "CUP", value: t(c, "CodiceCUP"), amount: "" });
  }
  for (const c of list(childs(dg, "DatiConvenzione"))) {
    if (!r.contract) r.contract = t(c, "IdDocumento");
    if (t(c, "CodiceCIG")) inv.extra.push({ key: "", label: "CIG", value: t(c, "CodiceCIG"), amount: "" });
    if (t(c, "CodiceCUP")) inv.extra.push({ key: "", label: "CUP", value: t(c, "CodiceCUP"), amount: "" });
  }
  r.receiptAdvice = t(dg, "DatiRicezione/IdDocumento");
  for (const f of list(childs(dg, "DatiFattureCollegate"))) r.preceding.push({ number: t(f, "IdDocumento"), date: isoDate(t(f, "Data")) });
  const ddt = childs(dg, "DatiDDT")[0];
  if (ddt) r.despatchAdvice = t(ddt, "NumeroDDT");

  const goods = one(body, "DatiBeniServizi");
  const els = childs(goods, "DettaglioLinee");
  inv.linesTotal = els.length;
  for (const le of els.slice(0, budget)) inv.lines.push(line(le));

  for (const s of list(childs(goods, "DatiRiepilogo"))) {
    const rate = trimZeros(t(s, "AliquotaIVA")), natura = t(s, "Natura");
    inv.vatBreakdown.push({
      category: category(rate, natura), rate, taxable: money(s, "ImponibileImporto"), tax: money(s, "Imposta"),
      exemptionReason: t(s, "RiferimentoNormativo"), exemptionReasonCode: natura,
    });
    if (t(s, "EsigibilitaIVA").toUpperCase() === "S" && !inv.markings.includes("splitPayment")) inv.markings.push("splitPayment");
  }

  const taxable = sumDec(inv.vatBreakdown.map((x) => x.taxable));
  const tax = sumDec(inv.vatBreakdown.map((x) => x.tax));
  const total = money(g, "ImportoTotaleDocumento");
  const details = all(body, "DatiPagamento/DettaglioPagamento");
  const paid = sumDec(details.map((d) => money(d, "ImportoPagamento")));
  inv.totals = {
    lineNet: inv.linesTotal === inv.lines.length ? sumDec(inv.lines.map((l) => l.netAmount)) : "",
    allowances: "", charges: "",
    taxExclusive: taxable, tax, taxInclusive: total || (taxable && tax ? sumDec([taxable, tax]) : ""),
    prepaid: "", rounding: money(g, "Arrotondamento"), payable: paid || total, taxInTaxCurrency: "",
  };
  const adj = (arr) => sumDec(arr.map((x) => x.amount).filter((a) => a));
  if (inv.allowances.some((x) => x.amount)) inv.totals.allowances = adj(inv.allowances);
  if (inv.charges.some((x) => x.amount)) inv.totals.charges = adj(inv.charges);

  const pay = inv.payment;
  details.sort((a, b) => (t(a, "DataScadenzaPagamento") || "9999").localeCompare(t(b, "DataScadenzaPagamento") || "9999"));
  for (const [i, d] of details.entries()) {
    const mp = t(d, "ModalitaPagamento");
    if (i === 0) {
      pay.meansNative = mp;
      pay.meansCode = MP[mp.toUpperCase()] || (mp ? "ZZZ" : "");
      pay.reference = t(d, "CodicePagamento");
      pay.dueDate = isoDate(t(d, "DataScadenzaPagamento"));
    }
    const iban = t(d, "IBAN");
    if (iban && !pay.accounts.some((a) => a.id === iban)) {
      pay.accounts.push({ id: iban, name: t(d, "Beneficiario"), bic: t(d, "BIC"), bank: t(d, "IstitutoFinanziario") });
    }
    if (details.length > 1) pay.instalments.push({ dueDate: isoDate(t(d, "DataScadenzaPagamento")), amount: money(d, "ImportoPagamento"), meansNative: mp });
  }
  inv.dueDate = pay.dueDate;
  const terms = t(one(body, "DatiPagamento"), "CondizioniPagamento");
  if (terms) inv.extra.push({ key: "paymentTerms", label: "", value: terms, amount: "" });

  for (const a of list(childs(body, "Allegati"))) {
    const data = raw(one(a, "Attachment"));
    let filename = t(a, "NomeAttachment");
    const fmt = t(a, "FormatoAttachment");
    if (filename && fmt && !/\.[A-Za-z0-9]{1,5}$/.test(filename)) filename += "." + fmt.toLowerCase();
    const comp = t(a, "AlgoritmoCompressione");
    inv.attachments.push({
      id: "", description: [t(a, "DescrizioneAttachment"), comp ? `(${comp})` : ""].filter(Boolean).join(" "), filename, mimeType: fmt,
      size: data ? base64Size(data) : 0, base64: data, uri: "",
    });
    if (inv.attachments.length >= LIMITS.attachments) { inv.warnings.push({ code: "attachmentsTruncated", data: {} }); break; }
  }
  return inv;
}

export function fromFatturaPA(root) {
  const versione = attr(root, "versione");
  const header = one(root, "FatturaElettronicaHeader");
  const bodies = childs(root, "FatturaElettronicaBody");
  const out = [];
  let budget = LIMITS.lines;   // lines are read up to the limit across the whole file, not per invoice
  for (const b of bodies.slice(0, LIMITS.invoices)) {
    const inv = fromBody(b, header, versione, budget);
    budget -= inv.lines.length;
    out.push(inv);
  }
  if (bodies.length > LIMITS.invoices) out[out.length - 1].warnings.push({ code: "invoicesTruncated", data: { shown: LIMITS.invoices, total: bodies.length } });
  return out;
}
