// URL encode / decode and a URL parser. Runs in the browser; nothing is fetched or sent.
import { $, $$, el, debounce, copyText, setStatus, announce, UserError, friendlyError, tx, txn } from "./core.js?v=11";

const RESERVED = new Set(";/?:@&=+$,#");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const HEX2 = /^[0-9a-fA-F]{2}$/;

/* Strict percent-decoder. keepReserved mimics decodeURI (escapes of ; / ? : @ & = + $ , # stay as they are);
   plusSpace reads "+" as a space (form data). Throws UserError naming the 1-based position of the problem. */
export function percentDecode(s, { keepReserved = false, plusSpace = false } = {}) {
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "%") {
      const bytes = [], starts = [];
      while (i < n && s[i] === "%") {
        const h = s.slice(i + 1, i + 3);
        if (!HEX2.test(h)) {
          const seen = s.slice(i, i + 3).replace(/\s.*$/s, "");
          throw new UserError(tx("\"{seen}\" at position {pos} is not a complete escape. A % sign must be followed by two hex digits (0-9, A-F); write a literal percent sign as %25.", { seen, pos: i + 1 }));
        }
        bytes.push(parseInt(h, 16));
        starts.push(i);
        i += 3;
      }
      let j = 0;
      while (j < bytes.length) {
        const b = bytes[j];
        const len = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
        const at = starts[j] + 1;
        if (!len) throw new UserError(tx("The escape {esc} at position {at} can't start a UTF-8 character, so the bytes don't decode to text.", { esc: s.slice(starts[j], starts[j] + 3), at }));
        if (j + len > bytes.length) {
          throw new UserError(txn(bytes.length - j, "The escape {esc} at position {at} starts a {len}-byte UTF-8 character, but only {n} escaped byte follows. The text may have been cut off or encoded in another character set.", "The escape {esc} at position {at} starts a {len}-byte UTF-8 character, but only {n} escaped bytes follow. The text may have been cut off or encoded in another character set.", { esc: s.slice(starts[j], starts[j] + 3), at, len }));
        }
        let ch;
        try { ch = utf8.decode(Uint8Array.from(bytes.slice(j, j + len))); } catch (_) {
          throw new UserError(tx("The escapes starting at position {at} ({esc}) are not valid UTF-8.", { at, esc: s.slice(starts[j], starts[j] + 3 * len) }));
        }
        out += len === 1 && keepReserved && RESERVED.has(ch) ? s.slice(starts[j], starts[j] + 3) : ch;
        j += len;
      }
    } else if (c === "+" && plusSpace) { out += " "; i++; }
    else { out += c; i++; }
  }
  return out;
}

export function encode(s, kind) {
  try {
    if (kind === "uri") return encodeURI(s);
    if (kind === "form") {
      if (/[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) throw new URIError("lone surrogate");
      return new URLSearchParams([["", s]]).toString().slice(1);
    }
    return encodeURIComponent(s);
  } catch (err) {
    if (err instanceof URIError) throw new UserError(tx("The text contains a broken character (half of an emoji or other symbol) that can't be written as UTF-8. Remove it and try again."));
    throw err;
  }
}

export function decode(s, kind) {
  return percentDecode(s, { keepReserved: kind === "uri", plusSpace: kind === "form" });
}

/* ------------------------------------------------------------------ encoder UI */

const status = $("#status");
const inEl = $("#u-in"), outEl = $("#u-out"), kindEl = $("#u-kind");
const dir = () => $('input[name="dir"]:checked').value;
let result = "";

const HELP = {
  encode: {
    component: tx("Escapes everything except letters, digits and - _ . ! ~ * ' ( ). Use it for one query value or path segment."),
    uri: tx("Keeps : / ? # & = and other URL structure; escapes spaces and non-ASCII characters."),
    form: tx("Spaces become +, everything except letters, digits and * - . _ is escaped."),
  },
  decode: {
    component: tx("Decodes every escape. A + stays a plus sign."),
    uri: tx("Leaves escapes of ; / ? : @ & = + $ , # alone, like decodeURI, so the URL's structure doesn't change."),
    form: tx("Decodes every escape and reads + as a space."),
  },
};

function run() {
  const text = inEl.value;
  $("#u-kind-help").textContent = HELP[dir()][kindEl.value];
  if (!text) { result = ""; outEl.value = ""; setStatus(status, "idle"); sync(); return; }
  try {
    result = dir() === "encode" ? encode(text, kindEl.value) : decode(text, kindEl.value);
    outEl.value = result;
    setStatus(status, "idle");
  } catch (err) {
    result = "";
    outEl.value = "";
    setStatus(status, "error", friendlyError(err));
  }
  sync();
}
function sync() { $("#u-copy").disabled = $("#u-swap").disabled = !result; inEl.setAttribute("aria-invalid", status.dataset.state === "error" ? "true" : "false"); }

const runSoon = debounce(run, 100);
inEl.addEventListener("input", () => (inEl.value.length > 50000 ? runSoon() : run()));
kindEl.addEventListener("change", run);
$$('input[name="dir"]').forEach((r) => r.addEventListener("change", run));
$("#u-copy").addEventListener("click", (e) => copyText(result, e.currentTarget));
$("#u-swap").addEventListener("click", () => {
  inEl.value = result;
  $(`input[name="dir"][value="${dir() === "encode" ? "decode" : "encode"}"]`).checked = true;
  run();
  inEl.focus();
  announce(tx("Result moved into the input."));
});
$("#u-clear").addEventListener("click", () => { inEl.value = ""; run(); inEl.focus(); });

/* ------------------------------------------------------------------ URL parser */

const DEFAULT_PORT = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21" };
const pIn = $("#p-in"), pOut = $("#p-out"), pNote = $("#p-note");

function tryDecode(s) {
  try { return percentDecode(s); } catch (_) { return s; }
}

function parse() {
  const raw = pIn.value.trim();
  pNote.textContent = "";
  if (!raw) { pOut.hidden = true; pIn.setAttribute("aria-invalid", "false"); return; }
  let url = null, assumed = false;
  try { url = new URL(raw); } catch (_) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      try { url = new URL("https://" + raw); assumed = true; } catch (_) { url = null; }
    }
  }
  if (!url) {
    pOut.hidden = true;
    pIn.setAttribute("aria-invalid", "true");
    pNote.textContent = tx("That isn't a URL the browser can read. Check for spaces in the host name or a missing scheme such as https://.");
    return;
  }
  pIn.setAttribute("aria-invalid", "false");
  if (assumed) pNote.textContent = tx("No scheme was given, so https:// was assumed.");
  const rows = [
    [tx("Scheme"), url.protocol.replace(/:$/, "")],
    url.username ? [tx("User name"), tryDecode(url.username)] : null,
    url.password ? [tx("Password"), txn(url.password.length, "(present, {n} character, not shown)", "(present, {n} characters, not shown)")] : null,
    [tx("Host"), url.hostname || tx("(none)")],
    url.hostname ? [tx("Port"), url.port || (DEFAULT_PORT[url.protocol] ? tx("{port} (default)", { port: DEFAULT_PORT[url.protocol] }) : tx("(default)"))] : null,
    url.origin && url.origin !== "null" ? [tx("Origin"), url.origin] : null,
    [tx("Path"), tryDecode(url.pathname) || "/"],
    [tx("Query"), url.search || tx("(none)")],
    [tx("Fragment"), url.hash ? tryDecode(url.hash.slice(1)) : tx("(none)")],
  ].filter(Boolean);
  $("#p-rows").replaceChildren(...rows.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))));
  const params = [...url.searchParams];
  $("#p-q").replaceChildren(...(params.length
    ? params.map(([k, v], i) => el("tr", {}, el("td", { class: "dv-soft" }, String(i + 1)), el("th", { scope: "row", class: "mono" }, k || tx("(empty)")), el("td", { class: "mono" }, v)))
    : [el("tr", {}, el("td", { colspan: "3", class: "dv-soft" }, tx("This URL has no query parameters.")))]));
  pOut.hidden = false;
}
pIn.addEventListener("input", debounce(parse, 80));

run();
parse();
