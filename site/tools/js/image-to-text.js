import { $, el, fmtBytes, dropzone, setStatus, clearNode, baseName, announce, UserError, copyText, textBlob, blobLink, tx, txn, fmtNum } from "./core.js?v=11";
import { serverInit, runServerJob, serverJob, blobToBase64, checkSize, available, MAX_FILE_BYTES } from "./servercore.js?v=11";

// The image is prepared here first: turned upright, scaled so text is a size the OCR engine reads well (longest side
// 1,600 to 3,200 pixels) and saved as PNG (or JPEG for large photos). Only that copy is sent.
const MIN_SIDE = 1600, MAX_SIDE = 3200, PNG_MAX_PX = 6_000_000;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
let file = null, prepared = null;

dropzone(drop, {
  accept: ["image/*"], typeLabel: "image", paste: true,
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    clearNode(result); result.hidden = true;
    if (f.size > 4 * MAX_FILE_BYTES) {
      setStatus(status, "error", tx("\"{name}\" is {size}, too large to prepare here. Use an image under 40 MB.", { name: f.name, size: fmtBytes(f.size) }));
      return;
    }
    setStatus(status, "working", tx("Preparing the image…"));
    try {
      prepared = await prepare(f);
      checkSize(prepared.blob);
    } catch (e) {
      prepared = null;
      setStatus(status, "error", e instanceof UserError ? e.message : tx("\"{name}\" couldn't be opened as an image. Use PNG, JPEG or WebP.", { name: f.name }));
      return;
    }
    file = f;
    $("#fname").textContent = f.name;
    $("#finfo").textContent = tx("{size} · {w} × {h} px", { size: fmtBytes(f.size), w: prepared.w, h: prepared.h });
    const pv = $("#preview");
    pv.textContent = "";
    pv.append(prepared.canvas);
    work.hidden = false;
    drop.classList.add("is-compact");
    $("[data-pick-label]", drop).textContent = tx("Choose another image");
    setStatus(status, "idle");
    update();
    announce(tx("{name} ready.", { name: f.name }));
  },
});

async function prepare(f) {
  let bmp;
  try { bmp = await createImageBitmap(f, { imageOrientation: "from-image" }); } catch (_) {
    throw new UserError(tx("\"{name}\" couldn't be opened as an image. Use PNG, JPEG or WebP.", { name: f.name }));
  }
  const ow = bmp.width, oh = bmp.height;
  const long = Math.max(ow, oh);
  const scale = long > MAX_SIDE ? MAX_SIDE / long : long < MIN_SIDE ? Math.min(3, MIN_SIDE / long) : 1;
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";                     // transparent parts become white paper
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const toBlob = (type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), type, q));
  let blob = w * h <= PNG_MAX_PX ? await toBlob("image/png") : null;
  if (!blob || blob.size > MAX_FILE_BYTES) blob = await toBlob("image/jpeg", 0.92);
  return { blob, w: ow, h: oh, canvas: c };
}

function update() { go.disabled = !prepared || !available(); }

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    if (!prepared) throw new UserError(tx("Choose an image first."));
    phase(tx("Reading the image…"));
    const b64 = await blobToBase64(prepared.blob);
    const j = await runServerJob("/image/ocr", { image_base64: b64 }, { onPhase: phase });
    const text = (j.text || "").trim();
    clearNode(result);
    result.hidden = false;
    if (!text) {
      result.append(el("div", { class: "result" }, el("div", { class: "result__head" },
        el("p", { class: "result__title" }, tx("No text found"))),
        el("p", { class: "result__note" }, tx("The OCR engine didn't find readable text. Try a sharper or larger image, with the text the right way up."))));
      return { msg: tx("Done, but no text was found.") };
    }
    const area = el("textarea", { class: "ocr-out", id: "out", spellcheck: "false", "aria-label": tx("Extracted text") });
    area.value = text;
    const copy = el("button", { class: "btn btn--primary", type: "button" }, tx("Copy text"));
    copy.addEventListener("click", () => copyText(area.value, copy));
    const words = text.split(/\s+/).filter(Boolean).length;
    result.append(el("div", { class: "result" },
      el("div", { class: "result__head" },
        el("p", { class: "result__title" }, tx("Extracted text"), el("span", { class: "result__size" }, tx("{words} · {chars}", { words: txn(words, "{n} word", "{n} words"), chars: txn(text.length, "{n} character", "{n} characters") }))),
        el("div", { class: "actions" }, copy, blobLink(textBlob(text), baseName(file.name) + ".txt", tx("Download .txt"), "btn btn--sm"))),
      el("div", { class: "ocr-out__wrap" }, area),
      el("p", { class: "result__note" }, (j.text_truncated ? tx("The text was long and has been shortened.") + " " : "")
        + tx("OCR can misread characters, so check names and numbers before you rely on them. You can edit the text above before copying."))));
    copy.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    announce(txn(words, "Text extracted: {n} word.", "Text extracted: {n} words.", { n: fmtNum(words, { useGrouping: false }) }));
    return { msg: txn(words, "Done. Found {n} word.", "Done. Found {n} words.") };
  },
}));

$("#clear").addEventListener("click", () => {
  file = prepared = null;
  work.hidden = true; clearNode(result); result.hidden = true;
  $("#preview").textContent = "";
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose an image");
  drop.querySelector("input").focus();
});

serverInit().then(update);
