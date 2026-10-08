// Shared secure-random helpers for the random-number and random-name tools. Everything runs in the browser.
// All draws use crypto.getRandomValues with rejection sampling, so there is no modulo bias.

const TWO32 = 4294967296;

/* Uniform integer in [0, n) for a Number n between 1 and 2^32. */
export function randIndex(n) {
  if (!(n >= 1) || n > TWO32) throw new RangeError("randIndex needs 1 <= n <= 2^32");
  if (n === 1) return 0;
  const limit = TWO32 - (TWO32 % n); // accept only draws below the largest multiple of n
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/* Uniform BigInt in [0, n) for any BigInt n >= 1: draw just enough bits, reject anything >= n. */
export function randBelow(n) {
  if (typeof n === "number") n = BigInt(n);
  if (n < 1n) throw new RangeError("randBelow needs n >= 1");
  if (n === 1n) return 0n;
  if (n <= BigInt(TWO32)) return BigInt(randIndex(Number(n)));
  const bits = (n - 1n).toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const extra = BigInt(bytes * 8 - bits);
  const buf = new Uint8Array(bytes);
  for (;;) {
    crypto.getRandomValues(buf);
    let v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
    v >>= extra; // keep exactly `bits` random bits
    if (v < n) return v;
  }
}

/* In-place Fisher-Yates shuffle. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* k distinct indices out of 0..n-1 (partial Fisher-Yates; n must be small enough to hold in memory). */
export function sampleIndices(n, k) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + randIndex(n - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k);
}

/* count distinct BigInts from 0..span-1, in draw order. Small spans use a partial shuffle, large ones a Set with
   rejection (a collision is unlikely when count is small compared with span). Caller checks count <= span. */
export function sampleDistinct(span, count) {
  if (span <= 200000n || BigInt(count) * 2n > span) {
    return sampleIndices(Number(span), count).map(BigInt);
  }
  const seen = new Set();
  const out = [];
  while (out.length < count) {
    const v = randBelow(span);
    const key = v.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
