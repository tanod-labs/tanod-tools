import { $, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tx, txn, EN, listText } from "./core.js?v=11";
import { loadPdfLib, openForEdit, parseRanges, saveDoc } from "./pdfcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_TILES = 600;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const text = $("#text"), size = $("#size"), opacity = $("#opacity"), color = $("#color"), range = $("#range");

let file = null, bytes = null, pageCount = 0;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    setStatus(status, "working", tx("Reading the PDF…"));
    clearNode(result); result.hidden = true;
    try {
      const b = await readBytes(f);
      const doc = await openForEdit(b, f.name);
      file = f; bytes = b; pageCount = doc.getPageCount();
      if (!pageCount) throw new UserError(tx("This PDF has no pages."));
      $("#fname").textContent = f.name;
      $("#finfo").textContent = fmtBytes(f.size) + " · " + txn(pageCount, "{n} page", "{n} pages");
      work.hidden = false;
      drop.classList.add("is-compact");
      $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
      setStatus(status, "idle");
      update();
      announce(tx("{name} loaded, {pages}.", { name: f.name, pages: txn(pageCount, "{n} page", "{n} pages") }));
    } catch (err) {
      setStatus(status, "error", err instanceof UserError ? err.message : tx("This file couldn't be read as a PDF."));
    }
  },
});

const radio = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/* Characters Helvetica (WinAnsi) can't draw. Returns the unique offenders. */
let allowed = null;
async function unsupported(str) {
  if (!allowed) {
    const { PDFDocument, StandardFonts } = await loadPdfLib();
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    allowed = new Set(f.getCharacterSet());
  }
  return [...new Set([...str].filter((ch) => !allowed.has(ch.codePointAt(0))))];
}
const show = (chars) => { const parts = chars.map((c) => (c.trim() ? `"${c}"` : tx("a control character"))); return EN ? parts.join(", ") : listText(parts); };

async function update() {
  $("#range-field").hidden = radio("scope") !== "range";
  $("#opacity-v").textContent = opacity.value + "%";
  const t = text.value;
  let bad = [];
  try { bad = t ? await unsupported(t) : []; } catch (_) { /* checked again on save */ }
  const help = $("#text-help");
  if (bad.length) {
    help.textContent = tx("Can't draw {chars} in Helvetica. Remove or replace it.", { chars: show(bad) });
    text.setAttribute("aria-invalid", "true");
  } else {
    help.textContent = tx("Letters, digits and common punctuation (Helvetica).");
    text.removeAttribute("aria-invalid");
  }
  go.disabled = !bytes || !t.trim() || bad.length > 0;
}
for (const e of [text, size, opacity, color, range, ...document.querySelectorAll('input[name]')]) {
  e.addEventListener("input", update); e.addEventListener("change", update);
}
document.querySelectorAll("[data-swatch]").forEach((b) => b.addEventListener("click", () => { color.value = b.dataset.swatch; }));

function mapper(box, rot) {
  const { x: cx, y: cy, width: w, height: h } = box;
  switch (rot) {
    case 90: return { vw: h, vh: w, pt: (vx, vy) => [cx + w - vy, cy + vx] };
    case 180: return { vw: w, vh: h, pt: (vx, vy) => [cx + w - vx, cy + h - vy] };
    case 270: return { vw: h, vh: w, pt: (vx, vy) => [cx + vy, cy + h - vx] };
    default: return { vw: w, vh: h, pt: (vx, vy) => [cx + vx, cy + vy] };
  }
}

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Adding the watermark…"),
  done: (r) => r && txn(r.n, "Watermarked {n} page.", "Watermarked {n} pages."),
  job: async (progress) => {
    const t = text.value.trim();
    const bad = await unsupported(t);
    if (bad.length) throw new UserError(tx("The watermark contains characters that Helvetica can't draw: {chars}. Remove or replace them and try again.", { chars: show(bad) }));
    const fs = Number(size.value);
    if (!Number.isFinite(fs) || fs < 8 || fs > 400) throw new UserError(tx("Font size must be between 8 and 400."));
    let pages = Array.from({ length: pageCount }, (_, i) => i);
    if (radio("scope") === "range") pages = [...new Set(parseRanges(range.value, pageCount).flat())].sort((a, b) => a - b).map((p) => p - 1);
    const { StandardFonts, rgb, degrees } = await loadPdfLib();
    const doc = await openForEdit(bytes, file.name);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const tw = font.widthOfTextAtSize(t, fs);
    const angle = Number(radio("angle"));
    const tiled = radio("place") === "tiled";
    const [r, g, b] = hexRgb(color.value);
    const all = doc.getPages();
    const rad = (angle * Math.PI) / 180, ux = Math.cos(rad), uy = Math.sin(rad);
    pages.forEach((idx, k) => {
      const page = all[idx];
      const box = typeof page.getCropBox === "function" ? page.getCropBox() : page.getMediaBox();
      const rot = (((page.getRotation().angle % 360) + 360) % 360);
      const m = mapper(box, rot);
      const cx = m.vw / 2, cy = m.vh / 2;
      const draw = (px, py) => {
        // (px, py) = centre of the text in visual space; start of baseline is half a width back along the angle
        const sx = px - (tw / 2) * ux + (fs * 0.35) * uy;
        const sy = py - (tw / 2) * uy - (fs * 0.35) * ux;
        const [x, y] = m.pt(sx, sy);
        page.drawText(t, { x, y, size: fs, font, color: rgb(r, g, b), opacity: Number(opacity.value) / 100, rotate: degrees(angle + rot) });
      };
      if (!tiled) draw(cx, cy);
      else {
        const stepU = tw + fs * 1.5, stepV = fs * 3;
        const reach = Math.hypot(m.vw, m.vh) / 2 + stepU;
        let n = 0;
        for (let j = -Math.ceil(reach / stepV); j <= Math.ceil(reach / stepV) && n < MAX_TILES; j++) {
          for (let i = -Math.ceil(reach / stepU); i <= Math.ceil(reach / stepU) && n < MAX_TILES; i++) {
            const u = (i + (j % 2 ? 0.5 : 0)) * stepU, v = j * stepV;
            const px = cx + u * ux - v * uy, py = cy + u * uy + v * ux;
            // keep tiles whose centre lies within the page, with half a text length of slack
            if (px < -tw / 2 || px > m.vw + tw / 2 || py < -fs || py > m.vh + fs) continue;
            draw(px, py); n++;
          }
        }
      }
      if (k % 10 === 0) progress(tx("Watermarking page {n}…", { n: idx + 1 }), k / pages.length);
    });
    progress(tx("Writing the file…"), 0.95);
    const blob = await saveDoc(doc);
    showResults(result, [{ blob, name: baseName(file.name) + "-watermarked.pdf", note: txn(pageCount, "{n} page", "{n} pages") }]);
    return { n: pages.length };
  },
}));

$("#clear").addEventListener("click", () => {
  file = bytes = null; pageCount = 0;
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});
