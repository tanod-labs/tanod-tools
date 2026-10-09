// Crosswind and headwind calculator for both ends of a runway, for steady wind and gusts.
import { $, el, tx } from "./core.js?v=11";
import { windComponents, runwayHeading } from "./aviationcore.js?v=11";
import { readNum, f, degText, invalid } from "./avui.js?v=11";

const rwy = $("#cw-rwy"), dir = $("#cw-dir"), spd = $("#cw-spd"), gust = $("#cw-gust"), unit = $("#cw-unit");
const msg = $("#cw-msg"), res = $("#cw-res");
const UNIT_TEXT = { kt: tx("kt"), kmh: tx("km/h"), mph: tx("mph"), ms: tx("m/s") };

const rwyLabel = (deg) => String(Math.round(deg / 10) % 36 || 36).padStart(2, "0");

function comp(label, rwyDeg, windDeg, v, u, kind) {
  const c = windComponents(rwyDeg, windDeg, v);
  const hw = Math.abs(c.head) < 0.05 ? tx("none") : c.head > 0 ? tx("{v} {unit} headwind", { v: f(c.head, 1), unit: u }) : tx("{v} {unit} tailwind", { v: f(-c.head, 1), unit: u });
  const cw = Math.abs(c.cross) < 0.05 ? tx("none") : c.cross > 0 ? tx("{v} {unit} from the right", { v: f(c.cross, 1), unit: u }) : tx("{v} {unit} from the left", { v: f(-c.cross, 1), unit: u });
  return [label, kind, hw, cw, c];
}

function update() {
  invalid([rwy, dir, spd, gust], false);
  res.hidden = true;
  const h = runwayHeading(rwy.value);
  const wd = readNum(dir), ws = readNum(spd), wg = readNum(gust);
  if (!rwy.value.trim() || wd === null || ws === null) { msg.textContent = tx("Enter the runway, the wind direction and the wind speed."); return; }
  if (h === null) { invalid([rwy]); msg.textContent = tx("A runway is a number from 01 to 36, optionally with L, R or C, or a heading from 0 to 360 degrees."); return; }
  if (Number.isNaN(wd) || wd < 0 || wd > 360) { invalid([dir]); msg.textContent = tx("The wind direction must be between 0 and 360 degrees."); return; }
  if (Number.isNaN(ws) || ws < 0) { invalid([spd]); msg.textContent = tx("The wind speed must be a number of 0 or more."); return; }
  if (Number.isNaN(wg) || (wg !== null && wg < 0)) { invalid([gust]); msg.textContent = tx("The gust speed must be a number of 0 or more."); return; }
  if (wg !== null && wg < ws) { invalid([gust]); msg.textContent = tx("The gust speed should not be lower than the wind speed."); return; }
  msg.textContent = "";
  const u = UNIT_TEXT[unit.value];
  const ends = [h, (h + 180) % 360];
  const rows = [];
  for (const e of ends) {
    const lab = tx("Runway {n}", { n: rwyLabel(e) });
    const steady = comp(lab, e, wd, ws, u, tx("{v} {unit}", { v: f(ws, 1), unit: u }));
    rows.push(steady);
    if (wg !== null && wg > ws) rows.push(comp(lab, e, wd, wg, u, tx("gusts {v} {unit}", { v: f(wg, 1), unit: u })));
  }
  const body = $("#cw-rows");
  body.replaceChildren(...rows.map(([lab, kind, hw, cw, c]) => el("tr", { class: c.head > 0.05 ? "is-src" : "" },
    el("th", { scope: "row" }, lab), el("td", {}, kind),
    el("td", {}, hw), el("td", {}, cw))));
  const c0 = windComponents(h, wd, ws);
  $("#cw-info").textContent = tx("The wind is {angle} off the nose of runway {n}.", { angle: degText(Math.abs(c0.angle), 0), n: rwyLabel(h) });
  res.hidden = false;
}
[rwy, dir, spd, gust].forEach((i) => i.addEventListener("input", update));
unit.addEventListener("change", update);
update();
