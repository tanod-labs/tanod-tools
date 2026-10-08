// Generators: colour palette, CSS gradient, meta tags, Wi-Fi QR, vCard QR, barcode.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { imageInfo } from "../fixtures.mjs";

const SITE = fileURLToPath(new URL("../../../../site/", import.meta.url));
const { default: qrcode } = await import(join(SITE, "tools/vendor/qrcode/qrcode.mjs"));
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
function qrCount(text, level = "M") { const q = qrcode(0, level); q.addData(text, "Byte"); q.make(); return q.getModuleCount(); }

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (page, sel) => page.eval(`${q(sel)}.textContent.trim()`);
const value = (page, sel) => page.eval(`${q(sel)}.value`);

/* ------------------------------------------------------------------ independent colour maths (own copy, from Ottosson's post) */

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgb2lab([R, G, B]) {
  const r = lin(R / 255), g = lin(G / 255), b = lin(B / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function lab2lin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const lab2rgb255 = (lab) => lab2lin(lab).map((v) => gam(Math.min(1, Math.max(0, v))) * 255);
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (a) => "#" + a.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const lch = (hex) => { const [L, a, b] = rgb2lab(hexToRgb(hex)); return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]; };
const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
/* gamut mapping, written the plain way: shrink chroma in 0.5% steps until the colour fits */
function lch2hex([L, C, h]) {
  for (let c = C; c >= 0; c -= C / 20000 || 1) {
    const r = (h * Math.PI) / 180;
    const lin3 = lab2lin([L, c * Math.cos(r), c * Math.sin(r)]);
    if (lin3.every((v) => v >= -1e-6 && v <= 1 + 1e-6)) return toHex(lin3.map((v) => gam(Math.min(1, Math.max(0, v))) * 255));
    if (c === 0) break;
  }
  return toHex(lab2rgb255([L, 0, 0]));
}
const near = (h1, h2, tol = 1) => hexToRgb(h1).every((v, i) => Math.abs(v - hexToRgb(h2)[i]) <= tol);

const BASES = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#3366cc", "#1636a3", "#f3c11a", "#808080", "#000000", "#ffffff", "#e91e63", "#2e7d32", "#4b0082"];
const schemeHexes = (page, id) => page.eval(`[...document.querySelectorAll('[data-scheme="${id}"] .gen-sw__hex')].map((e) => e.textContent.trim())`);
const setBase = async (page, hex) => {
  await page.setValue("#cp-hex", hex);
  await page.waitFor(`document.querySelector("#cp-pick").value === ${JSON.stringify(hex)}`);
};

/* ------------------------------------------------------------------ barcode references */

const gs1 = (d) => { let s = 0; [...d].reverse().forEach((c, i) => { s += Number(c) * (i % 2 ? 1 : 3); }); return (10 - (s % 10)) % 10; };
function upcEPad(ns, six) {
  const [a, b, c, d, e, f] = six.split("").map(Number);
  const map = { 0: [a, b, f, 0, 0, 0, 0, c, d, e], 1: [a, b, f, 0, 0, 0, 0, c, d, e], 2: [a, b, f, 0, 0, 0, 0, c, d, e], 3: [a, b, c, 0, 0, 0, 0, 0, d, e], 4: [a, b, c, d, 0, 0, 0, 0, 0, e] };
  return ns + (map[f] || [a, b, c, d, e, 0, 0, 0, 0, f]).join("");
}

export default [
  /* ============================================================ colour palette */
  {
    page: "color-palette-generator",
    name: "hex parsing: #abc, abc, #AABBCC, invalid",
    async run(t) {
      const swatch0 = () => t.page.eval(`document.querySelector('[data-scheme="analogous"] .gen-sw:nth-child(3) .gen-sw__hex').textContent`);
      for (const [typed, expected] of [["#abc", "#aabbcc"], ["abc", "#aabbcc"], ["#AABBCC", "#aabbcc"], ["aabbcc", "#aabbcc"], ["  #F60 ", "#ff6600"]]) {
        await t.page.setValue("#cp-hex", typed);
        await t.page.waitFor(`document.querySelector("#cp-pick").value === ${JSON.stringify(expected)}`);
        t.eq(await swatch0(), expected, `base swatch for ${typed}`);
        t.eq(await t.page.eval(`${q("#cp-hex")}.hasAttribute("aria-invalid")`), false, "valid " + typed);
      }
      await t.page.setValue("#cp-hex", "#aabbcc");
      for (const bad of ["zzz", "#abcd", "12345", "#1234567", "", "rgb(1,2,3)"]) {
        await t.page.setValue("#cp-hex", bad);
        t.eq(await t.page.eval(`${q("#cp-hex")}.getAttribute("aria-invalid")`), "true", "invalid " + JSON.stringify(bad));
        t.assert(/not a HEX colour/.test(await text(t.page, "#cp-msg")), "message for " + bad);
        t.eq(await swatch0(), "#aabbcc", "palette kept after invalid " + bad);
      }
      await t.page.setValue("#cp-hex", "#1636a3");
      t.eq(await t.page.eval(`${q("#cp-hex")}.hasAttribute("aria-invalid")`), false, "invalid flag cleared");
    },
  },
  {
    page: "color-palette-generator",
    name: "contrast: white vs black is exactly 21:1, labels in words",
    async run(t) {
      await setBase(t.page, "#ffffff");
      const row = (hex) => t.page.eval(`(() => { const s = [...document.querySelectorAll('[data-scheme="analogous"] .gen-sw')].find((e) => e.dataset.hex === ${JSON.stringify(hex)}); return [...s.querySelectorAll(".gen-sw__c")].map((p) => p.textContent.replace(/\\s+/g, " ").trim()); })()`);
      t.eq(await row("#ffffff"), ["White text 1:1 Fails AA", "Black text 21:1 AAA"], "white swatch");
      await setBase(t.page, "#000000");
      t.eq(await row("#000000"), ["White text 21:1 AAA", "Black text 1:1 Fails AA"], "black swatch");
      // spot checks against the WCAG formula, computed here
      await setBase(t.page, "#777777");
      const L = (h) => { const [r, g, b] = hexToRgb(h).map((v) => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const exp = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const w = Math.floor(exp("#777777", "#ffffff") * 100) / 100, k = Math.floor(exp("#777777", "#000000") * 100) / 100;
      const got = await row("#777777");
      t.eq(got[0], `White text ${w}:1 ${w >= 7 ? "AAA" : w >= 4.5 ? "AA" : w >= 3 ? "AA large text only" : "Fails AA"}`, "777777 on white");
      t.eq(got[1], `Black text ${k}:1 ${k >= 7 ? "AAA" : k >= 4.5 ? "AA" : "AA large text only"}`, "777777 on black");
    },
  },
  {
    page: "color-palette-generator",
    name: "OKLab round trip (own maths) and complementary hue = base + 180",
    async run(t) {
      // own round trip: every 8-bit step on a grid of sRGB values
      let worst = 0;
      for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
        const back = lab2rgb255(rgb2lab([r, g, b]));
        worst = Math.max(worst, Math.abs(back[0] - r), Math.abs(back[1] - g), Math.abs(back[2] - b));
      }
      t.assert(worst < 0.5, "round trip error " + worst);
      for (const base of BASES) {
        await setBase(t.page, base);
        const comp = await schemeHexes(t.page, "complementary");
        t.eq(comp[0], base, "complementary keeps the base " + base);
        const [L, C, h] = lch(base);
        t.assert(near(comp[1], lch2hex([L, C, (h + 180) % 360]), 1), `complement of ${base}: page ${comp[1]}, expected ${lch2hex([L, C, (h + 180) % 360])}`);
        if (C > 0.08 && L > 0.3 && L < 0.95) {
          const [, c2, h2] = lch(comp[1]);
          t.assert(c2 > 0.02 && hueDiff(h2, (h + 180) % 360) < 3, `hue of complement of ${base}: ${h2.toFixed(1)} vs ${((h + 180) % 360).toFixed(1)}`);
        }
        // reported base hue in the page equals ours
        const shown = Number(await t.page.eval(`${q("#cp-msg")}.dataset.hue`));
        t.assert(hueDiff(shown, h) < 0.01 || C < 1e-4, `shown hue ${shown} vs ${h} for ${base}`);
      }
    },
  },
  {
    page: "color-palette-generator",
    name: "every scheme gives valid, correct-length hex for awkward bases",
    async run(t) {
      const lens = { analogous: 5, complementary: 2, split: 3, triadic: 3, tetradic: 4, mono: 7 };
      for (const base of BASES) {
        await setBase(t.page, base);
        for (const [id, n] of Object.entries(lens)) {
          const hs = await schemeHexes(t.page, id);
          t.eq(hs.length, n, `${id} count for ${base}`);
          t.assert(hs.every((h) => /^#[0-9a-f]{6}$/.test(h)), `${id} valid hex for ${base}: ${hs}`);
        }
        // triad hues: 120 and 240 degrees from the base (when there is enough chroma to measure)
        const [L, C, h] = lch(base);
        const tri = await schemeHexes(t.page, "triadic");
        t.assert(near(tri[1], lch2hex([L, C, (h + 120) % 360]), 1) && near(tri[2], lch2hex([L, C, (h + 240) % 360]), 1), "triad for " + base);
        // monochromatic: lightness strictly decreasing from first to last
        const mono = (await schemeHexes(t.page, "mono")).map((x) => lch(x)[0]);
        t.assert(mono.every((v, i) => i === 0 || v < mono[i - 1] + 1e-9), `mono lightness order for ${base}: ${mono.map((v) => v.toFixed(2))}`);
      }
    },
  },
  {
    page: "color-palette-generator",
    name: "random palette: locks survive regenerate, Space only outside fields",
    async run(t) {
      const cur = () => t.page.eval(`[...document.querySelectorAll('[data-scheme="random"] .gen-sw__hex')].map((e) => e.textContent.trim())`);
      const start = await cur();
      t.eq(start.length, 5, "five swatches");
      t.assert(start.every((h) => /^#[0-9a-f]{6}$/.test(h)), "valid random hex");
      // lock the 2nd and 4th swatch with real keyboard-style clicks
      for (const n of [2, 4]) await t.page.click(`[data-scheme="random"] .gen-sw:nth-child(${n}) .gen-lock`);
      t.eq(await t.page.eval(`[...document.querySelectorAll('[data-scheme="random"] .gen-lock')].map((b) => b.getAttribute("aria-pressed"))`), ["false", "true", "false", "true", "false"], "aria-pressed");
      const before = await cur();
      for (let i = 0; i < 3; i++) await t.page.click("#cp-random");
      let after = await cur();
      t.eq([after[1], after[3]], [before[1], before[3]], "locked swatches kept after button");
      t.assert(after[0] !== before[0] || after[2] !== before[2] || after[4] !== before[4], "unlocked changed");
      t.eq(await t.page.eval(`[...document.querySelectorAll('[data-scheme="random"] .gen-lock')].map((b) => b.getAttribute("aria-pressed"))`), ["false", "true", "false", "true", "false"], "locks kept");
      // Space with focus on the page body regenerates
      await t.page.eval(`document.activeElement && document.activeElement.blur(), true`);
      const pre = await cur();
      await t.page.press(" ");
      await t.page.waitFor(`JSON.stringify([...document.querySelectorAll('[data-scheme="random"] .gen-sw__hex')].map((e) => e.textContent.trim())) !== ${JSON.stringify(JSON.stringify(pre))}`);
      after = await cur();
      t.eq([after[1], after[3]], [before[1], before[3]], "locked swatches kept after Space");
      // Space in a text field must not regenerate or be swallowed
      const pre2 = await cur();
      const prevented = await t.page.eval(`(() => { const i = document.querySelector("#cp-hex"); i.focus(); const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }); i.dispatchEvent(e); return e.defaultPrevented; })()`);
      t.eq(prevented, false, "Space not prevented in a text field");
      t.eq(await cur(), pre2, "palette unchanged by Space in a field");
      const onBtn = await t.page.eval(`(() => { const b = document.querySelector("#cp-copy"); b.focus(); const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }); b.dispatchEvent(e); return e.defaultPrevented; })()`);
      t.eq(onBtn, false, "Space left alone on a button");
    },
  },
  {
    page: "color-palette-generator",
    name: "export CSS / JSON / list, copy and download",
    async run(t) {
      await setBase(t.page, "#3366cc");
      await t.page.setValue("#cp-which", "triadic");
      const hs = await schemeHexes(t.page, "triadic");
      t.eq(await value(t.page, "#cp-out"), `:root {\n${hs.map((h, i) => `  --color-${i + 1}: ${h};`).join("\n")}\n}\n`, "css");
      await t.page.click('input[name="cp-fmt"][value="json"]');
      t.eq(JSON.parse(await value(t.page, "#cp-out")), hs, "json");
      await t.page.click('input[name="cp-fmt"][value="list"]');
      t.eq(await value(t.page, "#cp-out"), hs.join("\n") + "\n", "list");
      const d = await t.dl("#cp-dl");
      t.eq(d.name, "palette-triadic.txt", "download name");
      t.eq(d.bytes.toString("utf8"), hs.join("\n") + "\n", "download content");
      await t.page.click('input[name="cp-fmt"][value="json"]');
      t.eq((await t.dl("#cp-dl")).name, "palette-triadic.json", "json name");
      await t.page.click("#cp-copy");
      t.assert(/Cop/.test(await text(t.page, "#cp-copy")), "copy gives feedback");
      await t.page.setValue("#cp-which", "random");
      t.eq(JSON.parse(await value(t.page, "#cp-out")).length, 5, "random export has five");
      await t.page.setValue("#cp-hex", "#1636a3");
      await t.page.click('input[name="cp-fmt"][value="css"]');
      await t.page.setValue("#cp-which", "complementary");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ gradient */
  {
    page: "css-gradient-generator",
    name: "exact output: linear, angles 0 and 360, stops, fallback, repeating",
    async run(t) {
      const out = () => value(t.page, "#g-out");
      t.eq(await out(), "background: linear-gradient(90deg, #1636a3 0%, #6dd5ed 100%);", "default");
      await t.page.setValue("#g-angle", "0");
      t.eq(await out(), "background: linear-gradient(0deg, #1636a3 0%, #6dd5ed 100%);", "0deg");
      t.eq(await value(t.page, "#g-angle-r"), "0", "slider follows");
      await t.page.setValue("#g-angle", "360");
      t.eq(await out(), "background: linear-gradient(360deg, #1636a3 0%, #6dd5ed 100%);", "360deg");
      t.eq(await value(t.page, "#g-angle-r"), "360", "slider at 360");
      await t.page.setValue("#g-angle-r", "45");
      t.eq(await value(t.page, "#g-angle"), "45", "number follows slider");
      t.eq(await out(), "background: linear-gradient(45deg, #1636a3 0%, #6dd5ed 100%);", "45deg");
      await t.page.setValue("#g-c-1", "tomato");
      await t.page.setValue("#g-p-1", "80");
      t.eq(await out(), "background: linear-gradient(45deg, #1636a3 0%, tomato 80%);", "edited stop");
      await t.page.click("#g-fallback");
      t.eq(await out(), "background: #1636a3;\nbackground: linear-gradient(45deg, #1636a3 0%, tomato 80%);", "fallback line");
      await t.page.click("#g-repeat");
      t.eq(await out(), "background: #1636a3;\nbackground: repeating-linear-gradient(45deg, #1636a3 0%, tomato 80%);", "repeating");
      await t.page.click("#g-fallback");
      // add a stop: goes before the last one at the midpoint
      await t.page.click("#g-add");
      t.eq(await out(), "background: repeating-linear-gradient(45deg, #1636a3 0%, #ffffff 40%, tomato 80%);", "added stop");
      t.eq(await t.page.eval(`document.querySelectorAll("#g-stops li").length`), 3, "three rows");
    },
  },
  {
    page: "css-gradient-generator",
    name: "radial shape and position, conic start angle and position",
    async run(t) {
      const out = () => value(t.page, "#g-out");
      await t.page.click('input[name="g-type"][value="radial"]');
      t.eq(await out(), "background: radial-gradient(circle at 50% 50%, #1636a3 0%, #6dd5ed 100%);", "radial default");
      t.eq(await t.page.eval(`${q("#g-angle-box")}.hidden`), true, "angle hidden for radial");
      await t.page.setValue("#g-shape", "ellipse");
      await t.page.setValue("#g-x", "30");
      await t.page.setValue("#g-y", "70");
      t.eq(await out(), "background: radial-gradient(ellipse at 30% 70%, #1636a3 0%, #6dd5ed 100%);", "ellipse position");
      await t.page.click('input[name="g-type"][value="conic"]');
      t.eq(await out(), "background: conic-gradient(from 90deg at 30% 70%, #1636a3 0%, #6dd5ed 100%);", "conic keeps position, uses the angle as start");
      t.eq(await text(t.page, "#g-angle-l"), "Start angle (degrees)", "conic label");
      await t.page.setValue("#g-angle", "0");
      await t.page.setValue("#g-x", "0");
      await t.page.setValue("#g-y", "100");
      t.eq(await out(), "background: conic-gradient(from 0deg at 0% 100%, #1636a3 0%, #6dd5ed 100%);", "conic corners");
      await t.page.click("#g-repeat");
      t.eq(await out(), "background: repeating-conic-gradient(from 0deg at 0% 100%, #1636a3 0%, #6dd5ed 100%);", "repeating conic");
      await t.page.setValue("#g-x", "150");
      t.assert(/centre position/.test(await text(t.page, "#g-msg")), "position out of range message");
      t.eq(await t.page.eval(`${q("#g-x")}.getAttribute("aria-invalid")`), "true", "x invalid");
      t.eq(await value(t.page, "#g-out"), "", "no output while invalid");
      t.eq(await t.page.eval(`${q("#g-copy")}.disabled`), true, "copy disabled");
    },
  },
  {
    page: "css-gradient-generator",
    name: "invalid colour input gives a message and keeps the last good preview",
    async run(t) {
      const prevBg = await t.page.eval(`getComputedStyle(${q("#g-preview")}).backgroundImage`);
      await t.page.setValue("#g-c-1", "notacolour");
      const msg = await text(t.page, "#g-msg");
      t.assert(msg.startsWith('Stop 2: "notacolour" is not a colour'), "message: " + msg);
      t.eq(await t.page.eval(`${q("#g-c-1")}.getAttribute("aria-invalid")`), "true", "aria-invalid on the field");
      t.eq(await value(t.page, "#g-out"), "", "no CSS output");
      t.eq(await t.page.eval(`getComputedStyle(${q("#g-preview")}).backgroundImage`), prevBg, "preview unchanged");
      for (const bad of ["", "var(--x)", "inherit", "#12", "12345g"]) {
        await t.page.setValue("#g-c-1", bad);
        t.eq(await value(t.page, "#g-out"), "", "rejects " + JSON.stringify(bad));
      }
      await t.page.setValue("#g-c-1", "rgb(10 20 30)");
      t.eq(await value(t.page, "#g-out"), "background: linear-gradient(90deg, #1636a3 0%, rgb(10 20 30) 100%);", "modern rgb accepted");
      t.eq(await t.page.eval(`${q("#g-c-1")}.hasAttribute("aria-invalid")`), false, "flag cleared");
      await t.page.setValue("#g-p-0", "120");
      t.assert(/position must be/.test(await text(t.page, "#g-msg")), "position message");
      await t.page.setValue("#g-p-0", "0");
      await t.page.setValue("#g-angle", "400");
      t.assert(/angle must be/.test(await text(t.page, "#g-msg")), "angle message");
    },
  },
  {
    page: "css-gradient-generator",
    name: "stop editing buttons",
    async run(t) {
      const out = () => value(t.page, "#g-out");
      const labels = () => t.page.eval(`[...document.querySelectorAll("#g-stops li")].map((li) => li.querySelector("input[type=text]").value + " " + li.querySelector("input[type=number]").value)`);
      await t.page.click("#g-add");
      await t.page.setValue("#g-c-1", "#ff0000");
      t.eq(await labels(), ["#1636a3 0", "#ff0000 50", "#6dd5ed 100"], "start");
      await t.page.click('button[aria-label="Move stop 2 down"]');
      t.eq(await labels(), ["#1636a3 0", "#6dd5ed 100", "#ff0000 50"], "stop 2 moved down");
      t.assert((await t.page.eval(`document.activeElement.getAttribute("aria-label")`)).startsWith("Move stop 3"), "focus is on the moved stop's row");
      await t.page.click("#g-sort");
      t.eq(await labels(), ["#1636a3 0", "#ff0000 50", "#6dd5ed 100"], "sorted");
      await t.page.click("#g-rev");
      t.eq(await labels(), ["#6dd5ed 0", "#ff0000 50", "#1636a3 100"], "reversed (positions mirrored)");
      await t.page.click('button[aria-label="Remove stop 2"]');
      t.eq(await out(), "background: linear-gradient(90deg, #6dd5ed 0%, #1636a3 100%);", "removed");
      t.eq(await t.page.eval(`[...document.querySelectorAll('#g-stops [data-act="rm"]')].map((b) => b.disabled)`), [true, true], "cannot go below two stops");
      for (let i = 0; i < 12; i++) await t.page.click("#g-add").catch(() => {});
      t.eq(await t.page.eval(`document.querySelectorAll("#g-stops li").length`), 10, "capped at ten stops");
      t.eq(await t.page.eval(`${q("#g-add")}.disabled`), true, "add disabled at ten");
    },
  },
  {
    page: "css-gradient-generator",
    name: "presets, and the preview's computed background equals what the browser parses from the output",
    async run(t) {
      await t.page.eval(`[...document.querySelectorAll("#g-presets button")].find((b) => b.textContent === "Hard stripes").click(), true`);
      t.eq(await value(t.page, "#g-out"), "background: linear-gradient(90deg, #1636a3 0%, #1636a3 50%, #f3c11a 50%, #f3c11a 100%);", "hard stripes");
      const names = await t.page.eval(`[...document.querySelectorAll("#g-presets button")].map((b) => b.textContent)`);
      t.assert(names.length >= 6, "presets listed");
      let seen = 0;
      for (const name of names) {
        await t.page.eval(`[...document.querySelectorAll("#g-presets button")].find((b) => b.textContent === ${JSON.stringify(name)}).click(), true`);
        for (const fb of [false, true]) {
          if ((await t.page.eval(`${q("#g-fallback")}.checked`)) !== fb) await t.page.click("#g-fallback");
          const r = await t.page.eval(`(() => {
            const css = ${q("#g-out")}.value;
            const probe = document.createElement("div");
            probe.style.cssText = css;
            document.body.append(probe);
            const parsed = getComputedStyle(probe).backgroundImage;
            probe.remove();
            return { css, parsed, shown: getComputedStyle(${q("#g-preview")}).backgroundImage };
          })()`);
          t.assert(/^(repeating-)?(linear|radial|conic)-gradient\(/.test(r.parsed), `browser parsed a gradient for ${name}: ${r.parsed}`);
          t.eq(r.shown, r.parsed, `preview equals parsed output for ${name}`);
          seen++;
        }
      }
      t.eq(seen, names.length * 2, "all presets checked with and without fallback");
      await t.page.eval(`[...document.querySelectorAll("#g-presets button")].find((b) => b.textContent === "Colour wheel").click(), true`);
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ meta tags */
  {
    page: "meta-tag-generator",
    name: "defaults, omitted empty fields, charset and viewport switches",
    async run(t) {
      t.eq(await value(t.page, "#m-out"), '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n', "defaults");
      await t.page.click("#m-charset");
      await t.page.click("#m-viewport");
      t.eq(await value(t.page, "#m-out"), "", "empty output");
      await t.page.setValue("#m-title", "   ");
      await t.page.setValue("#m-desc", "\n \n");
      await t.page.setValue("#m-ogt", " ");
      t.eq(await value(t.page, "#m-out"), "", "whitespace-only fields omitted");
      await t.page.setValue("#m-title", "Hello");
      t.eq(await value(t.page, "#m-out"), "<title>Hello</title>\n", "title only");
    },
  },
  {
    page: "meta-tag-generator",
    name: "escaping of quotes, ampersands and <script> in title and description",
    async run(t) {
      await t.page.click("#m-charset"); await t.page.click("#m-viewport");
      await t.page.setValue("#m-title", `Tom & "Jerry" <script>alert(1)</script> it's`);
      await t.page.setValue("#m-desc", `A "quote" & <b>bold</b> line\nsecond line`);
      await t.page.setValue("#m-canon", `https://example.com/?a=1&b="2"`);
      await t.page.setValue("#m-ogt", `<img src=x onerror=alert(1)>`);
      await t.page.setValue("#m-ogsite", `"Q&A"`);
      const o = await value(t.page, "#m-out");
      t.eq(o, [
        `<title>Tom &amp; &quot;Jerry&quot; &lt;script&gt;alert(1)&lt;/script&gt; it's</title>`,
        `<meta name="description" content="A &quot;quote&quot; &amp; &lt;b&gt;bold&lt;/b&gt; line second line">`,
        `<link rel="canonical" href="https://example.com/?a=1&amp;b=&quot;2&quot;">`.replace(/&quot;2&quot;/, "&quot;2&quot;"),
        `<meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;">`,
        `<meta property="og:site_name" content="&quot;Q&amp;A&quot;">`,
      ].join("\n") + "\n", "escaped output");
      t.assert(!o.includes("<script"), "no raw script tag");
      // the output parses back to the original strings in a real DOM
      const back = await t.page.eval(`(() => { const d = new DOMParser().parseFromString("<!doctype html><head>" + ${q("#m-out")}.value + "</head>", "text/html"); return [d.title, d.querySelector('meta[name=description]').content, d.querySelector('meta[property="og:site_name"]').content, d.querySelectorAll("script, img").length]; })()`);
      t.eq(back, [`Tom & "Jerry" <script>alert(1)</script> it's`, `A "quote" & <b>bold</b> line second line`, `"Q&A"`, 0], "round trip through the HTML parser");
    },
  },
  {
    page: "meta-tag-generator",
    name: "robots combinations",
    async run(t) {
      const robots = async () => (/<meta name="robots" content="([^"]*)">/.exec(await value(t.page, "#m-out")) || [])[1] || null;
      t.eq(await robots(), null, "index, follow writes no tag");
      await t.page.click('input[name="m-idx"][value="noindex"]');
      t.eq(await robots(), "noindex, follow", "noindex, follow");
      await t.page.click('input[name="m-fol"][value="nofollow"]');
      t.eq(await robots(), "noindex, nofollow", "noindex, nofollow");
      await t.page.click('input[name="m-idx"][value="index"]');
      t.eq(await robots(), "index, nofollow", "index, nofollow");
      await t.page.click('input[name="m-fol"][value="follow"]');
      t.eq(await robots(), null, "back to default");
    },
  },
  {
    page: "meta-tag-generator",
    name: "URL warnings for canonical, og:image and og:url",
    async run(t) {
      const warn = (id) => text(t.page, "#" + id);
      t.eq(await warn("m-ogi-w"), "", "no warning when empty");
      await t.page.setValue("#m-ogi", "/img/card.png");
      t.assert(/full address starting with https/.test(await warn("m-ogi-w")), "relative og:image: " + await warn("m-ogi-w"));
      t.eq(await t.page.eval(`${q("#m-ogi")}.getAttribute("aria-invalid")`), "true", "aria-invalid");
      await t.page.setValue("#m-ogi", "http://example.com/card.png");
      t.assert(/uses http:\/\//.test(await warn("m-ogi-w")), "http og:image");
      await t.page.setValue("#m-ogi", "example.com/card.png");
      t.assert(/full address/.test(await warn("m-ogi-w")), "no scheme");
      await t.page.setValue("#m-ogi", "https://example.com/card.png");
      t.eq(await warn("m-ogi-w"), "", "https is fine");
      t.eq(await t.page.eval(`${q("#m-ogi")}.hasAttribute("aria-invalid")`), false, "flag cleared");
      await t.page.setValue("#m-ogu", "page");
      t.assert(/^Check: og:url should be a full address/.test(await warn("m-ogu-w")), "og:url warning");
      await t.page.setValue("#m-canon", "ftp://example.com/");
      t.assert(/The canonical URL should start with https/.test(await warn("m-canon-w")), "canonical scheme: " + await warn("m-canon-w"));
      await t.page.setValue("#m-canon", "https://example.com/page");
      t.eq(await warn("m-canon-w"), "", "canonical fine");
      // warnings do not block output
      t.assert((await value(t.page, "#m-out")).includes('<meta property="og:url" content="page">'), "still emitted");
    },
  },
  {
    page: "meta-tag-generator",
    name: "length counters and guidance",
    async run(t) {
      const c = (id) => text(t.page, "#" + id);
      t.assert((await c("m-title-c")).startsWith("0 characters."), "empty title");
      await t.page.setValue("#m-title", "x".repeat(55));
      t.eq(await c("m-title-c"), "55 characters. In the usual range of about 50 to 60.", "55");
      await t.page.setValue("#m-title", "x".repeat(70));
      t.assert(/^70 characters\. Long;/.test(await c("m-title-c")), "70 is long");
      await t.page.setValue("#m-title", "Short");
      t.assert(/^5 characters\. Short;/.test(await c("m-title-c")), "short");
      await t.page.setValue("#m-title", "😀".repeat(10));
      t.assert(/^10 characters\./.test(await c("m-title-c")), "emoji count as one character each");
      await t.page.setValue("#m-desc", "d".repeat(155));
      t.eq(await c("m-desc-c"), "155 characters. In the usual range of about 150 to 160.", "155 description");
      await t.page.setValue("#m-desc", "d".repeat(200));
      t.assert(/^200 characters\. Long;/.test(await c("m-desc-c")), "200 long");
      await t.page.setValue("#m-desc", "d".repeat(20));
      t.assert(/^20 characters\. Short;/.test(await c("m-desc-c")), "20 short");
    },
  },
  {
    page: "meta-tag-generator",
    name: "full tag set, previews, and no image request when an og:image URL is typed",
    async run(t) {
      await t.page.setValue("#m-title", "Tanod Tools: free browser tools");
      await t.page.setValue("#m-desc", "Free tools that run in your browser. Nothing is uploaded.");
      await t.page.setValue("#m-canon", "https://tanod.dev/tools/");
      await t.page.click('input[name="m-idx"][value="noindex"]');
      await t.page.setValue("#m-ogt", "Tanod Tools");
      await t.page.setValue("#m-ogd", "Browser tools");
      await t.page.setValue("#m-ogi", "https://cdn.example.net/og/card.png");
      await t.page.setValue("#m-ogia", "A yellow sign");
      await t.page.setValue("#m-ogu", "https://tanod.dev/tools/");
      await t.page.setValue("#m-ogtype", "website");
      await t.page.setValue("#m-ogsite", "Tanod");
      await t.page.setValue("#m-ogloc", "en_GB");
      await t.page.setValue("#m-tw", "summary_large_image");
      await t.page.setValue("#m-tws", "@tanod");
      await t.page.setValue("#m-theme", "F60");
      t.eq(await value(t.page, "#m-out"), [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Tanod Tools: free browser tools</title>",
        '<meta name="description" content="Free tools that run in your browser. Nothing is uploaded.">',
        '<link rel="canonical" href="https://tanod.dev/tools/">',
        '<meta name="robots" content="noindex, follow">',
        '<meta name="theme-color" content="#ff6600">',
        '<meta property="og:title" content="Tanod Tools">',
        '<meta property="og:description" content="Browser tools">',
        '<meta property="og:type" content="website">',
        '<meta property="og:url" content="https://tanod.dev/tools/">',
        '<meta property="og:image" content="https://cdn.example.net/og/card.png">',
        '<meta property="og:image:alt" content="A yellow sign">',
        '<meta property="og:site_name" content="Tanod">',
        '<meta property="og:locale" content="en_GB">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:site" content="@tanod">',
      ].join("\n") + "\n", "all fields in order");
      t.eq(await text(t.page, "#m-serp-title"), "Tanod Tools: free browser tools", "serp title");
      t.eq(await text(t.page, "#m-serp-url"), "tanod.dev › tools", "serp url");
      t.eq(await text(t.page, "#m-card-img"), "https://cdn.example.net/og/card.png", "image address shown as text");
      t.eq(await text(t.page, "#m-card-host"), "TANOD.DEV", "card host");
      // nothing was requested for the image address, and no element could load it
      const r = await t.page.eval(`({
        imgs: document.querySelectorAll("img[src], picture, video, iframe, object, embed").length,
        res: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /example\\.net/.test(n)),
        bg: [...document.querySelectorAll("*")].some((e) => /url\\(/.test(getComputedStyle(e).backgroundImage) && /example/.test(getComputedStyle(e).backgroundImage)),
      })`);
      t.eq(r.imgs, 0, "no media elements");
      t.eq(r.res, [], "no resource entry for the image host");
      t.eq(r.bg, false, "no CSS background image from the typed address");
      await t.page.setValue("#m-tw", "summary");
      t.eq(await t.page.eval(`${q("#m-card")}.dataset.layout`), "summary", "summary layout");
      await t.page.setValue("#m-tw", "summary_large_image");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ Wi-Fi QR */
  {
    page: "wifi-qr-code-generator",
    name: "payload strings: plain, escaping, open network, hidden, WEP",
    async run(t) {
      const esc = (s) => { let o = ""; for (const ch of s) o += '\\;,:"'.includes(ch) ? "\\" + ch : ch; return o; };
      const payload = () => text(t.page, "#w-payload");
      const cases = [
        { ssid: "Home", pass: "secret", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:Home;P:secret;;" },
        { ssid: "Home", pass: "secret", sec: "WPA", hidden: true, want: "WIFI:T:WPA;S:Home;P:secret;H:true;;" },
        { ssid: "Home", pass: "", sec: "nopass", hidden: false, want: "WIFI:T:nopass;S:Home;;" },
        { ssid: "Cafe", pass: "ignored", sec: "nopass", hidden: true, want: "WIFI:T:nopass;S:Cafe;H:true;;" },
        { ssid: "Old", pass: "abcde", sec: "WEP", hidden: false, want: "WIFI:T:WEP;S:Old;P:abcde;;" },
        { ssid: "a\\b", pass: "back\\slash!", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:a\\\\b;P:back\\\\slash!;;" },
        { ssid: "semi;colon", pass: "p;q", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:semi\\;colon;P:p\\;q;;" },
        { ssid: "co:lon", pass: "a:b", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:co\\:lon;P:a\\:b;;" },
        { ssid: "com,ma", pass: "x,y,z1234", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:com\\,ma;P:x\\,y\\,z1234;;" },
        { ssid: 'quo"te', pass: 'p"w"12345', sec: "WPA", hidden: false, want: 'WIFI:T:WPA;S:quo\\"te;P:p\\"w\\"12345;;' },
        { ssid: 'a\\b;c,d:e"f', pass: 'p\\q;r,s:t"u', sec: "WPA", hidden: false, want: `WIFI:T:WPA;S:${esc('a\\b;c,d:e"f').replace(/^/, "")};P:${esc('p\\q;r,s:t"u')};;` },
        { ssid: "Café ✓", pass: "pässwörd", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:Café ✓;P:pässwörd;;" },
        { ssid: "12345678", pass: "12345678", sec: "WPA", hidden: false, want: "WIFI:T:WPA;S:12345678;P:12345678;;" },
      ];
      // the escaping rule written out by hand: a backslash goes in front of \ ; , : "
      t.eq(esc('a\\b;c,d:e"f'), 'a\\\\b\\;c\\,d\\:e\\"f', "reference escape");
      for (const c of cases) {
        await t.page.setValue("#w-ssid", c.ssid);
        await t.page.setValue("#w-sec", c.sec);
        await t.page.eval(`(() => { const p = document.querySelector("#w-pass"); p.disabled = false; return true; })()`);
        await t.page.setValue("#w-pass", c.pass);
        if ((await t.page.eval(`${q("#w-hidden")}.checked`)) !== c.hidden) await t.page.click("#w-hidden");
        await t.page.waitFor(`document.querySelector("#w-payload").textContent === ${JSON.stringify(c.want)}`, { message: "payload for " + JSON.stringify(c.ssid) });
        t.eq(await payload(), c.want, JSON.stringify(c.ssid));
        if (c.sec === "nopass") t.assert(!(await payload()).includes("P:"), "open network has no P field");
      }
    },
  },
  {
    page: "wifi-qr-code-generator",
    name: "QR size, PNG and SVG downloads, empty state, password hints",
    async run(t) {
      t.eq(await t.page.eval(`${q("#w-png")}.disabled`), true, "disabled while empty");
      t.assert(/Enter a network name/.test(await text(t.page, "#w-payload")), "empty readout");
      await t.page.setValue("#w-ssid", "Guest Wi-Fi");
      await t.page.setValue("#w-pass", "short");
      await t.page.waitFor(`/8 to 63/.test(document.querySelector("#w-warn").textContent)`);
      t.assert(/8 to 63/.test(await text(t.page, "#w-warn")), "short WPA warning");
      await t.page.setValue("#w-pass", "correct horse battery");
      await t.page.waitFor(`document.querySelector("#w-warn").hidden`);
      const want = "WIFI:T:WPA;S:Guest Wi-Fi;P:correct horse battery;;";
      const n = qrCount(want, "M");
      await t.page.waitFor(`document.querySelector("#w-info").textContent.startsWith("${n} by ${n} modules")`);
      const total = n + 8, scale = Math.floor(512 / total);
      const png = await t.dl("#w-png");
      t.eq(png.name, "wifi-qr-code.png", "png name");
      const im = imageInfo(png.bytes);
      t.eq([im.format, im.width, im.height], ["png", total * scale, total * scale], "png dims");
      const svg = (await t.dl("#w-svg")).bytes.toString("utf8");
      t.assert(svg.includes("<svg") && svg.includes("<path") && svg.includes(`viewBox="0 0 ${total} ${total}"`), "svg has a path and the viewBox");
      await t.page.setValue("#w-ec", "H");
      const nh = qrCount(want, "H");
      await t.page.waitFor(`document.querySelector("#w-info").textContent.startsWith("${nh} by ${nh} modules")`);
      await t.page.setValue("#w-ssid", "x".repeat(2000));
      await t.page.setValue("#w-pass", "y".repeat(2000));
      t.assert(/too long/.test(await t.waitError()), "too long message");
      t.eq(await t.page.eval(`${q("#w-png")}.disabled`), true, "png disabled when too long");
    },
  },
  {
    page: "wifi-qr-code-generator",
    name: "printable Wi-Fi card PNG, with and without the password",
    async run(t) {
      await t.page.setValue("#w-ssid", "Guest Wi-Fi");
      await t.page.setValue("#w-pass", "correct horse battery");
      await t.page.waitFor(`!document.querySelector("#w-card").disabled`);
      const a = await t.dl("#w-card");
      t.eq(a.name, "wifi-card.png", "card name");
      let im = imageInfo(a.bytes);
      t.eq([im.format, im.width, im.height], ["png", 900, 1100], "card size");
      t.eq(await t.page.eval(`document.fonts.check("800 20px Archivo")`), true, "Archivo is loaded for the card");
      await t.page.click("#w-cardpass");
      const b = await t.dl("#w-card");
      im = imageInfo(b.bytes);
      t.eq([im.width, im.height], [900, 1100], "card size with password");
      t.assert(!a.bytes.equals(b.bytes), "printing the password changes the card");
      // very long names and passwords still produce a card
      await t.page.setValue("#w-ssid", "N".repeat(32));
      await t.page.setValue("#w-pass", "P".repeat(63));
      const c = await t.dl("#w-card");
      t.eq(imageInfo(c.bytes).width, 900, "long card");
      await t.page.setValue("#w-ssid", "Guest Wi-Fi");
      await t.page.setValue("#w-pass", "correct horse battery");
      await t.page.click("#w-show");
      t.eq(await t.page.eval(`${q("#w-pass")}.type`), "text", "show password");
      await t.page.setValue("#w-sec", "nopass");
      await t.page.waitFor(`document.querySelector("#w-pass").disabled`);
      await t.page.setValue("#w-sec", "WPA");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ vCard QR */
  {
    page: "vcard-qr-code-generator",
    name: "exact vCard text for a full contact (commas, semicolons, newline, accents)",
    async run(t) {
      const f = {
        "#v-first": "José", "#v-last": "Núñez-Smith, Jr.", "#v-org": "Acme; Widgets, Inc.", "#v-title": "Head of R&D",
        "#v-mobile": "+44 7700 900123", "#v-work": "+44 20 7946 0000", "#v-email": "jose@example.com", "#v-url": "https://example.com/a,b?x=1;y=2",
        "#v-street": "12 Rue de l'Église, Apt 4", "#v-city": "Paris", "#v-region": "Île-de-France", "#v-post": "75001", "#v-country": "France",
        "#v-note": "Line one, with comma;\nLine two \\ backslash",
      };
      for (const [sel, v] of Object.entries(f)) await t.page.setValue(sel, v);
      const want = [
        "BEGIN:VCARD", "VERSION:3.0",
        "N:Núñez-Smith\\, Jr.;José;;;",
        "FN:José Núñez-Smith\\, Jr.",
        "ORG:Acme\\; Widgets\\, Inc.",
        "TITLE:Head of R&D",
        "TEL;TYPE=CELL:+44 7700 900123",
        "TEL;TYPE=WORK,VOICE:+44 20 7946 0000",
        "EMAIL;TYPE=INTERNET:jose@example.com",
        "URL:https://example.com/a,b?x=1;y=2",
        "ADR;TYPE=WORK:;;12 Rue de l'Église\\, Apt 4;Paris;Île-de-France;75001;France",
        "NOTE:Line one\\, with comma\\;\\nLine two \\\\ backslash",
        "END:VCARD", "",
      ].join("\r\n");
      await t.page.waitFor(`document.querySelector("#v-text").textContent === ${JSON.stringify(want.replace(/\r\n/g, "\n"))}`);
      const vcf = await t.dl("#v-vcf");
      t.eq(vcf.name, "jose-nunez-smith-jr.vcf", "file name");
      t.eq(vcf.bytes.toString("utf8"), want, "downloaded .vcf is exactly the vCard, UTF-8");
      t.assert(!/[^\r]\n/.test(vcf.bytes.toString("utf8")) && !/\r(?!\n)/.test(vcf.bytes.toString("utf8")), "CRLF line endings only");
      t.eq((await text(t.page, "#v-text")).replace(/\n/g, "\r\n") + "\r\n", want, "readout equals file (LF shown, CRLF saved)");
      // QR version/size from the independent library
      const n = qrCount(want, "M");
      t.assert((await text(t.page, "#v-info")).startsWith(`Version ${(n - 17) / 4}, ${n} by ${n} modules`), "QR info: " + await text(t.page, "#v-info"));
      t.assert(!(await t.page.eval(`${q("#v-warn")}.hidden`)) === ((n - 17) / 4 >= 10), "density warning matches version");
      const png = await t.dl("#v-png");
      const total = n + 8;
      t.eq([imageInfo(png.bytes).width], [total * Math.floor(512 / total)], "png size");
      const svg = (await t.dl("#v-svg")).bytes.toString("utf8");
      t.assert(svg.includes("<path") && svg.includes(`viewBox="0 0 ${total} ${total}"`), "svg");
    },
  },
  {
    page: "vcard-qr-code-generator",
    name: "empty fields omitted; organisation-only; no name disables output",
    async run(t) {
      t.eq(await t.page.eval(`${q("#v-vcf")}.disabled`), true, "disabled while empty");
      await t.page.setValue("#v-email", "x@example.com");
      t.eq(await t.page.eval(`${q("#v-vcf")}.disabled`), true, "email alone is not enough");
      await t.page.setValue("#v-email", "");
      await t.page.setValue("#v-first", "Ana");
      await t.page.waitFor(`document.querySelector("#v-text").textContent.includes("FN:Ana")`);
      t.eq((await text(t.page, "#v-text")), "BEGIN:VCARD\nVERSION:3.0\nN:;Ana;;;\nFN:Ana\nEND:VCARD", "first name only");
      await t.page.setValue("#v-first", "");
      await t.page.setValue("#v-org", "Acme");
      await t.page.waitFor(`document.querySelector("#v-text").textContent.includes("FN:Acme")`);
      t.eq((await text(t.page, "#v-text")), "BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:Acme\nORG:Acme\nEND:VCARD", "organisation only");
      await t.page.setValue("#v-city", "Paris");
      await t.page.waitFor(`document.querySelector("#v-text").textContent.includes("ADR")`);
      t.assert((await text(t.page, "#v-text")).includes("ADR;TYPE=WORK:;;;Paris;;;"), "address with only a city keeps its positions");
      await t.page.setValue("#v-city", "  ");
      await t.page.waitFor(`!document.querySelector("#v-text").textContent.includes("ADR")`);
      t.assert(!(await text(t.page, "#v-text")).includes("TEL"), "no phone lines");
      const d = await t.dl("#v-vcf");
      t.eq(d.name, "acme.vcf", "org file name");
    },
  },
  {
    page: "vcard-qr-code-generator",
    name: "QR version grows with content and a dense code gets a warning",
    async run(t) {
      const ver = async () => Number(/^Version (\d+)/.exec(await text(t.page, "#v-info"))[1]);
      await t.page.setValue("#v-first", "Ana");
      await t.page.waitFor(`/^Version/.test(document.querySelector("#v-info").textContent)`);
      const v1 = await ver();
      t.eq(await t.page.eval(`${q("#v-warn")}.hidden`), true, "no warning for a small card");
      await t.page.setValue("#v-email", "ana@example.com");
      await t.page.setValue("#v-street", "1 Long Street Name Road");
      await t.page.setValue("#v-city", "Springfield");
      await t.page.waitFor(`document.querySelector("#v-text").textContent.includes("Springfield")`);
      const v2 = await ver();
      t.assert(v2 > v1, `version grows: ${v1} -> ${v2}`);
      await t.page.setValue("#v-note", "word ".repeat(120));
      await t.page.waitFor(`!document.querySelector("#v-warn").hidden`);
      const v3 = await ver();
      t.assert(v3 > v2 && v3 >= 10, `version grows again: ${v3}`);
      t.assert(/dense \(version \d+\)/.test(await text(t.page, "#v-warn")) && /Dropping the note/.test(await text(t.page, "#v-warn")), "dense warning text");
      const full = (await t.dl("#v-vcf")).bytes.toString("utf8");
      const n = qrCount(full, "M");
      t.eq(v3, (n - 17) / 4, "version equals the independent library");
      await t.page.setValue("#v-ec", "L");
      const nl = qrCount(full, "L");
      await t.page.waitFor(`document.querySelector("#v-info").textContent.startsWith("Version ${(nl - 17) / 4},")`);
      await t.page.setValue("#v-note", "word ".repeat(1000));
      t.assert(/too long/.test(await t.waitError()), "too long message");
      t.eq(await t.page.eval(`${q("#v-vcf")}.disabled`), false, ".vcf still available");
      await t.page.setValue("#v-note", "Met at the conference");
      await t.page.setValue("#v-first", "Ana");
      await t.page.setValue("#v-last", "Reyes");
      await t.page.setValue("#v-mobile", "+63 917 555 0100");
      await t.page.waitFor(`/^Version/.test(document.querySelector("#v-info").textContent)`);
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },

  /* ============================================================ barcode */
  {
    page: "barcode-generator",
    name: "EAN-13, UPC-A, EAN-8, ITF-14: check digits calculated or verified",
    async run(t) {
      const set = async (fmt, v) => { await t.page.setValue("#b-fmt", fmt); await t.page.setValue("#b-val", v); await t.page.waitFor(`document.querySelector("#b-msg").textContent !== ""`); await new Promise((r) => setTimeout(r, 250)); };
      const msg = () => text(t.page, "#b-msg");
      const drawn = () => t.page.eval(`${q("#b-svg")}.dataset.text || ""`);
      await set("EAN13", "400638133393");
      t.eq(await drawn(), "4006381333931", "EAN-13 check digit 1");
      t.assert((await msg()).includes("Check digit 1 calculated and added"), "msg: " + await msg());
      await set("EAN13", "4006381333931");
      t.assert((await msg()).includes("Check digit 1 is correct"), "verified: " + await msg());
      await set("UPC", "03600029145");
      t.eq(await drawn(), "036000291452", "UPC-A check digit 2");
      await set("EAN8", "9638507");
      t.eq(await drawn(), "96385074", "EAN-8 check digit 4");
      const itf = "1540014128876";
      await set("ITF14", itf);
      t.eq(await drawn(), itf + gs1(itf), "ITF-14 check digit");
      t.eq(gs1(itf), 3, "reference ITF-14 check digit");
      await set("ITF14", itf + gs1(itf));
      t.assert((await msg()).includes("is correct"), "ITF-14 verified");
      // reference values for several random numbers
      for (let i = 0; i < 6; i++) {
        const d = String(Math.floor(Math.random() * 1e12)).padStart(12, "0");
        await set("EAN13", d);
        t.eq(await drawn(), d + gs1(d), "random EAN-13 " + d);
      }
    },
  },
  {
    page: "barcode-generator",
    name: "wrong check digit is reported, not silently fixed; letters and wrong lengths give messages",
    async run(t) {
      const set = async (fmt, v) => { await t.page.setValue("#b-fmt", fmt); await t.page.setValue("#b-val", v); await t.page.waitFor(`document.querySelector("#b-msg").textContent !== ""`); await new Promise((r) => setTimeout(r, 250)); };
      const msg = () => text(t.page, "#b-msg");
      await set("EAN13", "4006381333932");
      t.assert(/The check digit is wrong\. For 400638133393 it should be 1, but you typed 2\./.test(await msg()), "wrong check digit: " + await msg());
      t.eq(await t.page.eval(`${q("#b-val")}.value`), "4006381333932", "input not modified");
      t.eq(await t.page.eval(`getComputedStyle(${q("#b-svg")}).display`), "none", "no barcode drawn");
      t.eq(await t.page.eval(`${q("#b-dlsvg")}.disabled && ${q("#b-dlpng")}.disabled`), true, "downloads disabled");
      t.eq(await t.page.eval(`${q("#b-val")}.getAttribute("aria-invalid")`), "true", "aria-invalid");
      await set("EAN13", "40063813339x");
      t.assert(/digits only, but the value contains "x"/.test(await msg()), "letter: " + await msg());
      await set("EAN13", "12345");
      t.assert(/needs 12 digits, or 13/.test(await msg()), "length: " + await msg());
      await set("UPC", "036000291453");
      t.assert(/it should be 2, but you typed 3/.test(await msg()), "UPC wrong: " + await msg());
      await set("EAN8", "96385075");
      t.assert(/it should be 4, but you typed 5/.test(await msg()), "EAN-8 wrong");
      await set("ITF14", "15400141288764");
      t.assert(/it should be 3, but you typed 4/.test(await msg()), "ITF-14 wrong");
      await set("ITF", "123");
      t.assert(/even number of digits/.test(await msg()), "ITF odd");
      await set("pharmacode", "2");
      t.assert(/3 to 131070/.test(await msg()), "pharmacode range");
      await set("CODE128", "café");
      t.assert(/standard ASCII/.test(await msg()), "code128 non-ascii: " + await msg());
      await set("EAN13", "400638133393");
      t.eq(await t.page.eval(`${q("#b-val")}.hasAttribute("aria-invalid")`), false, "flag cleared on recovery");
      t.eq(await t.page.eval(`${q("#b-dlsvg")}.disabled`), false, "downloads enabled again");
    },
  },
  {
    page: "barcode-generator",
    name: "UPC-E check digit and Code 39 lowercase handling",
    async run(t) {
      const set = async (fmt, v) => { await t.page.setValue("#b-fmt", fmt); await t.page.setValue("#b-val", v); await t.page.waitFor(`document.querySelector("#b-msg").textContent !== ""`); await new Promise((r) => setTimeout(r, 250)); };
      const msg = () => text(t.page, "#b-msg");
      const drawn = () => t.page.eval(`${q("#b-svg")}.dataset.text || ""`);
      for (const six of ["123456", "654320", "123453", "123454", "123459", "123451"]) {
        const want = "0" + six + gs1(upcEPad("0", six));
        await set("UPCE", six);
        t.eq(await drawn(), want, "UPC-E from 6 digits " + six);
        await set("UPCE", "0" + six);
        t.eq(await drawn(), want, "UPC-E from 7 digits " + six);
        await set("UPCE", want);
        t.eq(await drawn(), want, "UPC-E from 8 digits " + six);
        t.assert((await msg()).includes("is correct"), "UPC-E verified");
      }
      await set("UPCE", "1234567");
      t.eq(await drawn(), "1" + "234567" + gs1(upcEPad("1", "234567")), "number system 1");
      await set("UPCE", "01234560");
      t.assert(/check digit is wrong/.test(await msg()), "UPC-E wrong check: " + await msg());
      await set("UPCE", "2234567");
      t.assert(/number system 0 or 1/.test(await msg()), "UPC-E number system");
      await set("CODE39", "abc-1 x");
      t.eq(await drawn(), "ABC-1 X", "lowercase converted");
      t.assert(/Lowercase letters were converted to capitals/.test(await msg()), "says so: " + await msg());
      await set("CODE39", "ABC-1");
      t.assert(!/Lowercase/.test(await msg()), "no lowercase note for capitals");
      await set("CODE39", "ab@");
      t.assert(/cannot encode "@"/.test(await msg()), "invalid char");
      await set("codabar", "a1234b");
      t.eq(await drawn(), "A1234B", "codabar capitals");
      await set("MSI", "12345");
      t.eq(await drawn(), "12345", "msi");
      await set("pharmacode", "1234");
      t.eq(await drawn(), "1234", "pharmacode");
      await set("ITF", "1234");
      t.eq(await drawn(), "1234", "itf");
    },
  },
  {
    page: "barcode-generator",
    name: "SVG has rects with the chosen colours; PNG has the SVG's size times the scale",
    async run(t) {
      const set = async (fmt, v) => { await t.page.setValue("#b-fmt", fmt); await t.page.setValue("#b-val", v); await t.page.waitFor(`document.querySelector("#b-msg").textContent !== ""`); await new Promise((r) => setTimeout(r, 250)); };
      await set("CODE128", "ABC");
      await t.page.click("#b-text");
      await t.page.setValue("#b-w", "2");
      await t.page.setValue("#b-h", "100");
      await t.page.setValue("#b-m", "10");
      await t.page.setValue("#b-fg", "#ff0000");
      await t.page.setValue("#b-bg", "#ffffee");
      await new Promise((r) => setTimeout(r, 300));
      // Code 128: start 11 + 3 x 11 + check 11 + stop 13 modules
      const modules = 11 + 33 + 11 + 13;
      const dims = await t.page.eval(`[${q("#b-svg")}.getAttribute("width"), ${q("#b-svg")}.getAttribute("height")].map(parseFloat)`);
      t.eq(dims, [modules * 2 + 20, 120], "svg size without text: modules x bar width + margins");
      const svgDl = await t.dl("#b-dlsvg");
      t.eq(svgDl.name, "barcode.svg", "svg name");
      const s = svgDl.bytes.toString("utf8");
      t.assert(s.includes('xmlns="http://www.w3.org/2000/svg"'), "xmlns present");
      const rects = (s.match(/<rect/g) || []).length;
      t.assert(rects > 5, "bars drawn as rects: " + rects);
      t.assert(/#ff0000|rgb\(255, ?0, ?0\)/i.test(s) && /#ffffee|rgb\(255, ?255, ?238\)/i.test(s), "chosen colours in the file");
      t.assert(!s.includes("<text"), "no text element when text is off");
      await t.page.setValue("#b-scale", "3");
      const png = await t.dl("#b-dlpng");
      t.eq(png.name, "barcode.png", "png name");
      const im = imageInfo(png.bytes);
      t.eq([im.format, im.width, im.height], ["png", dims[0] * 3, dims[1] * 3], "png dimensions = svg x scale");
      await t.page.click("#b-text");
      await new Promise((r) => setTimeout(r, 300));
      const s2 = (await t.dl("#b-dlsvg")).bytes.toString("utf8");
      t.assert(s2.includes("<text") && s2.includes("ABC"), "text element with the value when text is on");
      const dims2 = await t.page.eval(`[${q("#b-svg")}.getAttribute("width"), ${q("#b-svg")}.getAttribute("height")].map(parseFloat)`);
      t.assert(dims2[1] > dims[1], "taller with text");
      await t.page.setValue("#b-scale", "1");
      const im2 = imageInfo((await t.dl("#b-dlpng")).bytes);
      t.eq([im2.width, im2.height], dims2, "png at 1x with text");
      // an EAN-13 draws 95 modules plus its guard layout
      await t.page.click("#b-text");
      await set("EAN13", "400638133393");
      await new Promise((r) => setTimeout(r, 300));
      const e = await t.page.eval(`[${q("#b-svg")}.getAttribute("width"), ${q("#b-svg")}.getAttribute("height")].map(parseFloat)`);
      t.eq(e[0], 95 * 2 + 20, "EAN-13 is 95 modules wide");
      await t.page.setValue("#b-fg", "#000000");
      await t.page.setValue("#b-bg", "#ffffff");
      await t.page.click("#b-text");
      await set("EAN13", "400638133393");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
];
