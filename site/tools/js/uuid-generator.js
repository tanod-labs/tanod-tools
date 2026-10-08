import { $, copyText, textBlob, announce, setStatus, tx, txn } from "./core.js?v=5";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fmt = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function uuidV4() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}

/* v7 (RFC 9562): 48-bit Unix ms, version, 12-bit counter (rand_a, method 1), variant, 62 random bits.
   Within one millisecond the counter increments; on overflow the timestamp is advanced by 1 ms. */
let lastMs = 0, counter = 0;
export function uuidV7() {
  let ms = Date.now();
  if (ms > lastMs) {
    lastMs = ms;
    const r = crypto.getRandomValues(new Uint16Array(1))[0];
    counter = r & 0x7ff; // start in the lower half so a ms has room to count up
  } else {
    counter++;
    if (counter > 0xfff) { lastMs++; counter = crypto.getRandomValues(new Uint16Array(1))[0] & 0x7ff; }
    ms = lastMs;
  }
  ms = lastMs;
  const b = crypto.getRandomValues(new Uint8Array(16));
  let t = ms;
  for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
  b[6] = 0x70 | ((counter >> 8) & 0x0f);
  b[7] = counter & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}

const out = $("#uu-out");
let lines = [];

function count() {
  const v = Math.round(Number($("#uu-count").value));
  return Number.isFinite(v) ? Math.max(1, Math.min(1000, v)) : 5;
}

function generate() {
  const v = $('input[name="ver"]:checked').value;
  const n = count();
  const make = v === "7" ? uuidV7 : uuidV4;
  lines = [];
  for (let i = 0; i < n; i++) {
    let u = make();
    if ($("#uu-nohy").checked) u = u.replace(/-/g, "");
    if ($("#uu-upper").checked) u = u.toUpperCase();
    if ($("#uu-brace").checked) u = "{" + u + "}";
    lines.push(u);
  }
  out.textContent = lines.join("\n");
}

const VARIANTS = [tx("Reserved (NCS)"), "RFC 9562 (RFC 4122)", tx("Reserved (Microsoft)"), tx("Reserved (future)")];

function check() {
  const raw = $("#uu-in").value.trim();
  const box = $("#uu-check"), stats = $("#uu-stats");
  if (!raw) { setStatus(box, "idle"); stats.hidden = true; return; }
  const h = raw.replace(/^urn:uuid:/i, "").replace(/^\{(.*)\}$/, "$1").replace(/-/g, "");
  const grouped = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.replace(/^urn:uuid:/i, "").replace(/^\{(.*)\}$/, "$1"));
  if (!/^[0-9a-f]{32}$/i.test(h)) {
    stats.hidden = true;
    const bad = h.search(/[^0-9a-f]/i);
    setStatus(box, "error", bad >= 0 ? tx("Not a UUID: \"{c}\" is not a hex digit.", { c: h[bad] }) : tx("Not a UUID: it has {n} hex digits and needs 32.", { n: h.length }));
    return;
  }
  setStatus(box, "done", grouped || !raw.includes("-") ? tx("Valid UUID format.") : tx("Valid digits, but the hyphens are not in the usual 8-4-4-4-12 places."));
  const ver = parseInt(h[12], 16);
  const vb = parseInt(h[16], 16);
  const variant = VARIANTS[vb < 8 ? 0 : vb < 12 ? 1 : vb < 14 ? 2 : 3];
  stats.hidden = false;
  $("#uu-v").textContent = h === "0".repeat(32) ? "nil" : /^f{32}$/i.test(h) ? "max" : String(ver);
  $("#uu-var").textContent = variant;
  const tsBox = $("#uu-tsbox");
  if (ver === 7 && vb >= 8 && vb < 12) {
    const ms = parseInt(h.slice(0, 12), 16);
    const d = new Date(ms);
    $("#uu-ts").textContent = isNaN(d) ? tx("out of range") : d.toISOString();
    tsBox.hidden = false;
  } else tsBox.hidden = true;
}

$("#uu-gen").addEventListener("click", () => { generate(); announce(txn(lines.length, "{n} UUID generated.", "{n} UUIDs generated.")); });
for (const sel of ['input[name="ver"]', "#uu-upper", "#uu-nohy", "#uu-brace", "#uu-count"]) {
  document.querySelectorAll(sel).forEach((e) => e.addEventListener("change", generate));
}
$("#uu-count").addEventListener("input", generate);
$("#uu-copy").addEventListener("click", (e) => copyText(lines.join("\n"), e.currentTarget));
$("#uu-dl").addEventListener("click", () => {
  const url = URL.createObjectURL(textBlob(lines.join("\n") + "\n"));
  const a = document.createElement("a");
  a.href = url; a.download = "uuids.txt";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$("#uu-in").addEventListener("input", check);
generate();
