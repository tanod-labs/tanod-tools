// E-invoice viewers (XRechnung, ZUGFeRD / Factur-X, FatturaPA, KSeF, Peppol / UBL, e-Fatura / UBL-TR, Vietnam, Mexico CFDI): one script for the eight pages. Opens an
// XML invoice, a signed .p7m, or a PDF with an invoice attached, shows it as a readable invoice, prints it, and exports the
// normalized model as JSON. The reading lives in einvoiceparse.js and the readers it calls; this file is the page.
// Nothing is uploaded: the file is read in this tab, parsed with the browser's DOMParser, and shown with textContent only.
// Embedded documents are offered as downloads with a generic type and a cleaned name; they are never opened here.
import { $, el, fmtBytes, dropzone, readBytes, setStatus, announce, tick, tx, txn, txf, fmtNum, dateFormat, friendlyError } from "./core.js?v=11";
import { numberFormat } from "./i18n.js?v=11";
import { openForView, closeView } from "./pdfcore.js?v=11";
import { LIMITS, InvoiceError, decodeBytes, exportJson, prettyXml, safeFileName, base64Bytes, isDec, looksLikeIban, negDec } from "./einvoicecore.js?v=11";
import { openBytes, parseXmlText, sniff, pdfCandidates, VIEWER_SLUGS } from "./einvoiceparse.js?v=11";

const drop = $("#drop"), work = $("#work"), status = $("#status");
const sheets = $("#ei-invoices"), match = $("#ei-match"), notesBox = $("#ei-notes");
const btnPrint = $("#ei-print"), btnJson = $("#ei-json"), btnXml = $("#ei-xml"), btnRaw = $("#ei-rawbtn");
const rawBox = $("#ei-raw"), rawText = $("#ei-rawtext");

const LINKS = (() => { try { return JSON.parse(document.body.dataset.links || "{}"); } catch (_) { return {}; } })();
const HERE = Object.keys(VIEWER_SLUGS).find((k) => VIEWER_SLUGS[k] === document.body.dataset.tool) || "";
const PDF_WAIT_MS = 30000;

let current = null;   // { result, xml, container, name, size, attachmentName }
let token = 0;

/* ------------------------------------------------------------------ numbers, dates, words */

const decimalsOf = (s) => { const i = s.indexOf("."); return i < 0 ? 0 : Math.min(s.length - i - 1, 10); };

/* A decimal string for display, with every decimal the invoice gives (and at least minDigits). */
function fmtDec(s, minDigits = 0) {
  if (!isDec(s)) return s;
  const d = Math.max(decimalsOf(s), minDigits);
  return numberFormat({ minimumFractionDigits: d, maximumFractionDigits: d }).format(s);
}

/* An amount with its currency code, e.g. "EUR 1,303.80" or "1.303,80 EUR". */
function fmtMoney(s, cur) {
  if (s === "" || s == null) return "";
  if (!isDec(s)) return cur ? `${s} ${cur}` : s;
  const opts = { style: "currency", currency: cur, currencyDisplay: "code" };
  try {
    const digits = Math.max(decimalsOf(s), numberFormat(opts).resolvedOptions().minimumFractionDigits);
    return numberFormat({ ...opts, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(s);
  } catch (_) {
    return fmtDec(s, 2) + (cur ? " " + cur : "");
  }
}

function fmtRate(r) {
  if (r === "" || r == null) return "";
  return isDec(r) ? numberFormat({ style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(Number(r) / 100) : r;
}

function fmtDate(s) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (m) return dateFormat({ dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = /^(\d{4})-(\d{2})$/.exec(s || "");
  if (m) return dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)));
  return s || "";
}

const fmtPeriod = (p) => (p && (p.start || p.end) ? (p.start && p.end ? `${fmtDate(p.start)} – ${fmtDate(p.end)}` : fmtDate(p.start || p.end)) : "");

let regionNames;
function country(code) {
  if (!code) return "";
  try {
    regionNames = regionNames || new Intl.DisplayNames(document.documentElement.lang || "en", { type: "region" });
    return regionNames.of(code.toUpperCase()) || code;
  } catch (_) {
    return code;
  }
}

/* Units of measure (UN/ECE codes). Piece-like codes show just the number; time and metric units are written the way the
   page's language writes them; free-text units (FatturaPA, KSeF) and unknown codes are shown as given. */
const PIECE = new Set(["C62", "H87", "EA", "PCE", "NAR", "XPP", "XUN"]);
const INTL_UNIT = { HUR: "hour", MIN: "minute", SEC: "second", DAY: "day", WEE: "week", MON: "month", ANN: "year" };
const SYMBOL = { KGM: "kg", GRM: "g", LTR: "l", MLT: "ml", MTR: "m", CMT: "cm", MMT: "mm", KMT: "km", MTK: "m²", MTQ: "m³", KWH: "kWh", MWH: "MWh", TNE: "t" };
function fmtQty(q, unit) {
  const text = fmtDec(q);
  if (!unit) return text;
  const u = unit.toUpperCase();
  if (PIECE.has(u)) return text;
  if (INTL_UNIT[u] && isDec(q)) {
    try {
      const d = decimalsOf(q);
      return numberFormat({ style: "unit", unit: INTL_UNIT[u], unitDisplay: "short", minimumFractionDigits: d, maximumFractionDigits: d }).format(q);
    } catch (_) { /* fall through to the code */ }
  }
  return `${text} ${SYMBOL[u] || unit}`;
}

/* ------------------------------------------------------------------ names of codes */

function typeTitle(type) {
  switch (type) {
    case "creditNote": return tx("Credit note");
    case "debitNote": return tx("Debit note");
    case "correction": return tx("Corrected invoice");
    case "prepayment": return tx("Prepayment invoice");
    case "return": return tx("Return invoice");
    case "replacement": return tx("Replacement invoice");
    case "selfBilled": return tx("Self-billed invoice");
    default: return tx("Invoice");
  }
}

function vatName(cat) {
  switch (cat) {
    case "S": return tx("Standard rate");
    case "Z": return tx("Zero rate");
    case "E": return tx("Exempt from VAT");
    case "AE": return tx("Reverse charge");
    case "K": return tx("Intra-EU supply, VAT exempt");
    case "G": return tx("Export outside the EU, VAT exempt");
    case "O": return tx("Outside the scope of VAT");
    case "L": return tx("Canary Islands (IGIC)");
    case "M": return tx("Ceuta and Melilla (IPSI)");
    default: return cat || "";
  }
}

function meansName(code) {
  switch (String(code)) {
    case "10": return tx("Cash");
    case "20": case "21": case "22": case "23": case "25": case "26": return tx("Cheque");
    case "30": return tx("Credit transfer");
    case "31": return tx("Debit transfer");
    case "42": return tx("Payment to bank account");
    case "48": case "54": case "55": return tx("Bank card");
    case "49": return tx("Direct debit");
    case "57": return tx("Standing order");
    case "58": return tx("SEPA credit transfer");
    case "59": return tx("SEPA direct debit");
    case "97": return tx("Clearing between partners");
    case "": return "";
    default: return tx("Other payment method");
  }
}

function markName(m) {
  switch (m) {
    case "splitPayment": return tx("Split payment");
    case "reverseCharge": return tx("Reverse charge");
    case "cashAccounting": return tx("Cash accounting");
    case "selfBilling": return tx("Self-billing");
    case "exemption": return tx("VAT exempt");
    case "vatWithholding": return tx("Withheld VAT (tevkifat)");
    default: return m;
  }
}

function extraName(e) {
  switch (e.key) {
    case "taxRegime": return tx("Tax regime");
    case "stampDuty": return tx("Stamp duty");
    case "withholding": return tx("Withholding tax");
    case "vatWithholding": return tx("Withheld VAT (tevkifat)");
    case "paymentTerms": return tx("Payment conditions");
    case "placeOfIssue": return tx("Place of issue");
    case "correctionReason": return tx("Reason for correction");
    case "pec": return tx("Certified email (PEC)");
    case "exchangeRate": return tx("Exchange rate");
    case "amountInWords": return tx("Amount in words");
    case "cfdiPaymentMethod": return tx("Payment method (PUE / PPD)");
    case "cfdiUse": return tx("CFDI use");
    case "buyerTaxRegime": return tx("Buyer's tax regime");
    case "export": return tx("Export");
    case "taxWithheld": return tx("Tax withheld");
    default: return e.label || e.key;
  }
}

function codeName(c) {
  switch (c.key) {
    case "uuid": return "UUID (ETTN)";
    case "symbol": return tx("Invoice symbol");
    case "form": return tx("Form number");
    case "taxAuthorityCode": return `${tx("Tax authority code")} (MCCQT)`;
    case "cfdiUuid": return "UUID (folio fiscal)";
    case "stampDate": return tx("Stamped on");
    case "pac": return tx("Certification provider (PAC)");
    default: return c.key;
  }
}

/* ------------------------------------------------------------------ building blocks */

const has = (v) => v !== "" && v != null;
const tag = (text) => el("span", { class: "ei-tag" }, text);

/* A list of label / value pairs; pairs with no value are left out. */
function dl(pairs, cls = "ei-dl") {
  const rows = pairs.filter(([, v]) => (Array.isArray(v) ? v.length : has(v)));
  return rows.length ? el("dl", { class: cls }, rows.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, [v].flat(Infinity))))) : null;
}

function block(title, ...children) {
  const kids = children.flat().filter(Boolean);
  return kids.length ? el("section", { class: "ei-block" }, el("h4", { class: "ei-h" }, title), kids) : null;
}

function addressLines(a) {
  const place = [a.postalCode, a.city].filter(Boolean).join(" ");
  return [a.street, a.street2, a.street3, place, a.region, country(a.countryCode)].filter(Boolean);
}

function party(title, p, extraLines = []) {
  if (!p) return null;
  const idValue = (id) => [id.scheme ? tag(id.scheme) : null, id.scheme ? " " : null, id.value];
  const lines = addressLines(p.address);
  const rows = dl([
    [tx("VAT ID"), p.vatId],
    [tx("Tax number"), p.taxId],
    [tx("Tax office"), p.taxOffice],
    [tx("Registration"), p.legalId ? idValue(p.legalId) : ""],
    [tx("Identifier"), p.ids.map((id, i) => [i ? el("br") : null, ...idValue(id)])],
    [tx("Electronic address"), p.endpoint ? idValue(p.endpoint) : ""],
    [tx("Contact"), p.contact.name],
    [tx("Phone"), p.contact.phone],
    [tx("Email"), p.contact.email],
  ]);
  return el("section", { class: "ei-party" },
    el("h4", { class: "ei-h" }, title),
    el("p", { class: "ei-name" }, p.name || "–"),
    p.tradingName ? el("p", { class: "ei-sub" }, p.tradingName) : null,
    p.legalForm ? el("p", { class: "ei-sub" }, p.legalForm) : null,
    lines.length ? el("p", { class: "ei-addr" }, lines.flatMap((l, i) => (i ? [el("br"), l] : [l]))) : null,
    extraLines,
    rows);
}

/* ------------------------------------------------------------------ one invoice */

function lineDetails(l, cur) {
  const out = [];
  const add = (...parts) => out.push(el("span", { class: "ei-detail" }, parts));
  if (l.description && l.description !== l.name) add(l.description);
  if (l.note) add(l.note);
  if (l.sellerItemId) add(tx("Seller item no. {id}", { id: l.sellerItemId }));
  if (l.buyerItemId) add(tx("Buyer item no. {id}", { id: l.buyerItemId }));
  if (l.standardItemId) add(tx("Standard ID {id}", { id: (l.standardItemId.scheme ? l.standardItemId.scheme + " " : "") + l.standardItemId.value }));
  for (const c of l.classifications) add(tx("Classification {code}", { code: (c.scheme ? c.scheme + " " : "") + c.code }));
  if (l.period.start || l.period.end) add(`${tx("Period")}: ${fmtPeriod(l.period)}`);
  if (l.orderLineRef) add(tx("Order line {n}", { n: l.orderLineRef }));
  for (const p of l.properties) add(p.name && p.value ? `${p.name}: ${p.value}` : p.name || p.value);
  if (l.priceDiscount && (l.priceDiscount.amount || l.priceDiscount.baseAmount)) {
    add(tx("List price {price}, discount {discount}", { price: fmtDec(l.priceDiscount.baseAmount, 2), discount: fmtDec(l.priceDiscount.amount, 2) }));
  }
  for (const a of l.allowances) add(`${a.reason || tx("Discount")}: ${a.percent ? fmtRate(a.percent) : ""}${a.percent && a.amount ? " · " : ""}${a.amount ? fmtMoney(negDec(a.amount), cur) : ""}`.trim());
  for (const a of l.charges) add(`${a.reason || tx("Surcharge")}: ${a.percent ? fmtRate(a.percent) : ""}${a.percent && a.amount ? " · " : ""}${a.amount ? fmtMoney(a.amount, cur) : ""}`.trim());
  return out;
}

function vatCell(v) {
  const rate = has(v.rate) ? fmtRate(v.rate) : "";
  if (v.category === "S" && rate) return rate;
  const name = vatName(v.category);
  const native = v.native && v.native !== v.category ? ` (${v.native})` : "";
  if (name) return rate && v.category !== "Z" && v.category !== "E" && v.category !== "AE" ? `${rate} ${name}${native}` : `${name}${native}`;
  return rate || v.native || "";
}

function linesTable(inv, budget) {
  const shown = inv.lines.slice(0, budget.left);
  budget.left -= shown.length;
  if (!inv.lines.length) return null;
  const cur = inv.currency;
  const corrected = shown.some((l) => l.before);
  const rows = shown.map((l) => el("tr", { class: l.before ? "is-before" : null },
    el("th", { scope: "row", class: "ei-n" }, l.id),
    el("td", { class: "ei-desc" },
      el("strong", {}, l.name || l.description || "–"),
      corrected ? tag(l.before ? tx("Before correction") : tx("After correction")) : null,
      lineDetails(l, cur)),
    el("td", { class: "ei-num-c" }, fmtQty(l.quantity, l.unit)),
    el("td", { class: "ei-num-c" }, fmtDec(l.unitPrice, l.unitPrice ? 2 : 0) + (l.priceBaseQuantity && l.priceBaseQuantity !== "1" ? ` / ${fmtDec(l.priceBaseQuantity)}` : "")),
    el("td", { class: "ei-vat" }, vatCell(l.vat)),
    el("td", { class: "ei-num-c" }, fmtDec(l.netAmount, l.netAmount ? 2 : 0))));
  const amountHead = cur ? `${tx("Amount")} (${cur})` : tx("Amount");
  const table = el("div", { class: "calc-table ei-lines", tabindex: "0", role: "region", "aria-label": tx("Line items") },
    el("table", { class: "dv-table ei-table" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", class: "ei-n" }, tx("No.")), el("th", { scope: "col" }, tx("Description")),
        el("th", { scope: "col", class: "ei-num-c" }, tx("Quantity")), el("th", { scope: "col", class: "ei-num-c" }, tx("Unit price")),
        el("th", { scope: "col" }, tx("VAT")), el("th", { scope: "col", class: "ei-num-c" }, amountHead))),
      el("tbody", {}, rows)));
  const cut = inv.linesTotal > shown.length
    ? el("p", { class: "ei-warn" }, tx("Showing the first {shown} of {total} line items.", { shown: fmtNum(shown.length), total: fmtNum(inv.linesTotal) }))
    : null;
  return block(tx("Line items"), table, cut);
}

function adjustments(inv) {
  const cur = inv.currency;
  const entry = (a, sign) => {
    const what = a.kind === "socialSecurity" ? tx("Social security contribution") : a.reason;
    const label = [what, a.reasonCode ? `(${a.reasonCode})` : "", a.percent ? fmtRate(a.percent) : ""].filter(Boolean).join(" ");
    return [label || (sign < 0 ? tx("Discount") : tx("Surcharge")), a.amount ? fmtMoney(sign < 0 ? negDec(a.amount) : a.amount, cur) : ""];
  };
  const rows = [...inv.allowances.map((a) => entry(a, -1)), ...inv.charges.map((a) => entry(a, 1))];
  return rows.length ? dl(rows, "ei-dl ei-adj") : null;
}

function totals(inv) {
  const t = inv.totals, cur = inv.currency;
  const m = (v, neg) => (has(v) ? fmtMoney(neg ? negDec(v) : v, cur) : "");
  const showLines = has(t.lineNet) && t.lineNet !== t.taxExclusive;
  const rows = [
    [tx("Line items total"), showLines ? m(t.lineNet) : ""],
    [tx("Allowances"), has(t.allowances) && Number(t.allowances) !== 0 ? m(t.allowances, true) : ""],
    [tx("Charges"), has(t.charges) && Number(t.charges) !== 0 ? m(t.charges) : ""],
    [tx("Total without VAT"), m(t.taxExclusive)],
    [tx("VAT"), m(t.tax)],
    [t.taxInTaxCurrency ? tx("VAT in {currency}", { currency: inv.taxCurrency }) : "", t.taxInTaxCurrency ? fmtMoney(t.taxInTaxCurrency, inv.taxCurrency) : ""],
    [tx("Total with VAT"), m(t.taxInclusive)],
    [inv.format === "cfdi" ? tx("Tax withheld") : tx("Withheld VAT (tevkifat)"), has(inv.withholdingTotal) && Number(inv.withholdingTotal) !== 0 ? m(inv.withholdingTotal, true) : ""],
    [tx("Prepaid"), has(t.prepaid) && Number(t.prepaid) !== 0 ? m(t.prepaid, true) : ""],
    [tx("Rounding"), has(t.rounding) && Number(t.rounding) !== 0 ? m(t.rounding) : ""],
  ];
  const list = dl(rows.filter(([k]) => k), "ei-dl ei-totals");
  const due = has(t.payable) ? el("p", { class: "ei-due" }, el("span", {}, tx("Amount due")), el("strong", {}, m(t.payable))) : null;
  return el("div", { class: "ei-totalbox" }, list, due);
}

function vatTable(inv) {
  if (!inv.vatBreakdown.length) return null;
  const cur = inv.currency;
  const rows = inv.vatBreakdown.map((v) => el("tr", {},
    el("td", {}, vatName(v.category) || "–", v.exemptionReasonCode ? [" ", tag(v.exemptionReasonCode)] : null,
      v.exemptionReason ? el("span", { class: "ei-detail" }, v.exemptionReason) : null),
    el("td", { class: "ei-num-c" }, has(v.rate) ? fmtRate(v.rate) : "–"),
    el("td", { class: "ei-num-c" }, fmtMoney(v.taxable, cur)),
    el("td", { class: "ei-num-c" }, fmtMoney(v.tax, cur))));
  return block(tx("VAT breakdown"), el("div", { class: "calc-table ei-vattable", tabindex: "0", role: "region", "aria-label": tx("VAT breakdown") },
    el("table", { class: "dv-table ei-table" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, tx("VAT category")), el("th", { scope: "col", class: "ei-num-c" }, tx("Rate")),
        el("th", { scope: "col", class: "ei-num-c" }, tx("Net amount")), el("th", { scope: "col", class: "ei-num-c" }, tx("VAT amount")))),
      el("tbody", {}, rows))));
}

function groupIban(id) { return looksLikeIban(id) ? id.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim() : id; }

function paymentBlock(inv) {
  const p = inv.payment, cur = inv.currency;
  const means = meansName(p.meansCode);
  const meansText = [means, p.meansNative && p.meansNative !== p.meansCode ? `(${p.meansNative})` : "", p.meansText && p.meansText !== means ? `– ${p.meansText}` : ""].filter(Boolean).join(" ");
  const accounts = p.accounts.map((a) => [
    looksLikeIban(a.id) ? "IBAN" : tx("Account number"),
    [groupIban(a.id), a.bic ? [" · BIC ", a.bic] : null, a.name ? el("span", { class: "ei-detail" }, a.name) : null, a.bank ? el("span", { class: "ei-detail" }, a.bank) : null],
  ]);
  const card = p.card ? [[tx("Card"), [p.card.number, p.card.holder ? ` · ${p.card.holder}` : ""]]] : [];
  const dd = p.directDebit ? [
    [tx("Mandate reference"), p.directDebit.mandateId], [tx("Creditor ID"), p.directDebit.creditorId], [tx("Account to be debited"), groupIban(p.directDebit.debitedAccount)],
  ] : [];
  const inst = p.instalments.length ? [[tx("Instalments"), p.instalments.map((i, n) => [n ? el("br") : null, [fmtDate(i.dueDate), i.amount ? ` · ${fmtMoney(i.amount, cur)}` : "", i.meansNative ? ` · ${i.meansNative}` : ""].join("")])]] : [];
  const list = dl([
    [tx("Payment means"), meansText],
    [tx("Payment reference"), p.reference],
    [tx("Due date"), fmtDate(p.dueDate)],
    [tx("Payment terms"), p.terms ? el("span", { class: "ei-pre" }, p.terms) : ""],
    ...accounts, ...card, ...dd, ...inst,
    [tx("Paid"), p.paid ? (p.paidDate ? tx("Paid on {date}", { date: fmtDate(p.paidDate) }) : tx("Yes")) : ""],
  ]);
  return block(tx("Payment"), list);
}

/* Offer an embedded file as a download: generic type, cleaned name, decoded only when asked. */
function downloadBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function attachmentsBlock(inv, index) {
  if (!inv.attachments.length) return null;
  const items = inv.attachments.map((a, i) => {
    const name = safeFileName(a.filename, `attachment-${index + 1}-${i + 1}`);
    const meta = [a.mimeType, a.size ? fmtBytes(a.size) : ""].filter(Boolean).join(" · ");
    const btn = a.base64
      ? el("button", {
        type: "button", class: "btn btn--sm ei-attdl", "aria-label": `${tx("Download")}: ${name}`,
        onclick: () => {
          const bytes = base64Bytes(a.base64);
          if (!bytes) { setStatus(status, "error", tx("This attached document could not be decoded.")); return; }
          downloadBytes(bytes, name);
        },
      }, tx("Download"))
      : null;
    return el("li", {},
      el("span", { class: "ei-attname" }, a.base64 ? name : (a.description || a.id || name)),
      meta ? el("span", { class: "ei-detail" }, meta) : null,
      a.description && a.base64 ? el("span", { class: "ei-detail" }, a.description) : null,
      a.id && a.base64 ? el("span", { class: "ei-detail" }, a.id) : null,
      a.uri ? el("span", { class: "ei-detail" }, `${tx("Link (not opened)")}: ${a.uri}`) : null,
      a.kind === "stylesheet" ? el("span", { class: "ei-detail" }, tx("The sender's XSLT stylesheet for drawing this invoice. Download only: it is never run here.")) : null,
      btn);
  });
  return block(tx("Attachments"), el("ul", { class: "ei-atts" }, items), el("p", { class: "ei-hint" }, tx("Attachments come from the sender and are not checked. They are offered as plain downloads and never opened here; open them only if you trust the sender.")));
}

/* The folio fiscal (UUID) of a CFDI, large, with the plain link to the SAT's verification page. The link is only ever clicked by
   the visitor; this page sends nothing. */
function uuidBlock(inv) {
  const code = inv.codes.find((c) => c.key === "cfdiUuid");
  if (!code) return null;
  const link = inv.links.find((l) => l.key === "satVerify");
  return el("div", { class: "ei-uuidbox" },
    el("p", { class: "ei-uuidlabel" }, codeName(code)),
    el("p", { class: "ei-uuid" }, code.value),
    link && /^https:\/\/verificacfdi\.facturaelectronica\.sat\.gob\.mx\/default\.aspx\?/.test(link.url)
      ? el("p", { class: "ei-verify" }, el("a", { href: link.url, target: "_blank", rel: "noopener noreferrer" }, tx("Verify with SAT")), " ", el("span", { class: "ei-detail" }, tx("Opens the SAT's own check page in a new tab. This page sends nothing; the details are only sent when you click.")))
      : null);
}

function sheet(inv, index, total, budget) {
  const cur = inv.currency;
  const r = inv.references;
  const meta = dl([
    ...inv.codes.filter((c) => c.key !== "cfdiUuid").map((c) => [codeName(c), el("span", { class: "ei-code" }, c.value)]),
    [tx("Issue date"), fmtDate(inv.issueDate)],
    [tx("Due date"), fmtDate(inv.dueDate)],
    [tx("Delivery date"), fmtDate(inv.deliveryDate)],
    [tx("Period"), fmtPeriod(inv.period)],
    [tx("Tax point date"), fmtDate(inv.taxPointDate)],
    [tx("Currency"), cur],
    [tx("Buyer reference"), inv.buyerReference],
  ], "ei-dl ei-meta");
  const refs = dl([
    [tx("Order"), r.order], [tx("Sales order"), r.salesOrder], [tx("Contract"), r.contract], [tx("Project"), r.project],
    [tx("Delivery note"), r.despatchAdvice], [tx("Goods receipt"), r.receiptAdvice], [tx("Tender or lot"), r.tender],
    [tx("Accounting reference"), r.accounting], [tx("Invoiced object"), r.invoicedObject],
    [tx("Preceding invoice"), r.preceding.map((p, i) => [i ? el("br") : null, [p.number, p.date ? ` (${fmtDate(p.date)})` : ""].join("")])],
  ], "ei-dl ei-refs");
  const marks = inv.markings.length ? el("ul", { class: "ei-marks" }, inv.markings.map((m) => el("li", {}, markName(m)))) : null;
  const d = inv.delivery;
  const deliveryLines = d ? [d.name ? el("p", { class: "ei-sub" }, d.name) : null, d.locationId ? el("p", { class: "ei-sub" }, d.locationId) : null] : [];
  const deliveryParty = d ? (() => {
    const lines = addressLines(d.address);
    return el("section", { class: "ei-party" }, el("h4", { class: "ei-h" }, tx("Delivery")), deliveryLines,
      lines.length ? el("p", { class: "ei-addr" }, lines.flatMap((l, i) => (i ? [el("br"), l] : [l]))) : null);
  })() : null;
  const extras = inv.extra.map((e) => [extraName(e), [e.value, e.amount ? fmtMoney(e.amount, cur) : ""].filter(Boolean).join(e.value && e.amount ? " · " : "")]);
  const notes = inv.notes.length ? block(tx("Notes"), inv.notes.map((n) => el("p", { class: "ei-pre" }, n))) : null;
  const warns = inv.warnings.filter((w) => w.code === "noLines" || w.code === "attachmentsTruncated" || w.code === "invoicesTruncated");
  return el("article", { class: "ei-sheet", "aria-label": `${typeTitle(inv.type)} ${inv.number}` },
    el("header", { class: "ei-head" },
      el("div", { class: "ei-title" },
        el("p", { class: "ei-kind" }, typeTitle(inv.type), inv.typeNative ? [" ", tag(inv.typeNative)] : null, total > 1 ? ` · ${index + 1}/${total}` : null),
        el("h3", { class: "ei-num" }, inv.number || "–"),
        uuidBlock(inv),
        el("p", { class: "ei-profile" }, [inv.formatLabel, inv.profile.name && inv.profile.name !== inv.formatLabel ? inv.profile.name : ""].filter(Boolean).join(" · "))),
      meta, marks),
    el("div", { class: "ei-parties" }, party(tx("Seller"), inv.seller), party(tx("Buyer"), inv.buyer), deliveryParty,
      inv.payee ? party(tx("Payee"), inv.payee) : null, inv.taxRepresentative ? party(tx("Tax representative"), inv.taxRepresentative) : null),
    refs,
    linesTable(inv, budget),
    warns.map((w) => warningNote(w)),
    el("div", { class: "ei-sum" }, vatTable(inv), el("div", { class: "ei-sumcol" }, adjustments(inv), totals(inv))),
    paymentBlock(inv),
    notes,
    attachmentsBlock(inv, index),
    block(tx("Additional information"), dl(extras)));
}

function warningNote(w) {
  switch (w.code) {
    case "noLines": return el("p", { class: "ei-warn" }, tx("This profile ({profile}) carries no line items, only totals.", { profile: w.data.profile }));
    case "attachmentsTruncated": return el("p", { class: "ei-warn" }, tx("Only the first {n} attached documents are listed.", { n: fmtNum(LIMITS.attachments) }));
    case "invoicesTruncated": return el("p", { class: "ei-warn" }, tx("Only the first {shown} of {total} invoices in this file are shown.", { shown: fmtNum(w.data.shown), total: fmtNum(w.data.total) }));
    default: return null;
  }
}

/* ------------------------------------------------------------------ the page */

function reset() {
  token++;
  current = null;
  work.hidden = true;
  sheets.replaceChildren();
  match.hidden = true; match.replaceChildren();
  notesBox.hidden = true; notesBox.replaceChildren();
  rawBox.hidden = true; rawText.textContent = "";
  btnRaw.setAttribute("aria-expanded", "false");
  btnRaw.textContent = tx("Show raw XML");
  btnXml.hidden = true;
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a file");
}

function messageFor(err) {
  if (err instanceof InvoiceError) {
    const d = err.data || {};
    switch (err.code) {
      case "empty": return tx("This file is empty.");
      case "too-large": return tx("This file is larger than {limit}, which is more than this page reads.", { limit: fmtBytes(LIMITS.fileBytes) });
      case "doctype": return tx("This file declares a DOCTYPE or an entity, so it was not opened. Real invoices never need one, and such declarations are how XML files are used to attack the programs that read them.");
      case "malformed": {
        const where = d.line ? tx("Line {line}, column {column}: {message}", { line: fmtNum(d.line), column: fmtNum(d.column), message: d.message }) : d.message || "";
        return tx("This file is not well-formed XML, so it can't be shown. {detail}", { detail: where }).trim();
      }
      case "not-invoice":
        return d.name ? tx("This XML file is not a supported invoice. Its root element is <{name}>.", { name: d.name }) : tx("This is not an XML invoice, a PDF or a signed .p7m file.");
      case "unsupported":
        switch (d.kind) {
          case "zugferd1": return tx("This is a ZUGFeRD 1.0 invoice. Only ZUGFeRD 2 and Factur-X (the CII format of EN 16931) can be shown.");
          case "fsm": return tx("This is a simplified FatturaPA (FSM10). Only FPR12 and FPA12 invoices can be shown.");
          case "farr": return tx("This is a KSeF FA_RR invoice (flat-rate farmers). Only FA(2) and FA(3) invoices can be shown.");
          case "fa1": return tx("This is a KSeF FA(1) invoice. Only FA(2) and FA(3) invoices can be shown.");
          default: return tx("This is a UBL {name} document, not an invoice or credit note.", { name: d.name || "" });
        }
      case "p7m":
        if (d.reason === "detached") return tx("This signed file holds only a signature, not the invoice (a detached signature). Open the invoice file itself.");
        if (d.reason === "notSigned") return tx("This is not a signed .p7m (CMS) file.");
        return tx("This signed file is damaged or too complex to read.");
      case "pdf-none": return tx("This PDF has no attached files. It is a plain PDF, not a ZUGFeRD or Factur-X invoice, so there is no invoice data to show.");
      case "pdf-no-invoice": return tx("This PDF has attached files, but none of them is an invoice in a supported format.");
      case "pdf-timeout": return tx("Reading the PDF took too long, so it was stopped.");
      default: break;
    }
  }
  return friendlyError(err);
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new InvoiceError("pdf-timeout")), ms); })]).finally(() => clearTimeout(timer));
}

/* The invoice attached to a PDF (ZUGFeRD, Factur-X): pdf.js lists the attached files; only XML ones are read. */
async function openPdf(bytes, name) {
  const doc = await openForView(bytes, name);
  try {
    const list = await withTimeout(doc.getAttachments(), PDF_WAIT_MS);
    const entries = list instanceof Map ? [...list.entries()] : Object.entries(list || {});
    const files = entries.map(([key, v]) => ({ key, filename: (v && (v.filename || v.rawFilename)) || String(key), content: v && v.content }));
    if (!files.length) throw new InvoiceError("pdf-none");
    const order = pdfCandidates(files);
    if (!order.length) throw new InvoiceError("pdf-no-invoice");
    let first = null;
    for (const key of order) {
      const f = files.find((x) => x.key === key);
      let content = f.content;
      if (!content && typeof doc.getAttachmentContent === "function") content = await withTimeout(doc.getAttachmentContent(key), PDF_WAIT_MS);
      if (!content || !content.length) continue;
      try {
        if (content.length > LIMITS.fileBytes) throw new InvoiceError("too-large");
        const xml = decodeBytes(content);
        return { result: parseXmlText(xml), xml, container: "pdf", layers: 0, attachmentName: f.filename };
      } catch (err) {
        first = first || err;
      }
    }
    if (first instanceof InvoiceError && first.code === "not-invoice") throw new InvoiceError("pdf-no-invoice");
    throw first || new InvoiceError("pdf-no-invoice");
  } finally {
    closeView(doc);
  }
}

function fileNotes(opened) {
  const out = [];
  for (const code of opened.result.notes) {
    if (code === "signatureNotChecked") out.push(tx("The digital signature of this .p7m file was not checked. This page only unwraps the XML; it does not say who signed it or whether it was changed."));
    else if (code === "sealNotChecked") out.push(tx("This invoice carries a fiscal seal or e-signature (mali mühür). It was not verified: this page does not say who sealed the invoice or whether it was changed."));
    else if (code === "selloNotChecked") out.push(tx("This CFDI carries a digital seal (sello) and the SAT stamp (timbre fiscal). They were not verified: this page does not say whether they are valid or whether the file was changed. Use the SAT link to check the invoice."));
    else if (code === "dscksNotChecked") out.push(tx("This invoice carries digital signatures (DSCKS). They were not verified: this page does not say who signed the invoice or whether it was changed."));
    else if (code === "hiddenChars") out.push(tx("Hidden text-direction and control characters were removed from the text shown here."));
  }
  if (opened.container === "pdf") out.push(tx("Read from the file {name} attached to this PDF.", { name: safeFileName(opened.attachmentName, "invoice.xml") }));
  return out;
}

function showMatch(viewer) {
  const href = LINKS[viewer];
  match.hidden = true;
  match.replaceChildren();
  if (!href || viewer === HERE) return;
  const anchor = [...document.querySelectorAll(".related a")].find((a) => a.getAttribute("href") === href);
  const name = anchor ? anchor.textContent.trim() : href;
  match.replaceChildren(el("p", {}, txf("This file is a better match for {link}.", { link: el("a", { href }, name) })));
  match.hidden = false;
}

function show(opened, file) {
  const { result } = opened;
  current = { ...opened, name: file.name, size: file.size };
  const budget = { left: LIMITS.lines };
  const n = result.invoices.length;
  sheets.replaceChildren(...result.invoices.map((inv, i) => sheet(inv, i, n, budget)));
  $("#fname").textContent = file.name;
  const lines = result.invoices.reduce((s, i) => s + i.linesTotal, 0);
  $("#finfo").textContent = [result.formatLabel, result.invoices[0].profile.name && result.invoices[0].profile.name !== result.formatLabel ? result.invoices[0].profile.name : "", fmtBytes(file.size),
    n > 1 ? txn(n, "{n} invoice", "{n} invoices") : "", txn(lines, "{n} line item", "{n} line items")].filter(Boolean).join(" · ");
  const notes = fileNotes(opened);
  notesBox.replaceChildren(...notes.map((t) => el("li", {}, t)));
  notesBox.hidden = !notes.length;
  showMatch(opened.container === "pdf" ? "zugferd" : result.viewer);
  btnXml.hidden = opened.container === "xml";
  rawBox.hidden = true;
  rawText.textContent = "";
  btnRaw.setAttribute("aria-expanded", "false");
  btnRaw.textContent = tx("Show raw XML");
  drop.classList.add("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose another file");
  work.hidden = false;
  const first = result.invoices[0];
  setStatus(status, "done", txn(n, "Read {n} invoice.", "Read {n} invoices.") + (first.number ? ` ${first.number}` : ""));
  announce(tx("{name} opened.", { name: file.name }));
}

dropzone(drop, {
  accept: [".xml", ".pdf", ".p7m", "text/xml", "application/xml", "application/pdf"], maxFileBytes: LIMITS.fileBytes,
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    reset();
    const my = token;
    setStatus(status, "working", tx("Reading the file…"));
    await tick();
    try {
      const bytes = await readBytes(f);
      const opened = sniff(bytes) === "pdf" ? await openPdf(bytes, f.name) : openBytes(bytes);
      if (my !== token) return;
      show(opened, f);
    } catch (err) {
      if (my !== token) return;
      console.warn(err);
      reset();
      setStatus(status, "error", messageFor(err));
    }
  },
});

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const stem = () => safeFileName((current && current.name) || "invoice").replace(/\.(xml|pdf|p7m)$/i, "").replace(/\.(xml|pdf)$/i, "") || "invoice";

btnJson.addEventListener("click", () => {
  if (!current) return;
  const json = exportJson(current.result, { file: current.name, container: current.container });
  saveBlob(new Blob([json], { type: "application/json;charset=utf-8" }), stem() + ".json");
});

btnXml.addEventListener("click", () => {
  if (!current) return;
  saveBlob(new Blob([current.xml], { type: "application/xml;charset=utf-8" }), stem() + ".xml");
});

btnRaw.addEventListener("click", () => {
  if (!current) return;
  const open = rawBox.hidden;
  if (open && !rawText.textContent) {
    const p = prettyXml(current.xml);
    rawText.textContent = p.text + (p.cut ? "\n…" : "");
    $("#ei-rawcut").hidden = !p.cut;
  }
  rawBox.hidden = !open;
  btnRaw.setAttribute("aria-expanded", String(open));
  btnRaw.textContent = open ? tx("Hide raw XML") : tx("Show raw XML");
});

/* Printing shows only the invoice (see the print rules in the page's stylesheet). The invoice's own title names the saved file. */
let savedTitle = "";
btnPrint.addEventListener("click", () => window.print());
window.addEventListener("beforeprint", () => {
  if (!current) return;
  savedTitle = document.title;
  const inv = current.result.invoices[0];
  document.title = [typeTitle(inv.type), inv.number].filter(Boolean).join(" ");
});
window.addEventListener("afterprint", () => { if (savedTitle) document.title = savedTitle; savedTitle = ""; });

$("#clear").addEventListener("click", () => {
  reset();
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});
