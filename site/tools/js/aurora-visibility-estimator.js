// Aurora visibility estimator: geomagnetic latitude (centred dipole) against a Kp-dependent oval edge (aviationcore.js).
import { $, el, tx } from "./core.js?v=11";
import { geomagLat, ovalEdge, auroraView } from "./aviationcore.js?v=11";
import { readNum, f, fillStats, invalid, locate, plain, latText, lonText } from "./avui.js?v=11";

const latEl = $("#ao-lat"), lonEl = $("#ao-lon"), kpEl = $("#ao-kp"), msg = $("#ao-msg"), res = $("#ao-res");
const VIEW = {
  overhead: tx("Possible overhead"),
  horizon: tx("Possible low on the horizon"),
  none: tx("Unlikely"),
};

function update() {
  invalid([latEl, lonEl, kpEl], false);
  res.hidden = true;
  const lat = readNum(latEl), lon = readNum(lonEl), kp = readNum(kpEl);
  if (lat === null || lon === null || kp === null) { msg.textContent = tx("Enter a latitude, a longitude and a Kp index."); return; }
  const bad = [];
  if (Number.isNaN(lat) || Math.abs(lat) > 90) bad.push(latEl);
  if (Number.isNaN(lon) || Math.abs(lon) > 180) bad.push(lonEl);
  if (Number.isNaN(kp) || kp < 0 || kp > 9) bad.push(kpEl);
  if (bad.length) {
    invalid(bad);
    msg.textContent = bad.includes(kpEl) ? tx("Kp must be a number from 0 to 9.") : tx("Latitude must be between -90 and 90, and longitude between -180 and 180, in decimal degrees.");
    return;
  }
  msg.textContent = "";
  const mag = geomagLat(lat, lon), a = Math.abs(mag);
  const view = auroraView(a, kp);
  $("#ao-main").textContent = VIEW[view];
  const south = mag < 0;
  fillStats($("#ao-stats"), [
    [tx("Your position"), `${latText(lat, 2)}, ${lonText(lon, 2)}`],
    [tx("Geomagnetic latitude"), `${f(mag, 1)}°`],
    [tx("Oval edge at Kp {kp}", { kp: f(kp, 1) }), `${f(ovalEdge(kp), 1)}°`],
    [tx("Distance to the oval edge"), a >= ovalEdge(kp) ? tx("{n}° inside", { n: f(a - ovalEdge(kp), 1) }) : tx("{n}° outside", { n: f(ovalEdge(kp) - a, 1) })],
  ]);
  const side = south ? tx("south") : tx("north");
  $("#ao-hint").textContent = view === "overhead" ? tx("Look overhead and towards the {side} in a dark, clear sky.", { side })
    : view === "horizon" ? tx("Look low towards the {side} horizon, away from city lights.", { side })
      : tx("At this Kp the oval is too far away. It would take a stronger storm, or a place closer to the magnetic pole.");
  const rows = [];
  for (let k = 0; k <= 9; k++) {
    rows.push(el("tr", { class: k === Math.round(kp) ? "is-src" : "" }, el("th", { scope: "row" }, String(k)), el("td", {}, `${f(ovalEdge(k), 1)}°`), el("td", {}, VIEW[auroraView(a, k)])));
  }
  $("#ao-table").replaceChildren(...rows);
  res.hidden = false;

}
[latEl, lonEl, kpEl].forEach((e) => e.addEventListener("input", update));
locate($("#ao-locate"), msg, (la, lo) => { latEl.value = plain(la, 4); lonEl.value = plain(lo, 4); update(); });
update();
