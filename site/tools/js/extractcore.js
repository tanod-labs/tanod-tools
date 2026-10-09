// Extract emails, URLs, domains, IPv4 addresses, phone-like numbers and hashtags from text. Pure functions (no DOM).

const TLDS = new Set(("com net org edu gov mil int io co ai app dev info biz me tv xyz online site tech store blog cloud shop news " +
  "us uk ca au de fr es it nl be ch at se no dk fi pl cz ru ua tr gr pt ie jp cn kr in id ph sg my th vn hk tw nz za br ar mx cl pe eu asia " +
  "ly to cc fm gg sh so ws page link live life world today agency design studio digital email").split(" "));

const L = "\\p{L}\\p{M}\\p{N}";
const RE_EMAIL = new RegExp(`(?<![${L}._%+\\-])[${L}][${L}._%+\\-]*@(?:[${L}](?:[${L}\\-]*[${L}])?\\.)+\\p{L}{2,24}(?![${L}@])`, "gu");
const RE_URL = /(?<![\p{L}\p{N}@.\/])(?:(?:https?|ftp|sftp|ws|wss):\/\/|www\.)[^\s<>"'`\u{200b}]+/giu;
const RE_IPV4 = /(?<!\d)(?<!\d\.)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d]|\.\d)/g;
const RE_PHONE = /(?<![\w+])[+(]?\d[\d ()\xa0.\-]{5,}\d(?![\w])/g;
const RE_HASHTAG = new RegExp(`(?<![${L}_&#])#(?=[${L}_]*\\p{L})[${L}_]+`, "gu");
const RE_BARE_DOMAIN = /(?<![\p{L}\p{N}@.\/\-_])(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z]{2,24}(?![\p{L}\p{N}@\-_]|\.[\p{L}\p{N}])/giu;

/* Trim punctuation that belongs to the sentence, not to the URL; keep a closing bracket that has its opening partner inside. */
export function trimUrl(u) {
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?'"*_]/.test(last)) { u = u.slice(0, -1); continue; }
    const pairs = { ")": "(", "]": "[", "}": "{" };
    if (pairs[last]) {
      const open = u.split(pairs[last]).length - 1, close = u.split(last).length - 1;
      if (close > open) { u = u.slice(0, -1); continue; }
    }
    return u;
  }
}

export function hostOf(url) {
  const m = /^(?:[a-z][a-z0-9+.\-]*:\/\/)?(?:[^\/?#@]*@)?(\[[^\]]+\]|[^\/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);

export function findEmails(text) { return [...text.matchAll(RE_EMAIL)].map((m) => m[0]); }
export function findUrls(text) {
  return [...text.matchAll(RE_URL)].map((m) => trimUrl(m[0])).filter((u) => {
    const rest = u.replace(/^[a-z][a-z0-9+.\-]*:\/\//i, "");
    return rest.length > 0 && (rest !== u || /^www\.[^.\s]+\./i.test(u)) && !/^[.\/?#]/.test(rest);
  });
}
export function findIps(text) { return [...text.matchAll(RE_IPV4)].map((m) => m[0]); }
export function findHashtags(text) { return [...text.matchAll(RE_HASHTAG)].map((m) => m[0]); }

/* Domains: the hosts of URLs and the part after @ in emails (IP hosts skipped), plus bare names ending in a well-known top-level domain. */
export function findDomains(text) {
  const out = [];
  const strip = (h) => h.replace(/^www\./, "").replace(/\.$/, "");
  const urls = findUrls(text);
  for (const u of urls) { const h = strip(hostOf(u)); if (h && !isIp(h) && !h.startsWith("[")) out.push(h); }
  for (const e of findEmails(text)) out.push(strip(e.slice(e.lastIndexOf("@") + 1).toLowerCase()));
  // bare domains, in what is left once URLs and emails are blanked out
  let rest = text.replace(RE_URL, " ").replace(RE_EMAIL, " ");
  for (const m of rest.matchAll(RE_BARE_DOMAIN)) {
    const d = m[0].toLowerCase();
    if (TLDS.has(d.slice(d.lastIndexOf(".") + 1))) out.push(strip(d));
  }
  return out;
}

/* Phone-like numbers: 7 to 15 digits with spaces, dots, dashes or brackets, an optional leading +. Dates and IP addresses are skipped. */
export function findPhones(text) {
  const out = [];
  for (const m of text.matchAll(RE_PHONE)) {
    const s = m[0].replace(/^[(\s.\-]+|[\s.\-]+$/g, "").replace(/\($/, "");
    const digits = s.replace(/\D/g, "").length;
    if (digits < 7 || digits > 15) continue;
    if (/^\d{4}[-. ]\d{1,2}[-. ]\d{1,2}$/.test(s) || /^\d{1,2}[-. ]\d{1,2}[-. ]\d{4}$/.test(s)) continue;
    if (isIp(s)) continue;
    if (/^\d+\.\d+$/.test(s)) continue; // a decimal number
    if (/\(/.test(s) && !/\)/.test(s)) continue;
    out.push(s);
  }
  return out;
}

/* Count items. Returns [{ value, count }] in first-seen order; dedupe by key (default: the value itself). */
export function tally(items, key = (x) => x) {
  const map = new Map();
  for (const v of items) {
    const k = key(v);
    const e = map.get(k);
    if (e) e.count++; else map.set(k, { value: v, count: 1 });
  }
  return [...map.values()];
}

export const KINDS = ["emails", "urls", "domains", "ips", "phones", "hashtags"];
const FINDERS = { emails: findEmails, urls: findUrls, domains: findDomains, ips: findIps, phones: findPhones, hashtags: findHashtags };
const KEY = {
  emails: (x) => x.toLowerCase(), domains: (x) => x.toLowerCase(), hashtags: (x) => x.toLowerCase(),
  urls: (x) => x, ips: (x) => x, phones: (x) => x.replace(/\D/g, "") + (x.startsWith("+") ? "+" : ""),
};

/* All six lists. unique: true gives one row per distinct value with its count; false keeps every match.
   sort: "none" (order found), "az", "count" (most common first). */
export function extractAll(text, { unique = true, sort = "none" } = {}) {
  const out = {};
  for (const kind of KINDS) {
    const found = FINDERS[kind](text);
    let rows = unique ? tally(found, KEY[kind]) : found.map((value) => ({ value, count: 1 }));
    if (sort === "az") rows = rows.slice().sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    else if (sort === "count") rows = rows.map((r, i) => [r, i]).sort((a, b) => b[0].count - a[0].count || a[1] - b[1]).map((x) => x[0]);
    out[kind] = { rows, found: found.length };
  }
  return out;
}

/* CSV text (RFC 4180 quoting) for a list: header value,count. */
export function listCsv(rows) {
  const q = (s) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  return ["value,count", ...rows.map((r) => `${q(r.value)},${r.count}`)].join("\r\n") + "\r\n";
}
