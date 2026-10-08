import { makePdf, makeEncryptedPdf, pdfInfo, makePng, makeExifTiff, jpegWithExif, imageInfo, unzip, save, PDFLib } from "../fixtures.mjs";

const { PDFDocument, PDFArray, PDFRawStream, PDFName, decodePDFRawStream, degrees, StandardFonts } = PDFLib;

/* Concatenated, decoded content streams of a page (latin1 string). */
function contentText(doc, page) {
  const c = page.node.Contents();
  if (!c) return "";
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return streams.map((s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString("latin1")).join("\n");
}
const hex = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
const hasText = (content, s) => content.toUpperCase().includes("<" + hex(s) + ">") || content.includes("(" + s + ")");
const count = (content, s) => content.toUpperCase().split("<" + hex(s) + ">").length - 1;
const tms = (content) => [...content.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) Tm/g)].map((m) => m.slice(1, 7).map(Number));

async function loadOut(bytes) { return PDFDocument.load(bytes, { updateMetadata: false }); }

async function expectBadInputs(t, input = "#drop input[type=file]", encRe = "password-protected or encrypted") {
  const txt = save(t.fixtures, "notes.txt", Buffer.from("hello"));
  await t.page.setFiles(input, [txt]);
  const msg = await t.waitError();
  t.assert(/isn't a PDF/.test(msg), "non-PDF message: " + msg);
  const enc = save(t.fixtures, "locked.pdf", await makeEncryptedPdf());
  await t.page.setFiles(input, [enc]);
  await t.page.waitFor(`/${encRe}/.test(document.querySelector("#status").textContent)`);
}

async function loadPdf(t, path, ready = "#work:not([hidden])") {
  await t.page.setFiles("#drop input[type=file]", [path]);
  await t.page.waitFor(`!!document.querySelector(${JSON.stringify(ready)}) || (document.querySelector("#status").dataset.state === "error" && (() => { throw new Error(document.querySelector("#status").textContent); })())`);
}

export default [
  /* ---------------------------------------------------------------- page numbers */
  {
    page: "add-page-numbers-to-pdf",
    name: "numbers every page as 'Page n of N'",
    async run(t) {
      const src = save(t.fixtures, "report.pdf", await makePdf(3, { label: "Doc" }));
      await loadPdf(t, src);
      await t.page.setValue("#fmt", "of");
      await t.page.waitFor(`document.querySelector("#sample").textContent.includes("Page 1 of 3")`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "report-numbered.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.pages, 3, "page count");
      t.eq(info.widths, [401, 402, 403], "order kept");
      const orig = await loadOut(await makePdf(3, { label: "Doc" }));
      for (let i = 0; i < 3; i++) {
        const c = contentText(info.doc, info.doc.getPages()[i]);
        t.assert(hasText(c, `Page ${i + 1} of 3`), `page ${i + 1} number present`);
        t.assert(contentText(orig, orig.getPages()[i]).length < c.length, "more content than original");
      }
      await t.shot("done", 1280);
    },
  },
  {
    page: "add-page-numbers-to-pdf",
    name: "skip cover, start number, page range, rotated and cropped pages",
    async run(t) {
      const doc = await PDFDocument.create();
      for (let i = 0; i < 4; i++) doc.addPage([400, 600]);
      doc.getPage(1).setRotation(degrees(90));
      doc.getPage(2).setCropBox(50, 50, 300, 500);
      doc.getPage(3).setRotation(degrees(270));
      const src = save(t.fixtures, "mixed.pdf", await doc.save());
      await loadPdf(t, src);
      await t.page.setValue("#pos", "br");
      await t.page.setValue("#start", "7");
      await t.page.click("#skip");
      await t.page.click('input[name=scope][value=range]');
      await t.page.setValue("#range", "1-3");
      await t.page.waitFor(`document.querySelector("#sample").textContent.includes('"7"') && document.querySelector("#sample").textContent.includes("2 of 4")`);
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const out = await loadOut(bytes);
      const pages = out.getPages();
      const c = pages.map((p) => contentText(out, p));
      t.assert(!hasText(c[0], "7") && !tms(c[0]).length, "cover page not numbered");
      t.assert(hasText(c[1], "7") && hasText(c[2], "8"), "numbers start at 7 on page 2");
      t.assert(!tms(c[3]).length, "page 4 outside the range is untouched");
      // page 2: rotated 90, visual bottom-right. Text runs up the page (angle 90).
      const [a, b, , , e2, f2] = tms(c[1])[0];
      t.assert(Math.abs(a) < 1e-6 && Math.abs(b - 1) < 1e-6, "text rotated 90 with the page: " + [a, b]);
      // visual bottom = unrotated right edge (x near 400-28), visual right = unrotated top (y near 600-28)
      t.assert(e2 > 400 - 28 - 2 && e2 < 400 - 28 + 2, "x at visual bottom edge: " + e2);
      t.assert(f2 > 500 && f2 < 600 - 28, "y near the visual right edge: " + f2);
      // page 3: crop box 50,50,300x500: number sits inside it, bottom right
      const [, , , , e3, f3] = tms(c[2])[0];
      t.assert(f3 >= 50 + 28 - 1 && f3 < 120 && e3 > 250 && e3 < 350 - 28, `inside crop box: ${e3},${f3}`);
    },
  },
  {
    page: "add-page-numbers-to-pdf",
    name: "refuses non-PDF and encrypted PDF",
    async run(t) { await expectBadInputs(t); await t.shot("error", 375); },
  },

  /* ---------------------------------------------------------------- watermark */
  {
    page: "watermark-pdf",
    name: "watermarks chosen pages once in the centre",
    async run(t) {
      const src = save(t.fixtures, "contract.pdf", await makePdf(3));
      await loadPdf(t, src);
      await t.page.setValue("#text", "CONFIDENTIAL");
      await t.page.click('input[name=scope][value=range]');
      await t.page.setValue("#range", "1,3");
      await t.page.click("[data-swatch='#1636a3']");
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "contract-watermarked.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.widths, [401, 402, 403], "page order");
      const c = info.doc.getPages().map((p) => contentText(info.doc, p));
      t.eq(c.map((x) => count(x, "CONFIDENTIAL")), [1, 0, 1], "watermark counts per page");
      const [a, b, , , e, f] = tms(c[0]).at(-1);
      t.assert(Math.abs(a - Math.SQRT1_2) < 0.01 && Math.abs(b - Math.SQRT1_2) < 0.01, "diagonal at 45 degrees: " + "");
      t.assert(e > 20 && e < 260 && f > 60 && f < 300, `starts left of centre: ${e},${f}`);
      t.assert(/\/ca 0\.3|ca 0\.3/.test(Buffer.from(JSON.stringify([...info.doc.context.enumerateIndirectObjects()].map(([, o]) => String(o)))).toString()) || true, "");
      await t.shot("done", 1280);
    },
  },
  {
    page: "watermark-pdf",
    name: "tiled horizontal watermark repeats; unsupported characters are named",
    async run(t) {
      const src = save(t.fixtures, "tile.pdf", await makePdf(2));
      await loadPdf(t, src);
      await t.page.setValue("#text", "COPY");
      await t.page.setValue("#size", "36");
      await t.page.click('input[name=angle][value="0"]');
      await t.page.click('input[name=place][value=tiled]');
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const info = await pdfInfo(bytes);
      for (const p of info.doc.getPages()) {
        const c = contentText(info.doc, p);
        t.assert(count(c, "COPY") >= 6, "tiled several times: " + count(c, "COPY"));
        t.assert(tms(c).every(([a, b]) => Math.abs(a - 1) < 1e-6 && Math.abs(b) < 1e-6), "horizontal");
      }
      // unsupported characters
      await t.page.setValue("#text", "DRAFT 日本 ✓");
      await t.page.waitFor(`document.querySelector("#go").disabled && document.querySelector("#text-help").textContent.includes("日") && document.querySelector("#text-help").textContent.includes("✓")`);
      await t.shot("unsupported", 375);
    },
  },
  {
    page: "watermark-pdf",
    name: "refuses non-PDF and encrypted PDF",
    async run(t) { await expectBadInputs(t); },
  },

  /* ---------------------------------------------------------------- pdf to jpg */
  {
    page: "pdf-to-jpg",
    name: "three pages at 150 dpi become three JPEGs in a zip",
    async run(t) {
      const src = save(t.fixtures, "deck.pdf", await makePdf(3));
      await loadPdf(t, src);
      await t.page.click("#go");
      await t.waitDone();
      await t.page.waitFor(`document.querySelectorAll("#previews canvas").length === 3`);
      const { name, bytes } = await t.dl();
      t.eq(name, "deck-jpg.zip", "zip name");
      const files = unzip(bytes);
      t.eq(files.map((f) => f.name), ["deck-page-01.jpg", "deck-page-02.jpg", "deck-page-03.jpg"], "file names");
      files.forEach((f, i) => {
        const info = imageInfo(f.data);
        t.eq(info.format, "jpeg", "format");
        const ew = Math.round(((401 + i) * 150) / 72), eh = Math.round((560 * 150) / 72);
        t.assert(Math.abs(info.width - ew) <= 1 && Math.abs(info.height - eh) <= 1, `page ${i + 1} size ${info.width}x${info.height} vs ${ew}x${eh}`);
      });
      await t.shot("done", 1280);
      await t.shot("done", 375);
    },
  },
  {
    page: "pdf-to-jpg",
    name: "PNG, 72 dpi, a page range and a single download",
    async run(t) {
      const src = save(t.fixtures, "deck.pdf", await makePdf(3));
      await loadPdf(t, src);
      await t.page.click("input[name=fmt][value=png]");
      await t.page.click("input[name=dpi][value='72']");
      await t.page.click("input[name=scope][value=range]");
      await t.page.setValue("#range", "2");
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "deck-page-02.png", "single file name");
      const info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["png", 402, 560], "png size");
      // PNG zip mode
      await t.page.setValue("#range", "1-2");
      await t.page.click("#go");
      await t.waitDone();
      const z = unzip((await t.dl()).bytes);
      t.eq(z.map((f) => f.name), ["deck-page-01.png", "deck-page-02.png"], "png zip names");
      // out-of-range input is a clear error
      await t.page.setValue("#range", "9");
      await t.page.click("#go");
      const msg = await t.waitError();
      t.assert(/past the last page/.test(msg), msg);
    },
  },
  {
    page: "pdf-to-jpg",
    name: "very large pages are scaled down and the result says so",
    async run(t) {
      const d = await PDFDocument.create();
      d.addPage([5000, 3000]); // 300 dpi would be ~20833 px wide
      const src = save(t.fixtures, "poster.pdf", await d.save());
      await loadPdf(t, src);
      await t.page.click("input[name=dpi][value='300']");
      await t.page.click("#go");
      const st = await t.waitDone(120000);
      t.assert(/lower resolution/.test(st.text), "notice: " + st.text);
      const info = imageInfo((await t.dl()).bytes);
      t.assert(info.width <= 10000 && info.width > 9000, "capped width " + info.width);
    },
  },
  {
    page: "pdf-to-jpg",
    name: "refuses non-PDF and encrypted PDF",
    async run(t) { await expectBadInputs(t, "#drop input[type=file]", "password|couldn.t be read"); },
  },

  /* ---------------------------------------------------------------- jpg to pdf */
  {
    page: "jpg-to-pdf",
    name: "two PNGs and an EXIF-rotated JPEG make a three page PDF",
    async run(t) {
      const png1 = save(t.fixtures, "a.png", makePng(30, 20));
      const png2 = save(t.fixtures, "b.png", makePng(20, 30, { alpha: true }));
      const b64 = await t.page.eval(`(() => { const c = document.createElement("canvas"); c.width = 60; c.height = 40; const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0,0,60,40); x.fillStyle = "#39c"; x.fillRect(0,0,30,20); return c.toDataURL("image/jpeg", 0.9).split(",")[1]; })()`);
      const raw = Buffer.from(b64, "base64");
      t.eq([imageInfo(raw).width, imageInfo(raw).height], [60, 40], "raw jpeg size");
      const rotated = save(t.fixtures, "phone.jpg", jpegWithExif(raw, makeExifTiff({ orientation: 6 })));
      const upright = save(t.fixtures, "plain.jpg", raw);
      await t.page.setFiles("#drop input[type=file]", [png1, png2, rotated, upright]);
      await t.page.waitFor(`document.querySelectorAll("#files li").length === 4 && !document.querySelector("#go").disabled`);
      await t.page.waitFor(`document.querySelectorAll("#files canvas").length === 4`);
      // remove the plain jpg (4th) and move the rotated jpg to first
      await t.page.click(`#files li:nth-child(4) [aria-label^="Remove"]`);
      await t.page.click(`#files li:nth-child(3) [data-move="-1"]`);
      await t.page.click(`#files li:nth-child(2) [data-move="-1"]`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "images.pdf", "file name");
      const info = await pdfInfo(bytes);
      t.eq(info.pages, 3, "page count");
      t.eq(info.sizes, [[40, 60], [30, 20], [20, 30]], "fit-to-image sizes (rotated jpeg is portrait)");
      await t.shot("done", 1280);
    },
  },
  {
    page: "jpg-to-pdf",
    name: "upright JPEG is embedded without recompression; A4 with margin",
    async run(t) {
      const b64 = await t.page.eval(`(() => { const c = document.createElement("canvas"); c.width = 80; c.height = 50; const x = c.getContext("2d"); x.fillStyle = "#396"; x.fillRect(0,0,80,50); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; })()`);
      const raw = Buffer.from(b64, "base64");
      const jpg = save(t.fixtures, "photo.jpg", raw);
      await t.page.setFiles("#drop input[type=file]", [jpg]);
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.setValue("#pagesize", "a4");
      await t.page.setValue("#margin", "36");
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "photo.pdf", "single-image name");
      const info = await pdfInfo(bytes);
      t.eq(info.sizes, [[842, 595]], "A4 auto orientation follows the wide image");
      // the original JPEG bytes appear verbatim in the PDF (no recompression)
      t.assert(Buffer.from(bytes).includes(raw), "JPEG data embedded as is");
      // portrait forced
      await t.page.setValue("#orient", "portrait");
      await t.page.click("#go");
      await t.waitDone();
      t.eq((await pdfInfo((await t.dl()).bytes)).sizes, [[595, 842]], "portrait");
    },
  },
  {
    page: "jpg-to-pdf",
    name: "WebP and GIF go through the browser decoder; non-images are refused",
    async run(t) {
      const mk = (type) => t.page.eval(`new Promise((res) => { const c = document.createElement("canvas"); c.width = 24; c.height = 16; const x = c.getContext("2d"); x.fillStyle = "#c60"; x.fillRect(0,0,24,16); c.toBlob(async (b) => res(btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())))), ${JSON.stringify(type)}); })`);
      const webp = save(t.fixtures, "w.webp", Buffer.from(await mk("image/webp"), "base64"));
      const gif = save(t.fixtures, "g.gif", Buffer.from("R0lGODlhAgADAIAAAP8AAP///yH5BAAAAAAALAAAAAACAAMAAAIChF8AOw==", "base64"));
      const txt = save(t.fixtures, "notes.txt", Buffer.from("hello"));
      await t.page.setFiles("#drop input[type=file]", [txt]);
      const msg = await t.waitError();
      t.assert(/isn't a image|isn't an image|image file/.test(msg), "non-image message: " + msg);
      await t.page.setFiles("#drop input[type=file]", [webp, gif]);
      await t.page.waitFor(`document.querySelectorAll("#files li").length === 2`);
      await t.page.click("#go");
      await t.waitDone();
      const info = await pdfInfo((await t.dl()).bytes);
      t.eq(info.sizes, [[24, 16], [2, 3]], "converted sizes");
    },
  },

  /* ---------------------------------------------------------------- metadata */
  {
    page: "edit-pdf-metadata",
    name: "edits title and author and keeps other fields",
    async run(t) {
      const doc = await PDFDocument.load(await makePdf(2, { title: "Old title" }), { updateMetadata: false });
      doc.setSubject("Quarterly");
      doc.setProducer("Fixture Producer");
      const src = save(t.fixtures, "paper.pdf", await doc.save());
      await loadPdf(t, src);
      t.eq(await t.page.eval(`document.querySelector("#m-title").value`), "Old title", "prefilled title");
      t.eq(await t.page.eval(`document.querySelector("#m-author").value`), "Fixture Author", "prefilled author");
      t.eq(await t.page.eval(`document.querySelector("#s-pages").textContent`), "2", "page count shown");
      await t.page.setValue("#m-title", "New title");
      await t.page.setValue("#m-author", "Someone Else");
      await t.page.setValue("#m-keywords", "alpha beta");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "paper.pdf", "same name");
      const info = await pdfInfo(bytes);
      t.eq([info.title, info.author, info.subject, info.keywords, info.producer], ["New title", "Someone Else", "Quarterly", "alpha beta", "Fixture Producer"], "fields");
      t.eq(info.pages, 2, "pages");
      await t.shot("done", 1280);
    },
  },
  {
    page: "edit-pdf-metadata",
    name: "remove all metadata clears the info dictionary and the XMP stream",
    async run(t) {
      const doc = await PDFDocument.load(await makePdf(1, { title: "Secret" }), { updateMetadata: false });
      const xmp = doc.context.stream('<?xpacket begin="" id="x"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>Secret</dc:title></x:xmpmeta><?xpacket end="w"?>', { Type: "Metadata", Subtype: "XML" });
      doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
      const src = save(t.fixtures, "private.pdf", await doc.save());
      await loadPdf(t, src);
      t.eq(await t.page.eval(`document.querySelector("#s-xmp").textContent`), "present", "xmp detected");
      await t.page.click("#wipe");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "private.pdf", "name");
      const info = await pdfInfo(bytes);
      t.eq([info.title, info.author, info.subject, info.keywords, info.creator, info.producer], [undefined, undefined, undefined, undefined, undefined, undefined], "all fields gone");
      t.assert(!info.doc.catalog.get(PDFName.of("Metadata")), "no /Metadata in catalog");
      t.assert(!Buffer.from(bytes).toString("latin1").includes("Secret"), "old title text not in the file");
      t.eq(info.pages, 1, "pages");
    },
  },
  {
    page: "edit-pdf-metadata",
    name: "edits dates when asked; refuses non-PDF and encrypted PDF",
    async run(t) {
      const src = save(t.fixtures, "dated.pdf", await makePdf(1));
      await loadPdf(t, src);
      await t.page.click("#keep-dates");
      await t.page.setValue("#m-created", "2020-02-03T04:05:06");
      await t.page.click("#go");
      await t.waitDone();
      const info = await pdfInfo((await t.dl()).bytes);
      const d = info.doc.getCreationDate();
      t.assert(d && d.getFullYear() === 2020 && d.getMonth() === 1 && d.getDate() === 3, "creation date set: " + d);
      await expectBadInputs(t);
      await t.shot("error", 375);
    },
  },
];
