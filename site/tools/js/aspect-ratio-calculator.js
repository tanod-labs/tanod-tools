// Aspect ratio calculator: reduce a width and height to a ratio, and resize keeping a ratio.
import { $, tx, txn, fmtNum, EN } from "./core.js?v=5";
import { parseNum, fmt as fmtG } from "./calccore.js?v=5";

/* Pixel sizes read better without thousands separators (1920 × 1080). */
const fmt = (n, sig = 10) => fmtG(n, sig, { group: false });

const MAX = 1e6;
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/* The four complaints about one side, as whole sentences so each language can phrase them in full. */
const MSG = {
  width: { nan: tx("The width must be a number."), min: tx("The width must be more than 0."), max: tx("The width can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the width.") },
  height: { nan: tx("The height must be a number."), min: tx("The height must be more than 0."), max: tx("The height can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the height.") },
  rw: { nan: tx("The ratio width must be a number."), min: tx("The ratio width must be more than 0."), max: tx("The ratio width can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the ratio width.") },
  rh: { nan: tx("The ratio height must be a number."), min: tx("The ratio height must be more than 0."), max: tx("The ratio height can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the ratio height.") },
  nw: { nan: tx("The new width must be a number."), min: tx("The new width must be more than 0."), max: tx("The new width can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the new width.") },
  nh: { nan: tx("The new height must be a number."), min: tx("The new height must be more than 0."), max: tx("The new height can be at most 1,000,000."), dec: tx("Use at most 3 decimal places for the new height.") },
};

/* Validate one side: a positive number up to 1,000,000 with at most 3 decimals. Returns number or an error string. */
function side(input, what) {
  const v = parseNum(input.value);
  const m = MSG[what];
  let err = null;
  if (v === null) err = "";
  else if (Number.isNaN(v)) err = m.nan;
  else if (v <= 0) err = m.min;
  else if (v > MAX) err = m.max;
  else if (Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-6) err = m.dec;
  input.setAttribute("aria-invalid", err ? "true" : "false");
  return err === null ? v : { err };
}

/* Reduce w:h (up to 3 decimals) to whole numbers in lowest terms. */
export function reduce(w, h) {
  let k = 1;
  while (k < 1000 && (Math.abs(w * k - Math.round(w * k)) > 1e-9 || Math.abs(h * k - Math.round(h * k)) > 1e-9)) k *= 10;
  const a = Math.round(w * k), b = Math.round(h * k), g = gcd(a, b);
  return [a / g, b / g];
}

const NAMES = {
  "16:9": tx("Widescreen: HD, Full HD, 4K UHD and most TVs."),
  "4:3": tx("The classic TV and monitor shape; many tablets and slide templates."),
  "3:2": tx("The shape of most camera sensors and 6 × 4 prints."),
  "1:1": tx("Square."),
  "16:10": tx("Common on laptops and office monitors."),
  "5:4": tx("Older square-ish monitors such as 1280 × 1024."),
  "21:9": tx("Nominal ultrawide. Real ultrawide screens are usually 64:27 or 43:18."),
  "64:27": tx("Ultrawide, sold as “21:9” (2560 × 1080 is this shape)."),
  "43:18": tx("Ultrawide, sold as “21:9” (3440 × 1440 is this shape)."),
  "12:5": tx("Ultrawide 2.4:1, close to the cinema “scope” shape."),
  "32:9": tx("Super ultrawide, two 16:9 screens side by side."),
  "256:135": tx("DCI 4K cinema (4096 × 2160), about 1.9:1."),
  "9:16": tx("Vertical full-screen video on phones."),
  "4:5": tx("Portrait posts on social feeds."),
  "2:3": tx("Portrait photo (a 3:2 photo turned on its side)."),
  "3:4": tx("Portrait 4:3, as on many tablets held upright."),
};
const COMMON = ["16:9", "4:3", "3:2", "1:1", "16:10", "5:4", "21:9", "32:9", "9:16", "4:5", "2:3", "3:4"];
const dec = (x) => (EN ? x.toFixed(3).replace(/\.?0+$/, "") : fmtNum(x, { maximumFractionDigits: 3, useGrouping: false }));

let found = null;

function updateFind() {
  const w = side($("#ar-w"), "width"), h = side($("#ar-h"), "height");
  const name = $("#ar-name"), box = $("#ar-box");
  const bad = [w, h].find((x) => typeof x === "object" && x.err);
  if (typeof w !== "number" || typeof h !== "number") {
    found = null;
    $("#ar-ratio").textContent = "-";
    $("#ar-dec").textContent = "-";
    name.textContent = bad ? bad.err : tx("Enter a width and a height.");
    box.hidden = true;
  } else {
    const [a, b] = reduce(w, h);
    found = [a, b];
    const key = `${a}:${b}`;
    $("#ar-ratio").textContent = key;
    $("#ar-dec").textContent = `${dec(w / h)}:1`;
    let text = NAMES[key];
    if (!text) {
      const r = w / h;
      const near = COMMON.map((k) => { const [x, y] = k.split(":").map(Number); return [k, Math.abs(x / y - r) / (x / y)]; }).sort((p, q) => p[1] - q[1])[0];
      text = near[1] < 0.02 ? tx("Close to {ratio} ({dec}:1), but not exactly.", { ratio: near[0], dec: dec(Number(near[0].split(":")[0]) / Number(near[0].split(":")[1])) }) : tx("Not one of the common named ratios.");
    }
    name.textContent = text;
    const s = Math.min(240 / w, 150 / h);
    box.hidden = false;
    box.style.width = Math.max(4, Math.round(w * s)) + "px";
    box.style.height = Math.max(4, Math.round(h * s)) + "px";
    $("#ar-box-l").textContent = `${fmt(w)} × ${fmt(h)}`;
  }
  if ($("#ar-preset").value === "found") useFound();
}

/* ------------------------------------------------------------------ resize */

let lastSide = "w";
const preset = $("#ar-preset"), rw = $("#ar-rw"), rh = $("#ar-rh"), nw = $("#ar-nw"), nh = $("#ar-nh");

function useFound() {
  if (found) { rw.value = String(found[0]); rh.value = String(found[1]); }
  updateResize();
}

function updateResize() {
  const a = side(rw, "rw"), b = side(rh, "rh");
  const src = lastSide === "w" ? nw : nh, dst = lastSide === "w" ? nh : nw;
  const v = side(src, lastSide === "w" ? "nw" : "nh");
  dst.setAttribute("aria-invalid", "false");
  const note = $("#ar-rs-note"), out = $("#ar-size");
  const err = [a, b, v].find((x) => typeof x === "object" && x.err);
  if (typeof a !== "number" || typeof b !== "number" || typeof v !== "number") {
    if (typeof v !== "number") dst.value = "";
    out.textContent = "-";
    note.textContent = err ? err.err : tx("Type a new width or a new height; the other side is worked out.");
    return;
  }
  const exact = lastSide === "w" ? (v * b) / a : (v * a) / b;
  const rounded = Math.max(1, Math.round(exact));
  dst.value = String(rounded);
  const W = lastSide === "w" ? v : rounded, H = lastSide === "w" ? rounded : v;
  out.textContent = `${fmt(W)} × ${fmt(H)}`;
  const formula = lastSide === "w" ? `${fmt(v)} × ${fmt(b)} ÷ ${fmt(a)}` : `${fmt(v)} × ${fmt(a)} ÷ ${fmt(b)}`;
  const vars = { formula, value: fmt(exact, 7), exact: fmt(exact), pixels: fmt(rounded), n: fmt(rounded) };
  if (Math.abs(exact - rounded) < 1e-9) note.textContent = lastSide === "w" ? tx("Height = {formula} = {exact} exactly.", vars) : tx("Width = {formula} = {exact} exactly.", vars);
  else note.textContent = lastSide === "w"
    ? txn(rounded, "Height = {formula} = {value}, rounded to {n} pixel.", "Height = {formula} = {value}, rounded to {n} pixels.", vars)
    : txn(rounded, "Width = {formula} = {value}, rounded to {n} pixel.", "Width = {formula} = {value}, rounded to {n} pixels.", vars);
}

$("#ar-w").addEventListener("input", updateFind);
$("#ar-h").addEventListener("input", updateFind);
preset.addEventListener("change", () => {
  if (preset.value === "found") return useFound();
  if (preset.value !== "custom") [rw.value, rh.value] = preset.value.split(":");
  updateResize();
});
for (const r of [rw, rh]) r.addEventListener("input", () => {
  const key = `${rw.value.trim()}:${rh.value.trim()}`;
  preset.value = [...preset.options].some((o) => o.value === key) ? key : "custom";
  updateResize();
});
nw.addEventListener("input", () => { lastSide = "w"; updateResize(); });
nh.addEventListener("input", () => { lastSide = "h"; updateResize(); });

updateFind();
updateResize();
