// Developer tools: URL encode/decode, hash generator, JWT decoder, number base converter.
import { createHash, randomBytes } from "node:crypto";
import { save } from "../fixtures.mjs";

const val = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).value`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
const wait = (page, expr, o) => page.waitFor(expr, o);
const J = JSON.stringify;
const hashes = (buf) => Object.fromEntries(["md5", "sha1", "sha256", "sha384", "sha512"].map((a) => [a, createHash(a).update(buf).digest("hex")]));
/* Wait until the status shows an error matching re (inputs are debounced, so an older error may still be showing). */
async function errorLike(t, re) {
  await t.page.waitFor(`document.querySelector("#status").dataset.state === "error" && ${re}.test(document.querySelector("#status").textContent)`, { timeout: 5000 }).catch(() => {});
  return t.waitError();
}
async function noOverflow(t) {
  await t.page.viewport(375);
  await new Promise((r) => setTimeout(r, 100));
  const w = await t.page.eval(`[document.documentElement.scrollWidth, document.documentElement.clientWidth, [...document.querySelectorAll("#tool *")].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !e.closest(".dv-scroll")).slice(0, 3).map(e => e.tagName + "#" + e.id + "." + e.className)]`);
  t.assert(w[0] <= w[1] && !w[2].length, "no horizontal overflow at 375px: " + JSON.stringify(w));
}
const b64url = (x) => Buffer.from(typeof x === "string" ? x : J(x)).toString("base64url");

export default [
  /* ------------------------------------------------------------ URL */
  {
    page: "url-encode-decode",
    name: "component, full URL and form encoding match the platform, and decode back",
    async run(t) {
      const s = "a b&c=d/é?#✓ ~*'()+[]";
      await t.page.setValue("#u-in", s);
      t.eq(await val(t.page, "#u-out"), encodeURIComponent(s), "component");
      await t.page.setValue("#u-kind", "uri");
      t.eq(await val(t.page, "#u-out"), encodeURI(s), "full URL");
      await t.page.setValue("#u-kind", "form");
      const form = new URLSearchParams([["", s]]).toString().slice(1);
      t.eq(await val(t.page, "#u-out"), form, "form");
      t.assert(form.includes("+") && form.includes("%2B"), "form fixture has space and plus");
      await t.page.click("#u-swap");
      await wait(t.page, `document.querySelector('input[name="dir"][value="decode"]').checked`);
      t.eq(await val(t.page, "#u-out"), s, "form decodes back (+ as space, %2B as plus)");
      await t.page.setValue("#u-kind", "component");
      await t.page.setValue("#u-in", "a+b%2Bc");
      t.eq(await val(t.page, "#u-out"), "a+b+c", "component keeps + as plus");
      await t.page.setValue("#u-kind", "uri");
      const enc = "https://x.test/a%2Fb%20c%3Fd?q=%26%C3%A9";
      await t.page.setValue("#u-in", enc);
      t.eq(await val(t.page, "#u-out"), decodeURI(enc), "full URL decode keeps reserved escapes like decodeURI");
      await t.page.setValue("#u-kind", "component");
      t.eq(await val(t.page, "#u-out"), decodeURIComponent(enc), "component decode");
      await t.page.mouseClick("#u-copy");
      await wait(t.page, `["Copied", "Copy failed"].includes(document.querySelector("#u-copy").textContent)`);
      t.eq(await text(t.page, "#u-copy"), "Copied", "copy button");
      await t.shot("done", 375);
    },
  },
  {
    page: "url-encode-decode",
    name: "malformed escapes are reported with their position; URL parser splits parts",
    async run(t) {
      await t.page.click('input[name="dir"][value="decode"]');
      await t.page.setValue("#u-in", "%E0%A4%A");
      let msg = await t.waitError();
      t.assert(/"%A" at position 7/.test(msg), "incomplete escape: " + msg);
      t.eq(await val(t.page, "#u-out"), "", "no output on error");
      await t.page.setValue("#u-in", "ok %E0%A4 then");
      msg = await t.waitError();
      t.assert(/position 4 starts a 3-byte UTF-8 character, but only 2 escaped bytes follow/.test(msg), "truncated UTF-8: " + msg);
      await t.page.setValue("#u-in", "50% off");
      msg = await t.waitError();
      t.assert(/"% o" at position 3|"%" at position 3|position 3/.test(msg) && /%25/.test(msg), "stray percent: " + msg);
      await t.page.setValue("#u-in", "%FF");
      msg = await t.waitError();
      t.assert(/can't start a UTF-8 character/.test(msg), "invalid lead byte: " + msg);
      await t.shot("error", 375);
      await t.page.setValue("#u-in", "caf%C3%A9");
      await wait(t.page, `document.querySelector("#u-out").value === "café" && document.querySelector("#status").hidden`);

      await t.page.setValue("#p-in", "https://user:pw@example.com:8080/p%20a/th?q=caf%C3%A9&x=1+2&x=3#sec%20two");
      await wait(t.page, `!document.querySelector("#p-out").hidden`);
      await new Promise((r) => setTimeout(r, 150));
      const rows = await t.page.eval(`Object.fromEntries([...document.querySelectorAll("#p-rows > div")].map(d => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]))`);
      t.eq([rows.Scheme, rows.Host, rows.Port, rows.Path, rows.Fragment, rows["User name"]], ["https", "example.com", "8080", "/p a/th", "sec two", "user"], "parts");
      t.assert(/not shown/.test(rows.Password), "password hidden");
      const params = await t.page.eval(`[...document.querySelectorAll("#p-q tr")].map(r => [...r.children].slice(1).map(c => c.textContent))`);
      t.eq(params, [["q", "café"], ["x", "1 2"], ["x", "3"]], "query params");
      await t.page.setValue("#p-in", "example.org/a");
      await wait(t.page, `/https:\\/\\/ was assumed/.test(document.querySelector("#p-note").textContent)`);
      t.eq(await t.page.eval(`document.querySelector("#p-rows dd:not(:empty)") && [...document.querySelectorAll("#p-rows > div")].find(d => d.querySelector("dt").textContent === "Port").querySelector("dd").textContent`), "443 (default)", "default port");
      await t.page.setValue("#p-in", "http://[::1");
      await wait(t.page, `/isn't a URL/.test(document.querySelector("#p-note").textContent)`);
      await t.page.setValue("#p-in", "https://example.com/search?q=caf%C3%A9&page=2#results");
      await wait(t.page, `document.querySelectorAll("#p-q tr").length === 2`);
      await t.shot("parsed", 1280);
      await t.shot("parsed-board", 375, { selector: "#tool" });
      await noOverflow(t);
    },
  },

  /* ------------------------------------------------------------ hash */
  {
    page: "hash-generator",
    name: "RFC 1321 vectors, SHA family, formats and compare",
    async run(t) {
      const digits = "12345678901234567890123456789012345678901234567890123456789012345678901234567890";
      for (const [s, md5] of [["abc", "900150983cd24fb0d6963f7d28e17f72"], [digits, "57edf4a22be3c955ac49da2e2107b67a"], ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"]]) {
        await t.page.setValue("#h-in", s);
        await wait(t.page, `document.querySelector("#h-v-md5")?.textContent === ${J(md5)}`);
        const exp = hashes(s);
        for (const a of Object.keys(exp)) t.eq(await text(t.page, "#h-v-" + a), exp[a], `${a} of ${s.slice(0, 10)}`);
      }
      const u = "héllo wörld ✓ 😀\nline two";
      await t.page.setValue("#h-in", u);
      const eu = hashes(Buffer.from(u, "utf8"));
      await wait(t.page, `document.querySelector("#h-v-sha256")?.textContent === ${J(eu.sha256)}`);
      t.eq(await text(t.page, "#h-v-md5"), eu.md5, "UTF-8 md5");
      t.assert(/bytes of UTF-8/.test(await text(t.page, "#h-info")), "byte info");
      await t.page.click('input[name="fmt"][value="HEX"]');
      await wait(t.page, `document.querySelector("#h-v-sha1").textContent === ${J(eu.sha1.toUpperCase())}`);
      await t.page.click('input[name="fmt"][value="b64"]');
      const b64 = createHash("sha384").update(u).digest("base64");
      await wait(t.page, `document.querySelector("#h-v-sha384").textContent === ${J(b64)}`);
      await t.page.setValue("#h-expect", "  " + eu.sha256.toUpperCase() + "  notes.txt");
      await wait(t.page, `document.querySelector("#h-verdict").dataset.ok === "yes"`);
      t.assert(/SHA-256/.test(await text(t.page, "#h-verdict")), "match names SHA-256");
      t.eq(await t.page.eval(`document.querySelector("#h-rows > .is-match").dataset.algo`), "sha256", "row highlighted");
      await t.page.setValue("#h-expect", "sha512-" + createHash("sha512").update(u).digest("base64"));
      await wait(t.page, `/SHA-512/.test(document.querySelector("#h-verdict").textContent)`);
      await t.page.setValue("#h-expect", "0".repeat(64));
      await wait(t.page, `document.querySelector("#h-verdict").dataset.ok === "no"`);
      t.assert(/No match/.test(await text(t.page, "#h-verdict")), "mismatch text");
      t.eq(await t.page.eval(`document.querySelectorAll("#h-rows > .is-match").length`), 0, "no row highlighted");
      await t.shot("text", 375);
      await t.shot("text", 1280);
    },
  },
  {
    page: "hash-generator",
    name: "a 6 MB file and an empty file hash like node:crypto; download listing",
    async run(t) {
      const buf = randomBytes(6 * 1024 * 1024 + 123);
      const path = save(t.fixtures, "random.bin", buf);
      await t.page.click('input[name="mode"][value="file"]');
      await t.page.setFiles("#drop input[type=file]", [path]);
      await t.waitDone();
      const exp = hashes(buf);
      for (const a of Object.keys(exp)) t.eq(await text(t.page, "#h-v-" + a), exp[a], "file " + a);
      await t.page.setValue("#h-expect", `SHA256 (random.bin) = ${exp.sha256}`);
      await wait(t.page, `document.querySelector("#h-verdict").dataset.ok === "yes"`);
      const dl = await t.dl("#h-dl");
      t.eq(dl.name, "random.bin.hashes.txt", "download name");
      t.eq(dl.bytes.toString("utf8"), `MD5 (random.bin) = ${exp.md5}\nSHA1 (random.bin) = ${exp.sha1}\nSHA256 (random.bin) = ${exp.sha256}\nSHA384 (random.bin) = ${exp.sha384}\nSHA512 (random.bin) = ${exp.sha512}\n`, "listing");
      await t.shot("file", 1280);
      await t.shot("file", 375);
      await t.shot("file-board", 375, { selector: "#tool" });
      await noOverflow(t);
      const empty = save(t.fixtures, "empty.txt", Buffer.alloc(0));
      await t.page.setFiles("#drop input[type=file]", [empty]);
      await wait(t.page, `document.querySelector("#h-v-md5")?.textContent === "d41d8cd98f00b204e9800998ecf8427e"`);
      t.eq(await text(t.page, "#h-v-sha256"), hashes(Buffer.alloc(0)).sha256, "empty sha256");
    },
  },

  /* ------------------------------------------------------------ JWT */
  {
    page: "jwt-decoder",
    name: "decodes header and payload; times in a pinned zone; expired verdict",
    async run(t) {
      await t.page.timezone("America/New_York");
      await t.go();
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: "HS256", typ: "JWT", kid: "k1" };
      const payload = { iss: "https://issuer.example", sub: "42", name: "Zoë ✓", iat: 1700000000, nbf: 1720000000, exp: now - 3 * 3600 - 30, team: "blue" };
      const token = `${b64url(header)}.${b64url(payload)}.${b64url("not-a-real-signature")}`;
      await t.page.setValue("#jw-in", "Bearer " + token + "\n");
      await wait(t.page, `!document.querySelector("#jw-out").hidden`);
      t.eq(await text(t.page, "#jw-alg"), "HS256", "alg");
      t.eq(await text(t.page, "#jw-typ"), "JWT", "typ");
      t.eq(await text(t.page, "#jw-kid"), "k1", "kid");
      t.eq(await text(t.page, "#jw-payload"), J(payload, null, 2), "payload json");
      t.eq(await text(t.page, "#jw-header"), J(header, null, 2), "header json");
      t.assert(/Signature not verified/.test(await text(t.page, "#jw-warn")), "warning shown");
      t.eq(await text(t.page, "#jw-valid"), "Expired 3 hours ago.", "verdict");
      const cell = (k, attr) => text(t.page, `#jw-times tr[data-claim="${k}"] [data-${attr}]`);
      t.eq(await cell("iat", "local"), "2023-11-14 17:13:20 (UTC−05:00)", "iat local (EST)");
      t.eq(await cell("iat", "utc"), "2023-11-14T22:13:20Z", "iat utc");
      t.eq(await cell("nbf", "local"), "2024-07-03 05:46:40 (UTC−04:00)", "nbf local (EDT)");
      t.assert(/ago$/.test(await cell("nbf", "rel")), "nbf in the past");
      t.eq(await cell("exp", "rel"), "3 hours ago", "exp relative");
      t.assert(/America\/New_York/.test(await text(t.page, "#jw-times-box thead th:nth-child(2)")), "zone named");
      const claims = await t.page.eval(`[...document.querySelectorAll("#jw-claims tr")].map(r => [...r.children].map(c => c.textContent))`);
      t.eq(claims[0], ["iss", "Issuer", "https://issuer.example"], "iss row");
      t.eq(claims.find((r) => r[0] === "team"), ["team", "Custom claim", "blue"], "custom claim");
      await t.shot("expired", 1280);
      await t.shot("expired", 375);
      await t.shot("expired-board", 375, { selector: "#tool" });
      await noOverflow(t);
    },
  },
  {
    page: "jwt-decoder",
    name: "not yet valid, valid, milliseconds flag and unsigned token",
    async run(t) {
      const now = Math.floor(Date.now() / 1000);
      const h = b64url({ alg: "RS256", typ: "JWT" });
      await t.page.setValue("#jw-in", `${h}.${b64url({ nbf: now + 630, exp: now + 7200 })}.c2ln`);
      await wait(t.page, `/Not valid yet/.test(document.querySelector("#jw-valid").textContent)`);
      t.eq(await text(t.page, "#jw-valid"), "Not valid yet: it becomes valid in 10 minutes.", "nbf verdict");
      await t.page.setValue("#jw-in", `${h}.${b64url({ exp: now + 2 * 86400 + 100 })}.c2ln`);
      await wait(t.page, `document.querySelector("#jw-valid").dataset.ok === "yes"`);
      t.eq(await text(t.page, "#jw-valid"), "Not expired: it expires in 2 days.", "valid verdict");
      await t.page.setValue("#jw-in", `${h}.${b64url({ exp: (now + 3600) * 1000 })}.c2ln`);
      await wait(t.page, `/milliseconds/.test(document.querySelector("#jw-times").textContent)`);
      await t.page.setValue("#jw-in", `${b64url({ alg: "none" })}.${b64url({ sub: "x" })}.`);
      await wait(t.page, `document.querySelector("#jw-alg").textContent === "none (unsigned)"`);
      t.assert(/no signature/.test(await text(t.page, "#jw-sig")), "empty signature explained");
      t.assert(/no expiry/.test(await text(t.page, "#jw-valid")), "no exp");
      await t.page.click("#jw-sample");
      await wait(t.page, `document.querySelector("#jw-valid").dataset.ok === "yes"`);
    },
  },
  {
    page: "jwt-decoder",
    name: "malformed tokens and an encrypted JWE give clear messages",
    async run(t) {
      await t.page.setValue("#jw-in", "abc.def");
      let msg = await t.waitError();
      t.assert(/three parts.*This has 2 parts/.test(msg), "two parts: " + msg);
      await t.page.setValue("#jw-in", "a.b.c.d");
      msg = await errorLike(t, /4 parts/);
      t.assert(/This has 4 parts/.test(msg), "four parts: " + msg);
      const h = b64url({ alg: "HS256" });
      await t.page.setValue("#jw-in", `${h}.e*yJ.sig`);
      msg = await errorLike(t, /Base64url/);
      t.assert(new RegExp(`payload has "\\*" at position ${h.length + 3} of the token`).test(msg), "bad char position: " + msg);
      await t.page.setValue("#jw-in", `${b64url("not json")}.${b64url({})}.sig`);
      msg = await errorLike(t, /valid JSON/);
      t.assert(/header decodes to text that isn't valid JSON/.test(msg), "non-JSON header: " + msg);
      await t.page.setValue("#jw-in", `${h}.${b64url("[1,2]")}.sig`);
      msg = await errorLike(t, /not an object/);
      t.assert(/payload is JSON but not an object/.test(msg), "array payload: " + msg);
      t.eq(await t.page.eval(`document.querySelector("#jw-out").hidden`), true, "output hidden on error");
      await t.shot("error", 375);
      const parts = [{ alg: "RSA-OAEP", enc: "A256GCM", kid: "enc-1" }, randomBytes(256), randomBytes(12), randomBytes(40), randomBytes(16)];
      const jwe = parts.map((p) => (Buffer.isBuffer(p) ? p.toString("base64url") : b64url(p))).join(".");
      await t.page.setValue("#jw-in", jwe);
      await wait(t.page, `!document.querySelector("#jw-out").hidden`);
      t.eq(await text(t.page, "#jw-parts"), "5 (encrypted)", "parts");
      t.eq(await text(t.page, "#jw-alg"), "RSA-OAEP / A256GCM", "alg/enc");
      t.assert(/encrypted token \(JWE\)/.test(await text(t.page, "#jw-valid")), "JWE explained");
      t.eq(await t.page.eval(`document.querySelector("#jw-payload-box").hidden`), true, "payload hidden");
      t.assert(/Ciphertext: 40 bytes/.test(await text(t.page, "#jw-sig")), "part sizes");
      await t.shot("jwe", 1280);
    },
  },

  /* ------------------------------------------------------------ number base */
  {
    page: "number-base-converter",
    name: "2^64+1 exactly, negatives and two's complement at 8/16/32/64 bits",
    async run(t) {
      const big = 2n ** 64n + 1n;
      await t.page.setValue("#nb-in", big.toString());
      await wait(t.page, `!document.querySelector("#nb-out").hidden`);
      t.eq(await text(t.page, "#nb-v-2"), big.toString(2), "binary");
      t.eq(await text(t.page, "#nb-v-8"), big.toString(8), "octal");
      t.eq(await text(t.page, "#nb-v-16"), "10000000000000001", "hex");
      t.assert(/Doesn't fit in 64 bits/.test(await text(t.page, '#nb-tc-body tr[data-bits="64"]')), "too big for 64");
      await t.page.setValue("#nb-in", "-1");
      const row = (b) => t.page.eval(`["hex", "bin", "signed", "unsigned"].map(k => document.querySelector('#nb-tc-body tr[data-bits="${b}"] [data-' + k + ']').textContent)`);
      await wait(t.page, `document.querySelector('#nb-tc-body tr[data-bits="8"] [data-hex]')?.textContent === "FF"`);
      t.eq(await row(8), ["FF", "1111 1111", "−1", "255"], "-1 in 8 bits");
      t.eq(await row(16), ["FFFF", "1111 1111 1111 1111", "−1", "65,535"], "-1 in 16 bits");
      t.eq(await row(32), ["FFFFFFFF", "1111 ".repeat(8).trim(), "−1", "4,294,967,295"], "-1 in 32 bits");
      t.eq(await row(64), ["F".repeat(16), "1111 ".repeat(16).trim(), "−1", "18,446,744,073,709,551,615"], "-1 in 64 bits");
      t.eq(await text(t.page, "#nb-v-2"), "-1", "negative binary");
      await t.page.setValue("#nb-in", "200");
      await wait(t.page, `document.querySelector('#nb-tc-body tr[data-bits="8"] [data-signed]')?.textContent === "−56"`);
      await t.page.setValue("#nb-in", "-129");
      await wait(t.page, `/Doesn't fit in 8 bits/.test(document.querySelector('#nb-tc-body tr[data-bits="8"]').textContent)`);
      t.eq((await row(16))[0], "FF7F", "-129 in 16 bits");
      await t.page.setValue("#nb-in", "1234567");
      await t.page.click("#nb-group");
      await wait(t.page, `document.querySelector("#nb-v-10").textContent === "1,234,567"`);
      t.eq(await text(t.page, "#nb-v-2"), "1 0010 1101 0110 1000 0111", "grouped binary");
      t.eq(await text(t.page, "#nb-v-16"), "12 D687", "grouped hex");
      await t.page.click("#nb-upper");
      await wait(t.page, `document.querySelector("#nb-v-16").textContent === "12 d687"`);
      await t.shot("done", 375);
      await t.shot("done-board", 375, { selector: "#tool" });
      await noOverflow(t);
      await t.shot("done", 1280);
    },
  },
  {
    page: "number-base-converter",
    name: "prefixes, other bases and invalid input messages",
    async run(t) {
      await t.page.setValue("#nb-from", "16");
      await t.page.setValue("#nb-in", "0xff_ff");
      await wait(t.page, `document.querySelector("#nb-v-10")?.textContent === "65535"`);
      await t.page.setValue("#nb-from", "8");
      await t.page.setValue("#nb-in", "129");
      let msg = await t.waitError();
      t.eq(msg, `"9" at position 3 isn't a valid octal digit (use 0 to 7).`, "octal digit");
      await t.page.setValue("#nb-from", "10");
      await t.page.setValue("#nb-in", "0x1F");
      msg = await t.waitError();
      t.assert(/"x" at position 2 isn't a valid decimal digit.*choose Hexadecimal/.test(msg), "hex hint: " + msg);
      await t.page.setValue("#nb-in", "3.14");
      msg = await t.waitError();
      t.assert(/position 2 looks like a fraction/.test(msg), "fraction: " + msg);
      await t.shot("error", 375);
      await t.page.setValue("#nb-from", "other");
      await t.page.setValue("#nb-base", "36");
      await t.page.setValue("#nb-in", "ZZ");
      await wait(t.page, `document.querySelector("#nb-v-10")?.textContent === "1295"`);
      t.eq(await text(t.page, "#nb-v-36"), "ZZ", "base 36 row");
      await t.page.setValue("#nb-base", "3");
      await t.page.setValue("#nb-in", "-1201");
      await wait(t.page, `document.querySelector("#nb-v-10")?.textContent === "-46"`);
      const huge = "z".repeat(300);
      await t.page.setValue("#nb-base", "36");
      await t.page.setValue("#nb-in", huge);
      const exp = (36n ** 300n - 1n).toString();
      await wait(t.page, `document.querySelector("#nb-v-10")?.textContent === ${J(exp)}`);
      await t.page.setValue("#nb-base", "40");
      msg = await t.waitError();
      t.assert(/base from 2 to 36/.test(msg), "base range");
    },
  },
];
