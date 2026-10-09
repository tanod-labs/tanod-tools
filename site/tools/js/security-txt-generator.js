import { $, el, copyText, debounce, tx, txn } from "./core.js?v=11";
import { dateUtc, parseDay } from "./utcdate.js?v=11";
import { buildSecurityTxt, checkSecurityTxt, defaultExpires, maxExpires } from "./securitytxtcore.js?v=11";

const DAY = 86400000;
const gen = {
  contact: $("#stx-contact"), expires: $("#stx-expires"), enc: $("#stx-enc"), ack: $("#stx-ack"), lang: $("#stx-lang"),
  canon: $("#stx-canon"), pol: $("#stx-pol"), hire: $("#stx-hire"),
};
const out = $("#stx-out"), genList = $("#stx-gen-list"), expHelp = $("#stx-exp-h");
const input = $("#stx-in"), urlIn = $("#stx-url"), sum = $("#stx-sum"), list = $("#stx-list");

/* One sentence per finding code. Every message is a literal tx() call so the build can find and translate it. */
function say(f) {
  const p = f.params || {};
  switch (f.code) {
    case "empty": return tx("The text is empty. Paste the contents of your security.txt.");
    case "bom": return tx("The file starts with a byte order mark (BOM). Save it as UTF-8 without a BOM, or the first field name may not be read.");
    case "pgp-incomplete": return tx("The file starts a signed message, but the OpenPGP signature block is missing or incomplete.");
    case "pgp-trailing": return tx("There is text after the end of the OpenPGP signature. Remove it.");
    case "pgp-orphan": return tx("There is an OpenPGP signature block but no \"BEGIN PGP SIGNED MESSAGE\" line before the text. A signed file must be a cleartext-signed message (gpg --clearsign).");
    case "pgp-signed": return tx("The file is an OpenPGP cleartext-signed message. This page does not verify the signature; check it with gpg --verify.");
    case "unsigned": return tx("Not signed. Signing with OpenPGP is optional but recommended (gpg --clearsign security.txt).");
    case "bad-line": return tx("This line is not a field, a comment or blank: \"{text}\". Each line must look like Field-Name: value, or start with #.", p);
    case "unknown-field": return tx("Unknown field \"{name}\". Readers ignore fields they do not know, so it has no effect.", p);
    case "spelling-ack": return tx("\"{name}\" is spelled \"Acknowledgments\" in RFC 9116, so tools will ignore this line.", p);
    case "no-space": return tx("Put a space after the colon in \"{name}:\".", p);
    case "empty-value": return tx("\"{name}\" has no value.", p);
    case "no-contact": return tx("Contact is missing. Add at least one: an email address as mailto:, a phone number as tel:, or an https:// page.");
    case "contact-scheme-missing": return tx("The Contact \"{value}\" is not a URI. Write an email address as mailto:you@example.com.", p);
    case "uri-space": return tx("\"{value}\" contains a space, so it is not a valid URI.", p);
    case "mailto-bad": return tx("\"{value}\" is not a valid mailto: address.", p);
    case "tel-bad": return tx("\"{value}\" is not a valid tel: number. Use the international form, for example tel:+49-30-1234567.", p);
    case "tel-local": return tx("\"{value}\" has no country code. Start phone numbers with + and the country code.", p);
    case "web-http": return tx("{field} uses http://. RFC 9116 requires https:// for web addresses.", p);
    case "uri-bad": return tx("\"{value}\" is not a valid https:// address.", p);
    case "contact-scheme-other": return tx("Contact uses the {scheme}: scheme. RFC 9116 names mailto:, tel: and https:, and readers may not follow other schemes.", p);
    case "web-scheme-missing": return tx("{field} must be an https:// address, but \"{value}\" has no scheme.", p);
    case "web-scheme": return tx("{field} must be an https:// address, not {scheme}:.", p);
    case "fingerprint-bad": return tx("An openpgp4fpr: value is the 40-character key fingerprint without spaces.");
    case "encryption-scheme": return tx("Encryption must be an https:// address, a dns: record or an openpgp4fpr: fingerprint.");
    case "no-expires": return tx("Expires is missing. RFC 9116 requires it.");
    case "multi-expires": return tx("Expires appears more than once. It must appear exactly once.");
    case "expires-format": return tx("Expires \"{value}\" is not a date and time in the form 2027-12-31T23:59:59Z.", p);
    case "expires-past": return tx("The file expired on {value}. Readers are told to ignore it. Set a new date.", p);
    case "expires-far": return tx("Expires {value} is more than a year away. RFC 9116 recommends less than a year, so readers can trust that the file is kept up to date.", p);
    case "expires-soon": return tx("Expires {value} is less than 30 days away. Plan to renew it.", p);
    case "multi-languages": return tx("Preferred-Languages appears more than once. List all languages on one line, separated by commas.");
    case "language-bad": return tx("\"{value}\" is not a language tag. Use codes such as en, de or pt-BR.", p);
    case "canonical-missing": return tx("No Canonical field. It is optional, but recommended so readers can confirm where the file belongs, especially for signed files.");
    case "canonical-path": return tx("Canonical \"{value}\" does not end in /.well-known/security.txt.", p);
    case "canonical-mismatch": return tx("None of the Canonical addresses matches the address you serve the file from ({url}). Readers may distrust a file that is not served where it says it is.", p);
    default: return f.code;
  }
}

const LEVEL = () => ({ error: tx("Error"), warn: tx("Warning"), info: tx("Note") });

function renderFindings(ul, findings) {
  const names = LEVEL();
  ul.replaceChildren(...findings.map((f) => el("li", { class: "stx-f stx-f--" + f.level },
    el("strong", { class: "stx-f__tag" }, names[f.level]),
    f.line ? el("span", { class: "stx-f__line" }, tx("Line {n}", { n: f.line })) : null,
    el("span", { class: "stx-f__msg" }, say(f)))));
}

/* ------------------------------------------------------------------ generator */

function readForm() {
  return {
    contact: gen.contact.value, expires: gen.expires.value.trim(), encryption: gen.enc.value, acknowledgments: gen.ack.value,
    languages: gen.lang.value, canonical: gen.canon.value, policy: gen.pol.value, hiring: gen.hire.value,
  };
}

function expiryHelp() {
  const day = parseDay(gen.expires.value.trim());
  expHelp.classList.remove("is-on");
  if (day === null) { expHelp.textContent = tx("Choose a date."); return; }
  const end = day + DAY - 1000, now = Date.now();
  if (end <= now) { expHelp.textContent = tx("Check: this date has already passed."); expHelp.classList.add("is-on"); return; }
  if (end > maxExpires(now)) { expHelp.textContent = tx("Check: this is more than a year away. RFC 9116 recommends less than a year."); expHelp.classList.add("is-on"); return; }
  const left = Math.round((end - now) / DAY);
  expHelp.textContent = txn(left, "Valid for another {n} day.", "Valid for another {n} days.");
}

function refreshGen() {
  const o = readForm();
  out.value = buildSecurityTxt(o);
  expiryHelp();
  const r = checkSecurityTxt(out.value, { now: Date.now() });
  renderFindings(genList, r.findings.filter((f) => !(f.code === "canonical-missing")));
  $("#stx-copy").disabled = $("#stx-dl").disabled = !out.value;
}

for (const k of Object.keys(gen)) gen[k].addEventListener("input", refreshGen);
$("#stx-copy").addEventListener("click", (e) => copyText(out.value, e.currentTarget));
$("#stx-dl").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([out.value], { type: "text/plain;charset=utf-8" }));
  const a = el("a", { href: url, download: "security.txt" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

/* ------------------------------------------------------------------ checker */

function refreshCheck() {
  const text = input.value;
  if (!text.trim()) {
    sum.textContent = tx("Paste a security.txt above to check it.");
    list.replaceChildren();
    return;
  }
  const r = checkSecurityTxt(text, { now: Date.now(), url: urlIn.value });
  const e = txn(r.errors, "{n} error", "{n} errors"), w = txn(r.warnings, "{n} warning", "{n} warnings");
  sum.textContent = r.errors || r.warnings ? tx("Found {errors} and {warnings}.", { errors: e, warnings: w }) : tx("No errors or warnings. The file follows RFC 9116.");
  sum.classList.toggle("tt__err", r.errors > 0);
  renderFindings(list, r.findings);
}

input.addEventListener("input", debounce(refreshCheck, 150));
urlIn.addEventListener("input", debounce(refreshCheck, 150));
$("#stx-clear").addEventListener("click", () => { input.value = ""; refreshCheck(); input.focus(); });
$("#stx-example").addEventListener("click", () => {
  const now = Date.now();
  input.value = buildSecurityTxt({ contact: "security@example.com\nhttps://example.com/report", expires: dateUtc(defaultExpires(now)), encryption: "https://example.com/pgp-key.txt", languages: "en, de", canonical: "https://example.com/.well-known/security.txt", policy: "https://example.com/disclosure-policy" });
  urlIn.value = "example.com";
  refreshCheck();
});

gen.expires.value = dateUtc(defaultExpires(Date.now()));
refreshGen();
refreshCheck();
