// Loan amortization and compound interest maths. Pure functions (no DOM, no UI strings).
// Loans are worked in whole cents (integers), the way a lender rounds each month's interest.

/* Monthly payment in cents for a loan of `cents` over `months` at an annual rate in percent (0 allowed). */
export function monthlyPaymentCents(cents, annualPct, months) {
  if (months <= 0) throw new RangeError("months");
  const r = annualPct / 100 / 12;
  if (r === 0) return Math.round(cents / months);
  const f = Math.pow(1 + r, -months);
  return Math.round((cents * r) / (1 - f));
}

/* Full schedule. Returns { payment, rows: [{ n, payment, principal, interest, balance }], totalPaid, totalInterest } in cents.
   Interest each month is the balance times the monthly rate, rounded to the cent; the last payment clears the balance exactly.
   extra: optional extra payment per month, in cents (paid on top, the loan ends early). */
export function amortize(cents, annualPct, months, extra = 0) {
  const r = annualPct / 100 / 12;
  const payment = monthlyPaymentCents(cents, annualPct, months);
  const rows = [];
  let balance = cents, totalPaid = 0, totalInterest = 0;
  for (let n = 1; n <= months && balance > 0; n++) {
    const interest = Math.round(balance * r);
    let pay = payment + extra;
    if (n === months || pay >= balance + interest) pay = balance + interest;
    const principal = pay - interest;
    balance -= principal;
    totalPaid += pay;
    totalInterest += interest;
    rows.push({ n, payment: pay, principal, interest, balance });
  }
  return { payment, rows, totalPaid, totalInterest };
}

/* Money in cents to a plain "1234.56" string (no grouping), for CSV files. */
export function centsText(c) {
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? "-" : "") + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}

/* CSV text of a schedule: n,payment,principal,interest,balance (amounts with a dot decimal). */
export function scheduleCsv(rows) {
  return ["payment_number,payment,principal,interest,remaining_balance",
    ...rows.map((r) => [r.n, centsText(r.payment), centsText(r.principal), centsText(r.interest), centsText(r.balance)].join(","))].join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ compound interest */

/* Compounding periods per year; "continuous" is handled separately. */
export const FREQUENCIES = { annually: 1, semiannually: 2, quarterly: 4, monthly: 12, weekly: 52, daily: 365, continuous: Infinity };

/* Growth factor for one month at an annual rate (percent) compounded `freq` times a year.
   Without contributions the balance is exactly P(1 + r/n)^(n t) at every compounding date. */
export function monthlyFactor(annualPct, freq) {
  const r = annualPct / 100;
  if (freq === Infinity) return Math.exp(r / 12);
  return Math.pow(1 + r / freq, freq / 12);
}

/* Month by month growth with a regular monthly contribution.
   start: contribution at the start of each month (annuity due) instead of the end.
   Returns { final, contributed (principal + all contributions), interest, years: [{ year, months, deposits, interest, balance }] }. */
export function compound({ principal, annualPct, freq, months, monthly = 0, start = false }) {
  const g = monthlyFactor(annualPct, freq);
  let bal = principal, deposits = principal, interest = 0;
  const years = [];
  let yDep = 0, yInt = 0;
  for (let m = 1; m <= months; m++) {
    if (start && monthly) { bal += monthly; deposits += monthly; yDep += monthly; }
    const grown = bal * g;
    const earned = grown - bal;
    bal = grown; interest += earned; yInt += earned;
    if (!start && monthly) { bal += monthly; deposits += monthly; yDep += monthly; }
    if (m % 12 === 0 || m === months) {
      years.push({ year: Math.ceil(m / 12), months: m, deposits: yDep, interest: yInt, balance: bal });
      yDep = 0; yInt = 0;
    }
  }
  return { final: bal, contributed: deposits, interest, years };
}
