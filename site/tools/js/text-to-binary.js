import { $, live, wireCopy, downloadButton, setStatus, announce, fmtInt, tx, txn } from "./textcore.js?v=5";

const area = $("#text");
const out = $("#out");
const status = $("#status");
const baseSel = $("#base");
const sepSel = $("#sep");
const dirs = Array.from(document.querySelectorAll('input[name="dir"]'));

const MAX_ENCODE = 1024 * 1024;
const MAX_DECODE = 5 * 1024 * 1024;
const WIDTH = { 2: 8, 16: 2, 10: 0, 8: 3 };
const DIGITS = { 2: /[01]/, 16: /[0-9a-f]/i, 10: /[0-9]/, 8: /[0-7]/ };
/* Names are spelled out per base so every sentence can be translated whole. */
const NAME_CAP = () => ({ 2: tx("Binary"), 16: tx("Hex"), 10: tx("Decimal"), 8: tx("Octal") });
const BAD_DIGIT = (v) => ({
  2: () => tx("\"{ch}\" at position {pos} (line {line}) isn't a binary digit. Binary uses only 0 and 1, with spaces, commas or line breaks between bytes.", v),
  16: () => tx("\"{ch}\" at position {pos} (line {line}) isn't a hex digit. Hex uses 0-9 and a-f, with spaces, commas or line breaks between bytes.", v),
  8: () => tx("\"{ch}\" at position {pos} (line {line}) isn't an octal digit. Octal uses 0-7, with spaces, commas or line breaks between bytes.", v),
  10: () => tx("\"{ch}\" at position {pos} (line {line}) isn't a decimal digit. Decimal uses 0-9, with spaces, commas or line breaks between bytes.", v),
});
const TOO_BIG = (v) => ({
  2: () => tx("Byte {i} (\"{v}\") is bigger than one byte (at most 8 binary digits).", v),
  16: () => tx("Byte {i} (\"{v}\") is bigger than one byte (at most 2 hex digits).", v),
  8: () => tx("Byte {i} (\"{v}\") is bigger than one byte (at most 3 octal digits).", v),
  10: () => tx("Byte {i} (\"{v}\") is bigger than one byte (0 to 255).", v),
});
const PASTE_HERE = (v) => ({
  2: () => tx("Paste binary bytes here, for example {example}", v),
  16: () => tx("Paste hex bytes here, for example {example}", v),
  8: () => tx("Paste octal bytes here, for example {example}", v),
  10: () => tx("Paste decimal bytes here, for example {example}", v),
});
const PASTE_BEGIN = () => ({
  2: tx("Paste binary bytes to begin."),
  16: tx("Paste hex bytes to begin."),
  8: tx("Paste octal bytes to begin."),
  10: tx("Paste decimal bytes to begin."),
});

class InputError extends Error {}

export function encode(text, base, sep) {
  const bytes = new TextEncoder().encode(text);
  const w = WIDTH[base];
  const parts = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = w ? bytes[i].toString(base).padStart(w, "0") : String(bytes[i]);
  return { text: parts.join(sep), bytes: bytes.length };
}

/* Index of the first byte that is not part of a valid UTF-8 sequence, or -1. */
export function firstBadUtf8(b) {
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let n = 0, min = 0;
    if (c < 0x80) { i++; continue; }
    if (c >= 0xc2 && c <= 0xdf) { n = 1; min = 0x80; }
    else if (c >= 0xe0 && c <= 0xef) { n = 2; min = 0x800; }
    else if (c >= 0xf0 && c <= 0xf4) { n = 3; min = 0x10000; }
    else return i;
    let cp = c & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const d = b[i + k];
      if (d === undefined || (d & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (d & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += n + 1;
  }
  return -1;
}

export function decode(raw, base) {
  const digit = DIGITS[base];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!digit.test(ch) && !/[\s,]/.test(ch)) {
      const line = raw.slice(0, i).split("\n").length;
      throw new InputError(BAD_DIGIT({ ch, pos: fmtInt(i + 1), line })[base]());
    }
  }
  let groups = raw.split(/[\s,]+/).filter(Boolean);
  const w = WIDTH[base];
  if (groups.length === 1 && w && groups[0].length > w) {
    const g = groups[0];
    if (g.length % w) throw new InputError(tx("One unbroken run of {n} digits can't be split into bytes of {w} digits. Add spaces between bytes, or check for a missing or extra digit.", { n: fmtInt(g.length), w }));
    groups = g.match(new RegExp(`.{${w}}`, "g"));
  }
  const bytes = new Uint8Array(groups.length);
  for (let i = 0; i < groups.length; i++) {
    const v = parseInt(groups[i], base);
    if ((w && groups[i].length > w) || v > 255) {
      throw new InputError(TOO_BIG({ i: fmtInt(i + 1), v: groups[i].slice(0, 12) + (groups[i].length > 12 ? "…" : "") })[base]());
    }
    bytes[i] = v;
  }
  const bad = firstBadUtf8(bytes);
  if (bad >= 0) {
    throw new InputError(tx("These bytes aren't valid UTF-8 text: byte {i} ({byte}) starts a character that doesn't continue correctly. A byte may be missing or extra.", { i: fmtInt(bad + 1), byte: bytes[bad].toString(base).padStart(w || 1, "0") }));
  }
  return { text: new TextDecoder("utf-8").decode(bytes), bytes: bytes.length };
}

const sepValue = () => (sepSel.value === "\\n" ? "\n" : sepSel.value);
const dir = () => dirs.find((d) => d.checked).value;

function labels() {
  const enc = dir() === "encode";
  const Name = NAME_CAP()[baseSel.value];
  $("#in-l").textContent = enc ? tx("Text") : Name;
  $("#out-l").textContent = enc ? Name : tx("Text");
  area.classList.toggle("mono", !enc);
  out.classList.toggle("mono", enc);
  area.placeholder = enc ? tx("Type text here.") : PASTE_HERE({ example: encode("Hi", Number(baseSel.value), " ").text })[baseSel.value]();
  $("#sep-field").hidden = !enc;
}

function update() {
  labels();
  const base = Number(baseSel.value);
  const raw = area.value;
  let msg = tx("Type text to begin.");
  out.value = "";
  setStatus(status, "idle");
  area.setAttribute("aria-invalid", "false");
  if (raw) {
    try {
      if (dir() === "encode") {
        if (raw.length > MAX_ENCODE) throw new InputError(tx("That text is longer than 1 MB, the limit for encoding here."));
        const r = encode(raw, base, sepValue());
        out.value = r.text;
        const n = Array.from(raw).length;
        msg = tx("{chars} → {bytes}.", { chars: txn(n, "{n} character", "{n} characters"), bytes: txn(r.bytes, "{n} byte", "{n} bytes") });
      } else {
        if (raw.length > MAX_DECODE) throw new InputError(tx("That input is longer than 5 MB, the limit for decoding here."));
        if (!raw.trim()) { msg = tx("Paste bytes to decode."); }
        else {
          const r = decode(raw, base);
          out.value = r.text;
          const n = Array.from(r.text).length;
          msg = tx("{bytes} → {chars}.", { bytes: txn(r.bytes, "{n} byte", "{n} bytes"), chars: txn(n, "{n} character", "{n} characters") });
        }
      }
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      setStatus(status, "error", err.message);
      area.setAttribute("aria-invalid", "true");
      msg = tx("Fix the input to see the result.");
    }
  } else if (dir() === "decode") msg = PASTE_BEGIN()[base];
  $("#report").textContent = msg;
  $("#copy").disabled = $("#dl").disabled = $("#swap").disabled = !out.value;
  $("#clear").disabled = !raw;
}

live(() => area.value, [area, baseSel, sepSel, ...dirs], update);
wireCopy($("#copy"), () => out.value);
$("#dl").replaceWith(Object.assign(downloadButton(tx("Download .txt"), () => out.value, "converted.txt"), { id: "dl" }));
$("#swap").addEventListener("click", () => {
  const next = dir() === "encode" ? "decode" : "encode";
  area.value = out.value;
  dirs.find((d) => d.value === next).checked = true;
  update();
  announce(next === "decode" ? tx("Now decoding the result back to text.") : tx("Now converting the text back."));
});
$("#clear").addEventListener("click", () => { area.value = ""; update(); area.focus(); });
update();
