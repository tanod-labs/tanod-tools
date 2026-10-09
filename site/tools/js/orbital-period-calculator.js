// Orbital period, speed and altitude for circular Earth orbits: Kepler's third law (aviationcore.js).
import { $, $$, tx } from "./core.js?v=11";
import { orbitFromAltitude, altitudeFromPeriod, R_EQUATOR_KM, KM_PER_SM } from "./aviationcore.js?v=11";
import { readNum, f, fInt, fillStats, invalid, duration, plain } from "./avui.js?v=11";

const altEl = $("#ob-alt"), altU = $("#ob-alt-u"), perEl = $("#ob-per"), perU = $("#ob-per-u"), preset = $("#ob-preset");
const msg = $("#ob-msg"), res = $("#ob-res");
const mode = () => $('input[name="ob-mode"]:checked').value;
const SEC = { s: 1, min: 60, h: 3600 };

function update() {
  const byAlt = mode() === "alt";
  for (const id of ["alt-f", "alt-u-f", "preset-f"]) $("#ob-" + id).hidden = !byAlt;
  for (const id of ["per-f", "per-u-f"]) $("#ob-" + id).hidden = byAlt;
  invalid([altEl, perEl], false);
  res.hidden = true;
  let o, h;
  if (byAlt) {
    const v = readNum(altEl);
    if (v === null) { msg.textContent = tx("Enter an altitude."); return; }
    h = v * (altU.value === "mi" ? KM_PER_SM : 1);
    if (Number.isNaN(v) || h < 0 || h > 1e6) { invalid([altEl]); msg.textContent = tx("The altitude must be a number from 0 up to 1,000,000 km."); return; }
    o = orbitFromAltitude(h);
  } else {
    const v = readNum(perEl);
    if (v === null) { msg.textContent = tx("Enter an orbital period."); return; }
    const s = v * SEC[perU.value];
    const min = 2 * Math.PI * Math.sqrt(R_EQUATOR_KM ** 3 / 398600.4418);
    if (Number.isNaN(v) || s < min || s > 8e7) { invalid([perEl]); msg.textContent = tx("The period must be at least {min} minutes (a circular orbit at the surface) and at most about 925 days.", { min: f(min / 60, 1) }); return; }
    o = altitudeFromPeriod(s);
    h = o.h;
  }
  msg.textContent = "";
  $("#ob-main-l").textContent = byAlt ? tx("Orbital period") : tx("Altitude");
  $("#ob-main").textContent = byAlt ? duration(o.period) : tx("{km} km ({mi} mi)", { km: fInt(h), mi: fInt(h / KM_PER_SM) });
  const kmh = o.speed * 3600;
  fillStats($("#ob-stats"), [
    byAlt ? [tx("Period in minutes"), f(o.period / 60, 2)] : [tx("Orbital period"), duration(o.period)],
    byAlt ? null : [tx("Altitude above the surface"), tx("{km} km ({mi} mi)", { km: fInt(h), mi: fInt(h / KM_PER_SM) })],
    [tx("Orbit radius from the Earth's centre"), tx("{km} km", { km: fInt(o.a) })],
    [tx("Orbital speed"), tx("{ms} km/s ({kmh} km/h)", { ms: f(o.speed, 3), kmh: fInt(kmh) })],
    [tx("Orbital speed in mph"), fInt(kmh / KM_PER_SM)],
    [tx("Orbits per day"), f(o.perDay, 3)],
  ]);
  $("#ob-info").textContent = h < 160 ? tx("Below about 160 km air drag is so high that a satellite re-enters within days or hours, so this orbit is not stable.") : Math.abs(h - 35786) < 60 ? tx("This is close to a geostationary orbit: the period equals one sidereal day, so the satellite hovers over one point of the equator.") : "";
  res.hidden = false;
}
$$('input[name="ob-mode"]').forEach((r) => r.addEventListener("change", update));
[altEl, perEl].forEach((e) => e.addEventListener("input", update));
[altU, perU].forEach((e) => e.addEventListener("change", update));
preset.addEventListener("change", () => {
  if (!preset.value) return;
  altU.value = "km";
  altEl.value = plain(Number(preset.value), 0);
  update();
});
altEl.addEventListener("input", () => { preset.value = ""; });

update();
