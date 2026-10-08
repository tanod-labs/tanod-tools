// MD5 (RFC 1321) with incremental input, for checksums. Web Crypto has no MD5, so it is done here.
const K = new Int32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const G = new Uint8Array(64);
for (let i = 0; i < 64; i++) G[i] = i < 16 ? i : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16;

export class MD5 {
  constructor() {
    this.h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.buf = new Uint8Array(64);
    this.used = 0;
    this.total = 0;
    this.m = new Int32Array(16);
  }

  block(x, o) {
    const m = this.m;
    for (let j = 0; j < 16; j++, o += 4) m[j] = x[o] | (x[o + 1] << 8) | (x[o + 2] << 16) | (x[o + 3] << 24);
    let [a, b, c, d] = this.h;
    for (let i = 0; i < 64; i++) {
      let f;
      if (i < 16) f = (b & c) | (~b & d);
      else if (i < 32) f = (d & b) | (~d & c);
      else if (i < 48) f = b ^ c ^ d;
      else f = c ^ (b | ~d);
      f = (f + a + K[i] + m[G[i]]) | 0;
      a = d; d = c; c = b;
      b = (b + ((f << S[i]) | (f >>> (32 - S[i])))) | 0;
    }
    const h = this.h;
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  }

  update(bytes) {
    let i = 0;
    const n = bytes.length;
    this.total += n;
    if (this.used) {
      const take = Math.min(64 - this.used, n);
      this.buf.set(bytes.subarray(0, take), this.used);
      this.used += take; i = take;
      if (this.used < 64) return this;
      this.block(this.buf, 0);
      this.used = 0;
    }
    for (; i + 64 <= n; i += 64) this.block(bytes, i);
    if (i < n) { this.buf.set(bytes.subarray(i), 0); this.used = n - i; }
    return this;
  }

  digest() {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.used < 56 ? 56 : 120) - this.used) + 8);
    pad[0] = 0x80;
    const lo = bits >>> 0, hi = Math.floor(bits / 0x100000000) >>> 0;
    const p = pad.length - 8;
    for (let k = 0; k < 4; k++) { pad[p + k] = (lo >>> (8 * k)) & 255; pad[p + 4 + k] = (hi >>> (8 * k)) & 255; }
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(16);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) out[k * 4 + j] = (this.h[k] >>> (8 * j)) & 255;
    return out;
  }
}

export const md5 = (bytes) => new MD5().update(bytes).digest();
