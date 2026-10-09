// Tanod Tools shared core. Everything here runs in the browser; nothing is sent anywhere.
import { tx, txn, fmtNum as fmtLocal, EN } from "./i18n.js?v=11";

export { tx, txn, txf, LANG, LOCALE, EN, parseNum, dateFormat, listText } from "./i18n.js?v=11";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* An inline reference to a symbol in the page's sprite. */
export function icon(id, cls = "mark") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#" + id);
  svg.append(use);
  return svg;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return EN ? n + " B" : tx("{n} B", { n: fmtLocal(n) });
  const units = EN ? ["KB", "MB", "GB"] : [tx("KB"), tx("MB"), tx("GB")];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const num = EN ? v.toFixed(digits) : fmtLocal(v, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  return num + " " + units[i];
}

/* English only, kept for old callers: "1 page", "3 pages". New code uses txn(n, "{n} page", "{n} pages"). */
export function plural(n, one, many = one + "s") { return `${fmtNum(n)} ${n === 1 ? one : many}`; }

/* A number for display, grouped in the page's language (en-US on English pages). */
export const fmtNum = (n, opts) => fmtLocal(Number(n), opts);

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Yield to the browser so a status update paints before heavy synchronous work. */
export const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ------------------------------------------------------------------ names */

export function baseName(name) {
  const n = String(name || "file").replace(/[\\/]+/g, "_");
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(0, i) : n;
}
export function extOf(name) {
  const i = String(name).lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}
export function withExt(name, ext) { return baseName(name) + "." + ext; }

/* ------------------------------------------------------------------ live region */

let live;
export function announce(msg) {
  if (!live) {
    live = el("p", { class: "visually-hidden", "aria-live": "polite" });
    document.body.append(live);
  }
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 30);
}

/* ------------------------------------------------------------------ status line
   Markup: <div class="status" role="status" hidden></div>
   States: idle (hidden), working, done, error. Progress 0..1 or null for indeterminate. */

const STATUS_ICON = { done: "i-check", error: "i-alert", working: "i-clock" };

export function setStatus(node, state, msg = "", progress = null) {
  if (!node) return;
  if (state === "idle") { node.hidden = true; node.dataset.state = "idle"; node.textContent = ""; return; }
  node.hidden = false;
  node.dataset.state = state;
  let body = node.querySelector(".status__body");
  if (!body || node.dataset.iconFor !== state) {
    node.textContent = "";
    node.append(icon(STATUS_ICON[state] || "i-clock"));
    body = el("div", { class: "status__body" },
      el("span", { class: "status__text" }),
      el("span", { class: "status__bar" }, el("i")));
    node.append(body);
    node.dataset.iconFor = state;
  }
  body.querySelector(".status__text").textContent = msg;
  const bar = body.querySelector(".status__bar");
  if (state === "working") {
    bar.classList.toggle("is-indeterminate", progress === null);
    bar.firstChild.style.width = progress === null ? "" : Math.round(Math.max(0, Math.min(1, progress)) * 100) + "%";
  }
}

/* A small helper for tools: run an async job with working/done/error states and a busy button. */
export async function runJob({ status, button, working = tx("Working…"), done, job }) {
  if (button) button.disabled = true;
  setStatus(status, "working", working);
  await tick();
  try {
    const result = await job((msg, p = null) => setStatus(status, "working", msg || working, p));
    const msg = typeof done === "function" ? done(result) : done;
    if (msg) setStatus(status, "done", msg); else setStatus(status, "idle");
    return result;
  } catch (err) {
    console.warn(err);
    setStatus(status, "error", friendlyError(err));
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export class UserError extends Error {}

export function friendlyError(err) {
  if (err instanceof UserError) return err.message;
  const m = String((err && err.message) || err || "");
  if (/encrypt|password/i.test(m)) return tx("This PDF is password-protected or encrypted, so it can't be changed here. Remove the password first, then try again.");
  if (/Invalid PDF|No PDF header|parse|xref/i.test(m)) return tx("This file couldn't be read as a PDF. It may be damaged or not really a PDF.");
  if (/memory|allocation|Array buffer/i.test(m)) return tx("Your browser ran out of memory. Try fewer or smaller files, or close other tabs.");
  if (/decode|source image|InvalidStateError/i.test(m)) return tx("This image couldn't be opened. Your browser may not support its format.");
  return tx("Something went wrong: {error}. Nothing was uploaded; try again or use a different file.", { error: m || tx("unknown error") });
}

/* ------------------------------------------------------------------ file intake */

function matches(file, accept) {
  if (!accept || !accept.length) return true;
  const type = (file.type || "").toLowerCase();
  const ext = "." + extOf(file.name);
  return accept.some((a) => {
    a = a.toLowerCase();
    if (a.startsWith(".")) return ext === a;
    if (a.endsWith("/*")) return type.startsWith(a.slice(0, -1));
    return type === a;
  });
}

/* "x.doc" isn't a PDF file. Each typeLabel a tool passes to dropzone has its own sentence, so it reads naturally
   in every language. */
function notOfType(label, bad) {
  const name = bad[0].name, n = bad.length;
  if (EN) return n === 1 ? `"${name}" isn't a ${label} file.` : `${n} files weren't ${label} files.`;
  switch (label) {
    case "PDF": return n === 1 ? tx("\"{name}\" isn't a PDF file.", { name }) : txn(n, "{n} file wasn't a PDF file.", "{n} files weren't PDF files.");
    case "image": return n === 1 ? tx("\"{name}\" isn't an image file.", { name }) : txn(n, "{n} file wasn't an image file.", "{n} files weren't image files.");
    case "supported image": return n === 1 ? tx("\"{name}\" isn't a supported image file.", { name }) : txn(n, "{n} file wasn't a supported image file.", "{n} files weren't supported image files.");
    case "vector (SVG)": return n === 1 ? tx("\"{name}\" isn't an SVG file.", { name }) : txn(n, "{n} file wasn't an SVG file.", "{n} files weren't SVG files.");
    case "text": return n === 1 ? tx("\"{name}\" isn't a text file.", { name }) : txn(n, "{n} file wasn't a text file.", "{n} files weren't text files.");
    case "CSV": return n === 1 ? tx("\"{name}\" isn't a CSV file.", { name }) : txn(n, "{n} file wasn't a CSV file.", "{n} files weren't CSV files.");
    case "JSON": return n === 1 ? tx("\"{name}\" isn't a JSON file.", { name }) : txn(n, "{n} file wasn't a JSON file.", "{n} files weren't JSON files.");
    case "HTML": return n === 1 ? tx("\"{name}\" isn't an HTML file.", { name }) : txn(n, "{n} file wasn't an HTML file.", "{n} files weren't HTML files.");
    default: return n === 1 ? tx("\"{name}\" can't be opened here.", { name }) : txn(n, "{n} file can't be opened here.", "{n} files can't be opened here.");
  }
}

/* Wire a drop slot. el: the .drop element containing an <input type=file>.
   opts: accept (array of mime types / .ext), multiple, maxFileBytes, maxTotalBytes, maxFiles,
         typeLabel ("PDF"), onFiles(files), onError(msg), pageDrop (accept drops anywhere, default true),
         paste (accept pasted files, default false). */
export function dropzone(zone, opts) {
  const input = zone.querySelector('input[type="file"]');
  const o = Object.assign({ multiple: false, pageDrop: true, paste: false, typeLabel: "file" }, opts);
  let depth = 0;

  function take(list) {
    let files = Array.from(list || []);
    if (!files.length) return;
    const bad = files.filter((f) => !matches(f, o.accept));
    files = files.filter((f) => matches(f, o.accept));
    if (!o.multiple) files = files.slice(0, 1);
    const errors = [];
    if (bad.length) errors.push(notOfType(o.typeLabel, bad));
    if (o.maxFileBytes) {
      const big = files.filter((f) => f.size > o.maxFileBytes);
      if (big.length) errors.push(tx("\"{name}\" is {size}; the limit is {limit} per file.", { name: big[0].name, size: fmtBytes(big[0].size), limit: fmtBytes(o.maxFileBytes) }));
      files = files.filter((f) => f.size <= o.maxFileBytes);
    }
    if (o.maxFiles && files.length > o.maxFiles) {
      errors.push(txn(o.maxFiles, "Only the first file was added.", "Only the first {n} files were added."));
      files = files.slice(0, o.maxFiles);
    }
    if (errors.length && o.onError) o.onError(errors.join(" "));
    if (files.length) o.onFiles(files);
  }

  if (input) {
    input.addEventListener("change", () => { take(input.files); input.value = ""; });
  }
  const target = o.pageDrop ? document.documentElement : zone;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  target.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    zone.classList.add("is-over");
  });
  target.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  target.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("is-over");
  });
  target.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove("is-over");
    take(e.dataTransfer.files);
  });
  if (o.paste) {
    document.addEventListener("paste", (e) => {
      const t = e.target;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "file"))) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); take(files); }
    });
  }
  return { take, open: () => input && input.click() };
}

export const readBytes = (file) => file.arrayBuffer().then((b) => new Uint8Array(b));

/* ------------------------------------------------------------------ downloads */

const urls = new WeakMap();

export function blobLink(blob, filename, label, cls = "btn btn--primary btn--sm") {
  const url = URL.createObjectURL(blob);
  const a = el("a", { class: cls, href: url, download: filename }, icon("i-download"), label || tx("Download"));
  urls.set(a, url);
  return a;
}

/* Revoke object URLs held by links inside a container, then empty it. */
export function clearNode(node) {
  if (!node) return;
  node.querySelectorAll("a[download]").forEach((a) => {
    const u = urls.get(a);
    if (u) URL.revokeObjectURL(u);
  });
  node.textContent = "";
}

/* Render a result block: outputs = [{blob, name, note?}].
   With more than one output, a "Download all (.zip)" button is added. */
export function showResults(container, outputs, { title, zipName, note, extra } = {}) {
  clearNode(container);
  container.hidden = false;
  const single = outputs.length === 1;
  const head = el("div", { class: "result__head" },
    el("p", { class: "result__title" }, title || (single ? outputs[0].name : txn(outputs.length, "{n} file is ready", "{n} files are ready")),
      single ? el("span", { class: "result__size" }, fmtBytes(outputs[0].blob.size) + (outputs[0].note ? " · " + outputs[0].note : "")) : null));
  const btns = el("div", { class: "actions" });
  if (outputs.length === 1) {
    btns.append(blobLink(outputs[0].blob, outputs[0].name, tx("Download"), "btn btn--primary"));
  } else if (outputs.length > 1) {
    const zipBlob = zipFiles(outputs.map((o) => ({ name: o.name, data: o.bytes || o.blob })));
    btns.append(zipBlob instanceof Promise ? el("span") : blobLink(zipBlob, zipName || "files.zip", tx("Download all (.zip)"), "btn btn--primary"));
    if (zipBlob instanceof Promise) {
      zipBlob.then((b) => btns.replaceChildren(blobLink(b, zipName || "files.zip", tx("Download all (.zip)"), "btn btn--primary")));
    }
  }
  if (extra) btns.append(...[].concat(extra));
  head.append(btns);
  const box = el("div", { class: "result" }, head);
  const list = el("ul", { class: "dl" });
  for (const o of outputs) {
    list.append(el("li", {},
      el("span", { class: "dl__name" }, o.name),
      el("span", { class: "dl__size" }, fmtBytes(o.blob.size)),
      o.note ? el("span", { class: "dl__size" }, o.note) : null,
      blobLink(o.blob, o.name, tx("Download"), "btn btn--sm")));
  }
  if (!single) box.append(list);
  if (note) box.append(el("p", { class: "result__note" }, note));
  container.append(box);
  const first = container.querySelector(".result__head a[download]");
  if (first) first.focus({ preventScroll: true });
  container.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  announce(title || tx("Done. Your download is ready."));
}

/* ------------------------------------------------------------------ zip (store only; outputs are already compressed formats) */

let CRC_TABLE;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* files: [{name, data: Uint8Array | Blob}]. Returns a Blob, or a Promise<Blob> when any data is a Blob. */
export function zipFiles(files) {
  if (files.some((f) => f.data instanceof Blob)) {
    return Promise.all(files.map(async (f) => ({ name: f.name, data: f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data })))
      .then(zipFiles);
  }
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  const seen = new Map();
  for (const f of files) {
    let name = f.name;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      name = baseName(name) + ` (${n})` + (extOf(name) ? "." + extOf(name) : "");
    } else seen.set(name, 1);
    const nameBytes = enc.encode(name);
    const data = f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/* ------------------------------------------------------------------ clipboard */

export async function copyText(text, button) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
  } catch (_) { ok = false; }
  if (!ok) {
    const area = el("textarea", { readonly: true, class: "visually-hidden" });
    area.value = text;
    document.body.append(area);
    area.select();
    try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
    area.remove();
  }
  if (button) {
    const label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = ok ? tx("Copied") : tx("Copy failed");
    clearTimeout(button._t);
    button._t = setTimeout(() => { button.textContent = label; }, 1600);
  }
  announce(ok ? tx("Copied to the clipboard.") : tx("Copy failed. Select the text and copy it by hand."));
  return ok;
}

/* Save a text string as a file. */
export function textBlob(text, type = "text/plain") {
  return new Blob([text], { type: type + ";charset=utf-8" });
}

/* Remember a small, non-sensitive preference in this browser only. */
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem("tt:" + key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("tt:" + key, JSON.stringify(value)); } catch (_) { /* storage blocked */ }
  },
};
