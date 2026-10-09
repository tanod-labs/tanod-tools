// Light travel time and signal delay to the Moon, Sun, planets or a custom distance (aviationcore.js).
import { $, el, tx } from "./core.js?v=11";
import { bodyDistances, lightSeconds, AU_KM, C_KM_S } from "./aviationcore.js?v=11";
import { readNum, f, fInt, fillStats, invalid, duration } from "./avui.js?v=11";

const bodyEl = $("#lt-body"), kindEl = $("#lt-kind"), distEl = $("#lt-dist"), unitEl = $("#lt-unit"), msg = $("#lt-msg");
const NAMES = {
  moon: tx("Moon"), sun: tx("Sun"), mercury: tx("Mercury"), venus: tx("Venus"), mars: tx("Mars"), jupiter: tx("Jupiter"),
  saturn: tx("Saturn"), uranus: tx("Uranus"), neptune: tx("Neptune"), pluto: tx("Pluto"), geo: tx("Geostationary satellite"),
};
const TO_KM = { km: 1, mi: 1.609344, au: AU_KM, m: 0.001 };

/* Light time with sub-second detail for short delays. */
function delay(sec) {
  if (sec < 10) return tx("{n} s", { n: f(sec, 3) });
  if (sec < 60) return tx("{n} s", { n: f(sec, 1) });
  return duration(sec);
}

function update() {
  const custom = bodyEl.value === "custom";
  $("#lt-kind-f").hidden = custom || bodyEl.value === "geo";
  $("#lt-cust-f").hidden = !custom;
  $("#lt-cust-u").hidden = !custom;
  invalid([distEl], false);
  let km;
  if (custom) {
    const v = readNum(distEl);
    if (v === null) { msg.textContent = tx("Enter a distance."); $("#lt-res").hidden = true; return; }
    if (Number.isNaN(v) || v < 0) { invalid([distEl]); msg.textContent = tx("The distance must be a number of 0 or more."); $("#lt-res").hidden = true; return; }
    km = v * TO_KM[unitEl.value];
  } else km = bodyDistances(bodyEl.value)[kindEl.value];
  msg.textContent = "";
  $("#lt-res").hidden = false;
  const t = lightSeconds(km);
  $("#lt-main").textContent = delay(t);
  fillStats($("#lt-stats"), [
    [tx("Distance"), tx("{km} km ({mi} mi)", { km: fInt(km), mi: fInt(km / 1.609344) })],
    [tx("Distance in astronomical units"), f(km / AU_KM, 4)],
    [tx("Round trip"), delay(2 * t)],
    [tx("Light travels"), tx("{n} km/s", { n: f(C_KM_S, 3) })],
    [tx("Distance in light-minutes"), f(t / 60, 4)],
  ]);
  const rows = Object.keys(NAMES).map((id) => {
    const d = bodyDistances(id)[id === "geo" ? "mid" : kindEl.value];
    return el("tr", { class: id === bodyEl.value ? "is-src" : "" }, el("th", { scope: "row" }, NAMES[id]), el("td", {}, tx("{km} km", { km: fInt(d) })), el("td", {}, delay(lightSeconds(d))));
  });
  $("#lt-table").replaceChildren(...rows);
}
[bodyEl, kindEl, unitEl].forEach((e) => e.addEventListener("change", update));
distEl.addEventListener("input", update);
update();
