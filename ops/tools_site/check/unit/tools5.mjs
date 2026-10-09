// Unit tests for the logic behind five tools, run with plain node:
//   node ops/tools_site/check/unit/tools5.mjs
// pdf-to-text (pdftextcore), sign-pdf (signcore), image-to-webp (webpcore), gif-maker (gifcore + the vendored gifenc encoder),
// heic-to-jpg (heiccore + the vendored ts-heic decoder, run on the small HEIC files in check/heic-fixtures/).
// Reference values are literals (worked by hand or from the file format specifications), not the code's own output.
import * as pt from "../../../../site/tools/js/pdftextcore.js";
import * as sg from "../../../../site/tools/js/signcore.js";
import * as wp from "../../../../site/tools/js/webpcore.js";
import * as gc from "../../../../site/tools/js/gifcore.js";
import * as gifenc from "../../../../site/tools/vendor/gifenc/gifenc.esm.js";
import * as hc from "../../../../site/tools/js/heiccore.js";
import * as tsheic from "../../../../site/tools/vendor/ts-heic/ts-heic.esm.js";
import { readFileSync } from "node:fs";

let n = 0, bad = 0;
const eq = (a, b, msg) => {
  n++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
};
const near = (a, b, tol, msg) => {
  n++;
  if (!(Math.abs(a - b) <= tol)) { bad++; console.log(`FAIL ${msg}: got ${a}, expected ${b} +/- ${tol}`); }
};
const ok = (cond, msg) => {
  n++;
  if (!cond) { bad++; console.log(`FAIL ${msg}`); }
};
const throws = async (fn, msg) => {
  n++;
  try { await fn(); bad++; console.log(`FAIL ${msg}: did not throw`); } catch (_) { /* expected */ }
};

/* ------------------------------------------------------------------ pdf-to-text */
{
  // a text item as pdf.js reports it: font height `size`, lower-left of the run at (x, y)
  const it = (str, x, y, size = 12, eol = false) => ({ str, transform: [size, 0, 0, size, x, y], width: 0, height: size, hasEOL: eol });
  const text = (items) => pt.pageText(items).text;

  eq(text([it("Hello", 72, 700), it(" ", 110, 700), it("world", 115, 700, 12, true), it("Second line", 72, 686, 12, true)]), "Hello world\nSecond line", "runs on one baseline join, an end of line breaks");
  eq(text([it("A", 72, 700), it("B", 72, 686)]), "A\nB", "a baseline that moves by more than half a font height starts a new line even with no end-of-line flag");
  eq(text([it("E=mc", 72, 700), it("2", 100, 704, 8), it(" is famous", 106, 700, 12, true)]), "E=mc2 is famous", "a superscript stays on its line");
  eq(text([it("Title", 72, 500, 24), { str: "", transform: [12, 0, 0, 12, 72, 460], height: 0, hasEOL: true }, it("Body text", 72, 460, 12, true)]), "Title\n\nBody text", "an empty end-of-line marker ends the line and does not add an empty one; the gap makes a paragraph break");
  eq(pt.pageText([it("Title", 72, 500, 24), { str: "", transform: [12, 0, 0, 12, 72, 460], height: 0, hasEOL: true }, it("Body text", 72, 460, 12, true)]).lines, 2, "the marker adds no line");

  const single = [700, 686, 672, 658].map((y, i) => it("L" + (i + 1), 72, y, 12, true));
  eq(text(single), "L1\nL2\nL3\nL4", "evenly spaced lines make one block");
  // text turned a quarter turn (a page stored sideways): the lines run up the page and each next line lies to the right
  const turned = (str, x, y, eol = true) => ({ str, transform: [0, 12, -12, 0, x, y], width: 0, height: 12, hasEOL: eol });
  eq(text([turned("Rot1", 100, 50), turned("Rot2", 114, 50), turned("Rot3", 128, 50), turned("Rot4", 142, 50)]), "Rot1\nRot2\nRot3\nRot4", "sideways text keeps its line order");
  eq(text([turned("Rot1", 100, 50, false), turned(" and more", 100, 80), turned("next", 114, 50), turned("far", 190, 50)]), "Rot1 and more\nnext\n\nfar", "sideways: runs of one line join, a wide gap is a paragraph");
  const short = [[500, 24], [450, 12], [436, 12], [422, 12], [380, 12]].map(([y, size], i) => it("S" + (i + 1), 40, y, size, true));
  eq(text(short), "S1\n\nS2\nS3\nS4\n\nS5", "a short page with a heading and two paragraphs keeps its breaks (the big gaps do not set the line spacing)");
  const noisy = [700, 690, 676, 662, 648].map((y, i) => it("N" + (i + 1), 72, y, 12, true));
  eq(text(noisy), "N1\nN2\nN3\nN4\nN5", "one slightly tighter gap does not turn the other lines into paragraphs");
  const paras = [700, 686, 672, 658, 620, 606].map((y, i) => it("L" + (i + 1), 72, y, 12, true));
  eq(text(paras), "L1\nL2\nL3\nL4\n\nL5\nL6", "a gap much bigger than the usual line spacing is a paragraph break");
  const dbl = [700, 676, 652, 628].map((y, i) => it("D" + (i + 1), 72, y, 12, true));
  eq(text(dbl), "D1\nD2\nD3\nD4", "double-spaced text gets no blank lines");
  const cols = [it("a1", 72, 700, 12, true), it("a2", 72, 686, 12, true), it("a3", 72, 672, 12, true), it("b1", 320, 700, 12, true), it("b2", 320, 686, 12, true)];
  eq(text(cols), "a1\na2\na3\n\nb1\nb2", "jumping back up the page (next column) is a break");
  eq(text([it("tight", 72, 700, 12, true), it("lines", 72, 689, 12, true)]), "tight\nlines", "lines closer than a font height still break, with no blank line");
  eq(text([it("x", 1, 1), it("   ", 2, 1, 12, true), it("y", 1, -20, 12, true)]).split("\n"), ["x", "", "y"], "a whitespace-only tail is trimmed and the gap is kept");
  eq(text([{ type: "beginMarkedContent", id: "x" }, it("x", 1, 1, 12, true), { type: "endMarkedContent" }]), "x", "items with no str are ignored");
  eq(text([it("abc   ", 1, 100, 12, true)]), "abc", "trailing spaces are trimmed");
  eq(text([it("   ", 1, 100, 12, true), it("real", 1, 80, 12, true)]), "real", "a line of only spaces is dropped");
  eq(pt.pageText([]), { text: "", lines: 0 }, "no items");
  eq(pt.pageText(null), { text: "", lines: 0 }, "no item list");
  eq(pt.pageText([it("one", 1, 1, 12, true)]), { text: "one", lines: 1 }, "single line");
  eq(text([it("a", 1, 100), it("b", 1, 100), it("c", 1, 100, 12, true)]), "abc", "runs with no space item between them are joined as they are");

  eq(pt.cleanText("ﬁnd the ﬂow, oﬀ ﬃ ﬄ ﬅﬆ"), "find the flow, off ffi ffl stst", "ligature glyphs become letters");
  eq(pt.cleanText("a b­c"), "a bc", "no-break space to space, soft hyphen removed");
  eq(pt.cleanText("x\u0000y\u0007z\u007f"), "xyz", "control characters removed");
  eq(pt.cleanText("a\tb\nc"), "a\tb\nc", "tab and line break kept");
  eq(pt.cleanText("a b c"), "a\nb\nc", "Unicode separators become line breaks");
  eq(pt.cleanText("नमस्ते 你好 مرحبا"), "नमस्ते 你好 مرحبا", "other scripts are left alone");

  const pages = [{ n: 1, text: "first" }, { n: 2, text: "" }, { n: 3, text: "third\nline" }];
  eq(pt.joinPages(pages), "first\n\nthird\nline", "pages without text are left out");
  eq(pt.joinPages(pages, { marks: true }), "--- Page 1 ---\n\nfirst\n\n--- Page 2 ---\n\n--- Page 3 ---\n\nthird\nline", "page marks, including the empty page");
  eq(pt.joinPages(pages, { marks: true, label: (p) => `[${p}]` }), "[1]\n\nfirst\n\n[2]\n\n[3]\n\nthird\nline", "custom page label");
  eq(pt.joinPages([]), "", "no pages");

  eq(pt.countWords("Hello, world! It's 3 o'clock."), 5, "five words (Segmenter)");
  eq(pt.countWords("Hello, world! It's 3 o'clock.", null), 5, "five words (fallback)");
  eq(pt.countWords(""), 0, "no words");
  eq(pt.countWords("... --- !!!"), 0, "punctuation is not a word");
  eq(pt.countWords("state-of-the-art idea", null), 2, "hyphenated word is one word in the fallback");
  ok(pt.countWords("你好世界") >= 2, "Chinese is split into words by the Segmenter");
  eq(pt.countWords("你好世界", null), 1, "the fallback counts a run of Chinese as one word");
  eq(pt.countChars("ab\ncd"), 4, "line breaks are not counted");
  eq(pt.countChars("\u{1F600}a\r\n"), 2, "code points, not UTF-16 units");
  eq(pt.countChars(""), 0, "no characters");

  eq(pt.txtName("Report.PDF"), "Report.txt", "extension replaced, any case");
  eq(pt.txtName("a/b\\c.pdf"), "a_b_c.txt", "path separators removed");
  eq(pt.txtName(""), "document.txt", "empty name");
  eq(pt.txtName("x.y.pdf"), "x.y.txt", "inner dots kept");
  eq(pt.txtName("noext"), "noext.txt", "no extension");
  eq(pt.txtName(".pdf"), "document.txt", "only an extension");
}

/* ------------------------------------------------------------------ sign-pdf */
{
  eq([0, 90, 180, 270, 360, -90, 450, 89, "90", null].map(sg.rotationOf), [0, 90, 180, 270, 0, 270, 90, 90, 90, 0], "page rotation normalised");
  eq([sg.clamp(5, 0, 3), sg.clamp(-1, 0, 3), sg.clamp(2, 0, 3)], [3, 0, 2], "clamp");

  // The page as displayed is the page turned clockwise by its /Rotate; display coordinates run from the lower-left corner, y up.
  // Written here from that definition (a rotation about the page centre), not from placeStamp's own cases.
  const toDisplay = (page, ux, uy) => {
    const rot = page.rotation % 360, th = (rot * Math.PI) / 180;
    const px = ux - page.x - page.width / 2, py = uy - page.y - page.height / 2;
    const rx = px * Math.cos(th) + py * Math.sin(th), ry = -px * Math.sin(th) + py * Math.cos(th);
    const dw = rot % 180 ? page.height : page.width, dh = rot % 180 ? page.width : page.height;
    return [rx + dw / 2, ry + dh / 2];
  };
  // The stamp's four corners in the page's own coordinates, from what drawImage will be told.
  const corners = (r) => {
    const a = (r.angle * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
    return { ll: [r.x, r.y], lr: [r.x + r.width * u[0], r.y + r.width * u[1]], ul: [r.x + r.height * v[0], r.y + r.height * v[1]] };
  };
  const checkPlacement = (page, aspect, place, label) => {
    const r = sg.placeStamp(page, aspect, place);
    const swap = page.rotation % 180 !== 0;
    const dw = swap ? page.height : page.width, dh = swap ? page.width : page.height;
    const c = corners(r);
    const ll = toDisplay(page, ...c.ll), lr = toDisplay(page, ...c.lr), ul = toDisplay(page, ...c.ul);
    const d = r.display;
    near(ll[0], d.left * dw, 1e-6, label + ": lower-left x");
    near(ll[1], dh - (d.top + d.height) * dh, 1e-6, label + ": lower-left y");
    near(lr[0] - ll[0], d.width * dw, 1e-6, label + ": width runs rightwards");
    near(lr[1], ll[1], 1e-6, label + ": bottom edge is level");
    near(ul[1] - ll[1], d.height * dh, 1e-6, label + ": height runs upwards");
    near(ul[0], ll[0], 1e-6, label + ": left edge is upright");
    near(r.width / r.height, 1 / aspect, 1e-9, label + ": proportions kept");
    ok(d.left >= -1e-9 && d.top >= -1e-9 && d.left + d.width <= 1 + 1e-9 && d.top + d.height <= 1 + 1e-9, label + ": inside the page");
    return r;
  };

  const base = { x: 0, y: 0, width: 400, height: 600, rotation: 0 };
  const p0 = checkPlacement(base, 0.4, { fx: 0.5, fy: 0.25, wFrac: 0.25 }, "0 degrees");
  eq([p0.x, p0.y, p0.width, p0.height, p0.angle], [150, 420, 100, 40, 0], "0 degrees: position, size and angle");
  near(p0.display.left, 0.375, 1e-9, "0 degrees: display left");
  near(p0.display.top, 140 / 600, 1e-9, "0 degrees: display top");
  const p90 = checkPlacement({ ...base, rotation: 90 }, 0.4, { fx: 0.5, fy: 0.25, wFrac: 0.25 }, "90 degrees");
  eq([p90.x, p90.y, p90.width, p90.height, p90.angle], [145, 225, 150, 60, 90], "90 degrees: lower-left corner, size and angle");
  const p180 = checkPlacement({ ...base, rotation: 180 }, 0.4, { fx: 0.5, fy: 0.25, wFrac: 0.25 }, "180 degrees");
  eq([p180.x, p180.y, p180.width, p180.height, p180.angle], [250, 180, 100, 40, 180], "180 degrees: lower-left corner, size and angle");
  const p270 = checkPlacement({ ...base, rotation: 270 }, 0.4, { fx: 0.5, fy: 0.25, wFrac: 0.25 }, "270 degrees");
  eq([p270.x, p270.y, p270.width, p270.height, p270.angle], [255, 375, 150, 60, 270], "270 degrees: lower-left corner, size and angle");
  for (const rot of [0, 90, 180, 270]) {
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.8]]) {
      checkPlacement({ x: 50, y: 30, width: 300, height: 500, rotation: rot }, 0.25, { fx, fy, wFrac: 0.4 }, `crop box, ${rot} degrees, ${fx}/${fy}`);
    }
  }
  const corner = sg.placeStamp(base, 0.5, { fx: 1, fy: 1, wFrac: 0.5 });
  near(corner.display.left + corner.display.width, 1, 1e-12, "bottom-right: against the right edge");
  near(corner.display.top + corner.display.height, 1, 1e-12, "bottom-right: against the bottom edge");
  eq([corner.x, corner.y], [200, 0], "bottom-right in user space");
  const topLeft = sg.placeStamp(base, 0.5, { fx: 0, fy: 0, wFrac: 0.5 });
  eq([topLeft.x, topLeft.y, topLeft.display.left, topLeft.display.top], [0, 500, 0, 0], "top-left in user space");
  const tall = checkPlacement({ x: 0, y: 0, width: 400, height: 300, rotation: 0 }, 3, { fx: 0.5, fy: 0.5, wFrac: 0.8 }, "tall stamp");
  eq([tall.width, tall.height], [100, 300], "a stamp too tall for the page is shrunk to fit");
  const huge = sg.placeStamp(base, 0.1, { fx: 0, fy: 0, wFrac: 5 });
  eq(huge.width, 400, "width fraction is limited to the page width");
  const tiny = sg.placeStamp(base, 0.1, { fx: 0, fy: 0, wFrac: 0 });
  near(tiny.width, 8, 1e-9, "width fraction has a floor of 2%");
  const wild = sg.placeStamp(base, 0.5, { fx: -3, fy: 9, wFrac: 0.5 });
  eq([wild.display.left, wild.display.top + wild.display.height], [0, 1], "out-of-range position is clamped");
  const sqr = checkPlacement({ x: 0, y: 0, width: 500, height: 500, rotation: 90 }, 1, { fx: 0.5, fy: 0.5, wFrac: 0.2 }, "square page");
  eq([sqr.x, sqr.y, sqr.width, sqr.height], [300, 200, 100, 100], "square page, 90 degrees, centred");

  eq(sg.targetPages("this", 2, 5), [2], "this page");
  eq(sg.targetPages("all", 2, 3), [0, 1, 2], "every page");
  eq(sg.targetPages("this", 7, 5), [], "page out of range");
  eq(sg.targetPages("this", -1, 5), [], "negative page");

  const px = (w, h, dots) => { const d = new Uint8ClampedArray(w * h * 4); for (const [x, y, a] of dots) d[(y * w + x) * 4 + 3] = a; return d; };
  eq(sg.alphaBounds(px(5, 4, [[1, 1, 255], [3, 2, 200]]), 5, 4), { x: 1, y: 1, w: 3, h: 2 }, "box around the drawn pixels");
  eq(sg.alphaBounds(px(5, 4, []), 5, 4), null, "empty drawing");
  eq(sg.alphaBounds(px(5, 4, [[0, 0, 5], [4, 3, 12]]), 5, 4), null, "faint pixels at or below the threshold are ignored");
  eq(sg.alphaBounds(px(5, 4, [[0, 0, 13]]), 5, 4), { x: 0, y: 0, w: 1, h: 1 }, "just above the threshold counts");
  eq(sg.alphaBounds(px(5, 4, [[4, 3, 255]]), 5, 4), { x: 4, y: 3, w: 1, h: 1 }, "last pixel");
  eq(sg.growBounds({ x: 1, y: 1, w: 3, h: 2 }, 2, 10, 8), { x: 0, y: 0, w: 6, h: 5 }, "grown box stays inside the canvas (top-left)");
  eq(sg.growBounds({ x: 6, y: 5, w: 3, h: 2 }, 4, 10, 8), { x: 2, y: 1, w: 8, h: 7 }, "grown box stays inside the canvas (bottom-right)");

  eq(sg.stampLayout({ w: 100, h: 40 }, { w: 60, h: 16 }), { w: 112, h: 74, sig: { x: 6, y: 6 }, date: { x: 26, y: 52 } }, "signature with a date line");
  eq(sg.stampLayout({ w: 100, h: 40 }, null), { w: 112, h: 52, sig: { x: 6, y: 6 }, date: null }, "signature alone");
  eq(sg.stampLayout({ w: 50, h: 30 }, { w: 90, h: 14 }, { pad: 4, gap: 2 }), { w: 98, h: 54, sig: { x: 24, y: 4 }, date: { x: 4, y: 36 } }, "a wider date line centres the signature");
  eq(sg.fitFontSize(10, 600, 200), 60, "font size limited by the width");
  near(sg.fitFontSize(1, 600, 120), 120 / 1.35, 1e-9, "font size limited by the height");
  eq(sg.fitFontSize(0.1, 600, 400, { max: 100 }), 100, "font size limited by the maximum");
  near(sg.fitFontSize(0, 600, 135), 100, 1e-9, "no text width: use the height");
}

/* ------------------------------------------------------------------ image-to-webp */
{
  const b64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
  // 8 x 8 pictures saved by a browser's own WebP encoder (an ICC profile makes them the extended VP8X form)
  const LOSSY = "UklGRjYCAABXRUJQVlA4WAoAAAAgAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggSAAAAFACAJ0BKggACAABQCYlsAJ0ugH4AIkA/UAHIAD+71Enff5d5dT/6q58sfxPKZ8R3/sOv+o/tn2VT/6KfdGkh/jKnxlT/i5gAA==";
  const LOSSLESS = "UklGRgYCAABXRUJQVlA4WAoAAAAgAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDhMGAAAAC8HwAEAD3Az3oswn8Z9/oMHh/+P6H/AAw==";
  const LOSSY_ALPHA = "UklGRlYCAABXRUJQVlA4WAoAAAAwAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBIDQAAAAEPMP8REeIP/xH9jwcAVlA4IFIAAACQAgCdASoIAAgAAUAmJbACdLoAyv/cQN4g/twOQAD+706/8s4LgO09mrfKn2VvY5Lp9Havf/y4+o5/OUnn/8IlNL/4LD/8D3Ov/4PP/AiayAAA";
  const LOSSLESS_ALPHA = "UklGRhwCAABXRUJQVlA4WAoAAAAwAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDhMLQAAAC8HwAEQFyAQSKKdclCBQBLL/ihDCQSSoPZHmmH+A+ofCAQIkyZ1iojof9hjAAA=";
  eq(wp.webpInfo(b64(LOSSY)), { kind: "lossy", alpha: false, animated: false }, "browser-made lossy WebP");
  eq(wp.webpInfo(b64(LOSSLESS)), { kind: "lossless", alpha: false, animated: false }, "browser-made lossless WebP");
  eq(wp.webpInfo(b64(LOSSY_ALPHA)), { kind: "lossy", alpha: true, animated: false }, "browser-made lossy WebP with transparency");
  eq(wp.webpInfo(b64(LOSSLESS_ALPHA)), { kind: "lossless", alpha: true, animated: false }, "browser-made lossless WebP with transparency");

  const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const chunk = (id, body) => [...Buffer.from(id, "latin1"), ...le32(body.length), ...body, ...(body.length % 2 ? [0] : [])];
  const riff = (...chunks) => { const body = [...Buffer.from("WEBP", "latin1"), ...chunks.flat()]; return Uint8Array.from([...Buffer.from("RIFF", "latin1"), ...le32(body.length), ...body]); };
  eq(wp.webpInfo(riff(chunk("VP8 ", new Array(10).fill(0)))), { kind: "lossy", alpha: false, animated: false }, "simple lossy file");
  eq(wp.webpInfo(riff(chunk("VP8L", [0x2f, 0, 0, 0, 0x10]))), { kind: "lossless", alpha: true, animated: false }, "simple lossless file with the alpha bit set");
  eq(wp.webpInfo(riff(chunk("VP8L", [0x2f, 0, 0, 0, 0x00]))), { kind: "lossless", alpha: false, animated: false }, "simple lossless file without alpha");
  eq(wp.webpInfo(riff(chunk("VP8X", [0x12, 0, 0, 0, 1, 0, 0, 1, 0, 0]), chunk("ANIM", [0, 0, 0, 0, 0, 0]), chunk("ANMF", new Array(16).fill(0)))), { kind: "unknown", alpha: true, animated: true }, "animated file");
  eq(wp.webpInfo(riff(chunk("EXIF", [1, 2, 3]), chunk("VP8 ", new Array(10).fill(0)))).kind, "lossy", "unknown chunks are skipped (odd sizes are padded)");
  eq(wp.webpInfo(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1])), null, "a PNG is not a WebP");
  eq(wp.webpInfo(new Uint8Array(5)), null, "too short");
  eq(wp.webpInfo(null), null, "nothing");
  eq(wp.webpInfo(riff()), null, "a header with no chunks is not usable");
  eq(wp.webpInfo(riff(chunk("EXIF", [1, 2]))).kind, "unknown", "no image chunk");

  eq(wp.sizeChange(1000, 400), { pct: 60, dir: "smaller" }, "60% smaller");
  eq(wp.sizeChange(1000, 1500), { pct: 50, dir: "larger" }, "50% larger");
  eq(wp.sizeChange(1000, 1000), { pct: 0, dir: "same" }, "same size");
  eq(wp.sizeChange(1000, 1002), { pct: 0, dir: "same" }, "a change below half a percent counts as the same");
  eq(wp.sizeChange(1000, 994), { pct: 1, dir: "smaller" }, "0.6% rounds to 1%");
  eq(wp.sizeChange(0, 5), { pct: 0, dir: "same" }, "no original size");
  eq(wp.sizeChange(2000, 0), { pct: 100, dir: "smaller" }, "everything saved");
  eq([80, 0, 150, "abc", 79.6, 1, 100, "55"].map(wp.qualityValue), [0.8, 0.01, 1, 0.8, 0.8, 0.01, 1, 0.55], "quality from the slider");
  eq(wp.totalSizes([{ before: 100, after: 40 }, { before: 50, after: 10 }]), { before: 150, after: 50 }, "totals");
  eq(wp.totalSizes([]), { before: 0, after: 0 }, "no totals");
}

/* ------------------------------------------------------------------ gif-maker */
{
  eq([500, 5, 1234, 123456, "abc", 25, 20, 19, 60000, "700"].map((v) => gc.delayMs(v)), [500, 20, 1230, 60000, 500, 30, 20, 20, 60000, 700], "delays: whole hundredths of a second, 20 ms to 60 s");
  eq(gc.delayMs(undefined, 100), 100, "fallback delay");
  eq(gc.frameSequence(4), [0, 1, 2, 3], "frame order");
  eq(gc.frameSequence(4, true), [0, 1, 2, 3, 2, 1], "ping-pong does not repeat the end frames");
  eq(gc.frameSequence(2, true), [0, 1], "two frames: ping-pong is the same loop");
  eq(gc.frameSequence(1, true), [0], "one frame");
  eq(gc.frameSequence(0), [], "no frames");
  eq(gc.outputSize(800, 600, 400), { w: 400, h: 300 }, "height follows the first picture");
  eq(gc.outputSize(800, 600, 5000), { w: 1200, h: 900 }, "width limited to 1200");
  eq(gc.outputSize(800, 600, 2), { w: 16, h: 12 }, "width has a floor of 16");
  eq(gc.outputSize(100, 1000, 800), { w: 160, h: 1600 }, "a very tall picture is limited to 1600 high");
  eq(gc.outputSize(1000, 1, 400), { w: 400, h: 1 }, "never less than 1 pixel high");
  eq(gc.outputSize(800, 600, "abc"), { w: 16, h: 12 }, "not a number gives the minimum width");
  eq(gc.fitRect(200, 100, 100, 100, "contain"), { sx: 0, sy: 0, sWidth: 200, sHeight: 100, dx: 0, dy: 25, dWidth: 100, dHeight: 50 }, "contain, wide picture");
  eq(gc.fitRect(100, 200, 100, 100, "contain"), { sx: 0, sy: 0, sWidth: 100, sHeight: 200, dx: 25, dy: 0, dWidth: 50, dHeight: 100 }, "contain, tall picture");
  eq(gc.fitRect(200, 100, 100, 100, "cover"), { sx: 50, sy: 0, sWidth: 100, sHeight: 100, dx: 0, dy: 0, dWidth: 100, dHeight: 100 }, "cover crops the sides from the centre");
  eq(gc.fitRect(100, 200, 100, 100, "cover"), { sx: 0, sy: 50, sWidth: 100, sHeight: 100, dx: 0, dy: 0, dWidth: 100, dHeight: 100 }, "cover crops top and bottom");
  eq(gc.fitRect(40, 30, 100, 100, "cover"), { sx: 5, sy: 0, sWidth: 30, sHeight: 30, dx: 0, dy: 0, dWidth: 100, dHeight: 100 }, "cover enlarges a small picture");
  eq(gc.fitRect(200, 100, 100, 60, "stretch"), { sx: 0, sy: 0, sWidth: 200, sHeight: 100, dx: 0, dy: 0, dWidth: 100, dHeight: 60 }, "stretch");
  eq(gc.fitRect(200, 100, 200, 100), { sx: 0, sy: 0, sWidth: 200, sHeight: 100, dx: 0, dy: 0, dWidth: 200, dHeight: 100 }, "same size, contain is the default");
  eq([gc.overBudget(1200, 900, 60), gc.overBudget(1200, 1000, 150), gc.overBudget(100, 100, 60)], [false, true, false], "pixel budget");
  eq(gc.totalDuration([100, 200, 300]), 600, "play time");

  // A small GIF reader written from the GIF89a specification, to check what the encoder wrote.
  function lzw(minCode, data, count) {
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, next = eoi + 1, prev = null;
    let dict = [];
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = null; dict[eoi] = null; size = minCode + 1; next = eoi + 1; prev = null; };
    reset();
    const out = [];
    let bits = 0, acc = 0, p = 0;
    while (out.length < count) {
      while (bits < size && p < data.length) { acc |= data[p++] << bits; bits += 8; }
      if (bits < size) break;
      const code = acc & ((1 << size) - 1);
      acc >>>= size; bits -= size;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry;
      if (code < next && dict[code]) entry = dict[code];
      else if (code === next && prev) entry = [...prev, prev[0]];
      else throw new Error("bad LZW code " + code);
      out.push(...entry);
      if (prev && next < 4096) { dict[next++] = [...prev, entry[0]]; if (next === (1 << size) && size < 12) size++; }
      prev = entry;
    }
    return out.slice(0, count);
  }
  function parseGif(b) {
    const g = { header: String.fromCharCode(...b.slice(0, 6)), width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), frames: [], loop: null, trailer: b[b.length - 1] };
    const flags = b[10];
    let p = 13, gct = null;
    const table = (len) => { const t = []; for (let i = 0; i < len; i++, p += 3) t.push([b[p], b[p + 1], b[p + 2]]); return t; };
    if (flags & 0x80) gct = table(1 << ((flags & 7) + 1));
    g.hasGlobalTable = !!gct;
    let gce = null;
    for (;;) {
      const t = b[p++];
      if (t === 0x3b) break;
      if (t === 0x21) {
        const label = b[p++], blocks = [];
        while (b[p] !== 0) { blocks.push(b.slice(p + 1, p + 1 + b[p])); p += b[p] + 1; }
        p++;
        if (label === 0xf9) gce = { delay: blocks[0][1] | (blocks[0][2] << 8), transparent: !!(blocks[0][0] & 1), disposal: (blocks[0][0] >> 2) & 7 };
        if (label === 0xff && String.fromCharCode(...blocks[0]) === "NETSCAPE2.0") g.loop = blocks[1][1] | (blocks[1][2] << 8);
      } else if (t === 0x2c) {
        const x = b[p] | (b[p + 1] << 8), y = b[p + 2] | (b[p + 3] << 8), w = b[p + 4] | (b[p + 5] << 8), h = b[p + 6] | (b[p + 7] << 8), f = b[p + 8];
        p += 9;
        const lct = f & 0x80 ? table(1 << ((f & 7) + 1)) : null;
        const minCode = b[p++], data = [];
        while (b[p] !== 0) { data.push(...b.slice(p + 1, p + 1 + b[p])); p += b[p] + 1; }
        p++;
        g.frames.push({ x, y, w, h, delay: gce ? gce.delay : null, palette: lct || gct, local: !!lct, idx: lzw(minCode, data, w * h) });
        gce = null;
      } else throw new Error("unexpected block 0x" + t.toString(16) + " at " + (p - 1));
    }
    return g;
  }
  const solid = (w, h, [r, g, b]) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; } return d; };
  const colorAt = (frame, i) => frame.palette[frame.idx[i]];

  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const delays = [100, 200, 300];
  const bytes = await gc.encodeGif({ count: 3, width: 8, height: 6, getFrame: (i) => solid(8, 6, colours[i]), delayAt: (i) => delays[i], repeat: 0, colors: 256 }, gifenc);
  const g = parseGif(bytes);
  eq([g.header, g.width, g.height, g.trailer], ["GIF89a", 8, 6, 0x3b], "header, size and trailer");
  eq(g.frames.length, 3, "three frames");
  eq(g.frames.map((f) => f.delay), [10, 20, 30], "delays in hundredths of a second");
  eq(g.loop, 0, "loops forever");
  eq(g.frames.map((f) => [f.w, f.h, f.x, f.y]), [[8, 6, 0, 0], [8, 6, 0, 0], [8, 6, 0, 0]], "every frame covers the picture");
  g.frames.forEach((f, i) => {
    ok(f.idx.every((v) => v === f.idx[0]), `frame ${i + 1} is one colour`);
    eq(colorAt(f, 0), colours[i], `frame ${i + 1} colour`);
  });
  eq(g.hasGlobalTable && !g.frames[0].local, true, "the first frame's palette is the global table");
  eq(g.frames.slice(1).every((f) => f.local), true, "later frames carry their own palette");

  const once = parseGif(await gc.encodeGif({ count: 2, width: 4, height: 4, getFrame: (i) => solid(4, 4, colours[i]), delayAt: () => 50, repeat: -1, colors: 256 }, gifenc));
  eq(once.loop, null, "play once: no loop extension");
  eq(once.frames.length, 2, "two frames");

  // a two-colour picture: left half red, right half blue
  const half = new Uint8ClampedArray(8 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { const o = (y * 8 + x) * 4; const c = x < 4 ? [255, 0, 0] : [0, 0, 255]; half[o] = c[0]; half[o + 1] = c[1]; half[o + 2] = c[2]; half[o + 3] = 255; }
  const two = parseGif(await gc.encodeGif({ count: 1, width: 8, height: 2, getFrame: () => half, delayAt: () => 100, repeat: 0, colors: 256 }, gifenc)).frames[0];
  eq([0, 3, 4, 7, 8, 15].map((i) => colorAt(two, i)), [[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255], [255, 0, 0], [0, 0, 255]], "pixels land where they were");

  // a smooth gradient reduced to 32 colours
  const grad = new Uint8ClampedArray(64 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) { const o = (y * 64 + x) * 4; grad[o] = x * 4; grad[o + 1] = 255 - x * 4; grad[o + 2] = 128; grad[o + 3] = 255; }
  const gf = parseGif(await gc.encodeGif({ count: 1, width: 64, height: 4, getFrame: () => grad, delayAt: () => 100, repeat: 0, colors: 32 }, gifenc)).frames[0];
  ok(gf.palette.length <= 32, "palette of at most 32 colours: " + gf.palette.length);
  ok(gf.idx.every((v) => v < gf.palette.length), "every index points into the palette");
  let worst = 0;
  for (let i = 0; i < 64; i++) { const c = colorAt(gf, i); for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[k] - grad[i * 4 + k])); }
  ok(worst <= 40, "gradient error with 32 colours stays small: " + worst);

  let progress = [];
  await gc.encodeGif({ count: 2, width: 2, height: 2, getFrame: async (i) => solid(2, 2, colours[i]), delayAt: () => 100, repeat: 0, colors: 64, onFrame: async (i) => { progress.push(i); } }, gifenc);
  eq(progress, [0, 1], "progress callback and async frames");
  const odd = parseGif(await gc.encodeGif({ count: 1, width: 2, height: 2, getFrame: () => solid(2, 2, colours[0]), delayAt: () => 100, repeat: 0, colors: 99 }, gifenc));
  eq(odd.frames.length, 1, "an unknown colour count falls back to 256");
  await throws(() => gc.encodeGif({ count: 0, width: 2, height: 2, getFrame: () => solid(2, 2, colours[0]), delayAt: () => 100, repeat: 0, colors: 256 }, gifenc), "no frames");
  await throws(() => gc.encodeGif({ count: 1, width: 3, height: 2, getFrame: () => solid(2, 2, colours[0]), delayAt: () => 100, repeat: 0, colors: 256 }, gifenc), "wrong frame size");
}

/* ------------------------------------------------------------------ heic-to-jpg */
{
  // The fixtures are 96 x 64 pictures (a colour gradient with a red, a blue, a yellow and a green rectangle and a white ellipse),
  // made by libheif 1.23 and x265 from a synthetic image with Pillow-heif:
  //   img.save("photo-q85.heic", quality=85); img.save("photo-q60.heic", quality=60); img.save("lossless.heic", quality=-1)
  const fx = (name) => new Uint8Array(readFileSync(new URL(`../heic-fixtures/${name}`, import.meta.url)));
  const q85 = fx("photo-q85.heic"), q60 = fx("photo-q60.heic"), lossless = fx("lossless.heic");

  const ftyp = (major, ...compat) => {
    const brands = [major, ...compat];
    const b = new Uint8Array(16 + 4 * compat.length);
    b.set([0, 0, 0, b.length, 0x66, 0x74, 0x79, 0x70]);
    brands.forEach((x, i) => { for (let k = 0; k < 4; k++) b[8 + (i + (i ? 1 : 0)) * 4 + k] = x.charCodeAt(k); });
    return b;
  };
  eq(hc.brandsOf(q85), { major: "heic", compatible: ["mif1", "heic", "miaf"] }, "brands of a real file");
  eq(hc.brandsOf(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])), null, "a PNG has no ftyp box");
  eq(hc.brandsOf(new Uint8Array(4)), null, "too short");
  eq(hc.brandsOf(null), null, "nothing");
  eq([hc.heicKind(q85), hc.heicKind(lossless)], ["heic", "heic"], "phone files are HEIC");
  eq(hc.heicKind(ftyp("heic", "mif1")), "heic", "heic major brand");
  eq(hc.heicKind(ftyp("heix")), "heic", "heix");
  eq(hc.heicKind(ftyp("mif1", "mif1", "heic")), "heic", "mif1 with a heic compatible brand (Nokia samples)");
  eq(hc.heicKind(ftyp("avif", "mif1", "miaf")), "avif", "AVIF is not HEIC");
  eq(hc.heicKind(ftyp("avis", "avif")), "avif", "AVIF sequence");
  eq(hc.heicKind(ftyp("mif1", "miaf")), null, "a HEIF file with no HEVC brand");
  eq(hc.heicKind(ftyp("isom", "mp42")), null, "an MP4 video");
  eq(hc.heicKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1])), null, "a JPEG");

  eq(hc.looksDamaged(new Uint8Array(0)), false, "no pixels");
  const flat = (n, rgb) => { const a = new Uint8Array(n * 4); for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4); return a; };
  eq(hc.looksDamaged(flat(100, [0, 135, 0])), true, "all empty");
  eq(hc.looksDamaged(flat(100, [200, 100, 50])), false, "an ordinary picture");
  const mix = flat(100, [200, 100, 50]); mix.set(flat(1, [0, 135, 0]), 0);
  eq(hc.looksDamaged(mix), false, "one empty pixel in a hundred is not damage");
  mix.set(flat(3, [0, 135, 0]), 0);
  eq(hc.looksDamaged(mix), true, "three in a hundred is");
  eq(hc.looksDamaged(flat(100, [0, 84, 0]), [0, 84, 0]), true, "the empty colour can differ with the colour matrix");

  const pic = hc.decodeChecked(tsheic, q85);
  eq([pic.width, pic.height, pic.data.length], [96, 64, 96 * 64 * 4], "q85 decodes to 96 x 64");
  const at = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
  const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  ok(close(at(pic, 10, 10), [230, 30, 30, 255], 6), "red rectangle: " + at(pic, 10, 10));
  ok(close(at(pic, 70, 10), [30, 60, 220, 255], 6), "blue rectangle: " + at(pic, 70, 10));
  ok(close(at(pic, 10, 45), [240, 200, 20, 255], 6), "yellow rectangle: " + at(pic, 10, 45));
  ok(close(at(pic, 70, 45), [30, 170, 60, 255], 6), "green rectangle: " + at(pic, 70, 45));
  ok(close(at(pic, 48, 32), [250, 250, 250, 255], 6), "white ellipse: " + at(pic, 48, 32));
  ok(close(at(pic, 47, 2), [127, 8, 128, 255], 14), "gradient: " + at(pic, 47, 2));
  const low = hc.decodeChecked(tsheic, q60);
  eq([low.width, low.height], [96, 64], "q60 decodes too");
  ok(close(at(low, 10, 10), [230, 30, 30, 255], 14), "q60 red rectangle: " + at(low, 10, 10));
  ok(q60.length < q85.length, "lower quality is a smaller file");

  const codeOf = (fn) => { try { fn(); return "no error"; } catch (e) { return e instanceof hc.HeicError ? e.code : "other: " + e.message; } };
  eq(codeOf(() => hc.decodeChecked(tsheic, lossless)), "unsupported", "lossless HEIC is refused by the decoder");
  eq(codeOf(() => hc.decodeChecked(tsheic, Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]))), "not-heic", "a PNG");
  const avif = q85.slice(); avif.set([0x61, 0x76, 0x69, 0x66], 8); avif.set([0x61, 0x76, 0x69, 0x66], 20);   // major brand and the "heic" compatible brand
  eq(codeOf(() => hc.decodeChecked(tsheic, avif)), "not-heic", "a file labelled AVIF");
  const cut = q85.slice(0, 500);
  eq(codeOf(() => hc.decodeChecked(tsheic, cut)), "unsupported", "a truncated file");

  // a picture claiming 9000 x 9000 pixels is refused before anything is decoded
  const big = q85.slice();
  const ispe = (() => { for (let i = 4; i + 16 <= big.length; i++) if (big[i] === 0x69 && big[i + 1] === 0x73 && big[i + 2] === 0x70 && big[i + 3] === 0x65) return i; return -1; })();
  ok(ispe > 0, "found the image size box");
  new DataView(big.buffer).setUint32(ispe + 8, 9000); new DataView(big.buffer).setUint32(ispe + 12, 9000);
  try { hc.decodeChecked(tsheic, big); ok(false, "81 megapixels should be refused"); } catch (e) { eq([e.code, e.width, e.height], ["too-big", 9000, 9000], "too-big error carries the size"); }

  // a decode that leaves most of the picture empty is reported as damaged
  const fakeLib = {
    getHeicMetadata: () => ({ width: 10, height: 10, sps: { color: { matrixCoeffs: 6, videoFullRange: true } } }),
    decodeHeic: () => ({ width: 10, height: 10, data: flat(100, [0, 135, 0]) }),
    yuv420ToRgba: tsheic.yuv420ToRgba,
  };
  eq(codeOf(() => hc.decodeChecked(fakeLib, q85)), "damaged", "empty decode is damaged");
  fakeLib.decodeHeic = () => ({ width: 10, height: 10, data: flat(100, [10, 20, 30]) });
  eq(codeOf(() => hc.decodeChecked(fakeLib, q85)), "no error", "a normal decode passes");
  eq(hc.MAX_PIXELS, 50e6, "pixel limit");
}

console.log(`${n - bad}/${n} unit checks passed`);
process.exit(bad ? 1 : 0);
