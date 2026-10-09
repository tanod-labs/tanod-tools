// Loan calculator: payment, total interest and an amortization schedule. The maths is in fincore.js (whole cents).
import { $, el, tx, txn, setStatus, textBlob } from "./core.js?v=11";
import { parseNum, fmtNum } from "./i18n.js?v=11";
import { amortize, scheduleCsv } from "./fincore.js?v=11";

const status = $("#status"), res = $("#ln-res");
const MAX_MONTHS = 1200, MAX_CENTS = 1e13;
let last = null;

const money = (cents) => fmtNum(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fail(msg, input) {
  res.hidden = true;
  last = null;
  setStatus(status, "error", msg);
  if (input) input.setAttribute("aria-invalid", "true");
}

function update() {
  for (const i of ["#ln-p", "#ln-r", "#ln-t", "#ln-x"]) $(i).setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const p = parseNum($("#ln-p").value), r = parseNum($("#ln-r").value), t = parseNum($("#ln-t").value);
  const xRaw = parseNum($("#ln-x").value), x = xRaw === null ? 0 : xRaw;
  if (p === null || Number.isNaN(p) || p <= 0 || p * 100 > MAX_CENTS) return fail(tx("Enter a loan amount above zero."), $("#ln-p"));
  if (r === null || Number.isNaN(r) || r < 0 || r > 100) return fail(tx("Enter an interest rate from 0 to 100 percent."), $("#ln-r"));
  const months = Math.round($("#ln-u").value === "years" ? t * 12 : t);
  if (t === null || Number.isNaN(t) || months < 1 || months > MAX_MONTHS) return fail(tx("Enter a term from 1 month to 100 years."), $("#ln-t"));
  if (Number.isNaN(x) || x < 0 || x * 100 > MAX_CENTS) return fail(tx("The extra payment must be zero or more."), $("#ln-x"));
  const cents = Math.round(p * 100);
  const a = amortize(cents, r, months, Math.round(x * 100));
  last = a;
  const base = x > 0 ? amortize(cents, r, months) : null;
  $("#ln-main").textContent = money(a.payment);
  $("#ln-int").textContent = money(a.totalInterest);
  $("#ln-paid").textContent = money(a.totalPaid);
  $("#ln-n").textContent = fmtNum(a.rows.length);
  const notes = [];
  if (x > 0) {
    notes.push(tx("With {extra} extra each month the loan ends after {n}, and you save {saved} in interest.", {
      extra: money(Math.round(x * 100)), n: txn(a.rows.length, "{n} payment", "{n} payments"), saved: money(base.totalInterest - a.totalInterest),
    }));
  }
  notes.push(tx("The last payment is {last}, which clears the balance exactly.", { last: money(a.rows[a.rows.length - 1].payment) }));
  $("#ln-note").textContent = notes.join(" ");
  const body = $("#ln-rows");
  body.textContent = "";
  const frag = document.createDocumentFragment();
  for (const row of a.rows) {
    frag.append(el("tr", {}, el("td", {}, fmtNum(row.n)), el("td", {}, money(row.payment)), el("td", {}, money(row.principal)), el("td", {}, money(row.interest)), el("td", {}, money(row.balance))));
  }
  body.append(frag);
  res.hidden = false;
}

for (const sel of ["#ln-p", "#ln-r", "#ln-t", "#ln-u", "#ln-x"]) {
  $(sel).addEventListener("input", update);
  $(sel).addEventListener("change", update);
}
$("#ln-csv").addEventListener("click", () => {
  if (!last) return;
  const url = URL.createObjectURL(textBlob(String.fromCharCode(0xfeff) + scheduleCsv(last.rows), "text/csv"));
  const a = el("a", { href: url, download: "loan-schedule.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});
update();
