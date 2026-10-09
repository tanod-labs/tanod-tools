import { $, fmtBytes, tx, txn } from "./core.js?v=11";
import { batchTool, decode, scaleTo, release, encodeCanvas, keepType, outName, LABEL, dims, UserError } from "./imgcore.js?v=11";

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const wIn = $("#width"), hIn = $("#height"), lock = $("#lock"), pct = $("#percent");
const panePx = $("#pane-px"), panePct = $("#pane-pct");
let driver = "w";
let refId = null;
let tool;

const intOf = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

function ref() {
  const it = tool && tool.items[0];
  return it && it.info.width ? it.info : null;
}

function target(info) {
  const w0 = info.width, h0 = info.height;
  if (radio("mode") === "percent") {
    const p = Number(pct.value);
    return { w: Math.max(1, Math.round(w0 * p / 100)), h: Math.max(1, Math.round(h0 * p / 100)) };
  }
  const W = intOf(wIn.value), H = intOf(hIn.value);
  if (!lock.checked) return { w: W, h: H };
  if (driver === "w") return { w: W, h: Math.max(1, Math.round(h0 * W / w0)) };
  return { w: Math.max(1, Math.round(w0 * H / h0)), h: H };
}

function syncMode() {
  const px = radio("mode") === "pixels";
  panePx.hidden = !px;
  panePct.hidden = px;
  tool.render();
}

wIn.addEventListener("input", () => {
  driver = "w";
  const r = ref();
  if (lock.checked && r && intOf(wIn.value) > 0) hIn.value = Math.max(1, Math.round(intOf(wIn.value) * r.height / r.width));
  tool.render();
});
hIn.addEventListener("input", () => {
  driver = "h";
  const r = ref();
  if (lock.checked && r && intOf(hIn.value) > 0) wIn.value = Math.max(1, Math.round(intOf(hIn.value) * r.width / r.height));
  tool.render();
});
lock.addEventListener("change", () => {
  const r = ref();
  if (lock.checked && r) {
    if (driver === "w") hIn.value = Math.max(1, Math.round(intOf(wIn.value) * r.height / r.width));
    else wIn.value = Math.max(1, Math.round(intOf(hIn.value) * r.width / r.height));
  }
  tool.render();
});
pct.addEventListener("input", () => tool.render());
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", syncMode));

tool = batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Resizing"), zipName: "resized-images.zip",
  async analyse(item) {
    if (item.info.width) return;
    const bmp = await decode(item.file);
    item.info.width = bmp.width; item.info.height = bmp.height;
    bmp.close();
  },
  meta: (it) => `${fmtBytes(it.file.size)} · ${dims(it.info.width, it.info.height)} · ${LABEL[it.info.type]}`,
  blocked(items) {
    if (radio("mode") === "percent") {
      const p = Number(pct.value);
      if (!(p >= 1 && p <= 400)) return tx("Enter a percentage from 1 to 400.");
      return null;
    }
    if (!(intOf(wIn.value) >= 1 && intOf(hIn.value) >= 1)) return tx("Enter a width and a height in pixels.");
    return null;
  },
  summaryText(items) {
    const r = ref();
    if (items.length === 1 && r) { const t = target(r); return `${dims(r.width, r.height)} → ${dims(t.w, t.h)}`; }
    return txn(items.length, "{n} image", "{n} images");
  },
  onChange(items) {
    const r = ref();
    const id = items[0] ? items[0].id : null;
    if (id !== refId) {
      refId = id;
      if (r) { wIn.value = r.width; hIn.value = r.height; driver = "w"; }
    }
  },
  async process(item) {
    const info = item.info;
    const t = target(info);
    if (t.w > 4 * info.width || t.h > 4 * info.height) {
      throw new UserError(tx("{target} is more than 4 times the original size ({original}). Choose a smaller size.", { target: dims(t.w, t.h), original: dims(info.width, info.height) }));
    }
    const fmt = radio("fmt");
    const type = fmt === "keep" ? keepType(info.type) : fmt;
    const bmp = await decode(item.file);
    const canvas = scaleTo(bmp, bmp.width, bmp.height, t.w, t.h);
    bmp.close();
    try {
      const blob = await encodeCanvas(canvas, type, 0.92);
      return { blob, name: outName(item.file.name, `-${t.w}x${t.h}`, type), note: `${dims(info.width, info.height)} → ${dims(t.w, t.h)}` };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => outputs.length === 1 ? tx("Resized. {note}.", { note: outputs[0].note }) : txn(outputs.length, "Resized {n} image.", "Resized {n} images."),
});
