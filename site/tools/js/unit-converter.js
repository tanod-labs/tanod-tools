// Unit converter: length, weight, temperature, volume, area and speed, with exact defined factors.
import { $, $$, el, icon, announce, prefs, tx } from "./core.js?v=5";
import { parseNum, fmt } from "./calccore.js?v=5";

/* f = size of one unit in the base unit (m, kg, L, m², m/s). All factors are exact definitions. */
const GAL_US = 3.785411784, GAL_IMP = 4.54609, LB = 0.45359237;
export const UNITS = {
  length: {
    label: tx("Length"), heard: tx("Length units."), def: ["mi", "km"],
    units: [
      ["mm", tx("Millimetres"), 0.001], ["cm", tx("Centimetres"), 0.01], ["m", tx("Metres"), 1], ["km", tx("Kilometres"), 1000],
      ["in", tx("Inches"), 0.0254], ["ft", tx("Feet"), 0.3048], ["yd", tx("Yards"), 0.9144], ["mi", tx("Miles"), 1609.344],
      ["nmi", tx("Nautical miles"), 1852],
    ],
  },
  weight: {
    label: tx("Weight"), heard: tx("Weight units."), def: ["lb", "kg"],
    units: [
      ["mg", tx("Milligrams"), 1e-6], ["g", tx("Grams"), 0.001], ["kg", tx("Kilograms"), 1], ["t", tx("Tonnes (metric)"), 1000],
      ["oz", tx("Ounces"), LB / 16], ["lb", tx("Pounds"), LB], ["st", tx("Stone"), LB * 14],
      ["ton-us", tx("US tons (short)"), LB * 2000], ["ton-uk", tx("UK tons (long)"), LB * 2240],
    ],
  },
  temperature: {
    label: tx("Temperature"), heard: tx("Temperature units."), def: ["F", "C"],
    units: [["C", tx("Celsius (°C)")], ["F", tx("Fahrenheit (°F)")], ["K", tx("Kelvin (K)")], ["R", tx("Rankine (°R)")]],
  },
  volume: {
    label: tx("Volume"), heard: tx("Volume units."), def: ["gal-us", "L"],
    units: [
      ["mL", tx("Millilitres"), 0.001], ["L", tx("Litres"), 1], ["m3", tx("Cubic metres"), 1000],
      ["tsp", tx("Teaspoons (US)"), GAL_US / 768], ["tbsp", tx("Tablespoons (US)"), GAL_US / 256],
      ["floz-us", tx("Fluid ounces (US)"), GAL_US / 128], ["cup-us", tx("Cups (US)"), GAL_US / 16],
      ["pt-us", tx("Pints (US)"), GAL_US / 8], ["qt-us", tx("Quarts (US)"), GAL_US / 4], ["gal-us", tx("Gallons (US)"), GAL_US],
      ["floz-uk", tx("Fluid ounces (UK)"), GAL_IMP / 160], ["pt-uk", tx("Pints (UK)"), GAL_IMP / 8], ["gal-uk", tx("Gallons (UK)"), GAL_IMP],
      ["in3", tx("Cubic inches"), 0.016387064], ["ft3", tx("Cubic feet"), 28.316846592],
    ],
  },
  area: {
    label: tx("Area"), heard: tx("Area units."), def: ["acre", "m2"],
    units: [
      ["cm2", tx("Square centimetres"), 1e-4], ["m2", tx("Square metres"), 1], ["ha", tx("Hectares"), 10000], ["km2", tx("Square kilometres"), 1e6],
      ["in2", tx("Square inches"), 0.00064516], ["ft2", tx("Square feet"), 0.09290304], ["yd2", tx("Square yards"), 0.83612736],
      ["acre", tx("Acres"), 4046.8564224], ["mi2", tx("Square miles"), 2589988.110336],
    ],
  },
  speed: {
    label: tx("Speed"), heard: tx("Speed units."), def: ["mph", "kmh"],
    units: [
      ["ms", tx("Metres per second"), 1], ["kmh", tx("Kilometres per hour"), 1 / 3.6], ["mph", tx("Miles per hour"), 1609.344 / 3600],
      ["kn", tx("Knots"), 1852 / 3600], ["fts", tx("Feet per second"), 0.3048],
    ],
  },
};
const SYM = { C: "°C", F: "°F", K: "K", R: "°R", m3: "m³", cm2: "cm²", m2: "m²", km2: "km²", in2: "in²", ft2: "ft²", yd2: "yd²", mi2: "mi²", in3: "in³", ft3: "ft³", kmh: "km/h", ms: "m/s", fts: "ft/s", "ton-us": "US ton", "ton-uk": "UK ton", "floz-us": "US fl oz", "floz-uk": "UK fl oz", "cup-us": "US cup", "pt-us": "US pt", "qt-us": "US qt", "gal-us": "US gal", "pt-uk": "UK pt", "gal-uk": "UK gal" };
const sym = (id) => SYM[id] || id;

const TO_K = { C: (v) => v + 273.15, F: (v) => ((v + 459.67) * 5) / 9, K: (v) => v, R: (v) => (v * 5) / 9 };
const FROM_K = { C: (k) => k - 273.15, F: (k) => (k * 9) / 5 - 459.67, K: (k) => k, R: (k) => (k * 9) / 5 };
const TEMP_FORMULA = {
  "C>F": tx("°F = °C × 9/5 + 32"), "F>C": tx("°C = (°F − 32) × 5/9"), "C>K": tx("K = °C + 273.15"), "K>C": tx("°C = K − 273.15"),
  "F>K": tx("K = (°F + 459.67) × 5/9"), "K>F": tx("°F = K × 9/5 − 459.67"), "C>R": tx("°R = (°C + 273.15) × 9/5"), "R>C": tx("°C = °R × 5/9 − 273.15"),
  "F>R": tx("°R = °F + 459.67"), "R>F": tx("°F = °R − 459.67"), "K>R": tx("°R = K × 9/5"), "R>K": tx("K = °R × 5/9"),
};

export function convert(cat, v, from, to) {
  if (cat === "temperature") {
    if (from === to) return v;
    // Celsius and Fahrenheit convert directly so common values stay exact.
    if (from === "C" && to === "F") return (v * 9) / 5 + 32;
    if (from === "F" && to === "C") return ((v - 32) * 5) / 9;
    return FROM_K[to](TO_K[from](v));
  }
  const u = Object.fromEntries(UNITS[cat].units.map((x) => [x[0], x[2]]));
  return (v * u[from]) / u[to];
}

const catRadios = $$('input[name="uc-cat"]');
const fromIn = $("#uc-from"), toIn = $("#uc-to"), fromU = $("#uc-from-u"), toU = $("#uc-to-u");
const sigSel = $("#uc-sig"), formula = $("#uc-formula"), warn = $("#uc-warn"), tbody = $("#uc-all"), allH = $("#uc-all-h");
let cat = "length";
let last = "from"; // which value the person typed most recently

const sig = () => Number(sigSel.value);

const unitLabel = (id, name) => (cat === "temperature" ? name : `${name} (${sym(id)})`);

function fillUnits() {
  const opts = () => UNITS[cat].units.map(([id, name]) => el("option", { value: id }, unitLabel(id, name)));
  fromU.replaceChildren(...opts());
  toU.replaceChildren(...opts());
  [fromU.value, toU.value] = UNITS[cat].def;
}

function belowZero(k) { return k < -1e-9; }

function update() {
  const srcIn = last === "from" ? fromIn : toIn, dstIn = last === "from" ? toIn : fromIn;
  const srcU = last === "from" ? fromU.value : toU.value, dstU = last === "from" ? toU.value : fromU.value;
  const v = parseNum(srcIn.value);
  srcIn.setAttribute("aria-invalid", Number.isNaN(v) ? "true" : "false");
  dstIn.setAttribute("aria-invalid", "false");
  warn.hidden = true;
  tbody.replaceChildren();
  if (v === null || Number.isNaN(v)) {
    dstIn.value = "";
    formula.textContent = Number.isNaN(v) ? tx("Enter a number, such as 12, 0.5 or -40.") : tx("Enter a value to convert.");
    allH.textContent = tx("In every unit");
    return;
  }
  const out = convert(cat, v, srcU, dstU);
  dstIn.value = fmt(out, sig(), { group: false });
  const fv = last === "from" ? v : out;
  const f = fromU.value, t = toU.value;
  if (cat === "temperature") {
    formula.textContent = f === t ? tx("Same unit: nothing to convert.") : tx("{formula}, so {from} = {to}", { formula: TEMP_FORMULA[f + ">" + t], from: `${fmt(fv, sig())} ${sym(f)}`, to: `${fmt(convert(cat, fv, f, t), sig())} ${sym(t)}` });
    const k = convert(cat, fv, f, "K");
    if (belowZero(k)) {
      warn.hidden = false;
      warn.replaceChildren(icon("i-alert"), el("span", {}, tx("{value} is below absolute zero (0 K, −273.15 °C, −459.67 °F), the lowest temperature physically possible. The numbers are converted anyway.", { value: `${fmt(fv, sig())} ${sym(f)}` })));
    }
  } else {
    const one = `1 ${sym(f)} = ${fmt(convert(cat, 1, f, t), sig())} ${sym(t)}`;
    formula.textContent = fv === 1 ? one : tx("{formula}, so {from} = {to}", { formula: one, from: `${fmt(fv, sig())} ${sym(f)}`, to: `${fmt(convert(cat, fv, f, t), sig())} ${sym(t)}` });
  }
  allH.textContent = tx("{value} in every unit", { value: `${fmt(fv, sig())} ${sym(f)}` });
  for (const [id, name] of UNITS[cat].units) {
    tbody.append(el("tr", { class: id === f ? "is-src" : null },
      el("th", { scope: "row" }, unitLabel(id, name)),
      el("td", { class: "num", "data-unit": id }, fmt(convert(cat, fv, f, id), sig()))));
  }
}

function setCat(c, { keep = true } = {}) {
  cat = c;
  fillUnits();
  if (!keep) fromIn.value = "1";
  last = "from";
  update();
}

catRadios.forEach((r) => r.addEventListener("change", () => { setCat(r.value); announce(UNITS[r.value].heard); }));
fromIn.addEventListener("input", () => { last = "from"; update(); });
toIn.addEventListener("input", () => { last = "to"; update(); });
fromU.addEventListener("change", () => { last = "from"; update(); });
toU.addEventListener("change", () => { last = "from"; update(); });
sigSel.addEventListener("change", () => { prefs.set("uc-sig", sigSel.value); update(); });
$("#uc-swap").addEventListener("click", () => {
  const fu = fromU.value;
  fromU.value = toU.value;
  toU.value = fu;
  if (toIn.value) fromIn.value = toIn.value;
  last = "from";
  update();
  announce(tx("Swapped: now converting {from} to {to}.", { from: fromU.selectedOptions[0].textContent, to: toU.selectedOptions[0].textContent }));
});

const savedSig = prefs.get("uc-sig", null);
if (savedSig && [...sigSel.options].some((o) => o.value === savedSig)) sigSel.value = savedSig;
setCat(catRadios.find((r) => r.checked).value);
