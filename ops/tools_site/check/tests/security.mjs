// Security & compliance tools driven in Chromium on the real pages: security.txt generator and checker, vulnerability disclosure
// policy generator, CRA 24-hour incident clock. The engines' own rules are covered by check/unit/security.mjs; here: the forms,
// what is drawn, copy / download, the preview built without innerHTML, time zones and localStorage, and that nothing is requested
// from another origin or uploaded (the harness fails the test otherwise).
const q = JSON.stringify;
const val = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).value`);
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.replace(/\\s+/g, " ").trim()`);
const count = (t, sel) => t.page.eval(`document.querySelectorAll(${q(sel)}).length`);
const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const check = (t, sel, on) => t.page.eval(`(() => { const e = document.querySelector(${q(sel)}); if (e.checked !== ${on}) e.click(); return true; })()`);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default [
  /* ============================================================ security.txt */
  {
    page: "security-txt-generator",
    name: "generator: field order, defaults, normalised contacts, expiry hint, notes",
    async run(t) {
      const exp = await val(t, "#stx-expires");
      t.assert(/^\d{4}-\d{2}-\d{2}$/.test(exp), "default expiry is a day: " + exp);
      const days = (Date.parse(exp + "T23:59:59Z") - Date.now()) / 86400000;
      t.assert(days > 362 && days <= 365, "default expiry is just under a year: " + days);
      t.assert(/Valid for another 36\d days/.test(await txt(t, "#stx-exp-h")), "expiry help: " + await txt(t, "#stx-exp-h"));
      t.eq(await val(t, "#stx-out"), "Expires: " + exp + "T23:59:59Z\n", "only Expires before any contact is typed");
      t.assert((await txt(t, "#stx-gen-list")).includes("Contact is missing"), "missing Contact is reported");
      await t.page.setValue("#stx-contact", "security@example.com\n+49 30 123456\nexample.com/report");
      await t.page.setValue("#stx-expires", "2027-06-30");
      await t.page.setValue("#stx-pol", "example.com/policy");
      await t.page.setValue("#stx-enc", "https://example.com/key.asc");
      await t.page.setValue("#stx-lang", "en, de");
      await t.page.setValue("#stx-canon", "example.com/.well-known/security.txt");
      await t.page.setValue("#stx-ack", "https://example.com/thanks");
      await t.page.setValue("#stx-hire", "https://example.com/jobs");
      t.eq(await val(t, "#stx-out"), [
        "Contact: mailto:security@example.com", "Contact: tel:+4930123456", "Contact: https://example.com/report", "Expires: 2027-06-30T23:59:59Z",
        "Encryption: https://example.com/key.asc", "Acknowledgments: https://example.com/thanks", "Preferred-Languages: en, de",
        "Canonical: https://example.com/.well-known/security.txt", "Policy: https://example.com/policy", "Hiring: https://example.com/jobs", "",
      ].join("\n"), "file in the documented order");
      t.assert(!/Error|Warning/.test(await txt(t, "#stx-gen-list")) || /Expires/.test(await txt(t, "#stx-gen-list")), "only date notes may remain");
      // an expiry in the past is flagged both in the hint and in the notes
      await t.page.setValue("#stx-expires", "2020-01-01");
      t.assert((await txt(t, "#stx-exp-h")).includes("already passed"), "past date hint");
      t.assert((await txt(t, "#stx-gen-list")).includes("expired on 2020-01-01T23:59:59Z"), "past date note");
      await t.page.setValue("#stx-expires", day(900));
      t.assert((await txt(t, "#stx-exp-h")).includes("more than a year away"), "far date hint");
      t.assert((await txt(t, "#stx-gen-list")).includes("more than a year away"), "far date note");
      await t.page.setValue("#stx-pol", "http://example.com/policy");
      t.assert((await txt(t, "#stx-gen-list")).includes("Policy uses http://"), "http link is flagged");
    },
  },
  {
    page: "security-txt-generator",
    name: "generator: copy and download give the file text",
    async run(t) {
      await t.page.setValue("#stx-contact", "security@example.com");
      await t.page.setValue("#stx-expires", day(200));
      const want = await val(t, "#stx-out");
      t.assert(want.startsWith("Contact: mailto:security@example.com\nExpires: "), "text built");
      await t.page.eval(`window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; true`);
      await t.page.click("#stx-copy");
      await t.page.waitFor(`window.__copied !== null || /Copied|Copy failed/.test(document.querySelector("#stx-copy").textContent)`);
      const { name, bytes } = await t.dl("#stx-dl");
      t.eq(name, "security.txt", "download name");
      t.eq(Buffer.from(bytes).toString("utf8"), want, "downloaded text equals the shown text");
      await t.page.setValue("#stx-contact", "");
      await t.page.setValue("#stx-expires", "");
      t.eq(await t.page.eval(`document.querySelector("#stx-copy").disabled && document.querySelector("#stx-dl").disabled`), true, "buttons off with nothing to copy");
    },
  },
  {
    page: "security-txt-generator",
    name: "checker: valid file, each kind of problem, counts, line numbers, Canonical match",
    async run(t) {
      const good = `Contact: mailto:security@example.com\nExpires: ${day(200)}T23:59:59Z\nCanonical: https://example.com/.well-known/security.txt\n`;
      await t.page.setValue("#stx-in", good);
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.includes("No errors or warnings")`);
      t.assert((await txt(t, "#stx-list")).includes("Not signed"), "unsigned note");
      await t.page.setValue("#stx-url", "other.example.org");
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.includes("1 error")`);
      t.assert((await txt(t, "#stx-list")).includes("(https://other.example.org/.well-known/security.txt)"), "mismatch names the address");
      await t.page.setValue("#stx-url", "example.com");
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.includes("No errors")`);
      const bad = `Contact: http://example.com/x\nContact: security@example.com\nExpires: 2020-01-01T00:00:00Z\nPolicy: example.com/p\nFoo: bar\nnot a field\n`;
      await t.page.setValue("#stx-in", bad);
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.startsWith("Found")`);
      t.eq(await txt(t, "#stx-sum"), "Found 5 errors and 1 warning.", "summary counts");
      t.eq(await t.page.eval(`document.querySelector("#stx-sum").classList.contains("tt__err")`), true, "summary styled as error");
      const items = await t.page.eval(`[...document.querySelectorAll("#stx-list li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
      t.assert(items[0].startsWith("Error"), "errors first: " + items[0]);
      t.assert(items.some((s) => s.includes("Line 1") && s.includes("Contact uses http://")), "http Contact on line 1");
      t.assert(items.some((s) => s.includes("Line 2") && s.includes("is not a URI")), "bare email on line 2");
      t.assert(items.some((s) => s.includes("Line 3") && s.includes("expired on 2020-01-01T00:00:00Z")), "expired on line 3");
      t.assert(items.some((s) => s.includes("Line 4") && s.includes("Policy must be an https:// address")), "Policy without scheme on line 4");
      t.assert(items.some((s) => s.includes("Line 6") && s.includes("not a field, a comment or blank")), "stray line 6");
      t.assert(items.some((s) => s.startsWith("Warning") && s.includes('Unknown field "Foo"')), "unknown field is a warning");
      // clear
      await t.page.click("#stx-clear");
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.startsWith("Paste a security.txt")`);
      t.eq(await count(t, "#stx-list li"), 0, "list emptied");
    },
  },
  {
    page: "security-txt-generator",
    name: "checker: signed file, example button, pasted text is shown as text",
    async run(t) {
      const signed = `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nContact: mailto:security@example.com\nExpires: ${day(200)}T23:59:59Z\n-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----\n`;
      await t.page.setValue("#stx-in", signed);
      await t.page.waitFor(`document.querySelector("#stx-list").textContent.includes("cleartext-signed")`);
      t.assert((await txt(t, "#stx-sum")).includes("No errors or warnings"), "signed file passes");
      await t.page.setValue("#stx-in", signed.replace("-----END PGP SIGNATURE-----\n", ""));
      await t.page.waitFor(`document.querySelector("#stx-list").textContent.includes("missing or incomplete")`);
      await t.page.click("#stx-example");
      await t.page.waitFor(`document.querySelector("#stx-sum").textContent.includes("No errors or warnings")`);
      t.assert((await val(t, "#stx-in")).includes("Contact: mailto:security@example.com"), "example loaded");
      t.eq(await val(t, "#stx-url"), "example.com", "example address");
      await t.page.setValue("#stx-in", `Contact: mailto:a@example.com\nExpires: ${day(200)}T23:59:59Z\n<img src=x onerror=alert(1)>: <b>x</b>\n`);
      await t.page.waitFor(`document.querySelector("#stx-list").textContent.includes("not a field")`);
      t.eq(await count(t, "#stx-list img, #stx-list b"), 0, "no elements created from pasted text");
    },
  },

  /* ============================================================ disclosure policy */
  {
    page: "vulnerability-disclosure-policy-generator",
    name: "policy: preview, Markdown and HTML follow the form; options switch sections",
    async run(t) {
      const h2 = () => t.page.eval(`[...document.querySelectorAll("#vd-prev .vd-h2")].map((e) => e.textContent)`);
      t.assert((await txt(t, "#vd-prev")).includes("[your organisation] takes the security"), "placeholder organisation");
      t.eq((await h2()).length, 7, "seven sections by default");
      await t.page.setValue("#vd-org", "Acme GmbH");
      await t.page.setValue("#vd-scope", "Acme App\nAcme API");
      await t.page.setValue("#vd-contact", "security@acme.example");
      await t.page.setValue("#vd-site", "acme.example");
      await t.page.setValue("#vd-date", "2026-10-09");
      await t.page.waitFor(`document.querySelector("#vd-prev").textContent.includes("Acme GmbH takes")`);
      const prev = await txt(t, "#vd-prev");
      t.assert(prev.includes("Last updated: 2026-10-09"), "date in preview");
      t.assert(prev.includes("within 2 business days") && prev.includes("within 5 business days") && prev.includes("within 90 days of confirming"), "default promises");
      t.eq(await t.page.eval(`document.querySelector("#vd-prev a[href='mailto:security@acme.example']").textContent`), "security@acme.example", "contact link");
      t.eq(await t.page.eval(`document.querySelector("#vd-prev a[href='https://acme.example/.well-known/security.txt']") !== null`), true, "security.txt link");
      // views
      t.eq(await t.page.eval(`document.querySelector("#vd-md").hidden && document.querySelector("#vd-html").hidden && !document.querySelector("#vd-prev").hidden`), true, "preview shown first");
      await t.page.eval(`document.querySelector('input[name="vd-view"][value="md"]').click(); true`);
      t.eq(await t.page.eval(`!document.querySelector("#vd-md").hidden && document.querySelector("#vd-prev").hidden`), true, "Markdown view");
      const md = await val(t, "#vd-md");
      t.assert(md.startsWith("<!-- Template from Tanod Tools, not legal advice."), "template comment first");
      t.assert(md.includes("# Vulnerability disclosure policy\n\nLast updated: 2026-10-09\n\nAcme GmbH takes the security of its products seriously."), "Markdown body");
      t.assert(md.includes("- Acme App\n- Acme API\n"), "Markdown scope list");
      await t.page.eval(`document.querySelector('input[name="vd-view"][value="html"]').click(); true`);
      const html = await val(t, "#vd-html");
      t.assert(html.includes('<article class="vdp">') && html.includes("<li>Acme App</li>") && html.includes('<a href="mailto:security@acme.example">'), "HTML fragment");
      t.assert(!html.includes("<html"), "fragment has no page wrapper");
      // options
      await check(t, "#vd-safe", false);
      await t.page.waitFor(`![...document.querySelectorAll("#vd-prev .vd-h2")].some((e) => e.textContent === "Safe harbour")`);
      await check(t, "#vd-cra", false);
      await t.page.waitFor(`![...document.querySelectorAll("#vd-prev .vd-h2")].some((e) => e.textContent === "Reporting to the authorities")`);
      t.eq((await h2()).length, 5, "five sections without the two options");
      await t.page.setValue("#vd-ack-n", "24");
      await t.page.setValue("#vd-ack-u", "hours");
      await t.page.setValue("#vd-days", "45");
      await t.page.waitFor(`document.querySelector("#vd-prev").textContent.includes("within 24 hours")`);
      t.assert((await txt(t, "#vd-prev")).includes("until 45 days after your report"), "disclosure timeline");
      await check(t, "#vd-noreward", false);
      await check(t, "#vd-credit", false);
      await t.page.waitFor(`!document.querySelector("#vd-prev").textContent.includes("bug bounty") && !document.querySelector("#vd-prev").textContent.includes("credit you")`);
      t.assert(!(await txt(t, "#vd-prev")).includes("credit you"), "credit off");
      t.assert((await txt(t, ".note")).includes("not legal advice"), "disclaimer on the page");
    },
  },
  {
    page: "vulnerability-disclosure-policy-generator",
    name: "policy: hostile input is escaped everywhere; the preview creates no elements from it",
    async run(t) {
      const evil = '<img src=x onerror=alert(1)> *b* "q"';
      await t.page.setValue("#vd-org", evil);
      await t.page.setValue("#vd-scope", "<script>alert(1)</script>\n[x](javascript:alert(1))");
      await t.page.setValue("#vd-contact", "javascript:alert(1)");
      await t.page.waitFor(`document.querySelector("#vd-prev").textContent.includes("<img src=x")`);
      t.eq(await count(t, "#vd-prev img, #vd-prev script"), 0, "no img or script in the preview");
      t.eq(await count(t, "#vd-prev a[href^='javascript']"), 0, "no javascript: link");
      const html = await val(t, "#vd-html");
      t.assert(!html.includes("<img") && !html.includes("<script>"), "HTML output escapes tags");
      t.assert(html.includes("&lt;img src=x onerror=alert(1)&gt; *b* &quot;q&quot;"), "HTML entities");
      const md = await val(t, "#vd-md");
      t.assert(md.includes("\\<img src=x onerror=alert(1)\\> \\*b\\* \"q\"") , "Markdown escapes: " + md.split("\n").find((l) => l.includes("img")));
      const { bytes } = await t.dl("#vd-dl-html");
      const page = Buffer.from(bytes).toString("utf8");
      t.assert(page.startsWith('<!doctype html>\n<html lang="en">') && !page.includes("<img"), "downloaded page is complete and escaped");
    },
  },
  {
    page: "vulnerability-disclosure-policy-generator",
    name: "policy: fill from security.txt, copy and download",
    async run(t) {
      await t.page.setValue("#vd-fill", "Contact: mailto:psirt@acme.example\nContact: https://acme.example/report\nEncryption: https://acme.example/key.asc\nPreferred-Languages: en, de\nCanonical: https://acme.example/.well-known/security.txt\nExpires: 2027-06-30T23:59:59Z\n");
      await t.page.click("#vd-use");
      t.eq(await val(t, "#vd-contact"), "psirt@acme.example\nhttps://acme.example/report", "contacts without mailto:");
      t.eq(await val(t, "#vd-pgp"), "https://acme.example/key.asc", "key");
      t.eq(await val(t, "#vd-langs"), "English, German", "language names");
      t.eq(await val(t, "#vd-site"), "acme.example/.well-known/security.txt", "site from Canonical");
      const prev = await txt(t, "#vd-prev");
      t.assert(prev.includes("Please report it using one of these:") && prev.includes("We can handle reports in: English, German."), "preview updated");
      t.assert(prev.includes("public key"), "key sentence");
      await t.page.eval(`window.__c = []; navigator.clipboard.writeText = async (s) => { window.__c.push(s); }; true`);
      await t.page.click("#vd-copy-md");
      await t.page.click("#vd-copy-html");
      await t.page.waitFor(`window.__c.length === 2`);
      const [cmd, chtml] = await t.page.eval(`window.__c`);
      t.eq(cmd, await val(t, "#vd-md"), "copied Markdown");
      t.eq(chtml, await val(t, "#vd-html"), "copied HTML");
      const m = await t.dl("#vd-dl-md");
      t.eq(m.name, "vulnerability-disclosure-policy.md", "md name");
      t.eq(Buffer.from(m.bytes).toString("utf8"), cmd, "md content");
    },
  },

  /* ============================================================ CRA clock */
  {
    page: "cra-incident-clock",
    name: "clock: vulnerability deadlines in UTC and in the viewer's zone; final report waits for the fix",
    async run(t) {
      await t.page.timezone("Europe/Berlin");
      await t.go();
      t.eq(await t.page.eval(`document.querySelector("#cl-result").hidden`), true, "nothing shown before a time is entered");
      t.eq(await t.page.eval(`document.querySelector("#cl-empty").hidden`), false, "prompt shown");
      t.assert((await txt(t, "#cl-empty")).includes("Enter the time you became aware"), "prompt");
      await t.page.setValue("#cl-aware", "2026-10-09T14:00");     // Berlin, CEST (UTC+2)
      t.eq(await t.page.eval(`document.querySelector("#cl-result").hidden`), false, "results visible");
      t.eq(await t.page.eval(`document.querySelector("#cl-empty").hidden`), true, "prompt hidden");
      const stage = (i) => txt(t, `.cl-stage:nth-child(${i})`);
      const s1 = await stage(1), s2 = await stage(2), s3 = await stage(3);
      t.assert(s1.startsWith("1Early warning") && s1.includes("Within 24 hours of becoming aware."), "stage 1 title: " + s1.slice(0, 80));
      t.assert(s1.includes("Saturday, October 10, 2026 at 2:00:00 PM GMT+2"), "24 h in Berlin time: " + s1);
      t.assert(s1.includes("Saturday, October 10, 2026 at 12:00:00 PM UTC"), "24 h in UTC");
      t.assert(s2.includes("Monday, October 12, 2026 at 2:00:00 PM GMT+2") && s2.includes("Monday, October 12, 2026 at 12:00:00 PM UTC"), "72 h");
      t.assert(s3.includes("Final report") && s3.includes("14 days after a fix or mitigation is available") && s3.includes("Not set yet"), "final report pending: " + s3);
      t.assert((await txt(t, "#cl-summary")).includes("Actively exploited vulnerability. You became aware on Friday, October 9, 2026 at 2:00:00 PM GMT+2"), "summary: " + await txt(t, "#cl-summary"));
      t.assert((await txt(t, ".cl-stage:nth-child(1) .cl-when p:first-child")).startsWith("Your time zone (Europe/Berlin)"), "zone name shown");
      await t.page.setValue("#cl-fix", "2026-10-15T09:30");        // Berlin
      const s3b = await stage(3);
      t.assert(s3b.includes("Thursday, October 29, 2026 at 8:30:00 AM GMT+1") && s3b.includes("Thursday, October 29, 2026 at 7:30:00 AM UTC"), "14 days after the fix, local time shifts to CET: " + s3b);
      t.assert(!s3b.includes("Not set yet"), "pending note gone");
      await t.shot("filled", 1280);
      await t.shot("filled", 375);
    },
  },
  {
    page: "cra-incident-clock",
    name: "clock: UTC entry, incident final report one month after the notification, checklists",
    async run(t) {
      await check(t, "#cl-utc", true);
      await t.page.setValue("#cl-aware", "2027-01-26T10:00");
      await t.page.eval(`document.querySelector('input[name="cl-kind"][value="incident"]').click(); true`);
      t.eq(await t.page.eval(`document.querySelector("#cl-fix-wrap").hidden`), true, "fix field hidden for an incident");
      t.eq(await t.page.eval(`document.querySelector("#cl-notified-wrap").hidden`), false, "notification field shown");
      const s3 = await txt(t, ".cl-stage:nth-child(3)");
      t.assert(s3.includes("Within one month after the 72-hour notification."), "rule");
      t.assert(s3.includes("Tuesday, March 2, 2027 at 10:00:00 AM UTC") === false, "not counted from awareness");
      // 29 Jan 10:00 + 1 month = 28 Feb (clamped), a Sunday
      t.assert(s3.includes("Sunday, February 28, 2027 at 10:00:00 AM UTC"), "one month after the latest notification time, clamped: " + s3);
      t.assert(s3.includes("Counted from the latest time the notification can be filed"), "basis note");
      await t.page.setValue("#cl-notified", "2027-01-28T08:15");
      const s3b = await txt(t, ".cl-stage:nth-child(3)");
      t.assert(s3b.includes("Sunday, February 28, 2027 at 8:15:00 AM UTC"), "one month after the actual notification: " + s3b);
      t.assert(!s3b.includes("Counted from the latest"), "basis note removed");
      t.assert((await txt(t, ".cl-stage:nth-child(1)")).includes("Whether the incident is suspected of being caused by unlawful or malicious acts."), "incident early warning item");
      t.assert((await txt(t, ".cl-stage:nth-child(3)")).includes("The type of threat or root cause that is likely to have triggered the incident."), "incident final item");
      t.eq(await count(t, ".cl-check input[type=checkbox]"), 10, "ten checklist boxes for an incident (2 + 5 + 3)");
      // every box has a label
      t.eq(await t.page.eval(`[...document.querySelectorAll(".cl-check input")].every((i) => document.querySelector('label[for="' + i.id + '"]'))`), true, "checkboxes are labelled");
      await t.page.eval(`document.querySelector('input[name="cl-kind"][value="vulnerability"]').click(); true`);
      t.eq(await count(t, ".cl-check input[type=checkbox]"), 10, "ten boxes for a vulnerability (2 + 5 + 3)");
      t.assert((await txt(t, ".cl-stage:nth-child(2)")).includes("The general nature of the exploit and of the vulnerability."), "vulnerability notification item");
      t.assert((await txt(t, ".cl-stage:nth-child(1)")).includes("the EU Member States where you know the product is made available"), "member states item");
      // switching the zone box keeps the moment
      await check(t, "#cl-utc", false);
      t.assert((await val(t, "#cl-aware")).match(/^2027-01-26T/), "aware time still on 26 January");
    },
  },
  {
    page: "cra-incident-clock",
    name: "clock: countdown and overdue, current time button, print, nothing stored unless asked",
    async run(t) {
      await t.page.click("#cl-now");
      await t.page.waitFor(`!document.querySelector("#cl-result").hidden`);
      const left = await txt(t, ".cl-stage:nth-child(1) .cl-left");
      t.assert(/^(23|24) h \d+ min left$/.test(left) || /^23 h \d+ min left$/.test(left), "about a day left on the early warning: " + left);
      const l2 = await txt(t, ".cl-stage:nth-child(2) .cl-left");
      t.assert(/^(2 d 23 h|3 d 0 h) \d+ min left$/.test(l2) || /^2 d 23 h \d+ min left$/.test(l2), "about three days left on the notification: " + l2);
      // two days ago: early warning overdue
      const d = new Date(Date.now() - 2 * 86400000);
      const p = (n) => String(n).padStart(2, "0");
      await t.page.setValue("#cl-aware", `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
      t.assert((await txt(t, ".cl-stage:nth-child(1) .cl-left")).startsWith("Overdue by 1 d"), "early warning overdue: " + await txt(t, ".cl-stage:nth-child(1) .cl-left"));
      t.eq(await t.page.eval(`document.querySelector(".cl-stage:nth-child(1) .cl-left").classList.contains("is-overdue")`), true, "overdue styling");
      t.assert((await txt(t, ".cl-stage:nth-child(2) .cl-left")).endsWith("left"), "notification still open");
      // print
      await t.page.eval(`window.__printed = 0; window.print = () => { window.__printed++; }; true`);
      await t.page.click("#cl-print");
      t.eq(await t.page.eval(`window.__printed`), 1, "print button calls window.print");
      // storage
      t.eq(await t.page.eval(`localStorage.getItem("tt:cra-clock")`), null, "nothing stored by default");
      t.assert((await txt(t, "#cl-keep-h")).includes("Nothing is stored unless you tick the box"), "storage note");
      await check(t, "#cl-remember", true);
      const saved = await t.page.eval(`JSON.parse(localStorage.getItem("tt:cra-clock"))`);
      t.eq([saved.kind, typeof saved.aware, saved.utc], ["vulnerability", "number", false], "saved when asked");
      await t.go();
      t.eq(await t.page.eval(`document.querySelector("#cl-remember").checked`), true, "restored after reload");
      t.eq(await t.page.eval(`document.querySelector("#cl-result").hidden`), false, "deadlines back after reload");
      t.eq(await val(t, "#cl-aware") !== "", true, "time restored");
      await t.page.click("#cl-forget");
      t.eq(await t.page.eval(`localStorage.getItem("tt:cra-clock")`), null, "cleared");
      t.eq(await val(t, "#cl-aware"), "", "form cleared");
      t.eq(await t.page.eval(`document.querySelector("#cl-result").hidden`), true, "results hidden again");
      await t.page.setValue("#cl-aware", "2026-10-09T12:00");
      t.eq(await t.page.eval(`localStorage.getItem("tt:cra-clock")`), null, "typing does not store without the box");
    },
  },
];
