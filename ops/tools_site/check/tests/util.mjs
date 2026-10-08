import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { imageInfo, save } from "../fixtures.mjs";

const SITE = fileURLToPath(new URL("../../../../site/", import.meta.url));
const { default: qrcode } = await import(join(SITE, "tools/vendor/qrcode/qrcode.mjs"));
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

function qrCount(text, level) {
  const q = qrcode(0, level);
  q.addData(text, "Byte");
  q.make();
  return q.getModuleCount();
}
const val = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).value`);
const text = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const wait = (page, expr) => page.waitFor(expr);

export default [
  /* ------------------------------------------------------------ QR */
  {
    page: "qr-code-generator",
    name: "URL at level M: module count, PNG size and SVG",
    async run(t) {
      const url = "https://tanod.dev/tools/";
      await t.page.setValue("#q-text", url);
      await t.page.setValue("#q-ec", "M");
      await t.page.setValue("#q-size", "500");
      await wait(t.page, `!document.querySelector("#q-png").disabled && document.querySelector("#q-info").textContent.includes("modules")`);
      const n = qrCount(url, "M");
      const info = await text(t.page, "#q-info");
      t.assert(info.startsWith(`${n} by ${n} modules`), "module count in info: " + info + " expected " + n);
      const total = n + 8;
      const scale = Math.floor(500 / total);
      t.eq(await t.page.eval(`document.querySelector("#q-canvas").width`), total * scale, "canvas width");
      const png = await t.dl("#q-png");
      t.eq(png.name, "qr-code.png", "png name");
      const dims = imageInfo(png.bytes);
      t.eq([dims.format, dims.width, dims.height], ["png", total * scale, total * scale], "png dims");
      const svg = await t.dl("#q-svg");
      const s = svg.bytes.toString("utf8");
      t.assert(s.includes("<svg") && s.includes("<path") && s.includes("<rect"), "svg has svg, rect, path");
      t.assert((s.match(/<path/g) || []).length === 1, "single path");
      t.assert(s.includes(`viewBox="0 0 ${total} ${total}"`), "svg viewBox");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "qr-code-generator",
    name: "UTF-8 text, Wi-Fi payload and colour warning",
    async run(t) {
      await t.page.setValue("#q-text", "héllo ✓");
      await wait(t.page, `document.querySelector("#q-info").textContent.includes("modules")`);
      const n = qrCount("héllo ✓", "M");
      t.assert((await text(t.page, "#q-info")).startsWith(`${n} by ${n}`), "UTF-8 module count");
      await t.page.click('input[name="kind"][value="wifi"]');
      await t.page.setValue("#q-ssid", "My;Net");
      await t.page.setValue("#q-wpass", "p:a\\ss");
      const expected = "WIFI:T:WPA;S:My\\;Net;P:p\\:a\\\\ss;;";
      const n2 = qrCount(expected, "M");
      await wait(t.page, `document.querySelector("#q-info").textContent.startsWith("${n2} by ${n2}")`);
      await t.page.setValue("#q-fg", "#ffffff");
      await t.page.setValue("#q-bg", "#000000");
      await wait(t.page, `!document.querySelector("#q-warn").hidden`);
      t.assert(/lighter than its background/.test(await text(t.page, "#q-warn")), "inverted warning");
      await t.shot("wifi", 375);
    },
  },
  {
    page: "qr-code-generator",
    name: "input over capacity shows an error",
    async run(t) {
      await t.page.setValue("#q-text", "x".repeat(4000));
      const msg = await t.waitError();
      t.assert(/too long/.test(msg), "capacity message: " + msg);
      t.assert(await t.page.eval(`document.querySelector("#q-png").disabled`), "png disabled");
      await t.shot("error", 375);
    },
  },

  /* ------------------------------------------------------------ password */
  {
    page: "password-generator",
    name: "20 passwords of length 32 contain every class",
    async run(t) {
      await t.page.setValue("#pw-lennum", "32");
      await t.page.setValue("#pw-count", "20");
      await wait(t.page, `document.querySelectorAll("#pw-list [data-pw]").length === 20`);
      const pws = await t.page.eval(`[...document.querySelectorAll("#pw-list [data-pw]")].map(e => e.textContent)`);
      for (const p of pws) {
        t.eq(p.length, 32, "length");
        t.assert(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p), "all classes: " + p);
      }
      t.assert(new Set(pws).size === 20, "unique");
      t.assert(/bits/.test(await text(t.page, "#pw-bits")), "entropy shown");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "password-generator",
    name: "look-alikes excluded, single set, no sets error",
    async run(t) {
      await t.page.click("#pw-nolook");
      await t.page.setValue("#pw-lennum", "128");
      await t.page.setValue("#pw-count", "50");
      await wait(t.page, `document.querySelectorAll("#pw-list [data-pw]").length === 50`);
      const pws = await t.page.eval(`[...document.querySelectorAll("#pw-list [data-pw]")].map(e => e.textContent)`);
      t.assert(pws.every((p) => p.length === 128 && !/[Il1O0o]/.test(p)), "no look-alikes");
      for (const id of ["#pw-upper", "#pw-lower", "#pw-sym"]) await t.page.click(id);
      await wait(t.page, `[...document.querySelectorAll("#pw-list [data-pw]")].every(e => /^[2-9]+$/.test(e.textContent))`);
      for (const id of ["#pw-digit"]) await t.page.click(id);
      const msg = await t.waitError();
      t.assert(/at least one/i.test(msg), "no-set error: " + msg);
    },
  },

  /* ------------------------------------------------------------ uuid */
  {
    page: "uuid-generator",
    name: "100 v4 UUIDs are valid and unique, with format options",
    async run(t) {
      await t.page.setValue("#uu-count", "100");
      await wait(t.page, `document.querySelector("#uu-out").textContent.split("\\n").length === 100`);
      const lines = (await text(t.page, "#uu-out")).split("\n");
      const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      t.assert(lines.every((l) => re.test(l)), "v4 regex");
      t.eq(new Set(lines).size, 100, "unique");
      await t.page.click("#uu-upper"); await t.page.click("#uu-nohy"); await t.page.click("#uu-brace");
      await wait(t.page, `/^\\{[0-9A-F]{32}\\}$/.test(document.querySelector("#uu-out").textContent.split("\\n")[0])`);
      const dl = await t.dl("#uu-dl");
      t.eq(dl.name, "uuids.txt", "file name");
      t.eq(dl.bytes.toString("utf8").trim().split("\n").length, 100, "download lines");
      await t.shot("done", 375);
    },
  },
  {
    page: "uuid-generator",
    name: "100 v7 UUIDs strictly increase; checker reads the timestamp",
    async run(t) {
      await t.page.click('input[name="ver"][value="7"]');
      await t.page.setValue("#uu-count", "100");
      await wait(t.page, `document.querySelector("#uu-out").textContent.split("\\n").length === 100`);
      const lines = (await text(t.page, "#uu-out")).split("\n");
      const re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      t.assert(lines.every((l) => re.test(l)), "v7 regex: " + lines.find((l) => !re.test(l)));
      for (let i = 1; i < lines.length; i++) t.assert(lines[i] > lines[i - 1], `increasing at ${i}`);
      const before = Date.now();
      await t.page.setValue("#uu-in", lines[0]);
      await wait(t.page, `!document.querySelector("#uu-stats").hidden`);
      t.eq(await text(t.page, "#uu-v"), "7", "version");
      const iso = await text(t.page, "#uu-ts");
      t.assert(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(iso), "iso: " + iso);
      t.assert(Math.abs(Date.parse(iso) - before) < 60000, "timestamp is recent");
      t.assert(/RFC/.test(await text(t.page, "#uu-var")), "variant");
      await t.page.setValue("#uu-in", "123e4567-e89b-12d3-a456-426614174000");
      await wait(t.page, `document.querySelector("#uu-v").textContent === "1"`);
      await t.page.setValue("#uu-in", "not-a-uuid");
      t.assert(/Not a UUID/.test(await t.page.eval(`document.querySelector("#uu-check").textContent`)), "invalid reported");
    },
  },

  /* ------------------------------------------------------------ base64 */
  {
    page: "base64-encode-decode",
    name: "UTF-8 text encodes exactly and decodes back",
    async run(t) {
      const s = "héllo wörld ✓";
      const expected = Buffer.from(s, "utf8").toString("base64");
      await t.page.setValue("#b-in", s);
      await wait(t.page, `document.querySelector("#b-out").value !== ""`);
      t.eq(await val(t.page, "#b-out"), expected, "encoded");
      await t.page.click("#b-swap");
      await wait(t.page, `document.querySelector("#b-out").value !== "" && document.querySelector("#b-in").value === ${JSON.stringify(expected)}`);
      t.eq(await val(t.page, "#b-out"), s, "decoded back");
      // whitespace and missing padding tolerated
      await t.page.setValue("#b-in", expected.slice(0, 8) + "\n " + expected.slice(8).replace(/=+$/, ""));
      await wait(t.page, `document.querySelector("#b-out").value === ${JSON.stringify(s)}`);
      await t.shot("done", 375);
    },
  },
  {
    page: "base64-encode-decode",
    name: "URL-safe and wrapped variants",
    async run(t) {
      const s = "??>>~~ subjects?>"; // produces + and / in standard Base64
      const std = Buffer.from(s).toString("base64");
      t.assert(/[+/=]/.test(std), "fixture uses + / or =");
      await t.page.setValue("#b-in", s);
      await t.page.click("#b-url");
      const url = Buffer.from(s).toString("base64url");
      await wait(t.page, `document.querySelector("#b-out").value === ${JSON.stringify(url)}`);
      await t.page.click("#b-url");
      const long = "a".repeat(200);
      await t.page.setValue("#b-in", long);
      await t.page.click("#b-wrap");
      const out = await val(t.page, "#b-out");
      const lines = out.split("\n");
      t.assert(lines.length === 4 && lines[0].length === 76 && lines.slice(0, 3).every((l) => l.length === 76), "wrapped at 76");
      t.eq(lines.join(""), Buffer.from(long).toString("base64"), "wrapped content");
    },
  },
  {
    page: "base64-encode-decode",
    name: "invalid input reports the position",
    async run(t) {
      await t.page.click('input[name="dir"][value="decode"]');
      await t.page.setValue("#b-in", "SGVsbG8*d29ybGQ=");
      const msg = await t.waitError();
      t.assert(/Invalid character "\*" at position 8/.test(msg), "position message: " + msg);
      await t.page.setValue("#b-in", "SGVsbG8gd29ybGQ=");
      await wait(t.page, `document.querySelector("#b-out").value === "Hello world"`);
      await t.page.setValue("#b-in", "A");
      const msg2 = await t.waitError();
      t.assert(/never valid|whole number of bytes/.test(msg2), "length message: " + msg2);
      await t.shot("error", 375);
    },
  },
  {
    page: "base64-encode-decode",
    name: "file round trip keeps exact bytes",
    async run(t) {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 254, 255, 128, 64, 0, 0, 7]);
      const file = save(t.fixtures, "blob.png", bytes);
      await t.page.click('input[name="mode"][value="file"]');
      await t.page.setFiles("#drop input[type=file]", [file]);
      await t.waitDone();
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "blob.png.base64.txt", "name");
      t.eq(dl.bytes.toString("utf8"), bytes.toString("base64"), "base64 text");
      await t.page.click("#f-data");
      await wait(t.page, `document.querySelector("#f-out").textContent.startsWith("data:")`);
      const d2 = await t.dl("#f-dl");
      t.assert(d2.bytes.toString("utf8").endsWith(";base64," + bytes.toString("base64")), "data url");
      // and back to a file
      await t.page.setValue("#d-in", bytes.toString("base64"));
      await wait(t.page, `!document.querySelector("#d-dl").disabled && document.querySelector("#d-name").value === "decoded.png"`);
      t.assert(/PNG/.test(await text(t.page, "#d-info")), "sniffed PNG");
      const back = await t.dl("#d-dl");
      t.eq(back.name, "decoded.png", "decoded name");
      t.eq([...back.bytes], [...bytes], "decoded bytes");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },

  /* ------------------------------------------------------------ json */
  {
    page: "json-formatter",
    name: "formats at indent 2, minifies, sorts keys, keeps big numbers",
    async run(t) {
      const min = '{"b":[1,2,{"z":null,"a":true}],"a":{"x":"y\\n","e":{}},"n":12345678901234567890,"l":[]}';
      await t.page.setValue("#j-in", min);
      await wait(t.page, `!document.querySelector("#j-result").hidden`);
      const exp = `{
  "b": [
    1,
    2,
    {
      "z": null,
      "a": true
    }
  ],
  "a": {
    "x": "y\\n",
    "e": {}
  },
  "n": 12345678901234567890,
  "l": []
}`;
      t.eq(await text(t.page, "#j-out"), exp, "indent 2");
      t.eq(await text(t.page, "#j-s-depth"), "3", "depth");
      t.eq(await text(t.page, "#j-s-keys"), "8", "keys");
      await t.page.click("#j-sort");
      await wait(t.page, `document.querySelector("#j-out").textContent.startsWith('{\\n  "a": {')`);
      t.eq(await text(t.page, "#j-out"), JSON.stringify({ a: { e: {}, x: "y\n" }, b: [1, 2, { a: true, z: null }], l: [], n: 0 }, null, 2).replace('"n": 0', '"n": 12345678901234567890'), "sorted");
      await t.page.click('input[name="layout"][value="min"]');
      await wait(t.page, `!document.querySelector("#j-out").textContent.includes("\\n")`);
      t.eq(await text(t.page, "#j-out"), '{"a":{"e":{},"x":"y\\n"},"b":[1,2,{"a":true,"z":null}],"l":[],"n":12345678901234567890}', "minified sorted");
      await t.page.click('input[name="layout"][value="tab"]');
      await t.page.click("#j-sort");
      await wait(t.page, `document.querySelector("#j-out").textContent.startsWith('{\\n\\t"b": [')`);
      const dl = await t.dl("#j-dl");
      t.eq(dl.name, "formatted.json", "name");
      t.assert(dl.bytes.toString("utf8").startsWith('{\n\t"b": ['), "download content");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "json-formatter",
    name: "invalid JSON reports line and column with a caret",
    async run(t) {
      await t.page.setValue("#j-in", '{"a": 1,}');
      const msg = await t.waitError();
      t.assert(/line 1, column 9/.test(msg), "line/col: " + msg);
      const ex = await text(t.page, "#j-err");
      t.eq(ex.split("\n")[1].indexOf("^"), ex.split("\n")[0].indexOf("}"), "caret under the offending character");
      const multi = '{\n  "name": "x",\n  "items": [1, 2,\n    3 4],\n  "ok": true\n}';
      await t.page.setValue("#j-in", multi);
      await wait(t.page, `document.querySelector("#j-err").dataset.line === "4"`);
      t.eq(await t.page.eval(`document.querySelector("#j-err").dataset.col`), "7", "column on line 4");
      await t.page.setValue("#j-in", '{"a": [1, 2');
      await wait(t.page, `document.querySelector("#j-err").dataset.line === "1" && /never closed|incomplete/.test(document.querySelector("#status").textContent)`);
      await t.page.setValue("#j-in", "{'a': 1}");
      await wait(t.page, `/single quotes/.test(document.querySelector("#status").textContent)`);
      await t.shot("error", 375);
      await t.shot("error", 1280);
    },
  },
];
