// Small UTC date helpers shared by the security.txt and CRA clock tools. No DOM, no formatting for a language.

export const pad = (n, w = 2) => String(n).padStart(w, "0");

/* ISO 8601 / RFC 3339 in UTC without fractions: 2027-01-31T23:59:59Z */
export function isoUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/* Calendar months added in UTC; a day that does not exist in the target month moves to its last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUTC(ms, months) {
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12), m = total - y * 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), dim), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/* "2026-10-09" for a timestamp, in UTC. */
export const dateUtc = (ms) => isoUtc(ms).slice(0, 10);

/* Parse "YYYY-MM-DD" (a real calendar day) as the start of that day in UTC, or null. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

/* Strict RFC 3339 date-time ("2027-01-31T23:59:59Z", lower-case t/z and numeric offsets allowed, fractions ignored) to ms, or null. */
export function parseRfc3339(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(String(s));
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, z] = m;
  const day = parseDay(`${Y}-${Mo}-${D}`);
  if (day === null || +H > 23 || +Mi > 59 || +S > 60) return null;
  let off = 0;
  if (z !== "Z" && z !== "z") {
    const oh = +z.slice(1, 3), om = +z.slice(4, 6);
    if (oh > 23 || om > 59) return null;
    off = (z[0] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  return day + ((+H * 60 + +Mi) * 60 + Math.min(+S, 59)) * 1000 - off * 60000;
}
