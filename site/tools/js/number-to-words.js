// Number to words: cardinal, ordinal and currency amounts in English. The words come from numwordscore.js (exact BigInt maths).
import { $, tx, setStatus, copyText } from "./core.js?v=11";
import { DECIMAL, fmtNum } from "./i18n.js?v=11";
import { MAX_DIGITS, parseDecimal, numberWords, ordinal, currencyWords, CURRENCIES, applyCase, roundTo } from "./numwordscore.js?v=11";

const input = $("#nw-in"), status = $("#status"), res = $("#nw-res");
const mode = () => document.querySelector('input[name="nw-mode"]:checked').value;

function fail(msg) {
  res.hidden = true;
  input.setAttribute("aria-invalid", "true");
  setStatus(status, "error", msg);
}

/* the number as people read it: 1,234.56 (grouped for the page language) */
function shown(p) {
  const int = fmtNum(BigInt(p.int));
  return (p.neg ? "-" : "") + int + (p.frac ? DECIMAL + p.frac : "");
}

function update() {
  const m = mode();
  $("#nw-cur-f").hidden = $("#nw-cents-f").hidden = m !== "currency";
  $("#nw-cents-f").hidden = m !== "currency" || CURRENCIES[$("#nw-cur").value][4] === 0;
  input.setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const p = parseDecimal(input.value, DECIMAL);
  if (!p) return fail(input.value.trim() ? tx("That isn't a number.") : tx("Type a number."));
  if (p.int.length > MAX_DIGITS) return fail(tx("Numbers up to 36 whole digits are supported."));
  const and = $("#nw-and").checked;
  let words, note = "";
  try {
    if (m === "ordinal") {
      if (p.neg && /[1-9]/.test(p.int)) return fail(tx("An ordinal needs a positive whole number."));
      if (p.frac.replace(/0+$/, "")) return fail(tx("An ordinal needs a whole number."));
      words = ordinal(BigInt(p.int), { and });
    } else if (m === "currency") {
      const code = $("#nw-cur").value;
      const digits = CURRENCIES[code][4];
      const rounded = p.frac.replace(/0+$/, "").length > digits;
      words = currencyWords(p, code, { and, fraction: $("#nw-cents").value === "fraction" && digits > 0, round: true });
      if (rounded) {
        const r = roundTo(p, digits);
        note = tx("Rounded to {amount} {code}, the smallest unit this currency uses.", { amount: shown({ neg: p.neg, int: r.int, frac: r.frac }), code });
      }
    } else {
      words = numberWords(p, { and });
    }
  } catch (_) {
    return fail(tx("That number can't be written in words."));
  }
  const out = applyCase(words, $("#nw-case").value);
  $("#nw-main").textContent = out;
  $("#nw-main-l").textContent = tx("In words");
  $("#nw-note").textContent = note || tx("Read as {number}", { number: shown(p) });
  res.hidden = false;
}

for (const sel of ["#nw-in", "#nw-cur", "#nw-cents", "#nw-case", "#nw-and"]) {
  $(sel).addEventListener("input", update);
  $(sel).addEventListener("change", update);
}
for (const r of document.querySelectorAll('input[name="nw-mode"]')) r.addEventListener("change", update);
$("#nw-copy").addEventListener("click", () => copyText($("#nw-main").textContent, $("#nw-copy")));
if (DECIMAL === ",") input.value = "1234,56";
update();
