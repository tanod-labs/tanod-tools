// Image to Base64: reads the file in the browser, labels it with the type found in its bytes and wraps the
// Base64 in the snippet the visitor picks. Nothing is uploaded.
import { $, fmtBytes, fmtNum, dropzone, setStatus, announce, friendlyError, UserError, copyText, textBlob, baseName, tx, txn } from "./core.js?v=11";
import { sniffType, previewInto, dims } from "./imgcore.js?v=11";

const MAX_BYTES = 10 * 1024 * 1024;
const BIG = 100 * 1024;
const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml" };
const LABEL = { png: "PNG", jpeg: "JPEG", webp: "WebP", gif: "GIF", bmp: "BMP", avif: "AVIF", svg: "SVG" };

const drop = $("#drop"), work = $("#work"), status = $("#status"), out = $("#out"), cv = $("#cv");
const pick = drop.querySelector("[data-pick-label]");
let cur = null; // { file, type, b64, w, h }

function isSvg(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^﻿/, "");
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function svgImage(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  return img.decode().then(() => img);
}

export function snippet(fmt, mime, b64, { name = "image", w, h } = {}) {
  const url = `data:${mime};base64,${b64}`;
  switch (fmt) {
    case "raw": return b64;
    case "css": return `background-image: url("${url}");`;
    case "html": return `<img src="${url}"${w ? ` width="${w}" height="${h}"` : ""} alt="">`;
    case "md": return `![${name.replace(/[\[\]\\]/g, "")}](${url})`;
    default: return url;
  }
}

const fmt = () => document.querySelector('input[name="fmt"]:checked').value;

function render() {
  if (!cur) return;
  const text = snippet(fmt(), MIME[cur.type], cur.b64, { name: baseName(cur.file.name), w: cur.w, h: cur.h });
  out.value = text;
  $("#out-len").textContent = txn(text.length, "{n} character", "{n} characters");
}

async function open(file) {
  setStatus(status, "idle");
  try {
    if (file.size > MAX_BYTES) throw new UserError(tx("\"{name}\" is {size}; the limit is {limit}.", { name: file.name, size: fmtBytes(file.size), limit: fmtBytes(MAX_BYTES) }));
    if (!file.size) throw new UserError(tx("\"{name}\" is empty.", { name: file.name }));
    const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const type = sniffType(bytes) || (isSvg(bytes) ? "svg" : null);
    if (!type) throw new UserError(tx("\"{name}\" doesn't look like a PNG, JPEG, WebP, GIF, BMP, AVIF or SVG image. It may be damaged or have the wrong extension.", { name: file.name }));
    const url = await readDataUrl(file);
    const b64 = url.slice(url.indexOf(",") + 1);
    cur = { file, type, b64, w: null, h: null };
    // Preview on a canvas (this site's security policy allows data: images but no blob: images).
    let src = null;
    try {
      src = type === "svg" ? await svgImage(`data:image/svg+xml;base64,${b64}`) : await createImageBitmap(file);
      const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      if (w && h) {
        cur.w = w; cur.h = h;
        const k = Math.min(1, 480 / w, 320 / h);
        previewInto(cv, src, w, h, Math.max(1, w * k * 2), Math.max(1, h * k * 2));
        cv.style.width = Math.max(1, Math.round(w * k)) + "px";
      }
    } catch (err) {
      console.warn(err);
      cv.width = cv.height = 0;
    } finally {
      if (src && src.close) src.close();
    }
    $("#s-type").textContent = LABEL[type];
    $("#s-dims").textContent = cur.w ? dims(cur.w, cur.h) : tx("n/a");
    $("#s-file").textContent = fmtBytes(file.size);
    $("#s-b64").textContent = fmtBytes(b64.length);
    const big = $("#big");
    big.hidden = file.size <= BIG;
    big.textContent = big.hidden ? "" : tx("This image is {size}, so its Base64 is {b64size}. Inlining something this large makes every page or stylesheet that contains it slower to load and impossible to cache separately; a normal image file is usually better.", { size: fmtBytes(file.size), b64size: fmtBytes(b64.length) });
    work.hidden = false;
    drop.classList.add("is-compact");
    pick.textContent = tx("Choose another image");
    render();
    announce(tx("Encoded {name}: {n} Base64 characters.", { name: file.name, n: fmtNum(b64.length) }));
  } catch (err) {
    console.warn(err);
    setStatus(status, "error", friendlyError(err));
  }
}

dropzone(drop, {
  accept: Object.values(MIME).concat([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".svg"]),
  multiple: false, typeLabel: "supported image", paste: true,
  onError: (msg) => setStatus(status, "error", msg),
  onFiles: ([file]) => open(file),
});

document.querySelectorAll('input[name="fmt"]').forEach((r) => r.addEventListener("change", render));
$("#copy").addEventListener("click", () => copyText(out.value, $("#copy")));
$("#dl").addEventListener("click", () => {
  const u = URL.createObjectURL(textBlob(out.value));
  const a = document.createElement("a");
  a.href = u; a.download = baseName(cur ? cur.file.name : "image") + "-base64.txt";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
});
$("#clear").addEventListener("click", () => {
  cur = null; out.value = "";
  work.hidden = true;
  drop.classList.remove("is-compact");
  pick.textContent = tx("Choose an image");
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});
