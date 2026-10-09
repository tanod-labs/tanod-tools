// Five tools: PDF to text, Sign PDF, Image to WebP, GIF maker, HEIC to JPG. The logic is covered by check/unit/tools5.mjs;
// these tests drive the real pages and inspect the files they produce.
import { PDFLib, makePdf, makePng, makeEncryptedPdf, pdfInfo, imageInfo, save, unzip } from "../fixtures.mjs";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const { PDFDocument, StandardFonts, degrees, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
const q = JSON.stringify;
const DROP = "#drop input[type=file]";
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.trim()`);
const val = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).value`);
const hidden = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).hidden`);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/* ------------------------------------------------------------------ shared fixtures */

/* A PNG with one colour, any size. */
function solidPng(w, h, [r, g, b, a = 255]) {
  const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
  const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 4 + 1) + 1 + x * 4; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* A photo-like picture made by the browser itself. */
async function browserImage(t, mime, quality = 0.9, w = 640, h = 480) {
  const out = await t.page.eval(`(() => {
    const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h};
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, ${w}, ${h});
    g.addColorStop(0, "#d33"); g.addColorStop(0.5, "#3a6"); g.addColorStop(1, "#33d");
    x.fillStyle = g; x.fillRect(0, 0, ${w}, ${h});
    for (let i = 0; i < 300; i++) { x.fillStyle = "hsl(" + (i * 37 % 360) + ",70%,50%)"; x.fillRect((i * 97) % ${w - 50}, (i * 53) % ${h - 50}, 40, 30); }
    return c.toDataURL(${q(mime)}, ${quality}).split(",")[1];
  })()`);
  return Buffer.from(out, "base64");
}

/* Decode an image in the page and read pixels [[x, y], ...] as [r, g, b, a]. */
async function pixels(t, bytes, points) {
  return t.page.eval(`(async () => {
    const bin = atob(${q(b64(bytes))});
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]), { premultiplyAlpha: "none" });
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    return ${q(points)}.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data));
  })()`);
}

async function loadPdf(t, path, ready = "!document.querySelector('#work').hidden") {
  await t.page.setFiles(DROP, [path]);
  await t.page.waitFor(`${ready} || (document.querySelector("#status").dataset.state === "error" && (() => { throw new Error(document.querySelector("#status").textContent); })())`);
}

async function expectBadPdfs(t) {
  const note = save(t.fixtures, "notes.txt", Buffer.from("hello"));
  await t.page.setFiles(DROP, [note]);
  const msg = await t.waitError();
  t.assert(/isn't a PDF/.test(msg), "non-PDF message: " + msg);
  const enc = save(t.fixtures, "locked.pdf", await makeEncryptedPdf());
  await t.page.setFiles(DROP, [enc]);
  await t.page.waitFor(`/password|couldn't be (read|opened)|encrypted/.test(document.querySelector("#status").textContent)`);
  t.eq(await hidden(t, "#work"), true, "work area stays hidden");
}

/* ================================================================== PDF to text */

async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([400, 560]);
  p1.drawText("Annual Report", { x: 40, y: 500, size: 24, font: bold });
  ["The quick brown fox jumps over", "the lazy dog and keeps running", "until the end of the field."].forEach((l, i) => p1.drawText(l, { x: 40, y: 450 - i * 14, size: 12, font }));
  p1.drawText("Second paragraph: café, déjà vu.", { x: 40, y: 380, size: 12, font });
  const pic = await doc.embedPng(makePng(100, 100));
  doc.addPage([400, 560]).drawImage(pic, { x: 50, y: 50, width: 300, height: 400 });   // a "scanned" page: only a picture
  doc.addPage([400, 560]).drawText("Last page text", { x: 40, y: 500, size: 12, font });
  return doc.save();
}
const P1 = "Annual Report\n\nThe quick brown fox jumps over\nthe lazy dog and keeps running\nuntil the end of the field.\n\nSecond paragraph: café, déjà vu.";
const P3 = "Last page text";

async function imageOnlyPdf(pages) {
  const doc = await PDFDocument.create();
  const pic = await doc.embedPng(makePng(60, 60));
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]).drawImage(pic, { x: 20, y: 20, width: 260, height: 360 });
  return doc.save();
}

const pdfToText = [
  {
    page: "pdf-to-text",
    name: "reads text page by page, marks pages, flags the scanned page, selects pages, copies and downloads a .txt",
    async run(t) {
      await loadPdf(t, save(t.fixtures, "report.pdf", await textPdf()));
      await t.waitDone();
      const marked = `--- Page 1 ---\n\n${P1}\n\n--- Page 2 ---\n\n--- Page 3 ---\n\n${P3}`;
      t.eq(await val(t, "#pt-out"), marked, "text with page marks");
      const lines = (P1 + "\n" + P3).split("\n").filter(Boolean);
      t.eq([await txt(t, "#pt-n-pages"), await txt(t, "#pt-n-text"), await txt(t, "#pt-n-words"), await txt(t, "#pt-n-chars")],
        ["3", "2", "28", String(lines.join("").length)], "page, word and character counts");
      t.assert((await txt(t, "#fname")) === "report.pdf" && (await txt(t, "#finfo")).includes("3 pages"), "file bar: " + await txt(t, "#finfo"));
      t.assert((await txt(t, "#status")).includes("Read 3 pages.") && (await txt(t, "#status")).includes("1 page has no text."), "status: " + await txt(t, "#status"));
      // the scanned page is flagged and the OCR link is the one under the tool
      t.eq(await hidden(t, "#pt-ocr"), false, "OCR note shown");
      t.assert((await txt(t, "#pt-ocr")).startsWith("1 page has no text of its own"), "OCR note text: " + await txt(t, "#pt-ocr"));
      const href = await t.page.eval(`document.querySelector("#pt-ocr a").getAttribute("href")`);
      t.eq(href, await t.page.eval(`document.querySelector(".limits a").getAttribute("href")`), "OCR link is the page's own link");
      t.eq(href, "/tools/ocr-pdf/", "OCR link target");
      // page-by-page table
      t.eq(await t.page.eval(`document.querySelectorAll("#pt-rows tr").length`), 3, "three table rows");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#pt-rows tr")].map((r) => r.children[0].textContent + ":" + r.children[1].textContent)`), ["1:25", "2:0", "3:3"], "words per page");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#pt-rows tr")].map((r) => r.querySelector("button") ? "copy" : r.children[3].textContent)`), ["copy", "No text", "copy"], "copy buttons, and 'No text' for the picture page");
      t.eq(await t.page.eval(`document.querySelector("#pt-rows button").getAttribute("aria-label")`), "Copy the text of page 1", "copy button name");
      // options: marks off, a page range, a bad range
      await t.page.click("#pt-marks");
      t.eq(await val(t, "#pt-out"), `${P1}\n\n${P3}`, "no marks: pages with no text are left out");
      await t.page.click('input[name=scope][value=range]');
      t.eq(await hidden(t, "#range-field"), false, "range field shown");
      await t.page.setValue("#range", "3");
      t.eq(await val(t, "#pt-out"), P3, "page 3 only");
      t.eq([await txt(t, "#pt-n-pages"), await txt(t, "#pt-n-text"), await txt(t, "#pt-n-words")], ["1", "1", "3"], "counts follow the selection");
      await t.page.setValue("#range", "9");
      t.assert((await txt(t, "#range-help")).includes("goes past the last page"), "bad range message: " + await txt(t, "#range-help"));
      t.eq(await t.page.eval(`document.querySelector("#range").getAttribute("aria-invalid")`), "true", "range marked invalid");
      t.eq(await t.page.eval(`document.querySelector("#pt-dl").disabled && document.querySelector("#pt-copy").disabled`), true, "buttons off while the range is invalid");
      await t.page.setValue("#range", "1-2");
      t.eq(await val(t, "#pt-out"), P1, "pages 1-2 (the picture page adds nothing)");
      await t.page.click('input[name=scope][value=all]');
      await t.page.click("#pt-marks");
      t.eq(await val(t, "#pt-out"), marked, "back to everything");
      // download and copy
      const dl = await t.dl("#pt-dl");
      t.eq(dl.name, "report.txt", "download name");
      t.eq(Buffer.from(dl.bytes).toString("utf8"), marked, "downloaded text");
      await t.page.click("#pt-copy");
      await t.page.waitFor(`["Copied", "Copy failed"].includes(document.querySelector("#pt-copy").textContent)`);
      await t.page.click("#pt-rows button");
      await t.page.waitFor(`["Copied", "Copy failed"].includes(document.querySelector("#pt-rows button").textContent)`);
      await t.shot("done", 375, { selector: "#tool" });
      await t.shot("done", 1280, { selector: "#tool" });
      await t.page.click("#clear");
      t.eq(await hidden(t, "#work"), true, "start over hides the result");
      t.eq(await val(t, "#pt-out"), "", "start over empties the text");
    },
  },
  {
    page: "pdf-to-text",
    name: "a PDF made only of pictures says it is probably a scan and points to OCR",
    async run(t) {
      await loadPdf(t, save(t.fixtures, "scan.pdf", await imageOnlyPdf(2)));
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("2 pages have no text"), "status: " + await txt(t, "#status"));
      t.assert((await txt(t, "#pt-ocr")).startsWith("No text was found. This PDF is probably a scan"), "note: " + await txt(t, "#pt-ocr"));
      t.eq(await t.page.eval(`document.querySelector("#pt-ocr a").getAttribute("href")`), "/tools/ocr-pdf/", "OCR link");
      t.eq(await val(t, "#pt-out"), "--- Page 1 ---\n\n--- Page 2 ---", "only the page marks");
      t.eq(await t.page.eval(`document.querySelector("#pt-dl").disabled && document.querySelector("#pt-copy").disabled`), true, "nothing to copy or download");
      await t.page.click("#pt-marks");
      t.eq(await val(t, "#pt-out"), "", "no marks: nothing at all");
      await t.shot("scan", 375, { selector: "#tool" });
    },
  },
  {
    page: "pdf-to-text",
    name: "reads a long PDF, refuses one over 500 pages, non-PDFs and encrypted files",
    async run(t) {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 40; i++) doc.addPage([300, 300]).drawText(`Page text ${i}`, { x: 20, y: 200, size: 14, font });
      await loadPdf(t, save(t.fixtures, "long.pdf", await doc.save()));
      await t.waitDone();
      t.eq(await txt(t, "#pt-n-pages"), "40", "40 pages");
      t.assert((await val(t, "#pt-out")).includes("--- Page 40 ---\n\nPage text 40"), "last page read");
      t.eq(await hidden(t, "#pt-ocr"), true, "no OCR note for a normal PDF");
      await t.page.click("#clear");
      const big = await PDFDocument.create();
      for (let i = 0; i < 501; i++) big.addPage([100, 100]);
      await t.page.setFiles(DROP, [save(t.fixtures, "big.pdf", await big.save())]);
      const msg = await t.waitError();
      t.assert(msg.includes("501 pages") && msg.includes("500"), "page limit message: " + msg);
      await expectBadPdfs(t);
    },
  },
];

/* ================================================================== Sign PDF */

/* The unit square of every image drawn on a page, as corners in page coordinates (the product of the cm matrices in force at each Do). */
function imageBoxes(doc, page) {
  const c = page.node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  const text = streams.map((s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString("latin1")).join("\n");
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  for (const m of text.matchAll(/(?:^|\s)(q|Q)(?=\s)|([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm|\/(\S+) Do/g)) {
    if (m[1] === "q") stack.push(ctm);
    else if (m[1] === "Q") ctm = stack.pop() || ctm;
    else if (m[2] !== undefined) ctm = mul([+m[2], +m[3], +m[4], +m[5], +m[6], +m[7]], ctm);
    else if (m[8] !== undefined) {
      const pt = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
      out.push({ name: m[8], ll: pt(0, 0), lr: pt(1, 0), ul: pt(0, 1), ur: pt(1, 1), ctm });
    }
  }
  return out;
}

/* Render page `pageNo` of the original and of the signed PDF with pdf.js, and describe where they differ (the ink):
   its bounding box in pixels and how much of it lies in each quarter of that box. */
async function inkDiff(t, original, signed, pageNo, scale = 3) {
  return t.page.eval(`(async () => {
    const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const pdfjs = await import("/tools/vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/tools/vendor/pdfjs/pdf.worker.min.mjs";
    const render = async (s) => {
      const doc = await pdfjs.getDocument({ data: dec(s), isEvalSupported: false, useWasm: false, verbosity: 0 }).promise;
      const page = await doc.getPage(${pageNo});
      const vp = page.getViewport({ scale: ${scale} });
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const a = await render(${q(b64(original))}), b = await render(${q(b64(signed))});
    const W = a.width, H = a.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    const hit = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 90) {
        hit.push(x, y); n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, quad = [0, 0, 0, 0];
    for (let i = 0; i < hit.length; i += 2) quad[(hit[i + 1] < cy ? 0 : 2) + (hit[i] < cx ? 0 : 1)]++;
    return { W, H, x0, y0, x1: x1 + 1, y1: y1 + 1, n, quad };   // quad: top-left, top-right, bottom-left, bottom-right
  })()`);
}

async function sizedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  const rotated = doc.addPage([400, 600]);
  rotated.setRotation(degrees(90));
  const cropped = doc.addPage([400, 600]);
  cropped.setCropBox(50, 50, 300, 500);
  cropped.setRotation(degrees(270));
  return doc.save();
}

/* Draw an L (a downward stroke, then to the right) on the signature pad with the mouse. */
async function drawL(t) {
  await t.page.eval(`document.querySelector("#sg-pad").scrollIntoView({block: "center"})`);
  const box = await t.page.eval(`(() => { const r = document.querySelector("#sg-pad").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const pt = (fx, fy) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });
  const send = (type, p, buttons) => t.page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons, clickCount: 1 });
  await send("mousePressed", pt(0.3, 0.1), 1);
  for (const [fx, fy] of [[0.3, 0.3], [0.3, 0.5], [0.3, 0.7], [0.3, 0.9], [0.4, 0.9], [0.5, 0.9], [0.6, 0.9], [0.7, 0.9]]) await send("mouseMoved", pt(fx, fy), 1);
  await send("mouseReleased", pt(0.7, 0.9), 0);
}

const signPdf = [
  {
    page: "sign-pdf",
    name: "types a signature with a date and signs the chosen page where the sliders say; other pages stay as they were",
    async run(t) {
      const original = await makePdf(3, { label: "Contract" });
      await loadPdf(t, save(t.fixtures, "contract.pdf", original));
      await t.page.waitFor(`!!document.querySelector("#sg-stage canvas.sg-view")`);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "nothing to add yet");
      t.eq(await hidden(t, "#sg-hint"), false, "hint shown");
      t.eq(await txt(t, "#sg-of"), "of 3", "page count");
      await t.page.click('input[name=sg-mode][value=type]');
      t.eq([await hidden(t, "#sg-draw"), await hidden(t, "#sg-type")], [true, false], "typing panel");
      await t.page.type("#sg-text", "Ada Lovelace");
      await t.page.click('input[name=sg-ink][value=blue]');
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.eq(await hidden(t, "#sg-hint"), true, "hint gone");
      await t.page.click("#sg-date-on");
      t.eq(await hidden(t, "#sg-date-field"), false, "date field shown");
      await t.page.setValue("#sg-date", "9 October 2026");
      await t.page.setValue("#sg-page", "2");
      await t.page.waitFor(`document.querySelector("#sg-page").value === "2" && document.querySelector("#sg-prev").disabled === false`);
      await t.page.setValue("#sg-x", "50"); await t.page.setValue("#sg-y", "25"); await t.page.setValue("#sg-w", "25");
      t.eq([await txt(t, "#sg-x-v"), await txt(t, "#sg-y-v"), await txt(t, "#sg-w-v")], ["50%", "25%", "25%"], "slider read-outs");
      const stampPx = await t.page.eval(`({ w: document.querySelector("#sg-stamp").width, h: document.querySelector("#sg-stamp").height })`);
      t.assert(stampPx.w > 100 && stampPx.h > 50, "the stamp has a size: " + JSON.stringify(stampPx));
      const css = await t.page.eval(`(() => { const s = document.querySelector("#sg-stamp"); return [s.style.left, s.style.top, s.style.width]; })()`);
      t.assert(Math.abs(parseFloat(css[2]) - 25) < 0.01, "preview width follows the size slider: " + css);
      await t.shot("ready", 375, { selector: "#tool" });
      await t.shot("ready", 1280, { selector: "#tool" });
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "contract-signed.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.widths, [401, 402, 403], "three pages, same order");
      const boxes = info.doc.getPages().map((p) => imageBoxes(info.doc, p));
      t.eq(boxes.map((b) => b.length), [0, 1, 0], "only page 2 got a picture");
      // page 2 is 402 x 560 points: width 25% of 402, centred horizontally, 25% of the free height down from the top
      const w = 0.25 * 402, h = (w * stampPx.h) / stampPx.w;
      const left = 0.5 * (402 - w), top = 0.25 * (560 - h);
      const b = boxes[1][0];
      const near = (a, c, tol, m) => t.assert(Math.abs(a - c) <= tol, `${m}: got ${a}, expected ${c}`);
      near(b.ll[0], left, 0.5, "left edge"); near(b.ll[1], 560 - top - h, 0.5, "bottom edge");
      near(b.lr[0] - b.ll[0], w, 0.5, "width"); near(b.ul[1] - b.ll[1], h, 0.5, "height");
      near(b.lr[1], b.ll[1], 1e-6, "level"); near(b.ul[0], b.ll[0], 1e-6, "upright");
      // the picture holds the signature: blue ink of Ada Lovelace plus the date line, on a transparent background
      const diff = await inkDiff(t, original, bytes, 2);
      t.assert(diff.n > 400, "ink is visible on page 2: " + diff.n);
      const k = 3;
      t.assert(diff.x0 >= (left - 1) * k && diff.x1 <= (left + w + 1) * k && diff.y0 >= (top - 1) * k && diff.y1 <= (top + h + 1) * k, "ink stays inside the placed box: " + JSON.stringify(diff));
      t.assert(diff.x1 - diff.x0 > 0.55 * w * k, "the ink spans most of the box width: " + (diff.x1 - diff.x0) + " of " + w * k);
      const same1 = await inkDiff(t, original, bytes, 1), same3 = await inkDiff(t, original, bytes, 3);
      t.eq([same1.n, same3.n], [0, 0], "pages 1 and 3 render exactly as before");
      t.assert((await txt(t, "#result .result__title")).startsWith("contract-signed.pdf"), "result block: " + await txt(t, "#result .result__title"));
    },
  },
  {
    page: "sign-pdf",
    name: "draws with the mouse, undoes, and signs every page upright on rotated and cropped pages",
    async run(t) {
      const original = await sizedPdf();
      await loadPdf(t, save(t.fixtures, "forms.pdf", original));
      await t.page.waitFor(`!!document.querySelector("#sg-stage canvas.sg-view")`);
      // a stroke that is then undone leaves nothing; the L stays
      await drawL(t);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      t.eq(await t.page.eval(`document.querySelector("#sg-undo").disabled`), false, "undo is available");
      await t.page.click("#sg-undo");
      t.eq(await t.page.eval(`[document.querySelector("#go").disabled, document.querySelector("#sg-undo").disabled, document.querySelector("#sg-clear").disabled]`), [true, true, true], "undo removed the only stroke");
      await drawL(t);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await drawL(t);   // a second, identical stroke on top
      await t.page.click("#sg-undo");
      await t.page.click('input[name=sg-scope][value=all]');
      await t.page.setValue("#sg-x", "100"); await t.page.setValue("#sg-y", "100"); await t.page.setValue("#sg-w", "40");
      const stampPx = await t.page.eval(`({ w: document.querySelector("#sg-stamp").width, h: document.querySelector("#sg-stamp").height })`);
      await t.page.click("#go");
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("Signature added to 3 pages"), "status: " + await txt(t, "#status"));
      const { name, bytes } = await t.dl();
      t.eq(name, "forms-signed.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.rotations, [0, 90, 270], "rotations kept");
      t.eq(info.doc.getPages().map((p) => imageBoxes(info.doc, p).length), [1, 1, 1], "one picture on every page");
      const pdfjsDisplay = [[400, 600], [600, 400], [500, 300]];   // the pages as a viewer shows them
      for (let i = 0; i < 3; i++) {
        const [dw, dh] = pdfjsDisplay[i];
        const d = await inkDiff(t, original, bytes, i + 1);
        const sw = 0.4 * dw, sh = (sw * stampPx.h) / stampPx.w, k = 3;
        t.eq([d.W, d.H], [dw * k, dh * k], `page ${i + 1} is rendered as ${dw} x ${dh}`);
        t.assert(d.n > 300, `page ${i + 1}: ink is visible (${d.n})`);
        t.assert(d.x1 <= dw * k + 1 && d.y1 <= dh * k + 1 && d.x0 >= (dw - sw - 1) * k && d.y0 >= (dh - sh - 1) * k, `page ${i + 1}: ink is inside the bottom-right box ${JSON.stringify(d)}`);
        t.assert(d.x1 >= (dw - 0.1 * sw) * k && d.y1 >= (dh - 0.12 * sh) * k, `page ${i + 1}: ink reaches the bottom-right corner of the box`);
        const total = d.quad.reduce((a, c) => a + c, 0);
        const [tl, tr, bl, br] = d.quad.map((c) => c / total);
        t.assert(tr < 0.04 && bl > tl && bl > br && tl > 0.12 && br > 0.12, `page ${i + 1}: the L stands upright (quarters TL/TR/BL/BR ${[tl, tr, bl, br].map((c) => c.toFixed(2))})`);
      }
    },
  },
  {
    page: "sign-pdf",
    name: "drag the signature, tap the page to place it, step through pages, clear",
    async run(t) {
      await loadPdf(t, save(t.fixtures, "three.pdf", await makePdf(3)));
      await t.page.waitFor(`!!document.querySelector("#sg-stage canvas.sg-view")`);
      await t.page.click('input[name=sg-mode][value=type]');
      await t.page.type("#sg-text", "Sam Signer");
      await t.page.waitFor(`!document.querySelector("#sg-stamp").hidden`);
      const centre = () => t.page.eval(`(() => { const r = document.querySelector("#sg-stamp").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      const stage = () => t.page.eval(`(() => { const r = document.querySelector("#sg-stage").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      await t.page.eval(`document.querySelector("#sg-stage").scrollIntoView({block: "center"})`);
      // tap on the page: the stamp's centre goes under the tap
      const s = await stage();
      await t.page.mouseClickAt("#sg-stage", 0.3, 0.4);
      const c1 = await centre();
      t.assert(Math.abs(c1[0] - (s.x + s.w * 0.3)) < 4 && Math.abs(c1[1] - (s.y + s.h * 0.4)) < 4, "tap moves the stamp's centre to the tap: " + c1 + " vs " + [s.x + s.w * 0.3, s.y + s.h * 0.4]);
      const x1 = await val(t, "#sg-x"), y1 = await val(t, "#sg-y");
      t.assert(Number(x1) > 5 && Number(x1) < 60 && Number(y1) > 10 && Number(y1) < 70, `sliders follow: ${x1}/${y1}`);
      // drag the stamp 100 px right and 60 px down
      const from = await centre();
      const send = (type, x, y, buttons) => t.page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
      await send("mousePressed", from[0], from[1], 1);
      await send("mouseMoved", from[0] + 50, from[1] + 30, 1);
      await send("mouseMoved", from[0] + 100, from[1] + 60, 1);
      await send("mouseReleased", from[0] + 100, from[1] + 60, 0);
      const c2 = await centre();
      t.assert(Math.abs(c2[0] - (from[0] + 100)) < 3 && Math.abs(c2[1] - (from[1] + 60)) < 3, "drag keeps the grab point: " + c2 + " vs " + [from[0] + 100, from[1] + 60]);
      t.assert(Number(await val(t, "#sg-x")) > Number(x1) && Number(await val(t, "#sg-y")) > Number(y1), "sliders moved right and down");
      // dragging far outside stops at the page edge
      await send("mousePressed", c2[0], c2[1], 1);
      await send("mouseMoved", s.x + s.w - 2, s.y + s.h - 2, 1);
      await send("mouseReleased", s.x + s.w - 2, s.y + s.h - 2, 0);
      t.eq([await val(t, "#sg-x"), await val(t, "#sg-y")], ["100", "100"], "the stamp stays on the page");
      // pages
      await t.page.click("#sg-next");
      await t.page.waitFor(`document.querySelector("#sg-page").value === "2"`);
      await t.page.click("#sg-next");
      await t.page.waitFor(`document.querySelector("#sg-page").value === "3" && document.querySelector("#sg-next").disabled`);
      await t.page.waitFor(`document.querySelector("#sg-stage canvas.sg-view").getAttribute("aria-label") === "Preview of page 3"`);
      await t.page.click("#sg-prev");
      await t.page.setValue("#sg-page", "99");
      await t.page.waitFor(`document.querySelector("#sg-page").value === "3"`);
      // the date line makes the stamp taller
      const h0 = await t.page.eval(`document.querySelector("#sg-stamp").height`);
      await t.page.click("#sg-date-on");
      t.assert((await t.page.eval(`document.querySelector("#sg-stamp").height`)) > h0, "the date adds a line to the stamp");
      await t.page.click("#sg-date-on");
      t.eq(await t.page.eval(`document.querySelector("#sg-stamp").height`), h0, "and removes it again");
      // changing to drawing with nothing drawn removes the stamp and switches the button off
      await t.page.click('input[name=sg-mode][value=draw]');
      t.eq([await hidden(t, "#sg-stamp"), await t.page.eval(`document.querySelector("#go").disabled`)], [true, true], "no drawing, no stamp");
      await t.page.click('input[name=sg-mode][value=type]');
      await t.page.setValue("#sg-text", "   ");
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "blank name, no stamp");
    },
  },
  {
    page: "sign-pdf",
    name: "refuses non-PDF and encrypted files",
    async run(t) { await expectBadPdfs(t); await t.shot("error", 375, { selector: "#tool" }); },
  },
];

/* ================================================================== Image to WebP */

const webpFmt = (bytes) => {
  const b = Buffer.from(bytes);
  return b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" ? (b.includes("VP8L") ? "lossless" : "lossy") : "not webp";
};

const imageToWebp = [
  {
    page: "image-to-webp",
    name: "converts a PNG with transparency and a JPEG, compares sizes, quality changes the size, one zip",
    async run(t) {
      const png = save(t.fixtures, "alpha.png", makePng(120, 80, { alpha: true }));
      const jpeg = save(t.fixtures, "photo.jpg", await browserImage(t, "image/jpeg", 0.95));
      await t.page.setFiles(DROP, [png, jpeg]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 2 && !document.querySelector("#go").disabled`);
      t.eq(await hidden(t, "#webp-note"), true, "this browser can save WebP, so no warning");
      t.assert((await txt(t, "#summary")).startsWith("2 images · "), "summary: " + await txt(t, "#summary"));
      await t.page.setValue("#quality", "60");
      t.eq(await txt(t, "#quality-out"), "60", "quality read-out");
      await t.page.click("#go");
      await t.waitDone();
      t.eq(await t.page.eval(`document.querySelectorAll("#result .dl li").length`), 2, "two files listed");
      const notes = await t.page.eval(`[...document.querySelectorAll("#result .dl li")].map((li) => li.textContent)`);
      t.assert(notes.every((n) => /\.webp/.test(n) && /→/.test(n) && /(smaller|larger|same size)/.test(n)), "each file shows before → after: " + JSON.stringify(notes));
      t.assert(/Total: .* → /.test(await txt(t, "#result .result__note")), "total line: " + await txt(t, "#result .result__note"));
      const zip = await t.dl();
      t.eq(zip.name, "webp-images.zip", "zip name");
      const files = unzip(zip.bytes);
      t.eq(files.map((f) => f.name), ["alpha.webp", "photo.webp"], "names");
      t.eq(files.map((f) => imageInfo(f.data).format), ["webp", "webp"], "both are WebP");
      t.eq(files.map((f) => [imageInfo(f.data).width, imageInfo(f.data).height]), [[120, 80], [640, 480]], "sizes kept");
      t.eq(files.map((f) => webpFmt(f.data)), ["lossy", "lossy"], "lossy below 100");
      // transparency is kept: the right third of the PNG fixture is 96/255 opaque, the left is solid
      const px = await pixels(t, files[0].data, [[110, 40], [5, 5]]);
      t.assert(px[0][3] > 60 && px[0][3] < 140 && px[1][3] === 255, "alpha kept: " + JSON.stringify(px));
      // quality changes the size
      const sizes = {};
      for (const quality of ["15", "95"]) {
        await t.page.click("#clear");
        await t.page.setFiles(DROP, [jpeg]);
        await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
        await t.page.setValue("#quality", quality);
        await t.page.click("#go");
        await t.waitDone();
        const one = await t.dl();
        t.eq(one.name, "photo.webp", "single file name");
        sizes[quality] = one.bytes.length;
        t.assert(/→/.test(await txt(t, "#result .result__head")), "single result shows the comparison: " + await txt(t, "#result .result__head"));
        t.eq(await hidden(t, "#compare"), false, "side-by-side shown for one image");
        t.eq(await t.page.eval(`document.querySelectorAll("#compare figure").length`), 2, "two figures");
      }
      t.assert(sizes["15"] < sizes["95"], `lower quality is smaller: ${JSON.stringify(sizes)}`);
      // 100 asks for lossless
      await t.page.setValue("#quality", "100");
      await t.page.click("#go");
      await t.waitDone();
      const lossless = await t.dl();
      t.eq(webpFmt(lossless.bytes), "lossless", "quality 100 gives a lossless file");
      t.assert((await txt(t, "#result .result__head")).includes("lossless"), "and says so: " + await txt(t, "#result .result__head"));
      await t.shot("done", 375, { selector: "#tool" });
      await t.shot("done", 1280, { selector: "#tool" });
    },
  },
  {
    page: "image-to-webp",
    name: "reports files that get bigger, accepts a WebP input, refuses non-images",
    async run(t) {
      // a tiny flat PNG is smaller than any WebP wrapper
      const tiny = save(t.fixtures, "dot.png", solidPng(4, 4, [10, 20, 30]));
      await t.page.setFiles(DROP, [tiny]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.setValue("#quality", "100");
      await t.page.click("#go");
      await t.waitDone();
      const note = await txt(t, "#result .result__head");
      t.assert(/larger|same size/.test(note), "a 4 x 4 PNG gets no smaller: " + note);
      t.assert(/not smaller|Saved/.test(await txt(t, "#status")), "status: " + await txt(t, "#status"));
      // WebP in, WebP out under another name
      const out = await t.dl();
      const again = save(t.fixtures, "dot.webp", out.bytes);
      await t.page.click("#clear");
      await t.page.setFiles(DROP, [again]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      t.eq((await t.dl()).name, "dot-recompressed.webp", "same-format input gets a new name");
      await t.page.click("#clear");
      const note2 = save(t.fixtures, "notes.txt", Buffer.from("hello"));
      await t.page.setFiles(DROP, [note2]);
      t.assert(/isn't a supported image/.test(await t.waitError()), "non-image refused");
    },
  },
  {
    page: "image-to-webp",
    name: "says so and switches off when the browser cannot save WebP",
    async run(t) {
      await t.page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb, type, quality) { return orig.call(this, cb, type === "image/webp" ? "image/png" : type, quality); }; })();` });
      await t.go();
      await t.page.waitFor(`!document.querySelector("#webp-note").hidden`);
      t.eq(await txt(t, "#webp-note"), "This browser can't save WebP files. Try Chrome, Edge or Firefox.", "notice");
      await t.page.setFiles(DROP, [save(t.fixtures, "a.png", makePng(40, 30))]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1`);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "convert is off");
      t.assert((await txt(t, "#summary")).includes("can't save WebP"), "summary says why: " + await txt(t, "#summary"));
      await t.shot("unsupported", 375, { selector: "#tool" });
    },
  },
];

/* ================================================================== GIF maker */

const gifBlocks = (bytes) => {
  const b = Buffer.from(bytes);
  return { header: b.toString("latin1", 0, 6), loop: b.includes("NETSCAPE2.0"), trailer: b[b.length - 1] };
};

/* Decode the frames of a GIF with the browser's own decoder: colours at some points, and the delay of each frame in ms. */
async function gifFrames(t, bytes, points) {
  return t.page.eval(`(async () => {
    const u = Uint8Array.from(atob(${q(b64(bytes))}), (c) => c.charCodeAt(0));
    const d = new ImageDecoder({ data: u, type: "image/gif" });
    await d.tracks.ready;
    const n = d.tracks.selectedTrack.frameCount;
    const out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await d.decode({ frameIndex: i });
      const c = document.createElement("canvas"); c.width = image.displayWidth; c.height = image.displayHeight;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(image, 0, 0);
      out.push({ ms: Math.round(image.duration / 1000), colours: ${q(points)}.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3)) });
      image.close();
    }
    return out;
  })()`);
}

const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255];
const close = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function addFrames(t, paths, n = paths.length) {
  await t.page.setFiles(DROP, paths);
  await t.page.waitFor(`document.querySelectorAll("#files > li").length === ${n}`);
}

const gifMaker = [
  {
    page: "gif-maker",
    name: "makes a GIF from three pictures: order, delay, size, fit and loop all show up in the file",
    async run(t) {
      const red = save(t.fixtures, "1-red.png", solidPng(200, 100, [255, 0, 0]));
      const green = save(t.fixtures, "2-green.png", solidPng(100, 200, [0, 255, 0]));
      const blue = save(t.fixtures, "3-blue.png", solidPng(200, 100, [0, 0, 255]));
      await addFrames(t, [red, green, blue]);
      t.eq(await val(t, "#gm-width"), "200", "width defaults to the first picture, up to 480");
      t.eq(await txt(t, "#gm-size"), "200 × 100 px", "size follows the first picture");
      t.assert((await txt(t, "#summary")).startsWith("3 images · 200 × 100 px"), "summary: " + await txt(t, "#summary"));
      t.eq(await t.page.eval(`[...document.querySelectorAll("#files .files__name")].map((e) => e.firstChild.textContent)`), ["1-red.png", "2-green.png", "3-blue.png"], "frame order");
      t.eq(await t.page.eval(`document.querySelectorAll("#files .files__thumb canvas").length`), 3, "a thumbnail per frame");
      // order: moving the green portrait picture to the front changes the size, moving it back restores it
      await t.page.click('#files li:nth-child(2) [data-act="up"]');
      t.eq(await t.page.eval(`[...document.querySelectorAll("#files .files__name")].map((e) => e.firstChild.textContent)`), ["2-green.png", "1-red.png", "3-blue.png"], "moved up");
      t.eq(await txt(t, "#gm-size"), "200 × 400 px", "size now follows the green picture");
      await t.page.click('#files li:nth-child(1) [data-act="down"]');
      t.eq(await txt(t, "#gm-size"), "200 × 100 px", "back in order");
      // the preview animates, and pauses
      await t.page.setValue("#gm-delay", "100");
      t.eq(await txt(t, "#gm-play"), "Pause preview", "playing by default");
      await t.page.waitFor(`document.querySelector("#gm-view").width === 200`);
      const centre = () => t.page.eval(`Array.from(document.querySelector("#gm-view").getContext("2d").getImageData(100, 50, 1, 1).data).slice(0, 3).join(",")`);
      const seen = new Set();
      for (let i = 0; i < 40 && seen.size < 2; i++) { seen.add(await centre()); await new Promise((r) => setTimeout(r, 60)); }
      t.assert(seen.size >= 2, "the preview shows different frames over time: " + [...seen]);
      await t.page.click("#gm-play");
      t.eq(await txt(t, "#gm-play"), "Play preview", "paused");
      const frozen = await centre();
      await new Promise((r) => setTimeout(r, 500));
      t.eq(await centre(), frozen, "paused preview does not change");
      // make the GIF: 100 px wide (so 100 x 50), 200 ms per frame
      await t.page.setValue("#gm-width", "100");
      await t.page.setValue("#gm-delay", "200");
      await t.page.click("#go");
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("3 frames"), "status: " + await txt(t, "#status"));
      const gif = await t.dl();
      t.eq(gif.name, "animation.gif", "file name");
      const info = imageInfo(gif.bytes);
      t.eq([info.format, info.width, info.height], ["gif", 100, 50], "a 100 x 50 GIF");
      t.eq(gifBlocks(gif.bytes), { header: "GIF89a", loop: true, trailer: 0x3b }, "GIF89a, loops forever, has a trailer");
      const frames = await gifFrames(t, gif.bytes, [[50, 25], [5, 25], [95, 2]]);
      t.eq(frames.map((f) => f.ms), [200, 200, 200], "200 ms per frame");
      t.assert(close(frames[0].colours[0], RED) && close(frames[0].colours[1], RED), "frame 1 is red all over: " + JSON.stringify(frames[0]));
      t.assert(close(frames[1].colours[0], GREEN) && close(frames[1].colours[1], WHITE), "frame 2: the tall green picture sits in the middle on white: " + JSON.stringify(frames[1]));
      t.assert(close(frames[2].colours[0], BLUE) && close(frames[2].colours[2], BLUE), "frame 3 is blue: " + JSON.stringify(frames[2]));
      t.eq(await t.page.eval(`!!document.querySelector("#result img") && document.querySelector("#result img").naturalWidth`), 100, "the finished GIF is shown");
      t.assert((await txt(t, "#result .result__head")).includes("100 × 50 px · 3 frames · 0.6 s"), "result note: " + await txt(t, "#result .result__head"));
      // fit: fill and crop makes the tall green picture cover the frame; stretch does too; a background colour shows with fit inside
      await t.page.click('input[name=gm-fit][value=cover]');
      t.eq(await t.page.eval(`document.querySelector("#result").hidden`), true, "an option change clears the old result");
      await t.page.click("#go");
      await t.waitDone();
      const cover = await gifFrames(t, (await t.dl()).bytes, [[5, 25], [95, 2]]);
      t.assert(cover[1].colours.every((c) => close(c, GREEN)), "cover: green fills the frame: " + JSON.stringify(cover[1]));
      await t.page.click('input[name=gm-fit][value=contain]');
      await t.page.setValue("#gm-bg", "#ff0000");
      await t.page.click('input[name=gm-loop][value=once]');
      await t.page.click("#gm-pingpong");
      await t.page.click("#go");
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("4 frames"), "ping-pong adds the way back: " + await txt(t, "#status"));
      const back = await t.dl();
      t.eq(gifBlocks(back.bytes).loop, false, "play once: no loop extension");
      const pp = await gifFrames(t, back.bytes, [[5, 25], [50, 25]]);
      t.eq(pp.length, 4, "four frames");
      t.assert(close(pp[1].colours[0], RED) && close(pp[1].colours[1], GREEN), "contain with a red background: " + JSON.stringify(pp[1]));
      t.assert(close(pp[3].colours[1], GREEN), "the way back repeats the green frame: " + JSON.stringify(pp.map((f) => f.colours[1])));
      await t.shot("done", 375, { selector: "#tool" });
      await t.shot("done", 1280, { selector: "#tool" });
    },
  },
  {
    page: "gif-maker",
    name: "needs two pictures; refuses non-images and too-big output; removing and clearing work",
    async run(t) {
      const red = save(t.fixtures, "red.png", solidPng(60, 40, [255, 0, 0]));
      const blue = save(t.fixtures, "blue.png", solidPng(60, 40, [0, 0, 255]));
      await addFrames(t, [red]);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "one picture is not enough");
      t.assert((await txt(t, "#summary")).includes("Add at least two images"), "summary: " + await txt(t, "#summary"));
      await addFrames(t, [blue], 2);
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), false, "two pictures are");
      t.eq(await val(t, "#gm-width"), "60", "width default is the first picture's");
      await t.page.setFiles(DROP, [save(t.fixtures, "notes.txt", Buffer.from("hello"))]);
      t.assert(/isn't a supported image/.test(await t.waitError()), "non-image refused");
      // the width is limited to 1,200 pixels, and the height follows the first picture
      await t.page.setValue("#gm-width", "5000");
      t.eq(await t.page.eval(`document.querySelector("#gm-width").value`), "5000", "typed value stays in the box");
      t.assert((await txt(t, "#gm-size")).startsWith("1200 × 800"), "limited to 1200 wide: " + await txt(t, "#gm-size"));
      await t.page.click('#files li:nth-child(1) [data-act="remove"]');
      t.eq(await t.page.eval(`document.querySelectorAll("#files > li").length`), 1, "removed");
      t.eq(await t.page.eval(`document.querySelector("#go").disabled`), true, "back to one picture");
      await t.page.click("#clear");
      t.eq(await t.page.eval(`[document.querySelector("#opts").hidden, document.querySelector("#files").hidden]`), [true, true], "cleared");
      // the shortest delay is 20 ms
      await addFrames(t, [red, blue]);
      await t.page.setValue("#gm-width", "40");
      await t.page.setValue("#gm-delay", "3");
      await t.page.click("#go");
      await t.waitDone();
      const quick = await gifFrames(t, (await t.dl()).bytes, [[1, 1]]);
      t.eq(quick.map((f) => f.ms), [20, 20], "a 3 ms delay becomes 20 ms");
      // 32 colours still gives the right colours for flat pictures
      await t.page.setValue("#gm-colors", "32");
      await t.page.click("#go");
      await t.waitDone();
      const few = await gifFrames(t, (await t.dl()).bytes, [[20, 13]]);
      t.assert(close(few[0].colours[0], RED) && close(few[1].colours[0], BLUE), "32 colours: " + JSON.stringify(few));
    },
  },
];

/* ================================================================== HEIC to JPG */

/* 96 x 64 HEIC pictures made with libheif and x265 from a synthetic image (see check/unit/tools5.mjs): a colour gradient with a red
   rectangle top left, blue top right, yellow bottom left, green bottom right and a white ellipse in the middle. */
const heicFixture = (name) => Buffer.from(readFileSync(new URL(`../heic-fixtures/${name}`, import.meta.url)));
const HEIC_COLOURS = [[[10, 10], [230, 30, 30]], [[70, 10], [30, 60, 220]], [[10, 45], [240, 200, 20]], [[70, 45], [30, 170, 60]], [[48, 32], [250, 250, 250]]];

async function expectHeicColours(t, bytes, tol = 24) {
  const px = await pixels(t, bytes, HEIC_COLOURS.map(([p]) => p));
  HEIC_COLOURS.forEach(([p, want], i) => t.assert(px[i].slice(0, 3).every((v, k) => Math.abs(v - want[k]) <= tol), `colour at ${p}: got ${px[i]}, expected about ${want}`));
}

const heicToJpg = [
  {
    page: "heic-to-jpg",
    name: "converts HEIC photos to JPG in a worker: size, colours, notes, quality, one zip",
    async run(t) {
      const a = save(t.fixtures, "photo-q85.heic", heicFixture("photo-q85.heic"));
      const b = save(t.fixtures, "photo-q60.heic", heicFixture("photo-q60.heic"));
      await t.page.setFiles(DROP, [a, b]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 2 && !document.querySelector("#go").disabled`);
      t.assert((await txt(t, "#files li:first-child .files__meta")).endsWith("HEIC"), "list meta: " + await txt(t, "#files li:first-child .files__meta"));
      t.assert((await txt(t, "#summary")).startsWith("2 images · "), "summary: " + await txt(t, "#summary"));
      await t.page.setValue("#quality", "80");
      t.eq(await txt(t, "#quality-out"), "80", "quality read-out");
      await t.page.click("#go");
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("Converted 2 photos to JPG."), "status: " + await txt(t, "#status"));
      const loaded = await t.page.eval(`performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname)`);
      t.assert(loaded.includes("/tools/js/heic-worker.js") && loaded.includes("/tools/vendor/ts-heic/ts-heic.esm.js"), "the decoder ran in the worker: " + loaded.filter((p) => /heic/.test(p)));
      const notes = await t.page.eval(`[...document.querySelectorAll("#result .dl li .dl__size")].map((e) => e.textContent.trim()).filter((s) => s.includes("→"))`);
      t.eq(notes.length, 2, "a note per file");
      t.assert(notes.every((n) => n.startsWith("96 × 64 px · ") && /(smaller|larger|same size)/.test(n)), "notes: " + JSON.stringify(notes));
      t.assert(/^Total: .* → /.test(await txt(t, "#result .result__note")), "total line: " + await txt(t, "#result .result__note"));
      const zip = await t.dl();
      t.eq(zip.name, "jpg-images.zip", "zip name");
      const files = unzip(zip.bytes);
      t.eq(files.map((f) => f.name), ["photo-q85.jpg", "photo-q60.jpg"], "names");
      t.eq(files.map((f) => [imageInfo(f.data).format, imageInfo(f.data).width, imageInfo(f.data).height]), [["jpeg", 96, 64], ["jpeg", 96, 64]], "96 x 64 JPEGs");
      await expectHeicColours(t, files[0].data);
      await expectHeicColours(t, files[1].data, 30);
      // quality changes the size
      const sizes = {};
      for (const quality of ["40", "100"]) {
        await t.page.click("#clear");
        await t.page.setFiles(DROP, [a]);
        await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
        await t.page.setValue("#quality", quality);
        await t.page.click("#go");
        await t.waitDone();
        const one = await t.dl();
        t.eq(one.name, "photo-q85.jpg", "single file name");
        sizes[quality] = one.bytes.length;
      }
      t.assert(sizes["40"] < sizes["100"], "lower quality is smaller: " + JSON.stringify(sizes));
      await t.shot("done", 375, { selector: "#tool" });
      await t.shot("done", 1280, { selector: "#tool" });
    },
  },
  {
    page: "heic-to-jpg",
    name: "refuses what is not a HEIC photo or cannot be read; the other photos in the batch still convert",
    async run(t) {
      const png = save(t.fixtures, "picture.heic", makePng(40, 30));              // a PNG with a .heic name: judged by content
      await t.page.setFiles(DROP, [png]);
      t.assert(/doesn't look like a HEIC photo/.test(await t.waitError()), "a PNG called .heic is refused");
      const avif = Buffer.from(heicFixture("photo-q85.heic")); avif.set(Buffer.from("avif"), 8); avif.set(Buffer.from("avif"), 20);
      await t.page.setFiles(DROP, [save(t.fixtures, "pic.avif", avif)]);
      t.assert(/"pic.avif" doesn't look like a HEIC photo/.test(await t.waitError()), "an AVIF file is refused");
      await t.page.setFiles(DROP, [save(t.fixtures, "notes.txt", Buffer.from("hello"))]);
      t.assert(/doesn't look like a HEIC photo/.test(await t.waitError()), "a text file is refused");
      t.eq(await t.page.eval(`document.querySelectorAll("#files > li").length`), 0, "nothing was added");
      // a lossless HEIC passes the first look but the decoder cannot read it
      const good = save(t.fixtures, "good.heic", heicFixture("photo-q85.heic"));
      const lossless = save(t.fixtures, "lossless.heic", heicFixture("lossless.heic"));
      await t.page.setFiles(DROP, [lossless, good]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 2 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      t.assert((await txt(t, "#status")).includes("Converted 1 photo to JPG."), "status: " + await txt(t, "#status"));
      t.assert((await txt(t, "#result .result__note")).includes("lossless.heic") && (await txt(t, "#result .result__note")).includes("couldn't be converted"), "the failure is reported: " + await txt(t, "#result .result__note"));
      const one = await t.dl();
      t.eq(one.name, "good.jpg", "the good photo came out");
      await expectHeicColours(t, one.bytes);
      // when every file fails, the message says why
      await t.page.click("#clear");
      await t.page.setFiles(DROP, [lossless]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      const msg = await t.waitError();
      t.assert(msg.includes("lossless.heic") && msg.includes("10-bit or lossless"), "error: " + msg);
      await t.shot("error", 375, { selector: "#tool" });
    },
  },
  {
    page: "heic-to-jpg",
    name: "converts on the page itself when the browser has no workers, and refuses a photo over 50 megapixels",
    async run(t) {
      await t.page.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(window, 'Worker', { value: undefined, configurable: true });" });
      await t.go();
      t.eq(await t.page.eval(`typeof Worker`), "undefined", "workers switched off");
      await t.page.setFiles(DROP, [save(t.fixtures, "photo-q85.heic", heicFixture("photo-q85.heic"))]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      const one = await t.dl();
      t.eq([one.name, imageInfo(one.bytes).width, imageInfo(one.bytes).height], ["photo-q85.jpg", 96, 64], "converted without a worker");
      const loaded = await t.page.eval(`performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname)`);
      t.assert(!loaded.includes("/tools/js/heic-worker.js") && loaded.includes("/tools/vendor/ts-heic/ts-heic.esm.js"), "the decoder was loaded into the page: " + loaded.filter((p) => /heic/.test(p)));
      await expectHeicColours(t, one.bytes);
      // 9000 x 9000 pixels is 81 megapixels
      const big = Buffer.from(heicFixture("photo-q85.heic"));
      const at = big.indexOf("ispe");
      big.writeUInt32BE(9000, at + 8); big.writeUInt32BE(9000, at + 12);
      await t.page.click("#clear");
      await t.page.setFiles(DROP, [save(t.fixtures, "huge.heic", big)]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      const msg = await t.waitError();
      t.assert(msg.includes("9000 × 9000 pixels (81 megapixels)") && msg.includes("The limit is 50 megapixels"), "size message: " + msg);
    },
  },
];

export default [...pdfToText, ...signPdf, ...imageToWebp, ...gifMaker, ...heicToJpg];
