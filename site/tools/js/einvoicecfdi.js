// Mexican electronic invoices: CFDI 4.0 and 3.3 (Comprobante Fiscal Digital por Internet; root element cfdi:Comprobante in the
// SAT namespaces http://www.sat.gob.mx/cfd/4 and /cfd/3, stamped with the TimbreFiscalDigital complement that carries the UUID)
// to the normalized invoice model. Elements are found by local name. This reads and does not validate: the seal (Sello) and the
// SAT stamp are never checked (a file that carries them gets a note). The "Verify with SAT" link is only built here, as a
// string, from the documented SAT verification address; nothing is fetched. No DOM and no translated text.
import {
  LIMITS, blankInvoice, blankParty, blankLine, all, one, childs, t, attr, dec, trimZeros, isoDate, sumDec, negDec, price, qty, isDec, cmpDec,
} from "./einvoicecore.js?v=11";

const list = (arr) => arr.slice(0, LIMITS.list);
const money = (e, name) => dec(attr(e, name));

/* The SAT's own address for checking a CFDI. */
export const SAT_VERIFY_URL = "https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx";
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const RFC_RE = /^[A-ZÑ&0-9]{3,4}[0-9]{6}[A-Z0-9]{3}$/i;

/* Whether a root element is a CFDI comprobante (SAT namespace, 4.0 or 3.3). */
export function isCfdi(root) {
  return (root.localName || "") === "Comprobante" && /^http:\/\/www\.sat\.gob\.mx\/cfd\/[34]\/?$/.test(root.namespaceURI || "");
}

/* "0.160000" -> "16", "0.106667" -> "10.6667", "0.000000" -> "0": a rate written as a fraction, as a percentage. */
export function percentOf(s) {
  s = dec(s);
  if (!isDec(s) || s.startsWith("-")) return "";
  const [int, frac = ""] = s.split(".");
  const f = frac.padEnd(2, "0");
  return trimZeros(dec(`${int}${f.slice(0, 2)}${f.length > 2 ? "." + f.slice(2) : ""}`));
}

/* The link to the SAT's verification page, or "" when the invoice lacks what it needs. The total is written as the SAT writes it
   in its QR code: 10 integer digits and 6 decimals; the last 8 characters of the seal go in `fe`. */
export function verifyUrl({ uuid, rfcEmisor, rfcReceptor, total, sello }) {
  if (!UUID_RE.test(uuid || "") || !RFC_RE.test(rfcEmisor || "") || !RFC_RE.test(rfcReceptor || "") || !isDec(total) || String(total).startsWith("-") || !sello) return "";
  const [int, frac = ""] = String(total).split(".");
  if (int.length > 10 || frac.length > 6) return "";
  const tt = `${int.padStart(10, "0")}.${frac.padEnd(6, "0")}`;
  const q = (v) => encodeURIComponent(v);
  return `${SAT_VERIFY_URL}?id=${q(uuid)}&re=${q(rfcEmisor)}&rr=${q(rfcReceptor)}&tt=${q(tt)}&fe=${q(String(sello).slice(-8))}`;
}

const TAX = { "001": "ISR", "002": "IVA", "003": "IEPS" };
const taxName = (c) => TAX[c] || c;

/* FormaPago (SAT catalogue c_FormaPago) to the payment-means codes the viewer knows. */
function means(code) {
  switch (code) {
    case "01": return "10";
    case "02": return "20";
    case "03": return "30";
    case "04": case "28": case "29": return "48";
    case "17": return "97";
    case "": return "";
    default: return "ZZZ";
  }
}

/* The VAT (IVA) category and rate of a Traslado element. */
function vatOfTraslado(x) {
  if (/^exento$/i.test(attr(x, "TipoFactor"))) return { category: "E", rate: "" };
  const rate = percentOf(attr(x, "TasaOCuota"));
  return { category: rate !== "" && cmpDec(rate, "0") > 0 ? "S" : rate !== "" ? "Z" : "", rate };
}

/* CFDI 3.3 leaves Base off the totals' Traslado: add up the Base of the lines' Traslados with the same tax, factor and rate. */
function baseFromLines(root, x) {
  const same = (y) => ["Impuesto", "TipoFactor", "TasaOCuota"].every((k) => attr(y, k) === attr(x, k));
  const bases = [];
  for (const c of childs(one(root, "Conceptos"), "Concepto").slice(0, LIMITS.lines)) {
    for (const y of all(c, "Impuestos/Traslados/Traslado")) if (same(y)) bases.push(money(y, "Base"));
  }
  return sumDec(bases);
}

function line(c, n) {
  const L = blankLine();
  L.id = String(n);
  L.name = attr(c, "Descripcion");
  L.sellerItemId = attr(c, "NoIdentificacion");
  if (attr(c, "ClaveProdServ")) L.classifications.push({ scheme: "SAT", code: attr(c, "ClaveProdServ") });
  L.unit = attr(c, "Unidad") || attr(c, "ClaveUnidad");
  L.quantity = qty(attr(c, "Cantidad"));
  L.unitPrice = price(attr(c, "ValorUnitario"));
  L.netAmount = money(c, "Importe");
  const disc = money(c, "Descuento");
  if (disc && cmpDec(disc, "0") !== 0) L.allowances.push({ reason: "", reasonCode: "", kind: "", amount: disc, baseAmount: "", percent: "" });
  const iva = all(c, "Impuestos/Traslados/Traslado").find((x) => attr(x, "Impuesto") === "002");
  if (iva) {
    const v = vatOfTraslado(iva);
    L.vat = { category: v.category, rate: v.rate, native: "" };
  } else if (attr(c, "ObjetoImp") === "01") {
    L.vat = { category: "O", rate: "", native: "" };
  }
  return L;
}

export function fromCfdi(root) {
  const inv = blankInvoice();
  const version = attr(root, "Version") || attr(root, "version");
  inv.format = "cfdi";
  inv.formatLabel = "CFDI";
  inv.profile = { customizationId: version, profileId: "", name: version ? `CFDI ${version}` : "CFDI" };
  const serie = attr(root, "Serie"), folio = attr(root, "Folio");
  inv.number = [serie, folio].filter(Boolean).join("-");
  inv.issueDate = isoDate(attr(root, "Fecha"));
  inv.currency = attr(root, "Moneda");
  inv.buyerReference = "";

  // TipoDeComprobante: I ingreso (invoice), E egreso (credit note), T traslado, P pago, N nomina
  const tipo = attr(root, "TipoDeComprobante").toUpperCase();
  const tipoName = { I: "Ingreso", E: "Egreso", T: "Traslado", P: "Pago", N: "Nómina" }[tipo];
  inv.typeCode = tipo;
  inv.type = tipo === "E" ? "creditNote" : "invoice";
  inv.typeNative = tipo ? (tipoName ? `${tipo} · ${tipoName}` : tipo) : "";

  // parties: the RFC is the identifier; the receiver's fiscal postal code is the only address a CFDI carries
  const em = one(root, "Emisor"), re = one(root, "Receptor");
  inv.seller = blankParty();
  inv.seller.name = attr(em, "Nombre");
  if (attr(em, "Rfc")) inv.seller.ids.push({ scheme: "RFC", value: attr(em, "Rfc") });
  inv.buyer = blankParty();
  inv.buyer.name = attr(re, "Nombre");
  if (attr(re, "Rfc")) inv.buyer.ids.push({ scheme: "RFC", value: attr(re, "Rfc") });
  if (attr(re, "NumRegIdTrib")) inv.buyer.ids.push({ scheme: "NumRegIdTrib", value: attr(re, "NumRegIdTrib") });
  inv.buyer.address.postalCode = attr(re, "DomicilioFiscalReceptor");
  inv.buyer.address.countryCode = attr(re, "ResidenciaFiscal");

  const rel = [];
  for (const g of list(childs(root, "CfdiRelacionados"))) {
    for (const x of list(childs(g, "CfdiRelacionado"))) if (attr(x, "UUID")) rel.push({ number: attr(x, "UUID"), date: "" });
  }
  inv.references.preceding = rel.slice(0, LIMITS.list);

  // lines
  const els = childs(one(root, "Conceptos") || root, "Concepto");
  inv.linesTotal = els.length;
  els.slice(0, LIMITS.lines).forEach((c, i) => inv.lines.push(line(c, i + 1)));

  // tax: IVA rows by rate; other transferred taxes (IEPS and the like) are listed apart; retained taxes (ISR, IVA) too
  const imp = childs(root, "Impuestos")[0] || null;
  const vatTax = [];
  for (const x of list(all(imp, "Traslados/Traslado"))) {
    if (attr(x, "Impuesto") === "002" || !attr(x, "Impuesto")) {
      const v = vatOfTraslado(x);
      const tax = money(x, "Importe") || (v.category === "E" ? "0" : "");
      inv.vatBreakdown.push({ category: v.category, rate: v.rate, taxable: money(x, "Base") || baseFromLines(root, x), tax, exemptionReason: "", exemptionReasonCode: "" });
      if (tax) vatTax.push(tax);
    } else {
      const pct = percentOf(attr(x, "TasaOCuota"));
      inv.extra.push({ key: "", label: taxName(attr(x, "Impuesto")), value: [attr(x, "Impuesto"), pct ? `${pct}%` : ""].filter(Boolean).join(" · "), amount: money(x, "Importe") });
    }
  }
  const held = [];
  for (const x of list(all(imp, "Retenciones/Retencion"))) {
    const code = attr(x, "Impuesto");
    held.push({ name: taxName(code), code, percent: "", taxable: "", amount: money(x, "Importe") });
    inv.extra.push({ key: "taxWithheld", label: "", value: `${taxName(code)} (${code})`, amount: money(x, "Importe") });
  }
  inv.withholding = held;
  inv.withholdingTotal = money(imp, "TotalImpuestosRetenidos") || sumDec(held.map((h) => h.amount));
  const hasHeld = inv.withholdingTotal && cmpDec(inv.withholdingTotal, "0") > 0;

  // totals: SubTotal is the sum of the line amounts before the discount
  const sub = money(root, "SubTotal"), disc = money(root, "Descuento"), total = money(root, "Total");
  const hasDisc = disc && cmpDec(disc, "0") > 0;
  const taxTotal = money(imp, "TotalImpuestosTrasladados") || (vatTax.length ? sumDec(vatTax) : "");
  const net = hasDisc ? sumDec([sub, negDec(disc)]) : sub;
  inv.totals = {
    lineNet: sub, allowances: hasDisc ? disc : "", charges: "", taxExclusive: net, tax: taxTotal,
    taxInclusive: hasHeld ? sumDec([total, inv.withholdingTotal]) : total, prepaid: "", rounding: "", payable: total, taxInTaxCurrency: "",
  };

  // payment (FormaPago, MetodoPago PUE one payment / PPD in instalments), exchange rate, place of issue and the other SAT codes
  inv.payment.meansNative = attr(root, "FormaPago");
  inv.payment.meansCode = means(attr(root, "FormaPago"));
  inv.payment.terms = attr(root, "CondicionesDePago");
  const extra = (key, value) => { if (value) inv.extra.push({ key, label: "", value, amount: "" }); };
  extra("cfdiPaymentMethod", attr(root, "MetodoPago"));
  const fx = attr(root, "TipoCambio");
  if (fx && inv.currency && inv.currency !== "MXN" && inv.currency !== "XXX") extra("exchangeRate", `1 ${inv.currency} = ${dec(fx)} MXN`);
  extra("placeOfIssue", attr(root, "LugarExpedicion"));
  extra("cfdiUse", attr(re, "UsoCFDI"));
  extra("taxRegime", attr(em, "RegimenFiscal"));
  extra("buyerTaxRegime", attr(re, "RegimenFiscalReceptor"));
  extra("export", attr(root, "Exportacion"));
  if (inv.extra.length > LIMITS.list) inv.extra.length = LIMITS.list;

  // the stamp: UUID (folio fiscal), stamping time and the certification provider (PAC)
  const tfd = all(root, "Complemento/TimbreFiscalDigital")[0] || null;
  const uuid = attr(tfd, "UUID");
  if (uuid) inv.codes.push({ key: "cfdiUuid", value: uuid });
  if (attr(tfd, "FechaTimbrado")) inv.codes.push({ key: "stampDate", value: attr(tfd, "FechaTimbrado") });
  if (attr(tfd, "RfcProvCertif")) inv.codes.push({ key: "pac", value: attr(tfd, "RfcProvCertif") });

  // the seal and the SAT stamp are present or not; never checked
  const sello = attr(root, "Sello") || attr(tfd, "SelloCFD");
  if (sello || attr(tfd, "SelloSAT")) inv.signature = "sello";
  const link = verifyUrl({ uuid, rfcEmisor: attr(em, "Rfc"), rfcReceptor: attr(re, "Rfc"), total, sello });
  if (link) inv.links.push({ key: "satVerify", url: link });
  return inv;
}
