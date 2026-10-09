import { $, $$, fmtBytes, setStatus, runJob, showResults, clearNode, announce, tick, UserError, tx, fmtNum } from "./core.js?v=11";
import { singleImage, decode, newCanvas, ctx2d, release, encodeCanvas, keepType, outName, LABEL, dims } from "./imgcore.js?v=11";
import { thumbOf, applyFilters, FILTER_DEFAULTS, isNeutral } from "./imgcore3.js?v=11";

const drop = $("#drop"), editor = $("#editor"), goRow = $("#go-row"), go = $("#go");
const status = $("#status"), result = $("#result"), preview = $("#preview"), compare = $("#compare");

let img = null;      // { file, info, bmp, thumb, base: ImageData of the thumb, W, H }
let token = 0;
let queued = false;

const PRESETS = {
  bw: { grayscale: 100 },
  sepia: { sepia: 100 },
  vivid: { saturation: 140, contrast: 112 },
  fade: { brightness: 106, contrast: 84, saturation: 80, sepia: 12 },
  invert: { invert: 100 },
  reset: {},
};

const sliders = $$("input[data-key]");
const params = () => Object.fromEntries(sliders.map((s) => [s.dataset.key, Number(s.value)]));

function showValues() {
  for (const s of sliders) $("#o-" + s.dataset.key).textContent = s.value;
}

function setParams(p) {
  const all = { ...FILTER_DEFAULTS, ...p };
  for (const s of sliders) s.value = String(all[s.dataset.key]);
  showValues();
  schedule();
}

/* ------------------------------------------------------------------ preview */

async function paint() {
  queued = false;
  if (!img) return;
  const mine = ++token;
  const p = params();
  showValues();
  const neutral = isNeutral(p);
  go.disabled = neutral;
  $("#summary").textContent = neutral ? tx("Move a slider or pick a preset first.") : tx("{size} px", { size: dims(img.W, img.H) });
  compare.disabled = neutral;
  if (neutral && compare.getAttribute("aria-pressed") === "true") setCompare(false);
  const showOriginal = compare.getAttribute("aria-pressed") === "true";
  const out = new ImageData(new Uint8ClampedArray(img.base.data), img.base.width, img.base.height);
  if (!showOriginal && !neutral) await applyFilters(out.data, out.width, out.height, p);
  if (mine !== token || !img) return;
  preview.width = out.width; preview.height = out.height;
  ctx2d(preview).putImageData(out, 0, 0);
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(paint);
}

function setCompare(on) {
  compare.setAttribute("aria-pressed", String(on));
  compare.textContent = on ? tx("Showing original") : tx("Show original");
  $("#compare-note").textContent = on ? tx("This is the unfiltered picture. Press again to see the filters.") : "";
}
compare.addEventListener("click", () => {
  const on = compare.getAttribute("aria-pressed") !== "true";
  setCompare(on);
  paint();
});

sliders.forEach((s) => s.addEventListener("input", () => { clearNode(result); result.hidden = true; schedule(); }));
$$("[data-preset]").forEach((b) => b.addEventListener("click", () => {
  setParams(PRESETS[b.dataset.preset]);
  clearNode(result); result.hidden = true;
  announce(b.dataset.preset === "reset" ? tx("Filters reset.") : tx("{name} preset applied.", { name: b.textContent }));
}));

/* ------------------------------------------------------------------ load, apply, reset */

async function load(file, info) {
  setStatus(status, "working", tx("Opening the image…"));
  const bmp = await decode(file);
  if (img) { img.bmp.close(); release(img.thumb); }
  const thumb = thumbOf(bmp, 800);
  const base = ctx2d(thumb, { willReadFrequently: true }).getImageData(0, 0, thumb.width, thumb.height);
  img = { file, info, bmp, thumb, base, W: bmp.width, H: bmp.height };
  setParams({});
  setCompare(false);
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  editor.hidden = false; goRow.hidden = false;
  drop.classList.add("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose another image");
  $("#file-meta").textContent = `${file.name} · ${fmtBytes(file.size)} · ${dims(img.W, img.H)} · ${LABEL[info.type]}`;
  await paint();
  announce(tx("Image ready. Choose a preset or move the sliders."));
}

singleImage(drop, { onFile: load, onError: (msg) => setStatus(status, "error", msg) });

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Applying filters…"),
  done: (r) => r && tx("Filters applied. Saved at the original {size} pixels.", { size: dims(r.w, r.h) }),
  job: async (progress) => {
    const p = params();
    const fmt = $('input[name="fmt"]:checked').value;
    const type = fmt === "keep" ? keepType(img.info.type) : fmt;
    const canvas = newCanvas(img.W, img.H);
    try {
      const ctx = ctx2d(canvas, { willReadFrequently: true });
      ctx.drawImage(img.bmp, 0, 0);
      let data;
      try { data = ctx.getImageData(0, 0, img.W, img.H); } catch (_) { throw new UserError(tx("Your browser couldn't read this image's pixels. It may be too large; try a smaller one.")); }
      progress(tx("Applying filters…"), 0);
      await applyFilters(data.data, img.W, img.H, p, {
        yieldNow: tick,
        progress: (f) => progress(tx("Applying filters… {pct}%", { pct: fmtNum(Math.round(f * 100)) }), f * 0.9),
      });
      ctx.putImageData(data, 0, 0);
      progress(tx("Saving…"), 0.95);
      const blob = await encodeCanvas(canvas, type, 0.92);
      const note = tx("{size} px", { size: dims(img.W, img.H) }) + (img.info.type !== type ? " · " + tx("saved as {format}", { format: LABEL[type] }) : "");
      showResults(result, [{ blob, name: outName(img.file.name, "-filtered", type), note }]);
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
