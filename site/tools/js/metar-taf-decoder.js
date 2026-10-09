// METAR / TAF decoder page: turns the codes from metarcore.js into plain language.
import { $, el, tx, fmtNum, LOCALE } from "./core.js?v=11";
import { decodeReport, splitReports, DecodeError } from "./metarcore.js?v=11";
import { f, fInt, two, compassName, degText } from "./avui.js?v=11";

const input = $("#mt-in"), out = $("#mt-out"), msg = $("#mt-msg");
const EXAMPLES = [
  "METAR KSFO 080256Z 29016KT 10SM FEW003 16/13 A2986 RMK AO2 SLP112 T01560128",
  "METAR EGLL 081020Z 24012G25KT 9999 -RA SCT015CB BKN025 12/09 Q1008 NOSIG",
  "TAF AMD KSFO 080300Z 0803/0906 30015KT P6SM FEW005 FM080600 28007KT P6SM FEW004 TEMPO 0900/0902 3SM BR PROB30 0902/0904 1SM FG TX20/0821Z TN12/0913Z",
];
let exampleNo = 0;

const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(LOCALE) + s.slice(1) : s);
const ft = (n) => tx("{ft} ft ({m} m)", { ft: fInt(n), m: fInt(n * 0.3048) });
const tempText = (c) => tx("{c}°C ({f}°F)", { c: fmtNum(c), f: fmtNum(Math.round(((c * 9) / 5 + 32) * 10) / 10) });
const when = (t) => tx("day {day}, {time} UTC", { day: t.day, time: `${two(t.hour)}:${two(t.minute ?? 0)}` });

const PHEN = {
  DZ: tx("drizzle"), RA: tx("rain"), SN: tx("snow"), SG: tx("snow grains"), IC: tx("ice crystals"), PL: tx("ice pellets"), GR: tx("hail"),
  GS: tx("small hail"), UP: tx("unknown precipitation"), BR: tx("mist"), FG: tx("fog"), FU: tx("smoke"), VA: tx("volcanic ash"),
  DU: tx("widespread dust"), SA: tx("sand"), HZ: tx("haze"), PY: tx("spray"), PO: tx("dust whirls"), SQ: tx("squalls"), FC: tx("funnel cloud"),
  SS: tx("sandstorm"), DS: tx("duststorm"),
};
const DESC = { MI: tx("shallow"), PR: tx("partial"), BC: tx("patches"), DR: tx("low drifting"), BL: tx("blowing"), SH: tx("showers"), TS: tx("thunderstorm"), FZ: tx("freezing") };
const INTENSITY = { light: tx("light"), heavy: tx("heavy"), vicinity: tx("in the vicinity") };

function weatherText(w) {
  const what = w.phenomena.map((p) => PHEN[p]);
  const quals = [];
  if (w.intensity !== "moderate") quals.push(INTENSITY[w.intensity]);
  let descs = w.descriptors;
  if (!what.length) { what.push(DESC[descs[0]] || ""); descs = descs.slice(1); }
  for (const d of descs) quals.push(DESC[d]);
  return `${w.raw}: ${cap(what.join(" + "))}${quals.length ? ` (${quals.join(", ")})` : ""}`;
}

function windText(w) {
  if (w.calm) return tx("Calm");
  if (w.speedKt === null) return tx("Not reported");
  const kmh = fInt(w.speedKt * 1.852);
  const main = w.variable ? tx("Variable direction at {speed} kt ({kmh} km/h)", { speed: f(w.speedKt, 1), kmh })
    : w.dir === null ? tx("Direction not reported, {speed} kt ({kmh} km/h)", { speed: f(w.speedKt, 1), kmh })
      : tx("From {dir}° ({compass}) at {speed} kt ({kmh} km/h)", { dir: String(w.dir).padStart(3, "0"), compass: compassName(w.dir), speed: f(w.speedKt, 1), kmh });
  const parts = [main];
  if (w.gustKt != null) parts.push(tx("gusting to {gust} kt ({kmh} km/h)", { gust: f(w.gustKt, 1), kmh: fInt(w.gustKt * 1.852) }));
  if (w.varFrom != null) parts.push(tx("direction varying between {from}° and {to}°", { from: w.varFrom, to: w.varTo }));
  if (w.unit !== "KT") parts.push(tx("reported as {speed} {unit}", { speed: w.speed, unit: w.unit === "MPS" ? tx("m/s") : tx("km/h") }));
  return parts.join(", ");
}

function visText(v) {
  const sm = fmtNum(v.sm, { maximumFractionDigits: 2 });
  let base;
  if (v.src === "SM") base = tx("{sm} SM ({km} km)", { sm, km: f(v.m / 1000, 1) });
  else if (v.m >= 9999) base = tx("10 km or more");
  else if (v.m >= 5000) base = tx("{km} km ({sm} SM)", { km: f(v.m / 1000, 1), sm });
  else base = tx("{m} m ({sm} SM)", { m: fInt(v.m), sm });
  if (v.qualifier === "greater_than") base = tx("more than {value}", { value: base });
  else if (v.qualifier === "less_than") base = tx("less than {value}", { value: base });
  if (v.ndv) base += ", " + tx("no directional variation");
  return base;
}

function cloudText(c) {
  const h = c.heightFt === null ? null : ft(c.heightFt);
  let base;
  switch (c.cover) {
    case "SKC": return tx("Sky clear");
    case "CLR": return tx("Clear (no cloud below 12,000 ft detected by an automatic station)");
    case "NSC": return tx("No significant cloud");
    case "NCD": return tx("No cloud detected");
    case "FEW": base = h ? tx("Few clouds at {height}", { height: h }) : tx("Few clouds, height unknown"); break;
    case "SCT": base = h ? tx("Scattered clouds at {height}", { height: h }) : tx("Scattered clouds, height unknown"); break;
    case "BKN": base = h ? tx("Broken clouds at {height}", { height: h }) : tx("Broken clouds, height unknown"); break;
    default: base = h ? tx("Overcast at {height}", { height: h }) : tx("Overcast, height unknown");
  }
  if (c.type === "CB") base += ` (${tx("cumulonimbus")})`;
  if (c.type === "TCU") base += ` (${tx("towering cumulus")})`;
  return base;
}

const CAT_TEXT = {
  VFR: tx("VFR: ceiling above 3,000 ft and visibility above 5 SM"),
  MVFR: tx("MVFR: ceiling 1,000 to 3,000 ft or visibility 3 to 5 SM"),
  IFR: tx("IFR: ceiling 500 to below 1,000 ft or visibility 1 to below 3 SM"),
  LIFR: tx("LIFR: ceiling below 500 ft or visibility below 1 SM"),
};

function rvrText(r) {
  const u = r.unit === "ft" ? tx("ft") : tx("m");
  let v = `${fInt(r.value)} ${u}`;
  if (r.variableTo) v = tx("varying from {from} to {to}", { from: v, to: `${fInt(r.variableTo)} ${u}` });
  else if (r.qualifier === "greater_than") v = tx("more than {value}", { value: v });
  else if (r.qualifier === "less_than") v = tx("less than {value}", { value: v });
  const tr = { improving: tx("improving"), worsening: tx("worsening"), no_change: tx("no change") }[r.trend];
  return tx("Runway {runway}: {value}", { runway: r.runway, value: v }) + (tr ? ` (${tr})` : "");
}

function recentText(code) {
  const m = /^((?:MI|PR|BC|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/.exec(code);
  if (!m || (!m[1] && !m[2])) return code;
  const phen = (m[2].match(/../g) || []).map((p) => PHEN[p]);
  const desc = (m[1].match(/../g) || []).map((d) => DESC[d]);
  return tx("Recent weather: {what}", { what: [...phen, ...desc].join(" + ") });
}

/* The elements shared by METAR and TAF periods, as [label, value] rows. */
function elementRows(e) {
  const rows = [];
  if (e.wind) rows.push([tx("Wind"), windText(e.wind)]);
  if (e.cavok) rows.push([tx("Visibility and sky"), tx("CAVOK: visibility 10 km or more, no cloud below 5,000 ft, no significant weather")]);
  else {
    if (e.visibility) rows.push([tx("Visibility"), visText(e.visibility)]);
    if (e.rvr) rows.push([tx("Runway visual range"), el("ul", { class: "mt-list" }, e.rvr.map((r) => el("li", {}, rvrText(r))))]);
    if (e.weather) rows.push([tx("Weather"), el("ul", { class: "mt-list" }, e.weather.map((w) => el("li", {}, weatherText(w))))]);
    if (e.noSignificantWeather) rows.push([tx("Weather"), tx("No significant weather (NSW)")]);
    const sky = (e.clouds || []).map(cloudText);
    if (e.verticalVisibilityFt !== undefined) sky.push(e.verticalVisibilityFt === null ? tx("Sky obscured") : tx("Sky obscured, vertical visibility {height}", { height: ft(e.verticalVisibilityFt) }));
    if (sky.length) rows.push([tx("Sky"), el("ul", { class: "mt-list" }, sky.map((s) => el("li", {}, s)))]);
  }
  if (e.windShear) rows.push([tx("Wind shear"), Array.isArray(e.windShear) ? e.windShear.join(", ") : tx("At {height}: from {dir}° at {speed} kt", { height: ft(e.windShear.heightFt), dir: e.windShear.dir, speed: e.windShear.speedKt })]);
  if (e.otherGroups) rows.push([tx("Other groups (kept as written)"), e.otherGroups.join(" ")]);
  return rows;
}

function dl(rows) {
  return el("dl", { class: "mt-dl" }, rows.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))));
}

const kindText = (r) => {
  const base = r.type === "TAF" ? tx("TAF (terminal aerodrome forecast)") : r.type === "SPECI" ? tx("SPECI (special observation)") : tx("METAR (routine observation)");
  const mods = [];
  if (r.auto) mods.push(tx("automated"));
  if (r.corrected) mods.push(tx("corrected"));
  if (r.amended) mods.push(tx("amended"));
  if (r.cancelled) mods.push(tx("cancelled"));
  return mods.length ? `${base}, ${mods.join(", ")}` : base;
};

function metarCard(r) {
  const rows = [[tx("Report type"), kindText(r)], [tx("Station"), r.station]];
  if (r.observed) rows.push([tx("Observed"), when(r.observed)]);
  if (r.nil) rows.push([tx("Status"), tx("NIL: the report is missing")]);
  rows.push(...elementRows(r));
  if (r.temperatureC != null) {
    rows.push([tx("Temperature"), tempText(r.temperatureC)]);
    if (r.dewpointC != null) {
      rows.push([tx("Dew point"), tempText(r.dewpointC)]);
      const T = r.temperatureC, D = r.dewpointC;
      const rh = (100 * Math.exp((17.625 * D) / (243.04 + D))) / Math.exp((17.625 * T) / (243.04 + T));
      rows.push([tx("Relative humidity (approximate)"), `${fInt(Math.min(100, rh))} %`]);
    }
  }
  if (r.altimeter && r.altimeter.hpa != null) rows.push([tx("Altimeter (QNH)"), tx("{hpa} hPa ({inhg} inHg)", { hpa: fmtNum(r.altimeter.hpa, { maximumFractionDigits: 1 }), inhg: fmtNum(r.altimeter.inhg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })]);
  if (r.recentWeather) rows.push([tx("Recent weather"), r.recentWeather.map(recentText).join("; ")]);
  if (r.flightCategory) rows.push([tx("Flight category"), el("span", { class: "mt-cat mt-cat--" + r.flightCategory.toLowerCase() }, CAT_TEXT[r.flightCategory])]);
  if (r.trend) rows.push([tx("Trend"), r.trend === "NOSIG" ? tx("NOSIG: no significant change expected in the next 2 hours") : r.trend]);
  if (r.remarks) rows.push([tx("Remarks (not decoded)"), el("code", {}, r.remarks)]);
  if (r.unparsed.length) rows.push([tx("Not decoded"), el("code", {}, r.unparsed.join(" "))]);
  return dl(rows);
}

const rangeText = (g) => (g.to ? tx("{from} to {to}", { from: when(g.from), to: when(g.to) }) : tx("from {time}", { time: when(g.from) }));
function periodTitle(g) {
  const w = rangeText(g);
  const p = g.probability;
  switch (g.change) {
    case "BASE": return tx("Base forecast: {when}", { when: w });
    case "FM": return tx("Conditions change: {when}", { when: w });
    case "BECMG": return tx("Becoming (gradual change): {when}", { when: w });
    case "TEMPO": return tx("Temporary fluctuations: {when}", { when: w });
    case "INTER": return tx("Intermittent: {when}", { when: w });
    default:
      if (/TEMPO/.test(g.change)) return tx("{p}% probability of temporary fluctuations: {when}", { p, when: w });
      if (/INTER/.test(g.change)) return tx("{p}% probability of intermittent conditions: {when}", { p, when: w });
      return tx("{p}% probability: {when}", { p, when: w });
  }
}

function tafCard(r) {
  const rows = [[tx("Report type"), kindText(r)], [tx("Station"), r.station], [tx("Issued"), when(r.issued)]];
  if (r.nil) {
    rows.push([tx("Status"), tx("NIL: the forecast is missing")]);
    return dl(rows);
  }
  rows.push([tx("Valid"), tx("{from} to {to}", { from: when(r.valid.from), to: when(r.valid.to) })]);
  const wrap = el("div", {}, dl(rows));
  for (const g of r.forecast) {
    const prow = elementRows(g);
    if (g.flightCategory) prow.push([tx("Flight category"), el("span", { class: "mt-cat mt-cat--" + g.flightCategory.toLowerCase() }, CAT_TEXT[g.flightCategory])]);
    if (!prow.length) prow.push([tx("Conditions"), tx("No elements given: unchanged or not reported")]);
    wrap.append(el("section", { class: "mt-period" }, el("h4", {}, periodTitle(g)), dl(prow)));
  }
  const extra = r.temperatureExtremes.map((t) => [t.kind === "max" ? tx("Maximum temperature") : tx("Minimum temperature"), tx("{temp}, {when}", { temp: tempText(t.temperatureC), when: when({ day: t.day, hour: t.hour }) })]);
  if (extra.length) wrap.append(el("section", { class: "mt-period" }, el("h4", {}, tx("Temperature extremes")), dl(extra)));
  const tail = [];
  if (r.remarks) tail.push([tx("Remarks (not decoded)"), el("code", {}, r.remarks)]);
  if (r.unparsed.length) tail.push([tx("Not decoded"), el("code", {}, r.unparsed.join(" "))]);
  if (tail.length) wrap.append(dl(tail));
  return wrap;
}

const ERR = {
  empty: tx("Paste a METAR or TAF report to decode it."),
  station: tx("A report starts with a 4-character station code, such as KSFO or EGLL."),
  obs_time: tx("This METAR has no observation time group (such as 080256Z)."),
  time: tx("A time group is out of range (day 1 to 31, hour 0 to 23, minute 0 to 59)."),
  taf_issue: tx("This TAF has no issue time group (such as 080300Z)."),
  taf_valid: tx("This TAF has no validity period (such as 0803/0906)."),
  long: tx("The report is too long to decode (the limit is 2,000 characters)."),
  many: tx("The report has too many groups to decode."),
};

function render() {
  out.replaceChildren();
  msg.textContent = "";
  input.setAttribute("aria-invalid", "false");
  const reports = splitReports(input.value);
  if (!reports.length) { msg.textContent = ERR.empty; return; }
  const errors = [];
  reports.slice(0, 20).forEach((text, i) => {
    try {
      const r = decodeReport(text);
      const card = el("article", { class: "mt-card" }, el("h3", {}, `${r.type} ${r.station}`), el("p", { class: "mt-raw" }, el("code", {}, text)), r.type === "TAF" ? tafCard(r) : metarCard(r));
      out.append(card);
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
      errors.push(reports.length > 1 ? tx("Report {n}: {error}", { n: i + 1, error: ERR[e.code] || ERR.station }) : ERR[e.code] || ERR.station);
    }
  });
  if (errors.length) { input.setAttribute("aria-invalid", "true"); msg.textContent = errors.join(" "); }
}

input.addEventListener("input", render);
$("#mt-example").addEventListener("click", () => { input.value = EXAMPLES[exampleNo++ % EXAMPLES.length]; render(); });
$("#mt-clear").addEventListener("click", () => { input.value = ""; render(); input.focus(); });
input.value = EXAMPLES[0];
render();
