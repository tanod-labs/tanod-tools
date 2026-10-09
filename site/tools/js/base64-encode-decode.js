import { $, $$, debounce, dropzone, copyText, textBlob, setStatus, fmtBytes, fmtNum, tick, announce, UserError, friendlyError, tx } from "./core.js?v=11";

const MAX_BYTES = 25 * 1024 * 1024;
const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URLSAFE = STD.slice(0, 62) + "-_";
const codes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const ALPHA = { std: codes(STD), url: codes(URLSAFE) };
const ascii = new TextDecoder("ascii");

/* Encode bytes[start, end) with the given alphabet. start must fall on a 3-byte boundary
   unless it is 0. Padding "=" only when pad is true and the slice ends mid-group. */
function encodeSlice(bytes, start, end, alpha, pad) {
  const n = end - start;
  const groups = Math.ceil(n / 3);
  const out = new Uint8Array(groups * 4);
  let o = 0, i = start;
  for (; i + 2 < end; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = alpha[v >> 18]; out[o++] = alpha[(v >> 12) & 63]; out[o++] = alpha[(v >> 6) & 63]; out[o++] = alpha[v & 63];
  }
  const rest = end - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out[o++] = alpha[v >> 18]; out[o++] = alpha[(v >> 12) & 63];
    if (pad) { out[o++] = 61; out[o++] = 61; }
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out[o++] = alpha[v >> 18]; out[o++] = alpha[(v >> 12) & 63]; out[o++] = alpha[(v >> 6) & 63];
    if (pad) out[o++] = 61;
  }
  return ascii.decode(out.subarray(0, o));
}

const wrap76 = (s) => s.replace(/(.{76})(?=.)/g, "$1\n");

export function encodeBytes(bytes, { urlSafe = false, wrap = false } = {}) {
  const s = encodeSlice(bytes, 0, bytes.length, urlSafe ? ALPHA.url : ALPHA.std, !urlSafe);
  return wrap ? wrap76(s) : s;
}

/* Decode Base64 text. Accepts both alphabets, ignores whitespace, tolerates missing padding.
   Throws UserError naming the position of the first bad character. `offset` shifts reported positions. */
export function decodeText(text, offset = 0) {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lookup[STD.charCodeAt(i)] = i;
  lookup[45] = 62; lookup[95] = 63;
  const vals = new Uint8Array(text.length);
  let n = 0, pad = 0;
  let line = 1, col = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    col++;
    if (c === 10) { line++; col = 0; continue; }
    if (c === 32 || c === 9 || c === 13 || c === 12 || c === 11) continue;
    const at = { pos: i + 1 + offset, line, col };
    if (c === 61) { pad++; if (pad > 2) throw new UserError(tx("Too much padding at position {pos} (line {line}, column {col}). Base64 uses A-Z, a-z, 0-9, + and / (or - and _), with = only at the end.", at)); continue; }
    if (pad) throw new UserError(tx("Unexpected \"{ch}\" after the padding at position {pos} (line {line}, column {col}). Base64 uses A-Z, a-z, 0-9, + and / (or - and _), with = only at the end.", { ...at, ch: text[i] }));
    const v = c < 128 ? lookup[c] : -1;
    if (v < 0) throw new UserError(tx("Invalid character \"{ch}\" at position {pos} (line {line}, column {col}). Base64 uses A-Z, a-z, 0-9, + and / (or - and _), with = only at the end.", { ...at, ch: text[i] }));
    vals[n++] = v;
  }
  if (n % 4 === 1) throw new UserError(tx("The input has {n} Base64 characters, which can't be a whole number of bytes (a length of 4k+1 is never valid). Check for missing or extra characters.", { n }));
  if (pad && (n + pad) % 4 !== 0) throw new UserError(tx("The = padding at the end doesn't match the length of the data."));
  const outLen = Math.floor((n * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0, i = 0;
  for (; i + 3 < n; i += 4) {
    const v = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out[o++] = v >> 16; out[o++] = (v >> 8) & 255; out[o++] = v & 255;
  }
  const rest = n - i;
  if (rest === 2) { out[o++] = ((vals[i] << 2) | (vals[i + 1] >> 4)) & 255; }
  else if (rest === 3) { out[o++] = ((vals[i] << 2) | (vals[i + 1] >> 4)) & 255; out[o++] = ((vals[i + 1] << 4) | (vals[i + 2] >> 2)) & 255; }
  return out;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const status = $("#status");

/* ------------------------------------------------------------------ text mode */

let textOut = "";
const inEl = $("#b-in"), outEl = $("#b-out");
const dir = () => $('input[name="dir"]:checked').value;

function runText() {
  const text = inEl.value;
  const encode = dir() === "encode";
  $("#b-wrap-l").hidden = !encode;
  if (!text.trim() && !encode) { outEl.value = textOut = ""; setStatus(status, "idle"); syncButtons(); return; }
  if (!text) { outEl.value = textOut = ""; setStatus(status, "idle"); syncButtons(); return; }
  try {
    if (encode) {
      textOut = encodeBytes(new TextEncoder().encode(text), { urlSafe: $("#b-url").checked, wrap: $("#b-wrap").checked });
    } else {
      const m = /^\s*data:[^,]*;base64,/i.exec(text);
      const bytes = decodeText(m ? text.slice(m[0].length) : text, m ? m[0].length : 0);
      try {
        textOut = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (_) {
        throw new UserError(tx("The Base64 is valid ({n} bytes) but the bytes aren't UTF-8 text, so they can't be shown here. If this is a file, use File mode and Base64 to file.", { n: fmtNum(bytes.length) }));
      }
    }
    outEl.value = textOut;
    setStatus(status, "idle");
  } catch (err) {
    outEl.value = textOut = "";
    setStatus(status, "error", friendlyError(err));
  }
  syncButtons();
}
function syncButtons() { $("#b-copy").disabled = $("#b-dl").disabled = $("#b-swap").disabled = !textOut; }

const runTextSoon = debounce(runText, 120);
inEl.addEventListener("input", runTextSoon);
for (const id of ["#b-url", "#b-wrap"]) $(id).addEventListener("change", runText);
$$('input[name="dir"]').forEach((r) => r.addEventListener("change", runText));
$("#b-copy").addEventListener("click", (e) => copyText(textOut, e.currentTarget));
$("#b-dl").addEventListener("click", () => saveBlob(textBlob(textOut), dir() === "encode" ? "encoded.txt" : "decoded.txt"));
$("#b-swap").addEventListener("click", () => {
  inEl.value = textOut;
  $(`input[name="dir"][value="${dir() === "encode" ? "decode" : "encode"}"]`).checked = true;
  runText(); inEl.focus();
});
$("#b-clear").addEventListener("click", () => { inEl.value = ""; runText(); inEl.focus(); });

$$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
  const file = $('input[name="mode"]:checked').value === "file";
  $("#b-textpanel").hidden = file;
  $("#b-filepanel").hidden = !file;
  setStatus(status, "idle");
  if (!file) runText();
}));

/* ------------------------------------------------------------------ file to Base64 */

let fileState = null; // {file, parts: string[], text: string|null}

async function encodeFile(file) {
  const urlSafe = $("#f-url").checked, wrap = $("#f-wrap").checked && !$("#f-data").checked;
  const alpha = urlSafe ? ALPHA.url : ALPHA.std;
  setStatus(status, "working", tx("Encoding {name}…", { name: file.name }), 0);
  await tick();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 57 * 1024; // multiple of 3 and of 57 so line wrapping stays aligned
  const parts = [];
  for (let s = 0; s < bytes.length; s += CHUNK) {
    const e = Math.min(bytes.length, s + CHUNK);
    let piece = encodeSlice(bytes, s, e, alpha, !urlSafe);
    if (wrap) piece = wrap76(piece) + (e < bytes.length ? "\n" : "");
    parts.push(piece);
    if ((s / CHUNK) % 64 === 63) { setStatus(status, "working", tx("Encoding {name}…", { name: file.name }), e / bytes.length); await tick(); }
  }
  let prefix = "";
  if (urlSafe) { /* no padding already */ }
  if ($("#f-data").checked) prefix = `data:${file.type || "application/octet-stream"};base64,`;
  return { parts, prefix, size: bytes.length };
}

async function handleFile(file) {
  if (file.size > MAX_BYTES) return setStatus(status, "error", tx("{name} is {size}; the limit is {limit}. Use a smaller file.", { name: file.name, size: fmtBytes(file.size), limit: fmtBytes(MAX_BYTES) }));
  try {
    const r = await encodeFile(file);
    fileState = { file, ...r };
    const total = r.prefix.length + r.parts.reduce((a, p) => a + p.length, 0);
    let preview = r.prefix + r.parts[0];
    const LIM = 4000;
    const truncated = r.parts.length > 1 || preview.length > LIM;
    $("#f-out").textContent = truncated ? preview.slice(0, LIM) + "…" : preview;
    const iv = { name: file.name, size: fmtBytes(r.size), total: fmtNum(total), shown: fmtNum(Math.min(LIM, total)) };
    $("#f-info").textContent = truncated ? tx("{name}: {size} became {total} characters. Showing the first {shown}; Copy and Download include everything.", iv) : tx("{name}: {size} became {total} characters.", iv);
    $("#f-result").hidden = false;
    setStatus(status, "done", tx("Encoded {name}.", { name: file.name }));
  } catch (err) {
    console.warn(err);
    setStatus(status, "error", friendlyError(err));
  }
}

const fullText = () => fileState.prefix + fileState.parts.join("");
dropzone($("#drop"), {
  maxFileBytes: MAX_BYTES,
  typeLabel: "file",
  onError: (m) => setStatus(status, "error", m),
  onFiles: (files) => {
    if ($('input[name="mode"]:checked').value !== "file") { $('input[name="mode"][value="file"]').checked = true; $("#b-textpanel").hidden = true; $("#b-filepanel").hidden = false; }
    handleFile(files[0]);
  },
});
for (const id of ["#f-url", "#f-wrap", "#f-data"]) $(id).addEventListener("change", () => { if (fileState) handleFile(fileState.file); });
$("#f-copy").addEventListener("click", (e) => { if (fileState) copyText(fullText(), e.currentTarget); });
$("#f-dl").addEventListener("click", () => { if (fileState) saveBlob(textBlob(fullText()), fileState.file.name + ".base64.txt"); });

/* ------------------------------------------------------------------ Base64 to file */

const SNIFF = [
  [[0x89, 0x50, 0x4e, 0x47], "png", "a PNG image"],
  [[0xff, 0xd8, 0xff], "jpg", "a JPEG image"],
  [[0x25, 0x50, 0x44, 0x46], "pdf", "a PDF document"],
  [[0x47, 0x49, 0x46, 0x38], "gif", "a GIF image"],
  [[0x50, 0x4b, 0x03, 0x04], "zip", "a ZIP archive"],
];
/* The sentence that says what a decoded file looks like, by extension. */
function looksLike(ext, size) {
  const v = { size };
  switch (ext) {
    case "png": return tx("Decodes to {size}. Looks like a PNG image.", v);
    case "jpg": return tx("Decodes to {size}. Looks like a JPEG image.", v);
    case "pdf": return tx("Decodes to {size}. Looks like a PDF document.", v);
    case "gif": return tx("Decodes to {size}. Looks like a GIF image.", v);
    case "zip": return tx("Decodes to {size}. Looks like a ZIP archive.", v);
    default: return tx("Decodes to {size}.", v);
  }
}
export function sniff(bytes) {
  for (const [sig, ext, label] of SNIFF) if (sig.every((b, i) => bytes[i] === b)) return { ext, label };
  return null;
}

const dIn = $("#d-in"), dName = $("#d-name"), dInfo = $("#d-info");
let nameTouched = false;
dName.addEventListener("input", () => { nameTouched = true; });

function parseDecode() {
  const raw = dIn.value;
  if (!raw.trim()) return null;
  const m = /^\s*data:([^,;]*)[^,]*;base64,/i.exec(raw);
  const body = m ? raw.slice(m[0].length) : raw;
  if (body.length > Math.ceil((MAX_BYTES * 4) / 3) + 1024) throw new UserError(tx("That decodes to more than {limit}, which is over the limit.", { limit: fmtBytes(MAX_BYTES) }));
  const bytes = decodeText(body, m ? m[0].length : 0);
  if (bytes.length > MAX_BYTES) throw new UserError(tx("That decodes to more than {limit}, which is over the limit.", { limit: fmtBytes(MAX_BYTES) }));
  return { bytes, mime: m ? m[1] : "" };
}

const checkDecode = debounce(() => {
  try {
    const r = parseDecode();
    if (!r) { $("#d-dl").disabled = true; dInfo.textContent = ""; setStatus(status, "idle"); return; }
    const s = sniff(r.bytes);
    dInfo.textContent = looksLike(s ? s.ext : "", fmtBytes(r.bytes.length));
    if (s && !nameTouched) dName.value = "decoded." + s.ext;
    $("#d-dl").disabled = false;
    setStatus(status, "idle");
  } catch (err) {
    $("#d-dl").disabled = true;
    dInfo.textContent = "";
    setStatus(status, "error", friendlyError(err));
  }
}, 150);
dIn.addEventListener("input", checkDecode);
$("#d-dl").addEventListener("click", () => {
  try {
    const r = parseDecode();
    if (!r) return;
    const name = (dName.value.trim() || "decoded.bin").replace(/[\\/]+/g, "_");
    saveBlob(new Blob([r.bytes], { type: r.mime || "application/octet-stream" }), name);
    setStatus(status, "done", tx("Decoded {size} to {name}.", { size: fmtBytes(r.bytes.length), name }));
  } catch (err) { setStatus(status, "error", friendlyError(err)); }
});

runText();
