import { $, live, openTextFile, wireCopy, setStatus, announce, fmtInt, tx } from "./textcore.js?v=11";
import { $$, el, fmtBytes, baseName } from "./core.js?v=11";
import { saveText } from "./csvcore.js?v=11";

const area = $("#md");
const out = $("#out");
const preview = $("#preview");
const status = $("#status");
const report = $("#report");
let fileBase = "document";
let html = "";

/* The Markdown parser and the HTML sanitiser load the first time there is something to convert. */
let libs = null;
function loadLibs() {
  if (!libs) {
    libs = Promise.all([import("/tools/vendor/marked/marked.esm.js"), import("/tools/vendor/dompurify/purify.es.mjs")])
      .then(([m, p]) => ({ marked: m.marked, purify: p.default }));
    libs.catch(() => { libs = null; });
  }
  return libs;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* Markdown -> sanitised HTML. Returns {html, removed: [names]}. */
export function convert({ marked, purify }, md, { breaks = false } = {}) {
  const raw = marked.parse(md, { gfm: true, breaks, async: false });
  const clean = purify.sanitize(raw, { USE_PROFILE: { html: true } });
  const removed = [];
  for (const r of purify.removed) {
    const name = r.attribute ? r.attribute.name : r.element && r.element.nodeName ? r.element.nodeName.toLowerCase() : null;
    if (name && !name.startsWith("#") && !removed.includes(name)) removed.push(name);
  }
  return { html: clean, removed };
}

export function fullDocument(body) {
  const doc = new DOMParser().parseFromString(body, "text/html");
  const h1 = doc.querySelector("h1");
  const title = (h1 && h1.textContent.trim()) || "Document";
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}

/* ------------------------------------------------------------------ preview
   The sanitised HTML is parsed in an inert document (no scripts run, nothing loads), reduced to
   plain document elements and attributes, and only then copied into the page. Images from other
   sites are shown as placeholders, so the preview never contacts another server. */

const KEEP = new Set("p h1 h2 h3 h4 h5 h6 ul ol li a em strong b i u s del ins code pre blockquote hr br table thead tbody tfoot tr th td caption img span div sup sub kbd mark small abbr details summary dl dt dd figure figcaption input q cite time".split(" "));
const DROP = new Set("style script template noscript title head".split(" "));
const ATTRS = { a: ["href", "title"], img: ["src", "alt", "title", "width", "height"], th: ["colspan", "rowspan", "align"], td: ["colspan", "rowspan", "align"], ol: ["start", "reversed"], details: ["open"], abbr: ["title"], input: ["type", "checked"], time: ["datetime"], "*": ["lang", "dir"] };

function placeholder(img) {
  const alt = img.getAttribute("alt") || "";
  const src = img.getAttribute("src") || "";
  return el("span", { class: "md-img" }, alt ? tx("Image: {alt}", { alt }) : tx("Image"), src ? el("small", {}, ` (${src})`) : null);
}

export function previewNodes(clean) {
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const node of Array.from(doc.body.querySelectorAll("*"))) {
    if (!node.isConnected) continue;
    const tag = node.localName;
    if (DROP.has(tag)) { node.remove(); continue; }
    if (!KEEP.has(tag) || (tag === "input" && node.getAttribute("type") !== "checkbox")) { node.replaceWith(...node.childNodes); continue; }
    const allowed = (ATTRS[tag] || []).concat(ATTRS["*"]);
    for (const a of Array.from(node.attributes)) if (!allowed.includes(a.name)) node.removeAttribute(a.name);
    if (tag === "img") {
      const src = node.getAttribute("src") || "";
      if (!/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);/i.test(src)) node.replaceWith(doc.importNode(placeholder(node), true));
    } else if (tag === "a") {
      const href = node.getAttribute("href");
      if (href && !href.startsWith("#")) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
    } else if (tag === "input") {
      node.setAttribute("disabled", "");
      node.setAttribute("aria-label", node.hasAttribute("checked") ? tx("Done") : tx("Not done"));
    }
  }
  return Array.from(doc.body.childNodes, (n) => document.importNode(n, true));
}

/* ------------------------------------------------------------------ UI */

const view = () => $('input[name="view"]:checked').value;
function showView() {
  const p = view() === "preview";
  out.hidden = p;
  preview.hidden = !p;
}

let run = 0;
async function update() {
  const md = area.value;
  const mine = ++run;
  if (!md.trim()) {
    html = ""; out.value = ""; preview.replaceChildren();
    report.textContent = tx("Type or paste Markdown to begin.");
    $("#copy").disabled = $("#dl").disabled = true;
    setStatus(status, "idle");
    return;
  }
  let lib;
  try { lib = await loadLibs(); } catch (err) {
    console.warn(err);
    setStatus(status, "error", tx("The Markdown converter couldn't be loaded. Check your connection and reload the page."));
    return;
  }
  if (mine !== run) return;
  const r = convert(lib, md, { breaks: $("#breaks").checked });
  html = $("#full").checked ? fullDocument(r.html) : r.html;
  out.value = html;
  preview.replaceChildren(...previewNodes(r.html));
  const size = fmtBytes(new Blob([html]).size), names = r.removed.slice(0, 6).join(", ");
  report.textContent = !r.removed.length ? tx("{size} of HTML", { size })
    : r.removed.length > 6 ? tx("{size} of HTML. Removed for safety: {names} and {n} more.", { size, names, n: fmtInt(r.removed.length - 6) })
    : tx("{size} of HTML. Removed for safety: {names}.", { size, names });
  $("#copy").disabled = $("#dl").disabled = false;
  setStatus(status, "idle");
}

live(() => area.value, [area, $("#full"), $("#breaks")], update);
$$('input[name="view"]').forEach((r) => r.addEventListener("change", showView));
wireCopy($("#copy"), () => html);
$("#dl").addEventListener("click", () => saveText(html, fileBase + ".html", "text/html"));
$("#clear").addEventListener("click", () => { area.value = ""; fileBase = "document"; update(); area.focus(); announce(tx("Cleared.")); });
openTextFile($("#drop"), status, (text, file) => { area.value = text; fileBase = baseName(file.name); update(); });
showView();
update();
