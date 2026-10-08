import { makePng, imageInfo, pdfInfo, save } from "../fixtures.mjs";

const DROP = "#drop input[type=file]";

async function ready(t, n = 1) {
  await t.page.waitFor(`document.querySelectorAll("#files > li").length === ${n} && !document.querySelector("#go").disabled`);
}

/* An image encoded by the browser itself (photo-like gradient with blocks; optional transparent corner). */
async function browserImage(t, mime, { q = 0.92, w = 900, h = 600, hole = false } = {}) {
  const b64 = await t.page.eval(`(() => {
    const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h};
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, ${w}, ${h});
    g.addColorStop(0, "#d33"); g.addColorStop(0.5, "#3a6"); g.addColorStop(1, "#33d");
    x.fillStyle = g; x.fillRect(0, 0, ${w}, ${h});
    for (let i = 0; i < 200; i++) { x.fillStyle = "hsl(" + (i * 37 % 360) + ",70%,50%)"; x.fillRect((i * 97) % ${w - 50}, (i * 53) % ${h - 50}, 40, 30); }
    if (${hole}) x.clearRect(0, 0, ${Math.round(w / 4)}, ${Math.round(h / 4)});
    return c.toDataURL(${JSON.stringify(mime)}, ${q}).split(",")[1];
  })()`);
  return Buffer.from(b64, "base64");
}

/* Decode an image in the page and read pixels [[x, y], ...] as [r, g, b, a]. */
async function pixels(t, bytes, points) {
  return t.page.eval(`(async () => {
    const bin = atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))});
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
    return ${JSON.stringify(points)}.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data));
  })()`);
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const SVG_BOX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect x="0" y="0" width="20" height="20" fill="#ff0000"/></svg>`;
const SVG_SIZED = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="50" height="25"><rect width="50" height="25" fill="#1636a3"/><circle cx="25" cy="12.5" r="10" fill="#f3c11a"/></svg>`;
const SVG_MM = `<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="15mm" viewBox="0 0 30 15"><rect width="30" height="15" fill="#000"/></svg>`;
const SVG_HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="60" height="30">
<script>document.title = "pwned"; fetch("https://example.com/beacon");</script>
<image href="https://example.com/x.png" xlink:href="https://example.com/y.png" width="60" height="30"/>
<style>@import url("https://example.com/s.css"); rect { fill: #00ff00; }</style>
<a href="https://example.com/"><rect width="30" height="30" onload="alert(1)"/></a>
</svg>`;

export default [
  /* ------------------------------------------------------------------ variants of Convert image */
  {
    page: "png-to-jpg",
    name: "JPG preset: transparent PNG is flattened on white at full size",
    async run(t) {
      t.eq(await t.page.eval(`document.querySelector("input[name=to]:checked").value`), "jpeg", "JPG preselected");
      const src = save(t.fixtures, "logo.png", makePng(600, 400, { alpha: true }));
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      t.eq(await t.page.eval(`[!document.querySelector("#bg-field").hidden, !document.querySelector("#q-field").hidden]`), [true, true], "background and quality shown");
      t.assert((await t.page.eval(`document.querySelector("#summary").textContent`)).includes("JPEG"), "summary names JPEG");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["logo.jpg", "jpeg", 600, 400], "jpeg output");
      // pixel (580, 300) is 96/255 opaque: r 246, g 191, b 120 over white
      const a = 96 / 255;
      const want = [246, 191, 120].map((c) => Math.round(c * a + 255 * (1 - a)));
      const [px, solid] = await pixels(t, bytes, [[580, 300], [50, 50]]);
      t.assert(near(px, [...want, 255], 10), `blended on white: got ${px} want ${want}`);
      t.assert(near(solid, [22, 54, 163, 255], 10), `opaque block kept: ${solid}`);
      // black background
      await t.page.setValue("#bg", "#000000");
      await t.page.click("#go");
      await t.waitDone();
      const [dark] = await pixels(t, (await t.dl()).bytes, [[580, 300]]);
      const wantDark = [246, 191, 120].map((c) => Math.round(c * a));
      t.assert(near(dark, [...wantDark, 255], 10), `blended on black: got ${dark} want ${wantDark}`);
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "jpg-to-png",
    name: "PNG preset: a JPEG photo becomes a same-size PNG",
    async run(t) {
      t.eq(await t.page.eval(`document.querySelector("input[name=to]:checked").value`), "png", "PNG preselected");
      t.eq(await t.page.eval(`document.querySelector("#q-field").hidden`), true, "no quality for PNG");
      const jpg = await browserImage(t, "image/jpeg", { w: 1200, h: 800 });
      const src = save(t.fixtures, "holiday.jpg", jpg);
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height], ["holiday.png", "png", 1200, 800], "png output");
      t.assert(bytes.length > jpg.length, "lossless PNG of a photo is larger than the JPEG");
      const [a, b] = await pixels(t, bytes, [[300, 200], [900, 600]]);
      const [ja, jb] = await pixels(t, jpg, [[300, 200], [900, 600]]);
      t.eq([a, b], [ja, jb], "PNG holds the decoded JPEG pixels exactly");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "webp-to-png",
    name: "PNG preset: WebP with a transparent corner keeps its alpha",
    async run(t) {
      const webp = await browserImage(t, "image/webp", { w: 640, h: 480, hole: true, q: 0.9 });
      t.eq(imageInfo(webp).format, "webp", "fixture is WebP");
      const src = save(t.fixtures, "product.webp", webp);
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      t.assert((await t.page.eval(`document.querySelector("#files").textContent`)).includes("WebP"), "listed as WebP");
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([name, info.format, info.width, info.height, info.colorType], ["product.png", "png", 640, 480, 6], "RGBA png output");
      const [corner, body] = await pixels(t, bytes, [[20, 20], [500, 400]]);
      t.eq(corner[3], 0, "transparent corner stays transparent");
      t.eq(body[3], 255, "body opaque");
      // JPG option exists and works too
      await t.page.click("input[name=to][value=jpeg]");
      await t.page.waitFor(`!document.querySelector("#bg-field").hidden`);
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#result .result__title")?.textContent.includes("product.jpg")`);
      t.eq(imageInfo((await t.dl()).bytes).format, "jpeg", "jpeg option");
      await t.shot("done", 375);
    },
  },

  /* ------------------------------------------------------------------ PNG to PDF (JPG to PDF engine) */
  {
    page: "png-to-pdf",
    name: "two PNG screenshots make a two-page PDF; alpha kept as a soft mask",
    async run(t) {
      const a = save(t.fixtures, "shot-1.png", makePng(320, 200));
      const b = save(t.fixtures, "shot-2.png", makePng(200, 320, { alpha: true }));
      await t.page.setFiles(DROP, [a, b]);
      await t.page.waitFor(`document.querySelectorAll("#files li").length === 2 && !document.querySelector("#go").disabled`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "images.pdf", "name");
      const info = await pdfInfo(bytes);
      t.eq([info.pages, info.sizes], [2, [[320, 200], [200, 320]]], "fit-to-image pages");
      t.assert(Buffer.from(bytes).includes("/SMask"), "transparent PNG embedded with a soft mask");
      await t.page.setValue("#pagesize", "letter");
      await t.page.click("#go");
      await t.waitDone();
      t.eq((await pdfInfo((await t.dl()).bytes)).sizes, [[792, 612], [612, 792]], "US Letter, auto orientation");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },

  /* ------------------------------------------------------------------ SVG to PNG */
  {
    page: "svg-to-png",
    name: "viewBox-only SVG at 2x; sized SVG at an exact width; mm units; background",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "half.svg", Buffer.from(SVG_BOX))]);
      await t.page.waitFor(`!document.querySelector("#editor").hidden && !document.querySelector("#go").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#summary").textContent`), "PNG, 80 × 40 px", "2x default from the viewBox");
      await t.page.click("#go");
      await t.waitDone();
      let r = await t.dl();
      t.eq([r.name, imageInfo(r.bytes).format, imageInfo(r.bytes).width, imageInfo(r.bytes).height], ["half.png", "png", 80, 40], "2x png");
      let [left, right] = await pixels(t, r.bytes, [[10, 20], [70, 20]]);
      t.eq(left, [255, 0, 0, 255], "red half");
      t.eq(right[3], 0, "transparent half");
      // solid background
      await t.page.click("#transparent");
      await t.page.setValue("#bg", "#00ff00");
      await t.page.click("#go");
      await t.waitDone();
      [right] = await pixels(t, (await t.dl()).bytes, [[70, 20]]);
      t.eq(right, [0, 255, 0, 255], "background colour fills empty area");

      await t.page.setFiles(DROP, [save(t.fixtures, "badge.svg", Buffer.from(SVG_SIZED))]);
      await t.page.waitFor(`document.querySelector("#file-meta").textContent.includes("badge.svg")`);
      t.assert((await t.page.eval(`document.querySelector("#file-meta").textContent`)).includes("50 × 25"), "intrinsic size from width/height");
      await t.page.click("input[name=scale][value=custom]");
      await t.page.setValue("#width", "500");
      await t.page.waitFor(`document.querySelector("#summary").textContent === "PNG, 500 × 250 px"`);
      await t.page.click("#go");
      await t.waitDone();
      r = await t.dl();
      t.eq([imageInfo(r.bytes).width, imageInfo(r.bytes).height], [500, 250], "exact width");
      const [centre, edge] = await pixels(t, r.bytes, [[250, 125], [5, 5]]);
      t.assert(near(centre, [243, 193, 26, 255], 2) && near(edge, [22, 54, 163, 255], 2), `vector drawn at size: ${centre} ${edge}`);
      await t.shot("done", 1280);
      await t.shot("done", 375);

      await t.page.setFiles(DROP, [save(t.fixtures, "print.svg", Buffer.from(SVG_MM))]);
      await t.page.waitFor(`document.querySelector("#file-meta").textContent.includes("print.svg")`);
      await t.page.click("input[name=scale][value='1']");
      await t.page.waitFor(`document.querySelector("#summary").textContent === "PNG, 113 × 57 px"`);
      // too large is refused before drawing
      await t.page.click("input[name=scale][value=custom]");
      await t.page.setValue("#width", "40000");
      await t.page.waitFor(`document.querySelector("#go").disabled && /larger than/.test(document.querySelector("#summary").textContent)`);
    },
  },
  {
    page: "svg-to-png",
    name: "scripts and external links in an SVG neither run nor load; non-SVG refused",
    async run(t) {
      await t.page.setFiles(DROP, [save(t.fixtures, "hostile.svg", Buffer.from(SVG_HOSTILE))]);
      await t.page.waitFor(`!document.querySelector("#editor").hidden`);
      await t.page.click("input[name=scale][value='1']");
      await t.page.click("#go");
      await t.waitDone();
      const r = await t.dl();
      t.eq([imageInfo(r.bytes).width, imageInfo(r.bytes).height], [60, 30], "rendered");
      const [rect] = await pixels(t, r.bytes, [[10, 10]]);
      t.eq(rect, [0, 255, 0, 255], "inline style applied, shapes drawn");
      t.assert((await t.page.eval("document.title")) !== "pwned", "script did not run");
      t.eq(await t.page.eval(`document.querySelectorAll("image, svg script").length`), 0, "SVG never inserted into the page");
      // not an SVG
      await t.page.setFiles(DROP, [save(t.fixtures, "fake.svg", Buffer.from("hello, not xml"))]);
      const msg = await t.waitError();
      t.assert(/isn't a readable SVG/.test(msg), "non-SVG message: " + msg);
      t.eq(await t.page.eval(`document.querySelector("#editor").hidden`), true, "editor hidden after bad file");
      await t.page.setFiles(DROP, [save(t.fixtures, "photo.png", makePng(10, 10))]);
      t.assert(/isn.t a vector \(SVG\) file/.test(await t.waitError()), "PNG refused by type");
      await t.shot("error", 375);
    },
  },

  /* ------------------------------------------------------------------ Image to Base64 */
  {
    page: "image-to-base64",
    name: "data URL matches the file; type from bytes; every snippet form; SVG",
    async run(t) {
      const png = makePng(64, 32, { alpha: true });
      const b64 = png.toString("base64");
      // saved with the wrong extension: the type must come from the bytes
      await t.page.setFiles(DROP, [save(t.fixtures, "icon.jpg", png)]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && document.querySelector("#out").value !== ""`);
      t.eq(await t.page.eval(`document.querySelector("#out").value`), "data:image/png;base64," + b64, "data URL");
      t.eq(await t.page.eval(`[document.querySelector("#s-type").textContent, document.querySelector("#s-dims").textContent]`), ["PNG", "64 × 32"], "stats");
      t.eq(await t.page.eval(`document.querySelector("#big").hidden`), true, "no size warning for a small file");
      const forms = { raw: b64, css: `background-image: url("data:image/png;base64,${b64}");`, html: `<img src="data:image/png;base64,${b64}" width="64" height="32" alt="">`, md: `![icon](data:image/png;base64,${b64})` };
      for (const [k, want] of Object.entries(forms)) {
        await t.page.click(`input[name=fmt][value=${k}]`);
        t.eq(await t.page.eval(`document.querySelector("#out").value`), want, k);
      }
      await t.shot("done", 1280);
      await t.shot("done", 375);
      const { name, bytes } = await t.dl("#dl");
      t.eq([name, bytes.toString("utf8")], ["icon-base64.txt", forms.md], "download");
      // SVG
      const svg = Buffer.from(SVG_SIZED);
      await t.page.click(`input[name=fmt][value=data]`);
      await t.page.setFiles(DROP, [save(t.fixtures, "badge.svg", svg)]);
      await t.page.waitFor(`document.querySelector("#out").value.startsWith("data:image/svg+xml")`);
      t.eq(await t.page.eval(`document.querySelector("#out").value`), "data:image/svg+xml;base64," + svg.toString("base64"), "svg data URL");
      t.eq(await t.page.eval(`document.querySelector("#s-dims").textContent`), "50 × 25", "svg size");
      // large file warning
      const big = await browserImage(t, "image/png", { w: 700, h: 500 });
      t.assert(big.length > 100 * 1024, "fixture over 100 KB");
      await t.page.setFiles(DROP, [save(t.fixtures, "big.png", big)]);
      await t.page.waitFor(`!document.querySelector("#big").hidden`);
      t.eq(await t.page.eval(`document.querySelector("#out").value.length`), "data:image/png;base64,".length + big.toString("base64").length, "large data URL length");
      // not an image
      await t.page.setFiles(DROP, [save(t.fixtures, "x.png", Buffer.from("not an image at all"))]);
      t.assert(/doesn't look like/.test(await t.waitError()), "bad bytes refused");
    },
  },

  /* ------------------------------------------------------------------ Image color picker */
  {
    page: "image-color-picker",
    name: "click and keyboard picks read exact pixels; palette has the main colours",
    async run(t) {
      const b64 = await t.page.eval(`(() => { const c = document.createElement("canvas"); c.width = 200; c.height = 100; const x = c.getContext("2d");
        x.fillStyle = "#1636a3"; x.fillRect(0, 0, 100, 100); x.fillStyle = "#f3c11a"; x.fillRect(100, 0, 100, 50); x.fillStyle = "#1d6b38"; x.fillRect(100, 50, 100, 50);
        return c.toDataURL("image/png").split(",")[1]; })()`);
      await t.page.setFiles(DROP, [save(t.fixtures, "flag.png", Buffer.from(b64, "base64"))]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && document.querySelectorAll("#palette li").length >= 3`);
      const pal = await t.page.eval(`[...document.querySelectorAll("#palette [data-hex]")].map(b => b.dataset.hex)`);
      t.eq([pal[0], pal.slice(1).sort()], ["#1636A3", ["#1D6B38", "#F3C11A"]], "palette, largest first (the other two tie)");
      t.eq(pal.length, 3, "only the three colours");
      t.eq(await t.page.eval(`document.querySelector("#palette .cp__share").textContent`), "50%", "share");
      await t.page.mouseClickAt("#cv", 0.25, 0.5);
      await t.page.waitFor(`!document.querySelector("#picked").hidden`);
      t.eq(await t.page.eval(`["#v-hex","#v-rgb","#v-hsl"].map(s => document.querySelector(s).textContent)`), ["#1636A3", "rgb(22, 54, 163)", "hsl(226, 76%, 36%)"], "clicked pixel");
      // keyboard: crosshair follows the click; move right into the yellow, then pick
      const xy0 = (await t.page.eval(`document.querySelector("#now-xy").textContent`)).match(/\d+/g).map(Number);
      await t.page.eval(`document.querySelector("#target").focus(), true`);
      for (let i = 0; i < 60; i++) await t.page.press("ArrowRight");
      await t.page.press("ArrowUp");
      const xy = (await t.page.eval(`document.querySelector("#now-xy").textContent`)).match(/\d+/g).map(Number);
      t.eq(xy, [xy0[0] + 60, xy0[1] - 1], "arrow keys move one pixel per press");
      await t.page.press("Enter");
      t.eq(await t.page.eval(`["#v-hex","#v-rgb","#v-hsl"].map(s => document.querySelector(s).textContent)`), ["#F3C11A", "rgb(243, 193, 26)", "hsl(46, 90%, 53%)"], "keyboard pick");
      for (let i = 0; i < 30; i++) await t.page.press("ArrowDown");
      await t.page.press("Enter");
      t.eq(await t.page.eval(`document.querySelector("#v-hex").textContent`), "#1D6B38", "third colour");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#history [data-hex]")].map(b => b.dataset.hex)`), ["#1D6B38", "#F3C11A", "#1636A3"], "history, newest first");
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
];
