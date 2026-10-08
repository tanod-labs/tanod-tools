// BMI calculator: metric and imperial, WHO adult categories on the BMI rounded to one decimal, healthy weight range.
import { $, $$, announce, prefs, tx, fmtNum, EN } from "./core.js?v=5";
import { parseNum } from "./calccore.js?v=5";

const LB = 0.45359237, IN = 0.0254;
const W = $("#bm-w"), CM = $("#bm-cm"), FT = $("#bm-ft"), INCH = $("#bm-in");
const msg = $("#bm-msg"), res = $("#bm-res");
const units = () => $('input[name="bm-units"]:checked').value;

const CATS = [
  { id: "under", label: tx("Underweight"), test: (b) => b < 18.5 },
  { id: "ok", label: tx("Healthy weight"), test: (b) => b < 25 },
  { id: "over", label: tx("Overweight"), test: (b) => b < 30 },
  { id: "ob1", label: tx("Obesity, class I"), test: (b) => b < 35 },
  { id: "ob2", label: tx("Obesity, class II"), test: (b) => b < 40 },
  { id: "ob3", label: tx("Obesity, class III"), test: () => true },
];

/* A number with at most one decimal, in the page's own style so that values written into the fields parse back. */
const one = (n) => (EN ? String(Number(n.toFixed(1))) : fmtNum(Number(n.toFixed(1)), { maximumFractionDigits: 1, useGrouping: false }));
const r1 = (b) => Math.round(b * 10 + 1e-9) / 10; // BMI as displayed, to one decimal
const group = (n) => fmtNum(n, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const bmiText = (b) => (EN ? b.toFixed(1) : fmtNum(b, { maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false }));

function setUnitsUI() {
  const imp = units() === "imperial";
  $("#bm-h-metric").hidden = imp;
  $("#bm-h-imp").hidden = !imp;
  $("#bm-w-l").textContent = imp ? tx("Weight (lb)") : tx("Weight (kg)");
  W.placeholder = imp ? "154" : "70";
}

function invalid(inputs, text) {
  for (const i of [W, CM, FT, INCH]) i.setAttribute("aria-invalid", "false");
  for (const i of inputs) i.setAttribute("aria-invalid", "true");
  res.hidden = true;
  msg.textContent = text;
}

function update() {
  for (const i of [W, CM, FT, INCH]) i.setAttribute("aria-invalid", "false");
  const imp = units() === "imperial";
  const w = parseNum(W.value);
  const hFields = imp ? [FT, INCH] : [CM];
  const h = hFields.map((i) => parseNum(i.value));
  if (Number.isNaN(w)) return invalid([W], imp ? tx("Weight must be a number, such as 70.") : tx("Weight must be a number, such as 70 or 70.5."));
  if (h.some(Number.isNaN)) return invalid(hFields.filter((_, k) => Number.isNaN(h[k])), imp ? tx("Height must be a number, with whole feet and the rest in inches.") : tx("Height must be a number, such as 175."));
  const empty = imp ? h[0] === null && h[1] === null : h[0] === null;
  if (w === null || empty) { res.hidden = true; msg.textContent = tx("Enter your weight and height."); return; }
  let kg, m;
  if (imp) {
    const ft = h[0] ?? 0, inch = h[1] ?? 0;
    if (ft < 0 || !Number.isInteger(ft)) return invalid([FT], tx("Feet must be a whole number of 0 or more; put the rest in inches."));
    if (inch < 0 || inch >= 12) return invalid([INCH], tx("Inches go from 0 to 11.9. Add whole feet in the feet box."));
    kg = w * LB;
    m = (ft * 12 + inch) * IN;
  } else {
    kg = w;
    m = h[0] / 100;
  }
  if (!(w > 0) || !(m > 0)) return invalid(!(w > 0) ? [W] : hFields, tx("Weight and height must be more than zero."));
  if (m < 0.5 || m > 2.72) {
    return invalid(hFields, imp ? tx("Enter a height between about 1 ft 8 in and 8 ft 11 in.") : tx("Enter a height between 50 and 272 cm."));
  }
  if (kg < 5 || kg > 700) {
    return invalid([W], imp ? tx("Enter a weight between 11 and 1,543 lb.") : tx("Enter a weight between 5 and 700 kg."));
  }
  const bmi = kg / (m * m);
  const shown = r1(bmi);
  const cat = CATS.find((c) => c.test(shown));
  msg.textContent = "";
  $("#bm-val").textContent = bmiText(shown);
  $("#bm-cat").textContent = cat.label;
  $("#bm-cat").dataset.cat = cat.id;
  // marker on a 15..40 scale
  $("#bm-marker").style.left = ((Math.min(40, Math.max(15, shown)) - 15) / 25) * 100 + "%";
  // healthy range: BMI 18.5 to 24.9, rounded inwards to one decimal
  const lo = 18.5 * m * m, hi = 24.9 * m * m;
  const toU = (kgv) => (imp ? kgv / LB : kgv);
  const loU = Math.ceil(toU(lo) * 10 - 1e-9) / 10, hiU = Math.floor(toU(hi) * 10 + 1e-9) / 10;
  $("#bm-range").textContent = tx("{lo} to {hi} {unit}", { lo: group(loU), hi: group(hiU), unit: imp ? "lb" : "kg" });
  const cm = m * 100;
  if (imp) {
    const tin = m / IN;
    $("#bm-hused").textContent = `${Math.floor(tin / 12 + 1e-9)} ft ${one(tin - Math.floor(tin / 12 + 1e-9) * 12)} in (${one(cm)} cm)`;
  } else {
    const tin = cm / 2.54;
    $("#bm-hused").textContent = `${one(cm)} cm (${Math.floor(tin / 12 + 1e-9)} ft ${one(tin - Math.floor(tin / 12 + 1e-9) * 12)} in)`;
  }
  for (const tr of $$("#bm-table tr")) {
    const mine = tr.dataset.cat === cat.id;
    tr.classList.toggle("is-src", mine);
    tr.lastElementChild.textContent = mine ? tx("{bmi}: you are here", { bmi: bmiText(shown) }) : "";
  }
  res.hidden = false;
}

function convert(to) {
  const w = parseNum(W.value);
  if (to === "imperial") {
    if (w !== null && !Number.isNaN(w)) W.value = one(w / LB);
    const cm = parseNum(CM.value);
    if (cm !== null && !Number.isNaN(cm)) {
      let tin = Math.round((cm / 2.54) * 10) / 10;
      let ft = Math.floor(tin / 12);
      let inch = Math.round((tin - ft * 12) * 10) / 10;
      if (inch >= 12) { ft += 1; inch = 0; }
      FT.value = String(ft);
      INCH.value = one(inch);
    }
  } else {
    if (w !== null && !Number.isNaN(w)) W.value = one(w * LB);
    const ft = parseNum(FT.value), inch = parseNum(INCH.value);
    if ((ft !== null && !Number.isNaN(ft)) || (inch !== null && !Number.isNaN(inch))) {
      const tin = (Number.isNaN(ft) ? 0 : ft ?? 0) * 12 + (Number.isNaN(inch) ? 0 : inch ?? 0);
      CM.value = one(tin * 2.54);
    }
  }
}

const saved = prefs.get("bm.units", "metric");
let current = saved === "imperial" ? "imperial" : "metric";
$(`input[name="bm-units"][value="${current}"]`).checked = true;
setUnitsUI();

for (const r of $$('input[name="bm-units"]')) {
  r.addEventListener("change", () => {
    const to = units();
    if (to === current) return;
    convert(to);
    current = to;
    prefs.set("bm.units", to);
    setUnitsUI();
    update();
    announce(to === "imperial" ? tx("Switched to pounds, feet and inches.") : tx("Switched to kilograms and centimetres."));
  });
}
for (const i of [W, CM, FT, INCH]) { i.addEventListener("input", update); i.addEventListener("change", update); }
update();
