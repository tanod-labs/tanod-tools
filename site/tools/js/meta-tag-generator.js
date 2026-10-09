import { $, $$, copyText, tx, txn, EN, fmtNum } from "./core.js?v=11";
import { parseHex } from "./colorcore.js?v=11";

const f = {
  title: $("#m-title"), desc: $("#m-desc"), canon: $("#m-canon"),
  ogt: $("#m-ogt"), ogsite: $("#m-ogsite"), ogd: $("#m-ogd"), ogi: $("#m-ogi"), ogia: $("#m-ogia"), ogu: $("#m-ogu"),
  ogtype: $("#m-ogtype"), ogloc: $("#m-ogloc"), tw: $("#m-tw"), tws: $("#m-tws"), theme: $("#m-theme"),
};
const out = $("#m-out");

/* HTML escaping for text and double-quoted attributes. */
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (s) => String(s).replace(/\s+/g, " ").trim();
const len = (s) => [...s].length;

/* Absolute https URL check; returns "" when fine, or a plain-English warning. */
function urlWarning(v, name) {
  if (!v) return "";
  let u;
  try { u = new URL(v); } catch (_) { u = null; }
  if (!u || !u.hostname) return tx("{name} should be a full address starting with https://, for example https://example.com/page. Relative paths are often ignored.", { name });
  if (u.protocol === "http:") return tx("{name} uses http://. Use https:// so sites that require a secure address will accept it.", { name });
  if (u.protocol !== "https:") return tx("{name} should start with https://.", { name });
  return "";
}

function build() {
  const v = {};
  for (const k of Object.keys(f)) v[k] = clean(f[k].value);
  const lines = [];
  const meta = (attr, name, val) => { if (val) lines.push(`<meta ${attr}="${name}" content="${esc(val)}">`); };
  if ($("#m-charset").checked) lines.push('<meta charset="utf-8">');
  if ($("#m-viewport").checked) lines.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (v.title) lines.push(`<title>${esc(v.title)}</title>`);
  meta("name", "description", v.desc);
  if (v.canon) lines.push(`<link rel="canonical" href="${esc(v.canon)}">`);
  const idx = $('input[name="m-idx"]:checked').value, fol = $('input[name="m-fol"]:checked').value;
  if (idx !== "index" || fol !== "follow") lines.push(`<meta name="robots" content="${idx}, ${fol}">`);
  const theme = v.theme ? (parseHex(v.theme) || v.theme) : "";
  meta("name", "theme-color", theme);
  meta("property", "og:title", v.ogt);
  meta("property", "og:description", v.ogd ? clean(v.ogd) : "");
  meta("property", "og:type", v.ogtype);
  meta("property", "og:url", v.ogu);
  meta("property", "og:image", v.ogi);
  meta("property", "og:image:alt", v.ogia);
  meta("property", "og:site_name", v.ogsite);
  meta("property", "og:locale", v.ogloc);
  meta("name", "twitter:card", v.tw);
  meta("name", "twitter:site", v.tws);
  out.value = lines.join("\n") + (lines.length ? "\n" : "");
  return v;
}

/* ------------------------------------------------------------------ guidance */

function range(n, lo, hi, isTitle) {
  const shown = EN ? String(n) : fmtNum(n);
  const v = { n: shown, lo, hi };
  if (n === 0) return isTitle ? tx("0 characters. Around {lo} to {hi} usually works well for a title.", v) : tx("0 characters. Around {lo} to {hi} usually works well for a description.", v);
  if (n < lo * 0.6) return isTitle
    ? txn(n, "{n} character. Short; around {lo} to {hi} usually works well for a title.", "{n} characters. Short; around {lo} to {hi} usually works well for a title.", v)
    : txn(n, "{n} character. Short; around {lo} to {hi} usually works well for a description.", "{n} characters. Short; around {lo} to {hi} usually works well for a description.", v);
  if (n <= hi) return txn(n, "{n} character. In the usual range of about {lo} to {hi}.", "{n} characters. In the usual range of about {lo} to {hi}.", v);
  return isTitle
    ? txn(n, "{n} character. Long; search results often cut a title off after about {hi}.", "{n} characters. Long; search results often cut a title off after about {hi}.", v)
    : txn(n, "{n} character. Long; search results often cut a description off after about {hi}.", "{n} characters. Long; search results often cut a description off after about {hi}.", v);
}

function host(u) { try { return new URL(u).hostname; } catch (_) { return ""; } }
const cut = (s, n) => (len(s) > n ? [...s].slice(0, n - 1).join("").trimEnd() + "…" : s);

function refresh() {
  const v = build();
  $("#m-title-c").textContent = range(len(v.title), 50, 60, true);
  $("#m-desc-c").textContent = range(len(clean($("#m-desc").value)), 150, 160, false);
  const warns = [["m-canon-w", urlWarning(v.canon, tx("The canonical URL"))], ["m-ogi-w", urlWarning(v.ogi, "og:image")], ["m-ogu-w", urlWarning(v.ogu, "og:url")]];
  for (const [id, text] of warns) {
    const n = $("#" + id);
    n.textContent = text ? tx("Check: {text}", { text }) : "";
    n.classList.toggle("is-on", !!text);
    const inp = n.previousElementSibling;
    if (text) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid");
  }
  const tw = $("#m-theme-w");
  const bad = v.theme && !parseHex(v.theme) && !CSS.supports("color", v.theme);
  tw.textContent = bad ? tx("Check: that is not a colour value. Use a HEX value such as #1636a3.") : "";
  tw.classList.toggle("is-on", !!bad);
  if (parseHex(v.theme)) $("#m-theme-pick").value = parseHex(v.theme);

  // search result mock-up
  const pageUrl = v.canon || v.ogu;
  const shownHost = host(pageUrl);
  let path = "";
  try { const u = new URL(pageUrl); path = u.pathname.replace(/\/$/, "").split("/").filter(Boolean).join(" › "); } catch (_) { /* none */ }
  $("#m-serp-url").textContent = shownHost ? shownHost + (path ? " › " + path : "") : tx("example.com › page");
  $("#m-serp-title").textContent = v.title ? cut(v.title, 60) : tx("Your page title appears here");
  const d = clean($("#m-desc").value);
  $("#m-serp-desc").textContent = d ? cut(d, 160) : tx("Your description appears here. Search engines may use text from the page instead.");

  // social card mock-up (the image address is shown as text; nothing is requested)
  const imgBox = $("#m-card-img");
  imgBox.textContent = v.ogi || tx("No og:image set");
  imgBox.classList.toggle("is-empty", !v.ogi);
  $("#m-card").dataset.layout = v.tw === "summary" ? "summary" : "large";
  $("#m-card-host").textContent = (host(v.ogu || v.canon) || "example.com").toUpperCase();
  $("#m-card-title").textContent = v.ogt || v.title || tx("Title");
  $("#m-card-desc").textContent = clean($("#m-ogd").value) || d || tx("Description");
}

const run = refresh;
$$("input, select, textarea", $(".gen-meta")).forEach((n) => { n.addEventListener("input", run); n.addEventListener("change", run); });
$("#m-theme-pick").addEventListener("input", () => { f.theme.value = $("#m-theme-pick").value; refresh(); });
$("#m-copy").addEventListener("click", (e) => copyText(out.value, e.currentTarget));
refresh();
