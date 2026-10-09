// GIF maker: turns several images into an animated GIF. The frame order, delay, size and fit maths are in gifcore.js
// (no DOM); the GIF itself is written by the vendored gifenc encoder, loaded when you press Create GIF. Pictures are
// decoded one at a time while the GIF is built, so many large photos do not have to fit in memory together.
// Nothing is uploaded.
import { $, $$, el, icon, fmtBytes, setStatus, runJob, showResults, clearNode, announce, dropzone, friendlyError, UserError, tx, txn, fmtNum } from "./core.js?v=11";
import { validateFile, decode, newCanvas, ctx2d, scaleTo, release, ACCEPT, MAX_BYTES, LABEL, dims } from "./imgcore.js?v=11";
import { delayMs, frameSequence, outputSize, fitRect, overBudget, totalDuration, encodeGif, MAX_FRAMES, MIN_WIDTH, MAX_WIDTH } from "./gifcore.js?v=11";

const drop = $("#drop"), list = $("#files"), optsBox = $("#opts"), goRow = $("#go-row"), go = $("#go");
const summary = $("#summary"), status = $("#status"), result = $("#result"), view = $("#gm-view"), playBtn = $("#gm-play");
const delayIn = $("#gm-delay"), widthIn = $("#gm-width");
const PREVIEW_W = 480;
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));   // unlike an animation frame, a timer still fires in a background tab

let items = [];            // { id, file, info, w, h, thumb } in frame order
let nextId = 1;
let queue = Promise.resolve();
let widthTouched = false;
let focusAfter = null;     // restore focus to a moved item's button
let frames = [], seq = [], pos = 0, timer = 0;
let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let previewTimer = 0, problemShown = false;

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function options() {
  const w = parseInt(widthIn.value, 10);
  return {
    delay: delayMs(delayIn.value),
    width: Number.isFinite(w) ? clamp(w, MIN_WIDTH, MAX_WIDTH) : MIN_WIDTH,
    fit: radio("gm-fit"),
    bg: $("#gm-bg").value,
    loop: radio("gm-loop"),
    colors: Number($("#gm-colors").value),
    pingpong: $("#gm-pingpong").checked,
  };
}

const outSize = () => outputSize(items[0].w, items[0].h, options().width);

function problem() {
  if (items.length < 2) return tx("Add at least two images to make a GIF.");
  const { w, h } = outSize(), n = frameSequence(items.length, options().pingpong).length;
  if (overBudget(w, h, n)) return tx("{n} frames of {size} px is more than this tool builds. Use a smaller width or fewer images.", { n: fmtNum(n), size: dims(w, h) });
  return null;
}

/* Draw a picture of sw x sh into a W x H frame the way the fit option says, on the background colour. The picture is
   scaled in halving steps first, which keeps big photos clean when they shrink to GIF size. */
function paint(ctx, src, sw, sh, W, H, fit, bg) {
  const r = fitRect(sw, sh, W, H, fit);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const kx = r.dWidth / r.sWidth, ky = r.dHeight / r.sHeight;
  const scaled = scaleTo(src, sw, sh, Math.max(1, Math.round(sw * kx)), Math.max(1, Math.round(sh * ky)));
  ctx.drawImage(scaled, r.sx * kx, r.sy * ky, r.dWidth, r.dHeight, r.dx, r.dy, r.dWidth, r.dHeight);
  release(scaled);
}

/* ------------------------------------------------------------------ preview */

function show(i) {
  if (!frames.length) return;
  view.getContext("2d").drawImage(frames[seq[i % seq.length]], 0, 0);
}

function step() {
  clearTimeout(timer);
  if (!frames.length) return;
  show(pos);
  pos = (pos + 1) % seq.length;
  if (playing && seq.length > 1) timer = setTimeout(step, options().delay);
}

function buildPreview() {
  clearTimeout(timer);
  frames.forEach(release);
  frames = [];
  if (!items.length) return;
  const o = options(), full = outSize();
  const pw = Math.min(full.w, PREVIEW_W), ph = Math.max(1, Math.round((full.h * pw) / full.w));
  view.width = pw; view.height = ph;
  const count = frameSequence(items.length, o.pingpong).length;
  view.setAttribute("aria-label", txn(count, "Preview of the animation, {size} px, {n} frame", "Preview of the animation, {size} px, {n} frames", { size: dims(full.w, full.h) }));
  frames = items.map((it) => {
    const c = newCanvas(pw, ph);
    paint(ctx2d(c), it.thumb, it.thumb.width, it.thumb.height, pw, ph, o.fit, o.bg);
    return c;
  });
  seq = frameSequence(items.length, o.pingpong);
  pos = 0;
  step();
}

const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(buildPreview, 120); };

function syncPlay() {
  playBtn.textContent = playing ? tx("Pause preview") : tx("Play preview");
}
playBtn.addEventListener("click", () => { playing = !playing; syncPlay(); if (playing) step(); else clearTimeout(timer); });

/* ------------------------------------------------------------------ the list */

function renderList() {
  list.replaceChildren(...items.map((it, i) => el("li", { "data-id": String(it.id) },
    el("span", { class: "files__idx" }, String(i + 1)),
    el("span", { class: "files__thumb", "aria-hidden": "true" }, it.mini),
    el("span", { class: "files__name" }, it.file.name,
      el("span", { class: "files__meta" }, `${fmtBytes(it.file.size)} · ${dims(it.w, it.h)} · ${LABEL[it.info.type]}`)),
    el("span", { class: "files__btns" },
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-act": "up", "aria-label": tx("Move {name} up", { name: it.file.name }), disabled: i === 0 ? "" : null, onclick: () => move(it.id, -1) }, icon("i-arrow-up")),
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-act": "down", "aria-label": tx("Move {name} down", { name: it.file.name }), disabled: i === items.length - 1 ? "" : null, onclick: () => move(it.id, 1) }, icon("i-arrow-down")),
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-act": "remove", "aria-label": tx("Remove {name}", { name: it.file.name }), onclick: () => remove(it.id) }, icon("i-x"))))));
  if (focusAfter) {
    const li = list.querySelector(`li[data-id="${focusAfter.id}"]`);
    let b = li && li.querySelector(`[data-act="${focusAfter.which}"]`);
    if (b && b.disabled) b = li.querySelector(`[data-act="${focusAfter.which === "up" ? "down" : "up"}"]`);
    if (b) b.focus();
    focusAfter = null;
  }
}

function invalidateResult() { clearNode(result); result.hidden = true; }

function update() {
  const has = items.length > 0;
  list.hidden = !has; optsBox.hidden = !has; goRow.hidden = !has;
  drop.classList.toggle("is-compact", has);
  $("[data-pick-label]", drop).textContent = has ? tx("Add more images") : tx("Choose images");
  renderList();
  if (!has) { go.disabled = true; summary.textContent = ""; frames.forEach(release); frames = []; clearTimeout(timer); return; }
  const why = problem();
  go.disabled = !!why;
  const full = outSize();
  $("#gm-size").textContent = tx("{size} px", { size: dims(full.w, full.h) });
  summary.textContent = why && items.length < 2 ? why : txn(items.length, "{n} image · {size} px", "{n} images · {size} px", { size: dims(full.w, full.h) });
  if (why && items.length >= 2) { setStatus(status, "error", why); problemShown = true; }
  else if (problemShown) { setStatus(status, "idle"); problemShown = false; }
  $("#gm-bg-field").hidden = options().fit === "stretch";
  schedulePreview();
}

function move(id, dir) {
  const i = items.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  focusAfter = { id, which: dir < 0 ? "up" : "down" };
  invalidateResult();
  update();
  announce(tx("{name} is now number {i} of {n}.", { name: items[j].file.name, i: fmtNum(j + 1), n: fmtNum(items.length) }));
}

function remove(id) {
  const it = items.find((x) => x.id === id);
  items = items.filter((x) => x.id !== id);
  if (it) { release(it.thumb); release(it.mini); }
  invalidateResult();
  update();
  announce(it ? tx("{name} removed.", { name: it.file.name }) : tx("Image removed."));
  if (!items.length) drop.querySelector("input").focus();
}

/* ------------------------------------------------------------------ adding files */

async function addFiles(files) {
  const errors = [];
  const room = MAX_FRAMES - items.length;
  if (room <= 0) { setStatus(status, "error", tx("You can use up to {max} images.", { max: fmtNum(MAX_FRAMES) })); return; }
  if (files.length > room) errors.push(txn(room, "Only {n} more image fit (the limit is {max}); the rest were skipped.", "Only {n} more images fit (the limit is {max}); the rest were skipped.", { max: fmtNum(MAX_FRAMES) }));
  for (const file of files.slice(0, room)) {
    try {
      const info = await validateFile(file);
      const bmp = await decode(file);
      const k = Math.min(1, 640 / bmp.width, 640 / bmp.height);
      const thumb = scaleTo(bmp, bmp.width, bmp.height, Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      const m = Math.min(1, 52 / Math.max(thumb.width, thumb.height));
      const mini = scaleTo(thumb, thumb.width, thumb.height, Math.max(1, Math.round(thumb.width * m)), Math.max(1, Math.round(thumb.height * m)));
      items.push({ id: nextId++, file, info, w: bmp.width, h: bmp.height, thumb, mini });
      bmp.close();
    } catch (err) {
      console.warn(err);
      errors.push(friendlyError(err));
    }
  }
  if (items.length && !widthTouched) widthIn.value = String(Math.max(MIN_WIDTH, Math.min(PREVIEW_W, items[0].w)));
  invalidateResult();
  problemShown = false;
  setStatus(status, "idle");
  update();
  if (errors.length) { setStatus(status, "error", errors.join(" ")); problemShown = false; }
  announce(txn(items.length, "{n} image ready.", "{n} images ready."));
}

dropzone(drop, {
  accept: ACCEPT, multiple: true, maxFileBytes: MAX_BYTES, typeLabel: "supported image",
  onError: (msg) => setStatus(status, "error", msg),
  onFiles: (files) => { queue = queue.then(() => addFiles(files)); },
});

for (const c of $$("input, select", optsBox)) {
  const on = () => { if (c === widthIn) widthTouched = true; invalidateResult(); update(); };
  c.addEventListener("input", on);
  c.addEventListener("change", on);
}

/* ------------------------------------------------------------------ make the GIF */

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Making the GIF…"),
  done: (r) => r && txn(r.frames, "Made a GIF from {n} frame.", "Made a GIF from {n} frames."),
  job: async (progress) => {
    const why = problem();
    if (why) throw new UserError(why);
    const o = options(), { w, h } = outSize();
    const order = frameSequence(items.length, o.pingpong);
    const enc = await import("/tools/vendor/gifenc/gifenc.esm.js");
    const frame = newCanvas(w, h);
    const fctx = ctx2d(frame, { willReadFrequently: true });
    let bytes;
    try {
      bytes = await encodeGif({
        count: order.length, width: w, height: h, repeat: o.loop === "once" ? -1 : 0, colors: o.colors,
        delayAt: () => o.delay,
        async getFrame(i) {
          const it = items[order[i]];
          const bmp = await decode(it.file);
          try { paint(fctx, bmp, bmp.width, bmp.height, w, h, o.fit, o.bg); } finally { bmp.close(); }
          return fctx.getImageData(0, 0, w, h).data;
        },
        async onFrame(i) {
          progress(tx("Encoding frame {i} of {n}…", { i: fmtNum(i + 1), n: fmtNum(order.length) }), (i + 1) / order.length);
          await nextTurn();
        },
      }, enc);
    } finally {
      release(frame);
    }
    const blob = new Blob([bytes], { type: "image/gif" });
    const seconds = fmtNum(totalDuration(order.map(() => o.delay)) / 1000, { maximumFractionDigits: 1 });
    showResults(result, [{
      blob, name: "animation.gif",
      note: txn(order.length, "{size} px · {n} frame · {seconds} s", "{size} px · {n} frames · {seconds} s", { size: dims(w, h), seconds }),
    }]);
    if (blob.size <= 12 * 1024 * 1024) {
      const url = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(rd.result);
        rd.onerror = () => reject(rd.error);
        rd.readAsDataURL(blob);
      });
      const box = result.querySelector(".result");
      if (box) box.append(el("div", { class: "preview" }, el("img", { src: url, alt: tx("The finished animated GIF"), width: String(w), height: String(h) })));
    }
    return { frames: order.length };
  },
}));

$("#clear").addEventListener("click", () => {
  items.forEach((it) => { release(it.thumb); release(it.mini); });
  items = [];
  invalidateResult();
  problemShown = false;
  setStatus(status, "idle");
  update();
  drop.querySelector("input").focus();
});

syncPlay();
update();
