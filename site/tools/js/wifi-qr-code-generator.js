import { $, debounce, setStatus, announce, tx, EN, fmtNum } from "./core.js?v=5";
import { makeQr, geometry, drawQr, qrSvg, saveBlob, canvasBlob, MARGIN } from "./qrcore.js?v=5";

/* Whole numbers in text keep plain digits on English pages (no thousands separators), as before. */
const dig = (v) => (EN ? String(v) : fmtNum(v));

const canvas = $("#w-canvas"), info = $("#w-info"), warn = $("#w-warn"), status = $("#status");
const pngBtn = $("#w-png"), svgBtn = $("#w-svg"), cardBtn = $("#w-card");
let current = null;

/* Backslash first in the class, so a literal backslash is escaped too. */
const esc = (s) => s.replace(/([\\;,:"])/g, "\\$1");
const field = esc;

export function payload() {
  const ssid = $("#w-ssid").value;
  if (!ssid) return "";
  const sec = $("#w-sec").value;
  let s = `WIFI:T:${sec};S:${field(ssid)};`;
  if (sec !== "nopass") s += `P:${field($("#w-pass").value)};`;
  if ($("#w-hidden").checked) s += "H:true;";
  return s + ";";
}

function passwordNote() {
  const sec = $("#w-sec").value, p = $("#w-pass").value;
  if (sec === "nopass") return "";
  if (!p) return tx("No password entered. Phones will try to join a secured network without one.");
  if (sec === "WPA" && !(p.length >= 8 && p.length <= 63) && !/^[0-9a-f]{64}$/i.test(p)) return tx("A WPA password is 8 to 63 characters (or 64 hex digits); this one is {n}. Routers would not accept it.", { n: dig(p.length) });
  if (sec === "WEP" && ![5, 13, 10, 26].includes(p.length)) return tx("A WEP key is 5 or 13 characters, or 10 or 26 hex digits; this one is {n}.", { n: dig(p.length) });
  return "";
}

function num(id, lo, hi, d) {
  const v = Math.round(Number($(id).value));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}

function build() {
  const text = payload();
  $("#w-payload").textContent = text || tx("Enter a network name to see the encoded text.");
  const note = passwordNote();
  warn.hidden = !note;
  warn.textContent = note ? tx("Check: {note}", { note }) : "";
  $("#w-pass").disabled = $("#w-sec").value === "nopass";
  $("#w-cardpass").disabled = $("#w-sec").value === "nopass";
  if (!text) {
    current = null;
    pngBtn.disabled = svgBtn.disabled = cardBtn.disabled = true;
    canvas.style.display = "none";
    info.textContent = tx("Enter a network name to see your QR code.");
    setStatus(status, "idle");
    return;
  }
  try {
    current = makeQr(text, $("#w-ec").value);
  } catch (_) {
    current = null;
    pngBtn.disabled = svgBtn.disabled = cardBtn.disabled = true;
    canvas.style.display = "none";
    info.textContent = "";
    setStatus(status, "error", tx("That is too long for a QR code. Shorten the network name or password, or choose a lower error correction level."));
    return;
  }
  setStatus(status, "idle");
  canvas.style.display = "";
  pngBtn.disabled = svgBtn.disabled = cardBtn.disabled = false;
  const g = geometry(current.count, num("#w-size", 64, 4096, 512));
  drawQr(canvas, current, g.scale);
  canvas.style.imageRendering = "pixelated";
  info.textContent = tx("{count} by {count} modules. PNG will be {px} by {px} px.", { count: dig(current.count), px: dig(g.px) });
}

pngBtn.addEventListener("click", async () => {
  if (!current) return;
  const g = geometry(current.count, num("#w-size", 64, 4096, 512));
  const off = document.createElement("canvas");
  drawQr(off, current, g.scale);
  const blob = await canvasBlob(off);
  if (!blob) return setStatus(status, "error", tx("Your browser could not create the PNG. Try a smaller size."));
  saveBlob(blob, "wifi-qr-code.png");
  announce(tx("PNG downloaded."));
});

svgBtn.addEventListener("click", () => {
  if (!current) return;
  saveBlob(new Blob([qrSvg(current, num("#w-size", 64, 4096, 512))], { type: "image/svg+xml;charset=utf-8" }), "wifi-qr-code.svg");
  announce(tx("SVG downloaded."));
});

/* ------------------------------------------------------------------ printable card: 900 x 1100 px */

const FONT = 'Archivo, system-ui, sans-serif';

/* Lines for text that must fit maxW: shrink the font first, then break into several lines. */
function fit(ctx, text, maxW, start, min, weight) {
  let px = start;
  for (; px >= min; px -= 2) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) return { px, lines: [text] };
  }
  px = min;
  ctx.font = `${weight} ${px}px ${FONT}`;
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  return { px, lines };
}

async function cardCanvas() {
  await Promise.all([document.fonts.load(`800 56px Archivo`), document.fonts.load(`600 36px Archivo`), document.fonts.load(`400 30px Archivo`)]);
  const W = 900, H = 1100;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#16140f"; ctx.lineWidth = 8; ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#16140f";
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText(tx("Scan to join the Wi-Fi"), W / 2, 128);
  const area = 560;
  const g = geometry(current.count, area, MARGIN);
  const qc = document.createElement("canvas");
  drawQr(qc, current, g.scale);
  ctx.drawImage(qc, Math.round((W - g.px) / 2), 170);
  let y = 170 + g.px + 70;
  ctx.fillStyle = "#4a4f52"; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(tx("NETWORK"), W / 2, y);
  y += 20;
  ctx.fillStyle = "#16140f";
  const name = fit(ctx, $("#w-ssid").value, W - 200, 58, 28, 800);
  for (const l of name.lines) { y += name.px * 1.15; ctx.font = `800 ${name.px}px ${FONT}`; ctx.fillText(l, W / 2, y); }
  if ($("#w-cardpass").checked && $("#w-sec").value !== "nopass" && $("#w-pass").value) {
    y += 60;
    ctx.fillStyle = "#4a4f52"; ctx.font = `600 26px ${FONT}`;
    ctx.fillText(tx("PASSWORD"), W / 2, y);
    y += 20;
    ctx.fillStyle = "#16140f";
    const pw = fit(ctx, $("#w-pass").value, W - 200, 44, 24, 600);
    for (const l of pw.lines) { y += pw.px * 1.2; ctx.font = `600 ${pw.px}px ${FONT}`; ctx.fillText(l, W / 2, y); }
  }
  return c;
}

cardBtn.addEventListener("click", async () => {
  if (!current) return;
  const blob = await canvasBlob(await cardCanvas());
  if (!blob) return setStatus(status, "error", tx("Your browser could not create the card image."));
  saveBlob(blob, "wifi-card.png");
  announce(tx("Wi-Fi card downloaded."));
});

/* ------------------------------------------------------------------ events */

const rebuild = debounce(build, 100);
document.querySelectorAll(".gen-qr input, .gen-qr select").forEach((n) => { n.addEventListener("input", rebuild); n.addEventListener("change", rebuild); });
$("#w-show").addEventListener("change", () => { $("#w-pass").type = $("#w-show").checked ? "text" : "password"; });
build();
