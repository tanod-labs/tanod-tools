// JWT decoder: reads the header and payload of a JSON Web Token. Decoding only; the signature is not checked.
// The token never leaves the page.
import { $, el, icon, debounce, copyText, setStatus, UserError, friendlyError, tx, txn, EN, LOCALE, dateFormat, fmtNum } from "./core.js?v=5";

const MAX_CHARS = 1024 * 1024;
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) LOOKUP[B64URL.charCodeAt(i)] = i;
LOOKUP[43] = 62; LOOKUP[47] = 63; // tolerate standard Base64 + and /
const utf8 = new TextDecoder("utf-8", { fatal: true });

const CLAIMS = {
  iss: tx("Issuer"), sub: tx("Subject"), aud: tx("Audience"), exp: tx("Expiration time"), nbf: tx("Not valid before"),
  iat: tx("Issued at"), jti: tx("Token ID"), azp: tx("Authorized party"), scope: tx("Scopes granted"), scp: tx("Scopes granted"),
  nonce: tx("Nonce (replay protection)"), auth_time: tx("Time the user signed in"), sid: tx("Session ID"),
  client_id: tx("Client ID"), tid: tx("Tenant ID"), amr: tx("Authentication methods"), acr: tx("Authentication level"),
  at_hash: tx("Access token hash"), c_hash: tx("Code hash"), email: tx("Email address"), email_verified: tx("Email verified"),
  name: tx("Full name"), given_name: tx("Given name"), family_name: tx("Family name"), preferred_username: tx("User name"),
  roles: tx("Roles"), groups: tx("Groups"), typ: tx("Token type"), cnf: tx("Confirmation key"),
};
const TIME_CLAIMS = [["iat", tx("Issued at")], ["nbf", tx("Not before")], ["exp", tx("Expires")], ["auth_time", tx("Signed in")]];
/* Names of the parts of an encrypted token, for error messages (English names are kept in decodeToken's data). */
const JWE_NAMES = { "encrypted key": tx("encrypted key"), "initialization vector": tx("initialization vector"), ciphertext: tx("ciphertext"), "authentication tag": tx("authentication tag") };
const partName = (p) => JWE_NAMES[p] || p;

/* Decode one Base64url part to bytes. offset is the part's start in the token, for error positions. */
export function b64urlBytes(seg, part, offset) {
  const s = seg.replace(/=+$/, "");
  const vals = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) throw new UserError(tx("The {part} has \"{ch}\" at position {pos} of the token, which isn't allowed in Base64url (only A-Z, a-z, 0-9, - and _). The token may be cut off or have extra text pasted into it.", { part: partName(part), ch: s[i], pos: offset + i + 1 }));
    vals[i] = v;
  }
  if (s.length % 4 === 1) throw new UserError(tx("The {part} is {n} characters long, which can't be valid Base64url. The token was probably cut off or copied incompletely.", { part: partName(part), n: s.length }));
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, i = 0;
  for (; i + 3 < s.length; i += 4) {
    const v = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out[o++] = v >> 16; out[o++] = (v >> 8) & 255; out[o++] = v & 255;
  }
  const rest = s.length - i;
  if (rest >= 2) out[o++] = ((vals[i] << 2) | (vals[i + 1] >> 4)) & 255;
  if (rest === 3) out[o++] = ((vals[i + 1] << 4) | (vals[i + 2] >> 2)) & 255;
  return out;
}

function jsonPart(seg, part, offset, needObject = true) {
  const bytes = b64urlBytes(seg, part, offset);
  let text;
  try { text = utf8.decode(bytes); } catch (_) { throw new UserError(tx("The {part} is valid Base64url, but the bytes inside aren't UTF-8 text, so it isn't JSON.", { part: partName(part) })); }
  let obj;
  try { obj = JSON.parse(text); } catch (err) {
    throw new UserError(tx("The {part} decodes to text that isn't valid JSON ({error}). It starts: {start}", { part: partName(part), error: String(err.message).replace(/^JSON\.parse: /, ""), start: text.slice(0, 60) }));
  }
  if (needObject && (obj === null || typeof obj !== "object" || Array.isArray(obj))) throw new UserError(tx("The {part} is JSON but not an object; a JWT {part} must be a JSON object ({ … }).", { part: partName(part) }));
  return obj;
}

export function cleanToken(raw) {
  let s = raw.trim().replace(/^(?:authorization:\s*)?bearer\s+/i, "").trim();
  s = s.replace(/^["'`]+|["'`]+$/g, "");
  return s.replace(/\s+/g, "");
}

/* Returns {kind: "jws"|"jwe", header, payload?, parts, sizes}. Throws UserError with a plain message. */
export function decodeToken(raw) {
  const token = cleanToken(raw);
  if (token.length > MAX_CHARS) throw new UserError(tx("That token is over 1 MB, which is far larger than any real JWT."));
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 5) {
    throw new UserError(parts.length === 1
      ? tx("A JWT has three parts separated by dots (header.payload.signature), or five if it is encrypted. This has no dots.")
      : txn(parts.length, "A JWT has three parts separated by dots (header.payload.signature), or five if it is encrypted. This has {n} part.", "A JWT has three parts separated by dots (header.payload.signature), or five if it is encrypted. This has {n} parts."));
  }
  const offs = [];
  let off = 0;
  for (const p of parts) { offs.push(off); off += p.length + 1; }
  if (!parts[0]) throw new UserError(tx("The header (the part before the first dot) is empty."));
  const header = jsonPart(parts[0], tx("header"), offs[0]);
  if (parts.length === 5) {
    const names = ["encrypted key", "initialization vector", "ciphertext", "authentication tag"];
    const sizes = parts.slice(1).map((p, i) => [names[i], b64urlBytes(p, names[i], offs[i + 1]).length]);
    return { kind: "jwe", header, parts: 5, sizes };
  }
  if (!parts[1]) throw new UserError(tx("The payload (the middle part) is empty."));
  const payload = jsonPart(parts[1], tx("payload"), offs[1]);
  const sig = b64urlBytes(parts[2], tx("signature"), offs[2]);
  return { kind: "jws", header, payload, parts: 3, sigText: parts[2], sigBytes: sig.length };
}

/* ------------------------------------------------------------------ times */

const pad = (n, w = 2) => String(n).padStart(w, "0");
export function fmtLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "−";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)})`;
}
export function fmtUtc(d) {
  const iso = d.toISOString();
  return iso.endsWith(".000Z") ? iso.slice(0, 19) + "Z" : iso;
}
export function relSpan(seconds) {
  const s = Math.abs(seconds);
  if (!EN) {
    const u = (n, unit) => fmtNum(n, { style: "unit", unit, unitDisplay: "long" });
    if (s < 60) return u(Math.floor(s), "second");
    if (s < 3600) return u(Math.floor(s / 60), "minute");
    if (s < 86400) return u(Math.floor(s / 3600), "hour");
    if (s < 86400 * 365) return u(Math.floor(s / 86400), "day");
    return u(Math.floor(s / (86400 * 365.25)), "year");
  }
  const unit = (n, u) => `${n} ${u}${n === 1 ? "" : "s"}`;
  if (s < 60) return unit(Math.floor(s), "second");
  if (s < 3600) return unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  if (s < 86400 * 365) return unit(Math.floor(s / 86400), "day");
  return unit(Math.floor(s / (86400 * 365.25)), "year");
}
export const relative = (t, now) => {
  if (EN) return t >= now ? `in ${relSpan(t - now)}` : `${relSpan(now - t)} ago`;
  const s = Math.abs(t - now);
  const [n, unit] = s < 60 ? [Math.floor(s), "second"] : s < 3600 ? [Math.floor(s / 60), "minute"] : s < 86400 ? [Math.floor(s / 3600), "hour"] : s < 86400 * 365 ? [Math.floor(s / 86400), "day"] : [Math.floor(s / (86400 * 365.25)), "year"];
  return new Intl.RelativeTimeFormat(LOCALE, { numeric: "always" }).format(t >= now ? n : -n, unit);
};

function timeRows(payload, now) {
  const rows = [];
  for (const [k, label] of TIME_CLAIMS) {
    if (!(k in payload)) continue;
    const v = payload[k];
    const name = el("th", { scope: "row" }, el("code", {}, k), el("span", { class: "dv-soft" }, " " + label));
    if (typeof v !== "number" || !Number.isFinite(v)) {
      rows.push(el("tr", { "data-claim": k }, name, el("td", { colspan: "2" }, tx("Not a number ({value}). JWT times must be seconds since 1970.", { value: JSON.stringify(v).slice(0, 60) }))));
      continue;
    }
    const d = new Date(v * 1000);
    if (Number.isNaN(d.getTime())) {
      rows.push(el("tr", { "data-claim": k }, name, el("td", { colspan: "2" }, tx("{value} is outside the range of dates a browser can show.", { value: v }))));
      continue;
    }
    const ms = Math.abs(v) > 1e11 ? " " + tx("Looks like milliseconds; JWT times should be in seconds.") : "";
    const local = fmtLocal(d), cut = local.lastIndexOf(" (");
    rows.push(el("tr", { "data-claim": k }, name,
      el("td", {},
        el("span", { class: "dv-date", "data-local": "" }, EN ? local.slice(0, cut) : dateFormat({ dateStyle: "medium", timeStyle: "medium" }).format(d), " ", el("span", { class: "dv-nowrap" }, local.slice(cut + 1))),
        el("br"),
        el("span", { class: "dv-date dv-soft", "data-utc": "" }, fmtUtc(d))),
      el("td", { "data-rel": "" }, relative(v, now) + ms)));
  }
  return rows;
}

/* ------------------------------------------------------------------ UI */

const status = $("#status");
const inEl = $("#jw-in"), out = $("#jw-out"), valid = $("#jw-valid");
let decoded = null;

function jweSize(name, n) {
  const v = { n };
  switch (name) {
    case "encrypted key": return tx("Encrypted key: {n} bytes", v);
    case "initialization vector": return tx("Initialization vector: {n} bytes", v);
    case "ciphertext": return tx("Ciphertext: {n} bytes", v);
    default: return tx("Authentication tag: {n} bytes", v);
  }
}

function verdict(state, ic, text) {
  valid.dataset.ok = state;
  valid.replaceChildren(icon(ic), text);
}

function render() {
  const raw = inEl.value;
  decoded = null;
  if (!raw.trim()) { out.hidden = true; setStatus(status, "idle"); inEl.setAttribute("aria-invalid", "false"); return; }
  let r;
  try { r = decodeToken(raw); } catch (err) {
    out.hidden = true;
    inEl.setAttribute("aria-invalid", "true");
    setStatus(status, "error", friendlyError(err));
    return;
  }
  decoded = r;
  inEl.setAttribute("aria-invalid", "false");
  setStatus(status, "idle");
  const h = r.header;
  const show = (v) => (v === undefined ? "-" : typeof v === "string" ? v : JSON.stringify(v));
  $("#jw-alg").textContent = h.alg === "none" ? tx("none (unsigned)") : show(h.alg) + (r.kind === "jwe" && h.enc ? " / " + h.enc : "");
  $("#jw-typ").textContent = show(h.typ);
  $("#jw-kid").textContent = show(h.kid);
  $("#jw-parts").textContent = r.kind === "jwe" ? tx("5 (encrypted)") : tx("3 (signed)");
  $("#jw-header").textContent = JSON.stringify(h, null, 2);
  const now = Date.now() / 1000;
  if (r.kind === "jwe") {
    $("#jw-payload-box").hidden = $("#jw-times-box").hidden = $("#jw-claims-box").hidden = true;
    $("#jw-copy-p").hidden = true;
    $("#jw-warn").hidden = true;
    verdict("no", "i-lock", tx("This is an encrypted token (JWE). Its header is readable, but the claims are encrypted and can only be read with the recipient's private or shared key, which never belongs in a web page."));
    $("#jw-sig").textContent = r.sizes.map(([n, b]) => jweSize(n, b)).join("\n");
    out.hidden = false;
    return;
  }
  const p = r.payload;
  $("#jw-payload-box").hidden = $("#jw-claims-box").hidden = false;
  $("#jw-copy-p").hidden = false;
  $("#jw-warn").hidden = false;
  $("#jw-payload").textContent = JSON.stringify(p, null, 2);
  $("#jw-sig").textContent = r.sigText ? `${r.sigText}\n` + tx("({n} bytes, not checked)", { n: r.sigBytes }) : tx("Empty: this token has no signature.");

  const rows = timeRows(p, now);
  $("#jw-times-box").hidden = !rows.length;
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ""; } })();
  $("#jw-times-box thead th:nth-child(2)").textContent = zone ? tx("Your time ({zone}), then UTC", { zone }) : tx("Your time zone, then UTC");
  $("#jw-times").replaceChildren(...rows);

  const exp = typeof p.exp === "number" && Number.isFinite(p.exp) ? p.exp : null;
  const nbf = typeof p.nbf === "number" && Number.isFinite(p.nbf) ? p.nbf : null;
  if (exp !== null && now >= exp) verdict("no", "i-alert", tx("Expired {span} ago.", { span: relSpan(now - exp) }));
  else if (nbf !== null && now < nbf) verdict("no", "i-clock", tx("Not valid yet: it becomes valid in {span}.", { span: relSpan(nbf - now) }));
  else if (exp !== null) verdict("yes", "i-check", tx("Not expired: it expires in {span}.", { span: relSpan(exp - now) }));
  else verdict("none", "i-clock", tx("This token has no expiry time (exp claim)."));

  $("#jw-claims").replaceChildren(...Object.keys(p).map((k) => {
    let v = typeof p[k] === "string" ? p[k] : JSON.stringify(p[k]);
    if (v.length > 300) v = v.slice(0, 300) + "…";
    return el("tr", {}, el("th", { scope: "row" }, el("code", {}, k)),
      el("td", { class: CLAIMS[k] ? "" : "dv-soft" }, CLAIMS[k] || tx("Custom claim")),
      el("td", { class: "mono" }, v));
  }));
  out.hidden = false;
}

const renderSoon = debounce(render, 80);
inEl.addEventListener("input", renderSoon);
$("#jw-clear").addEventListener("click", () => { inEl.value = ""; render(); inEl.focus(); });
$("#jw-copy-p").addEventListener("click", (e) => { if (decoded && decoded.payload) copyText(JSON.stringify(decoded.payload, null, 2), e.currentTarget); });
$("#jw-copy-h").addEventListener("click", (e) => { if (decoded) copyText(JSON.stringify(decoded.header, null, 2), e.currentTarget); });

function b64url(obj) {
  const bytes = obj instanceof Uint8Array ? obj : new TextEncoder().encode(JSON.stringify(obj));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
$("#jw-sample").addEventListener("click", () => {
  const now = Math.floor(Date.now() / 1000);
  const sig = crypto.getRandomValues(new Uint8Array(32));
  inEl.value = [
    b64url({ alg: "HS256", typ: "JWT", kid: "example-key-1" }),
    b64url({ iss: "https://auth.example.com", sub: "user-1234", aud: "example-api", name: "Example User", roles: ["reader"], iat: now - 600, nbf: now - 600, exp: now + 3000 }),
    b64url(sig),
  ].join(".");
  render();
  inEl.focus();
});

render();
