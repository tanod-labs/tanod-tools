import { $, debounce, setStatus, announce, tx, EN, fmtNum } from "./core.js?v=11";
import { makeQr, geometry, drawQr, qrSvg, saveBlob, canvasBlob } from "./qrcore.js?v=11";

/* Whole numbers in text keep plain digits on English pages (no thousands separators), as before. */
const dig = (v) => (EN ? String(v) : fmtNum(v));

const canvas = $("#v-canvas"), info = $("#v-info"), warn = $("#v-warn"), status = $("#status");
const pngBtn = $("#v-png"), svgBtn = $("#v-svg"), vcfBtn = $("#v-vcf");
let current = null, vcard = "";

/* vCard TEXT value escaping (RFC 2426 / RFC 6350): backslash, comma, semicolon, and line breaks. */
export const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
const val = (id) => $(id).value.trim();

export function buildVcard() {
  const first = val("#v-first"), last = val("#v-last"), org = val("#v-org");
  const fn = [first, last].filter(Boolean).join(" ") || org;
  if (!fn) return "";
  const L = ["BEGIN:VCARD", "VERSION:3.0"];
  L.push(`N:${esc(last)};${esc(first)};;;`);
  L.push(`FN:${esc(fn)}`);
  if (org) L.push(`ORG:${esc(org)}`);
  if (val("#v-title")) L.push(`TITLE:${esc(val("#v-title"))}`);
  if (val("#v-mobile")) L.push(`TEL;TYPE=CELL:${esc(val("#v-mobile"))}`);
  if (val("#v-work")) L.push(`TEL;TYPE=WORK,VOICE:${esc(val("#v-work"))}`);
  if (val("#v-email")) L.push(`EMAIL;TYPE=INTERNET:${esc(val("#v-email"))}`);
  if (val("#v-url")) L.push(`URL:${val("#v-url").replace(/[\r\n]+/g, "")}`);
  const adr = ["#v-street", "#v-city", "#v-region", "#v-post", "#v-country"].map(val);
  if (adr.some(Boolean)) L.push(`ADR;TYPE=WORK:;;${adr.map(esc).join(";")}`);
  const note = $("#v-note").value.trim();
  if (note) L.push(`NOTE:${esc(note)}`);
  L.push("END:VCARD");
  return L.join("\r\n") + "\r\n";
}

function fileName() {
  const n = ([val("#v-first"), val("#v-last")].filter(Boolean).join(" ") || val("#v-org"))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (n || "contact") + ".vcf";
}

const sizePx = () => { const v = Math.round(Number($("#v-size").value)); return Number.isFinite(v) ? Math.max(64, Math.min(4096, v)) : 512; };

function build() {
  vcard = buildVcard();
  $("#v-text").textContent = vcard ? vcard.replace(/\r\n/g, "\n") : tx("Enter a name or organisation to build the card.");
  const off = () => { current = null; pngBtn.disabled = svgBtn.disabled = vcfBtn.disabled = true; canvas.style.display = "none"; };
  warn.hidden = true;
  if (!vcard) { off(); info.textContent = tx("Enter a name or organisation to see your QR code."); setStatus(status, "idle"); return; }
  vcfBtn.disabled = false;
  try {
    current = makeQr(vcard, $("#v-ec").value);
  } catch (_) {
    off(); vcfBtn.disabled = false; info.textContent = "";
    setStatus(status, "error", tx("This card is too long for a QR code. Shorten or remove the note and address, or choose a lower error correction level. The .vcf file still works."));
    return;
  }
  setStatus(status, "idle");
  canvas.style.display = "";
  pngBtn.disabled = svgBtn.disabled = false;
  const g = geometry(current.count, sizePx());
  drawQr(canvas, current, g.scale);
  canvas.style.imageRendering = "pixelated";
  info.textContent = tx("Version {version}, {count} by {count} modules. PNG will be {px} by {px} px.", { version: dig(current.version), count: dig(current.count), px: dig(g.px) });
  if (current.version >= 10) {
    warn.hidden = false;
    warn.textContent = tx("Check: this code is dense (version {version}). It may be hard to scan when printed small. Dropping the note, address or job title makes it simpler, and so does a lower error correction level.", { version: dig(current.version) });
  }
}

pngBtn.addEventListener("click", async () => {
  if (!current) return;
  const g = geometry(current.count, sizePx());
  const off = document.createElement("canvas");
  drawQr(off, current, g.scale);
  const blob = await canvasBlob(off);
  if (!blob) return setStatus(status, "error", tx("Your browser could not create the PNG. Try a smaller size."));
  saveBlob(blob, "vcard-qr-code.png");
  announce(tx("PNG downloaded."));
});
svgBtn.addEventListener("click", () => {
  if (!current) return;
  saveBlob(new Blob([qrSvg(current, sizePx())], { type: "image/svg+xml;charset=utf-8" }), "vcard-qr-code.svg");
  announce(tx("SVG downloaded."));
});
vcfBtn.addEventListener("click", () => {
  if (!vcard) return;
  saveBlob(new Blob([vcard], { type: "text/vcard;charset=utf-8" }), fileName());
  announce(tx("vCard downloaded."));
});

const rebuild = debounce(build, 100);
document.querySelectorAll(".gen-vc input, .gen-vc select, .gen-vc textarea").forEach((n) => { n.addEventListener("input", rebuild); n.addEventListener("change", rebuild); });
build();
