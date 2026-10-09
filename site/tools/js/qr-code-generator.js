import { $, $$, debounce, setStatus, announce, prefs, tx, EN, fmtNum } from "./core.js?v=11";
import qrcode from "/tools/vendor/qrcode/qrcode.mjs";

/* Whole numbers in text keep plain digits on English pages (no thousands separators), as before. */
const dig = (v) => (EN ? String(v) : fmtNum(v));

// The library's default converts text to Latin-1 and drops everything else. Encode as UTF-8 instead.
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

const canvas = $("#q-canvas");
const info = $("#q-info");
const warn = $("#q-warn");
const status = $("#status");
const pngBtn = $("#q-png");
const svgBtn = $("#q-svg");
const sizeHelp = $("#q-size-help");

let current = null; // {qr, count, margin}

/* Wi-Fi field escaping per the WIFI: URI convention: \ ; , : " get a backslash. */
const wifiEsc = (s) => String(s).replace(/([\\;,:"])/g, "\\$1");

function kind() { return $('input[name="kind"]:checked').value; }

function payload() {
  switch (kind()) {
    case "text": return $("#q-text").value;
    case "wifi": {
      const ssid = $("#q-ssid").value;
      if (!ssid) return "";
      const sec = $("#q-wsec").value;
      let s = `WIFI:T:${sec};S:${wifiEsc(ssid)};`;
      if (sec !== "nopass") s += `P:${wifiEsc($("#q-wpass").value)};`;
      if ($("#q-whidden").checked) s += "H:true;";
      return s + ";";
    }
    case "email": {
      const to = $("#q-to").value.trim();
      if (!to) return "";
      const parts = [];
      const sub = $("#q-sub").value, body = $("#q-body").value;
      if (sub) parts.push("subject=" + encodeURIComponent(sub));
      if (body) parts.push("body=" + encodeURIComponent(body));
      return "mailto:" + to + (parts.length ? "?" + parts.join("&") : "");
    }
    case "phone": {
      const t = $("#q-tel").value.replace(/[\s()\-.]/g, "");
      return t ? "tel:" + t : "";
    }
  }
  return "";
}

function num(id, lo, hi, fallback) {
  const v = Math.round(Number($(id).value));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function colourWarning() {
  const fg = $("#q-fg").value, bg = $("#q-bg").value;
  const ratio = contrast(fg, bg);
  if (lum(fg) > lum(bg)) return tx("The code is lighter than its background. Inverted codes do not scan in some apps, so test with your own phone.");
  if (ratio < 3) return tx("The contrast between the two colours is low ({ratio} to 1). Scanners need strong contrast; aim for at least 4 to 1.", { ratio: EN ? ratio.toFixed(1) : fmtNum(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return "";
}

function build() {
  const text = payload();
  const level = $("#q-ec").value;
  const colourMsg = colourWarning();
  if (colourMsg) setStatus(warn, "error", colourMsg); else setStatus(warn, "idle");
  warn.setAttribute("role", "note");
  if (!text) {
    current = null;
    pngBtn.disabled = svgBtn.disabled = true;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.height = 1; ctx.clearRect(0, 0, 1, 1);
    canvas.style.display = "none";
    info.textContent = tx("Type something to see your QR code.");
    setStatus(status, "idle");
    return;
  }
  try {
    const qr = qrcode(0, level);
    qr.addData(text, "Byte");
    qr.make();
    current = { qr, count: qr.getModuleCount(), text };
  } catch (err) {
    current = null;
    pngBtn.disabled = svgBtn.disabled = true;
    canvas.style.display = "none";
    const bytes = new TextEncoder().encode(text).length;
    info.textContent = "";
    setStatus(status, "error", tx("That is too long for a QR code ({bytes} bytes at error correction {level}). Shorten the text or choose a lower error correction level.", { bytes: dig(bytes), level }));
    return;
  }
  setStatus(status, "idle");
  canvas.style.display = "";
  pngBtn.disabled = svgBtn.disabled = false;
  draw();
}

function geometry() {
  const margin = num("#q-margin", 0, 20, 4);
  const total = current.count + margin * 2;
  const wanted = num("#q-size", 64, 4096, 512);
  const scale = Math.max(1, Math.floor(wanted / total));
  return { margin, total, scale, px: total * scale };
}

function render(target, scale, margin) {
  const { qr, count } = current;
  const total = count + margin * 2;
  target.width = target.height = total * scale;
  const ctx = target.getContext("2d");
  ctx.fillStyle = $("#q-bg").value;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.fillStyle = $("#q-fg").value;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
}

function draw() {
  if (!current) return;
  const g = geometry();
  render(canvas, g.scale, g.margin);
  canvas.style.imageRendering = "pixelated";
  const wanted = num("#q-size", 64, 4096, 512);
  info.textContent = tx("{count} by {count} modules. PNG will be {px} by {px} px.", { count: dig(current.count), px: dig(g.px) });
  sizeHelp.textContent = g.px === wanted ? "" : tx("Rounded down to {px} px so each square is {scale} px.", { px: dig(g.px), scale: dig(g.scale) });
  if (g.px === wanted) sizeHelp.textContent = tx("{scale} px per square.", { scale: dig(g.scale) });
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

pngBtn.addEventListener("click", () => {
  if (!current) return;
  const g = geometry();
  const off = document.createElement("canvas");
  render(off, g.scale, g.margin);
  off.toBlob((blob) => {
    if (!blob) return setStatus(status, "error", tx("Your browser could not create the PNG. Try a smaller size."));
    save(blob, "qr-code.png");
    announce(tx("PNG downloaded."));
  }, "image/png");
});

svgBtn.addEventListener("click", () => {
  if (!current) return;
  const margin = num("#q-margin", 0, 20, 4);
  const { qr, count } = current;
  const total = count + margin * 2;
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${num("#q-size", 64, 4096, 512)}" height="${num("#q-size", 64, 4096, 512)}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${$("#q-bg").value}"/>` +
    `<path fill="${$("#q-fg").value}" d="${d}"/></svg>\n`;
  save(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "qr-code.svg");
  announce(tx("SVG downloaded."));
});

const rebuild = debounce(build, 120);
$$("input, select, textarea", $(".util-split")).forEach((e) => {
  e.addEventListener("input", rebuild);
  e.addEventListener("change", rebuild);
});
$$('input[name="kind"]').forEach((r) => r.addEventListener("change", () => {
  const k = kind();
  $$("[data-kind]").forEach((n) => { n.hidden = n.dataset.kind !== k; });
  build();
}));
$("#q-wsec").addEventListener("change", () => { $("#q-wpass").disabled = $("#q-wsec").value === "nopass"; });
const pref = prefs.get("qr-ec", null);
if (pref && "LMQH".includes(pref)) $("#q-ec").value = pref;
$("#q-ec").addEventListener("change", () => prefs.set("qr-ec", $("#q-ec").value));
build();
