// GIF maker maths and the glue to the GIF encoder. Pure functions (no DOM, no UI strings), so they can be tested with
// plain node. The encoder itself is the vendored gifenc library, passed to encodeGif as an argument.

export const MIN_DELAY = 20;          // ms: browsers play GIF frames with a shorter delay at 100 ms, so shorter is not offered
export const MAX_DELAY = 60000;
export const MIN_WIDTH = 16;
export const MAX_WIDTH = 1200;
export const MAX_HEIGHT = 1600;
export const MAX_FRAMES = 60;
export const MAX_TOTAL_PIXELS = 150e6; // width x height x frames
export const COLOR_CHOICES = [256, 128, 64, 32];

/* A frame delay in milliseconds as the GIF format stores it: whole hundredths of a second, between MIN_DELAY and MAX_DELAY. */
export function delayMs(value, fallback = 500) {
  const v = Number(value);
  const ms = Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(MAX_DELAY, Math.max(MIN_DELAY, ms)) / 10) * 10;
}

/* The order frames are shown in: 0..n-1, and with ping-pong the way back as well, without repeating the two end
   frames (1 2 3 2 1 2 3 ...). */
export function frameSequence(n, pingpong = false) {
  const seq = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  if (pingpong && n > 2) for (let i = n - 2; i >= 1; i--) seq.push(i);
  return seq;
}

/* The size of the GIF: the chosen width (kept between MIN_WIDTH and MAX_WIDTH) and a height that keeps the proportions
   of the first picture (at least 1 and at most MAX_HEIGHT; a very tall picture gets a narrower width instead). */
export function outputSize(srcW, srcH, width) {
  let w = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(width) || MIN_WIDTH)));
  let h = Math.max(1, Math.round((w * srcH) / srcW));
  if (h > MAX_HEIGHT) {
    h = MAX_HEIGHT;
    w = Math.max(1, Math.round((h * srcW) / srcH));
  }
  return { w, h };
}

/* How to draw a picture of sw x sh into a dw x dh frame. mode "contain" shows the whole picture with space left over,
   "cover" fills the frame and crops what overflows (from the centre), "stretch" fills it without keeping proportions.
   Returns the source rectangle (sx, sy, sWidth, sHeight) and the destination rectangle (dx, dy, dWidth, dHeight). */
export function fitRect(sw, sh, dw, dh, mode = "contain") {
  if (mode === "stretch") return { sx: 0, sy: 0, sWidth: sw, sHeight: sh, dx: 0, dy: 0, dWidth: dw, dHeight: dh };
  if (mode === "cover") {
    const k = Math.max(dw / sw, dh / sh);
    const sWidth = Math.min(sw, dw / k), sHeight = Math.min(sh, dh / k);
    return { sx: (sw - sWidth) / 2, sy: (sh - sHeight) / 2, sWidth, sHeight, dx: 0, dy: 0, dWidth: dw, dHeight: dh };
  }
  const k = Math.min(dw / sw, dh / sh);
  const dWidth = Math.max(1, Math.round(sw * k)), dHeight = Math.max(1, Math.round(sh * k));
  return { sx: 0, sy: 0, sWidth: sw, sHeight: sh, dx: Math.floor((dw - dWidth) / 2), dy: Math.floor((dh - dHeight) / 2), dWidth, dHeight };
}

/* True when w x h pixels in `frames` frames is more than the page will build. */
export function overBudget(w, h, frames) {
  return w * h * frames > MAX_TOTAL_PIXELS;
}

/* The play time of the GIF in milliseconds. */
export function totalDuration(delays) {
  return delays.reduce((s, d) => s + d, 0);
}

/* Encode frames to a GIF with the gifenc library (`enc` is its module: GIFEncoder, quantize, applyPalette).
   spec: { count, width, height, getFrame(i) -> RGBA bytes (width * height * 4, may be a promise),
           delayAt(i) -> ms, repeat (0 = loop forever, -1 = play once), colors (palette size per frame), onFrame(i) }.
   Every frame gets its own palette, so a frame keeps its colours even when the pictures differ a lot. Returns the file's bytes. */
export async function encodeGif(spec, enc) {
  if (!(spec.count >= 1)) throw new RangeError("a GIF needs at least one frame");
  const colors = COLOR_CHOICES.includes(spec.colors) ? spec.colors : 256;
  const gif = enc.GIFEncoder();
  for (let i = 0; i < spec.count; i++) {
    const rgba = await spec.getFrame(i);
    if (rgba.length !== spec.width * spec.height * 4) throw new RangeError(`frame ${i} has ${rgba.length} bytes, expected ${spec.width * spec.height * 4}`);
    const palette = enc.quantize(rgba, colors, { format: "rgb565" });
    const index = enc.applyPalette(rgba, palette, "rgb565");
    gif.writeFrame(index, spec.width, spec.height, { palette, delay: spec.delayAt(i), repeat: spec.repeat === -1 ? -1 : 0 });
    if (spec.onFrame) await spec.onFrame(i);
  }
  gif.finish();
  return gif.bytes();
}
