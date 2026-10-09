// Tanod Tools server-backed tools: the shared client. Unlike every other tool on this site, these send the one file
// (or URL) you choose to our server at /web/v1/*, over HTTPS, and get the result back. The server holds the upload in
// memory for that one job, deletes it when the job ends and never stores or logs it (see the FAQ on each page).
//
// Each job needs a fresh Cloudflare Turnstile token (a quick, usually invisible human check), and counts toward a
// small daily free limit that the server reports in /web/v1/status.
import { $, el, icon, setStatus, UserError, announce, fmtBytes, tx, txf, EN, fmtNum } from "./core.js?v=11";

export const API = "/web/v1";
export const MAX_FILE_BYTES = 10_000_000;               // the server's limit: 10 MB per file
export const MAX_FILE_LABEL = tx("10 MB");
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let state = { enabled: false, remaining: null, limit: null, sitekey: null, action: null, ready: false };
let widget = null, waiting = null, turnstileP = null;
let quotaEl = null, humanEl = null;

/* ------------------------------------------------------------------ quota line */

function showQuota() {
  if (!quotaEl) return;
  quotaEl.textContent = "";
  quotaEl.dataset.state = "";
  if (!state.ready) {
    quotaEl.append(icon("i-alert"), el("span", {}, tx("Server tools are unavailable right now. Try again later.")));
    quotaEl.dataset.state = "off";
    return;
  }
  if (!state.enabled) {
    quotaEl.append(icon("i-alert"), el("span", {}, tx("Server tools are switched off right now. Try again later.")));
    quotaEl.dataset.state = "off";
    return;
  }
  const n = state.remaining;
  quotaEl.append(icon("i-server"), el("span", {},
    ...txf("{n} of {limit} free server jobs left today", { n: el("strong", { class: "num" }, String(n)), limit: state.limit }),
    el("span", { class: "quota__note" }, " · " + (n > 0 ? tx("shared by all server tools, resets at midnight UTC") : tx("resets at midnight UTC")))));
  if (n <= 0) quotaEl.dataset.state = "empty";
}

export function remaining() { return state.ready && state.enabled ? state.remaining : 0; }
export function available() { return state.ready && state.enabled && state.remaining > 0; }

/* Fetch the status, show the quota and prepare the human check. Never throws. */
export async function serverInit({ quota, human } = {}) {
  quotaEl = quota || $("#quota");
  humanEl = human || $("#human");
  try {
    const r = await fetch(API + "/status", { credentials: "same-origin", cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error("status " + r.status);
    state = { enabled: !!j.enabled, remaining: Number(j.remaining) || 0, limit: Number(j.daily_limit) || 0,
      sitekey: j.sitekey || null, action: j.action || null, ready: true };
  } catch (_) {
    state = { ...state, ready: false };
  }
  showQuota();
  if (state.ready && state.enabled && state.sitekey) loadTurnstile().catch(() => {});
  return state;
}

/* ------------------------------------------------------------------ Cloudflare Turnstile */

function loadTurnstile() {
  if (turnstileP) return turnstileP;
  turnstileP = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"))));
    s.addEventListener("error", () => { turnstileP = null; reject(new Error("turnstile blocked")); });
    document.head.append(s);
  });
  return turnstileP;
}

function settle(fn, value) {
  if (!waiting) return;
  const w = waiting;
  waiting = null;
  clearTimeout(w.timer);
  w[fn](value);
}

/* A fresh single-use token. The check is usually invisible; when Cloudflare wants an interaction, the widget appears
   in the #human box and the job waits for it. */
async function token() {
  let ts;
  try { ts = await loadTurnstile(); } catch (_) {
    throw new UserError(tx("The human check (Cloudflare Turnstile) couldn't load. A content blocker may be stopping it; allow challenges.cloudflare.com or try another browser."));
  }
  if (waiting) settle("reject", new UserError(tx("Cancelled.")));
  const p = new Promise((resolve, reject) => {
    waiting = { resolve, reject, timer: setTimeout(() => settle("reject", new UserError(tx("The human check took too long. Try again."))), 120000) };
  });
  if (widget === null) {
    humanEl.hidden = false;
    widget = ts.render(humanEl, {
      sitekey: state.sitekey, action: state.action || undefined, appearance: "interaction-only",
      execution: "execute", size: "flexible", "refresh-expired": "manual", "response-field": false,
      callback: (t) => settle("resolve", t),
      "error-callback": () => { settle("reject", new UserError(tx("The human check couldn't be completed. Reload the page and try again."))); return true; },
      "expired-callback": () => {},
      "before-interactive-callback": () => { humanEl.classList.add("is-asking"); announce(tx("Please complete the human check below the button.")); },
      "after-interactive-callback": () => humanEl.classList.remove("is-asking"),
    });
  } else {
    ts.reset(widget);
  }
  ts.execute(widget);
  return p;
}

/* ------------------------------------------------------------------ jobs */

const MESSAGES = {
  invalid_password: tx("That password doesn't open this PDF. Check it and try again."),
  not_encrypted: tx("This PDF has no password or restrictions, so there's nothing to remove."),
  unsupported_encryption: tx("This PDF uses an encryption method we can't open."),
  pdf_encrypted: tx("This PDF is password-protected. Remove the password first with Unlock PDF, then try again."),
  not_pdf: tx("This file isn't a PDF."),
  invalid_pdf: tx("This file couldn't be read as a PDF. It may be damaged."),
  empty_file: tx("This file is empty."),
  invalid_base64: tx("The file couldn't be sent. Try again."),
  too_many_pages: tx("This PDF has too many pages for the free tool."),
  page_out_of_range: tx("The pages you chose aren't in this PDF. Check the page numbers."),
  invalid_range: tx("The page selection isn't valid. Use numbers and ranges such as 1-3, 5."),
  pdf_too_complex: tx("This file is too complex to process within our limits. Try a smaller file."),
  input_too_large: tx("The file is too large. The limit is {limit}.", { limit: MAX_FILE_LABEL }),
  too_large: tx("The file is too large. The limit is {limit}.", { limit: MAX_FILE_LABEL }),
  body_too_large: tx("The file is too large. The limit is {limit}.", { limit: MAX_FILE_LABEL }),
  output_too_large: tx("The result would be too large to send back. Try a smaller file."),
  unsupported_image: tx("This image format isn't supported. Use PNG, JPEG or WebP."),
  image_too_large: tx("This image has too many pixels. Try a smaller image."),
  ocr_failed: tx("The text couldn't be read from this file."),
  unsupported_lang: tx("That language isn't available."),
  render_failed: tx("That page couldn't be loaded. Check the address, or try again later."),
  bad_url: tx("That doesn't look like a web address. It should start with https://."),
  bad_scheme: tx("Only http:// and https:// addresses work."),
  userinfo: tx("Addresses with a user name or password in them aren't allowed."),
  bad_port: tx("Only the standard web ports (80 and 443) are allowed."),
  bad_host: tx("That address has an invalid host name."),
  ip_literal: tx("Use a domain name, not an IP address."),
  internal_tld: tx("That address isn't on the public internet."),
  nxdomain: tx("That website couldn't be found. Check the spelling."),
  private_address: tx("That address points to a private network, which isn't allowed."),
  invalid_paper: tx("That paper size isn't available."),
  daily_limit: tx("You've used today's free server jobs. The limit resets at midnight UTC."),
  busy: tx("Our server is busy right now. Try again in a minute; nothing was counted."),
  rate_limited: tx("Too many requests at once. Wait a moment and try again."),
  web_tools_off: tx("Server tools are switched off right now. Try again later."),
  cross_origin: tx("This request was refused. Reload the page and try again."),
  turnstile_required: tx("The human check didn't finish. Try again."),
  turnstile_reused: tx("The human check expired. Try again."),
  turnstile_expired: tx("The human check expired. Try again."),
  turnstile_failed: tx("The human check didn't pass. Reload the page and try again."),
  turnstile_unavailable: tx("The human check couldn't be confirmed right now. Try again in a minute."),
  timeout: tx("This took too long on our server. Try a smaller file; nothing was counted."),
  unsupported_media_type: tx("The request was refused. Reload the page and try again."),
};

function friendly(code, fallback) {
  return MESSAGES[code] || fallback || tx("Something went wrong on our server. Try again in a minute; nothing was counted.");
}

/* POST a job. phases: (label, progress0to1|null) for the status line. Resolves with the JSON answer; throws
   UserError with a message for people. Uses XMLHttpRequest for upload progress. */
export async function runServerJob(tool, body, { onPhase = () => {} } = {}) {
  if (!state.ready || !state.enabled) throw new UserError(friendly("web_tools_off"));
  if (state.remaining <= 0) throw new UserError(friendly("daily_limit"));
  onPhase(tx("Checking you're human…"), null);
  const t = await token();
  const payload = JSON.stringify(body);
  const res = await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", API + tool);
    x.setRequestHeader("Content-Type", "application/json");
    x.setRequestHeader("X-Turnstile-Token", t);
    x.responseType = "text";
    x.timeout = 125000;
    let sent = false;
    x.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && e.total > 200000) onPhase(tx("Uploading {loaded} of {total}…", { loaded: fmtBytes(e.loaded), total: fmtBytes(e.total) }), e.loaded / e.total);
    });
    x.upload.addEventListener("load", () => { sent = true; onPhase(tx("Processing on our server…"), null); });
    x.addEventListener("progress", (e) => {
      if (sent && e.lengthComputable && e.total > 500000) onPhase(tx("Downloading the result…"), e.loaded / e.total);
    });
    x.addEventListener("load", () => resolve(x));
    x.addEventListener("error", () => reject(new UserError(tx("The connection to our server failed. Check your connection and try again."))));
    x.addEventListener("timeout", () => reject(new UserError(friendly("timeout"))));
    if (payload.length <= 200000) onPhase(tx("Processing on our server…"), null);
    x.send(payload);
  });
  let j = null;
  try { j = JSON.parse(res.responseText); } catch (_) { j = null; }
  if (j && Number.isFinite(j.remaining)) { state.remaining = j.remaining; showQuota(); }
  if (res.status === 413) throw new UserError(friendly("body_too_large"));
  if (res.status !== 200 || !j) {
    const code = j && j.error && j.error.code;
    throw new UserError(friendly(code, res.status >= 500 ? null : j && j.error && j.error.message));
  }
  return j;
}

/* ------------------------------------------------------------------ files */

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(new UserError(tx("The file couldn't be read.")));
    r.readAsDataURL(file);
  });
}

export const blobToBase64 = fileToBase64;

export function blobFromBase64(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* The size check every server page runs before anything is sent. */
export function checkSize(file) {
  if (file.size > MAX_FILE_BYTES) {
    const mb = Math.ceil(file.size / 1e5) / 10;
    const size = EN ? mb.toFixed(1) : fmtNum(mb, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    throw new UserError(file.name
      ? tx("\"{name}\" is {size} MB. The free server tools take files up to {limit}; for bigger files, use the Tanod API (paid per call).", { name: file.name, size, limit: MAX_FILE_LABEL })
      : tx("The prepared image is {size} MB. The free server tools take files up to {limit}; for bigger files, use the Tanod API (paid per call).", { size, limit: MAX_FILE_LABEL }));
  }
  if (!file.size) throw new UserError(file.name ? tx("\"{name}\" is empty.", { name: file.name }) : tx("The prepared image is empty."));
}

/* A status wrapper like core.runJob, for server jobs: working → done | error, with the button disabled. */
export async function serverJob({ status, button, done, job }) {
  if (button) button.disabled = true;
  setStatus(status, "working", tx("Starting…"));
  try {
    const result = await job((msg, p = null) => setStatus(status, "working", msg, p));
    const msg = typeof done === "function" ? done(result) : done;
    if (msg) setStatus(status, "done", msg); else setStatus(status, "idle");
    return result;
  } catch (err) {
    if (!(err instanceof UserError)) console.warn(err);
    setStatus(status, "error", err instanceof UserError ? err.message : tx("Something went wrong. Try again; nothing was counted."));
    return undefined;
  } finally {
    if (button) button.disabled = !available();
  }
}
