// Vietnamese electronic invoices (hoa don dien tu under Decree 123/2020/ND-CP and Circular 78/2021/TT-BTC; root element HDon
// with the business data in DLHDon, the tax authority's code in MCCQT and the signatures in DSCKS) to the normalized invoice
// model. The same invoice can arrive wrapped in a TDiep message (DLieu/HDon), which is unwrapped too. Elements are found by
// local name. This reads and does not validate; the digital signatures in DSCKS are never verified (a file that carries one
// gets a note). No DOM and no translated text.
import {
  LIMITS, blankInvoice, blankParty, blankLine, all, one, childs, t, tb, dec, trimZeros, isoDate, sumDec, price, qty, isDec, cmpDec,
} from "./einvoicecore.js?v=11";

const money = (e, path) => dec(t(e, path));
const list = (arr) => arr.slice(0, LIMITS.list);

/* The HDon element of a root: HDon itself, a bare DLHDon, or the invoice inside a TDiep message. Null when there is none. */
export function findInvoice(root) {
  const n = root.localName || "";
  if (n === "HDon" || n === "DLHDon") return root;
  if (n === "TDiep") return all(root, "DLieu/HDon")[0] || all(root, "DLieu/DLHDon")[0] || null;
  return null;
}

/* "10%" -> standard 10; "0%" -> zero rate; "KCT" (not subject to VAT) and "KKKNT" (not declared or paid) -> outside the scope;
   "KHAC:3.5%" (another rate) -> standard 3.5. The code as written is kept in `native`. */
export function vatOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return { category: "", rate: "", native: "" };
  const m = /^(?:KHAC\s*:\s*)?(\d+(?:[.,]\d+)?)\s*%?$/i.exec(s);
  if (m) {
    const rate = trimZeros(m[1].replace(",", "."));
    const other = /^KHAC/i.test(s);
    return { category: cmp(rate) > 0 ? "S" : "Z", rate, native: other ? "KHAC" : "" };
  }
  if (/^KCT$/i.test(s) || /^KKKNT$/i.test(s)) return { category: "O", rate: "", native: s.toUpperCase() };
  return { category: "", rate: "", native: s };
}
const cmp = (r) => (isDec(r) ? cmpDec(r, "0") : 0);

function party(p, seller) {
  const out = blankParty();
  if (!p) return out;
  const person = t(p, "HVTNMHang");
  out.name = t(p, "Ten") || person;
  out.taxId = t(p, "MST");
  out.address.street = t(p, "DChi");
  out.contact = { name: t(p, "Ten") ? person : "", phone: t(p, "SDThoai"), email: t(p, "DCTDTu") };
  if (t(p, "MKHang")) out.ids.push({ scheme: "MKHang", value: t(p, "MKHang") });
  if (t(p, "CCCDan")) out.ids.push({ scheme: "CCCD", value: t(p, "CCCDan") });
  if (t(p, "SHChieu")) out.ids.push({ scheme: "SHChieu", value: t(p, "SHChieu") });
  if (seller && t(p, "Website")) out.ids.push({ scheme: "Web", value: t(p, "Website") });
  return out;
}

function line(le) {
  const L = blankLine();
  L.id = t(le, "STT");
  L.name = tb(le, "THHDVu");
  L.sellerItemId = t(le, "MHHDVu");
  L.unit = t(le, "DVTinh");
  L.quantity = qty(t(le, "SLuong"));
  L.unitPrice = price(t(le, "DGia"));
  L.netAmount = money(le, "ThTien");
  L.vat = vatOf(t(le, "TSuat"));
  const pct = t(le, "TLCKhau"), amt = money(le, "STCKhau");
  if (pct || amt) L.allowances.push({ reason: "", reasonCode: "", kind: "", amount: amt, baseAmount: "", percent: pct ? trimZeros(pct) : "" });
  return L;
}

/* HTTToan: 1 cash, 2 bank transfer (as a code or as the text some providers write) */
function means(v) {
  const s = String(v || "").trim();
  if (/^(?:1|tm|tien mat|tiền mặt)$/i.test(s)) return "10";
  if (/^(?:2|ck|chuyen khoan|chuyển khoản)$/i.test(s)) return "30";
  return s ? "ZZZ" : "";
}

export function fromVietnam(hdon) {
  const inv = blankInvoice();
  const dl = one(hdon, "DLHDon") || hdon;
  const tt = one(dl, "TTChung");
  inv.format = "vn-einvoice";
  inv.formatLabel = "Hóa đơn điện tử";
  const ver = t(tt, "PBan");
  inv.profile = { customizationId: ver, profileId: "", name: [t(tt, "THDon"), ver ? `v${ver}` : ""].filter(Boolean).join(" · ") };
  inv.number = t(tt, "SHDon");
  inv.issueDate = isoDate(t(tt, "NLap"));
  inv.currency = t(tt, "DVTTe") || "VND";
  const symbol = t(tt, "KHHDon"), form = t(tt, "KHMSHDon"), mccqt = t(hdon, "MCCQT");
  if (symbol) inv.codes.push({ key: "symbol", value: symbol });
  if (form) inv.codes.push({ key: "form", value: form });
  if (mccqt) inv.codes.push({ key: "taxAuthorityCode", value: mccqt });

  // 1 = replacement of an earlier invoice, 2 = adjustment of one
  const kind = t(tt, "TTHDLQuan/TCHDon");
  inv.typeCode = kind;
  inv.type = kind === "1" ? "replacement" : kind === "2" ? "correction" : "invoice";
  const rel = one(tt, "TTHDLQuan");
  if (rel && (t(rel, "SHDCLQuan") || t(rel, "KHHDCLQuan"))) {
    const sym = [t(rel, "KHMSHDCLQuan"), t(rel, "KHHDCLQuan")].filter(Boolean).join("");
    inv.references.preceding.push({ number: [sym, t(rel, "SHDCLQuan")].filter(Boolean).join(" / "), date: isoDate(t(rel, "NLHDCLQuan")) });
    if (t(rel, "GChu")) inv.notes.push(tb(rel, "GChu"));
  }
  if (t(tt, "TGia") && inv.currency !== "VND") inv.extra.push({ key: "exchangeRate", label: "", value: `1 ${inv.currency} = ${dec(t(tt, "TGia"))} VND`, amount: "" });
  for (const x of list(all(tt, "TTKhac/TTin"))) if (t(x, "TTruong") && t(x, "DLieu")) inv.extra.push({ key: "", label: t(x, "TTruong"), value: t(x, "DLieu"), amount: "" });

  const nd = one(dl, "NDHDon");
  const seller = one(nd, "NBan");
  inv.seller = party(seller, true);
  inv.buyer = party(one(nd, "NMua"), false);

  const els = childs(one(nd, "DSHHDVu"), "HHDVu");
  const goods = [];
  for (const le of els) {
    if (t(le, "TChat") === "4") { if (t(le, "THHDVu") && inv.notes.length < LIMITS.list) inv.notes.push(tb(le, "THHDVu")); } else goods.push(le);
  }
  inv.linesTotal = goods.length;
  for (const le of goods.slice(0, LIMITS.lines)) inv.lines.push(line(le));

  const tx = one(nd, "TToan");
  for (const ls of list(all(tx, "THTTLTSuat/LTSuat"))) {
    const v = vatOf(t(ls, "TSuat"));
    inv.vatBreakdown.push({
      category: v.category, rate: v.rate, taxable: money(ls, "ThTien"), tax: money(ls, "TThue") || (v.category === "S" ? "" : "0"),
      exemptionReason: "", exemptionReasonCode: v.category === "S" || v.category === "Z" ? "" : v.native,
    });
  }
  const discount = money(tx, "TTCKTMai");
  const fees = list(all(tx, "DSLPhi/LPhi")).filter((f) => money(f, "TPhi"));
  for (const f of fees) inv.charges.push({ reason: t(f, "TLPhi"), reasonCode: "", kind: "", amount: money(f, "TPhi"), baseAmount: "", percent: "", vat: { category: "", rate: "" } });
  const total = money(tx, "TgTTTBSo");
  inv.totals = {
    lineNet: "", allowances: discount && cmpDec(discount, "0") !== 0 ? discount : "", charges: fees.length ? sumDec(fees.map((f) => money(f, "TPhi"))) : "",
    taxExclusive: money(tx, "TgTCThue"), tax: money(tx, "TgTThue"), taxInclusive: total, prepaid: "", rounding: "", payable: total, taxInTaxCurrency: "",
  };
  if (t(tx, "TgTTTBChu")) inv.extra.push({ key: "amountInWords", label: "", value: t(tx, "TgTTTBChu"), amount: "" });
  for (const x of list(all(tx, "TTKhac/TTin"))) if (t(x, "TTruong") && t(x, "DLieu")) inv.extra.push({ key: "", label: t(x, "TTruong"), value: t(x, "DLieu"), amount: "" });

  const how = t(tt, "HTTToan");
  inv.payment.meansNative = how;
  inv.payment.meansCode = means(how);
  if (seller && t(seller, "STKNHang")) inv.payment.accounts.push({ id: t(seller, "STKNHang"), name: "", bic: "", bank: t(seller, "TNHang") });

  // the digital signatures (DSCKS: the seller's, and the tax authority's on a coded invoice) are present or not; never checked
  if (all(hdon, "DSCKS/NBan/Signature").length || all(hdon, "DSCKS/CQT/Signature").length || all(hdon, "DSCKS/NMua/Signature").length) inv.signature = "dscks";
  return inv;
}
