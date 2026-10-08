// Cron core shared by the cron explainer and the cron generator: parse a five-field expression the way
// Vixie cron and cronie do, describe it in English and list next run times in any zone. Runs in the browser.
import { wallFields, wallToInstants, offsetMinutes, utcFromFields, pad } from "./tzcore.js?v=5";
import { tx, EN, LANG, dateFormat, listText } from "./i18n.js?v=5";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON3 = MONTHS.map((m) => m.slice(0, 3).toUpperCase());
const DAY3 = DAYS.map((d) => d.slice(0, 3).toUpperCase());

/* Month and weekday names for display. English keeps the names above; other pages take them from Intl.
   style is "long" or "short"; cap upper-cases the first letter (for menus and labels, not for running text). */
const capFirst = (t) => t.charAt(0).toLocaleUpperCase(LANG) + t.slice(1);
export function monthName(i, style = "long", cap = false) {
  if (EN) return style === "long" ? MONTHS[i] : MONTHS[i].slice(0, 3);
  const t = dateFormat({ month: style, timeZone: "UTC" }).format(Date.UTC(2023, i, 15));
  return cap ? capFirst(t) : t;
}
export function dayName(i, style = "long", cap = false) {
  if (EN) return style === "long" ? DAYS[i] : DAYS[i].slice(0, 3);
  const t = dateFormat({ weekday: style, timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + i));
  return cap ? capFirst(t) : t;
}

export const FIELDS = [
  { key: "minute", label: tx("Minute"), min: 0, max: 59 },
  { key: "hour", label: tx("Hour"), min: 0, max: 23 },
  { key: "dom", label: tx("Day of month"), min: 1, max: 31 },
  { key: "month", label: tx("Month"), min: 1, max: 12, names: MON3, base: 1 },
  { key: "dow", label: tx("Day of week"), min: 0, max: 7, names: DAY3, base: 0 },
];

export const MACROS = {
  "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
};

export class CronError extends Error {
  constructor(msg, field = -1) { super(msg); this.field = field; }
}

const QUARTZ = tx("This looks like Quartz or Spring syntax, where the first field is seconds and ?, L, W and # have special meanings. Standard cron has five fields (minute, hour, day of month, month, day of week) and none of those characters, so it can't be explained here.");

function parseField(raw, def, idx) {
  const where = tx("{field} field (\"{raw}\")", { field: def.label, raw });
  let text = raw.toUpperCase();
  if (def.names) text = text.replace(/[A-Z]{3,}/g, (w) => {
    const i = def.names.indexOf(w);
    if (i < 0) throw new CronError(def.key === "month"
      ? tx("{where}: \"{word}\" isn't a month name. Use {first}–{last} or numbers.", { where, word: w, first: def.names[0], last: def.names[def.names.length - 1] })
      : tx("{where}: \"{word}\" isn't a weekday name. Use {first}–{last} or numbers.", { where, word: w, first: def.names[0], last: def.names[def.names.length - 1] }), idx);
    return String(i + def.base);
  });
  if (/[?LW#]/.test(text)) throw new CronError(tx("{where}: {detail}", { where, detail: QUARTZ }), idx);
  const max = def.max;
  const set = new Set();
  let shorthandStep = false;
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new CronError(tx("{where}: \"{part}\" isn't a value cron understands. Use a number, a range like 1-5, a list like 1,15, a step like */10, or *.", { where, part }), idx);
    let lo, hi;
    if (m[1] === "*") { lo = def.min; hi = def.key === "dow" ? 6 : max; }
    else {
      lo = Number(m[2]);
      hi = m[3] !== undefined ? Number(m[3]) : lo;
      for (const v of [lo, hi]) if (v < def.min || v > max) throw new CronError(tx("{where}: {value} is outside {min}–{max}.", { where, value: v, min: def.min, max }), idx);
      if (lo > hi) throw new CronError(tx("{where}: the range {lo}-{hi} runs backwards. Cron ranges go from low to high; split it into two, such as {lo}-{max},{min}-{hi}.", { where, lo, hi, max, min: def.min }), idx);
      if (m[4] !== undefined && m[3] === undefined) { hi = def.key === "dow" ? 6 : max; shorthandStep = true; }
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (step < 1) throw new CronError(tx("{where}: a step of 0 isn't allowed.", { where }), idx);
    for (let v = lo; v <= hi; v += step) set.add(def.key === "dow" && v === 7 ? 0 : v);
  }
  const values = [...set].sort((a, b) => a - b);
  const full = def.key === "dow" ? 7 : def.max - def.min + 1;
  const stepM = /^\*\/(\d+)$/.exec(text);
  return { raw, values, set, star: raw.startsWith("*"), all: values.length === full, everyN: stepM ? Number(stepM[1]) : 0, shorthandStep };
}

/* Parse an expression into {fields: [5], macro?, command?, notes: []}. Throws CronError. */
export function parseCron(input) {
  let src = input.trim();
  const notes = [];
  if (!src) throw new CronError(tx("Type a cron expression, such as */15 9-17 * * 1-5."));
  let macro = null;
  if (src.startsWith("@")) {
    const word = src.split(/\s+/)[0].toLowerCase();
    if (word === "@reboot") throw new CronError(tx("@reboot runs a job once when the cron service starts, so it has no schedule of times to list."));
    if (!MACROS[word]) throw new CronError(tx("\"{word}\" isn't a cron shortcut. The shortcuts are @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly and @reboot.", { word }));
    macro = word;
    src = MACROS[word];
  }
  let parts = src.split(/\s+/);
  let command = null;
  if (parts.length > 5) {
    const sixth = parts[5];
    if (/^[/~.$"'\\]/.test(sixth) || /[a-z]{4,}/i.test(sixth.replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)\b/gi, ""))) {
      command = parts.slice(5).join(" ");
      parts = parts.slice(0, 5);
      notes.push(tx("Everything after the fifth field looks like the command, so only the schedule was read."));
    } else if (parts.length === 6) {
      throw new CronError(tx("This has 6 fields. Standard cron uses 5: minute, hour, day of month, month and day of week. A sixth field usually means seconds at the start (Quartz, Spring and some libraries) or a year at the end. Remove it to check the standard schedule."));
    } else {
      throw new CronError(tx("This has {n} fields. {detail}", { n: parts.length, detail: QUARTZ }));
    }
  }
  if (parts.length < 5) throw new CronError(tx("Cron needs 5 fields (minute, hour, day of month, month, day of week); this has {n}.", { n: parts.length }));
  const fields = parts.map((p, i) => parseField(p, FIELDS[i], i));
  if (fields.some((f) => f.shorthandStep)) notes.push(tx("A step after a single number, such as 5/10, is read here as 5-59/10. Some cron versions reject that form; writing the range out (5-59/10) works everywhere."));
  return { fields, macro, command, notes };
}

/* ------------------------------------------------------------------ English */

function joinAnd(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

/* Compress sorted numbers into runs: [1,2,3,5] -> ["1–3", "5"]; runs of two stay separate. */
function runs(values, fmt = String, sep = "–") {
  const out = [];
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j - i >= 2) { out.push(fmt(values[i]) + sep + fmt(values[j])); i = j + 1; }
    else { for (let k = i; k <= j; k++) out.push(fmt(values[k])); i = j + 1; }
  }
  return out;
}

const hh = (h) => pad(h) + ":00";
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const contiguous = (v) => v.length > 1 && v[v.length - 1] - v[0] === v.length - 1;

function dayList(values) {
  if (contiguous(values) && values.length >= 3) return `${DAYS[values[0]]} through ${DAYS[values[values.length - 1]]}`;
  return joinAnd(values.map((d) => DAYS[d]));
}

export function describe(p) {
  return EN ? describeEn(p) : describeLocal(p);
}

/* Other languages: the sentence is put together from whole translatable templates, so each language controls
   its own word order. The decisions (which parts appear) are the same as in the English version below. */
function describeLocal(p) {
  const [mi, ho, dom, mo, dow] = p.fields;
  const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;
  let time;
  if (!mi.everyN && !ho.everyN && !mi.all && !ho.all && mi.values.length * ho.values.length <= 6) {
    const times = [];
    for (const h of ho.values) for (const m of mi.values) times.push(hhmm(h, m));
    time = tx("At {times}", { times: listText(times) });
  } else {
    const single = !mi.all && !mi.everyN;
    let minutes;
    if (mi.all) minutes = tx("Every minute");
    else if (mi.everyN) minutes = mi.everyN === 1 ? tx("Every minute") : tx("Every {n} minutes", { n: mi.everyN });
    else if (mi.values.length === 1) minutes = tx("At minute {m}", { m: mi.values[0] });
    else minutes = tx("At minutes {list}", { list: listText(runs(mi.values)) });
    const between = () => tx("{minutes}, between {from} and {to}", { minutes, from: hhmm(ho.values[0], 0), to: hhmm(ho.values[ho.values.length - 1], 59) });
    if (ho.all) time = single ? tx("{minutes} past every hour", { minutes }) : minutes;
    else if (ho.everyN && single) time = tx("{minutes}, every {n} hours from 00:00", { minutes, n: ho.everyN });
    else if (ho.values.length === 1) time = single ? tx("{minutes} past {time}", { minutes, time: hhmm(ho.values[0], 0) }) : between();
    else if (contiguous(ho.values)) time = between();
    else time = tx("{minutes}, during hours {hours}", { minutes, hours: listText(runs(ho.values, pad)) });
  }

  const weekdays = (v) => (contiguous(v) && v.length >= 3
    ? tx("on {from} through {to}", { from: dayName(v[0]), to: dayName(v[v.length - 1]) })
    : v.length === 1 ? tx("on {day}", { day: dayName(v[0]) }) : tx("on {days}", { days: listText(v.map((d) => dayName(d))) }));
  let domText = null, dowText = null;
  if (!dom.all) {
    if (dom.everyN) domText = tx("on every {n} days of the month, from day 1", { n: dom.everyN });
    else if (dom.values.length === 1) domText = tx("on day {d} of the month", { d: dom.values[0] });
    else domText = tx("on days {list} of the month", { list: listText(runs(dom.values)) });
  }
  if (!dow.all) dowText = weekdays(dow.values);
  let day;
  const orMode = !dom.star && !dow.star;
  if ((!domText && !dowText) || (orMode && (dom.all || dow.all))) day = tx("every day");
  else if (!dowText) day = domText;
  else if (!domText) day = dowText;
  else if (orMode) day = tx("{dom} or {dow}", { dom: domText, dow: dowText });
  else day = tx("{dom}, but only {dow}", { dom: domText, dow: dowText });

  const parts = [time, day];
  if (!mo.all) {
    if (mo.values.length >= 3 && contiguous(mo.values)) parts.push(tx("in {from} through {to}", { from: monthName(mo.values[0] - 1), to: monthName(mo.values[mo.values.length - 1] - 1) }));
    else parts.push(tx("in {months}", { months: listText(mo.values.map((m) => monthName(m - 1))) }));
  }
  return parts.join(", ") + ".";
}

function describeEn(p) {
  const [mi, ho, dom, mo, dow] = p.fields;
  let time;
  if (!mi.everyN && !ho.everyN && !mi.all && !ho.all && mi.values.length * ho.values.length <= 6) {
    const times = [];
    for (const h of ho.values) for (const m of mi.values) times.push(`${pad(h)}:${pad(m)}`);
    time = "At " + joinAnd(times);
  } else {
    if (mi.all) time = "Every minute";
    else if (mi.everyN) time = mi.everyN === 1 ? "Every minute" : `Every ${mi.everyN} minutes`;
    else if (mi.values.length === 1) time = `At minute ${mi.values[0]}`;
    else time = `At minutes ${joinAnd(runs(mi.values))}`;
    const single = !mi.all && !mi.everyN;
    if (ho.all) time += single ? " past every hour" : "";
    else if (ho.everyN && single) time += `, every ${ho.everyN} hours from 00:00`;
    else if (ho.values.length === 1) time += single ? ` past ${hh(ho.values[0]).slice(0, 2)}:00` : `, between ${hh(ho.values[0])} and ${pad(ho.values[0])}:59`;
    else if (contiguous(ho.values)) time += `, between ${hh(ho.values[0])} and ${pad(ho.values[ho.values.length - 1])}:59`;
    else time += `, during hours ${joinAnd(runs(ho.values, pad))}`;
  }

  let domText = null, dowText = null;
  if (!dom.all) {
    if (dom.everyN) domText = `on every ${ordinal(dom.everyN)} day of the month from the 1st`;
    else if (dom.values.length === 1) domText = `on day ${dom.values[0]} of the month`;
    else domText = `on days ${joinAnd(runs(dom.values))} of the month`;
  }
  if (!dow.all) dowText = dow.values.length === 1 ? `on ${DAYS[dow.values[0]]}` : `on ${dayList(dow.values)}`;
  let day;
  const orMode = !dom.star && !dow.star;
  if ((!domText && !dowText) || (orMode && (dom.all || dow.all))) day = "every day";
  else if (!dowText) day = domText;
  else if (!domText) day = dowText;
  else if (orMode) day = `${domText} or ${dowText}`;
  else day = `${domText}, but only if it is a ${dowText.slice(3)}`;

  let month = "";
  if (!mo.all) {
    if (mo.values.length >= 3 && contiguous(mo.values)) month = `, ${MONTHS[mo.values[0]]} through ${MONTHS[mo.values[mo.values.length - 1]]}`;
    else month = `, in ${joinAnd(mo.values.map((m) => MONTHS[m - 1]))}`;
  }
  return `${time}, ${day}${month}.`;
}

export function fieldSummary(f, i) {
  if (!EN) {
    if (f.all) return i === 0 ? tx("every minute") : i === 1 ? tx("every hour") : i === 3 ? tx("every month") : tx("every day");
    if (f.everyN) return tx("every {n}", { n: f.everyN });
    if (i === 3) return listText(runs(f.values, (m) => monthName(m - 1, "short")));
    if (i === 4) return listText(runs(f.values, (d) => dayName(d, "short")));
    return listText(runs(f.values));
  }
  if (f.all) return i === 2 ? "every day" : i === 3 ? "every month" : i === 4 ? "every day" : i === 0 ? "every minute" : "every hour";
  if (f.everyN) return `every ${f.everyN}`;
  if (i === 3) return joinAnd(runs(f.values, (m) => MON3[m - 1].charAt(0) + MON3[m - 1].slice(1).toLowerCase()));
  if (i === 4) return joinAnd(runs(f.values, (d) => DAY3[d].charAt(0) + DAY3[d].slice(1).toLowerCase()));
  return joinAnd(runs(f.values));
}

/* ------------------------------------------------------------------ next runs */

const DAY_MS = 864e5;
export const SEARCH_YEARS = 100;

/* The next `count` run instants at or after `fromMs`, in zone `tz`.
   Returns {runs: [ms], skipped: n (times lost in DST gaps), repeated: n (times in DST overlaps, listed once), searchedTo: ms}. */
export function nextRuns(p, fromMs, tz, count) {
  const [mi, ho, dom, mo, dow] = p.fields;
  const out = [];
  let skipped = 0, repeated = 0;
  const f0 = wallFields(fromMs, tz);
  const startDay = utcFromFields(f0.y, f0.mo, f0.d);
  const limit = Math.ceil(SEARCH_YEARS * 366);
  const orMode = !dom.star && !dow.star;
  for (let i = 0; i <= limit && out.length < count; i++) {
    const day = new Date(startDay + i * DAY_MS);
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!mo.set.has(m)) continue;
    const domOk = dom.set.has(d), dowOk = dow.set.has(day.getUTCDay());
    if (!(orMode ? domOk || dowOk : domOk && dowOk)) continue;
    // Fast path when the zone's offset doesn't change during this local day.
    const noon = utcFromFields(y, m, d, 12);
    const offA = offsetMinutes(noon - 13 * 3600e3, tz), offB = offsetMinutes(noon + 13 * 3600e3, tz);
    const steady = offA === offB && offsetMinutes(noon, tz) === offA;
    for (const h of ho.values) {
      for (const mn of mi.values) {
        let t;
        if (steady) t = utcFromFields(y, m, d, h, mn) - offA * 60000;
        else {
          const list = wallToInstants({ y, mo: m, d, h, mi: mn, s: 0 }, tz);
          if (!list.length) { if (utcFromFields(y, m, d, h, mn) - offA * 60000 >= fromMs) skipped++; continue; }
          if (list.length > 1) repeated++;
          t = list[0];
        }
        if (t < fromMs) continue;
        out.push(t);
        if (out.length >= count) break;
      }
      if (out.length >= count) break;
    }
  }
  return { runs: out, skipped, repeated };
}
