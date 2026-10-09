import { $, $$, fmtBytes, clearNode, tx, txn } from "./core.js?v=11";
import { batchTool, decode, newCanvas, ctx2d, release, encodeCanvas, keepType, outName, LABEL, dims } from "./imgcore.js?v=11";
import { thumbOf, rrPath, clamp } from "./imgcore3.js?v=11";

const prev = $("#preview"), prevLabel = $("#preview-label");
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const val = (id, hi) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? clamp(v, 0, hi) : 0; };

let prevThumb = null;   // { id, canvas, w, h } reduced copy of the first image and its real size
let tool;

function options() {
  const round = radio("mode") === "round";
  const bu = radio("bu"), ru = radio("ru");
  return {
    round,
    bw: round ? 0 : val("#bw", bu === "pct" ? 100 : 5000), pw: round ? 0 : val("#pw", bu === "pct" ? 100 : 5000), bu,
    rw: val("#rw", ru === "pct" ? 50 : 20000), ru,
    bc: $("#bc").value, pc: $("#pc").value, jc: $("#jc").value, fmt: radio("fmt"),
  };
}

/* Sizes for a picture w x h, in output pixels.
     border / padding : px as typed, or % of the shorter side of the original picture (rounded to whole pixels)
     output size      : (w + 2 (border + padding)) x (h + 2 (border + padding))
     corner radius    : px as typed, or % of the shorter side of the output; never more than half of it
   Rounded-corners-only mode has no border or padding, so the size is unchanged. */
export function geometry(w, h, o) {
  const short = Math.min(w, h);
  const b = o.bu === "pct" ? Math.round((o.bw / 100) * short) : Math.round(o.bw);
  const p = o.bu === "pct" ? Math.round((o.pw / 100) * short) : Math.round(o.pw);
  const ow = w + 2 * (b + p), oh = h + 2 * (b + p);
  const lim = Math.min(ow, oh) / 2;
  const r = Math.min(lim, o.ru === "pct" ? (o.rw / 100) * Math.min(ow, oh) : o.rw);
  return { b, p, ow, oh, r };
}

/* Draw the framed picture. k scales every length (1 for the real file, smaller for the preview). */
function paint(canvas, src, w, h, o, k) {
  const g = geometry(w, h, o);
  const ow = Math.max(1, Math.round(g.ow * k)), oh = Math.max(1, Math.round(g.oh * k));
  canvas.width = ow; canvas.height = oh;
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, ow, oh);
  const b = g.b * k, t = (g.b + g.p) * k, r = g.r * k;
  if (g.b > 0) { rrPath(ctx, 0, 0, ow, oh, r); ctx.fillStyle = o.bc; ctx.fill(); }
  if (g.p > 0) { rrPath(ctx, b, b, ow - 2 * b, oh - 2 * b, Math.max(0, r - b)); ctx.fillStyle = o.pc; ctx.fill(); }
  ctx.save();
  rrPath(ctx, t, t, ow - 2 * t, oh - 2 * t, Math.max(0, r - t));
  ctx.clip();
  ctx.drawImage(src, t, t, ow - 2 * t, oh - 2 * t);
  ctx.restore();
  return g;
}

function drawPreview() {
  if (!prevThumb) return;
  const o = options();
  const { canvas, w, h } = prevThumb;
  const k = canvas.width / w;
  const g = paint(prev, canvas, w, h, o, k);
  prevLabel.textContent = tx("Preview of {name}: {size} px when saved.", { name: tool.items[0].file.name, size: dims(g.ow, g.oh) });
}

async function loadPreview(item) {
  if (prevThumb) { release(prevThumb.canvas); prevThumb = null; }
  if (!item) { prevLabel.textContent = ""; return; }
  const id = item.id;
  try {
    const bmp = await decode(item.file);
    const canvas = thumbOf(bmp, 640);
    const w = bmp.width, h = bmp.height;
    bmp.close();
    if (!tool.items[0] || tool.items[0].id !== id) { release(canvas); return; }
    prevThumb = { id, canvas, w, h };
    drawPreview();
  } catch (err) {
    console.warn(err);
    prevLabel.textContent = tx("A preview isn't available for this image, but the border will still be added.");
  }
}

function syncMode() {
  const round = radio("mode") === "round";
  $$("[data-border]").forEach((n) => { n.hidden = round; });
}

$$("#opts input, #opts select").forEach((c) => {
  c.addEventListener("input", () => { syncMode(); drawPreview(); clearNode($("#result")); $("#result").hidden = true; });
  c.addEventListener("change", () => { syncMode(); drawPreview(); });
});
syncMode();

tool = batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Framing"), zipName: "framed-images.zip",
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  summaryText: (items) => txn(items.length, "{n} image", "{n} images"),
  onChange(items) {
    const first = items[0] || null;
    if ((first ? first.id : null) !== (prevThumb ? prevThumb.id : null)) loadPreview(first);
  },
  async process(item) {
    const o = options();
    const type = o.fmt === "keep" ? keepType(item.info.type) : o.fmt;
    const bmp = await decode(item.file);
    const g = geometry(bmp.width, bmp.height, o);
    const canvas = newCanvas(g.ow, g.oh);
    try {
      paint(canvas, bmp, bmp.width, bmp.height, o, 1);
      bmp.close();
      const blob = await encodeCanvas(canvas, type, 0.92, o.jc);
      return { blob, name: outName(item.file.name, o.round ? "-rounded" : "-framed", type), note: tx("{size} px", { size: dims(canvas.width, canvas.height) }) };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => txn(outputs.length, "Done: {n} image framed.", "Done: {n} images framed."),
});
