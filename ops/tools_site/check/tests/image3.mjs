// Batch D image tools: merge images, add text, filters, borders, placeholder generator.
// Fixtures are built here with known colours; expected values are computed here from the documented formulas.
import { deflateSync } from "node:zlib";
import { imageInfo, save, unzip } from "../fixtures.mjs";

const DROP = "#drop input[type=file]";

/* ------------------------------------------------------------------ fixtures and inspection helpers */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/* RGBA PNG; px(x, y) returns [r, g, b, a]. */
function pngFrom(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const p = px(x, y);
      raw[i] = p[0]; raw[i + 1] = p[1]; raw[i + 2] = p[2]; raw[i + 3] = p[3] === undefined ? 255 : p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const solid = (w, h, c) => pngFrom(w, h, () => c);

const RED = [220, 30, 30, 255], BLUE = [30, 60, 220, 255], GREEN = [30, 180, 60, 255], GREY = [128, 128, 128, 255];

/* Decode an image in the page and read pixels [[x, y], ...] as [r, g, b, a]. */
async function pixels(t, bytes, points) {
  return t.page.eval(`(async () => {
    const bin = atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))});
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]), { premultiplyAlpha: "none" });
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    return ${JSON.stringify(points)}.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data));
  })()`);
}
/* All pixels of an image as a flat RGBA array plus size. */
async function allPixels(t, bytes) {
  return t.page.eval(`(async () => {
    const bin = atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))});
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  })()`);
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const same = (t, got, want, msg, tol = 0) => t.assert(near(got, want, tol), `${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* ------------------------------------------------------------------ merge images */

async function mergeReady(t, n) {
  await t.page.waitFor(`document.querySelectorAll("#files > li").length === ${n} && !document.querySelector("#go").disabled`);
}
async function mergeRun(t) {
  await t.page.click("#go");
  await t.waitDone();
  return (await t.dl()).bytes;
}

/* ------------------------------------------------------------------ add text */

const textReady = (t) => t.page.waitFor(`!document.querySelector("#editor").hidden && document.querySelector("#preview").width > 1`);
async function textSave(t) {
  await t.page.click("#go");
  await t.waitDone();
  return t.dl();
}
const checkbox = (t, sel, on) => t.page.eval(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); if (c.checked !== ${on}) c.click(); return true; })()`);

/* ------------------------------------------------------------------ filters */

const fltReady = (t) => t.page.waitFor(`!document.querySelector("#editor").hidden && document.querySelector("#preview").width > 0`);
async function fltRun(t, settings, file) {
  for (const [k, v] of Object.entries(settings)) await t.page.setValue(`#f-${k}`, String(v));
  await t.page.waitFor(`!document.querySelector("#go").disabled`);
  await t.page.click("#go");
  await t.waitDone();
  return (await t.dl()).bytes;
}
const c255 = (v) => Math.min(255, Math.max(0, v));

/* Expected values for the CSS Filter Effects matrices, written out independently of the page code. */
const expect = {
  gray: ([r, g, b]) => { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [y, y, y].map((v) => Math.round(v)); },
  sepia: ([r, g, b]) => [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b].map((v) => Math.round(c255(v))),
  sat0: ([r, g, b]) => { const y = 0.213 * r + 0.715 * g + 0.072 * b; return [y, y, y].map((v) => Math.round(v)); },
};
// hue-rotate(180deg): cos = -1, sin = 0 in the CSS matrix
const hue180 = ([r, g, b]) => {
  const cs = -1, sn = 0;
  return [
    (0.213 + cs * 0.787 - sn * 0.213) * r + (0.715 - cs * 0.715 - sn * 0.715) * g + (0.072 - cs * 0.072 + sn * 0.928) * b,
    (0.213 - cs * 0.213 + sn * 0.143) * r + (0.715 + cs * 0.285 + sn * 0.14) * g + (0.072 - cs * 0.072 - sn * 0.283) * b,
    (0.213 - cs * 0.213 - sn * 0.787) * r + (0.715 - cs * 0.715 + sn * 0.715) * g + (0.072 + cs * 0.928 + sn * 0.072) * b,
  ].map((v) => Math.round(c255(v)));
};

const SAMPLES = [[255, 0, 0], [10, 20, 30], [100, 100, 100], [200, 50, 10]];
const samplePng = () => pngFrom(4, 1, (x) => [...SAMPLES[x], 255]);

/* ------------------------------------------------------------------ border */

async function bordReady(t, n = 1) {
  await t.page.waitFor(`document.querySelectorAll("#files > li").length === ${n} && !document.querySelector("#go").disabled`);
}
async function bordRun(t, opts = {}) {
  for (const [sel, v] of Object.entries(opts)) {
    if (sel.startsWith("click:")) await t.page.click(sel.slice(6)); else await t.page.setValue(sel, v);
  }
  await t.page.click("#go");
  await t.waitDone();
  return t.dl();
}

export default [
  /* ================================================================== merge-images */
  {
    page: "merge-images",
    name: "side by side: 100×50 + 60×80 = 160×80, centred, gap and background colour exact",
    async run(t) {
      const a = save(t.fixtures, "a.png", solid(100, 50, RED)), b = save(t.fixtures, "b.png", solid(60, 80, BLUE));
      await t.page.setFiles(DROP, [a, b]);
      await mergeReady(t, 2);
      t.assert((await t.page.eval(`document.querySelector("#summary").textContent`)).includes("160 × 80"), "summary shows size");
      let bytes = await mergeRun(t);
      let info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["png", 160, 80], "no gap");
      // A (100x50) is centred vertically: rows 15..64. B fills x 100..159.
      let [ar, above, br] = await pixels(t, bytes, [[10, 40], [10, 5], [130, 40]]);
      same(t, ar, RED, "A colour"); same(t, above, [255, 255, 255, 255], "background above A"); same(t, br, BLUE, "B colour");
      // gap 10 and a green background
      await t.page.setValue("#gap", "10");
      await t.page.setValue("#bg", "#00ff00");
      await t.page.waitFor(`document.querySelector("#summary").textContent.includes("170 × 80")`);
      bytes = await mergeRun(t);
      info = imageInfo(bytes);
      t.eq([info.width, info.height], [170, 80], "with gap");
      const [gap, bAfter, aEdge] = await pixels(t, bytes, [[105, 40], [115, 40], [99, 40]]);
      same(t, gap, [0, 255, 0, 255], "gap pixel is the background"); same(t, bAfter, BLUE, "B after gap"); same(t, aEdge, RED, "A last column");
      // align start puts the short picture at the top
      await t.page.click('input[name=align][value=start]');
      bytes = await mergeRun(t);
      const [top, below] = await pixels(t, bytes, [[10, 2], [10, 60]]);
      same(t, top, RED, "A at top with start alignment"); same(t, below, [0, 255, 0, 255], "background below A");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "merge-images",
    name: "match sizes: same height keeps proportions; stacked 100×130 with alignment",
    async run(t) {
      const a = save(t.fixtures, "a.png", solid(100, 50, RED)), b = save(t.fixtures, "b2.png", solid(80, 100, BLUE));
      await t.page.setFiles(DROP, [a, b]);
      await mergeReady(t, 2);
      await t.page.setValue("#scale", "min");
      await t.page.waitFor(`document.querySelector("#summary").textContent.includes("140 × 50")`);
      let bytes = await mergeRun(t);
      let info = imageInfo(bytes);
      t.eq([info.width, info.height], [140, 50], "scaled to the smallest height: 100 + 80*50/100");
      let [pa, pb] = await pixels(t, bytes, [[50, 25], [120, 25]]);
      same(t, pa, RED, "A"); same(t, pb, BLUE, "B");
      await t.page.setValue("#scale", "max");
      bytes = await mergeRun(t);
      info = imageInfo(bytes);
      t.eq([info.width, info.height], [280, 100], "scaled to the largest height: 100*100/50 + 80");
      [pa, pb] = await pixels(t, bytes, [[100, 50], [250, 50]]);
      same(t, pa, RED, "A enlarged"); same(t, pb, BLUE, "B");
      // stacked, no scaling: 100 wide, 50 + 80 tall
      await t.page.setValue("#scale", "none");
      await t.page.click("input[name=layout][value=column]");
      await t.page.click("#files li:last-child [data-act=remove]");
      await t.page.setFiles(DROP, [save(t.fixtures, "b.png", solid(60, 80, BLUE))]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 2 && document.querySelector("#summary").textContent.includes("100 × 130")`);
      await t.page.click("input[name=align][value=end]");
      bytes = await mergeRun(t);
      info = imageInfo(bytes);
      t.eq([info.width, info.height], [100, 130], "stacked");
      const [left, right, aTop] = await pixels(t, bytes, [[10, 100], [90, 100], [10, 10]]);
      same(t, left, [255, 255, 255, 255], "end alignment leaves the left of B empty"); same(t, right, BLUE, "B on the right"); same(t, aTop, RED, "A on top");
    },
  },
  {
    page: "merge-images",
    name: "grid: 2 columns, 3 images; transparent background; JPEG output",
    async run(t) {
      const a = save(t.fixtures, "a.png", solid(100, 50, RED)), b = save(t.fixtures, "b.png", solid(60, 80, BLUE)), c = save(t.fixtures, "c.png", solid(40, 40, GREEN));
      await t.page.setFiles(DROP, [a, b, c]);
      await mergeReady(t, 3);
      await t.page.click("input[name=layout][value=grid]");
      await t.page.waitFor(`!document.querySelector("#cols-field").hidden && document.querySelector("#summary").textContent.includes("160 × 120")`);
      let bytes = await mergeRun(t);
      let info = imageInfo(bytes);
      t.eq([info.width, info.height], [160, 120], "columns 100 + 60, rows 80 + 40");
      const [pa, pb, pc, empty, cLeft] = await pixels(t, bytes, [[50, 40], [130, 40], [50, 100], [130, 100], [5, 100]]);
      same(t, pa, RED, "A in cell 1"); same(t, pb, BLUE, "B in cell 2"); same(t, pc, GREEN, "C in cell 3");
      same(t, empty, [255, 255, 255, 255], "the empty fourth cell is background"); same(t, cLeft, [255, 255, 255, 255], "C is centred in its cell");
      // 3 columns puts everything in one row of 200 x 80
      await t.page.setValue("#cols", "3");
      await t.page.waitFor(`document.querySelector("#summary").textContent.includes("200 × 80")`);
      // transparent background
      await t.page.setValue("#cols", "2");
      await t.page.click("#transparent");
      bytes = await mergeRun(t);
      const [clear, solidA] = await pixels(t, bytes, [[130, 100], [50, 40]]);
      t.eq(clear[3], 0, "transparent background has alpha 0"); same(t, solidA, RED, "picture stays opaque");
      // JPEG: transparency is not available, the colour is used
      await t.page.click("input[name=fmt][value=jpeg]");
      t.eq(await t.page.eval(`document.querySelector("#transparent").disabled`), true, "transparent option disabled for JPEG");
      bytes = await mergeRun(t);
      info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["jpeg", 160, 120], "jpeg output");
      const [jbg, jred] = await pixels(t, bytes, [[130, 100], [50, 40]]);
      same(t, jbg, [255, 255, 255, 255], "JPEG gap is white", 6); same(t, jred, RED, "JPEG red", 14);
    },
  },
  {
    page: "merge-images",
    name: "order: down button swaps pictures, focus follows, remove works",
    async run(t) {
      const a = save(t.fixtures, "a.png", solid(100, 50, RED)), b = save(t.fixtures, "b.png", solid(60, 80, BLUE));
      await t.page.setFiles(DROP, [a, b]);
      await mergeReady(t, 2);
      t.eq(await t.page.eval(`document.querySelector("#files li:first-child [data-act=up]").disabled`), true, "first item cannot move up");
      await t.page.click("#files li:first-child [data-act=down]");
      t.eq(await t.page.eval(`document.querySelector("#files").textContent.indexOf("b.png") < document.querySelector("#files").textContent.indexOf("a.png")`), true, "b.png is now first");
      t.eq(await t.page.eval(`document.activeElement.getAttribute("aria-label")`), "Move a.png up", "focus stays with the moved item (its down button is now disabled)");
      const bytes = await mergeRun(t);
      t.eq([imageInfo(bytes).width, imageInfo(bytes).height], [160, 80], "same size either way");
      const [first, second] = await pixels(t, bytes, [[10, 40], [100, 40]]);
      same(t, first, BLUE, "B is now on the left"); same(t, second, RED, "A on the right");
      await t.page.click("#files li:first-child [data-act=up]".replace("first-child", "last-child"));
      t.eq(await t.page.eval(`document.querySelector("#files li:first-child .files__name").textContent.startsWith("a.png")`), true, "up button moves it back");
    },
  },
  {
    page: "merge-images",
    name: "too-large guard and removing images",
    async run(t) {
      const files = [1, 2, 3, 4].map((n) => save(t.fixtures, `tall${n}.png`, solid(100, 8000, n % 2 ? RED : BLUE)));
      await t.page.setFiles(DROP, files);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 4`);
      await t.page.setValue("#gap", "5000");
      await t.page.waitFor(`document.querySelector("#go").disabled`);
      const msg = await t.page.eval(`document.querySelector("#status").textContent`);
      t.assert(/megapixels/.test(msg) && /Scale|grid|remove/i.test(msg), `clear message: ${msg}`);
      t.eq(await t.page.eval(`document.querySelector("#status").dataset.state`), "error", "error state");
      await t.page.setValue("#gap", "0");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#status").hidden`), true, "message clears when the size is fine");
      await t.page.click("#files li:first-child [data-act=remove]");
      t.eq(await t.page.eval(`document.querySelectorAll("#files > li").length`), 3, "one removed");
      // a single image is not enough
      await t.page.click("#files li:first-child [data-act=remove]");
      await t.page.click("#files li:first-child [data-act=remove]");
      await t.page.waitFor(`document.querySelector("#go").disabled`);
      t.assert((await t.page.eval(`document.querySelector("#summary").textContent`)).includes("at least two"), "needs two images");
    },
  },

  /* ================================================================== add-text-to-image */
  {
    page: "add-text-to-image",
    name: "background box: pixels inside have the box colour, far outside unchanged; multi-line grows the box",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "grey.png", solid(400, 300, GREY))]);
      await textReady(t);
      await t.page.setValue("#text", "HELLO");
      await t.page.setValue("#size", "10");
      await checkbox(t, "#outline", false);
      await checkbox(t, "#box", true);
      await t.page.setValue("#box-color", "#ff0000");
      await t.page.setValue("#box-opacity", "100");
      await t.page.setValue("#box-pad", "40");
      await t.page.click("input[name=pos][value='0,0']");
      // documented geometry: size 40 px, padding 16 px, margin 8 px, line pitch 48 px -> box (8, 8) to (8+w, 88)
      let { name, bytes } = await textSave(t);
      let info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["grey-text.png", "png", 400, 300], "same size and format");
      let px = await pixels(t, bytes, [[10, 10], [10, 86], [10, 92], [390, 290], [200, 150]]);
      same(t, px[0], [255, 0, 0, 255], "inside the box (top-left padding)");
      same(t, px[1], [255, 0, 0, 255], "inside the box (bottom of the padding)");
      same(t, px[2], GREY, "just below the one-line box");
      same(t, px[3], GREY, "far corner unchanged"); same(t, px[4], GREY, "centre unchanged");
      await t.shot("done", 1280);
      await t.shot("done", 375);
      // three lines: box height 3 * 48 + 32 = 176 -> rows 8..183
      await t.page.setValue("#text", "HELLO\nWORLD\nAGAIN");
      ({ bytes } = await textSave(t));
      px = await pixels(t, bytes, [[10, 100], [10, 180], [10, 190]]);
      same(t, px[0], [255, 0, 0, 255], "three-line box covers row 100"); same(t, px[1], [255, 0, 0, 255], "and row 180"); same(t, px[2], GREY, "ends before row 190");
    },
  },
  {
    page: "add-text-to-image",
    name: "PNG transparency is kept outside the text; text pixels are painted",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "clear.png", pngFrom(300, 200, () => [0, 0, 0, 0]))]);
      await textReady(t);
      await t.page.setValue("#text", "MMMM");
      await t.page.setValue("#size", "25");
      await checkbox(t, "#outline", false);
      await t.page.setValue("#color", "#ffffff");
      await t.page.click("input[name=pos][value='1,1']");
      const { bytes } = await textSave(t);
      const img = await allPixels(t, bytes);
      t.eq([img.w, img.h], [300, 200], "size");
      const alpha = (x, y) => img.data[(y * img.w + x) * 4 + 3];
      t.eq([alpha(1, 1), alpha(298, 198), alpha(1, 198)], [0, 0, 0], "corners stay transparent");
      let opaque = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 200) opaque++;
      t.assert(opaque > 300, `text pixels were drawn (${opaque} opaque)`);
      // all painted pixels are white
      const stray = [];
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 250 && (img.data[i] < 250 || img.data[i + 1] < 250)) stray.push(i);
      t.assert(stray.length === 0, "fully opaque pixels are the text colour");
    },
  },
  {
    page: "add-text-to-image",
    name: "accents, emoji, other scripts and every font work; fine offset and tap-to-place",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "grey.png", solid(400, 300, GREY))]);
      await textReady(t);
      await t.page.setValue("#text", "Café Ñandú ☕ 😀 日本語\nNaïve façade");
      for (const f of ["archivo", "bungee", "serif", "sans", "mono"]) {
        await t.page.setValue("#font", f);
        await checkbox(t, "#shadow", f === "serif");
        await t.page.click("#go");
        await t.waitDone();
        const info = imageInfo((await t.dl()).bytes);
        t.eq([info.width, info.height], [400, 300], `font ${f}`);
      }
      // tap to place: the text block centres on the point
      await t.page.mouseClickAt("#preview", 0.25, 0.75);
      const v = await t.page.eval(`[document.querySelector("#ox").value, document.querySelector("#oy").value, document.querySelector("input[name=pos]:checked").value]`);
      t.eq(v, ["-25", "25", "1,1"], "click sets the offsets from the centre");
      // keyboard nudge
      await t.page.eval(`document.querySelector("#preview").focus(); true`);
      await t.page.press("ArrowRight");
      await t.page.press("ArrowDown");
      t.eq(await t.page.eval(`[document.querySelector("#ox").value, document.querySelector("#oy").value]`), ["-24.5", "25.5"], "arrow keys nudge by 0.5%");
      // moved text really moves in the file: a red box centred at (200 - 0.25*400 = 100, 150 + 0.25*300 = 225)
      await t.page.setValue("#text", "MM");
      await checkbox(t, "#box", true);
      await t.page.setValue("#box-color", "#ff0000"); await t.page.setValue("#box-opacity", "100");
      await t.page.mouseClickAt("#preview", 0.25, 0.75);
      const { bytes } = await textSave(t);
      const [inside, outside] = await pixels(t, bytes, [[100, 203], [300, 60]]);
      same(t, inside, [255, 0, 0, 255], "box sits where it was tapped", 0);
      same(t, outside, GREY, "elsewhere unchanged");
    },
  },

  /* ================================================================== image-filters */
  {
    page: "image-filters",
    name: "grayscale, sepia, invert, brightness, contrast, saturation, hue match the documented maths",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "swatch.png", samplePng())]);
      await fltReady(t);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "nothing to apply yet");
      const check = async (settings, want, msg) => {
        await t.page.click("[data-preset=reset]");
        const got = await pixels(t, await fltRun(t, settings), [[0, 0], [1, 0], [2, 0], [3, 0]]);
        got.forEach((g, i) => { same(t, g.slice(0, 3), want[i], `${msg} pixel ${i}`); t.eq(g[3], 255, "alpha"); });
      };
      await check({ grayscale: 100 }, SAMPLES.map(expect.gray), "grayscale");
      t.eq(expect.gray([255, 0, 0])[0], 54, "documented value for pure red");
      await check({ invert: 100 }, SAMPLES.map(([r, g, b]) => [255 - r, 255 - g, 255 - b]), "invert");
      await check({ sepia: 100 }, SAMPLES.map(expect.sepia), "sepia");
      await check({ saturation: 0 }, SAMPLES.map(expect.sat0), "saturation 0");
      await check({ hue: 180 }, SAMPLES.map(hue180), "hue 180");
      await check({ brightness: 150 }, SAMPLES.map(([r, g, b]) => [r, g, b].map((c) => Math.round(c255(c * 1.5)))), "brightness 150");
      await check({ contrast: 200 }, SAMPLES.map(([r, g, b]) => [r, g, b].map((c) => Math.round(c255((c - 128) * 2 + 128)))), "contrast 200");
      await check({ contrast: 50 }, SAMPLES.map(([r, g, b]) => [r, g, b].map((c) => Math.round((c - 128) * 0.5 + 128))), "contrast 50");
      await check({ contrast: 0 }, SAMPLES.map(() => [128, 128, 128]), "contrast 0 is flat grey");
      // half-strength grayscale mixes linearly
      await check({ grayscale: 50 }, SAMPLES.map(([r, g, b]) => { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [r, g, b].map((c) => Math.round(c + (y - c) * 0.5)); }), "grayscale 50");
      // the single numbers the brief names
      const [one] = await pixels(t, await (async () => { await t.page.click("[data-preset=reset]"); return fltRun(t, { invert: 100 }); })(), [[1, 0]]);
      same(t, one.slice(0, 3), [245, 235, 225], "invert of (10, 20, 30)");
      const hundred = save(t.fixtures, "hundred.png", solid(3, 3, [100, 100, 100, 255]));
      await t.page.eval(`document.querySelector("#clear").click(); true`);
      await t.page.setFiles(DROP, [hundred]);
      await fltReady(t);
      const [b150] = await pixels(t, await fltRun(t, { brightness: 150 }), [[1, 1]]);
      same(t, b150.slice(0, 3), [150, 150, 150], "brightness 150% of 100");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "image-filters",
    name: "presets, before/after toggle and the live preview",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "swatch.png", samplePng())]);
      await fltReady(t);
      const prev = () => t.page.eval(`Array.from(document.querySelector("#preview").getContext("2d").getImageData(0, 0, 1, 1).data)`);
      same(t, await prev(), [255, 0, 0, 255], "unfiltered preview");
      await t.page.click("[data-preset=bw]");
      t.eq(await t.page.eval(`document.querySelector("#f-grayscale").value`), "100", "preset moves the slider");
      await t.page.waitFor(`document.querySelector("#preview").getContext("2d").getImageData(0, 0, 1, 1).data[1] === 54`);
      same(t, await prev(), [54, 54, 54, 255], "preview is grey");
      t.eq(await t.page.eval(`document.querySelector("#compare").getAttribute("aria-pressed")`), "false", "toggle starts off");
      await t.page.click("#compare");
      t.eq(await t.page.eval(`document.querySelector("#compare").getAttribute("aria-pressed")`), "true", "toggle on");
      await t.page.waitFor(`document.querySelector("#preview").getContext("2d").getImageData(0, 0, 1, 1).data[1] === 0`);
      same(t, await prev(), [255, 0, 0, 255], "original shown");
      await t.page.click("#compare");
      await t.page.waitFor(`document.querySelector("#preview").getContext("2d").getImageData(0, 0, 1, 1).data[1] === 54`);
      await t.page.click("[data-preset=sepia]");
      t.eq(await t.page.eval(`[document.querySelector("#f-sepia").value, document.querySelector("#f-grayscale").value]`), ["100", "0"], "presets replace each other");
      await t.page.click("[data-preset=reset]");
      await t.page.waitFor(`document.querySelector("#go").disabled`);
    },
  },
  {
    page: "image-filters",
    name: "blur: symmetric, keeps total intensity; alpha and size preserved",
    async run(t) {
      // a single white pixel on black: sigma = 40 * 41 / 2000 = 0.82
      await t.page.setFiles(DROP, [save(t.fixtures, "dot.png", pngFrom(41, 41, (x, y) => (x === 20 && y === 20 ? [255, 255, 255, 255] : [0, 0, 0, 255])))]);
      await fltReady(t);
      let img = await allPixels(t, await fltRun(t, { blur: 40 }));
      t.eq([img.w, img.h], [41, 41], "size");
      const R = (x, y) => img.data[(y * img.w + x) * 4];
      let sum = 0;
      for (let i = 0; i < img.data.length; i += 4) sum += img.data[i];
      t.assert(Math.abs(sum / 255 - 1) <= 0.02, `total intensity within 2%: ${(sum / 255).toFixed(4)}`);
      t.assert(R(20, 20) < 255 && R(21, 20) > 0 && R(20, 21) > 0, "it spread");
      for (let d = 1; d < 5; d++) {
        t.eq([R(20 + d, 20), R(20, 20 + d), R(20, 20 - d)], [R(20 - d, 20), R(20 - d, 20 + 0) * 0 + R(20, 20 + d), R(20, 20 + d)], "mirror symmetry at " + d);
      }
      t.eq([R(21, 21), R(19, 19), R(21, 19), R(19, 21)].every((v) => v === R(21, 21)), true, "diagonal symmetry");
      // a white block on a larger picture: sigma = 4
      await t.page.eval(`document.querySelector("#clear").click(); true`);
      await t.page.setFiles(DROP, [save(t.fixtures, "block.png", pngFrom(201, 201, (x, y) => (Math.abs(x - 100) <= 4 && Math.abs(y - 100) <= 4 ? [255, 255, 255, 255] : [0, 0, 0, 255])))]);
      await fltReady(t);
      img = await allPixels(t, await fltRun(t, { blur: 40 }));
      sum = 0;
      for (let i = 0; i < img.data.length; i += 4) sum += img.data[i];
      t.assert(Math.abs(sum / (255 * 81) - 1) <= 0.02, `block intensity within 2%: ${(sum / (255 * 81)).toFixed(4)}`);
      t.assert(R(100, 100) < 255 && R(108, 100) > 0 && R(100, 94) > 0, "block spread out");
      t.eq([R(100 + 7, 100), R(100, 100 + 7)], [R(100 - 7, 100), R(100, 100 - 7)], "block stays symmetric");
      // semi-transparent colour: alpha untouched, colour not darkened by the blur
      await t.page.eval(`document.querySelector("#clear").click(); true`);
      await t.page.setFiles(DROP, [save(t.fixtures, "ghost.png", pngFrom(41, 41, (x, y) => (x < 20 ? [200, 100, 50, 100] : [200, 100, 50, 255])))]);
      await fltReady(t);
      img = await allPixels(t, await fltRun(t, { blur: 40 }));
      const A = (x, y) => img.data[(y * img.w + x) * 4 + 3];
      t.eq([A(2, 2), A(10, 30), A(35, 5), A(30, 30)], [100, 100, 255, 255], "alpha is preserved by the blur");
      same(t, Array.from(img.data.slice((5 * 41 + 5) * 4, (5 * 41 + 5) * 4 + 3)), [200, 100, 50], "colour of the translucent area", 6);
      // alpha with a per-pixel filter
      await t.page.eval(`document.querySelector("#clear").click(); true`);
      await t.page.setFiles(DROP, [save(t.fixtures, "alpha.png", pngFrom(4, 1, (x) => [200, 100, 50, [255, 128, 64, 0][x]]))]);
      await fltReady(t);
      img = await allPixels(t, await fltRun(t, { invert: 100 }));
      t.eq([0, 1, 2, 3].map((x) => img.data[x * 4 + 3]), [255, 128, 64, 0], "alpha unchanged by invert");
    },
  },
  {
    page: "image-filters",
    name: "a large photo is processed at full size with progress",
    async run(t) {
      const big = await t.page.eval(`(() => {
        const c = document.createElement("canvas"); c.width = 2400; c.height = 1600;
        const x = c.getContext("2d"); const g = x.createLinearGradient(0, 0, 2400, 1600);
        g.addColorStop(0, "#d33"); g.addColorStop(1, "#33d"); x.fillStyle = g; x.fillRect(0, 0, 2400, 1600);
        return c.toDataURL("image/png").split(",")[1];
      })()`);
      await t.page.setFiles(DROP, [save(t.fixtures, "big.png", Buffer.from(big, "base64"))]);
      await fltReady(t);
      t.eq(await t.page.eval(`document.querySelector("#preview").width`), 800, "preview is a reduced copy");
      await t.page.setValue("#f-blur", "20");
      await t.page.setValue("#f-sepia", "60");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.page.waitFor(`/Applying filters/.test(document.querySelector("#status").textContent) || document.querySelector("#status").dataset.state === "done"`);
      await t.waitDone();
      const info = imageInfo((await t.dl()).bytes);
      t.eq([info.format, info.width, info.height], ["png", 2400, 1600], "full size output");
    },
  },

  /* ================================================================== add-border-to-image */
  {
    page: "add-border-to-image",
    name: "pixel border: 100×80 + 10 px = 120×100, border colour and centre pixel",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "photo.png", solid(100, 80, RED))]);
      await bordReady(t);
      await t.page.setValue("#bc", "#0000ff");
      const { name, bytes } = await bordRun(t);
      const info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["photo-framed.png", "png", 120, 100], "grown by the border on every side");
      const px = await pixels(t, bytes, [[0, 0], [5, 50], [60, 3], [119, 99], [10, 10], [60, 50], [109, 89], [110, 50]]);
      same(t, px[0], [0, 0, 255, 255], "corner is border"); same(t, px[1], [0, 0, 255, 255], "left border"); same(t, px[2], [0, 0, 255, 255], "top border");
      same(t, px[3], [0, 0, 255, 255], "far corner"); same(t, px[4], RED, "first picture pixel"); same(t, px[5], RED, "centre unchanged");
      same(t, px[6], RED, "last picture pixel"); same(t, px[7], [0, 0, 255, 255], "right border starts after the picture");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "add-border-to-image",
    name: "percent border is of the shorter side; padding band has its own colour",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "photo.png", solid(100, 80, RED))]);
      await bordReady(t);
      await t.page.click("input[name=bu][value=pct]");
      let { bytes } = await bordRun(t, { "#bw": "10", "#bc": "#0000ff" });
      let info = imageInfo(bytes);
      t.eq([info.width, info.height], [116, 96], "10% of 80 = 8 px on every side");
      let px = await pixels(t, bytes, [[7, 50], [8, 50], [107, 50], [108, 50]]);
      same(t, px[0], [0, 0, 255, 255], "border"); same(t, px[1], RED, "picture starts at 8"); same(t, px[2], RED, "picture ends at 107"); same(t, px[3], [0, 0, 255, 255], "border again");
      // pixels with padding
      await t.page.click("input[name=bu][value=px]");
      ({ bytes } = await bordRun(t, { "#bw": "10", "#pw": "5", "#pc": "#00ff00" }));
      info = imageInfo(bytes);
      t.eq([info.width, info.height], [130, 110], "border 10 + padding 5");
      px = await pixels(t, bytes, [[5, 55], [12, 55], [14, 55], [15, 55], [65, 55]]);
      same(t, px[0], [0, 0, 255, 255], "border band"); same(t, px[1], [0, 255, 0, 255], "padding band"); same(t, px[2], [0, 255, 0, 255], "padding band, last pixel");
      same(t, px[3], RED, "picture"); same(t, px[4], RED, "centre");
    },
  },
  {
    page: "add-border-to-image",
    name: "rounded corners: transparent in PNG, chosen colour in JPEG; rounded-only keeps the size",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "photo.png", solid(100, 80, RED))]);
      await bordReady(t);
      let { bytes } = await bordRun(t, { "#bw": "10", "#bc": "#0000ff", "#rw": "20" });
      let info = imageInfo(bytes);
      t.eq([info.width, info.height], [120, 100], "size with radius");
      let px = await pixels(t, bytes, [[0, 0], [2, 2], [119, 99], [60, 3], [60, 50], [30, 5]]);
      t.eq([px[0][3], px[1][3], px[2][3]], [0, 0, 0], "corners outside the curve are transparent");
      same(t, px[3], [0, 0, 255, 255], "top border is solid"); same(t, px[4], RED, "centre unchanged"); t.eq(px[5][3], 255, "border beyond the curve is solid");
      // JPEG: corners take the chosen colour
      await t.page.click("input[name=fmt][value=jpeg]");
      ({ bytes } = await bordRun(t, { "#jc": "#00ff00" }));
      info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["jpeg", 120, 100], "jpeg");
      px = await pixels(t, bytes, [[0, 0], [60, 50]]);
      same(t, px[0], [0, 255, 0, 255], "corner is the JPEG corner colour", 25); same(t, px[1], RED, "centre", 14);
      // rounded corners only, as a percentage of the shorter side
      await t.page.click("input[name=fmt][value=png]");
      await t.page.click("input[name=mode][value=round]");
      t.eq(await t.page.eval(`document.querySelector("[data-border]").hidden`), true, "border options are hidden");
      await t.page.click("input[name=ru][value=pct]");
      ({ bytes } = await bordRun(t, { "#rw": "20" }));
      info = imageInfo(bytes);
      t.eq([info.width, info.height], [100, 80], "size unchanged");
      px = await pixels(t, bytes, [[0, 0], [50, 40], [99, 79], [50, 0], [0, 40]]);
      t.eq([px[0][3], px[2][3]], [0, 0], "corners cut"); same(t, px[1], RED, "centre"); t.eq([px[3][3], px[4][3]], [255, 255], "straight edges remain");
      await t.page.setValue("#rw", "50");
      ({ bytes } = await bordRun(t));
      px = await pixels(t, bytes, [[0, 0], [50, 40], [3, 40], [50, 0]]);
      t.eq(px[0][3], 0, "50% rounds a lot"); same(t, px[1], RED, "centre"); t.eq([px[2][3], px[3][3]], [255, 255], "the middle of each side is still there");
    },
  },
  {
    page: "add-border-to-image",
    name: "batch of two gives a zip of framed files",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "one.png", solid(60, 40, RED)), save(t.fixtures, "two.png", solid(30, 30, GREEN))]);
      await bordReady(t, 2);
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const files = unzip(bytes);
      t.eq(files.map((f) => f.name), ["one-framed.png", "two-framed.png"], "zip contents");
      t.eq(files.map((f) => { const i = imageInfo(f.data); return [i.width, i.height]; }), [[80, 60], [50, 50]], "each grown by 10 px per side");
      t.assert((await t.page.eval(`document.querySelector("#preview-label").textContent`)).includes("one.png"), "preview is of the first image");
    },
  },

  /* ================================================================== placeholder-image-generator */
  {
    page: "placeholder-image-generator",
    name: "PNG download is exactly the size asked for; corner colour; default text",
    async run(t) {
      t.eq(await t.page.eval(`document.querySelector("#text").placeholder`), "640 × 360", "default text is the size");
      t.assert((await t.page.eval(`document.querySelector("#preview").getAttribute("aria-label")`)).includes("640 × 360"), "preview label");
      await t.page.click("#download");
      await t.waitDone();
      let { name, bytes } = await t.dl("#download");
      let info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["placeholder-640x360.png", "png", 640, 360], "default download");
      same(t, (await pixels(t, bytes, [[0, 0]]))[0], [207, 213, 218, 255], "corner is the background colour");
      // text pixels exist near the centre
      const all = await allPixels(t, bytes);
      let text = 0;
      for (let i = 0; i < all.data.length; i += 4) if (all.data[i] < 120) text++;
      t.assert(text > 200, `text drawn in the text colour (${text} dark pixels)`);
      // custom colours and an odd size
      await t.page.setValue("#w", "37"); await t.page.setValue("#h", "19");
      await t.page.setValue("#bg", "#102030");
      ({ name, bytes } = await t.dl("#download"));
      info = imageInfo(bytes);
      t.eq([name, info.width, info.height], ["placeholder-37x19.png", 37, 19], "odd size");
      same(t, (await pixels(t, bytes, [[0, 0], [36, 18]])).flat(), [16, 32, 48, 255, 16, 32, 48, 255], "bg colour at both corners");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "placeholder-image-generator",
    name: "presets and JPEG/WebP downloads have exact dimensions",
    async run(t) {
      await t.page.click('#presets button[data-w="1200"]');
      t.eq(await t.page.eval(`[document.querySelector("#w").value, document.querySelector("#h").value]`), ["1200", "630"], "social card preset");
      await t.page.click("input[name=fmt][value=jpeg]");
      t.eq(await t.page.eval(`document.querySelector("#download").textContent`), "Download JPEG", "button names the format");
      let { name, bytes } = await t.dl("#download");
      let info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["placeholder-1200x630.jpg", "jpeg", 1200, 630], "jpeg");
      same(t, (await pixels(t, bytes, [[2, 2]]))[0], [207, 213, 218, 255], "jpeg corner", 6);
      await t.page.click("input[name=fmt][value=webp]");
      await t.page.click('#presets button[data-w="728"]');
      ({ name, bytes } = await t.dl("#download"));
      info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["placeholder-728x90.webp", "webp", 728, 90], "webp 728x90");
      for (const [w, h] of [[300, 250], [150, 150], [1080, 1080], [1920, 1080], [1280, 720]]) {
        await t.page.click(`#presets button[data-w="${w}"][data-h="${h}"]`);
        t.eq(await t.page.eval(`[document.querySelector("#w").value, document.querySelector("#h").value]`), [String(w), String(h)], `preset ${w}x${h}`);
      }
    },
  },
  {
    page: "placeholder-image-generator",
    name: "SVG has the size, default text, and escapes & and <; copy as data URI",
    async run(t) {
      await t.page.click('#presets button[data-w="300"]');
      await t.page.click("input[name=fmt][value=svg]");
      let { name, bytes } = await t.dl("#download");
      let svg = bytes.toString("utf8");
      t.eq(name, "placeholder-300x250.svg", "name");
      t.assert(/<svg[^>]*width="300"[^>]*height="250"/.test(svg) && svg.includes('viewBox="0 0 300 250"'), "size in the svg: " + svg.slice(0, 160));
      t.assert(svg.includes(">300 × 250</text>"), "default text is the size");
      t.assert(svg.includes('fill="#cfd5da"') && svg.includes('fill="#2b3238"'), "colours");
      await t.page.setValue("#text", `Tom & Jerry <b> "q"`);
      ({ bytes } = await t.dl("#download"));
      svg = bytes.toString("utf8");
      t.assert(svg.includes("Tom &amp; Jerry &lt;b&gt; &quot;q&quot;"), "escaped: " + svg.slice(-160));
      t.assert(!svg.includes("<b>") && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(svg), "no raw markup in the text");
      const ok = await t.page.eval(`(() => { const d = new DOMParser().parseFromString(${JSON.stringify(svg)}, "image/svg+xml"); return !d.querySelector("parsererror") && d.querySelector("text").textContent; })()`);
      t.eq(ok, `Tom & Jerry <b> "q"`, "well-formed and round-trips");
      // data URI
      await t.page.eval(`window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; true`);
      await t.page.click("#copy");
      await t.waitDone();
      const uri = await t.page.eval(`window.__copied`);
      t.assert(uri.startsWith("data:image/svg+xml;charset=utf-8,") && decodeURIComponent(uri.split(",")[1]) === svg, "svg data uri decodes to the svg");
      await t.page.click("input[name=fmt][value=png]");
      await t.page.setValue("#w", "20"); await t.page.setValue("#h", "10");
      await t.page.click("#copy");
      await t.waitDone();
      const png = await t.page.eval(`window.__copied`);
      t.assert(png.startsWith("data:image/png;base64,"), "png data uri");
      t.eq(imageInfo(Buffer.from(png.split(",")[1], "base64")).width, 20, "the data uri holds a 20 px wide PNG");
      t.assert((await t.page.eval(`document.querySelector("#status").textContent`)).includes("Copied a data URI"), "status says what was copied");
      // too big to be practical
      await t.page.setValue("#w", "3000"); await t.page.setValue("#h", "2000");
      await t.page.click("#copy");
      const msg = await t.waitError();
      t.assert(/too large as a data URI/.test(msg), msg);
    },
  },
  {
    page: "placeholder-image-generator",
    name: "size limits: clear message, invalid fields marked, downloads blocked",
    async run(t) {
      await t.page.setValue("#w", "9000");
      await t.page.waitFor(`document.querySelector("#problem").textContent !== ""`);
      const msg = await t.page.eval(`document.querySelector("#problem").textContent`);
      t.assert(msg.includes("8000") && msg.includes("1"), "message names the limits: " + msg);
      t.eq(await t.page.eval(`[document.querySelector("#w").getAttribute("aria-invalid"), document.querySelector("#h").getAttribute("aria-invalid"), document.querySelector("#download").disabled, document.querySelector("#copy").disabled]`), ["true", null, true, true], "marked and blocked");
      await t.page.setValue("#w", "640"); await t.page.setValue("#h", "0");
      await t.page.waitFor(`document.querySelector("#h").getAttribute("aria-invalid") === "true" && !document.querySelector("#w").hasAttribute("aria-invalid")`);
      await t.page.setValue("#h", "1.5");
      await t.page.waitFor(`document.querySelector("#download").disabled && document.querySelector("#h").getAttribute("aria-invalid") === "true"`);
      await t.page.setValue("#h", "8000"); await t.page.setValue("#w", "8000");
      await t.page.waitFor(`!document.querySelector("#download").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#problem").textContent`), "", "8000 × 8000 is allowed");
      await t.page.setValue("#w", "1"); await t.page.setValue("#h", "1");
      await t.page.waitFor(`document.querySelector("#text").placeholder === "1 × 1"`);
      const { bytes } = await t.dl("#download");
      t.eq([imageInfo(bytes).width, imageInfo(bytes).height], [1, 1], "one pixel image");
    },
  },
];
