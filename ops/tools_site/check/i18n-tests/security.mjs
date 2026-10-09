// Localized runs of the Security & compliance tools, in every language by i18n.mjs: the findings, hints, policy text and
// checklists come from the page's language table; times and numbers follow the locale; the generated files keep their fixed
// English field names. i18n.mjs adds the string-table and leftover-English checks to each.
const q = JSON.stringify;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const plural = (t, v, n) => (typeof v === "object" ? v[new Intl.PluralRules(t.lang).select(n)] ?? v.other : v);
const flat = (s) => String(s).replace(/\s+/g, " ").trim();
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.replace(/\\s+/g, " ").trim()`);
const val = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).value`);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default [
  {
    page: "security-txt-generator",
    name: "security.txt: findings, summary and hints in the page language; the generated file keeps RFC 9116 field names",
    async run(t) {
      await t.page.setValue("#stx-contact", "security@example.com");
      await t.page.setValue("#stx-expires", day(200));
      const out = await val(t, "#stx-out");
      t.assert(out.startsWith("Contact: mailto:security@example.com\nExpires: "), "file text is not translated");
      const left = Math.round((Date.parse(day(200) + "T23:59:59Z") - Date.now()) / 86400000);
      t.eq(flat(await txt(t, "#stx-exp-h")), flat(fill(plural(t, await t.tx("Valid for another {n} day.|Valid for another {n} days."), left), { n: t.num(left) })), "expiry hint with a plural");
      await t.page.setValue("#stx-in", "Contact: http://example.com/x\nContact: security@example.com\nExpires: 2020-01-01T00:00:00Z\nFoo: bar\n");
      await t.page.waitFor(`document.querySelectorAll("#stx-list li").length > 3`);
      const errs = fill(plural(t, await t.tx("{n} error|{n} errors"), 3), { n: t.num(3) });
      const warns = fill(plural(t, await t.tx("{n} warning|{n} warnings"), 1), { n: t.num(1) });
      t.eq(flat(await txt(t, "#stx-sum")), flat(fill(await t.tx("Found {errors} and {warnings}."), { errors: errs, warnings: warns })), "summary with plural counts");
      const items = await t.page.eval(`[...document.querySelectorAll("#stx-list li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
      const has = (s) => items.some((i) => i.includes(flat(s)));
      t.assert(has(fill(await t.tx("{field} uses http://. RFC 9116 requires https:// for web addresses."), { field: "Contact" })), "http message");
      t.assert(has(fill(await t.tx("The Contact \"{value}\" is not a URI. Write an email address as mailto:you@example.com."), { value: "security@example.com" })), "scheme message");
      t.assert(has(fill(await t.tx("The file expired on {value}. Readers are told to ignore it. Set a new date."), { value: "2020-01-01T00:00:00Z" })), "expired message");
      t.assert(has(fill(await t.tx("Unknown field \"{name}\". Readers ignore fields they do not know, so it has no effect."), { name: "Foo" })), "unknown field message");
      const lineLabel = fill(await t.tx("Line {n}"), { n: t.num(1) });
      t.assert(items.some((i) => i.includes(lineLabel)), "line label");
      t.assert(items[0].startsWith(await t.tx("Error")), "error tag first");
      await t.page.click("#stx-example");
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.includes(${q(flat(await t.tx("No errors or warnings. The file follows RFC 9116.")))})`);
    },
  },
  {
    page: "vulnerability-disclosure-policy-generator",
    name: "policy: the generated policy, its headings and durations come out in the page language; HTML page carries the language",
    async run(t) {
      await t.page.setValue("#vd-org", "Acme GmbH");
      await t.page.setValue("#vd-scope", "Acme App");
      await t.page.setValue("#vd-contact", "security@acme.example");
      await t.page.setValue("#vd-site", "acme.example");
      await t.page.setValue("#vd-date", "2026-10-09");
      await t.page.waitFor(`document.querySelector("#vd-md").value.includes("Acme GmbH") && document.querySelector("#vd-md").value.includes("2026-10-09")`);
      const md = await val(t, "#vd-md");
      const title = await t.tx("Vulnerability disclosure policy");
      t.assert(md.includes("# " + title.replace(/[\\`*_[\]<>|]/g, "\\$&")), "policy title");
      const heads = ["Scope", "How to report a vulnerability", "What you can expect from us", "Rules for testing", "Safe harbour", "Coordinated disclosure", "Reporting to the authorities"];
      for (const h of heads) t.assert(md.includes("\n## " + (await t.tx(h)).replace(/[\\`*_[\]<>|]/g, "\\$&") + "\n"), "heading " + h);
      const two = fill(plural(t, await t.tx("{n} business day|{n} business days"), 2), { n: t.num(2) });
      t.assert(md.includes(two), "duration with its plural form: " + two);
      const ninety = fill(plural(t, await t.tx("{n} day|{n} days"), 90), { n: t.num(90) });
      t.assert(md.includes(ninety), "90 days: " + ninety);
      t.assert(md.includes(fill(await t.tx("{org} takes the security of its products seriously. If you have found a weakness in one of them, we want to hear from you. This policy explains how to report it, what you can expect from us, and how we handle disclosure."), { org: "Acme GmbH" })), "intro sentence");
      t.assert(md.includes("[security@acme.example](mailto:security@acme.example)"), "mailto link");
      t.assert(md.includes("(https://acme.example/.well-known/security.txt)"), "security.txt link");
      t.assert(md.includes(fill(await t.tx("Last updated: {date}"), { date: "2026-10-09" })), "date line");
      const { bytes } = await t.dl("#vd-dl-html");
      const page = Buffer.from(bytes).toString("utf8");
      t.assert(page.startsWith(`<!doctype html>\n<html lang="${t.lang}">`), "downloaded page declares the language");
      t.assert(page.includes(`<title>${title.replace(/&/g, "&amp;")}</title>`), "page title");
    },
  },
  {
    page: "cra-incident-clock",
    name: "CRA clock: stage names, rules, dates in the locale, countdown wording and checklist items in the page language",
    async run(t) {
      await t.page.eval(`(() => { const u = document.querySelector("#cl-utc"); if (!u.checked) u.click(); return true; })()`);
      await t.page.setValue("#cl-aware", "2026-10-09T12:00");
      const full = (ms) => flat(new Intl.DateTimeFormat(t.lang, { dateStyle: "full", timeStyle: "long", timeZone: "UTC" }).format(ms));
      const A = Date.UTC(2026, 9, 9, 12);
      const s1 = flat(await txt(t, ".cl-stage:nth-child(1)")), s2 = flat(await txt(t, ".cl-stage:nth-child(2)")), s3 = flat(await txt(t, ".cl-stage:nth-child(3)"));
      t.assert(s1.includes(flat(await t.tx("Early warning"))) && s1.includes(flat(await t.tx("Within 24 hours of becoming aware."))), "stage 1 text");
      t.assert(s2.includes(flat(await t.tx("Notification"))) && s2.includes(flat(await t.tx("Within 72 hours of becoming aware."))), "stage 2 text");
      t.assert(s3.includes(flat(await t.tx("No later than 14 days after a fix or mitigation is available."))) && s3.includes(flat(await t.tx("Not set yet. Enter the time a fix or mitigation became available."))), "stage 3 text");
      t.assert(s1.includes(full(A + 24 * 3600000)), "24 h date in the locale: " + full(A + 24 * 3600000) + " in " + s1);
      t.assert(s2.includes(full(A + 72 * 3600000)), "72 h date in the locale");
      t.assert(s1.includes(flat(await t.tx("That a vulnerability in your product is being actively exploited."))), "early warning item");
      t.assert(/\d/.test(await txt(t, ".cl-stage:nth-child(1) .cl-left")), "countdown has numbers");
      await t.page.setValue("#cl-fix", "2026-10-15T09:30");
      t.assert(flat(await txt(t, ".cl-stage:nth-child(3)")).includes(full(Date.UTC(2026, 9, 29, 9, 30))), "14 days after the fix, in the locale");
      await t.page.eval(`document.querySelector('input[name="cl-kind"][value="incident"]').click(); true`);
      t.assert(flat(await txt(t, ".cl-stage:nth-child(3)")).includes(flat(await t.tx("Within one month after the 72-hour notification."))), "incident rule");
      t.assert(flat(await txt(t, ".cl-stage:nth-child(1)")).includes(flat(await t.tx("Whether the incident is suspected of being caused by unlawful or malicious acts."))), "incident checklist item");
      t.assert(flat(await txt(t, "#cl-summary")).startsWith(flat((await t.tx("{kind}. You became aware on {time}.")).split("{kind}")[0] + await t.tx("Severe incident"))), "summary names the kind");
    },
  },
];
