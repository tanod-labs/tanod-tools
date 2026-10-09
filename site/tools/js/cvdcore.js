// Coordinated vulnerability disclosure (CVD) policy: builds a small document model from form values, then writes it as
// Markdown or HTML. Pure functions, no DOM. The wording goes through T = {tx, txn} (the page's translator; tests pass an
// English one), so the policy comes out in the page's language. It is a template, not legal advice.
import { normalizeContact, servedUrl, WELL_KNOWN } from "./securitytxtcore.js?v=11";

/* A document is a list of blocks: {t: "h1"|"h2", text}, {t: "p", parts}, {t: "ul", items: [parts]}.
   parts: an array of strings and {link, text} / {code} objects. */

const oneLine = (s) => String(s ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
const lines = (s) => String(s ?? "").split(/\r\n|\n|\r/).map(oneLine).filter(Boolean);
export const UNITS = ["hours", "business", "days"];

/* A part (a link) inside a translated sentence travels through tx() as a marker and is put back by P(). */
let registry = [];
const M = (part) => { registry.push(part); return `\u0001${registry.length - 1}\u0002`; };
function P(s) {
  const out = [];
  for (const piece of s.split(/(\u0001\d+\u0002)/)) {
    const m = /^\u0001(\d+)\u0002$/.exec(piece);
    if (m) out.push(registry[+m[1]]); else if (piece) out.push(piece);
  }
  return out;
}

function duration(T, n, unit) {
  const k = Math.max(1, Math.min(999, Math.round(Number(n)) || 1));
  if (unit === "hours") return T.txn(k, "{n} hour", "{n} hours");
  if (unit === "business") return T.txn(k, "{n} business day", "{n} business days");
  return T.txn(k, "{n} day", "{n} days");
}

/* One contact line as a part: an address or phone number or web address, linked when the scheme is safe. */
export function contactPart(raw) {
  const v = normalizeContact(raw);
  if (!v) return null;
  const m = /^(mailto|tel):(.*)$/i.exec(v);
  if (m) return { link: v, text: m[2].split("?")[0] };
  if (/^https:\/\//i.test(v)) return { link: v, text: v.replace(/^https:\/\//i, "") };
  return v;
}

export function buildPolicy(o, T) {
  registry = [];
  const org = oneLine(o.org) || T.tx("[your organisation]");
  const doc = [];
  const p = (parts) => doc.push({ t: "p", parts: Array.isArray(parts) ? parts : [parts] });
  const h2 = (text) => doc.push({ t: "h2", text });
  const ul = (items) => doc.push({ t: "ul", items: items.map((x) => (Array.isArray(x) ? x : [x])) });
  const contacts = lines(o.contact).map(contactPart).filter(Boolean);
  const updated = oneLine(o.updated);

  doc.push({ t: "h1", text: T.tx("Vulnerability disclosure policy") });
  if (updated) p(T.tx("Last updated: {date}", { date: updated }));
  p(T.tx("{org} takes the security of its products seriously. If you have found a weakness in one of them, we want to hear from you. This policy explains how to report it, what you can expect from us, and how we handle disclosure.", { org }));

  h2(T.tx("Scope"));
  p(T.tx("This policy covers the following products and services:"));
  const scope = lines(o.scope);
  ul(scope.length ? scope : [T.tx("[list your products and services here]")]);
  const out = lines(o.outOfScope);
  if (out.length) { p(T.tx("These are not covered by this policy:")); ul(out); }
  p(T.tx("Findings that need physical access to our premises or devices, social engineering of our staff or customers, or denial-of-service attacks are always out of scope."));

  h2(T.tx("How to report a vulnerability"));
  if (contacts.length === 1) p(P(T.tx("Please report it to {contact}.", { contact: M(contacts[0]) })));
  else {
    p(T.tx("Please report it using one of these:"));
    ul(contacts.length ? contacts : [T.tx("[add your security contact here]")]);
  }
  const txt = o.securityTxt ? servedUrl(o.site) : "";
  if (txt) p(P(T.tx("Our contact details are also published in our security.txt file: {link}", { link: M({ link: txt, text: txt.replace(/^https:\/\//, "") }) })));
  const key = oneLine(o.pgp);
  if (key && /^https:\/\//i.test(key)) p(P(T.tx("If you want to encrypt your report, use our public key: {link}", { link: M({ link: key, text: key.replace(/^https:\/\//i, "") }) })));
  p(T.tx("Please include, as far as you can:"));
  ul([
    T.tx("the product and version you tested;"),
    T.tx("a description of the weakness and the steps to reproduce it;"),
    T.tx("the impact you think it has;"),
    T.tx("any proof of concept, kept as small as possible;"),
    T.tx("how we can contact you, and whether you want to be credited."),
  ]);
  const langs = oneLine(o.languages);
  if (langs) p(T.tx("We can handle reports in: {languages}.", { languages: langs }));

  h2(T.tx("What you can expect from us"));
  const items = [
    T.tx("We will acknowledge your report within {time}.", { time: duration(T, o.ack?.n, o.ack?.unit) }),
    T.tx("We will tell you within {time} whether we consider it a vulnerability.", { time: duration(T, o.triage?.n, o.triage?.unit) }),
    T.tx("We aim to release a fix or a mitigation within {time} of confirming the problem, depending on its severity and complexity. If we need longer, we will tell you why.", { time: duration(T, o.fix?.n, o.fix?.unit) }),
    T.tx("We will keep you informed of our progress."),
  ];
  if (o.credit) items.push(T.tx("If you wish, we will credit you in our security advisory. Tell us if you prefer to stay anonymous."));
  if (o.noReward) items.push(T.tx("We do not run a bug bounty programme, so we cannot pay rewards."));
  ul(items);

  h2(T.tx("Rules for testing"));
  p(T.tx("Please follow these rules while you research:"));
  ul([
    T.tx("Only test the products and services in scope."),
    T.tx("Do not access, change or share other people's data beyond what you need to show the problem, and tell us at once if you reach personal data."),
    T.tx("Do not disrupt our services or our customers."),
    T.tx("Do not use social engineering, physical attacks or denial-of-service attacks."),
    T.tx("Give us a reasonable time to fix the problem before you tell anyone else."),
    T.tx("Do not ask for payment as a condition of reporting."),
  ]);

  if (o.safeHarbour) {
    h2(T.tx("Safe harbour"));
    p(T.tx("If you follow this policy and act in good faith, we will not take legal action against you for your research and will not ask the authorities to do so. If someone else starts legal action over research that followed this policy, we will say that you acted in line with it."));
    p(T.tx("This commitment covers our own products and systems. We cannot make promises on behalf of other companies or authorities."));
  }

  h2(T.tx("Coordinated disclosure"));
  const days = Math.max(1, Math.min(999, Math.round(Number(o.disclosureDays)) || 90));
  p(T.tx("We ask you to keep the details private until we have released a fix, or until {time} after your report, whichever comes first. If we both agree that more time is needed, for example for a complex fix, we can set a later date together. After the agreed date you are free to publish your findings.", { time: duration(T, days, "days") }));
  p(T.tx("When a fix is available we will publish a security advisory and, where appropriate, ask for a CVE identifier."));

  if (o.cra) {
    h2(T.tx("Reporting to the authorities"));
    p(T.tx("Under the EU Cyber Resilience Act we must report actively exploited vulnerabilities in our products, and severe security incidents, to the national CSIRT and to ENISA within strict deadlines, starting with an early warning within 24 hours. We may therefore share the technical details of a report with these bodies. We will not give them your name or contact details unless the law requires it or you agree."));
  }
  return doc;
}

/* ------------------------------------------------------------------ writers */

const mdText = (s) => String(s).replace(/[\\`*_[\]<>|]/g, "\\$&");
const mdStart = (s) => s.replace(/^([#>+-]|\d+[.)])/, "\\$1");

function mdParts(parts) {
  return mdStart(parts.map((x) => {
    if (typeof x === "string") return mdText(x);
    if (x.link) return `[${mdText(x.text)}](${x.link.replace(/[ ()<>]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())})`;
    return "`" + x.code + "`";
  }).join(""));
}

export function toMarkdown(doc, { comment = "" } = {}) {
  const out = [];
  if (comment) out.push(`<!-- ${comment.replace(/--+/g, "-")} -->`, "");
  for (const b of doc) {
    if (b.t === "h1") out.push("# " + mdText(b.text), "");
    else if (b.t === "h2") out.push("## " + mdText(b.text), "");
    else if (b.t === "p") out.push(mdParts(b.parts), "");
    else if (b.t === "ul") out.push(...b.items.map((it) => "- " + mdParts(it)), "");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

export const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Only these schemes become links; anything else is written as text. */
export const safeHref = (h) => /^(https:|mailto:|tel:)/i.test(h);

function htmlParts(parts) {
  return parts.map((x) => {
    if (typeof x === "string") return escHtml(x);
    if (x.link && safeHref(x.link)) return `<a href="${escHtml(x.link)}">${escHtml(x.text)}</a>`;
    if (x.link) return escHtml(x.text);
    return `<code>${escHtml(x.code)}</code>`;
  }).join("");
}

export function toHtml(doc, { comment = "", lang = "en", full = false, title = "" } = {}) {
  const body = [];
  if (comment) body.push(`<!-- ${comment.replace(/--+/g, "-")} -->`);
  body.push('<article class="vdp">');
  for (const b of doc) {
    if (b.t === "h1") body.push(`  <h1>${escHtml(b.text)}</h1>`);
    else if (b.t === "h2") body.push(`  <h2>${escHtml(b.text)}</h2>`);
    else if (b.t === "p") body.push(`  <p>${htmlParts(b.parts)}</p>`);
    else if (b.t === "ul") body.push("  <ul>", ...b.items.map((it) => `    <li>${htmlParts(it)}</li>`), "  </ul>");
  }
  body.push("</article>");
  if (!full) return body.join("\n") + "\n";
  return [
    "<!doctype html>", `<html lang="${escHtml(lang)}">`, "<head>", '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">', `<title>${escHtml(title)}</title>`,
    "<style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.75rem}h2{font-size:1.25rem;margin-top:2rem}a{color:#1636a3}</style>",
    "</head>", "<body>", ...body, "</body>", "</html>", "",
  ].join("\n");
}

export { WELL_KNOWN };
