// 通用小工具：数值、随机、环形缓冲

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32：给定种子的可复现随机数
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand = Math.random) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 固定长度的环形缓冲，按时间顺序读取
export class Ring {
  constructor(n) {
    this.n = n;
    this.a = new Float32Array(n);
    this.i = 0;
    this.len = 0;
  }
  push(v) {
    this.a[this.i] = v;
    this.i = (this.i + 1) % this.n;
    if (this.len < this.n) this.len++;
  }
  // k = 0 是最旧的一个
  get(k) {
    return this.a[(this.i - this.len + k + this.n * 2) % this.n];
  }
  last(back = 0) {
    if (!this.len) return 0;
    return this.a[(this.i - 1 - back + this.n * 2) % this.n];
  }
  mean(m = this.len) {
    m = Math.min(m, this.len);
    if (!m) return 0;
    let s = 0;
    for (let k = 0; k < m; k++) s += this.last(k);
    return s / m;
  }
  clear() {
    this.i = 0;
    this.len = 0;
  }
  toArray() {
    const out = new Array(this.len);
    for (let k = 0; k < this.len; k++) out[k] = this.get(k);
    return out;
  }
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  if (saa < 1e-6 || sbb < 1e-6) return 0;
  return sab / Math.sqrt(saa * sbb);
}

export const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export function safeStorage() {
  try {
    const k = '__tonos_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
