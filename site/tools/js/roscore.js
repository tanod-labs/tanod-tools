// RouterOS helpers for the MikroTik tools: reading /export files, quoting values, checking typed input, rates,
// times, ports and address sets. Pure functions; everything runs in the browser and nothing is sent anywhere.
import { tx, EN, fmtNum } from "./core.js?v=11";
import { parseCidr, parseV4, parseV6, fmtV4, fmtV6, IpError } from "./dev3core.js?v=11";

export { IpError, fmtV4, fmtV6, parseV4, parseV6, parseCidr };

/* An input problem the tools show next to the field it came from. */
export class InputError extends Error {}

/* ================================================================== reading exports */

/* Logical lines of an export: CRLF normalised, "\" line continuations joined (the continuation's leading
   indentation dropped, as RouterOS does). Returns [{text, line}] with 1-based starting line numbers. */
export function logicalLines(text) {
  const src = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const start = i + 1;
    let s = src[i];
    while (/(^|[^\\])(\\\\)*\\$/.test(s) && i + 1 < src.length) {
      s = s.slice(0, -1) + src[++i].replace(/^\s+/, "");
    }
    out.push({ text: s, line: start });
  }
  return out;
}

/* Split a command line into tokens: quoted strings, [ ... ] and { ... } groups stay whole. */
export function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    let j = i, depthSq = 0, depthBr = 0, inQ = false;
    for (; j < n; j++) {
      const c = s[j];
      if (inQ) {
        if (c === "\\") { j++; continue; }
        if (c === '"') inQ = false;
        continue;
      }
      if (c === '"') { inQ = true; continue; }
      if (c === "[") depthSq++;
      else if (c === "]") depthSq = Math.max(0, depthSq - 1);
      else if (c === "{") depthBr++;
      else if (c === "}") depthBr = Math.max(0, depthBr - 1);
      else if (/\s/.test(c) && !depthSq && !depthBr) break;
    }
    toks.push(s.slice(i, j));
    i = j;
  }
  return toks;
}

/* Decode a RouterOS value: surrounding quotes removed and escapes (\" \\ \n \r \t \$ \? \_ \XX) decoded. */
export function unquote(v) {
  if (v.length < 2 || v[0] !== '"' || v[v.length - 1] !== '"') return v;
  const body = v.slice(1, -1);
  const bytes = [];
  const enc = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") { bytes.push(...enc.encode(c)); continue; }
    const d = body[++i];
    if (d === undefined) break;
    if (/[0-9A-Fa-f]/.test(d) && /[0-9A-Fa-f]/.test(body[i + 1] || "")) { bytes.push(parseInt(d + body[++i], 16)); continue; }
    const map = { n: 10, r: 13, t: 9, a: 7, b: 8, f: 12, v: 11, _: 32 };
    bytes.push(...(d in map ? [map[d]] : enc.encode(d)));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const COMMANDS = new Set(["add", "set", "remove", "enable", "disable", "print", "export", "edit", "unset", "reset",
  "move", "comment", "find", "get", "monitor", "run", "import", "cancel", "reset-counters", "reset-counters-all"]);

/* Parse an export or script into entries:
   {kind: "cmd", menu, cmd, args: {k: v}, keys: [k...], unset: [k...], pos: [...], find, line, raw}
   {kind: "comment", text, line} for "#" lines, {kind: "script", raw, line} for ":..." statements,
   {kind: "menu", menu, line} for a bare "/menu" line. Also returns header info {version, major, model}. */
export function parseExport(text) {
  const entries = [];
  const info = { version: null, major: null, model: null, softwareId: null };
  let menu = "";
  for (const { text: s0, line } of logicalLines(text)) {
    const s = s0.trim();
    if (!s) continue;
    if (s.startsWith("#")) {
      const body = s.replace(/^#\s?/, "");
      const v = body.match(/\bby RouterOS (\d+)\.(\d+)(?:\.(\d+))?(\S*)/);
      if (v && !info.version) { info.version = `${v[1]}.${v[2]}${v[3] ? "." + v[3] : ""}${v[4] || ""}`; info.major = Number(v[1]); info.minor = Number(v[2]); info.patch = Number(v[3] || 0); }
      const m = body.match(/^model\s*=\s*(.+)$/);
      if (m) info.model = m[1].trim();
      entries.push({ kind: "comment", text: body, line, raw: s });
      continue;
    }
    if (s.startsWith(":")) { entries.push({ kind: "script", raw: s, line, menu }); continue; }
    let toks = tokenize(s);
    if (s.startsWith("/")) {
      // "/ip firewall filter add ..." or "/ip/firewall/filter/add ..."
      const path = [];
      let first = toks.shift();
      const slashParts = first.split("/").filter(Boolean);
      path.push(...slashParts);
      while (toks.length && !COMMANDS.has(toks[0]) && !toks[0].includes("=") && /^[a-z0-9][a-z0-9-]*$/.test(toks[0]) && !(path.length && COMMANDS.has(path[path.length - 1]))) {
        path.push(toks.shift());
      }
      if (path.length && COMMANDS.has(path[path.length - 1]) && slashParts.length > 1) toks.unshift(path.pop());
      menu = "/" + path.join(" ");
      if (!toks.length) { entries.push({ kind: "menu", menu, line, raw: s }); continue; }
    }
    const cmd = toks.shift();
    const e = { kind: "cmd", menu, cmd, args: {}, keys: [], unset: [], pos: [], find: null, line, raw: s };
    for (const t of toks) {
      if (t.startsWith("[")) { e.find = t.replace(/^\[\s*/, "").replace(/\s*\]$/, "").replace(/^find\s*/, "").trim(); continue; }
      const eq = t.indexOf("=");
      if (t.startsWith("!") && eq < 0) { e.unset.push(t.slice(1)); continue; }
      if (eq > 0 && !t.startsWith('"')) {
        const k = t.slice(0, eq), v = unquote(t.slice(eq + 1));
        if (!(k in e.args)) e.keys.push(k);
        e.args[k] = v;
      } else e.pos.push(unquote(t));
    }
    entries.push(e);
  }
  return { entries, info };
}

/* Commands in one menu (exact path), in order. */
export const inMenu = (parsed, menu, cmd) => parsed.entries.filter((e) => e.kind === "cmd" && e.menu === menu && (!cmd || e.cmd === cmd));

/* The merged settings of a singleton menu such as /ip dns ("set key=value" lines without a target). */
export function settingsOf(parsed, menu) {
  const out = {};
  for (const e of inMenu(parsed, menu, "set")) if (!e.pos.length && !e.find) Object.assign(out, e.args);
  return out;
}

/* ================================================================== writing scripts */

const SAFE = /^[A-Za-z0-9_.:/,+*@!%-]+$/;

/* Quote a value for a RouterOS command when it needs it; non-ASCII bytes become \XX as in an export. */
export function q(v) {
  const s = String(v);
  if (s !== "" && SAFE.test(s)) return s;
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "$") out += "\\$";
    else if (ch === "?") out += "\\?";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c > 0x7e) for (const b of new TextEncoder().encode(ch)) out += "\\" + b.toString(16).toUpperCase().padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

/* "key=value" pairs from [[k, v], ...] or {k: v}; undefined/null/"" values are skipped, `true` prints a bare flag. */
export function kv(pairs) {
  const list = Array.isArray(pairs) ? pairs : Object.entries(pairs);
  return list.filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}=${q(v)}`)).join(" ");
}

export const LOCKOUT = "LOCK-OUT RISK: test in a lab first, or press Ctrl+X in the terminal (Safe Mode) before pasting this on a remote router, so the changes roll back if your session drops.";

/* A RouterOS script under construction. Comments are plain ASCII English so they survive any terminal. */
export class Script {
  constructor() { this.lines = []; this.menu = null; }
  header(title, version = "v7") {
    this.lines.push(`# ${title}`);
    this.lines.push(`# RouterOS ${version} syntax. Generated in your browser by Tanod Tools (https://tanod.dev/tools/).`);
    this.lines.push("# Review every line before use. Lines starting with # are comments.");
    return this;
  }
  blank() { if (this.lines.length && this.lines[this.lines.length - 1] !== "") this.lines.push(""); return this; }
  /* A comment block, wrapped at about 78 columns. */
  note(...texts) {
    for (const t of texts) {
      const words = String(t).split(/\s+/);
      let cur = "#";
      for (const w of words) {
        if (cur.length + 1 + w.length > 78 && cur !== "#") { this.lines.push(cur); cur = "#"; }
        cur += " " + w;
      }
      this.lines.push(cur);
    }
    return this;
  }
  section(menu, ...comments) { this.blank(); if (comments.length) this.note(...comments); this.lines.push(menu); this.menu = menu; return this; }
  cmd(cmd, pairs = [], { pos = [], find = null } = {}) {
    const parts = [cmd];
    if (find) parts.push(`[ find ${find} ]`);
    for (const p of pos) parts.push(q(p));
    const a = kv(pairs);
    if (a) parts.push(a);
    this.lines.push(parts.join(" "));
    return this;
  }
  raw(line) { this.lines.push(line); return this; }
  toString() { return this.lines.join("\n").replace(/\n+$/, "") + "\n"; }
}

/* ================================================================== checking input */

const NAME_RE = /^[A-Za-z0-9 _.:/@+()#-]+$/;

/* An interface, list, pool, profile or queue name. Returns the trimmed name or throws InputError. */
export function checkName(s, { optional = false, max = 64 } = {}) {
  const v = String(s ?? "").trim();
  if (!v) {
    if (optional) return "";
    throw new InputError(tx("Enter a name."));
  }
  if (v.length > max) throw new InputError(tx("Keep names to {max} characters or fewer.", { max }));
  if (!NAME_RE.test(v)) throw new InputError(tx("Use only letters, digits, spaces and - _ . : / @ + ( ) # in names."));
  return v;
}

/* Several names separated by commas or spaces (for example ether1, sfp-sfpplus1). */
export function checkNames(s, { optional = false } = {}) {
  const parts = String(s ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) {
    if (optional) return [];
    throw new InputError(tx("Enter at least one interface name."));
  }
  const seen = new Set();
  for (const p of parts) {
    checkName(p);
    if (seen.has(p)) throw new InputError(tx("{name} is listed twice.", { name: p }));
    seen.add(p);
  }
  return parts;
}

function wrapIp(fn) {
  try { return fn(); } catch (e) { if (e instanceof IpError) throw new InputError(e.message); throw e; }
}

/* A single IPv4 address. Returns {text, value: BigInt}. */
export function checkIp4(s, { optional = false } = {}) {
  const v = String(s ?? "").trim();
  if (!v) {
    if (optional) return null;
    throw new InputError(tx("Enter an IPv4 address, such as 192.168.88.1."));
  }
  if (v.includes("/")) throw new InputError(tx("Enter a single address here, without a /prefix."));
  if (v.includes(":")) throw new InputError(tx("This field takes an IPv4 address."));
  const value = wrapIp(() => parseV4(v));
  return { text: fmtV4(value), value };
}

/* An IPv4 or IPv6 address (no prefix). */
export function checkIp(s) {
  const v = String(s ?? "").trim();
  if (!v) throw new InputError(tx("Enter an IP address."));
  if (v.includes("/")) throw new InputError(tx("Enter a single address here, without a /prefix."));
  const six = v.includes(":");
  const value = wrapIp(() => (six ? parseV6(v) : parseV4(v)));
  return { version: six ? 6 : 4, value, text: six ? fmtV6(value) : fmtV4(value) };
}

/* An address with a prefix: {version, addr, prefix, network, last, text (network/prefix), hostText (as typed,
   normalised), hostBits (true when the address had host bits set)}. A bare address is a /32 or /128 unless
   requirePrefix is set. */
export function checkCidr(s, { version = null, requirePrefix = false, optional = false } = {}) {
  const v = String(s ?? "").trim();
  if (!v) {
    if (optional) return null;
    throw new InputError(version === 6 ? tx("Enter an IPv6 prefix, such as 2001:db8::/64.") : tx("Enter a network with its prefix length, such as 192.168.88.0/24."));
  }
  if (/\s/.test(v)) throw new InputError(tx("Write the prefix length after a slash, such as 192.168.88.0/24."));
  const c = wrapIp(() => parseCidr(v));
  if (version && c.version !== version) throw new InputError(version === 4 ? tx("This field takes an IPv4 network.") : tx("This field takes an IPv6 prefix."));
  if (requirePrefix && !c.hadPrefix) throw new InputError(tx("Add the prefix length, such as /24."));
  const bits = c.version === 4 ? 32 : 128;
  const hostMask = (1n << BigInt(bits - c.prefix)) - 1n;
  const network = c.addr & ~hostMask & ((1n << BigInt(bits)) - 1n);
  const fmt = c.version === 4 ? fmtV4 : fmtV6;
  return {
    version: c.version, addr: c.addr, prefix: c.prefix, network, last: network | hostMask, bits,
    text: `${fmt(network)}/${c.prefix}`, hostText: `${fmt(c.addr)}/${c.prefix}`, hostBits: network !== c.addr,
  };
}

/* Several networks, comma, space or newline separated. */
export function checkCidrs(s, opts = {}) {
  const parts = String(s ?? "").split(/[,\s]+/).filter(Boolean);
  if (!parts.length) {
    if (opts.optional) return [];
    throw new InputError(tx("Enter at least one network, such as 192.168.88.0/24."));
  }
  return parts.map((p) => checkCidr(p, opts));
}

export const inNet = (net, value) => value >= net.network && value <= net.last;

/* ---- rates (bits per second) */

/* "10M", "512k", "1.5M", "2G", "800000" -> bits per second. Throws InputError. */
export function parseRate(s, { optional = false, allowZero = false } = {}) {
  const v = String(s ?? "").trim().replace(/\s+/g, "").replace(/(bps|bit\/s|b\/s|bits?)$/i, "");
  if (!v) {
    if (optional) return null;
    throw new InputError(tx("Enter a rate, such as 10M or 512k."));
  }
  const m = v.replace(",", ".").match(/^(\d+(?:\.\d+)?)([kKmMgG]?)$/);
  if (!m) throw new InputError(tx("Write rates as a number with an optional k, M or G, such as 512k, 10M or 1G."));
  const mult = { "": 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase()];
  const bps = Math.round(Number(m[1]) * mult);
  if (!bps && !allowZero) throw new InputError(tx("The rate must be more than 0."));
  if (bps > 400e9) throw new InputError(tx("That rate is larger than any RouterOS interface."));
  return bps;
}

/* Bits per second -> the shortest exact RouterOS form: 10M, 1500k, 2G, 64000. */
export function fmtRate(bps) {
  if (!bps) return "0";
  for (const [d, u] of [[1e9, "G"], [1e6, "M"], [1e3, "k"]]) if (bps % d === 0) return bps / d + u;
  return String(Math.round(bps));
}

/* A human reading of a rate for the page: "10 Mbit/s". */
export function humanRate(bps) {
  const [d, u] = bps >= 1e9 ? [1e9, "Gbit/s"] : bps >= 1e6 ? [1e6, "Mbit/s"] : bps >= 1e3 ? [1e3, "kbit/s"] : [1, "bit/s"];
  const n = bps / d;
  const shown = EN ? String(Math.round(n * 100) / 100) : fmtNum(Math.round(n * 100) / 100);
  return `${shown} ${u}`;
}

/* ---- times */

/* RouterOS time: "30s", "10m", "1h30m", "1d", "2w", "00:10:00" or a plain number of seconds -> seconds. */
export function parseTime(s, { optional = false, allowZero = false } = {}) {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v) {
    if (optional) return null;
    throw new InputError(tx("Enter a time, such as 30s, 10m, 1h or 1d."));
  }
  let secs = null;
  if (/^\d+$/.test(v)) secs = Number(v);
  else if (/^\d+:\d{1,2}:\d{1,2}$/.test(v)) { const [h, m, x] = v.split(":").map(Number); if (m < 60 && x < 60) secs = h * 3600 + m * 60 + x; }
  else {
    const m = v.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (m && m.slice(1).some((x) => x !== undefined)) secs = (+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0);
  }
  if (secs === null) throw new InputError(tx("Write times like 30s, 10m, 1h30m, 1d or 2w."));
  if (!secs && !allowZero) throw new InputError(tx("The time must be more than 0."));
  return secs;
}

/* Seconds -> RouterOS form: 1d2h, 10m, 45s. */
export function fmtTime(secs) {
  if (!secs) return "0s";
  let s = Math.round(secs), out = "";
  for (const [d, u] of [[604800, "w"], [86400, "d"], [3600, "h"], [60, "m"], [1, "s"]]) {
    if (s >= d) { out += Math.floor(s / d) + u; s %= d; }
  }
  return out;
}

/* ---- ports */

/* "80", "80,443", "8000-8010" -> {text, ranges: [[lo, hi]], count}. */
export function parsePorts(s, { optional = false, single = false } = {}) {
  const v = String(s ?? "").trim().replace(/\s+/g, "");
  if (!v) {
    if (optional) return null;
    throw new InputError(tx("Enter a port, such as 443, a list such as 80,443 or a range such as 8000-8010."));
  }
  const ranges = [];
  for (const p of v.split(",")) {
    const m = p.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!m) throw new InputError(tx("\"{text}\" isn't a port. Use numbers from 1 to 65535, commas and ranges like 8000-8010.", { text: p }));
    const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo;
    if (lo < 1 || hi > 65535 || lo > 65535) throw new InputError(tx("Ports run from 1 to 65535."));
    if (hi < lo) throw new InputError(tx("In the range {text} the first port must be the lower one.", { text: p }));
    ranges.push([lo, hi]);
  }
  const count = ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
  if (single && (ranges.length > 1 || count > 1)) throw new InputError(tx("Enter a single port here."));
  return { text: ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(","), ranges, count };
}

/* Is every port of b inside a? (both from parsePorts) */
export function portsCover(a, b) {
  return b.ranges.every(([lo, hi]) => {
    let x = lo;
    const sorted = [...a.ranges].sort((p, r) => p[0] - r[0]);
    for (const [alo, ahi] of sorted) if (alo <= x && ahi >= x) x = ahi + 1;
    return x > hi;
  });
}

/* ---- MAC addresses */
export function checkMac(s) {
  const v = String(s ?? "").trim();
  const hex = v.replace(/[:.\-\s]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(hex) || !/^([0-9a-fA-F]{2}([:-]?)){5}[0-9a-fA-F]{2}$|^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$/.test(v)) {
    throw new InputError(tx("Enter a MAC address such as AA:BB:CC:DD:EE:FF."));
  }
  return hex.toUpperCase().match(/../g).join(":");
}

/* ================================================================== address sets */

/* One address, network or range: "10.0.0.1", "10.0.0.0/8", "10.0.0.1-10.0.0.9", IPv6 too.
   Returns {version, lo, hi, hostBits}. Throws InputError. */
export function parseAddrItem(s) {
  const v = String(s).trim();
  const dash = v.indexOf("-");
  if (dash > 0 && !v.includes("/")) {
    const a = checkIp(v.slice(0, dash)), b = checkIp(v.slice(dash + 1));
    if (a.version !== b.version) throw new InputError(tx("A range must start and end in the same IP version."));
    if (b.value < a.value) throw new InputError(tx("In the range {text} the first address must be the lower one.", { text: v }));
    return { version: a.version, lo: a.value, hi: b.value, hostBits: false };
  }
  const c = checkCidr(v);
  return { version: c.version, lo: c.network, hi: c.last, hostBits: c.hostBits };
}

/* Sort and merge overlapping or adjacent intervals of one IP version. */
export function mergeIntervals(items) {
  const sorted = [...items].sort((a, b) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0));
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && it.lo <= last.hi + 1n) { if (it.hi > last.hi) last.hi = it.hi; }
    else out.push({ lo: it.lo, hi: it.hi });
  }
  return out;
}

/* The fewest CIDR blocks that exactly cover lo..hi. */
export function rangeToCidrs(lo, hi, bits) {
  const out = [];
  let x = lo;
  while (x <= hi) {
    let size = 0;   // block of 2^size addresses
    while (size < bits) {
      const nsize = size + 1;
      const block = 1n << BigInt(nsize);
      if (x % block !== 0n || x + block - 1n > hi) break;
      size = nsize;
    }
    out.push({ addr: x, prefix: bits - size });
    x += 1n << BigInt(size);
  }
  return out;
}

export const fmtCidr = (version, addr, prefix) => `${version === 4 ? fmtV4(addr) : fmtV6(addr)}/${prefix}`;

/* RouterOS writes a /32 (or /128) address-list entry as a bare address. */
export const fmtListAddr = (version, addr, prefix) => (prefix === (version === 4 ? 32 : 128) ? (version === 4 ? fmtV4(addr) : fmtV6(addr)) : fmtCidr(version, addr, prefix));

/* ================================================================== secrets */

const SECRET_KEYS = /^(password|secret|private-key|preshared-key|tcp-md5-key|auth-key|authentication-key|passphrase|wpa-pre-shared-key|wpa2-pre-shared-key|wpa3-pre-shared-key|pre-shared-key|key|ipsec-secret|community|authentication-password|encryption-password|mac-key)$/;

export const isSecretKey = (k) => SECRET_KEYS.test(k);

/* Replace secret values in a raw command line with *****. */
export function maskSecrets(line) {
  return line.replace(/(^|\s)([a-z0-9-]+)=("(?:[^"\\]|\\.)*"|\S+)/g, (m, sp, k, v) => (isSecretKey(k) ? `${sp}${k}=*****` : m));
}
