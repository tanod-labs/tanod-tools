import { $, $$, fmtBytes, setStatus, runJob, showResults, clearNode, announce, debounce, UserError, tx } from "./core.js?v=11";
import { singleImage, decode, newCanvas, ctx2d, release, encodeCanvas, keepType, outName, LABEL, dims } from "./imgcore.js?v=11";
import { thumbOf, loadFont, clamp } from "./imgcore3.js?v=11";

const drop = $("#drop"), editor = $("#editor"), goRow = $("#go-row"), go = $("#go");
const status = $("#status"), result = $("#result"), preview = $("#preview"), fitHelp = $("#fit-help");

let img = null; // { file, info, bmp, thumb, W, H }
let token = 0;

const FONTS = {
  archivo: { css: '"Archivo", sans-serif', load: "Archivo", bold: true },
  bungee: { css: '"Bungee", sans-serif', load: "Bungee", bold: false },
  serif: { css: "serif", bold: true },
  sans: { css: "sans-serif", bold: true },
  mono: { css: "monospace", bold: true },
};
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const numVal = (id, fallback = 0) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : fallback; };

function settings() {
  const [ax, ay] = radio("pos").split(",").map((v) => Number(v) / 2);
  const f = FONTS[$("#font").value];
  return {
    text: $("#text").value,
    font: f,
    bold: $("#bold").checked && f.bold,
    sizePct: clamp(numVal("#size", 6), 1, 40),
    color: $("#color").value,
    align: radio("align"),
    outline: $("#outline").checked, outlineColor: $("#outline-color").value, outlinePct: Number($("#outline-w").value),
    shadow: $("#shadow").checked, shadowColor: $("#shadow-color").value,
    box: $("#box").checked, boxColor: $("#box-color").value, boxOpacity: Number($("#box-opacity").value) / 100, boxPad: Number($("#box-pad").value) / 100,
    ax, ay, ox: clamp(numVal("#ox"), -100, 100), oy: clamp(numVal("#oy"), -100, 100),
  };
}

const fontSpec = (s, px) => `${s.bold ? 700 : 400} ${px}px ${s.font.css}`;

/* Draw the text onto ctx, for a picture W x H. Every length is a fraction of the picture or of the text size, so the
   preview and the full-size file match.
     size      = sizePct% of W
     line pitch = 1.2 x size
     padding   = boxPad x size (only when the box is on); outline half-width = outlinePct% of size (outer half only)
     margin    = 2% of W between the picture edge and a text block placed on an edge
     block left = margin + ax * (W - 2 margin - blockWidth) + ox% of W   (ax = 0, 0.5, 1 for left, centre, right)
     block top  = margin + ay * (H - 2 margin - blockHeight) + oy% of H
   Returns the block rectangle, or null when there is no text. */
export function drawText(ctx, W, H, s) {
  const lines = s.text.replace(/\r\n?/g, "\n").split("\n");
  if (!s.text.trim()) return null;
  const size = (s.sizePct / 100) * W;
  ctx.save();
  ctx.font = fontSpec(s, size);
  ctx.textBaseline = "middle";
  const widths = lines.map((l) => ctx.measureText(l).width);
  const pad = s.box ? s.boxPad * size : 0;
  const lh = size * 1.2;
  const bw = Math.max(...widths) + 2 * pad, bh = lines.length * lh + 2 * pad;
  const m = 0.02 * W;
  const left = m + s.ax * (W - 2 * m - bw) + (s.ox / 100) * W;
  const top = m + s.ay * (H - 2 * m - bh) + (s.oy / 100) * H;
  if (s.box) {
    ctx.globalAlpha = s.boxOpacity;
    ctx.fillStyle = s.boxColor;
    ctx.fillRect(left, top, bw, bh);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = s.align;
  const x = s.align === "left" ? left + pad : s.align === "right" ? left + bw - pad : left + bw / 2;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    if (!line) return;
    const y = top + pad + (i + 0.5) * lh;
    if (s.shadow) {
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = size * 0.12;
      ctx.shadowOffsetX = size * 0.05;
      ctx.shadowOffsetY = size * 0.07;
    }
    if (s.outline && s.outlinePct > 0) {
      ctx.strokeStyle = s.outlineColor;
      ctx.lineWidth = 2 * (s.outlinePct / 100) * size; // stroke is centred on the edge, so the fill hides the inner half
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "rgba(0,0,0,0)"; // one shadow per line is enough
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "rgba(0,0,0,0)";
  });
  ctx.restore();
  return { left, top, width: bw, height: bh, textWidth: Math.max(...widths) };
}

/* ------------------------------------------------------------------ preview */

async function ensureFont(s) {
  await loadFont(fontSpec(s, 32));
}

async function redraw() {
  if (!img) return;
  const mine = ++token;
  const s = settings();
  await ensureFont(s);
  if (mine !== token || !img) return;
  const t = img.thumb;
  preview.width = t.width; preview.height = t.height;
  const ctx = ctx2d(preview);
  ctx.drawImage(t, 0, 0);
  const r = drawText(ctx, t.width, t.height, s);
  fitHelp.textContent = r && r.width > t.width ? tx("The text is wider than the picture. Reduce the size or add a line break.") : "";
  $("#size-out").textContent = String(s.sizePct);
  $("#box-opacity-out").textContent = String(Math.round(s.boxOpacity * 100));
  $("#box-pad-out").textContent = String(Math.round(s.boxPad * 100));
  $("#summary").textContent = tx("{size} px", { size: dims(img.W, img.H) });
}
const redrawSoon = debounce(redraw, 30);

/* ------------------------------------------------------------------ placing: click/tap and arrow keys */

preview.addEventListener("pointerdown", (e) => {
  if (!img || (e.button !== undefined && e.button > 0)) return;
  const r = preview.getBoundingClientRect();
  const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
  // centre the block on the point: with the centre anchor, offset = point - half the picture
  $('input[name="pos"][value="1,1"]').checked = true;
  $("#ox").value = String(Math.round((fx - 0.5) * 1000) / 10);
  $("#oy").value = String(Math.round((fy - 0.5) * 1000) / 10);
  preview.focus({ preventScroll: true });
  redraw();
});

preview.addEventListener("keydown", (e) => {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const step = e.shiftKey ? 5 : 0.5;
  const round = (v) => Math.round(clamp(v, -100, 100) * 10) / 10;
  $("#ox").value = String(round(numVal("#ox") + dir[0] * step));
  $("#oy").value = String(round(numVal("#oy") + dir[1] * step));
  redraw();
  announce(tx("Text moved to {x}% across, {y}% down from its position.", { x: $("#ox").value, y: $("#oy").value }));
});

$$("input, select, textarea", editor).forEach((c) => {
  c.addEventListener("input", () => { clearNode(result); result.hidden = true; redrawSoon(); });
  c.addEventListener("change", redrawSoon);
});
$("#font").addEventListener("change", () => {
  const f = FONTS[$("#font").value];
  $("#bold").disabled = !f.bold;
});
// the position grid resets the fine offset, so a fresh choice does what it says
$$('input[name="pos"]').forEach((r) => r.addEventListener("change", () => { $("#ox").value = "0"; $("#oy").value = "0"; redraw(); }));

/* ------------------------------------------------------------------ load, render, reset */

async function load(file, info) {
  setStatus(status, "working", tx("Opening the image…"));
  const bmp = await decode(file);
  if (img) { img.bmp.close(); release(img.thumb); }
  img = { file, info, bmp, thumb: thumbOf(bmp, 900), W: bmp.width, H: bmp.height };
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  editor.hidden = false; goRow.hidden = false;
  drop.classList.add("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose another image");
  $("#file-meta").textContent = `${file.name} · ${fmtBytes(file.size)} · ${dims(img.W, img.H)} · ${LABEL[info.type]}`;
  await redraw();
  announce(tx("Image ready. Type your text, then press Add text and save."));
}

singleImage(drop, { onFile: load, onError: (msg) => setStatus(status, "error", msg) });

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Adding text…"),
  done: (r) => r && tx("Text added. Saved at the original {size} pixels.", { size: dims(r.w, r.h) }),
  job: async () => {
    const s = settings();
    if (!s.text.trim()) throw new UserError(tx("Type some text first."));
    await ensureFont(s);
    const fmt = radio("fmt");
    const type = fmt === "keep" ? keepType(img.info.type) : fmt;
    const canvas = newCanvas(img.W, img.H);
    try {
      const ctx = ctx2d(canvas);
      ctx.drawImage(img.bmp, 0, 0);
      drawText(ctx, img.W, img.H, s);
      const blob = await encodeCanvas(canvas, type, 0.92);
      const note = tx("{size} px", { size: dims(img.W, img.H) }) + (img.info.type !== type ? " · " + tx("saved as {format}", { format: LABEL[type] }) : "");
      showResults(result, [{ blob, name: outName(img.file.name, "-text", type), note }]);
    } finally {
      release(canvas);
    }
    return { w: img.W, h: img.H };
  },
}));

$("#clear").addEventListener("click", () => {
  if (img) { img.bmp.close(); release(img.thumb); }
  img = null; token++;
  editor.hidden = true; goRow.hidden = true;
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose an image");
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});
