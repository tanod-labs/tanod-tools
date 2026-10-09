// Unit tests for the Security & compliance tools' engines, run with plain node:
//   node ops/tools_site/check/unit/security.mjs
// utcdate, securitytxtcore (generator output and every checker rule, valid and invalid samples), cvdcore (policy model, Markdown and
// HTML writers, escaping) and cracore (the CRA Article 14 deadlines). Reference values are literals worked out by hand, not the
// code's own output. "now" is fixed so every date rule is deterministic.
import * as u from "../../../../site/tools/js/utcdate.js";
import * as st from "../../../../site/tools/js/securitytxtcore.js";
import * as cvd from "../../../../site/tools/js/cvdcore.js";
import * as cra from "../../../../site/tools/js/cracore.js";

let n = 0, bad = 0;
const eq = (a, b, msg) => {
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
};
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log(`FAIL ${msg}`); } };
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);            // 2026-10-09T12:00:00Z
const iso = u.isoUtc;

/* ------------------------------------------------------------------ utcdate */
eq(iso(Date.UTC(2027, 0, 31, 23, 59, 59)), "2027-01-31T23:59:59Z", "isoUtc");
eq(iso(Date.UTC(2026, 0, 5, 3, 4, 5)), "2026-01-05T03:04:05Z", "isoUtc pads");
eq(iso(u.addMonthsUTC(Date.UTC(2026, 0, 31, 10), 1)), "2026-02-28T10:00:00Z", "31 Jan + 1 month clamps to 28 Feb");
eq(iso(u.addMonthsUTC(Date.UTC(2028, 0, 31, 10), 1)), "2028-02-29T10:00:00Z", "31 Jan 2028 + 1 month is 29 Feb (leap)");
eq(iso(u.addMonthsUTC(Date.UTC(2026, 10, 30, 0), 1)), "2026-12-30T00:00:00Z", "30 Nov + 1 month");
eq(iso(u.addMonthsUTC(Date.UTC(2026, 11, 15, 8), 1)), "2027-01-15T08:00:00Z", "December rolls into January");
eq(iso(u.addMonthsUTC(Date.UTC(2028, 1, 29, 8), 12)), "2029-02-28T08:00:00Z", "29 Feb + 12 months clamps");
eq(iso(u.addMonthsUTC(Date.UTC(2026, 2, 31, 8), -1)), "2026-02-28T08:00:00Z", "negative months clamp");
eq(u.parseDay("2026-02-29"), null, "2026 is not a leap year");
eq(u.parseDay("2028-02-29"), Date.UTC(2028, 1, 29), "2028-02-29 exists");
eq(u.parseDay("2026-13-01"), null, "month 13");
eq(u.parseDay("2026-4-1"), null, "needs two digits");
eq(u.parseRfc3339("2027-12-31T23:59:59Z"), Date.UTC(2027, 11, 31, 23, 59, 59), "RFC 3339 Z");
eq(u.parseRfc3339("2027-12-31t23:59:59z"), Date.UTC(2027, 11, 31, 23, 59, 59), "RFC 3339 lower case t and z");
eq(u.parseRfc3339("2027-12-31T23:59:59+02:00"), Date.UTC(2027, 11, 31, 21, 59, 59), "RFC 3339 offset +02:00");
eq(u.parseRfc3339("2027-12-31T23:59:59-05:30"), Date.UTC(2028, 0, 1, 5, 29, 59), "RFC 3339 offset -05:30");
eq(u.parseRfc3339("2027-12-31T23:59:59.250Z"), Date.UTC(2027, 11, 31, 23, 59, 59), "fraction ignored");
for (const bad1 of ["2027-12-31", "2027-12-31 23:59:59Z", "2027-12-31T23:59:59", "2027-12-31T24:00:00Z", "2027-02-30T00:00:00Z", "2027-12-31T23:60:00Z", "31/12/2027", "", "2027-12-31T23:59:59+25:00"]) {
  eq(u.parseRfc3339(bad1), null, "invalid date-time " + JSON.stringify(bad1));
}

/* ------------------------------------------------------------------ security.txt: generator */
eq(st.normalizeContact("security@example.com"), "mailto:security@example.com", "email gets mailto:");
eq(st.normalizeContact("+49 30 123456"), "tel:+4930123456", "phone gets tel:");
eq(st.normalizeContact("+1 (201) 555-0123"), "tel:+1201555-0123", "phone keeps hyphens, drops spaces and brackets");
eq(st.normalizeContact("example.com/report"), "https://example.com/report", "bare address gets https");
eq(st.normalizeContact("http://example.com/report"), "http://example.com/report", "http is left for the checker");
eq(st.normalizeContact("mailto:a@b.co"), "mailto:a@b.co", "mailto kept");
eq(st.normalizeContact("   "), "", "blank");
eq(st.normalizeWeb("example.com"), "https://example.com", "web address gets https");
eq(st.normalizeWeb("openpgp4fpr:5f2de5521c63a801ab59ccb603d49de44b29100f"), "openpgp4fpr:5f2de5521c63a801ab59ccb603d49de44b29100f", "scheme kept");
eq(st.normalizeWeb("not a url"), "not a url", "words are left alone");

eq(iso(st.defaultExpires(T0)), "2027-10-08T23:59:59Z", "default expiry is the end of day 364 days away");
ok(st.defaultExpires(T0) <= st.maxExpires(T0), "default expiry is within a year");
eq(iso(st.maxExpires(T0)), "2027-10-09T12:00:00Z", "max expiry one calendar year on");
eq(iso(st.defaultExpires(Date.UTC(2027, 11, 31, 0, 0, 0))), "2028-12-29T23:59:59Z", "default expiry across a leap year");

const full = st.buildSecurityTxt({
  contact: "security@example.com\n+49 30 123456\nexample.com/report", expires: "2027-10-08", encryption: "example.com/key.asc",
  acknowledgments: "https://example.com/thanks", languages: "en, de", canonical: "example.com/.well-known/security.txt",
  policy: "https://example.com/policy", hiring: "https://example.com/jobs",
});
eq(full, [
  "Contact: mailto:security@example.com", "Contact: tel:+4930123456", "Contact: https://example.com/report",
  "Expires: 2027-10-08T23:59:59Z", "Encryption: https://example.com/key.asc", "Acknowledgments: https://example.com/thanks",
  "Preferred-Languages: en, de", "Canonical: https://example.com/.well-known/security.txt", "Policy: https://example.com/policy",
  "Hiring: https://example.com/jobs", "",
].join("\n"), "full file in the documented field order");
eq(st.buildSecurityTxt({ contact: "a@example.com", expires: "2027-10-08" }), "Contact: mailto:a@example.com\nExpires: 2027-10-08T23:59:59Z\n", "minimal file");
eq(st.buildSecurityTxt({ contact: "a@example.com\na@example.com\n\n", expires: Date.UTC(2027, 0, 1, 0, 0, 0) }), "Contact: mailto:a@example.com\nExpires: 2027-01-01T00:00:00Z\n", "duplicates and blanks dropped; a timestamp is used as is");
eq(st.buildSecurityTxt({ contact: "a@example.com", expires: "2027-10-08", languages: "en,de  fr, en" }), "Contact: mailto:a@example.com\nExpires: 2027-10-08T23:59:59Z\nPreferred-Languages: en, de, fr\n", "languages split on commas and spaces, deduplicated");
eq(st.buildSecurityTxt({ contact: "a@example.com", expires: "garbage" }), "Contact: mailto:a@example.com\n", "an invalid day writes no Expires");
eq(st.buildSecurityTxt({ policy: "https://x.example/p" }), "Policy: https://x.example/p\n", "fields without contact are still written");
eq(st.buildSecurityTxt({}), "", "nothing in, nothing out");
{ // a pasted value cannot add a field: line breaks inside one single-line value collapse
  const t = st.buildSecurityTxt({ contact: "a@example.com", expires: "2027-10-08", languages: "en\nContact: mailto:evil@example.com" });
  eq(t.split("\n").filter((l) => l.startsWith("Contact:")).length, 1, "no injected Contact line");
}
// everything the generator writes passes its own checker
for (const o of [
  { contact: "security@example.com", expires: "2027-10-01" },
  { contact: "a@b.example\nhttps://b.example/report\n+44 20 7946 0958", expires: "2027-09-30", encryption: "https://b.example/k.asc", acknowledgments: "b.example/thanks", languages: "en, pt-BR", canonical: "https://b.example/.well-known/security.txt", policy: "b.example/policy", hiring: "b.example/jobs" },
]) {
  const r = st.checkSecurityTxt(st.buildSecurityTxt(o), { now: T0 });
  eq([r.errors, r.warnings], [0, 0], "generated file has no errors or warnings: " + o.contact.split("\n")[0]);
}

/* ------------------------------------------------------------------ security.txt: checker */
const codes = (text, opts = {}) => st.checkSecurityTxt(text, { now: T0, ...opts }).findings.map((f) => f.code);
const level = (text, code, opts = {}) => (st.checkSecurityTxt(text, { now: T0, ...opts }).findings.find((f) => f.code === code) || {}).level;
const GOOD = "Contact: mailto:security@example.com\nExpires: 2027-06-30T23:59:59Z\n";

eq(codes(GOOD), ["canonical-missing", "unsigned"], "valid minimal file: only notes");
eq(st.checkSecurityTxt(GOOD, { now: T0 }).errors, 0, "valid file: no errors");
eq(st.checkSecurityTxt(GOOD, { now: T0 }).expires, Date.UTC(2027, 5, 30, 23, 59, 59), "expires parsed");
eq(codes("Contact: mailto:security@example.com\r\nExpires: 2027-06-30T23:59:59Z\r\n"), ["canonical-missing", "unsigned"], "CRLF line endings are fine");
eq(codes("# comment\n\ncontact: mailto:a@example.com\nEXPIRES: 2027-06-30T23:59:59Z\n"), ["canonical-missing", "unsigned"], "field names are case-insensitive; comments and blanks ignored");
eq(codes(""), ["empty"], "empty text");
eq(codes("   \n\n# only a comment\n"), ["empty"], "only comments is empty");

// Contact and Expires present
eq(codes("Expires: 2027-06-30T23:59:59Z\n"), ["no-contact", "canonical-missing", "unsigned"], "Contact missing");
eq(level("Expires: 2027-06-30T23:59:59Z\n", "no-contact"), "error", "missing Contact is an error");
eq(codes("Contact: mailto:a@example.com\n"), ["no-expires", "canonical-missing", "unsigned"], "Expires missing");
eq(level("Contact: mailto:a@example.com\n", "no-expires"), "error", "missing Expires is an error");
eq(codes(GOOD + "Expires: 2027-07-30T23:59:59Z\n").includes("multi-expires"), true, "Expires twice");
eq(level(GOOD + "Expires: 2027-07-30T23:59:59Z\n", "multi-expires"), "error", "Expires twice is an error");

// Expires: format, past, far, soon
eq(codes("Contact: mailto:a@example.com\nExpires: 2027-06-30\n").includes("expires-format"), true, "date only is not RFC 3339 date-time");
eq(codes("Contact: mailto:a@example.com\nExpires: 30 June 2027\n").includes("expires-format"), true, "free-form date");
eq(codes("Contact: mailto:a@example.com\nExpires: 2027-02-30T00:00:00Z\n").includes("expires-format"), true, "impossible day");
eq(level("Contact: mailto:a@example.com\nExpires: 2027-06-30\n", "expires-format"), "error", "format error level");
eq(codes("Contact: mailto:a@example.com\nExpires: 2026-10-09T11:59:59Z\n").includes("expires-past"), true, "one second in the past");
eq(level("Contact: mailto:a@example.com\nExpires: 2026-10-09T11:59:59Z\n", "expires-past"), "error", "expired is an error");
eq(codes("Contact: mailto:a@example.com\nExpires: 2026-10-09T12:00:00Z\n").includes("expires-past"), true, "exactly now counts as expired");
eq(codes("Contact: mailto:a@example.com\nExpires: 2026-10-09T12:00:01Z\n").includes("expires-past"), false, "one second ahead is not expired");
eq(codes("Contact: mailto:a@example.com\nExpires: 2027-10-09T12:00:00Z\n").includes("expires-far"), false, "exactly one year ahead is allowed");
eq(codes("Contact: mailto:a@example.com\nExpires: 2027-10-09T12:00:01Z\n").includes("expires-far"), true, "one second over a year");
eq(level("Contact: mailto:a@example.com\nExpires: 2030-01-01T00:00:00Z\n", "expires-far"), "warn", "over a year is a warning");
eq(codes("Contact: mailto:a@example.com\nExpires: 2026-10-30T00:00:00Z\n").includes("expires-soon"), true, "under 30 days");
eq(level("Contact: mailto:a@example.com\nExpires: 2026-10-30T00:00:00Z\n", "expires-soon"), "warn", "soon is a warning");
eq(codes("Contact: mailto:a@example.com\nExpires: 2026-11-30T00:00:00Z\n").includes("expires-soon"), false, "over 30 days is fine");
eq(codes("Contact: mailto:a@example.com\nExpires: 2027-06-30T23:59:59+02:00\n").includes("expires-format"), false, "numeric offset accepted");

// Contact URIs
const cc = (v) => codes(`Contact: ${v}\nExpires: 2027-06-30T23:59:59Z\n`).filter((c) => !["canonical-missing", "unsigned"].includes(c));
eq(cc("mailto:security@example.com"), [], "mailto valid");
eq(cc("mailto:security@example.com?subject=Report"), [], "mailto with a query is valid");
eq(cc("tel:+49-30-1234567"), [], "tel valid");
eq(cc("tel:+1.201.555.0123"), [], "tel with dots valid");
eq(cc("https://example.com/report"), [], "https valid");
eq(cc("security@example.com"), ["contact-scheme-missing"], "bare email needs mailto:");
eq(cc("example.com"), ["contact-scheme-missing"], "bare domain is not a URI");
eq(cc("mailto:not-an-address"), ["mailto-bad"], "mailto without @");
eq(cc("mailto:a@b"), ["mailto-bad"], "mailto without a dot in the domain");
eq(cc("mailto:a@example.com,b@example.com"), ["mailto-bad"], "two addresses in one Contact");
eq(cc("tel:abc"), ["tel-bad"], "tel with letters");
eq(cc("tel:+12"), ["tel-bad"], "tel too short");
eq(cc("tel:030123456"), ["tel-local"], "tel without country code");
eq(level("Contact: tel:030123456\nExpires: 2027-06-30T23:59:59Z\n", "tel-local"), "warn", "tel-local is a warning");
eq(cc("http://example.com/report"), ["web-http"], "http is refused for Contact");
eq(level("Contact: http://example.com/report\nExpires: 2027-06-30T23:59:59Z\n", "web-http"), "error", "http is an error");
eq(cc("https://"), ["uri-bad"], "https with no host");
eq(cc("mailto:a@example.com b"), ["uri-space"], "space in a URI");
eq(cc("xmpp:security@example.com"), ["contact-scheme-other"], "other schemes are a warning");
eq(level("Contact: xmpp:security@example.com\nExpires: 2027-06-30T23:59:59Z\n", "contact-scheme-other"), "warn", "other scheme level");
eq(cc("mailto:a@example.com") .length + cc("https://example.com/x").length, 0, "several valid Contacts");
eq(codes(GOOD + "Contact: http://example.com/x\n").includes("web-http"), true, "second Contact is checked too");

// web fields
const wf = (name, v) => codes(`${GOOD}${name}: ${v}\n`).filter((c) => !["canonical-missing", "unsigned"].includes(c));
for (const name of ["Policy", "Hiring", "Acknowledgments"]) {
  eq(wf(name, "https://example.com/x"), [], `${name} https valid`);
  eq(wf(name, "http://example.com/x"), ["web-http"], `${name} http refused`);
  eq(wf(name, "example.com/x"), ["web-scheme-missing"], `${name} needs a scheme`);
  eq(wf(name, "ftp://example.com/x"), ["web-scheme"], `${name} ftp refused`);
  eq(wf(name, "mailto:a@example.com"), ["web-scheme"], `${name} mailto refused`);
  eq(wf(name, "https://"), ["uri-bad"], `${name} empty host`);
}
eq(wf("Encryption", "https://example.com/key.asc"), [], "Encryption https");
eq(wf("Encryption", "dns:5d2d37ab76d47d36._openpgpkey.example.com?type=OPENPGPKEY"), [], "Encryption dns:");
eq(wf("Encryption", "openpgp4fpr:5f2de5521c63a801ab59ccb603d49de44b29100f"), [], "Encryption fingerprint");
eq(wf("Encryption", "openpgp4fpr:5f2de552"), ["fingerprint-bad"], "short fingerprint");
eq(wf("Encryption", "http://example.com/key.asc"), ["web-http"], "Encryption http refused");
eq(wf("Encryption", "ftp://example.com/key.asc"), ["encryption-scheme"], "Encryption ftp refused");
eq(wf("Encryption", "key.asc"), ["web-scheme-missing"], "Encryption without scheme");

// Preferred-Languages
const pl = (v) => codes(`${GOOD}Preferred-Languages: ${v}\n`).filter((c) => !["canonical-missing", "unsigned"].includes(c));
eq(pl("en, de, pt-BR, zh-Hant"), [], "language tags valid");
eq(pl("en"), [], "single tag");
eq(pl("english"), [], "any 2-8 letter subtag passes the tag shape");
eq(pl("en, 123"), ["language-bad"], "digits are not a language");
eq(pl("en,,de"), ["language-bad"], "empty entry");
eq(pl("en de"), ["language-bad"], "space-separated is wrong");
eq(codes(GOOD + "Preferred-Languages: en\nPreferred-Languages: de\n").includes("multi-languages"), true, "Preferred-Languages twice");
eq(level(GOOD + "Preferred-Languages: en\nPreferred-Languages: de\n", "multi-languages"), "error", "twice is an error");

// Canonical
const CAN = (v) => `${GOOD}Canonical: ${v}\n`;
eq(codes(CAN("https://example.com/.well-known/security.txt")), ["unsigned"], "Canonical present: no note about it");
eq(codes(CAN("https://example.com/.well-known/security.txt"), { url: "example.com" }), ["unsigned"], "Canonical matches a bare domain");
eq(codes(CAN("https://example.com/.well-known/security.txt"), { url: "https://EXAMPLE.com:443/.well-known/security.txt" }), ["unsigned"], "match ignores case and default port");
eq(codes(CAN("https://example.com/.well-known/security.txt"), { url: "https://example.com/.well-known/security.txt#top" }), ["unsigned"], "match ignores the fragment");
eq(codes(CAN("https://example.com/.well-known/security.txt"), { url: "other.example.org" }), ["canonical-mismatch", "unsigned"], "Canonical for another host");
eq(st.checkSecurityTxt(CAN("https://example.com/.well-known/security.txt"), { now: T0, url: "other.example.org" }).findings[0].level, "error", "mismatch is an error");
eq(st.checkSecurityTxt(CAN("https://example.com/.well-known/security.txt"), { now: T0, url: "other.example.org" }).findings[0].params.url, "https://other.example.org/.well-known/security.txt", "mismatch names the address compared");
eq(codes(CAN("https://example.com/.well-known/security.txt") + "Canonical: https://www.example.com/.well-known/security.txt\n", { url: "www.example.com" }), ["unsigned"], "any one Canonical may match");
eq(codes(CAN("https://example.com/security.txt")), ["unsigned"], "legacy /security.txt location accepted");
eq(codes(CAN("https://example.com/contact")), ["canonical-path", "unsigned"], "Canonical path warning");
eq(level(CAN("https://example.com/contact"), "canonical-path"), "warn", "path is a warning");
eq(codes(CAN("http://example.com/.well-known/security.txt")), ["web-http", "unsigned"], "Canonical over http");
eq(st.servedUrl("example.com"), "https://example.com/.well-known/security.txt", "served: domain");
eq(st.servedUrl("https://example.com/"), "https://example.com/.well-known/security.txt", "served: site root");
eq(st.servedUrl("https://example.com/security.txt"), "https://example.com/security.txt", "served: explicit path kept");
eq(st.servedUrl(""), "", "served: empty");

// unknown fields, spelling, lines
eq(codes(GOOD + "Foo: bar\n").filter((c) => c === "unknown-field"), ["unknown-field"], "unknown field");
eq(level(GOOD + "Foo: bar\n", "unknown-field"), "warn", "unknown field is a warning");
eq(st.checkSecurityTxt(GOOD + "Foo: bar\n", { now: T0 }).findings.find((f) => f.code === "unknown-field").params.name, "Foo", "unknown field names it");
eq(st.checkSecurityTxt(GOOD + "Foo: bar\n", { now: T0 }).findings.find((f) => f.code === "unknown-field").line, 3, "unknown field line number");
eq(codes(GOOD + "Acknowledgements: https://example.com/t\n").includes("spelling-ack"), true, "British spelling");
eq(codes(GOOD + "Foo: bar\nBar: baz\n").filter((c) => c === "unknown-field").length, 2, "each unknown field reported");
eq(codes(GOOD + "this is not a field\n").includes("bad-line"), true, "line without a colon");
eq(level(GOOD + "this is not a field\n", "bad-line"), "error", "bad line is an error");
eq(codes(GOOD + "Contact:mailto:b@example.com\n").includes("no-space"), true, "no space after the colon");
eq(level(GOOD + "Contact:mailto:b@example.com\n", "no-space"), "error", "no-space is an error");
eq(codes(GOOD + "Policy:\n").includes("empty-value"), true, "empty value");
eq(codes("﻿" + GOOD).includes("bom"), true, "byte order mark");
eq(codes("﻿" + GOOD).includes("no-contact"), false, "BOM does not hide the first field");

// signing
const SIGNED = [
  "-----BEGIN PGP SIGNED MESSAGE-----", "Hash: SHA512", "", "Contact: mailto:security@example.com", "Expires: 2027-06-30T23:59:59Z",
  "Canonical: https://example.com/.well-known/security.txt", "-----BEGIN PGP SIGNATURE-----", "", "iQEzBAEBCgAdFiEE", "=abcd", "-----END PGP SIGNATURE-----", "",
].join("\n");
eq(codes(SIGNED), ["pgp-signed"], "well-formed signed file");
eq(st.checkSecurityTxt(SIGNED, { now: T0 }).signed, "ok", "signed status ok");
eq(st.checkSecurityTxt(SIGNED, { now: T0 }).errors, 0, "signed file: no errors");
eq(codes(SIGNED.replace("Contact: mailto:security@example.com\n", "- Contact: mailto:security@example.com\n")), ["pgp-signed"], "dash-escaped lines are unescaped");
eq(codes(SIGNED.replace("Contact: mailto:security@example.com\n", "")).includes("no-contact"), true, "fields are read from inside the signed body");
eq(codes(SIGNED.replace("-----END PGP SIGNATURE-----", "")).includes("pgp-incomplete"), true, "missing END line");
eq(codes(SIGNED.replace("-----BEGIN PGP SIGNATURE-----", "")).includes("pgp-incomplete"), true, "missing signature block");
eq(st.checkSecurityTxt(SIGNED.replace("-----END PGP SIGNATURE-----", ""), { now: T0 }).signed, "broken", "broken signature status");
eq(codes(SIGNED + "Contact: mailto:late@example.com\n").includes("pgp-trailing"), true, "text after the signature");
eq(codes(GOOD + "-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----\n").includes("pgp-orphan"), true, "signature without a signed message");
eq(st.checkSecurityTxt(GOOD, { now: T0 }).signed, "none", "unsigned status");

// ordering and counts
{
  const r = st.checkSecurityTxt("Foo: x\nContact: http://a.example\n", { now: T0 });
  eq(r.findings.map((f) => f.level), ["error", "error", "warn", "info", "info"], "findings sorted error, warn, info");
  eq(r.findings.map((f) => f.level)[0], "error", "errors sort first");
  eq(r.errors + r.warnings + r.findings.filter((f) => f.level === "info").length, r.findings.length, "counts add up");
}

/* ------------------------------------------------------------------ CVD policy */
const TT = {
  tx: (k, v) => k.replace(/\{(\w+)\}/g, (m, name) => (v && name in v ? v[name] : m)),
  txn: (c, one, other) => (c === 1 ? one : other).replace("{n}", String(c)),
};
const base = {
  org: "Acme GmbH", scope: "Acme App\nAcme API", outOfScope: "", contact: "security@acme.example", site: "acme.example", securityTxt: true, pgp: "https://acme.example/key.asc",
  languages: "English, German", ack: { n: 2, unit: "business" }, triage: { n: 5, unit: "business" }, fix: { n: 90, unit: "days" },
  safeHarbour: true, disclosureDays: 90, credit: true, noReward: true, cra: true, updated: "2026-10-09",
};
const heads = (doc) => doc.filter((b) => b.t === "h2").map((b) => b.text);
const textOf = (doc) => JSON.stringify(doc);
const doc = cvd.buildPolicy(base, TT);
eq(doc[0], { t: "h1", text: "Vulnerability disclosure policy" }, "policy title");
eq(heads(doc), ["Scope", "How to report a vulnerability", "What you can expect from us", "Rules for testing", "Safe harbour", "Coordinated disclosure", "Reporting to the authorities"], "sections in order");
ok(textOf(doc).includes("Acme GmbH takes the security of its products seriously"), "organisation named");
ok(textOf(doc).includes("within 2 business days"), "acknowledge time with its unit");
ok(textOf(doc).includes("within 5 business days"), "triage time");
ok(textOf(doc).includes("within 90 days of confirming"), "fix target");
ok(textOf(doc).includes("until 90 days after your report"), "disclosure timeline");
ok(textOf(doc).includes("We can handle reports in: English, German."), "languages");
ok(textOf(doc).includes('"link":"mailto:security@acme.example","text":"security@acme.example"'), "contact becomes a mailto link");
ok(textOf(doc).includes('"link":"https://acme.example/.well-known/security.txt"'), "link to security.txt on the site");
ok(textOf(doc).includes('"link":"https://acme.example/key.asc"'), "public key link");
ok(textOf(doc).includes("Last updated: 2026-10-09"), "date");
eq(heads(cvd.buildPolicy({ ...base, safeHarbour: false }, TT)).includes("Safe harbour"), false, "safe harbour off removes the section");
ok(!textOf(cvd.buildPolicy({ ...base, safeHarbour: false }, TT)).includes("legal action"), "safe harbour off removes the promise");
eq(heads(cvd.buildPolicy({ ...base, cra: false }, TT)).includes("Reporting to the authorities"), false, "CRA note off");
ok(!textOf(cvd.buildPolicy({ ...base, credit: false }, TT)).includes("credit you"), "credit off");
ok(!textOf(cvd.buildPolicy({ ...base, noReward: false }, TT)).includes("bug bounty"), "no-reward statement off");
ok(!textOf(cvd.buildPolicy({ ...base, securityTxt: false }, TT)).includes("security.txt"), "no security.txt link when unticked");
ok(!textOf(cvd.buildPolicy({ ...base, pgp: "" }, TT)).includes("public key"), "no key sentence without a key");
ok(!textOf(cvd.buildPolicy({ ...base, pgp: "javascript:alert(1)" }, TT)).includes("javascript"), "a non-https key address is dropped");
ok(!textOf(cvd.buildPolicy({ ...base, languages: "" }, TT)).includes("We can handle reports in"), "no languages sentence when empty");
ok(textOf(cvd.buildPolicy({ ...base, ack: { n: 1, unit: "hours" } }, TT)).includes("within 1 hour."), "singular unit");
ok(textOf(cvd.buildPolicy({ ...base, ack: { n: 24, unit: "hours" } }, TT)).includes("within 24 hours."), "plural unit");
ok(textOf(cvd.buildPolicy({ ...base, disclosureDays: 1 }, TT)).includes("until 1 day after"), "one-day timeline");
ok(textOf(cvd.buildPolicy({ ...base, disclosureDays: "" }, TT)).includes("until 90 days after"), "empty timeline falls back to 90");
ok(textOf(cvd.buildPolicy({ ...base, disclosureDays: 5000 }, TT)).includes("until 999 days after"), "timeline capped");
ok(textOf(cvd.buildPolicy({ ...base, org: "" }, TT)).includes("[your organisation] takes"), "placeholder organisation");
ok(textOf(cvd.buildPolicy({ ...base, scope: "" }, TT)).includes("[list your products and services here]"), "placeholder scope");
{
  const two = cvd.buildPolicy({ ...base, contact: "security@acme.example\nhttps://acme.example/report" }, TT);
  ok(textOf(two).includes("Please report it using one of these:"), "several contacts become a list");
  const one = textOf(cvd.buildPolicy(base, TT));
  ok(one.includes("Please report it to "), "one contact is a sentence");
}
{
  const out = cvd.buildPolicy({ ...base, outOfScope: "Third-party sites" }, TT);
  ok(textOf(out).includes("These are not covered by this policy:") && textOf(out).includes("Third-party sites"), "out of scope list");
}
eq(cvd.contactPart("a@b.example"), { link: "mailto:a@b.example", text: "a@b.example" }, "contactPart mail");
eq(cvd.contactPart("+49 30 1"), { link: "tel:+49301", text: "+49301" }, "contactPart tel");
eq(cvd.contactPart("https://x.example/r"), { link: "https://x.example/r", text: "x.example/r" }, "contactPart https");
eq(cvd.contactPart(""), null, "contactPart empty");
eq(cvd.contactPart("http://x.example/r"), "http://x.example/r", "contactPart http is plain text, not a link");

// Markdown
const md = cvd.toMarkdown(doc, { comment: "Template" });
ok(md.startsWith("<!-- Template -->\n\n# Vulnerability disclosure policy\n\nLast updated: 2026-10-09\n"), "markdown starts with the comment and title");
ok(md.includes("\n## Scope\n\nThis policy covers the following products and services:\n\n- Acme App\n- Acme API\n"), "markdown list");
ok(md.includes("[security@acme.example](mailto:security@acme.example)"), "markdown link");
ok(md.endsWith("\n") && !md.endsWith("\n\n"), "markdown ends with one newline");
eq(md.includes("<script"), false, "no script");
{
  const nasty = cvd.toMarkdown(cvd.buildPolicy({ ...base, org: "# *Evil* _Co_ [x](y) <b>", scope: "- item with `code` | pipe\n1. numbered" }, TT));
  ok(nasty.includes("\\# \\*Evil\\* \\_Co\\_ \\[x\\](y) \\<b\\>"), "organisation name is escaped in Markdown");
  ok(nasty.includes("- \\- item with \\`code\\` \\| pipe") && nasty.includes("- \\1. numbered"), "list items cannot nest or number");
  const link = cvd.toMarkdown([{ t: "p", parts: [{ link: "https://x.example/a(b) c", text: "t" }] }]);
  eq(link, "[t](https://x.example/a%28b%29%20c)\n", "link target is encoded");
}
eq(cvd.toMarkdown([{ t: "p", parts: ["5. not a list"] }]), "\\5. not a list\n", "a paragraph cannot start a list");
eq(cvd.toMarkdown([{ t: "p", parts: ["x"] }], { comment: "a -- b --> c" }), "<!-- a - b -> c -->\n\nx\n", "comment cannot close itself");

// HTML
const html = cvd.toHtml(doc, { comment: "Template" });
ok(html.startsWith("<!-- Template -->\n<article class=\"vdp\">\n  <h1>Vulnerability disclosure policy</h1>"), "html fragment start");
ok(html.includes("<li>Acme App</li>"), "html list item");
ok(html.includes('<a href="mailto:security@acme.example">security@acme.example</a>'), "html link");
ok(html.endsWith("</article>\n"), "html fragment end");
{
  const bad = cvd.toHtml(cvd.buildPolicy({ ...base, org: '<img src=x onerror=alert(1)> & "q" \'s\'', scope: "<script>alert(1)</script>" }, TT));
  ok(!bad.includes("<img") && !bad.includes("<script"), "tags in input are escaped in HTML");
  ok(bad.includes("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;s&#39;"), "entities written");
  const js = cvd.toHtml([{ t: "p", parts: [{ link: "javascript:alert(1)", text: "click" }] }]);
  eq(js.includes("href"), false, "javascript: is never an href");
  ok(js.includes("<p>click</p>"), "unsafe link keeps its text");
  eq(cvd.toHtml([{ t: "p", parts: [{ link: "http://x.example", text: "t" }] }]).includes("href"), false, "http links are not written as links");
}
const page = cvd.toHtml(doc, { lang: "de", full: true, title: 'A "title"' });
ok(page.startsWith('<!doctype html>\n<html lang="de">'), "full page doctype and language");
ok(page.includes("<title>A &quot;title&quot;</title>") && page.includes('<meta charset="utf-8">') && page.includes("</html>\n"), "full page head and end");
eq(cvd.escHtml("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&#39;", "escHtml");

/* ------------------------------------------------------------------ CRA clock */
const A = Date.UTC(2026, 9, 9, 12, 0, 0);
const dv = cra.deadlines("vulnerability", A);
eq(dv.map((d) => d.stage), ["early", "notification", "final"], "three stages");
eq(iso(dv[0].at), "2026-10-10T12:00:00Z", "vulnerability: early warning +24 h");
eq(iso(dv[1].at), "2026-10-12T12:00:00Z", "vulnerability: notification +72 h");
eq([dv[2].at, dv[2].basis], [null, "fix-pending"], "vulnerability: final report open until a fix exists");
const dvf = cra.deadlines("vulnerability", A, { fixAt: Date.UTC(2026, 9, 20, 8, 30, 0) });
eq([iso(dvf[2].at), dvf[2].basis], ["2026-11-03T08:30:00Z", "fix"], "vulnerability: final report 14 days after the fix");
const di = cra.deadlines("incident", A);
eq(iso(di[0].at), "2026-10-10T12:00:00Z", "incident: early warning +24 h");
eq(iso(di[1].at), "2026-10-12T12:00:00Z", "incident: notification +72 h");
eq([iso(di[2].at), di[2].basis], ["2026-11-12T12:00:00Z", "notification-deadline"], "incident: one month after the latest notification time");
const dif = cra.deadlines("incident", A, { notifiedAt: Date.UTC(2026, 9, 11, 9, 0, 0) });
eq([iso(dif[2].at), dif[2].basis], ["2026-11-11T09:00:00Z", "notified"], "incident: one month after the actual notification");
eq(iso(cra.deadlines("incident", Date.UTC(2026, 11, 29, 10, 0, 0))[2].at), "2027-02-01T10:00:00Z", "incident across year end: 1 Jan 10:00 + 1 month = 1 Feb");
eq(iso(cra.deadlines("incident", Date.UTC(2027, 0, 26, 10, 0, 0))[2].at), "2027-02-28T10:00:00Z", "incident: 29 Jan + 1 month clamps to 28 Feb");
eq(iso(cra.deadlines("vulnerability", Date.UTC(2026, 10, 1, 0, 0, 0))[1].at), "2026-11-04T00:00:00Z", "hours are elapsed time across a month end");
eq(iso(cra.deadlines("vulnerability", Date.UTC(2026, 9, 24, 23, 0, 0), { fixAt: Date.UTC(2026, 9, 25, 1, 0, 0) })[2].at), "2026-11-08T01:00:00Z", "14 days are exactly 336 hours, even over the clock change in Europe");
{ let msg = ""; try { cra.deadlines("other", A); } catch (e) { msg = e.message; } eq(msg, "unknown kind other", "unknown kind refused"); }
{ let msg = ""; try { cra.deadlines("incident", NaN); } catch (e) { msg = e.message; } eq(msg, "aware time needed", "missing time refused"); }
eq(cra.deadlines("vulnerability", A, { fixAt: NaN })[2].basis, "fix-pending", "NaN fix time counts as not set");

eq(cra.parseUtcLocal("2026-10-09T12:00"), A, "datetime-local as UTC");
eq(cra.parseUtcLocal("2026-10-09T12:00:30"), A + 30000, "with seconds");
eq(cra.parseUtcLocal("2026-10-09 12:00"), A, "space separator");
for (const b of ["", "2026-10-09", "2026-10-09T25:00", "2026-02-30T10:00", "2026-10-09T12:60", "tomorrow"]) eq(cra.parseUtcLocal(b), null, "invalid datetime-local " + JSON.stringify(b));

const r1 = cra.remaining(A + 26 * 3600000 + 61000, A);
eq([r1.overdue, r1.days, r1.hours, r1.minutes, r1.seconds], [false, 1, 2, 1, 1], "remaining: 1 d 2 h 1 min 1 s");
const r2 = cra.remaining(A, A + 90061000);
eq([r2.overdue, r2.days, r2.hours, r2.minutes, r2.seconds], [true, 1, 1, 1, 1], "overdue: 1 d 1 h 1 min 1 s");
eq(cra.remaining(A, A).overdue, false, "exactly at the deadline is not yet overdue");
eq(cra.remaining(A + 59999, A).minutes, 0, "under a minute");

eq(Object.keys(cra.CONTENTS), ["vulnerability", "incident"], "checklists for both kinds");
eq(cra.CONTENTS.vulnerability.early, ["v-exploited", "v-states"], "vulnerability early warning contents");
eq(cra.CONTENTS.vulnerability.final, ["v-description", "v-actor", "v-update"], "vulnerability final report contents");
eq(cra.CONTENTS.incident.early, ["i-severe", "i-malicious"], "incident early warning contents");
eq(cra.CONTENTS.incident.final, ["i-description", "i-cause", "i-mitigation"], "incident final report contents");
eq(cra.STAGES.every((s) => cra.CONTENTS.vulnerability[s].length && cra.CONTENTS.incident[s].length), true, "every stage has items");

console.log(`${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
