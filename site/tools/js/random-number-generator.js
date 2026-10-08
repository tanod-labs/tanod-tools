import { $, copyText, textBlob, setStatus, txn, tx, EN, fmtNum, announce } from "./core.js?v=5";
import { DECIMAL } from "./i18n.js?v=5";
import { randBelow, sampleDistinct } from "./randcore.js?v=5";

const MAX_COUNT = 10000;
const MAX_DIGITS = 30;
const MAX_PLACES = 10;

/* "-12.50" -> BigInt scaled by 10^places (-1250n). Returns {error} for bad input. */
export function parseScaled(text, places, label) {
  let s = String(text).trim().replace(/^\+/, "");
  if (DECIMAL === ",") {
    /* Decimal-comma pages: "1,5" is 1.5; dots, spaces and apostrophes group digits ("1.000" is a thousand). */
    s = s.replace(/[−–]/g, "-").replace(/[\s\u00a0\u202f_']/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) return { error: tx("{label} must be a number such as 1, -20 or 0.5.", { label }) };
  let frac = m[3] || "";
  while (frac.length > places && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (frac.length > places) {
    return { error: places === 0
      ? tx("{label} has decimals, but decimal places is 0. Raise decimal places or use a whole number.", { label })
      : tx("{label} has more than {places} decimal places. Raise decimal places or shorten it.", { label, places: fmtNum(places) }) };
  }
  if ((m[2] || "0").replace(/^0+/, "").length > MAX_DIGITS) return { error: tx("{label} has more than {digits} digits, which is more than this tool handles.", { label, digits: fmtNum(MAX_DIGITS) }) };
  const mag = BigInt((m[2] || "0") + frac.padEnd(places, "0"));
  return { value: m[1] ? -mag : mag };
}

/* Scaled BigInt back to text with exactly `places` decimals. */
export function formatScaled(v, places) {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString();
  if (places > 0) {
    s = s.padStart(places + 1, "0");
    s = s.slice(0, -places) + "." + s.slice(-places);
  }
  return (neg ? "-" : "") + s;
}

let lines = [];
const out = $("#rn-out");
const status = $("#status");

function fail(msg, ...ids) {
  for (const id of ["#rn-min", "#rn-max", "#rn-count", "#rn-places"]) $(id).setAttribute("aria-invalid", ids.includes(id) ? "true" : "false");
  lines = [];
  out.textContent = "";
  $("#rn-big").textContent = "-";
  $("#rn-big-label").textContent = tx("Result");
  for (const id of ["#rn-copy", "#rn-dl"]) $(id).disabled = true;
  setStatus(status, "error", msg);
  announce(msg);
}

function generate() {
  for (const id of ["#rn-min", "#rn-max", "#rn-count", "#rn-places"]) $(id).setAttribute("aria-invalid", "false");
  const places = Number($("#rn-places").value);
  if (!Number.isInteger(places) || places < 0 || places > MAX_PLACES) return fail(tx("Decimal places must be a whole number from 0 to {max}.", { max: fmtNum(MAX_PLACES) }), "#rn-places");
  const count = Number($("#rn-count").value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return fail(tx("How many must be a whole number from 1 to {max}.", { max: fmtNum(MAX_COUNT) }), "#rn-count");
  const a = parseScaled($("#rn-min").value, places, tx("Minimum"));
  if (a.error) return fail(a.error, "#rn-min");
  const b = parseScaled($("#rn-max").value, places, tx("Maximum"));
  if (b.error) return fail(b.error, "#rn-max");
  let lo = a.value, hi = b.value, swapped = false;
  if (lo > hi) { [lo, hi] = [hi, lo]; swapped = true; }
  const span = hi - lo + 1n; // number of values on the grid
  const unique = $("#rn-unique").checked;
  if (unique && BigInt(count) > span) {
    const v = { count: fmtNum(count), span: fmtNum(span.toString()) };
    const msg = places === 0
      ? tx("You asked for {count} different numbers, but the range only holds {span} whole numbers. Widen the range, lower how many, or allow repeats.", v)
      : txn(places, "You asked for {count} different numbers, but the range only holds {span} values with {n} decimal place. Widen the range, lower how many, or allow repeats.", "You asked for {count} different numbers, but the range only holds {span} values with {n} decimal places. Widen the range, lower how many, or allow repeats.", v);
    return fail(msg, "#rn-count", "#rn-min", "#rn-max");
  }
  let vals;
  if (unique) vals = sampleDistinct(span, count).map((v) => lo + v);
  else {
    vals = new Array(count);
    for (let i = 0; i < count; i++) vals[i] = lo + randBelow(span);
  }
  const order = $("#rn-order").value;
  if (order !== "drawn") {
    vals.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    if (order === "desc") vals.reverse();
  }
  const show = (v) => (EN ? formatScaled(v, places) : formatScaled(v, places).replace(".", DECIMAL));
  lines = vals.map(show);
  out.textContent = lines.join("\n");
  const last = lines[lines.length - 1];
  $("#rn-big").textContent = last;
  $("#rn-big-label").textContent = count === 1 ? tx("Result") : tx("Last in the list");
  for (const id of ["#rn-copy", "#rn-dl"]) $(id).disabled = false;
  const range = tx("{lo} to {hi}", { lo: show(lo), hi: show(hi) });
  const msg = (unique
    ? txn(count, "{n} number between {range}, no repeats.", "{n} numbers between {range}, no repeats.", { range })
    : txn(count, "{n} number between {range}.", "{n} numbers between {range}.", { range })) +
    (swapped ? " " + tx("The minimum was larger than the maximum, so the two were swapped.") : "");
  setStatus(status, "done", msg);
  announce(count === 1 ? tx("Result: {last}.", { last }) : txn(count, "{n} number generated. Last: {last}.", "{n} numbers generated. Last: {last}.", { last }));
}

$("#rn-gen").addEventListener("click", generate);
for (const id of ["#rn-min", "#rn-max", "#rn-count", "#rn-places"]) {
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); generate(); } });
}
$("#rn-copy").addEventListener("click", (e) => copyText(lines.join("\n"), e.currentTarget));
$("#rn-dl").addEventListener("click", () => {
  const url = URL.createObjectURL(textBlob(lines.join("\n") + "\n"));
  const a = document.createElement("a");
  a.href = url; a.download = "random-numbers.txt";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
generate();
