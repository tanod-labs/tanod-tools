// KSeF structured invoices (the Polish FA(2) and FA(3) schemas, root element Faktura) to the normalized invoice model.
// Elements are found by local name. Reads, does not validate. Not read: the FA(3) structured attachment (Zalacznik),
// the farmers' flat-rate invoices (FA_RR) and the older FA(1).
import {
  LIMITS, blankInvoice, blankLine, blankParty, blankAddress, all, one, childs, t, tb, block, attr, dec, trimZeros, isoDate, sumDec, price, qty,
} from "./einvoicecore.js?v=11";

const money = (e, path) => dec(t(e, path));
const list = (arr) => arr.slice(0, LIMITS.list);

const KIND = {
  VAT: "invoice", ZAL: "prepayment", ROZ: "invoice", UPR: "invoice", KOR: "correction", KOR_ZAL: "correction", KOR_ROZ: "correction",
};
/* FormaPlatnosci -> UN/CEFACT payment means code */
const FORMA = { 1: "10", 2: "48", 3: "ZZZ", 4: "20", 5: "ZZZ", 6: "30", 7: "ZZZ" };

function party(p, role) {
  const out = blankParty();
  if (!p) return out;
  const di = one(p, "DaneIdentyfikacyjne");
  out.name = t(di, "Nazwa") || [t(di, "ImiePierwsze"), t(di, "Nazwisko")].filter(Boolean).join(" ");
  const nip = t(di, "NIP");
  if (nip) out.vatId = (t(p, "PrefiksPodatnika") || "PL") + nip;
  else if (t(di, "KodUE") && t(di, "NrVatUE")) out.vatId = t(di, "KodUE") + t(di, "NrVatUE");
  if (!nip && t(di, "NrID")) out.taxId = [t(di, "KodKraju"), t(di, "NrID")].filter(Boolean).join(" ");
  if (t(di, "IDWew")) out.ids.push({ scheme: "IDWew", value: t(di, "IDWew") });
  const a = one(p, "Adres");
  const adr = blankAddress();
  adr.countryCode = t(a, "KodKraju");
  adr.street = t(a, "AdresL1");
  adr.street2 = t(a, "AdresL2");
  out.address = adr;
  out.contact = { name: "", phone: t(p, "DaneKontaktowe/Telefon"), email: t(p, "DaneKontaktowe/Email") };
  return out;
}

const hasParty = (p) => !!(p.name || p.vatId || p.address.street);

function line(le) {
  const L = blankLine();
  L.id = t(le, "NrWierszaFa");
  L.name = tb(le, "P_7");
  L.sellerItemId = t(le, "Indeks");
  const gtin = t(le, "GTIN");
  if (gtin) L.standardItemId = { scheme: "GTIN", value: gtin };
  for (const [tag, scheme] of [["PKWiU", "PKWiU"], ["CN", "CN"], ["PKOB", "PKOB"]]) if (t(le, tag)) L.classifications.push({ scheme, code: t(le, tag) });
  L.unit = t(le, "P_8A");
  L.quantity = qty(t(le, "P_8B"));
  L.unitPrice = price(t(le, "P_9A") || t(le, "P_9B"));
  L.netAmount = dec(t(le, "P_11") || t(le, "P_11A"));
  const rate = t(le, "P_12") || t(le, "P_12_XII");
  const num = /^\d+(?:[.,]\d+)?$/.test(rate) ? trimZeros(rate.replace(",", ".")) : "";
  const cat = num ? (Number(num) > 0 ? "S" : "Z") : /^0 ?WDT/i.test(rate) ? "K" : /^0 ?EX/i.test(rate) ? "G" : /^0/.test(rate) ? "Z" : /^zw/i.test(rate) ? "E" : /^oo/i.test(rate) ? "AE" : /^np/i.test(rate) ? "O" : "";
  L.vat = { category: cat, rate: num || (/^0 ?(?:KR|WDT|EX)/i.test(rate) ? "0" : ""), native: num ? "" : rate };
  if (t(le, "P_10")) L.allowances.push({ reason: "", reasonCode: "", kind: "", amount: dec(t(le, "P_10")), baseAmount: "", percent: "" });
  if (t(le, "P_6A")) L.period = { start: isoDate(t(le, "P_6A")), end: "" };
  if (t(le, "GTU")) L.properties.push({ name: "GTU", value: t(le, "GTU") });
  if (t(le, "Procedura")) L.properties.push({ name: "Procedura", value: t(le, "Procedura") });
  L.before = t(le, "StanPrzed") === "1";
  return L;
}

/* net and VAT fields of the summary by group: [net element, VAT element, category, default rate] */
const GROUPS = [
  ["P_13_1", "P_14_1", "S", ["23", "22"], "23"], ["P_13_2", "P_14_2", "S", ["8", "7"], "8"], ["P_13_3", "P_14_3", "S", ["5"], "5"],
  ["P_13_4", "P_14_4", "S", ["4"], "4"], ["P_13_5", "P_14_5", "S", ["3"], ""],
  ["P_13_6_1", "", "Z", [], "0"], ["P_13_6_2", "", "K", [], "0"], ["P_13_6_3", "", "G", [], "0"],
  ["P_13_7", "", "E", [], ""], ["P_13_8", "", "O", [], ""], ["P_13_9", "", "O", [], ""], ["P_13_10", "", "AE", [], ""], ["P_13_11", "", "O", [], ""],
];

export function fromKsef(root) {
  const inv = blankInvoice();
  const code = one(root, "Naglowek/KodFormularza");
  const schema = attr(code, "kodSystemowy") || "FA";
  inv.format = "ksef";
  inv.formatLabel = "KSeF";
  inv.profile = { customizationId: schema, profileId: attr(code, "wersjaSchemy"), name: `KSeF ${schema}`.trim() };

  const fa = one(root, "Fa");
  const kind = t(fa, "RodzajFaktury") || "VAT";
  inv.typeNative = kind;
  inv.typeCode = kind;
  inv.type = KIND[kind.toUpperCase()] || "invoice";
  inv.currency = t(fa, "KodWaluty");
  inv.issueDate = isoDate(t(fa, "P_1"));
  inv.number = t(fa, "P_2");
  inv.deliveryDate = isoDate(t(fa, "P_6"));
  inv.period = { start: isoDate(t(fa, "OkresFa/P_6_Od")), end: isoDate(t(fa, "OkresFa/P_6_Do")) };
  inv.references.despatchAdvice = all(fa, "WZ").map((x) => x.textContent.trim()).filter(Boolean).join(", ");

  inv.seller = party(one(root, "Podmiot1"));
  inv.buyer = party(one(root, "Podmiot2"));
  if (t(root, "Podmiot2/NrKlienta")) inv.buyer.ids.push({ scheme: "NrKlienta", value: t(root, "Podmiot2/NrKlienta") });
  for (const p3 of list(childs(root, "Podmiot3"))) {
    const role = t(p3, "Rola");
    const p = party(p3);
    if (role === "2" && hasParty(p) && !inv.delivery) inv.delivery = { name: p.name, locationId: "", address: p.address };
    else if (role === "1" && hasParty(p) && !inv.payee) inv.payee = p;
  }

  for (const d of list(all(fa, "DodatkowyOpis"))) {
    const key = t(d, "Klucz"), val = t(d, "Wartosc");
    if (key || val) inv.notes.push(key && val ? `${key}: ${val}` : key || val);
  }
  for (const f of list(all(root, "Stopka/Informacje/StopkaFaktury"))) if (block(f)) inv.notes.push(block(f));
  for (const [tag, label] of [["KRS", "KRS"], ["REGON", "REGON"], ["BDO", "BDO"]]) {
    if (t(root, `Stopka/Rejestry/${tag}`)) inv.extra.push({ key: "", label, value: t(root, `Stopka/Rejestry/${tag}`), amount: "" });
  }
  if (t(fa, "P_1M")) inv.extra.push({ key: "placeOfIssue", label: "", value: t(fa, "P_1M"), amount: "" });
  if (t(fa, "PrzyczynaKorekty")) inv.extra.push({ key: "correctionReason", label: "", value: t(fa, "PrzyczynaKorekty"), amount: "" });
  for (const c of list(all(fa, "DaneFaKorygowanej"))) {
    inv.references.preceding.push({ number: t(c, "NrFaKorygowanej"), date: isoDate(t(c, "DataWystFaKorygowanej")) });
    if (t(c, "NrKSeFFaKorygowanej")) inv.extra.push({ key: "", label: "KSeF", value: t(c, "NrKSeFFaKorygowanej"), amount: "" });
  }

  const ad = one(fa, "Adnotacje");
  if (t(ad, "P_16") === "1") inv.markings.push("cashAccounting");
  if (t(ad, "P_17") === "1") inv.markings.push("selfBilling");
  if (t(ad, "P_18") === "1") inv.markings.push("reverseCharge");
  if (t(ad, "P_18A") === "1") inv.markings.push("splitPayment");
  const exemptBasis = ["P_19A", "P_19B", "P_19C"].map((k) => t(ad, `Zwolnienie/${k}`)).filter(Boolean).join("; ");
  if (t(ad, "Zwolnienie/P_19") === "1") inv.markings.push("exemption");

  const els = childs(fa, "FaWiersz");
  inv.linesTotal = els.length;
  for (const le of els.slice(0, LIMITS.lines)) inv.lines.push(line(le));
  const after = inv.lines.filter((l) => !l.before);

  for (const [net, vat, cat, rates, dflt] of GROUPS) {
    const taxable = money(fa, net), tax = vat ? money(fa, vat) : "";
    if (!taxable && !tax) continue;
    const fromLines = after.map((l) => l.vat.rate).find((r) => rates.includes(r));
    inv.vatBreakdown.push({
      category: cat, rate: fromLines || dflt, taxable, tax: tax || (cat === "S" ? "" : "0.00"),
      exemptionReason: cat === "E" ? exemptBasis : "", exemptionReasonCode: "",
    });
  }
  const settle = one(fa, "Rozliczenie");
  const taxSum = sumDec(GROUPS.filter((g) => g[1]).map((g) => money(fa, g[1])));
  const prepaid = sumDec(all(fa, "Platnosc/ZaplataCzesciowa/KwotaZaplatyCzesciowej").map((x) => dec(x.textContent)));
  inv.totals = {
    lineNet: after.length === inv.linesTotal && !kind.startsWith("KOR") ? sumDec(after.map((l) => l.netAmount)) : "",
    allowances: "", charges: "",
    taxExclusive: sumDec(GROUPS.map((g) => money(fa, g[0]))),
    tax: taxSum, taxInclusive: money(fa, "P_15"), prepaid, rounding: "",
    payable: money(settle, "DoZaplaty") || money(settle, "DoRozliczenia") || money(fa, "P_15"),
    taxInTaxCurrency: sumDec(GROUPS.filter((g) => g[1]).map((g) => money(fa, g[1] + "W"))),
  };
  if (inv.totals.taxInTaxCurrency) inv.taxCurrency = "PLN";
  if (!inv.totals.taxExclusive && !inv.totals.tax) inv.totals.taxInclusive = money(fa, "P_15");

  const pay = inv.payment;
  const pl = one(fa, "Platnosc");
  pay.paid = t(pl, "Zaplacono") === "1";
  pay.paidDate = isoDate(t(pl, "DataZaplaty"));
  const forma = t(pl, "FormaPlatnosci");
  pay.meansNative = forma;
  pay.meansCode = forma ? FORMA[forma] || "ZZZ" : t(pl, "PlatnoscInna") === "1" ? "ZZZ" : "";
  pay.meansText = t(pl, "OpisPlatnosci");
  const due = childs(pl, "TerminPlatnosci");
  pay.dueDate = isoDate(t(due[0], "Termin"));
  pay.terms = due.map((d) => {
    const o = one(d, "TerminOpis");
    return o ? [t(o, "Ilosc"), t(o, "Jednostka"), t(o, "ZdarzeniePoczatkowe")].filter(Boolean).join(" ") : "";
  }).filter(Boolean).join("; ");
  inv.dueDate = pay.dueDate;
  for (const rb of list(all(pl, "RachunekBankowy"))) {
    if (t(rb, "NrRB")) pay.accounts.push({ id: t(rb, "NrRB"), name: t(rb, "OpisRachunku"), bic: t(rb, "SWIFT"), bank: t(rb, "NazwaBanku") });
  }
  return inv;
}
