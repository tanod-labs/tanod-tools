// QR helpers shared by the Wi-Fi and vCard QR pages: encode (UTF-8), draw, SVG, and download.
import qrcode from "/tools/vendor/qrcode/qrcode.mjs";

// The library's default converts text to Latin-1 and drops everything else. Encode as UTF-8 instead.
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

/* Throws when the text does not fit in the largest QR code at this error correction level. */
export function makeQr(text, level = "M") {
  const qr = qrcode(0, level);
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  return { qr, count, version: (count - 17) / 4, text, level };
}

export const MARGIN = 4;

/* Whole pixels per module so the code stays sharp: the PNG is the largest multiple of the module count that fits. */
export function geometry(count, wantedPx, margin = MARGIN) {
  const total = count + margin * 2;
  const scale = Math.max(1, Math.floor(wantedPx / total));
  return { margin, total, scale, px: total * scale };
}

export function drawQr(target, info, scale, margin = MARGIN, fg = "#000000", bg = "#ffffff") {
  const { qr, count } = info;
  const total = count + margin * 2;
  target.width = target.height = total * scale;
  const ctx = target.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.fillStyle = fg;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
}

export function qrSvg(info, size, margin = MARGIN, fg = "#000000", bg = "#ffffff") {
  const { qr, count } = info;
  const total = count + margin * 2;
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/><path fill="${fg}" d="${d}"/></svg>\n`;
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const canvasBlob = (canvas) => new Promise((res) => canvas.toBlob(res, "image/png"));
