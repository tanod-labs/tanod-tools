// METAR / SPECI / TAF decoder: the core WMO / ICAO / FAA groups, a port of the Python decoder behind the Tanod
// aviation API (microapi/avdecode.py). Pure functions returning codes and numbers; the page turns them into words.
// Groups it does not understand are listed in `unparsed`, never dropped. Remarks (RMK) are kept as raw text.
// Sources: ICAO Annex 3 / WMO No. 306 (FM 15 METAR, FM 51 TAF), FAA Aeronautical Information Manual 7-1-30 and
// FMH-1. Not for flight planning or navigation.

export const M_PER_SM = 1609.344;
const KT_PER = { KT: 1, MPS: 1.943844, KMH: 0.539957 };
const MAX_RAW = 2000, MAX_TOKENS = 250;

const STATION = /^[A-Z][A-Z0-9]{3}$/;
const TIME = /^(\d{2})(\d{2})(\d{2})Z$/;
const WIND = /^(\d{3}|VRB|\/\/\/)(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/;
const WINDVAR = /^(\d{3})V(\d{3})$/;
const VIS_M = /^(\d{4})(NDV)?$/;
const VIS_SM = /^([PM])?(\d{1,2}|\d{1,2}\/\d{1,2})SM$/;
const VIS_WHOLE = /^\d$/;
const RVR = /^R(\d{2}[LRC]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?(FT)?([UDN])?$/;
const WX = /^(\+|-|VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;
const CLOUD = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/;
const VV = /^VV(\d{3}|\/\/\/)$/;
const TEMP = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/;
const ALT = /^([QA])(\d{4}|\/{4})$/;
const RECENT = /^RE([A-Z]{2,8})$/;
const WS = /^WS(?:R(\d{2}[LRC]?)|ALL)$/;
const TAF_VALID = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/;
const TAF_FM = /^FM(\d{2})(\d{2})(\d{2})?$/;
const TAF_PROB = /^PROB(\d{2})$/;
const TAF_TEMP = /^(TX|TN)(M?\d{2})\/(\d{2})(\d{2})Z$/;

export class DecodeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const num = (s) => (s.includes("/") ? null : Number(s));
const temp = (s) => (!s || s.includes("/") ? null : s.startsWith("M") ? -Number(s.slice(1)) : Number(s));
export const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg) => COMPASS[Math.floor(((deg % 360) / 22.5) + 0.5) % 16];
const round1 = (x) => Math.round(x * 10) / 10;

function windOf(m) {
  const [, d, sp, gust, unit] = m;
  const mult = KT_PER[unit];
  const speed = num(sp);
  const g = gust ? Number(gust) : null;
  const out = { unit, variable: d === "VRB", dir: null, speed, gust: g, speedKt: speed === null ? null : round1(speed * mult), gustKt: g === null ? null : round1(g * mult), calm: speed === 0 && d === "000" };
  if (d !== "VRB" && d !== "///") out.dir = Number(d);
  return out;
}

function visSm(s) {
  if (s.includes("/")) { const [a, b] = s.split("/"); return Number(b) ? Number(a) / Number(b) : 0; }
  return Number(s);
}

function weatherOf(m, raw) {
  const [, inten, desc, phen] = m;
  const descriptors = desc.match(/../g) || [];
  const phenomena = phen.match(/../g) || [];
  return { raw, intensity: inten === "-" ? "light" : inten === "+" ? "heavy" : inten === "VC" ? "vicinity" : "moderate", descriptors, phenomena };
}

/* Decode one element common to METAR and TAF into `out`; false when the token is not one. */
function tryElement(tok, out, state) {
  if (tok === "CAVOK") { out.cavok = true; return true; }
  if (tok === "NSW") { out.noSignificantWeather = true; return true; }
  if (["SKC", "CLR", "NSC", "NCD"].includes(tok)) { (out.clouds ||= []).push({ cover: tok, heightFt: null, type: null }); return true; }
  let m;
  if (!out.wind && (m = WIND.exec(tok))) { out.wind = windOf(m); return true; }
  if (out.wind && (m = WINDVAR.exec(tok))) { out.wind.varFrom = Number(m[1]); out.wind.varTo = Number(m[2]); return true; }
  if (!out.visibility) {
    if ((m = VIS_SM.exec(tok))) {
      const val = visSm(m[2]) + (state.visWhole || 0);
      state.visWhole = 0;
      out.visibility = { src: "SM", sm: val, m: Math.round(val * M_PER_SM), qualifier: m[1] === "P" ? "greater_than" : m[1] === "M" ? "less_than" : null };
      return true;
    }
    if ((m = VIS_M.exec(tok))) {
      const v = Number(m[1]);
      out.visibility = { src: "M", m: v, sm: Math.round((v / M_PER_SM) * 100) / 100, qualifier: v === 9999 ? "greater_than_or_equal" : null, ndv: !!m[2] };
      return true;
    }
    if (VIS_WHOLE.test(tok) && !state.visWhole) { state.visWhole = Number(tok); return true; }   // "1 1/2SM"
  }
  if ((m = VV.exec(tok))) { out.verticalVisibilityFt = m[1] === "///" ? null : Number(m[1]) * 100; return true; }
  if ((m = CLOUD.exec(tok))) {
    (out.clouds ||= []).push({ cover: m[1], heightFt: m[2] === "///" ? null : Number(m[2]) * 100, type: m[3] === "CB" || m[3] === "TCU" ? m[3] : null });
    return true;
  }
  if (tok && !["+", "-", "VC"].includes(tok) && (m = WX.exec(tok)) && (m[2] || m[3])) { (out.weather ||= []).push(weatherOf(m, tok)); return true; }
  return false;
}

/* US FAA categories: LIFR (<500 ft or <1 SM), IFR (<1000 ft or <3 SM), MVFR (<=3000 ft or <=5 SM), else VFR. */
export function flightCategory(visM, ceilingFt, cavok = false) {
  if (cavok) return "VFR";
  if (visM == null && ceilingFt == null) return null;
  const sm = visM == null ? null : visM / M_PER_SM;
  if ((ceilingFt != null && ceilingFt < 500) || (sm !== null && sm < 1)) return "LIFR";
  if ((ceilingFt != null && ceilingFt < 1000) || (sm !== null && sm < 3)) return "IFR";
  if ((ceilingFt != null && ceilingFt <= 3000) || (sm !== null && sm <= 5)) return "MVFR";
  return "VFR";
}

function ceiling(el) {
  let best = null;
  for (const c of el.clouds || []) if ((c.cover === "BKN" || c.cover === "OVC") && c.heightFt != null) best = best === null ? c.heightFt : Math.min(best, c.heightFt);
  const vv = el.verticalVisibilityFt;
  if (vv != null) best = best === null ? vv : Math.min(best, vv);
  return best;
}

function cleanRaw(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new DecodeError("empty");
  if (raw.length > MAX_RAW) throw new DecodeError("long");
  const toks = raw.replace(/=/g, " ").trim().toUpperCase().split(/\s+/);
  if (toks.length > MAX_TOKENS) throw new DecodeError("many");
  return toks;
}

/* Split pasted text into separate reports: at "=" or at lines that start a new METAR / SPECI / TAF. */
export function splitReports(text) {
  const src = String(text || "").replace(/\r/g, "").trim();
  if (!src) return [];
  let parts = src.includes("=") ? src.split("=") : src.split(/\n(?=\s*(?:METAR|SPECI|TAF)\b)/i);
  parts = parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return parts;
}

export function decodeMetar(raw) {
  const toks = cleanRaw(raw);
  let type = "METAR";
  if (toks[0] === "METAR" || toks[0] === "SPECI") type = toks.shift();
  if (!toks.length || !STATION.test(toks[0])) throw new DecodeError("station");
  const out = { type, station: toks.shift() };
  const unparsed = [], state = {};
  let remarks = [], trend = [], sawTime = false;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok === "RMK") { remarks = toks.slice(i + 1); break; }
    if (trend.length || ["NOSIG", "BECMG", "TEMPO"].includes(tok)) { trend.push(tok); continue; }
    let m;
    if (!sawTime && (m = TIME.exec(tok))) {
      const [d, h, mi] = [m[1], m[2], m[3]].map(Number);
      if (d < 1 || d > 31 || h > 23 || mi > 59) throw new DecodeError("time");
      out.observed = { day: d, hour: h, minute: mi };
      sawTime = true;
      continue;
    }
    if (["AUTO", "COR", "NIL", "CCA", "CCB"].includes(tok)) {
      out.auto = out.auto || tok === "AUTO";
      out.corrected = out.corrected || tok.startsWith("CC") || tok === "COR";
      if (tok === "NIL") out.nil = true;
      continue;
    }
    if (tryElement(tok, out, state)) continue;
    if ((m = RVR.exec(tok))) {
      (out.rvr ||= []).push({ runway: m[1], unit: m[6] ? "ft" : "m", value: Number(m[3]), qualifier: m[2] === "P" ? "greater_than" : m[2] === "M" ? "less_than" : null,
        variableTo: m[5] ? Number(m[5]) : null, trend: { U: "improving", D: "worsening", N: "no_change" }[m[7] || ""] || null });
      continue;
    }
    if ((m = TEMP.exec(tok))) { out.temperatureC = temp(m[1]); out.dewpointC = temp(m[2] || ""); continue; }
    if ((m = ALT.exec(tok))) {
      const [, unit, val] = m;
      if (val.includes("/")) out.altimeter = { hpa: null, inhg: null };
      else if (unit === "Q") out.altimeter = { unit, hpa: Number(val), inhg: Math.round(Number(val) * 0.02953 * 100) / 100 };
      else out.altimeter = { unit, inhg: Number(val) / 100, hpa: Math.round((Number(val) / 100) * 33.8639 * 10) / 10 };
      continue;
    }
    if ((m = RECENT.exec(tok))) { (out.recentWeather ||= []).push(m[1]); continue; }
    if (WS.test(tok)) { (out.windShear ||= []).push(tok); continue; }
    unparsed.push(tok);
  }
  if (state.visWhole) unparsed.push(String(state.visWhole));
  out.clouds ||= [];
  out.trend = trend.join(" ") || null;
  out.remarks = remarks.join(" ") || null;
  out.flightCategory = flightCategory(out.visibility?.m, ceiling(out), !!out.cavok);
  out.unparsed = unparsed;
  if (!out.observed && !out.nil) throw new DecodeError("obs_time");
  return out;
}

export function decodeTaf(raw) {
  const toks = cleanRaw(raw);
  if (toks[0] === "TAF") toks.shift();
  const out = { type: "TAF", amended: false, corrected: false, cancelled: false };
  while (["AMD", "COR", "RTD"].includes(toks[0])) {
    const t = toks.shift();
    out.amended ||= t === "AMD";
    out.corrected ||= t === "COR";
  }
  if (!toks.length || !STATION.test(toks[0])) throw new DecodeError("station");
  out.station = toks.shift();
  if (toks[0] === "NIL") return { ...out, nil: true, forecast: [], unparsed: [] };
  let m = toks.length ? TIME.exec(toks[0]) : null;
  if (!m) throw new DecodeError("taf_issue");
  const [d, h, mi] = [m[1], m[2], m[3]].map(Number);
  if (d < 1 || d > 31 || h > 23 || mi > 59) throw new DecodeError("time");
  toks.shift();
  out.issued = { day: d, hour: h, minute: mi };
  if (toks[0] === "NIL") return { ...out, nil: true, forecast: [], unparsed: [] };
  m = toks.length ? TAF_VALID.exec(toks[0]) : null;
  if (!m) throw new DecodeError("taf_valid");
  toks.shift();
  out.valid = { from: { day: Number(m[1]), hour: Number(m[2]) }, to: { day: Number(m[3]), hour: Number(m[4]) } };
  if (toks[0] === "CNL") { out.cancelled = true; toks.shift(); }
  const groups = [], unparsed = [], extremes = [], remarks = [];
  let cur = { change: "BASE", from: out.valid.from, to: out.valid.to };
  let state = {}, inRemarks = false;
  const flush = () => {
    cur.flightCategory = flightCategory(cur.visibility?.m, ceiling(cur), !!cur.cavok);
    cur.clouds ||= [];
    groups.push(cur);
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (inRemarks || tok === "RMK") { inRemarks = true; if (tok !== "RMK") remarks.push(tok); continue; }
    let change = null;
    if ((m = TAF_FM.exec(tok))) {
      change = { change: "FM", from: { day: Number(m[1]), hour: Number(m[2]), minute: Number(m[3] || 0) }, to: null };
    } else if (["BECMG", "TEMPO", "INTER"].includes(tok) && i + 1 < toks.length && TAF_VALID.test(toks[i + 1])) {
      const a = TAF_VALID.exec(toks[++i]);
      change = { change: tok, from: { day: Number(a[1]), hour: Number(a[2]) }, to: { day: Number(a[3]), hour: Number(a[4]) } };
    } else if ((m = TAF_PROB.exec(tok))) {
      const prob = Number(m[1]);
      let label = "PROB" + prob;
      if (i + 1 < toks.length && (toks[i + 1] === "TEMPO" || toks[i + 1] === "INTER")) label += " " + toks[++i];
      const v = i + 1 < toks.length ? TAF_VALID.exec(toks[i + 1]) : null;
      if (v) {
        i++;
        change = { change: label, probability: prob, from: { day: Number(v[1]), hour: Number(v[2]) }, to: { day: Number(v[3]), hour: Number(v[4]) } };
      } else { unparsed.push(tok); continue; }
    }
    if (change) { flush(); cur = change; state = {}; continue; }
    if ((m = TAF_TEMP.exec(tok))) { extremes.push({ kind: m[1] === "TX" ? "max" : "min", temperatureC: temp(m[2]), day: Number(m[3]), hour: Number(m[4]) }); continue; }
    if (tryElement(tok, cur, state)) continue;
    if ((m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(tok))) { cur.windShear = { heightFt: Number(m[1]) * 100, dir: Number(m[2]), speedKt: Number(m[3]) }; continue; }
    if (/^[256]\d{5}$/.test(tok) || /^QNH\d{4}INS$/.test(tok)) { (cur.otherGroups ||= []).push(tok); continue; }
    unparsed.push(tok);
  }
  flush();
  out.forecast = groups;
  out.temperatureExtremes = extremes;
  out.remarks = remarks.join(" ") || null;
  out.unparsed = unparsed;
  return out;
}

/* Decode one report, choosing TAF or METAR from its first word. */
export function decodeReport(text) {
  const first = String(text).trim().split(/\s+/)[0]?.toUpperCase();
  return first === "TAF" ? decodeTaf(text) : decodeMetar(text);
}
