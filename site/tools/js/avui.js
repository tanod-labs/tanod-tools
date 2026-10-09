// Shared helpers for the Aviation & Space tool pages: number reading and formatting, result lists, compass names,
// durations and coordinates. DOM and strings live here; the maths is in aviationcore.js, astrocore.js and metarcore.js.
import { $, el, tx, fmtNum } from "./core.js?v=11";
import { parseNum } from "./calccore.js?v=11";

/* A number typed in a field: null when empty, NaN when not a number. */
export const readNum = (input) => parseNum(input.value);

/* Round for display with at most `d` decimals (locale separators, grouping on). */
export const f = (n, d = 2) => (Number.isFinite(n) ? fmtNum(Number(n.toFixed(d)) + 0, { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–");
export const fFixed = (n, d = 2) => (Number.isFinite(n) ? fmtNum(Math.abs(n) < 0.5 * 10 ** -d ? 0 : n, { maximumFractionDigits: d, minimumFractionDigits: d }) : "–");
export const fInt = (n) => (Number.isFinite(n) ? fmtNum(Math.round(n) + 0, { maximumFractionDigits: 0 }) : "–");
/* A number written into an input so that parseNum reads it back (no grouping). */
export const plain = (n, d = 4) => fmtNum(Number(n.toFixed(d)), { maximumFractionDigits: d, useGrouping: false });

export const two = (n) => String(n).padStart(2, "0");

/* Fill a <dl class="stats"> with [label, value] rows (value: text or Node). */
export function fillStats(dl, rows) {
  dl.replaceChildren(...rows.filter(Boolean).map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", { class: "calc-small" }, v))));
}

export function invalid(inputs, on = true) {
  for (const i of inputs) i.setAttribute("aria-invalid", on ? "true" : "false");
}

const COMPASS_NAMES = [
  tx("north"), tx("north-northeast"), tx("northeast"), tx("east-northeast"), tx("east"), tx("east-southeast"), tx("southeast"), tx("south-southeast"),
  tx("south"), tx("south-southwest"), tx("southwest"), tx("west-southwest"), tx("west"), tx("west-northwest"), tx("northwest"), tx("north-northwest"),
];
export const compassName = (deg) => COMPASS_NAMES[Math.floor((((deg % 360) + 360) % 360) / 22.5 + 0.5) % 16];
export const degText = (deg, d = 1) => fmtNum(Number(deg.toFixed(d)), { maximumFractionDigits: d }) + "°";
export const bearingText = (deg) => `${degText(deg)} (${compassName(deg)})`;

export const latText = (lat, d = 4) => (lat < 0 ? tx("{n}° S", { n: f(-lat, d) }) : tx("{n}° N", { n: f(lat, d) }));
export const lonText = (lon, d = 4) => (lon < 0 ? tx("{n}° W", { n: f(-lon, d) }) : tx("{n}° E", { n: f(lon, d) }));

/* "2 h 5 min", "1 d 3 h 20 min", "92 min 40 s". */
export function duration(sec) {
  if (!Number.isFinite(sec)) return "–";
  const s = Math.round(sec);
  if (s < 60) return tx("{s} s", { s: fmtNum(s) });
  if (s < 3600) return tx("{m} min {s} s", { m: fmtNum(Math.floor(s / 60)), s: fmtNum(s % 60) });
  if (s < 86400) {
    const m = Math.round(s / 60);
    return tx("{h} h {m} min", { h: fmtNum(Math.floor(m / 60)), m: fmtNum(m % 60) });
  }
  const m = Math.round(s / 60);
  return tx("{d} d {h} h {m} min", { d: fmtNum(Math.floor(m / 1440)), h: fmtNum(Math.floor((m % 1440) / 60)), m: fmtNum(m % 60) });
}

export const PHASE_NAMES = {
  new_moon: tx("New moon"), waxing_crescent: tx("Waxing crescent"), first_quarter: tx("First quarter"), waxing_gibbous: tx("Waxing gibbous"),
  full_moon: tx("Full moon"), waning_gibbous: tx("Waning gibbous"), last_quarter: tx("Last quarter"), waning_crescent: tx("Waning crescent"),
};
/* One Unicode moon glyph per phase (northern hemisphere view). */
export const PHASE_GLYPH = { new_moon: "\u{1F311}", waxing_crescent: "\u{1F312}", first_quarter: "\u{1F313}", waxing_gibbous: "\u{1F314}", full_moon: "\u{1F315}", waning_gibbous: "\u{1F316}", last_quarter: "\u{1F317}", waning_crescent: "\u{1F318}" };

/* Ask the browser for the position (browser API only; nothing is sent anywhere by this page). */
export function locate(button, msgEl, onFix) {
  if (!("geolocation" in navigator)) { button.hidden = true; return; }
  button.addEventListener("click", () => {
    msgEl.textContent = tx("Asking your browser for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => { msgEl.textContent = ""; onFix(pos.coords.latitude, pos.coords.longitude); },
      (err) => { msgEl.textContent = err.code === 1 ? tx("Location access was denied. Type your latitude and longitude instead.") : tx("Your location could not be found. Type your latitude and longitude instead."); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

export { $, el, tx };
