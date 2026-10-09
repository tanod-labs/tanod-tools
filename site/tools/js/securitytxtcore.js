// security.txt (RFC 9116): build a file from form values and check pasted text. Pure functions, no DOM, no network.
// The checker returns findings as {level, code, params, line}; the page turns each code into a sentence in its language.
import { isoUtc, addMonthsUTC, parseRfc3339, parseDay } from "./utcdate.js?v=11";

export const WRITE_ORDER = ["Contact", "Expires", "Encryption", "Acknowledgments", "Preferred-Languages", "Canonical", "Policy", "Hiring"];
export const KNOWN = new Set(WRITE_ORDER.map((n) => n.toLowerCase()));
const DAY = 86400000;
export const WELL_KNOWN = "/.well-known/security.txt";

/* ------------------------------------------------------------------ values */

const oneLine = (s) => String(s ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
const lines = (s) => (Array.isArray(s) ? s : String(s ?? "").split(/\r\n|\n|\r/)).map(oneLine).filter(Boolean);

/* A contact typed loosely becomes a URI: an e-mail address gets mailto:, a phone number tel:, a bare web address https://. */
export function normalizeContact(raw) {
  const v = oneLine(raw);
  if (!v) return "";
  if (/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(v)) return "mailto:" + v;
  if (/^\+?\d[\d\s().-]{4,}$/.test(v)) return "tel:" + v.replace(/[\s()]/g, "");
  return normalizeWeb(v);
}

/* A web address typed without a scheme gets https://; anything with a scheme (even http://) is left for the checker to judge. */
export function normalizeWeb(raw) {
  const v = oneLine(raw);
  if (!v) return "";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) return v;
  if (/^[^\s/]+\.[^\s/.]{2,}(\/.*)?$/.test(v)) return "https://" + v;
  return v;
}

const unique = (a) => [...new Set(a)];

/* Default expiry: the end of the day 364 days from now, so it stays inside RFC 9116's "less than a year". */
export function defaultExpires(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 364, 23, 59, 59);
}

/* Latest sensible expiry: one calendar year after `now`. */
export const maxExpires = (now) => addMonthsUTC(now, 12);

/* The text of the file. Input: {contact, expires, encryption, acknowledgments, languages, canonical, policy, hiring};
   multi-value fields are arrays or newline-separated strings; expires is a timestamp (ms) or a "YYYY-MM-DD" day (end of that day, UTC). */
export function buildSecurityTxt(o) {
  const out = [];
  const put = (name, values) => { for (const v of values) out.push(`${name}: ${v}`); };
  put("Contact", unique(lines(o.contact).map(normalizeContact)));
  let exp = o.expires;
  if (typeof exp === "string") { const d = parseDay(exp); exp = d === null ? null : d + DAY - 1000; }
  if (exp != null) out.push("Expires: " + isoUtc(exp));
  put("Encryption", unique(lines(o.encryption).map(normalizeWeb)));
  put("Acknowledgments", unique(lines(o.acknowledgments).map(normalizeWeb)));
  const langs = oneLine(o.languages).split(/\s*,\s*|\s+/).filter(Boolean);
  if (langs.length) out.push("Preferred-Languages: " + unique(langs).join(", "));
  put("Canonical", unique(lines(o.canonical).map(normalizeWeb)));
  put("Policy", unique(lines(o.policy).map(normalizeWeb)));
  put("Hiring", unique(lines(o.hiring).map(normalizeWeb)));
  return out.length ? out.join("\n") + "\n" : "";
}

/* ------------------------------------------------------------------ reading a file */

const SIG_BEGIN = "-----BEGIN PGP SIGNATURE-----", SIG_END = "-----END PGP SIGNATURE-----", MSG_BEGIN = "-----BEGIN PGP SIGNED MESSAGE-----";

/* Split pasted text into lines and, when it is an OpenPGP cleartext-signed message, into the signed body.
   Returns {rows: [{no, text}], signed: "none" | "ok" | "broken", problems: [code], bom}. The signature itself is not verified. */
export function readLines(text) {
  let t = String(text ?? "");
  const bom = t.charCodeAt(0) === 0xfeff;
  if (bom) t = t.slice(1);
  const all = t.split(/\r\n|\n|\r/);
  const rows = all.map((s, i) => ({ no: i + 1, text: s }));
  const first = rows.findIndex((r) => r.text.trim() !== "");
  const sigAt = rows.findIndex((r) => r.text.trim() === SIG_BEGIN);
  const problems = [];
  if (first >= 0 && rows[first].text.trim() === MSG_BEGIN) {
    const end = rows.findIndex((r) => r.text.trim() === SIG_END);
    let blank = rows.findIndex((r, i) => i > first && r.text.trim() === "");
    if (sigAt < 0 || end < 0 || end < sigAt) problems.push("pgp-incomplete");
    if (blank < 0 || (sigAt >= 0 && blank > sigAt)) { problems.push("pgp-incomplete"); blank = first; }
    if (end >= 0 && rows.slice(end + 1).some((r) => r.text.trim() !== "")) problems.push("pgp-trailing");
    const stop = sigAt >= 0 ? sigAt : rows.length;
    const body = rows.slice(blank + 1, stop).map((r) => ({ no: r.no, text: r.text.startsWith("- ") ? r.text.slice(2) : r.text }));
    return { rows: body, signed: problems.length ? "broken" : "ok", problems: unique(problems), bom };
  }
  if (sigAt >= 0) return { rows, signed: "broken", problems: ["pgp-orphan"], bom };
  return { rows, signed: "none", problems, bom };
}

/* Fields in the order they appear: [{name, key (lower-case), value, line}] plus the lines that are not fields. */
export function parseFields(rows) {
  const fields = [], bad = [];
  for (const { no, text } of rows) {
    const s = text.trim();
    if (!s || s.startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(text.replace(/^\s+/, ""));
    if (!m) { bad.push({ line: no, text: s }); continue; }
    fields.push({ name: m[1], key: m[1].toLowerCase(), value: m[2].trim(), spaced: m[2] === "" || /^\s/.test(m[2]), line: no });
  }
  return { fields, bad };
}

/* ------------------------------------------------------------------ URIs */

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const MAIL = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

/* Findings for one Contact value. */
function contactFindings(value, line) {
  const f = (level, code, params = {}) => ({ level, code, params: { value, ...params }, line });
  if (/\s/.test(value)) return [f("error", "uri-space")];
  const m = SCHEME.exec(value);
  if (!m) return [f("error", "contact-scheme-missing")];
  const scheme = m[1].toLowerCase();
  const rest = value.slice(m[0].length);
  if (scheme === "mailto") {
    let addr = rest.split("?")[0];
    try { addr = decodeURIComponent(addr); } catch (_) { /* keep as typed */ }
    return MAIL.test(addr) ? [] : [f("error", "mailto-bad")];
  }
  if (scheme === "tel") {
    const digits = rest.replace(/\D/g, "");
    if (!/^\+?[0-9][0-9().-]*$/.test(rest) || digits.length < 5) return [f("error", "tel-bad")];
    return rest.startsWith("+") ? [] : [f("warn", "tel-local")];
  }
  if (scheme === "http") return [f("error", "web-http", { field: "Contact" })];
  if (scheme === "https") return webUrl(value) ? [] : [f("error", "uri-bad")];
  return [f("warn", "contact-scheme-other", { scheme })];
}

function webUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname ? u : null;
  } catch (_) { return null; }
}

/* Findings for a field that must be an https URL (Acknowledgments, Canonical, Hiring, Policy), or for Encryption (also dns:, openpgp4fpr:). */
function webFindings(field, value, line) {
  const f = (level, code, params = {}) => ({ level, code, params: { field, value, ...params }, line });
  if (/\s/.test(value)) return [f("error", "uri-space")];
  const m = SCHEME.exec(value);
  if (!m) return [f("error", "web-scheme-missing")];
  const scheme = m[1].toLowerCase();
  if (scheme === "http") return [f("error", "web-http")];
  if (scheme === "https") return webUrl(value) ? [] : [f("error", "uri-bad")];
  if (field === "Encryption") {
    if (scheme === "dns") return value.length > 4 ? [] : [f("error", "uri-bad")];
    if (scheme === "openpgp4fpr") return /^openpgp4fpr:[0-9A-Fa-f]{40}$/.test(value) ? [] : [f("error", "fingerprint-bad")];
    return [f("error", "encryption-scheme")];
  }
  return [f("error", "web-scheme", { scheme })];
}

/* The address a file is served from, from what a person typed: a domain, a site address or the full file address. */
export function servedUrl(raw) {
  let v = oneLine(raw);
  if (!v) return "";
  if (!SCHEME.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (!u.hostname) return "";
    if (u.pathname === "/" || u.pathname === "") u.pathname = WELL_KNOWN;
    return normalizeUrl(u.href);
  } catch (_) { return ""; }
}

/* Compare addresses the way a browser would: scheme and host lower-case, default port dropped. */
export function normalizeUrl(s) {
  try { const u = new URL(s); u.hash = ""; return u.href; } catch (_) { return s; }
}

/* ------------------------------------------------------------------ the checker */

const LANG_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/* Check a security.txt. opts: {now (ms), url (optional address the file is served from)}.
   Returns {findings: [{level: "error"|"warn"|"info", code, params, line}], fields, signed, expires, errors, warnings, url}. */
export function checkSecurityTxt(text, opts = {}) {
  const now = opts.now ?? Date.now();
  const served = opts.url ? servedUrl(opts.url) : "";
  const findings = [];
  const add = (level, code, params = {}, line) => findings.push({ level, code, params, line });
  const read = readLines(text);
  if (read.bom) add("warn", "bom");
  for (const p of read.problems) add("error", p);
  if (read.signed === "ok") add("info", "pgp-signed");
  const { fields, bad } = parseFields(read.rows);
  if (!fields.length && !bad.length) {
    add("error", "empty");
    return finish(findings, fields, read.signed, null, served);
  }
  for (const b of bad) add("error", "bad-line", { text: b.text.slice(0, 60) }, b.line);
  const get = (key) => fields.filter((x) => x.key === key);

  for (const x of fields) {
    if (!KNOWN.has(x.key)) {
      if (x.key === "acknowledgements") add("warn", "spelling-ack", { name: x.name }, x.line);
      else add("warn", "unknown-field", { name: x.name }, x.line);
      continue;
    }
    if (!x.spaced) add("error", "no-space", { name: x.name }, x.line);
    if (!x.value) add("error", "empty-value", { name: x.name }, x.line);
  }

  const contacts = get("contact");
  if (!contacts.length) add("error", "no-contact");
  for (const c of contacts) if (c.value) findings.push(...contactFindings(c.value, c.line));

  const exps = get("expires");
  let expires = null;
  if (!exps.length) add("error", "no-expires");
  else {
    if (exps.length > 1) add("error", "multi-expires", {}, exps[1].line);
    const e = exps[0];
    if (e.value) {
      expires = parseRfc3339(e.value);
      if (expires === null) add("error", "expires-format", { value: e.value }, e.line);
      else if (expires <= now) add("error", "expires-past", { value: e.value }, e.line);
      else {
        if (expires > maxExpires(now)) add("warn", "expires-far", { value: e.value }, e.line);
        else if (expires - now < 30 * DAY) add("warn", "expires-soon", { value: e.value }, e.line);
      }
    }
  }

  const langs = get("preferred-languages");
  if (langs.length > 1) add("error", "multi-languages", {}, langs[1].line);
  for (const l of langs.slice(0, 1)) {
    if (!l.value) continue;
    for (const tag of l.value.split(",").map((s) => s.trim())) if (!LANG_TAG.test(tag)) add("error", "language-bad", { value: tag || "(empty)" }, l.line);
  }

  for (const [key, name] of [["acknowledgments", "Acknowledgments"], ["hiring", "Hiring"], ["policy", "Policy"], ["encryption", "Encryption"], ["canonical", "Canonical"]]) {
    for (const x of get(key)) if (x.value) findings.push(...webFindings(name, x.value, x.line));
  }

  const canon = get("canonical").filter((x) => x.value);
  if (!canon.length) add("info", "canonical-missing");
  else {
    for (const c of canon) {
      const u = webUrl(c.value);
      if (u && u.pathname !== WELL_KNOWN && u.pathname !== "/security.txt") add("warn", "canonical-path", { value: c.value }, c.line);
    }
    if (served && !canon.some((c) => normalizeUrl(c.value) === served)) add("error", "canonical-mismatch", { url: served });
  }
  if (read.signed === "none") add("info", "unsigned");
  return finish(findings, fields, read.signed, expires, served);
}

function finish(findings, fields, signed, expires, url) {
  const rank = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.level] - rank[b.level] || (a.line ?? 0) - (b.line ?? 0));
  return {
    findings, fields, signed, expires, url,
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warn").length,
  };
}
