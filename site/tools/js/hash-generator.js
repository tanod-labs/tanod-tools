// Hash generator: MD5 (md5.js) and SHA-1/256/384/512 (Web Crypto) of text or a file. Nothing is sent anywhere.
import { $, $$, el, icon, debounce, dropzone, copyText, textBlob, setStatus, fmtBytes, fmtNum, tick, announce, UserError, friendlyError, tx, txn } from "./core.js?v=11";
import { MD5 } from "./md5.js?v=11";

const MAX_FILE = 200 * 1024 * 1024;
const SLICE = 4 * 1024 * 1024;
export const ALGOS = [
  { id: "md5", label: "MD5", bsd: "MD5" },
  { id: "sha1", label: "SHA-1", web: "SHA-1", bsd: "SHA1" },
  { id: "sha256", label: "SHA-256", web: "SHA-256", bsd: "SHA256" },
  { id: "sha384", label: "SHA-384", web: "SHA-384", bsd: "SHA384" },
  { id: "sha512", label: "SHA-512", web: "SHA-512", bsd: "SHA512" },
];

const status = $("#status");
const inEl = $("#h-in"), expectEl = $("#h-expect"), verdict = $("#h-verdict");
const resultBox = $("#h-result");
let current = null; // {name, size, digests: {id: Uint8Array}, isFile}
let job = 0;

const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function toB64(b) { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
const fmt = () => $('input[name="fmt"]:checked').value;
function show(bytes, f = fmt()) { return f === "b64" ? toB64(bytes) : f === "HEX" ? toHex(bytes).toUpperCase() : toHex(bytes); }

async function digestAll(bytes, progress) {
  const out = {};
  const md5 = new MD5();
  for (let i = 0; i < bytes.length; i += SLICE) {
    md5.update(bytes.subarray(i, Math.min(bytes.length, i + SLICE)));
    if (progress && bytes.length > SLICE) { progress(Math.min(1, (i + SLICE) / bytes.length) * 0.6); await tick(); }
  }
  out.md5 = md5.digest();
  if (!crypto.subtle) throw new UserError(tx("This browser doesn't offer the Web Crypto functions needed for SHA hashes (it may be an old browser or an insecure page)."));
  let n = 0;
  for (const a of ALGOS.filter((x) => x.web)) {
    out[a.id] = new Uint8Array(await crypto.subtle.digest(a.web, bytes));
    if (progress) progress(0.6 + (++n / 4) * 0.4);
  }
  return out;
}

function render() {
  if (!current) { resultBox.hidden = true; compare(); return; }
  const f = fmt();
  $("#h-rows").replaceChildren(...ALGOS.map((a) => el("div", { "data-algo": a.id },
    el("dt", {}, a.label),
    el("dd", { id: "h-v-" + a.id }, show(current.digests[a.id], f)),
    el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Copy {algo}", { algo: a.label }), onclick: (e) => copyText(show(current.digests[a.id]), e.currentTarget) }, tx("Copy")))));
  $("#h-info").textContent = current.isFile
    ? tx("{name}: {size} ({bytes} bytes).", { name: current.name, size: fmtBytes(current.size), bytes: fmtNum(current.size) })
    : txn(current.size, "{n} byte of UTF-8 text.", "{n} bytes of UTF-8 text.");
  resultBox.hidden = false;
  compare();
}

/* Pull the checksum out of what was pasted: bare hex or Base64, "hash  filename", "SHA256 (f) = hash", or "sha256-…" (SRI). */
export function extractExpected(raw) {
  const s = raw.trim();
  if (!s) return null;
  const bsd = /=\s*([0-9a-fA-F]{32,128}|[A-Za-z0-9+/_-]{20,}={0,2})\s*$/.exec(s);
  if (bsd && /\(.*\)/.test(s)) return bsd[1];
  const hex = /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64}|[0-9a-fA-F]{96}|[0-9a-fA-F]{128})(?![0-9a-fA-F])/.exec(s);
  if (hex) return hex[1];
  return s.replace(/^sha(?:256|384|512)-/i, "").replace(/\s+/g, "");
}

const normB64 = (s) => s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");

function compare() {
  const raw = expectEl.value;
  $$("#h-rows > div").forEach((d) => d.classList.remove("is-match"));
  if (!raw.trim() || !current) { verdict.hidden = true; verdict.textContent = ""; expectEl.setAttribute("aria-invalid", "false"); return; }
  const want = extractExpected(raw);
  let hit = null;
  for (const a of ALGOS) {
    const d = current.digests[a.id];
    if (want.toLowerCase() === toHex(d) || normB64(want) === normB64(toB64(d))) { hit = a; break; }
  }
  verdict.replaceChildren();
  if (hit) {
    verdict.dataset.ok = "yes";
    verdict.append(icon("i-check"), current.isFile ? tx("Match: this is the {algo} hash of {name}.", { algo: hit.label, name: current.name }) : tx("Match: this is the {algo} hash of the text.", { algo: hit.label }));
    $(`#h-rows > div[data-algo="${hit.id}"]`).classList.add("is-match");
    expectEl.setAttribute("aria-invalid", "false");
  } else {
    verdict.dataset.ok = "no";
    const len = /^[0-9a-f]+$/i.test(want) ? txn(want.length, "{n} hex character", "{n} hex characters") : txn(want.length, "{n} character", "{n} characters");
    verdict.append(icon("i-alert"), current.isFile ? tx("No match. The expected value ({len}) is not the MD5, SHA-1, SHA-256, SHA-384 or SHA-512 of this file.", { len }) : tx("No match. The expected value ({len}) is not the MD5, SHA-1, SHA-256, SHA-384 or SHA-512 of this text.", { len }));
    expectEl.setAttribute("aria-invalid", "true");
  }
  verdict.hidden = false;
}

/* ------------------------------------------------------------------ text */

async function hashText() {
  const id = ++job;
  const text = inEl.value;
  if (!text) {
    current = null;
    $("#h-tinfo").textContent = "";
    setStatus(status, "idle");
    render();
    return;
  }
  try {
    const bytes = new TextEncoder().encode(text);
    const digests = await digestAll(bytes);
    if (id !== job) return;
    current = { name: "text", size: bytes.length, digests, isFile: false };
    setStatus(status, "idle");
    render();
  } catch (err) {
    if (id !== job) return;
    console.warn(err);
    setStatus(status, "error", friendlyError(err));
  }
}
const hashTextSoon = debounce(hashText, 120);
inEl.addEventListener("input", () => (inEl.value.length > 100000 ? hashTextSoon() : hashText()));

/* ------------------------------------------------------------------ file */

async function hashFile(file) {
  const id = ++job;
  if (file.size > MAX_FILE) {
    setStatus(status, "error", tx("\"{name}\" is {size}; the limit here is {limit}, because the file is read into memory.", { name: file.name, size: fmtBytes(file.size), limit: fmtBytes(MAX_FILE) }));
    return;
  }
  try {
    setStatus(status, "working", tx("Reading {name}…", { name: file.name }), null);
    await tick();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digests = await digestAll(bytes, (p) => { if (id === job) setStatus(status, "working", tx("Hashing {name}…", { name: file.name }), p); });
    if (id !== job) return;
    current = { name: file.name, size: bytes.length, digests, isFile: true };
    render();
    setStatus(status, "done", tx("Hashed {name} ({size}).", { name: file.name, size: fmtBytes(bytes.length) }));
    announce(tx("Hashes ready for {name}.", { name: file.name }));
  } catch (err) {
    if (id !== job) return;
    console.warn(err);
    setStatus(status, "error", friendlyError(err));
  }
}

function setMode(file) {
  $("#h-textpanel").hidden = file;
  $("#h-filepanel").hidden = !file;
  job++;
  current = null;
  setStatus(status, "idle");
  render();
  if (!file) hashText();
}
$$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => setMode(r.value === "file" && r.checked)));

dropzone($("#drop"), {
  typeLabel: "file",
  onError: (m) => setStatus(status, "error", m),
  onFiles: (files) => {
    if ($('input[name="mode"]:checked').value !== "file") {
      $('input[name="mode"][value="file"]').checked = true;
      $("#h-textpanel").hidden = true;
      $("#h-filepanel").hidden = false;
    }
    hashFile(files[0]);
  },
});

/* ------------------------------------------------------------------ output */

$$('input[name="fmt"]').forEach((r) => r.addEventListener("change", render));
expectEl.addEventListener("input", compare);

function listing() {
  return ALGOS.map((a) => `${a.bsd} (${current.name}) = ${show(current.digests[a.id])}`).join("\n") + "\n";
}
$("#h-copyall").addEventListener("click", (e) => { if (current) copyText(listing(), e.currentTarget); });
$("#h-dl").addEventListener("click", () => {
  if (!current) return;
  const url = URL.createObjectURL(textBlob(listing()));
  const a = el("a", { href: url, download: current.isFile ? current.name.replace(/[\\/]+/g, "_") + ".hashes.txt" : "hashes.txt" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});
$("#h-clear").addEventListener("click", () => {
  inEl.value = "";
  expectEl.value = "";
  const toText = $('input[name="mode"][value="text"]');
  toText.checked = true;
  setMode(false);
  inEl.focus();
});

hashText();
