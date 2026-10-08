import { $, debounce, setStatus, announce, tx, EN, fmtNum } from "./core.js?v=5";

/* Whole numbers in text keep plain digits on English pages (no thousands separators), as before. */
const dig = (v) => (EN ? String(v) : fmtNum(v));
import { loadScript } from "./vendorload.js?v=5";

const svg = $("#b-svg"), msg = $("#b-msg"), info = $("#b-info"), status = $("#status");
const input = $("#b-val");
const dlSvg = $("#b-dlsvg"), dlPng = $("#b-dlpng");

/* ------------------------------------------------------------------ check digits (GS1: weights 3, 1, 3, 1 from the right) */

export function gs1Check(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/* UPC-E (number system + 6 digits) expanded to the 11-digit UPC-A data it stands for. */
export function upcEExpand(ns, six) {
  const [a, b, c, d, e, f] = six;
  if ("012".includes(f)) return `${ns}${a}${b}${f}0000${c}${d}${e}`;
  if (f === "3") return `${ns}${a}${b}${c}00000${d}${e}`;
  if (f === "4") return `${ns}${a}${b}${c}${d}00000${e}`;
  return `${ns}${a}${b}${c}${d}${e}0000${f}`;
}

const FORMATS = {
  EAN13: { name: "EAN-13", data: 12 },
  EAN8: { name: "EAN-8", data: 7 },
  UPC: { name: "UPC-A", data: 11 },
  ITF14: { name: "ITF-14", data: 13 },
};

/* Returns {text, note} for JsBarcode, or {error}. Never changes a typed check digit silently. */
export function prepare(format, raw) {
  let v = raw.trim();
  if (!v) return { error: tx("Type a value to see the barcode.") };
  const g = FORMATS[format];
  if (g) {
    v = v.replace(/[\s-]/g, "");
    const bad = v.match(/\D/);
    if (bad) return { error: tx("{name} takes digits only, but the value contains \"{ch}\". Remove it and try again.", { name: g.name, ch: bad[0] }) };
    if (v.length !== g.data && v.length !== g.data + 1) return { error: tx("{name} needs {n} digits, or {n1} if you include the check digit. You typed {typed}.", { name: g.name, n: dig(g.data), n1: dig(g.data + 1), typed: dig(v.length) }) };
    const want = gs1Check(v.slice(0, g.data));
    if (v.length === g.data) return { text: v + want, note: tx("Check digit {digit} calculated and added: {value}.", { digit: want, value: v + want }) };
    const given = Number(v[g.data]);
    if (given !== want) return { error: tx("The check digit is wrong. For {value} it should be {want}, but you typed {given}. Replace the last digit with {want}, or delete it and the tool will add it.", { value: v.slice(0, g.data), want, given }) };
    return { text: v, note: tx("Check digit {digit} is correct.", { digit: want }) };
  }
  switch (format) {
    case "UPCE": {
      v = v.replace(/[\s-]/g, "");
      const bad = v.match(/\D/);
      if (bad) return { error: tx("UPC-E takes digits only, but the value contains \"{ch}\". Remove it and try again.", { ch: bad[0] }) };
      if (![6, 7, 8].includes(v.length)) return { error: tx("UPC-E needs 6 digits, 7 with the leading number system digit, or 8 with the check digit as well. You typed {typed}.", { typed: dig(v.length) }) };
      let ns = "0", six, given = null;
      if (v.length === 6) six = v;
      else { ns = v[0]; six = v.slice(1, 7); if (v.length === 8) given = Number(v[7]); }
      if (ns !== "0" && ns !== "1") return { error: tx("UPC-E must start with number system 0 or 1, but this starts with {ns}.", { ns }) };
      const want = gs1Check(upcEExpand(ns, six));
      if (given !== null && given !== want) return { error: tx("The check digit is wrong. For {value} it should be {want}, but you typed {given}. Replace the last digit with {want}, or delete it and the tool will add it.", { value: ns + six, want, given }) };
      const text = `${ns}${six}${want}`;
      return { text, note: given === null
        ? (v.length === 6 ? tx("Check digit {digit} calculated and added: {value} (number system 0 assumed).", { digit: want, value: text }) : tx("Check digit {digit} calculated and added: {value}.", { digit: want, value: text }))
        : tx("Check digit {digit} is correct.", { digit: want }) };
    }
    case "CODE39": {
      const up = v.toUpperCase();
      const bad = up.match(/[^0-9A-Z\-. $/+%]/);
      if (bad) return { error: tx("Code 39 cannot encode \"{ch}\". It supports digits, capital letters, space and - . $ / + %.", { ch: bad[0] }) };
      return { text: up, note: up !== v ? tx("Lowercase letters were converted to capitals because Code 39 has no lowercase.") : "" };
    }
    case "ITF": {
      if (/\D/.test(v)) return { error: tx("ITF takes digits only, but the value contains \"{ch}\".", { ch: v.match(/\D/)[0] }) };
      if (v.length % 2) return { error: tx("ITF stores digits in pairs, so it needs an even number of digits. You typed {typed}; add a leading zero.", { typed: dig(v.length) }) };
      return { text: v, note: "" };
    }
    case "codabar": {
      const up = v.toUpperCase();
      if (!/^[A-D]?[0-9\-$:/.+]+[A-D]?$/.test(up)) return { error: tx("Codabar supports digits and - $ : / . +, with an optional start and stop letter from A to D.") };
      return { text: up, note: up !== v ? tx("Letters were converted to capitals.") : "" };
    }
    case "MSI": {
      if (/\D/.test(v)) return { error: tx("MSI takes digits only, but the value contains \"{ch}\".", { ch: v.match(/\D/)[0] }) };
      return { text: v, note: "" };
    }
    case "pharmacode": {
      if (!/^\d+$/.test(v)) return { error: tx("Pharmacode takes a whole number from 3 to 131070.") };
      const n = Number(v);
      if (n < 3 || n > 131070) return { error: tx("Pharmacode takes a whole number from 3 to 131070. You typed {n}.", { n: String(n) }) };
      return { text: String(n), note: "" };
    }
    default: {
      const bad = v.match(/[^\x20-\x7e]/);
      if (bad) return { error: tx("Code 128 here encodes standard ASCII characters. Remove \"{ch}\" or replace it with a plain letter, digit or symbol.", { ch: bad[0] }) };
      return { text: v, note: "" };
    }
  }
}

/* ------------------------------------------------------------------ drawing */

let ready = false; // a barcode is currently drawn
const nval = (id, lo, hi, d) => { const v = Math.round(Number($(id).value)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

async function render() {
  const format = $("#b-fmt").value;
  const r = prepare(format, input.value);
  const fail = (text) => { msg.textContent = text; input.setAttribute("aria-invalid", "true"); };
  if (r.error) {
    ready = false;
    dlSvg.disabled = dlPng.disabled = true;
    svg.style.display = "none";
    info.textContent = "";
    fail(r.error);
    return;
  }
  let JsBarcode;
  try { JsBarcode = await loadScript("/tools/vendor/jsbarcode/JsBarcode.all.min.js", "JsBarcode"); }
  catch (e) { return setStatus(status, "error", e.message); }
  svg.textContent = "";
  try {
    JsBarcode(svg, r.text, {
      format, width: nval("#b-w", 1, 8, 2), height: nval("#b-h", 20, 400, 100), margin: nval("#b-m", 0, 60, 10),
      displayValue: $("#b-text").checked, lineColor: $("#b-fg").value, background: $("#b-bg").value,
      font: "monospace", fontSize: 20, textMargin: 4,
    });
  } catch (_) {
    ready = false;
    dlSvg.disabled = dlPng.disabled = true;
    svg.style.display = "none";
    return fail(tx("That value cannot be drawn as {format}. Check the length and characters.", { format: $("#b-fmt").selectedOptions[0].textContent }));
  }
  input.removeAttribute("aria-invalid");
  setStatus(status, "idle");
  const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.display = "";
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.dataset.text = r.text;
  ready = true;
  dlSvg.disabled = dlPng.disabled = false;
  msg.textContent = (tx("Encoded \"{text}\".", { text: r.text }) + " " + (r.note || "")).trim();
  info.textContent = tx("{w} by {h} px as SVG.", { w: dig(w), h: dig(h) });
}

function svgMarkup() {
  const c = svg.cloneNode(true);
  c.removeAttribute("style"); c.removeAttribute("role"); c.removeAttribute("aria-label"); c.removeAttribute("id");
  c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(c);
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

dlSvg.addEventListener("click", () => {
  if (!ready) return;
  save(new Blob([svgMarkup()], { type: "image/svg+xml;charset=utf-8" }), "barcode.svg");
  announce(tx("SVG downloaded."));
});

dlPng.addEventListener("click", async () => {
  if (!ready) return;
  const scale = Number($("#b-scale").value) || 2;
  const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));
  const img = new Image();
  const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(tx("The barcode image could not be prepared."))); });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup());
  try {
    await loaded;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    if (!blob) throw new Error(tx("Your browser could not create the PNG. Try a smaller scale."));
    save(blob, "barcode.png");
    announce(tx("PNG downloaded."));
  } catch (e) { setStatus(status, "error", e.message); }
});

const rebuild = debounce(render, 100);
document.querySelectorAll(".gen-bc input, .gen-bc select").forEach((n) => { n.addEventListener("input", rebuild); n.addEventListener("change", rebuild); });
render();
