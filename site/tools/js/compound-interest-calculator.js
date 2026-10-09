// Compound interest calculator. The growth maths is in fincore.js; this file reads the fields and draws the table.
import { $, el, tx, setStatus } from "./core.js?v=11";
import { parseNum, fmtNum } from "./i18n.js?v=11";
import { FREQUENCIES, compound, monthlyFactor } from "./fincore.js?v=11";

const status = $("#status"), res = $("#ci-res");
const MAX_MONTHS = 1200, MAX_AMOUNT = 1e12;

const money = (v) => fmtNum(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fail(msg, input) {
  res.hidden = true;
  setStatus(status, "error", msg);
  if (input) input.setAttribute("aria-invalid", "true");
}

function update() {
  for (const i of ["#ci-p", "#ci-r", "#ci-y", "#ci-m"]) $(i).setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const p = parseNum($("#ci-p").value), r = parseNum($("#ci-r").value), y = parseNum($("#ci-y").value);
  const mRaw = parseNum($("#ci-m").value), m = mRaw === null ? 0 : mRaw;
  if (p === null || Number.isNaN(p) || p < 0 || p > MAX_AMOUNT) return fail(tx("Enter a starting amount of zero or more."), $("#ci-p"));
  if (r === null || Number.isNaN(r) || r < -100 || r > 1000) return fail(tx("Enter an interest rate between -100 and 1,000 percent."), $("#ci-r"));
  const months = y === null || Number.isNaN(y) ? 0 : Math.round(y * 12);
  if (months < 1 || months > MAX_MONTHS) return fail(tx("Enter a time from 1 month to 100 years."), $("#ci-y"));
  if (Number.isNaN(m) || m < 0 || m > MAX_AMOUNT) return fail(tx("The monthly contribution must be zero or more."), $("#ci-m"));
  const freq = FREQUENCIES[$("#ci-f").value];
  const out = compound({ principal: p, annualPct: r, freq, months, monthly: m, start: $("#ci-t").value === "start" });
  if (!Number.isFinite(out.final)) return fail(tx("That result is too large to show."), $("#ci-r"));
  $("#ci-main").textContent = money(out.final);
  $("#ci-dep").textContent = money(out.contributed);
  $("#ci-int").textContent = money(out.interest);
  const ear = Math.pow(monthlyFactor(r, freq), 12) - 1;
  $("#ci-ear").textContent = fmtNum(ear, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const body = $("#ci-rows");
  body.textContent = "";
  for (const row of out.years) {
    body.append(el("tr", {}, el("td", {}, fmtNum(row.year)), el("td", {}, money(row.deposits)), el("td", {}, money(row.interest)), el("td", {}, money(row.balance))));
  }
  res.hidden = false;
}

for (const sel of ["#ci-p", "#ci-r", "#ci-y", "#ci-f", "#ci-m", "#ci-t"]) {
  $(sel).addEventListener("input", update);
  $(sel).addEventListener("change", update);
}
update();
