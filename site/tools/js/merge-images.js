import { $, $$, el, icon, fmtBytes, setStatus, runJob, showResults, clearNode, announce, dropzone, friendlyError, UserError, tx, txn, fmtNum } from "./core.js?v=11";
import { validateFile, decode, newCanvas, ctx2d, scaleTo, release, encodeCanvas, outName, ACCEPT, MAX_BYTES, LABEL, dims } from "./imgcore.js?v=11";
import { thumbOf, sizeProblem, clamp } from "./imgcore3.js?v=11";

const MAX_IMAGES = 20;
const drop = $("#drop"), list = $("#files"), optsBox = $("#opts"), goRow = $("#go-row"), go = $("#go");
const summary = $("#summary"), status = $("#status"), result = $("#result"), preview = $("#preview");

let items = [];          // { id, file, info, bmp, thumb }
let nextId = 1;
let queue = Promise.resolve();
let problemShown = false;
let focusAfter = null;   // { id, which } restore focus to a moved item's button

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const num = (id, lo, hi, fallback) => {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
};

function options() {
  const fmt = radio("fmt");
  return {
    layout: radio("layout"),
    cols: num("#cols", 1, MAX_IMAGES, 2),
    align: radio("align"),
    scale: $("#scale").value,
    gap: num("#gap", 0, 10000, 0),
    bg: $("#bg").value,
    transparent: $("#transparent").checked && fmt !== "jpeg",
    fmt,
  };
}

/* ------------------------------------------------------------------ layout
   Everything is worked out in output pixels from the original sizes, so the preview is the same picture, smaller.
   Returns { W, H, boxes: [{x, y, w, h}] } where each box is where picture i is drawn. */
export function computeLayout(sizes, o) {
  const n = sizes.length;
  const pick = o.scale === "max" ? Math.max : Math.min;
  const off = (space) => (o.align === "start" ? 0 : o.align === "end" ? space : Math.floor(space / 2));
  const fit = (w, h, bw, bh) => { const k = Math.min(bw / w, bh / h); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; };
  let sz = sizes.map(([w, h]) => [w, h]);

  if (o.layout === "row" && o.scale !== "none") {
    const T = pick(...sizes.map((s) => s[1]));
    sz = sizes.map(([w, h]) => [Math.max(1, Math.round((w * T) / h)), T]);
  } else if (o.layout === "column" && o.scale !== "none") {
    const T = pick(...sizes.map((s) => s[0]));
    sz = sizes.map(([w, h]) => [T, Math.max(1, Math.round((h * T) / w))]);
  } else if (o.layout === "grid" && o.scale !== "none") {
    const cw = pick(...sizes.map((s) => s[0])), ch = pick(...sizes.map((s) => s[1]));
    sz = sizes.map(([w, h]) => fit(w, h, cw, ch));
  }

  const boxes = [];
  if (o.layout === "row") {
    const H = Math.max(...sz.map((s) => s[1]));
    let x = 0;
    sz.forEach(([w, h]) => { boxes.push({ x, y: off(H - h), w, h }); x += w + o.gap; });
    return { W: x - o.gap, H, boxes };
  }
  if (o.layout === "column") {
    const W = Math.max(...sz.map((s) => s[0]));
    let y = 0;
    sz.forEach(([w, h]) => { boxes.push({ x: off(W - w), y, w, h }); y += h + o.gap; });
    return { W, H: y - o.gap, boxes };
  }
  const cols = Math.min(o.cols, n), rows = Math.ceil(n / cols);
  const colW = Array(cols).fill(0), rowH = Array(rows).fill(0);
  sz.forEach(([w, h], i) => {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], w); rowH[r] = Math.max(rowH[r], h);
  });
  if (o.scale !== "none") {
    // every cell is the same shape: the largest box any picture was fitted into
    const cw = Math.max(...colW), ch = Math.max(...rowH);
    colW.fill(cw); rowH.fill(ch);
  }
  const xs = [], ys = [];
  let x = 0, y = 0;
  colW.forEach((w) => { xs.push(x); x += w + o.gap; });
  rowH.forEach((h) => { ys.push(y); y += h + o.gap; });
  sz.forEach(([w, h], i) => {
    const c = i % cols, r = Math.floor(i / cols);
    boxes.push({ x: xs[c] + off(colW[c] - w), y: ys[r] + off(rowH[r] - h), w, h });
  });
  return { W: x - o.gap, H: y - o.gap, boxes };
}

function currentLayout() {
  const o = options();
  return { o, lay: computeLayout(items.map((it) => [it.bmp.width, it.bmp.height]), o) };
}

function problem(lay) {
  if (items.length < 2) return tx("Add at least two images to merge.");
  const p = sizeProblem(lay.W, lay.H);
  return p ? p + " " + tx("Scale the pictures to the smallest one, use a grid, or remove some images.") : null;
}

/* ------------------------------------------------------------------ preview and summary */

function drawPreview() {
  if (items.length < 1) return;
  const { o, lay } = currentLayout();
  const k = Math.min(1, 960 / lay.W, 640 / lay.H);
  const pw = Math.max(1, Math.round(lay.W * k)), ph = Math.max(1, Math.round(lay.H * k));
  preview.width = pw; preview.height = ph;
  const ctx = ctx2d(preview);
  ctx.clearRect(0, 0, pw, ph);
  if (!o.transparent) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, pw, ph); }
  items.forEach((it, i) => {
    const b = lay.boxes[i];
    const x0 = Math.round(b.x * k), y0 = Math.round(b.y * k);
    ctx.drawImage(it.thumb, x0, y0, Math.max(1, Math.round((b.x + b.w) * k) - x0), Math.max(1, Math.round((b.y + b.h) * k) - y0));
  });
  preview.setAttribute("aria-label", tx("Preview of the merged image, {w} by {h} pixels, {n} pictures", { w: lay.W, h: lay.H, n: fmtNum(items.length) }));
}

function update() {
  const has = items.length > 0;
  list.hidden = !has; optsBox.hidden = !has; goRow.hidden = !has;
  drop.classList.toggle("is-compact", has);
  $("[data-pick-label]", drop).textContent = has ? tx("Add more images") : tx("Choose images");

  const o = options();
  $("#cols-field").hidden = o.layout !== "grid";
  $("#align-help").textContent = o.layout === "row"
    ? tx("Where shorter pictures sit in the row: top, middle or bottom.")
    : o.layout === "column" ? tx("Where narrower pictures sit in the column: left, middle or right.")
      : tx("Where smaller pictures sit in their cell: top left, middle or bottom right.");
  $("#scale-help").textContent = o.layout === "row" ? tx("Scaling gives every picture the same height.")
    : o.layout === "column" ? tx("Scaling gives every picture the same width.")
      : tx("Scaling fits every picture, uncropped, inside one cell size.");
  $("#transparent").disabled = o.fmt === "jpeg";
  $("#fmt-help").textContent = o.fmt === "jpeg" ? tx("JPEG has no transparency: gaps use the background colour. Quality 92.")
    : o.fmt === "webp" ? tx("WebP keeps transparency and is smaller than PNG for photos. Quality 92.") : tx("PNG keeps every pixel and any transparency.");

  renderList();
  if (!has) { go.disabled = true; summary.textContent = ""; return; }
  const { lay } = currentLayout();
  const why = problem(lay);
  go.disabled = !!why;
  summary.textContent = why && items.length < 2 ? why : txn(items.length, "{n} image · {size} px", "{n} images · {size} px", { size: dims(lay.W, lay.H) });
  if (why && items.length >= 2) { setStatus(status, "error", why); problemShown = true; }
  else if (problemShown) { setStatus(status, "idle"); problemShown = false; }
  drawPreview();
}

/* ------------------------------------------------------------------ the list */

function renderList() {
  list.replaceChildren(...items.map((it, i) => el("li", { "data-id": String(it.id) },
    el("span", { class: "files__idx" }, String(i + 1)),
    el("span", { class: "files__name" }, it.file.name,
      el("span", { class: "files__meta" }, `${fmtBytes(it.file.size)} · ${dims(it.bmp.width, it.bmp.height)} · ${LABEL[it.info.type]}`)),
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

function move(id, dir) {
  const i = items.findIndex((x) => x.id === id);
  const j = i + dir;
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
  if (it) { it.bmp.close(); release(it.thumb); }
  invalidateResult();
  update();
  announce(it ? tx("{name} removed.", { name: it.file.name }) : tx("Image removed."));
  if (!items.length) drop.querySelector("input").focus();
}

/* ------------------------------------------------------------------ adding files */

async function addFiles(files) {
  const errors = [];
  const room = MAX_IMAGES - items.length;
  if (room <= 0) { setStatus(status, "error", tx("You can merge up to {max} images.", { max: fmtNum(MAX_IMAGES) })); return; }
  if (files.length > room) errors.push(txn(room, "Only {n} more image fit (the limit is {max}); the rest were skipped.", "Only {n} more images fit (the limit is {max}); the rest were skipped.", { max: fmtNum(MAX_IMAGES) }));
  for (const file of files.slice(0, room)) {
    try {
      const info = await validateFile(file);
      const bmp = await decode(file);
      items.push({ id: nextId++, file, info, bmp, thumb: thumbOf(bmp, 640) });
    } catch (err) {
      console.warn(err);
      errors.push(friendlyError(err));
    }
  }
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

$$("input, select", optsBox).forEach((c) => c.addEventListener("input", () => { invalidateResult(); update(); }));
$$("input[type=radio]", optsBox).forEach((c) => c.addEventListener("change", () => { invalidateResult(); update(); }));

/* ------------------------------------------------------------------ merge */

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Merging…"),
  done: (r) => r && txn(items.length, "Merged {n} image into one {size} px picture.", "Merged {n} images into one {size} px picture.", { size: dims(r.w, r.h) }),
  job: async (progress) => {
    const { o, lay } = currentLayout();
    const why = problem(lay);
    if (why) throw new UserError(why);
    const canvas = newCanvas(lay.W, lay.H);
    try {
      const ctx = ctx2d(canvas);
      if (!o.transparent) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, lay.W, lay.H); }
      for (let i = 0; i < items.length; i++) {
        progress(tx("Placing {name} ({i} of {n})…", { name: items[i].file.name, i: fmtNum(i + 1), n: fmtNum(items.length) }), i / items.length);
        const { bmp } = items[i], b = lay.boxes[i];
        if (b.w === bmp.width && b.h === bmp.height) ctx.drawImage(bmp, b.x, b.y);
        else {
          const piece = scaleTo(bmp, bmp.width, bmp.height, b.w, b.h);
          ctx.drawImage(piece, b.x, b.y);
          release(piece);
        }
      }
      progress(tx("Saving…"), 0.95);
      const blob = await encodeCanvas(canvas, o.fmt, 0.92, o.bg);
      showResults(result, [{ blob, name: outName("merged", "", o.fmt), note: tx("{size} px", { size: dims(lay.W, lay.H) }) }]);
    } finally {
      release(canvas);
    }
    return { w: lay.W, h: lay.H };
  },
}));

$("#clear").addEventListener("click", () => {
  items.forEach((it) => { it.bmp.close(); release(it.thumb); });
  items = [];
  invalidateResult();
  problemShown = false;
  setStatus(status, "idle");
  update();
  drop.querySelector("input").focus();
});

update();
