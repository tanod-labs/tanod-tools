// Flight distance calculator: great-circle distance between two airports or two points. The airport list is a small
// JSON file (public-domain OurAirports data) fetched from this site when the page opens.
import { $, $$, el, tx, fmtNum, prefs } from "./core.js?v=11";
import { greatCircle, KM_PER_NM, KM_PER_SM } from "./aviationcore.js?v=11";
import { readNum, f, fillStats, invalid, bearingText, latText, lonText, duration } from "./avui.js?v=11";

const msg = $("#fd-msg"), res = $("#fd-res");
const ends = [
  { input: $("#fd-a"), pick: $("#fd-a-pick"), point: null },
  { input: $("#fd-b"), pick: $("#fd-b-pick"), point: null },
];
const speedIn = $("#fd-speed"), unitSel = $("#fd-unit");
let airports = [], byCode = new Map();
const mode = () => $('input[name="fd-mode"]:checked').value;

const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

fetch(new URL("../data/airports.json", import.meta.url))
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((rows) => {
    airports = rows.map(([ident, iata, name, lat, lon]) => ({ ident, iata, name, lat, lon, key: stripAccents(name) }));
    for (const a of airports) { byCode.set(a.iata, a); if (!byCode.has(a.ident)) byCode.set(a.ident, a); }
    ends.forEach((e) => { if (e.input.value) resolveEnd(e); });
    update();
  })
  .catch(() => { msg.textContent = tx("The airport list could not be loaded. You can still enter coordinates."); });

const label = (a) => `${a.iata} / ${a.ident}: ${a.name}`;

function matches(q) {
  const t = q.trim();
  if (!t) return [];
  const up = t.toUpperCase();
  const out = [];
  const exact = byCode.get(up);
  if (exact) out.push(exact);
  const n = stripAccents(t);
  for (const a of airports) {
    if (out.length >= 6) break;
    if (a === exact) continue;
    if (a.iata.startsWith(up) || a.ident.startsWith(up) || a.key.includes(n)) out.push(a);
  }
  return out;
}

function resolveEnd(e) {
  const m = matches(e.input.value);
  const q = e.input.value.trim().toUpperCase();
  const hit = byCode.get(q) || null;
  e.point = hit;
  e.pick.replaceChildren();
  if (hit) {
    e.pick.append(el("span", { class: "fd__sel" }, label(hit)));
  } else if (q && m.length) {
    for (const a of m) e.pick.append(el("button", { type: "button", class: "fd__opt", onclick: () => { e.input.value = a.iata; resolveEnd(e); update(); e.input.focus(); } }, label(a)));
  } else if (q && airports.length) {
    e.pick.append(el("span", { class: "fd__none" }, tx("No airport matches that code or name.")));
  }
}

ends.forEach((e) => e.input.addEventListener("input", () => { resolveEnd(e); update(); }));

function swap() {
  if (mode() === "air") {
    [ends[0].input.value, ends[1].input.value] = [ends[1].input.value, ends[0].input.value];
    ends.forEach(resolveEnd);
  } else {
    const ids = ["lat", "lon"];
    for (const k of ids) { const a = $("#fd-" + k + "1"), b = $("#fd-" + k + "2"); [a.value, b.value] = [b.value, a.value]; }
  }
  update();
}
$("#fd-swap").addEventListener("click", swap);
$("#fd-swap2").addEventListener("click", swap);

const geoIn = ["#fd-lat1", "#fd-lon1", "#fd-lat2", "#fd-lon2"].map((s) => $(s));
const SPEED_KMH = { kt: KM_PER_NM, kmh: 1, mph: KM_PER_SM };

function update() {
  invalid([...geoIn, speedIn, ...ends.map((e) => e.input)], false);
  res.hidden = true;
  let p1, p2, names;
  if (mode() === "air") {
    const bad = ends.filter((e) => !e.point);
    if (bad.length) {
      msg.textContent = ends.every((e) => !e.input.value.trim()) ? tx("Enter two airport codes or names, such as JFK and LHR.") : airports.length ? tx("Pick an airport from the list for each box, or type its full IATA or ICAO code.") : msg.textContent;
      return;
    }
    [p1, p2] = ends.map((e) => e.point);
    names = [label(p1), label(p2)];
  } else {
    const v = geoIn.map(readNum);
    if (v.some((x) => x === null)) { msg.textContent = tx("Enter a latitude and a longitude for both places."); return; }
    const badIdx = v.map((x, i) => (Number.isNaN(x) || (i % 2 === 0 ? Math.abs(x) > 90 : Math.abs(x) > 180) ? i : -1)).filter((i) => i >= 0);
    if (badIdx.length) { invalid(badIdx.map((i) => geoIn[i])); msg.textContent = tx("Latitude must be between -90 and 90, and longitude between -180 and 180, in decimal degrees."); return; }
    p1 = { lat: v[0], lon: v[1] };
    p2 = { lat: v[2], lon: v[3] };
    names = [`${latText(p1.lat)}, ${lonText(p1.lon)}`, `${latText(p2.lat)}, ${lonText(p2.lon)}`];
  }
  msg.textContent = "";
  const g = greatCircle(p1.lat, p1.lon, p2.lat, p2.lon);
  $("#fd-main").textContent = `${fmtNum(Math.round(g.km))} km · ${fmtNum(Math.round(g.nm))} NM · ${fmtNum(Math.round(g.mi))} mi`;
  $("#fd-route").textContent = `${names[0]} → ${names[1]}`;
  const sp = readNum(speedIn);
  let time = null;
  if (sp !== null && !Number.isNaN(sp) && sp > 0) time = duration((g.km / (sp * SPEED_KMH[unitSel.value])) * 3600);
  else if (sp !== null) invalid([speedIn]);
  fillStats($("#fd-stats"), [
    [tx("Kilometres"), f(g.km, 1)],
    [tx("Nautical miles"), f(g.nm, 1)],
    [tx("Statute miles"), f(g.mi, 1)],
    [tx("Initial bearing"), g.initial === null ? "–" : bearingText(g.initial)],
    [tx("Final bearing"), g.final === null ? "–" : bearingText(g.final)],
    [tx("Midpoint"), `${latText(g.mid.lat, 3)}, ${lonText(g.mid.lon, 3)}`],
    [tx("Flight time at this speed"), time ?? "–"],
  ]);
  res.hidden = false;
}

$$('input[name="fd-mode"]').forEach((r) => r.addEventListener("change", () => {
  $("#fd-air").hidden = mode() !== "air";
  $("#fd-geo").hidden = mode() !== "geo";
  update();
}));
[...geoIn, speedIn].forEach((i) => i.addEventListener("input", update));
unitSel.addEventListener("change", () => { prefs.set("av.speedUnit", unitSel.value); update(); });
unitSel.value = prefs.get("av.speedUnit", "kt");
ends[0].input.value = "JFK";
ends[1].input.value = "LHR";
update();

