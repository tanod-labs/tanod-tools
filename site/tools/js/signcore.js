// Signature stamp maths for Sign PDF: where the stamp goes on a page, how the signature and the date line are laid out,
// and how a drawn signature is trimmed. Pure functions (no DOM, no UI strings), so they can be tested with plain node.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* A page rotation (the PDF /Rotate value) as 0, 90, 180 or 270. */
export const rotationOf = (deg) => ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360;

/* Where a stamp goes on one page, as the person sees the page.
     page   { x, y, width, height, rotation }  the visible box of the page in PDF points (x, y = its lower-left corner,
            width and height = its size before rotation) and the page's /Rotate value
     aspect height / width of the stamp image
     place  { fx, fy, wFrac }  fx and fy are 0..1 positions of the stamp inside the free space (0 = against the left or
            top edge, 1 = against the right or bottom edge); wFrac is the stamp width as a fraction of the page width
            as displayed. A stamp too tall for the page is shrunk to fit.
   Returns { x, y, width, height, angle, display }: x, y, width, height and angle (degrees, counter-clockwise) are what
   pdf-lib's drawImage wants (x, y is the stamp's lower-left corner in the page's own, unrotated coordinates; the
   angle turns the stamp with the page so it reads upright), and display gives the stamp's place on the displayed page
   as fractions {left, top, width, height} for the on-screen preview. */
export function placeStamp(page, aspect, place) {
  const rot = rotationOf(page.rotation);
  const swap = rot === 90 || rot === 270;
  const dispW = swap ? page.height : page.width;
  const dispH = swap ? page.width : page.height;
  let w = clamp(Number(place.wFrac) || 0, 0.02, 1) * dispW;
  let h = w * aspect;
  if (h > dispH) { h = dispH; w = h / aspect; }
  const left = clamp(Number(place.fx) || 0, 0, 1) * (dispW - w);
  const top = clamp(Number(place.fy) || 0, 0, 1) * (dispH - h);
  // the stamp's lower-left corner on the displayed page, measured from the lower-left corner of the displayed page
  const X = left, Y = dispH - top - h;
  let ux, uy;
  switch (rot) {
    case 90: ux = page.width - Y; uy = X; break;
    case 180: ux = page.width - X; uy = page.height - Y; break;
    case 270: ux = Y; uy = page.height - X; break;
    default: ux = X; uy = Y;
  }
  return {
    x: page.x + ux, y: page.y + uy, width: w, height: h, angle: rot,
    display: { left: left / dispW, top: top / dispH, width: w / dispW, height: h / dispH },
  };
}

/* The 0-based indices of the pages to sign: just the current one, or every page. */
export function targetPages(scope, current, count) {
  if (scope === "all") return Array.from({ length: count }, (_, i) => i);
  return current >= 0 && current < count ? [current] : [];
}

/* The box around the visible (non-transparent) pixels of RGBA data, or null when there are none. */
export function alphaBounds(data, width, height, threshold = 12) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* A box grown by `pad` on every side but kept inside a width x height canvas. */
export function growBounds(b, pad, width, height) {
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(width, b.x + b.w + pad) - x, h: Math.min(height, b.y + b.h + pad) - y };
}

/* The stamp image: the signature, and under it an optional date line, both centred, inside a small margin.
   sig and date are { w, h } in pixels (date may be null). Returns the stamp size and where each part is drawn. */
export function stampLayout(sig, date, { pad = 6, gap = 6 } = {}) {
  const inner = Math.max(sig.w, date ? date.w : 0);
  const w = Math.ceil(inner + pad * 2);
  const h = Math.ceil(sig.h + (date ? gap + date.h : 0) + pad * 2);
  return {
    w, h,
    sig: { x: Math.round(pad + (inner - sig.w) / 2), y: pad },
    date: date ? { x: Math.round(pad + (inner - date.w) / 2), y: Math.round(pad + sig.h + gap) } : null,
  };
}

/* A font size (in px) that makes text fit a box: w1 is the text's width at 1 px, the result is limited by the box
   width, by the box height divided by lineFactor, and by max. */
export function fitFontSize(w1, boxW, boxH, { max = 160, lineFactor = 1.35 } = {}) {
  if (!(w1 > 0)) return Math.min(max, boxH / lineFactor);
  return Math.max(1, Math.min(max, boxW / w1, boxH / lineFactor));
}
