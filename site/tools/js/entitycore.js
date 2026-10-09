// HTML entity encoding and decoding. Pure functions (no DOM). The table holds the named entities people use in practice
// (Latin-1, punctuation, currency, arrows, maths, Greek, Latin Extended-A). In the browser the tool passes a `lookup` function
// that asks the browser's own HTML parser for every other name, so decoding covers all of HTML5.

/* name -> code point */
export const NAMED = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62,
  nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171,
  not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183,
  cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191,
  Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202,
  Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213,
  Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223,
  agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233, ecirc: 234,
  euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245,
  ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  Alpha: 913, Beta: 914, Gamma: 915, Delta: 916, Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921, Kappa: 922, Lambda: 923, Mu: 924,
  Nu: 925, Xi: 926, Omicron: 927, Pi: 928, Rho: 929, Sigma: 931, Tau: 932, Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937,
  alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954, lambda: 955, mu: 956,
  nu: 957, xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963, tau: 964, upsilon: 965, phi: 966, chi: 967, psi: 968, omega: 969,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225,
  bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364,
  trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, rArr: 8658, hArr: 8660,
  forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722,
  lowast: 8727, radic: 8730, prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756,
  sim: 8764, cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839,
  oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971, loz: 9674,
  spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
};
/* code point -> preferred name (the first listed wins for duplicates) */
const BY_CP = new Map();
for (const [n, cp] of Object.entries(NAMED)) if (!BY_CP.has(cp)) BY_CP.set(cp, n);

/* the five characters that must be escaped in HTML text and attribute values */
const UNSAFE = { 38: "&amp;", 60: "&lt;", 62: "&gt;", 34: "&quot;", 39: "&#39;" };

/* Encode text. mode:
     "unsafe"  only < > & " ' (what you need to put text safely in HTML)
     "named"   unsafe characters, plus every non-ASCII character that has a common name (&eacute;), others numeric
     "numeric" unsafe characters, plus every non-ASCII character as a number
   hex: use &#xE9; instead of &#233; for numeric entities. all: encode every character (also letters and digits), as numbers.
   spaces: keep ordinary spaces and line breaks as they are (always); nbsp and other unusual spaces follow the mode. */
export function encode(text, { mode = "named", hex = false, all = false } = {}) {
  let out = "";
  const num = (cp) => (hex ? "&#x" + cp.toString(16).toUpperCase() + ";" : "&#" + cp + ";");
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (all) { out += cp === 10 || cp === 13 ? ch : num(cp); continue; }
    if (UNSAFE[cp]) { out += cp === 39 ? (hex ? "&#x27;" : "&#39;") : UNSAFE[cp]; continue; }
    if (cp < 128 || mode === "unsafe") { out += ch; continue; }
    if (mode === "named" && BY_CP.has(cp)) { out += "&" + BY_CP.get(cp) + ";"; continue; }
    out += num(cp);
  }
  return out;
}

/* The Windows-1252 remapping HTML applies to numeric references 128..159. */
const CP1252 = { 128: 0x20ac, 130: 0x201a, 131: 0x192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x2c6, 137: 0x2030, 138: 0x160,
  139: 0x2039, 140: 0x152, 142: 0x17d, 145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x2dc,
  153: 0x2122, 154: 0x161, 155: 0x203a, 156: 0x153, 158: 0x17e, 159: 0x178 };

/* The character for a numeric reference, following the HTML rules: 0, surrogates and out-of-range give U+FFFD. */
export function numericChar(n) {
  if (!Number.isFinite(n) || n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "�";
  if (CP1252[n]) return String.fromCodePoint(CP1252[n]);
  return String.fromCodePoint(n);
}

/* Decode &name; &#123; and &#x1F600; references. lookup(name) may return a string for names not in the built-in table (or null).
   Unknown names are left as they are. Returns { text, count, unknown } where unknown lists the references that stayed. */
export function decode(text, lookup = null) {
  let count = 0;
  const unknown = [];
  const out = text.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (m, dec, hex, name) => {
    if (dec !== undefined) { count++; return numericChar(parseInt(dec, 10)); }
    if (hex !== undefined) { count++; return numericChar(parseInt(hex, 16)); }
    if (Object.prototype.hasOwnProperty.call(NAMED, name)) { count++; return String.fromCodePoint(NAMED[name]); }
    const v = lookup ? lookup(name) : null;
    if (v) { count++; return v; }
    if (!unknown.includes(m)) unknown.push(m);
    return m;
  });
  return { text: out, count, unknown };
}
