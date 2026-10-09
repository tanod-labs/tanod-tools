// Aviation unit converter: speed, pressure, length and distance, temperature. Factors are in aviationcore.js.
import { $, $$, el, tx, announce } from "./core.js?v=11";
import { convert, UNITS } from "./aviationcore.js?v=11";
import { readNum, invalid } from "./avui.js?v=11";
import { fmt } from "./calccore.js?v=11";

const LABEL = {
  speed: { kt: tx("Knots (kt)"), kmh: tx("Kilometres per hour (km/h)"), mph: tx("Miles per hour (mph)"), ms: tx("Metres per second (m/s)"), fpm: tx("Feet per minute (ft/min)"), mach: tx("Mach (at ISA sea level)") },
  pressure: { hpa: tx("Hectopascals (hPa)"), inhg: tx("Inches of mercury (inHg)"), mmhg: tx("Millimetres of mercury (mmHg)"), kpa: tx("Kilopascals (kPa)"), psi: tx("Pounds per square inch (psi)") },
  length: { ft: tx("Feet (ft)"), m: tx("Metres (m)"), km: tx("Kilometres (km)"), nm: tx("Nautical miles (NM)"), sm: tx("Statute miles (SM)") },
  temperature: { c: tx("Celsius (°C)"), f: tx("Fahrenheit (°F)"), k: tx("Kelvin (K)") },
};
const SHORT = { kt: "kt", kmh: "km/h", mph: "mph", ms: "m/s", fpm: "ft/min", mach: "Mach", hpa: "hPa", inhg: "inHg", mmhg: "mmHg", kpa: "kPa", psi: "psi", ft: "ft", m: "m", km: "km", nm: "NM", sm: "SM", c: "°C", f: "°F", k: "K" };
const DEFAULTS = { speed: ["kt", "kmh"], pressure: ["hpa", "inhg"], length: ["ft", "m"], temperature: ["c", "f"] };
const IDS = { speed: UNITS.speed.map((u) => u[0]), pressure: UNITS.pressure.map((u) => u[0]), length: UNITS.length.map((u) => u[0]), temperature: ["c", "f", "k"] };
const FORMULA = {
  "c>f": tx("°F = °C × 9/5 + 32"), "f>c": tx("°C = (°F − 32) × 5/9"), "c>k": tx("K = °C + 273.15"), "k>c": tx("°C = K − 273.15"),
  "f>k": tx("K = (°F + 459.67) × 5/9"), "k>f": tx("°F = K × 9/5 − 459.67"),
};

const cat = () => $('input[name="ac-cat"]:checked').value;
const fromIn = $("#ac-from"), toIn = $("#ac-to"), fromU = $("#ac-from-u"), toU = $("#ac-to-u"), sig = $("#ac-sig");
const warn = $("#ac-warn"), formula = $("#ac-formula"), tbody = $("#ac-all");
const num = (n) => fmt(n, Number(sig.value));

function fillUnits(sel, c, pick) {
  sel.replaceChildren(...IDS[c].map((id) => el("option", { value: id }, LABEL[c][id])));
  sel.value = pick;
}

function update(from = "from") {
  const c = cat();
  invalid([fromIn, toIn], false);
  warn.hidden = true;
  const src = from === "from" ? fromIn : toIn, dst = from === "from" ? toIn : fromIn;
  const su = from === "from" ? fromU.value : toU.value, du = from === "from" ? toU.value : fromU.value;
  const v = readNum(src);
  if (v === null || Number.isNaN(v)) {
    dst.value = "";
    if (v !== null) invalid([src]);
    formula.textContent = "";
    tbody.replaceChildren();
    return;
  }
  dst.value = num(convert(c, v, su, du));
  if (c === "temperature" && convert(c, v, su, "k") < 0) { warn.hidden = false; warn.textContent = tx("That is below absolute zero (0 K, −273.15 °C, −459.67 °F), so it cannot be a real temperature."); }
  if (c === "temperature") formula.textContent = FORMULA[`${su}>${du}`] ?? FORMULA[`${du}>${su}`] ?? "";
  else formula.textContent = `1 ${SHORT[su]} = ${num(convert(c, 1, su, du))} ${SHORT[du]}`;
  tbody.replaceChildren(...IDS[c].map((id) => el("tr", { class: id === su ? "is-src" : "" }, el("th", { scope: "row" }, LABEL[c][id]), el("td", {}, num(convert(c, v, su, id))))));
}

function setCat() {
  const c = cat();
  fillUnits(fromU, c, DEFAULTS[c][0]);
  fillUnits(toU, c, DEFAULTS[c][1]);
  update();
}
$$('input[name="ac-cat"]').forEach((r) => r.addEventListener("change", setCat));
fromIn.addEventListener("input", () => update("from"));
toIn.addEventListener("input", () => update("to"));
fromU.addEventListener("change", () => update("from"));
toU.addEventListener("change", () => update("from"));
sig.addEventListener("change", () => update("from"));
$("#ac-swap").addEventListener("click", () => {
  const a = fromU.value;
  fromU.value = toU.value;
  toU.value = a;
  update("from");
  announce(formula.textContent);
});
setCat();
