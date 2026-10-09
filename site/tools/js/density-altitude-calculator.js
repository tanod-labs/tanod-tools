// Density altitude and pressure altitude from the ISA standard atmosphere.
import { $, tx, fmtNum } from "./core.js?v=11";
import { densityAltitude, convert, FT } from "./aviationcore.js?v=11";
import { readNum, f, fInt, fFixed, fillStats, invalid } from "./avui.js?v=11";

const elev = $("#da-elev"), elevU = $("#da-elev-u"), qnh = $("#da-qnh"), qnhU = $("#da-qnh-u"), oat = $("#da-oat"), oatU = $("#da-oat-u");
const msg = $("#da-msg"), res = $("#da-res");
const both = (m) => tx("{ft} ft ({m} m)", { ft: fInt(m / FT), m: fInt(m) });

function update() {
  invalid([elev, qnh, oat], false);
  res.hidden = true;
  const e = readNum(elev), q = readNum(qnh), t = readNum(oat);
  if (e === null || q === null || t === null) { msg.textContent = tx("Enter the elevation, the altimeter setting and the temperature."); return; }
  const eM = convert("length", e, elevU.value, "m");
  const qHpa = convert("pressure", q, qnhU.value, "hpa");
  const tC = convert("temperature", t, oatU.value, "c");
  const bad = [];
  if (Number.isNaN(e) || eM < -500 || eM > 6000) bad.push([elev, tx("The elevation should be between -1,600 ft and 19,600 ft (-500 m to 6,000 m).")]);
  if (Number.isNaN(q) || qHpa < 850 || qHpa > 1100) bad.push([qnh, tx("The altimeter setting should be between 850 and 1,100 hPa (25.1 to 32.5 inHg).")]);
  if (Number.isNaN(t) || tC < -80 || tC > 60) bad.push([oat, tx("The temperature should be between -80 °C and 60 °C.")]);
  if (bad.length) { invalid(bad.map((b) => b[0])); msg.textContent = bad.map((b) => b[1]).join(" "); return; }
  msg.textContent = "";
  const r = densityAltitude(eM, qHpa, tC);
  $("#da-main").textContent = both(r.daM);
  fillStats($("#da-stats"), [
    [tx("Pressure altitude"), both(r.paM)],
    [tx("ISA temperature at that altitude"), tx("{c}°C ({f}°F)", { c: f(r.isaT, 1), f: f((r.isaT * 9) / 5 + 32, 1) })],
    [tx("Temperature above or below ISA"), (r.dev >= 0 ? "+" : "−") + tx("{c}°C", { c: f(Math.abs(r.dev), 1) })],
    [tx("Station pressure"), tx("{hpa} hPa ({inhg} inHg)", { hpa: f(r.pStation, 1), inhg: fFixed(convert("pressure", r.pStation, "hpa", "inhg"), 2) })],
    [tx("Air density"), tx("{n} kg/m³", { n: fFixed(r.rho, 3) })],
    [tx("Rule of thumb: PA + 120 ft per °C"), both(r.roughDaM)],
  ]);
  $("#da-info").textContent = r.beyond ? tx("This is above 20 km (65,600 ft), where the ISA model used here is less reliable.") : r.daM > r.paM + 300 * FT ? tx("The air is thinner than standard: expect longer take-off runs and a lower climb rate than the elevation suggests.") : r.daM < r.paM - 300 * FT ? tx("The air is denser than standard, which helps performance.") : "";
  res.hidden = false;
}
[elev, qnh, oat].forEach((i) => i.addEventListener("input", update));

/* Switching a unit converts the number in its field, so the physical value stays the same. */
function onUnit(input, sel, cat) {
  let prev = sel.value;
  sel.addEventListener("change", () => {
    const v = readNum(input);
    if (v !== null && !Number.isNaN(v)) {
      const d = cat === "pressure" && sel.value === "inhg" ? 2 : cat === "pressure" ? 1 : 1;
      input.value = fmtNum(Number(convert(cat, v, prev, sel.value).toFixed(d)), { maximumFractionDigits: d, useGrouping: false });
    }
    prev = sel.value;
    update();
  });
}
onUnit(elev, elevU, "length");
onUnit(qnh, qnhU, "pressure");
onUnit(oat, oatU, "temperature");
update();
