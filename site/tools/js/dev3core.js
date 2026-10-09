// Pure logic for developer tools set 3 (no DOM): JSON to TypeScript, IPv4/IPv6 subnets, chmod modes and the cron builder.
import { tx, txn, fmtNum, EN } from "./i18n.js?v=11";

/* ================================================================== JSON to TypeScript */

const RESERVED_NAMES = new Set(["Array", "Object", "String", "Number", "Boolean", "Date", "Map", "Set", "WeakMap", "WeakSet", "Record",
  "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "Promise", "Error", "Function", "Symbol",
  "BigInt", "RegExp", "JSON", "Math", "Awaited", "ReturnType", "Parameters"]);
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const isIdentifier = (s) => IDENT.test(s);

/* PascalCase from a JSON key: split on anything that is not a letter or digit, upper-case each part's first letter,
   keep the rest as written ("firstName" -> "FirstName", "user_id" -> "UserId", "billing-address" -> "BillingAddress"). */
export function pascal(key) {
  const parts = String(key).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let s = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  if (!s) return "Item";
  if (/^\p{N}/u.test(s)) s = "_" + s;
  return s;
}

/* Name for the elements of an array property: strip a trailing "s" when the name is longer than 3 characters and does not
   end in "ss", "us" or "is" ("users" -> "User", "address" -> "AddressItem", "status" -> "StatusItem"); otherwise append "Item". */
export function itemName(name) {
  if (name.length > 3 && /s$/i.test(name) && !/(ss|us|is)$/i.test(name)) return name.slice(0, -1);
  return name + "Item";
}

const prim = (name) => ({ prims: new Set([name]), obj: null, arr: null });

function infer(value, hint) {
  if (value === null) return prim("null");
  if (Array.isArray(value)) {
    const eh = itemName(hint);
    let elem = null;
    for (const v of value) { const t = infer(v, eh); elem = elem ? mergeTypes(elem, t) : t; }
    return { prims: new Set(), obj: null, arr: { elem } };
  }
  switch (typeof value) {
    case "string": return prim("string");
    case "number": return prim("number");
    case "boolean": return prim("boolean");
    default: {
      const props = new Map();
      for (const k of Object.keys(value)) props.set(k, { t: infer(value[k], pascal(k)), c: 1 });
      return { prims: new Set(), obj: { n: 1, props, hint }, arr: null };
    }
  }
}

function mergeTypes(a, b) {
  const prims = new Set([...a.prims, ...b.prims]);
  let obj = a.obj || b.obj, arr = a.arr || b.arr;
  if (a.obj && b.obj) {
    const props = new Map();
    for (const [k, v] of a.obj.props) props.set(k, { t: v.t, c: v.c });
    for (const [k, v] of b.obj.props) {
      const cur = props.get(k);
      if (cur) { cur.t = mergeTypes(cur.t, v.t); cur.c += v.c; } else props.set(k, { t: v.t, c: v.c });
    }
    obj = { n: a.obj.n + b.obj.n, props, hint: a.obj.hint };
  }
  if (a.arr && b.arr) arr = { elem: a.arr.elem && b.arr.elem ? mergeTypes(a.arr.elem, b.arr.elem) : a.arr.elem || b.arr.elem };
  return { prims, obj, arr };
}

/* options: {rootName, style: "interface"|"type", exportKw, readonly, optional}. Throws Error with a plain message for bad JSON. */
export function jsonToTs(text, opts = {}) {
  const o = { rootName: "Root", style: "interface", exportKw: true, readonly: false, optional: true, ...opts };
  if (!isIdentifier(o.rootName)) throw new Error(tx("\"{name}\" can't be used as a type name. Start with a letter, _ or $ and use only letters, digits, _ and $.", { name: o.rootName }));
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(tx("This isn't valid JSON: {detail}", { detail: e.message })); }
  const root = infer(data, o.rootName);

  const entries = []; // declarations in discovery order; deduplicated ones are removed
  const canon = new Map();
  let nextId = 1;
  const ro = o.readonly ? "readonly " : "";

  // A rendered type is a list of parts: strings and declaration entries (named once all declarations are known).
  function walk(t) {
    const members = [];
    for (const p of ["string", "number", "boolean"]) if (t.prims.has(p)) members.push([p]);
    if (t.obj) members.push([declare(t.obj)]);
    if (t.arr) {
      if (!t.arr.elem) members.push([`${ro}unknown[]`]);
      else {
        const inner = walk(t.arr.elem);
        const multi = inner.members > 1;
        members.push([ro, multi ? "(" : "", ...inner.parts, multi ? ")" : "", "[]"]);
      }
    }
    if (t.prims.has("null")) members.push(["null"]);
    const parts = [];
    members.forEach((m, i) => { if (i) parts.push(" | "); parts.push(...m); });
    return { parts, members: members.length };
  }

  function declare(obj) {
    const entry = { id: nextId++, hint: obj.hint, lines: null, alias: null };
    entries.push(entry);
    const lines = [];
    for (const [k, v] of obj.props) {
      const r = walk(v.t);
      lines.push({ key: k, optional: o.optional && v.c < obj.n, parts: r.parts });
    }
    entry.lines = lines;
    const key = JSON.stringify(lines.map((l) => [l.key, l.optional, l.parts.map((p) => (typeof p === "string" ? p : "#" + p.id))]));
    const same = canon.get(key);
    if (same && entry !== entries[0]) {
      entries.splice(entries.indexOf(entry), 1);
      entry.alias = same;
      return same;
    }
    canon.set(key, entry);
    return entry;
  }

  const rootIsObject = !!root.obj && !root.prims.size && !root.arr;
  const body = rootIsObject ? null : walk(root);
  if (rootIsObject) declare(root.obj);

  const taken = new Set([...RESERVED_NAMES, o.rootName]);
  const names = new Map();
  entries.forEach((e, i) => {
    if (rootIsObject && i === 0) { names.set(e, o.rootName); return; }
    let n = e.hint;
    for (let k = 2; taken.has(n); k++) n = e.hint + k;
    taken.add(n);
    names.set(e, n);
  });
  const show = (parts) => parts.map((p) => (typeof p === "string" ? p : names.get(p.alias || p))).join("");
  const ex = o.exportKw ? "export " : "";
  const out = [];
  if (!rootIsObject) out.push(`${ex}type ${o.rootName} = ${show(body.parts)};`);
  for (const e of entries) {
    const props = e.lines.map((l) => `  ${ro}${isIdentifier(l.key) ? l.key : JSON.stringify(l.key)}${l.optional ? "?" : ""}: ${show(l.parts)};`);
    const name = names.get(e);
    if (o.style === "type") out.push(props.length ? `${ex}type ${name} = {\n${props.join("\n")}\n};` : `${ex}type ${name} = {};`);
    else out.push(props.length ? `${ex}interface ${name} {\n${props.join("\n")}\n}` : `${ex}interface ${name} {}`);
  }
  return out.join("\n\n") + "\n";
}

/* ================================================================== IP addresses and subnets */

export class IpError extends Error {}

const group3 = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const fmtBig = (n) => (EN ? group3(n.toString()) : fmtNum(n));

/* ---- IPv4 */
export function parseV4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) throw new IpError(txn(parts.length, "\"{text}\" has {n} part separated by dots; an IPv4 address has exactly 4, like 192.168.1.10.", "\"{text}\" has {n} parts separated by dots; an IPv4 address has exactly 4, like 192.168.1.10.", { text }));
  let v = 0n;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new IpError(tx("\"{part}\" isn't a number between 0 and 255. IPv4 parts use only digits, like 192.168.1.10.", { part: p || tx("(empty)") }));
    if (p.length > 1 && p[0] === "0") throw new IpError(tx("\"{part}\" has a leading zero. Some systems read that as an octal (base 8) number and others as decimal, so the address is ambiguous. Remove the leading zero ({value}) so the meaning is clear.", { part: p, value: Number(p) }));
    if (p.length > 3 || Number(p) > 255) throw new IpError(tx("{part} is larger than 255. Each IPv4 part is a single byte, from 0 to 255.", { part: p }));
    v = (v << 8n) | BigInt(Number(p));
  }
  return v;
}
export function fmtV4(v) { return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 255n)).join("."); }

/* ---- IPv6 */
export function parseV6(text) {
  let s = text;
  if (/%/.test(s)) throw new IpError(tx("A zone ID (the part after %, such as %eth0) isn't part of the address. Remove it to calculate the subnet."));
  if (!/^[0-9a-fA-F:.]+$/.test(s)) throw new IpError(tx("\"{text}\" contains characters that don't belong in an IPv6 address. Use hexadecimal digits (0-9, a-f), colons and, at the end, an optional IPv4 part.", { text }));
  const dbl = s.split("::");
  if (dbl.length > 2) throw new IpError(tx("An IPv6 address can use :: only once, because two of them would make it unclear how many zero groups each stands for."));
  if (s.includes(":::")) throw new IpError(tx("Three colons in a row aren't valid. Use :: once to stand for a run of zero groups."));
  const toGroups = (part) => (part === "" ? [] : part.split(":"));
  let head = toGroups(dbl[0]), tail = dbl.length === 2 ? toGroups(dbl[1]) : [];
  const all = dbl.length === 2 ? [...head, ...tail] : head;
  if (dbl.length === 1 && s.startsWith(":")) throw new IpError(tx("An IPv6 address can't start with a single colon. Start with a group, or with :: for leading zeros."));
  if (dbl.length === 1 && s.endsWith(":")) throw new IpError(tx("An IPv6 address can't end with a single colon. End with a group, or with :: for trailing zeros."));
  const parseGroups = (arr, isTail) => {
    const out = [];
    arr.forEach((g, i) => {
      const last = i === arr.length - 1 && (isTail || dbl.length === 1);
      if (g.includes(".")) {
        if (!last) throw new IpError(tx("An embedded IPv4 part (such as 192.0.2.1) must be the last thing in the address."));
        const v = parseV4(g);
        out.push(Number(v >> 16n), Number(v & 0xffffn));
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new IpError(g === "" ? tx("There is an empty group between single colons. Use :: if you meant a run of zero groups.") : tx("\"{group}\" isn't a valid group. Each group is 1 to 4 hexadecimal digits.", { group: g }));
        out.push(parseInt(g, 16));
      }
    });
    return out;
  };
  let groups;
  if (dbl.length === 2) {
    // an embedded IPv4 part may only be in the tail (or the head when there is no tail)
    const h = parseGroups(head, tail.length === 0);
    const t = parseGroups(tail, true);
    const n = h.length + t.length;
    if (n > 7) throw new IpError(tx("With :: the address needs at most 7 other groups, but this has {n}. :: has to stand for at least one group of zeros.", { n }));
    groups = [...h, ...Array(8 - n).fill(0), ...t];
  } else {
    groups = parseGroups(head, true);
    if (groups.length !== 8) throw new IpError(groups.length < 8 ? tx("An IPv6 address has 8 groups, but this has {n}; shorten a run of zero groups with :: if you meant to.", { n: groups.length }) : tx("An IPv6 address has 8 groups, but this has {n}.", { n: groups.length }));
  }
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(g);
  return v;
}
export function v6Groups(v) { return Array.from({ length: 8 }, (_, i) => Number((v >> BigInt((7 - i) * 16)) & 0xffffn)); }
export function fmtV6Full(v) { return v6Groups(v).map((g) => g.toString(16).padStart(4, "0")).join(":"); }
/* RFC 5952: lowercase, no leading zeros, the longest run of two or more zero groups becomes ::, leftmost on a tie. */
export function fmtV6(v) {
  const g = v6Groups(v).map((x) => x.toString(16));
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== "0") { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === "0") j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  if (bestLen < 2) return g.join(":");
  return g.slice(0, best).join(":") + "::" + g.slice(best + bestLen).join(":");
}

/* ---- classification */
const net4 = (a, p) => [parseV4(a), p];
const V4_KINDS = [
  [net4("0.0.0.0", 8), tx("This network (0.0.0.0/8, RFC 1122), not routable as a destination")],
  [net4("10.0.0.0", 8), tx("Private (RFC 1918)")],
  [net4("100.64.0.0", 10), tx("Carrier-grade NAT shared space (RFC 6598)")],
  [net4("127.0.0.0", 8), tx("Loopback (RFC 1122)")],
  [net4("169.254.0.0", 16), tx("Link-local (RFC 3927)")],
  [net4("172.16.0.0", 12), tx("Private (RFC 1918)")],
  [net4("192.0.0.0", 24), tx("IETF protocol assignments (RFC 6890)")],
  [net4("192.0.2.0", 24), tx("Documentation, TEST-NET-1 (RFC 5737)")],
  [net4("192.168.0.0", 16), tx("Private (RFC 1918)")],
  [net4("198.18.0.0", 15), tx("Network benchmarking (RFC 2544)")],
  [net4("198.51.100.0", 24), tx("Documentation, TEST-NET-2 (RFC 5737)")],
  [net4("203.0.113.0", 24), tx("Documentation, TEST-NET-3 (RFC 5737)")],
  [net4("224.0.0.0", 4), tx("Multicast (RFC 5771)")],
  [net4("255.255.255.255", 32), tx("Limited broadcast (RFC 919)")],
  [net4("240.0.0.0", 4), tx("Reserved for future use (RFC 1112)")],
];
export function kindV4(a) {
  for (const [[n, p], label] of V4_KINDS) if ((a >> BigInt(32 - p)) === (n >> BigInt(32 - p))) return label;
  return tx("Public (globally routable)");
}
const V6_KINDS = [
  ["::", 128, tx("Unspecified address (::)")],
  ["::1", 128, tx("Loopback (::1)")],
  ["::ffff:0:0", 96, tx("IPv4-mapped (::ffff:0:0/96)")],
  ["64:ff9b::", 96, tx("IPv4/IPv6 translation, NAT64 (RFC 6052)")],
  ["fe80::", 10, tx("Link-local unicast (fe80::/10)")],
  ["fc00::", 7, tx("Unique local address, ULA (fc00::/7)")],
  ["ff00::", 8, tx("Multicast (ff00::/8)")],
  ["2001:db8::", 32, tx("Documentation (2001:db8::/32, RFC 3849)")],
  ["3fff::", 20, tx("Documentation (3fff::/20, RFC 9637)")],
  ["2000::", 3, tx("Global unicast (2000::/3)")],
];
export function kindV6(a) {
  for (const [n, p, label] of V6_KINDS) {
    const nv = parseV6(n);
    if ((a >> BigInt(128 - p)) === (nv >> BigInt(128 - p))) return label;
  }
  return tx("Reserved or unassigned (outside the global unicast range 2000::/3)");
}

/* ---- input parsing */
function prefixFromMask(maskText) {
  const m = parseV4(maskText);
  const inv = m ^ 0xffffffffn;
  if ((inv & (inv + 1n)) !== 0n) throw new IpError(tx("{mask} isn't a valid subnet mask: its 1 bits must all come first and its 0 bits last (like 255.255.255.0). If this is a wildcard mask, convert it to a netmask first.", { mask: maskText }));
  let p = 0;
  for (let b = 31n; b >= 0n && (m >> b) & 1n; b--) p++;
  return p;
}

/* Returns {version: 4|6, addr: BigInt, prefix, hadPrefix}. Accepts "ip", "ip/prefix", "ip/mask", "ip mask". */
export function parseCidr(input) {
  let s = input.trim();
  if (!s) throw new IpError(tx("Type an address with a prefix length, such as 192.168.1.10/24 or 2001:db8::/32."));
  let addrText = s, maskText = null;
  const slash = s.indexOf("/");
  if (slash >= 0) { addrText = s.slice(0, slash).trim(); maskText = s.slice(slash + 1).trim(); }
  else if (/\s/.test(s)) {
    const bits = s.split(/\s+/);
    if (bits.length !== 2) throw new IpError(tx("Use one of these forms: 192.168.1.10/24, 192.168.1.10 255.255.255.0, or just an address."));
    [addrText, maskText] = bits;
  }
  if (addrText.startsWith("[") && addrText.endsWith("]")) addrText = addrText.slice(1, -1);
  const v6 = addrText.includes(":");
  const bitsTotal = v6 ? 128 : 32;
  const addr = v6 ? parseV6(addrText) : parseV4(addrText);
  let prefix = bitsTotal, hadPrefix = false;
  if (maskText !== null) {
    hadPrefix = true;
    if (maskText === "") throw new IpError(tx("There is nothing after the /. Add a prefix length, such as /24."));
    if (maskText.includes(".")) {
      if (v6) throw new IpError(tx("IPv6 uses prefix lengths such as /64, not dotted masks."));
      prefix = prefixFromMask(maskText);
    } else {
      if (!/^\d+$/.test(maskText)) throw new IpError(tx("\"{text}\" isn't a prefix length. Use a number from 0 to {max}, or a dotted mask like 255.255.255.0.", { text: maskText, max: bitsTotal }));
      prefix = Number(maskText);
      if (prefix > bitsTotal) throw new IpError(v6 ? tx("/{prefix} is too long for IPv6; the prefix length is from 0 to {max}.", { prefix, max: bitsTotal }) : tx("/{prefix} is too long for IPv4; the prefix length is from 0 to {max}.", { prefix, max: bitsTotal }));
    }
  }
  return { version: v6 ? 6 : 4, addr, prefix, hadPrefix };
}

/* The numbers behind a subnet. */
export function subnetInfo({ version, addr, prefix }) {
  const bits = version === 4 ? 32 : 128;
  const hostBits = BigInt(bits - prefix);
  const all = (1n << BigInt(bits)) - 1n;
  const hostMask = (1n << hostBits) - 1n;
  const mask = all ^ hostMask;
  const network = addr & mask;
  const last = network | hostMask;
  const total = 1n << hostBits;
  const info = { version, bits, prefix, addr, mask, hostMask, network, last, total, normalised: network !== addr };
  if (version === 4) {
    if (prefix === 32) Object.assign(info, { usable: 1n, first: network, lastHost: network, broadcast: null, mode: "single" });
    else if (prefix === 31) Object.assign(info, { usable: 2n, first: network, lastHost: last, broadcast: null, mode: "p2p" });
    else Object.assign(info, { usable: total - 2n, first: network + 1n, lastHost: last - 1n, broadcast: last, mode: "normal" });
  } else {
    Object.assign(info, { usable: total, first: network, lastHost: last, broadcast: null, mode: prefix === 128 ? "single" : "normal" });
  }
  return info;
}

/* Address kind for a whole subnet: one label when its first and last address agree, otherwise a mixed note. */
export function kindOfSubnet(info) {
  if (info.prefix === 0) return info.version === 4 ? tx("The whole IPv4 address space (it spans private, public, multicast and reserved ranges)") : tx("The whole IPv6 address space (it spans every address type)");
  const f = info.version === 4 ? kindV4 : kindV6;
  const a = f(info.network), b = f(info.last);
  if (a === b) return a;
  return tx("Mixed: the range starts in \"{a}\" and ends in \"{b}\"", { a, b });
}

/* Split a subnet into smaller ones of length `to`. Returns {rows: [{network, first, last}], total, capped}. */
export function splitSubnet(info, to, cap = 256) {
  const n = to - info.prefix;
  const total = 1n << BigInt(n);
  const count = total > BigInt(cap) ? cap : Number(total);
  const size = 1n << BigInt(info.bits - to);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const net = info.network + BigInt(i) * size;
    rows.push({ network: net, last: net + size - 1n });
  }
  return { rows, total, capped: total > BigInt(cap) };
}

/* ================================================================== chmod */

export class ModeError extends Error {}

/* bit layout: 0o4000 setuid, 0o2000 setgid, 0o1000 sticky, then rwx for owner, group, others */
export function parseOctal(text) {
  const s = text.trim();
  if (!s) throw new ModeError(tx("Type an octal mode such as 755 or 4755."));
  if (!/^\d+$/.test(s)) throw new ModeError(tx("\"{text}\" has characters that aren't digits. An octal mode is 3 or 4 digits, each from 0 to 7.", { text: s }));
  if (/[89]/.test(s)) throw new ModeError(tx("{digit} isn't an octal digit. Each digit is a sum of read 4, write 2 and execute 1, so it runs from 0 to 7.", { digit: s.match(/[89]/)[0] }));
  if (s.length > 4) throw new ModeError(tx("An octal mode has at most 4 digits (special bits, owner, group, others). Remove the extra digits."));
  if (s.length < 3) throw new ModeError(tx("Give 3 digits (owner, group, others) such as 644, or 4 with the special bits first such as 4755."));
  return parseInt(s, 8);
}

export function parseSymbolic(text) {
  let s = text.trim();
  if (!s) throw new ModeError(tx("Type a symbolic mode such as rwxr-xr-x."));
  if (s.length === 10 && "-dlcbps".includes(s[0])) s = s.slice(1);
  if (s.length !== 9) throw new ModeError(tx("A symbolic mode is 9 characters (3 each for owner, group, others), like rwxr-xr-x; this has {n}.", { n: s.length }));
  const who = [tx("owner"), tx("group"), tx("others")];
  let mode = 0;
  for (let i = 0; i < 9; i++) {
    const c = s[i], k = i % 3, w = who[(i / 3) | 0];
    const sh = 6 - ((i / 3) | 0) * 3;
    if (k === 0) { if (c === "r") mode |= 4 << sh; else if (c !== "-") throw new ModeError(tx("Character {pos} ({who} read) must be r or -, not \"{c}\".", { pos: i + 1, who: w, c })); }
    else if (k === 1) { if (c === "w") mode |= 2 << sh; else if (c !== "-") throw new ModeError(tx("Character {pos} ({who} write) must be w or -, not \"{c}\".", { pos: i + 1, who: w, c })); }
    else {
      const sp = i === 8 ? "t" : "s";
      if (c === "x") mode |= 1 << sh;
      else if (c === sp) mode |= (1 << sh) | (i === 2 ? 0o4000 : i === 5 ? 0o2000 : 0o1000);
      else if (c === sp.toUpperCase()) mode |= i === 2 ? 0o4000 : i === 5 ? 0o2000 : 0o1000;
      else if (c !== "-") throw new ModeError(tx("Character {pos} ({who} execute) must be x, - or {sp}/{spUpper}, not \"{c}\".", { pos: i + 1, who: w, sp, spUpper: sp.toUpperCase(), c }));
    }
  }
  return mode;
}

export function toOctal(mode) {
  const body = (mode & 0o777).toString(8).padStart(3, "0");
  const special = (mode >> 9) & 7;
  return special ? special + body : body;
}

export function toSymbolic(mode) {
  const triple = (shift, special, ch) => {
    const b = (mode >> shift) & 7;
    const x = b & 1 ? (special ? ch : "x") : special ? ch.toUpperCase() : "-";
    return (b & 4 ? "r" : "-") + (b & 2 ? "w" : "-") + x;
  };
  return triple(6, mode & 0o4000, "s") + triple(3, mode & 0o2000, "s") + triple(0, mode & 0o1000, "t");
}

const shellQuote = (s) => (/^[A-Za-z0-9_./@%+=:,-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
export function chmodCommands(mode, file = "file") {
  const f = shellQuote(file || "file");
  const cls = (shift, special, ch) => {
    const b = (mode >> shift) & 7;
    return (b & 4 ? "r" : "") + (b & 2 ? "w" : "") + (b & 1 ? "x" : "") + (special ? ch : "");
  };
  const sym = `u=${cls(6, mode & 0o4000, "s")},g=${cls(3, mode & 0o2000, "s")},o=${cls(0, mode & 0o1000, "t")}`;
  return { numeric: `chmod ${toOctal(mode)} ${f}`, symbolic: `chmod ${sym} ${f}` };
}

/* ================================================================== cron builder */

export const CRON_FIELDS = [
  { key: "minute", label: tx("Minute"), min: 0, max: 59 },
  { key: "hour", label: tx("Hour"), min: 0, max: 23 },
  { key: "dom", label: tx("Day of month"), min: 1, max: 31 },
  { key: "month", label: tx("Month"), min: 1, max: 12 },
  { key: "dow", label: tx("Day of week"), min: 0, max: 6 },
];

/* field state: {mode: "every"|"step"|"values"|"range"|"custom", step, start, values: number[], from, to, custom} */
export function defaultField(i) {
  const f = CRON_FIELDS[i];
  return { mode: "every", step: i === 0 ? 15 : 2, start: f.min, values: [], from: f.min, to: f.max, custom: "" };
}

/* Compress sorted values: runs of three or more consecutive numbers become a-b, everything else stays a list. */
export function compressValues(values) {
  const v = [...new Set(values)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < v.length;) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
    if (j - i >= 2) out.push(`${v[i]}-${v[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(v[k]));
    i = j + 1;
  }
  return out.join(",");
}

/* One field's text, or throws Error with a plain message. */
export function fieldText(i, f) {
  const d = CRON_FIELDS[i];
  /* English writes the field name in lower case inside a sentence; other languages use the label as translated. */
  const lbl = EN ? d.label.toLowerCase() : d.label;
  switch (f.mode) {
    case "every": return "*";
    case "custom": return f.custom;
    case "step": {
      const n = Number(f.step), s = Number(f.start);
      if (!Number.isInteger(n) || n < 1) throw new Error(tx("Set the {field} step to a whole number of 1 or more.", { field: lbl }));
      if (!Number.isInteger(s) || s < d.min || s > d.max) throw new Error(tx("The {field} start must be between {min} and {max}.", { field: lbl, min: d.min, max: d.max }));
      if (n > d.max - d.min) throw new Error(tx("A {field} step of {n} is larger than the whole field ({min}-{max}). Use specific values instead.", { field: lbl, n, min: d.min, max: d.max }));
      if (s === d.min) return n === 1 ? "*" : `*/${n}`;
      return n === 1 ? `${s}-${d.max}` : `${s}-${d.max}/${n}`;
    }
    case "values": {
      if (!f.values.length) throw new Error(tx("Pick at least one {field} value.", { field: lbl }));
      if (f.values.length === d.max - d.min + 1) return "*";
      return compressValues(f.values);
    }
    case "range": {
      const a = Number(f.from), b = Number(f.to);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < d.min || b > d.max) throw new Error(tx("The {field} range must use whole numbers from {min} to {max}.", { field: lbl, min: d.min, max: d.max }));
      if (a > b) throw new Error(tx("The {field} range runs backwards ({a} to {b}). Cron ranges go from low to high; use specific values for a range that wraps around.", { field: lbl, a, b }));
      if (a === d.min && b === d.max) return "*";
      return a === b ? String(a) : `${a}-${b}`;
    }
  }
  return "*";
}

/* Map one parsed cron field back to builder state, or {mode: "custom"}. `f` is a croncore field (raw, values, star, all). */
export function fieldFromParsed(i, f) {
  const d = CRON_FIELDS[i];
  const base = defaultField(i);
  const custom = { ...base, mode: "custom", custom: f.raw };
  const dayField = i === 2 || i === 4;
  if (f.raw === "*") return base;
  if (f.all) return custom; // e.g. 0-7: same values as *, but cron treats a leading * differently for the day fields
  let m;
  if ((m = /^\*\/(\d+)$/.exec(f.raw))) {
    const n = Number(m[1]);
    if (n < 1 || n > d.max - d.min) return custom;
    return { ...base, mode: "step", step: n, start: d.min };
  }
  if ((m = /^(\d+)-(\d+)\/(\d+)$/.exec(f.raw)) && Number(m[2]) === d.max) {
    const s = Number(m[1]), n = Number(m[3]);
    if (s < d.min || s > d.max || n < 1 || n > d.max - d.min) return custom;
    if (s === d.min && dayField) return custom;
    return { ...base, mode: "step", step: n, start: s };
  }
  if ((m = /^(\d+)\/(\d+)$/.exec(f.raw))) {
    const s = Number(m[1]), n = Number(m[2]);
    if (s < d.min || s > d.max || n < 1 || n > d.max - d.min) return custom;
    return { ...base, mode: "step", step: n, start: s };
  }
  if (f.raw.includes("/") || f.star) return custom;
  if ((m = /^(\d+)-(\d+)$/.exec(f.raw))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= d.min && b <= d.max && a < b) return { ...base, mode: "range", from: a, to: b };
  }
  const vals = f.values.filter((v) => v >= d.min && v <= d.max);
  if (vals.length && vals.length === f.values.length) return { ...base, mode: "values", values: vals };
  return custom;
}
