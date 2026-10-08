import { makePng, pngChunks, makeExifTiff, jpegWithExif, jpegSegments, imageInfo, unzip, save } from "../fixtures.mjs";

const DROP = "#drop input[type=file]";

/* A photo-like JPEG made by the browser itself. */
async function browserImage(t, mime, q = 0.95, w = 1200, h = 800) {
  const b64 = await t.page.eval(`(() => {
    const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h};
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, ${w}, ${h});
    g.addColorStop(0, "#d33"); g.addColorStop(0.5, "#3a6"); g.addColorStop(1, "#33d");
    x.fillStyle = g; x.fillRect(0, 0, ${w}, ${h});
    for (let i = 0; i < 400; i++) { x.fillStyle = "hsl(" + (i * 37 % 360) + ",70%,50%)"; x.fillRect((i * 97) % ${w - 50}, (i * 53) % ${h - 50}, 40, 30); }
    return c.toDataURL(${JSON.stringify(mime)}, ${q}).split(",")[1];
  })()`);
  return Buffer.from(b64, "base64");
}

async function ready(t, n = 1) {
  await t.page.waitFor(`document.querySelectorAll("#files > li").length === ${n} && !document.querySelector("#go").disabled`);
}

function sosOffset(buf) {
  let p = 2;
  while (p < buf.length) {
    if (buf[p + 1] === 0xda) return p;
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return -1;
}

/* Wrap a WebP bitstream chunk in VP8X and append an EXIF chunk holding make/GPS, like a camera would. */
function webpWithExif(webp, tiff) {
  const info = imageInfo(webp);
  const body = webp.subarray(12);
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, "latin1"); vp8x.writeUInt32LE(10, 4); vp8x[8] = 0x08;
  vp8x.writeUIntLE(info.width - 1, 12, 3); vp8x.writeUIntLE(info.height - 1, 15, 3);
  const exif = Buffer.alloc(8 + tiff.length + (tiff.length & 1));
  exif.write("EXIF", 0, "latin1"); exif.writeUInt32LE(tiff.length, 4); tiff.copy(exif, 8);
  const inner = Buffer.concat([Buffer.from("WEBP"), vp8x, body, exif]);
  const head = Buffer.alloc(8); head.write("RIFF", 0, "latin1"); head.writeUInt32LE(inner.length, 4);
  return Buffer.concat([head, inner]);
}

export default [
  /* ------------------------------------------------------------------ compress */
  {
    page: "compress-image",
    name: "reduces a 1200x800 PNG to a palette PNG that is smaller",
    async run(t) {
      const src = save(t.fixtures, "big.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.setValue("#colours", "64");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height, info.colorType], ["png", 1200, 800, 3], "indexed png");
      t.assert(bytes.length < makePng(1200, 800).length, `smaller: ${bytes.length}`);
      t.eq(name, "big-compressed.png", "name");
      t.eq(await t.page.eval(`document.querySelectorAll("#compare canvas").length`), 2, "before/after canvases");
      t.assert(/% smaller|Saved/.test(await t.page.eval(`document.querySelector("#result").textContent + document.querySelector("#status").textContent`)), "shows saving");
      await t.shot("done", 1280);
    },
  },
  {
    page: "compress-image",
    name: "compresses a JPEG at quality 50 and keeps an already-optimised file as is",
    async run(t) {
      const jpg = await browserImage(t, "image/jpeg", 0.95);
      const src = save(t.fixtures, "photo.jpg", jpg);
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.setValue("#quality", "50");
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["jpeg", 1200, 800], "still jpeg, same dims");
      t.assert(bytes.length < jpg.length, `smaller ${bytes.length} < ${jpg.length}`);
      // recompressing the already tiny result at high quality must not grow it: original bytes are kept
      const small = save(t.fixtures, "small.jpg", bytes);
      await t.page.click("#clear");
      await t.page.setFiles(DROP, [small]);
      await ready(t);
      await t.page.setValue("#quality", "100");
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#result").textContent.includes("already optimised")`);
      const again = await t.dl();
      t.assert(Buffer.compare(again.bytes, bytes) === 0, "original bytes kept");
    },
  },
  {
    page: "compress-image",
    name: "rejects a non-image, a fake PNG and an oversized image",
    async run(t) {
      const txt = save(t.fixtures, "notes.txt", Buffer.from("hello"));
      await t.page.setFiles(DROP, [txt]);
      t.assert(/isn't a supported image/.test(await t.waitError()), "wrong type message");
      const fake = save(t.fixtures, "fake.png", Buffer.from("this is not a png at all, just text"));
      await t.page.setFiles(DROP, [fake]);
      await t.page.waitFor(`document.querySelector("#status").textContent.includes("doesn't look like")`);
      // real limit check: a PNG header that claims 20000 x 20000 pixels (400 megapixels)
      const real = makePng(8, 8);
      real.writeUInt32BE(20000, 16); real.writeUInt32BE(20000, 20);
      const huge = save(t.fixtures, "huge.png", real);
      await t.page.setFiles(DROP, [huge]);
      await t.page.waitFor(`document.querySelector("#status").textContent.includes("megapixels")`);
      t.eq(await t.page.eval(`document.querySelectorAll("#files > li").length`), 0, "nothing was added");
      await t.shot("error", 375);
    },
  },
  /* ------------------------------------------------------------------ resize */
  {
    page: "resize-image",
    name: "resizes 1200x800 to width 600 with the aspect ratio locked",
    async run(t) {
      const src = save(t.fixtures, "wide.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.setValue("#width", "600");
      t.eq(await t.page.eval(`document.querySelector("#height").value`), "400", "height follows");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["png", 600, 400], "dims");
      t.eq(name, "wide-600x400.png", "name");
      await t.shot("done", 1280);
    },
  },
  {
    page: "resize-image",
    name: "resizes by percentage and refuses to enlarge beyond 4x",
    async run(t) {
      const src = save(t.fixtures, "wide.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.click(`input[name=mode][value=percent]`);
      await t.page.setValue("#percent", "25");
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([info.width, info.height], [300, 200], "25 percent");
      await t.page.setValue("#percent", "400");
      await t.page.click("#go");
      await t.waitDone();
      t.eq(imageInfo((await t.dl()).bytes).width, 4800, "400 percent is allowed");
      await t.page.click(`input[name=mode][value=pixels]`);
      await t.page.setValue("#width", "6000");
      await t.page.click("#go");
      t.assert(/more than 4 times/.test(await t.waitError()), "4x guard");
    },
  },
  /* ------------------------------------------------------------------ convert */
  {
    page: "convert-image",
    name: "converts a PNG with alpha to JPEG and to WebP",
    async run(t) {
      const src = save(t.fixtures, "alpha.png", makePng(600, 400, { alpha: true }));
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.click(`input[name=to][value=jpeg]`);
      await t.page.click("#go");
      await t.waitDone();
      const jpg = await t.dl();
      t.eq([jpg.name, imageInfo(jpg.bytes).format, imageInfo(jpg.bytes).width, imageInfo(jpg.bytes).height], ["alpha.jpg", "jpeg", 600, 400], "jpeg");
      await t.page.click(`input[name=to][value=webp]`);
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#result .result__title")?.textContent.includes("alpha.webp")`);
      const webp = await t.dl();
      t.eq([imageInfo(webp.bytes).format, imageInfo(webp.bytes).width, imageInfo(webp.bytes).height], ["webp", 600, 400], "webp");
      await t.shot("done", 1280);
    },
  },
  /* ------------------------------------------------------------------ crop */
  {
    page: "crop-image",
    name: "crops to 300x200 at (10,20) from the numeric fields",
    async run(t) {
      const src = save(t.fixtures, "scene.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`!document.querySelector("#editor").hidden && document.querySelector("#crop-w").value !== ""`);
      await t.page.setValue("#crop-w", "300");
      await t.page.setValue("#crop-h", "200");
      await t.page.setValue("#crop-x", "10");
      await t.page.setValue("#crop-y", "20");
      t.eq(await t.page.eval(`["#crop-x","#crop-y","#crop-w","#crop-h"].map(s => document.querySelector(s).value)`), ["10", "20", "300", "200"], "fields in sync");
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      const info = imageInfo(bytes);
      t.eq([info.format, info.width, info.height], ["png", 300, 200], "cropped dims");
      await t.shot("done", 1280);
    },
  },
  {
    page: "crop-image",
    name: "crop box moves by keyboard, resizes by shift+arrows, drags by pointer and honours aspect presets",
    async run(t) {
      const src = save(t.fixtures, "scene.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`!document.querySelector("#editor").hidden && document.querySelector("#crop-w").value !== ""`);
      const vals = () => t.page.eval(`["#crop-x","#crop-y","#crop-w","#crop-h"].map(s => +document.querySelector(s).value)`);
      const key = (k, shift) => t.page.eval(`document.querySelector("#box").dispatchEvent(new KeyboardEvent("keydown", {key: ${JSON.stringify(k)}, shiftKey: ${!!shift}, bubbles: true, cancelable: true}))`);
      const [x0, y0, w0, h0] = await vals();
      await key("ArrowRight");
      const [x1, , w1] = await vals();
      t.assert(x1 > x0 && w1 === w0, "arrow moves");
      await key("ArrowRight", true);
      const [, , w2] = await vals();
      t.assert(w2 > w0, "shift+arrow resizes");
      // pointer drag of the box
      const c = await t.page.eval(`(() => { const r = document.querySelector("#box").getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await t.page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", buttons: 1, clickCount: 1 });
      await t.page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x - 30, y: c.y - 20, button: "left", buttons: 1 });
      await t.page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x - 30, y: c.y - 20, button: "left", buttons: 0, clickCount: 1 });
      const [x3, y3] = await vals();
      t.assert(x3 < x1 && y3 < y0, `drag moved the box: ${x3},${y3}`);
      // aspect preset
      await t.page.click(`input[name=ratio][value="1:1"]`);
      const [, , w4, h4] = await vals();
      t.assert(Math.abs(w4 - h4) <= 1, `square: ${w4}x${h4}`);
      // drag the se corner
      const h = await t.page.eval(`(() => { document.querySelector('[data-h="se"]').scrollIntoView({block: "center"}); const r = document.querySelector('[data-h="se"]').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await t.page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: h.x, y: h.y, button: "left", buttons: 1, clickCount: 1 });
      await t.page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: h.x - 40, y: h.y - 40, button: "left", buttons: 1 });
      await t.page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: h.x - 40, y: h.y - 40, button: "left", buttons: 0, clickCount: 1 });
      const [, , w5, h5] = await vals();
      t.assert(w5 < w4 && Math.abs(w5 - h5) <= 1, `corner resize keeps 1:1: ${w5}x${h5}`);
    },
  },
  /* ------------------------------------------------------------------ rotate */
  {
    page: "rotate-image",
    name: "rotate right swaps the dimensions, flip keeps them",
    async run(t) {
      const src = save(t.fixtures, "land.png", makePng(1200, 800));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1`);
      t.assert(await t.page.eval(`document.querySelector("#go").disabled`), "disabled until a transform is chosen");
      await t.page.click(`[data-op=right]`);
      await t.page.waitFor(`document.querySelector("#preview").width === 480 || document.querySelector("#preview").height > document.querySelector("#preview").width`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const r = await t.dl();
      t.eq([imageInfo(r.bytes).width, imageInfo(r.bytes).height], [800, 1200], "rotated");
      await t.page.click("#reset");
      await t.page.click(`[data-op=flipH]`);
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#result .result__title")?.textContent.includes("flipped")`);
      const f = await t.dl();
      t.eq([imageInfo(f.bytes).width, imageInfo(f.bytes).height], [1200, 800], "flipped keeps dims");
      await t.shot("done", 1280);
    },
  },
  /* ------------------------------------------------------------------ remove exif */
  {
    page: "remove-exif",
    name: "lists GPS and camera, then strips a JPEG losslessly and keeps only orientation",
    async run(t) {
      const base = await browserImage(t, "image/jpeg", 0.9, 640, 480);
      const input = jpegWithExif(base, makeExifTiff({ orientation: 6 }));
      t.assert(input.includes("FixtureCam"), "fixture has camera string");
      const src = save(t.fixtures, "trip.jpg", input);
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      const text = await t.page.eval(`document.querySelector("#files").textContent`);
      t.assert(text.includes("14.583333") && text.includes("120.983333"), "GPS decimal listed: " + text.slice(0, 300));
      t.assert(/Location/.test(text) && text.includes("FixtureCam") && text.includes("Model X100"), "camera and location rows");
      t.assert(text.includes("2026-01-02"), "date taken");
      t.assert(/Rotated 90° clockwise/.test(text), "orientation shown");
      await t.shot("ready", 375);
      await t.shot("ready", 1280);
      await t.page.click("#go");
      await t.waitDone();
      const out = await t.dl();
      t.eq(out.name, "trip-clean.jpg", "name");
      const segs = jpegSegments(out.bytes);
      t.eq(segs.filter((s) => s.startsWith("APP1")), ["APP1:Exif"], "one minimal APP1");
      t.assert(!out.bytes.includes("FixtureCam") && !out.bytes.includes("Model X100"), "camera strings gone");
      const a1 = out.bytes.indexOf(Buffer.from([0xff, 0xe1]));
      t.assert(out.bytes.readUInt16BE(a1 + 2) <= 40, "APP1 is tiny");
      t.assert(out.bytes.includes(Buffer.from([0x01, 0x12, 0x00, 0x03])), "orientation tag present");
      t.eq(out.bytes.subarray(sosOffset(out.bytes)).equals(input.subarray(sosOffset(input))), true, "image data after SOS identical");
      t.eq(imageInfo(out.bytes).width, 640, "still decodes");
      // now without keeping orientation
      await t.page.click("#clear");
      await t.page.setFiles(DROP, [src]);
      await ready(t);
      await t.page.click("#keep-orient");
      await t.page.click("#go");
      await t.page.waitFor(`document.querySelector("#result .result__note, #result .result__size")?.textContent.length > 0`);
      const out2 = await t.dl();
      t.eq(jpegSegments(out2.bytes).filter((s) => s.startsWith("APP1")), [], "no APP1 at all");
      t.eq(out2.bytes.subarray(sosOffset(out2.bytes)).equals(input.subarray(sosOffset(input))), true, "image data identical again");
      await t.shot("done", 1280);
    },
  },
  {
    page: "remove-exif",
    name: "drops PNG text and eXIf chunks and EXIF/XMP from WebP",
    async run(t) {
      const png = makePng(64, 64, { extraChunks: [["tEXt", "Comment\0made at home"], ["eXIf", makeExifTiff({ orientation: 1 })], ["tIME", Buffer.alloc(7)]] });
      t.assert(pngChunks(png).includes("tEXt"), "fixture has tEXt");
      const p = save(t.fixtures, "shot.png", png);
      const webpBase = await browserImage(t, "image/webp", 0.8, 96, 64);
      const webp = webpWithExif(webpBase, makeExifTiff({ orientation: 1 }));
      const w = save(t.fixtures, "pic.webp", webp);
      await t.page.setFiles(DROP, [p, w]);
      await ready(t, 2);
      const text = await t.page.eval(`document.querySelector("#files").textContent`);
      t.assert(text.includes("Comment") && text.includes("FixtureCam"), "lists PNG text keyword and webp camera");
      await t.page.click("#go");
      await t.waitDone();
      const zip = await t.dl();
      const files = unzip(zip.bytes);
      t.eq(files.map((f) => f.name).sort(), ["pic-clean.webp", "shot-clean.png"], "zip names");
      const cp = files.find((f) => f.name.endsWith(".png")).data;
      const chunks = pngChunks(cp);
      t.assert(!chunks.includes("tEXt") && !chunks.includes("eXIf") && !chunks.includes("tIME"), "png chunks gone: " + chunks);
      t.assert(chunks.includes("IDAT") && chunks.includes("IEND"), "png still complete");
      t.eq(imageInfo(cp).width, 64, "png dims");
      const cw = files.find((f) => f.name.endsWith(".webp")).data;
      t.assert(!cw.includes("EXIF") && !cw.includes("FixtureCam"), "webp exif gone");
      t.eq(cw.readUInt32LE(4), cw.length - 8, "riff size fixed");
      t.eq(cw[20] & 0x0c, 0, "vp8x flags cleared");
      t.eq([imageInfo(cw).width, imageInfo(cw).height], [96, 64], "webp dims");
    },
  },
  /* ------------------------------------------------------------------ favicon */
  {
    page: "favicon-generator",
    name: "builds the favicon zip from an image",
    async run(t) {
      const src = save(t.fixtures, "logo.png", makePng(600, 400));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`document.querySelectorAll("#fav-previews canvas").length === 4 && !document.querySelector("#go").disabled`);
      await t.shot("ready", 375);
      await t.page.click("#go");
      await t.waitDone();
      const zip = await t.dl();
      const files = unzip(zip.bytes);
      const names = files.map((f) => f.name).sort();
      t.eq(names, ["android-chrome-192x192.png", "android-chrome-512x512.png", "apple-touch-icon.png", "favicon-16x16.png", "favicon-32x32.png", "favicon.ico", "site.webmanifest"], "zip files");
      const get = (n) => files.find((f) => f.name === n).data;
      const ico = imageInfo(get("favicon.ico"));
      t.eq([ico.format, ico.count], ["ico", 3], "ico entries");
      t.eq(ico.entries.map((e) => [e.width, e.height, e.inner.format, e.inner.width]), [[16, 16, "png", 16], [32, 32, "png", 32], [48, 48, "png", 48]], "ico contents");
      t.eq([imageInfo(get("apple-touch-icon.png")).width, imageInfo(get("apple-touch-icon.png")).height], [180, 180], "apple touch");
      t.eq(imageInfo(get("android-chrome-512x512.png")).width, 512, "512");
      t.eq(imageInfo(get("favicon-16x16.png")).width, 16, "16");
      const m = JSON.parse(get("site.webmanifest").toString());
      t.eq(m.icons.map((i) => i.sizes), ["192x192", "512x512"], "manifest icons");
      t.assert((await t.page.eval(`document.querySelector("#snippet").textContent`)).includes('rel="apple-touch-icon"'), "snippet shown");
      await t.page.click("#copy");
      await t.shot("done", 1280);
    },
  },
  {
    page: "favicon-generator",
    name: "builds a letter favicon",
    async run(t) {
      await t.page.click(`input[name=source][value=text]`);
      await t.page.setValue("#t-text", "TK");
      await t.page.waitFor(`document.querySelectorAll("#fav-previews canvas").length === 4 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      const files = unzip((await t.dl()).bytes);
      t.eq(files.length, 7, "7 files");
      t.eq(imageInfo(files.find((f) => f.name === "favicon-32x32.png").data).width, 32, "32");
      await t.shot("done", 375);
    },
  },
];
