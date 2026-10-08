// Server-backed tools (compress PDF, OCR PDF, image to text, web page to PDF, protect / unlock PDF) against the
// /web/v1 mock in server.mjs and the Turnstile stand-in (fake-turnstile.js). The live API is exercised by scanapi's
// own tests (tests/test_webtools.py) and the local end-to-end run (live.mjs).
import { makePdf, makeEncryptedPdf, makePng, pdfInfo, save } from "../fixtures.mjs";

const quotaText = (t) => t.page.eval(`document.querySelector("#quota").textContent`);
const lastCall = (t) => t.mock.calls[t.mock.calls.length - 1];
// The browser logs every non-2xx answer as a failed resource; the error tests expect those.
const SERVER_ERRORS = /Failed to load resource: the server responded with a status of (422|429|500|503)/;
const ready = (t) => t.page.waitFor(`/free server jobs left/.test(document.querySelector("#quota").textContent)`);

async function honest(t) {
  const txt = await t.page.eval(`document.body.innerText`);
  t.assert(!/never leave your device/i.test(txt), "a server page must not promise files never leave the device");
  t.assert(!/Nothing is uploaded/i.test(txt), "a server page must not say nothing is uploaded");
  t.assert(/Processed on our server, then deleted/.test(txt), "server tag");
  t.assert(/Sent to our server for this one job, then deleted\. Never stored or logged\./.test(txt) || !(await t.page.eval(`!!document.querySelector("#drop")`)), "drop line");
  t.assert(/10 MB|10 free server jobs/.test(txt), "limits stated");
  t.assert(await t.page.eval(`document.body.dataset.server === "1"`), "data-server");
}

export default [
  {
    page: "compress-pdf",
    name: "compresses on the server: Turnstile token, quota, download",
    async run(t) {
      await ready(t);
      await honest(t);
      t.assert(/10 of 10 free server jobs left today/.test(await quotaText(t)), "quota at start: " + await quotaText(t));
      t.eq(await t.page.eval(`document.querySelector("#human").dataset.fakeTurnstile || null`), null, "widget not rendered before a job");
      await t.shot("start", 375);
      const f = save(t.fixtures, "report.pdf", Buffer.concat([Buffer.from(await makePdf(3, { label: "Big" })), Buffer.from("%" + "x".repeat(200000) + "\n")]));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && !document.querySelector("#go").disabled`);
      await t.page.click('input[name="level"][value="extreme"]');
      await t.page.click("#go");
      await t.waitDone();
      const call = lastCall(t);
      t.eq(call.path, "/web/v1/pdf/compress", "path");
      t.eq(call.keys, ["level", "pdf_base64"], "body keys");
      t.eq(call.body.level, "extreme", "level");
      t.assert(/^fake-token-/.test(call.token) && call.origin === t.origin, "token and origin");
      t.eq(await t.page.eval(`document.querySelector("#human").dataset.fakeTurnstile`), "1x00000000000000000000AA|tanod-tools", "sitekey and action from /status");
      const { name, bytes } = await t.dl();
      t.eq(name, "report-compressed.pdf", "file name");
      t.eq((await pdfInfo(bytes)).pages, 1, "a PDF came back");
      t.assert(/% smaller/.test(await t.page.eval(`document.querySelector(".result__title").textContent`)), "saving shown");
      t.assert(/9 of 10 free server jobs left today/.test(await quotaText(t)), "quota after one job: " + await quotaText(t));
      await t.shot("done", 1280);
      // a second job takes a fresh token
      await t.page.click("#go");
      await t.waitDone();
      t.assert(t.mock.calls.length === 2 && t.mock.calls[0].token !== t.mock.calls[1].token, "one token per job");
    },
  },
  {
    page: "compress-pdf",
    name: "refuses files over 10 MB before anything is sent",
    async run(t) {
      await ready(t);
      const big = save(t.fixtures, "huge.pdf", Buffer.concat([Buffer.from(await makePdf(1)), Buffer.alloc(10_100_000, 32)]));
      await t.page.setFiles("#drop input[type=file]", [big]);
      const msg = await t.waitError();
      t.assert(/10\.2 MB.*up to 10 MB.*Tanod API/.test(msg), "size message: " + msg);
      t.eq(t.mock.calls.length, 0, "nothing sent");
    },
  },
  {
    page: "compress-pdf",
    name: "busy, failed human check and server errors give clear messages and keep the count",
    allowConsole: SERVER_ERRORS,
    async run(t) {
      await ready(t);
      const f = save(t.fixtures, "a.pdf", await makePdf(1));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.mock.next = { status: 503, code: "busy" };
      await t.page.click("#go");
      let msg = await t.waitError();
      t.assert(/busy right now.*nothing was counted/.test(msg), "busy: " + msg);
      t.assert(/10 of 10/.test(await quotaText(t)), "not counted");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.eval(`window.__tsMode = "error", true`);
      await t.page.click("#go");
      msg = await t.waitError();
      t.assert(/human check couldn't be completed/.test(msg), "turnstile error: " + msg);
      t.mock.next = { status: 422, code: "pdf_encrypted" };
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#go");
      msg = await t.waitError();
      t.assert(/Unlock PDF/.test(msg), "encrypted: " + msg);
      t.mock.next = { status: 500, code: "internal" };
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#go");
      msg = await t.waitError();
      t.assert(/Try again in a minute; nothing was counted/.test(msg), "500: " + msg);
      await t.shot("error", 375);
    },
  },
  {
    page: "compress-pdf",
    name: "an interactive human check appears in the board and the job continues",
    async run(t) {
      await ready(t);
      const f = save(t.fixtures, "a.pdf", await makePdf(1));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.eval(`window.__tsMode = "ask", true`);
      await t.page.click("#go");
      await t.page.waitFor(`!!document.querySelector("#human #fake-human") && document.querySelector("#human").classList.contains("is-asking")`);
      await t.shot("human-check", 375);
      await t.page.click("#fake-human");
      await t.waitDone();
      t.eq(t.mock.calls.length, 1, "job ran after the check");
    },
  },
  {
    page: "compress-pdf",
    name: "daily limit reached: button off, clear message",
    async run(t) {
      t.mock.used = 10;
      await t.go();
      await t.page.waitFor(`document.querySelector("#quota").dataset.state === "empty"`);
      t.assert(/0 of 10 free server jobs left today/.test(await quotaText(t)), "quota: " + await quotaText(t));
      const f = save(t.fixtures, "a.pdf", await makePdf(1));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#work").hidden`);
      t.assert(await t.page.eval(`document.querySelector("#go").disabled`), "button disabled");
      await t.shot("limit", 375);
    },
  },
  {
    page: "compress-pdf",
    name: "server tools switched off: says so",
    async run(t) {
      t.mock.enabled = false;
      await t.go();
      await t.page.waitFor(`document.querySelector("#quota").dataset.state === "off"`);
      t.assert(/switched off/.test(await quotaText(t)), "off message");
    },
  },
  {
    page: "ocr-pdf",
    name: "makes a PDF searchable: page selection, text, download",
    async run(t) {
      await ready(t);
      await honest(t);
      const f = save(t.fixtures, "scan.pdf", await makePdf(3, { label: "Scan" }));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#range").value`), "1-3", "default pages");
      await t.page.setValue("#range", "1, 3");
      await t.page.click("#redo");
      await t.page.click("#go");
      await t.waitDone();
      const call = lastCall(t);
      t.eq(call.body.pages, "1,3", "closed page parts");
      t.eq(call.body.skip_text, false, "redo pages with text");
      const { name, bytes } = await t.dl();
      t.eq(name, "scan-searchable.pdf", "name");
      t.eq((await pdfInfo(bytes)).pages, 3, "pages kept");
      t.assert(/Fixture page 3/.test(await t.page.eval(`document.querySelector(".ocr-text").textContent`)), "text shown");
      await t.shot("done", 1280);
    },
  },
  {
    page: "ocr-pdf",
    name: "long PDFs: 10 pages per job; refuses encrypted files",
    async run(t) {
      await ready(t);
      const f = save(t.fixtures, "long.pdf", await makePdf(14));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#range").value`), "1-10", "first 10 pages");
      await t.page.setValue("#range", "1-11");
      await t.page.waitFor(`document.querySelector("#go").disabled && /at most 10 pages/.test(document.querySelector("#range-help").textContent)`);
      await t.page.setValue("#range", "11-14");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      const enc = save(t.fixtures, "locked.pdf", await makeEncryptedPdf());
      await t.page.setFiles("#drop input[type=file]", [enc]);
      const msg = await t.waitError();
      t.assert(/password-protected.*Unlock PDF/.test(msg), "encrypted: " + msg);
      t.eq(t.mock.calls.length, 0, "nothing sent");
    },
  },
  {
    page: "image-to-text",
    name: "reads text from an image: prepared PNG sent, editable text, copy and .txt",
    async run(t) {
      await ready(t);
      await honest(t);
      const f = save(t.fixtures, "note.png", makePng(400, 120));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#go").disabled && !!document.querySelector("#preview canvas")`);
      t.eq(await t.page.eval(`[document.querySelector("#preview canvas").width, document.querySelector("#preview canvas").height]`), [1200, 360], "small images scaled up 3x");
      t.assert(/400 × 120 px/.test(await t.page.eval(`document.querySelector("#finfo").textContent`)), "original size shown");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      t.eq(lastCall(t).keys, ["image_base64"], "body keys");
      t.assert(/Hello from the OCR mock/.test(await t.page.eval(`document.querySelector("#out").value`)), "text");
      t.assert(/\(png\)/.test(await t.page.eval(`document.querySelector("#out").value`)), "a PNG was sent");
      const { name, bytes } = await t.dl(".result__head a[download]");
      t.eq(name, "note.txt", ".txt name");
      t.assert(bytes.toString().startsWith("Hello from the OCR mock"), "txt content");
      await t.shot("done", 1280);
    },
  },
  {
    page: "url-to-pdf",
    name: "saves a web page as PDF with paper and orientation",
    allowConsole: SERVER_ERRORS,
    async run(t) {
      await ready(t);
      await honest(t);
      t.assert(await t.page.eval(`document.querySelector("#go").disabled`), "disabled without an address");
      await t.page.type("#url", "example.com/blog/post.html");
      await t.page.click('input[name="paper"][value="letter"]');
      await t.page.click('input[name="orient"][value="landscape"]');
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      t.eq(lastCall(t).body, { url: "https://example.com/blog/post.html", paper: "letter", landscape: true, print_background: true }, "body");
      const { name, bytes } = await t.dl();
      t.eq(name, "example.com-post.pdf", "name");
      t.eq((await pdfInfo(bytes)).pages, 2, "pages");
      await t.shot("done", 375);
      await t.page.type("#url", "ftp://example.com/x");
      await t.page.waitFor(`document.querySelector("#go").disabled && /http/.test(document.querySelector("#url-help").textContent)`);
      await t.page.type("#url", "https://private.test/");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#go");
      const msg = await t.waitError();
      t.assert(/private network/.test(msg), "blocked: " + msg);
    },
  },
  {
    page: "protect-pdf",
    name: "protects with a confirmed password and permissions",
    async run(t) {
      await ready(t);
      await honest(t);
      const f = save(t.fixtures, "contract.pdf", await makePdf(2));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#work").hidden`);
      await t.page.type("#pw", "correct horse");
      await t.page.type("#pw2", "correct hors");
      await t.page.waitFor(`document.querySelector("#go").disabled && /don't match/.test(document.querySelector("#pw-help").textContent)`);
      await t.page.type("#pw2", "correct horse");
      await t.page.click("#allow-print");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      t.eq(lastCall(t).body.password, "correct horse", "password sent");
      t.eq([lastCall(t).body.allow_print, lastCall(t).body.allow_copy], [false, true], "permissions");
      const { name, bytes } = await t.dl();
      t.eq(name, "contract-protected.pdf", "name");
      t.assert(bytes.toString("latin1").includes("/Encrypt"), "encrypted output");
      const enc = save(t.fixtures, "locked.pdf", await makeEncryptedPdf());
      await t.page.setFiles("#drop input[type=file]", [enc]);
      const msg = await t.waitError();
      t.assert(/already has a password/.test(msg), "already protected: " + msg);
    },
  },
  {
    page: "unlock-pdf",
    name: "unlocks with the right password; wrong password is explained and not counted",
    allowConsole: SERVER_ERRORS,
    async run(t) {
      await ready(t);
      await honest(t);
      const plain = save(t.fixtures, "plain.pdf", await makePdf(1));
      await t.page.setFiles("#drop input[type=file]", [plain]);
      let msg = await t.waitError();
      t.assert(/nothing to remove/.test(msg), "not encrypted: " + msg);
      const enc = save(t.fixtures, "statement.pdf", await makeEncryptedPdf());
      await t.page.setFiles("#drop input[type=file]", [enc]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && !document.querySelector("#go").disabled`);
      await t.page.type("#pw", "wrong");
      await t.page.click("#go");
      msg = await t.waitError();
      t.assert(/doesn't open this PDF/.test(msg), "wrong password: " + msg);
      t.assert(/10 of 10/.test(await quotaText(t)), "a wrong password is not counted");
      await t.page.type("#pw", "right horse");
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "statement-unlocked.pdf", "name");
      t.eq((await pdfInfo(bytes)).pages, 1, "a PDF");
      t.assert(/9 of 10/.test(await quotaText(t)), "counted once");
      await t.shot("done", 375);
    },
  },
  {
    page: "index",
    path: "/tools/",
    name: "index marks the six server tools and keeps the privacy copy honest",
    async run(t) {
      const badges = await t.page.eval(`[...document.querySelectorAll(".stops__srv")].map(b => b.closest("a").getAttribute("href"))`);
      t.eq(badges.sort(), ["/tools/compress-pdf/", "/tools/image-to-text/", "/tools/ocr-pdf/", "/tools/protect-pdf/", "/tools/unlock-pdf/", "/tools/url-to-pdf/"], "server badges");
      const txt = await t.page.eval(`document.body.innerText`);
      t.assert(!/Every tool works inside your browser/.test(txt) && !/Nothing you open here is uploaded/.test(txt), "no blanket no-upload claim");
      t.assert(/six tools marked/i.test(txt), "server tools explained");
      await t.page.type("#find", "server");
      await t.page.waitFor(`/tools match/.test(document.querySelector("#find-count").textContent)`);
      // "server" also finds the SQL formatter (SQL Server) and HTTP status codes (500 Internal Server Error)
      const shown = await t.page.eval(`[...document.querySelectorAll(".stops li:not([hidden]) a")].map(a => a.getAttribute("href"))`);
      for (const b of badges) t.assert(shown.includes(b), "search for server finds " + b);
    },
  },
  {
    page: "merge-pdf",
    name: "browser-only pages never load Turnstile or call the server",
    async run(t) {
      t.eq(t.page.turnstileLoads, 0, "no Turnstile");
      const txt = await t.page.eval(`document.body.innerText`);
      t.assert(/Your files never leave your device/.test(txt), "local promise kept on local tools");
      t.assert(/Compress PDF/.test(await t.page.eval(`document.querySelector(".related").textContent`)), "related links include the server tool");
    },
  },
];
