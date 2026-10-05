// ③ 内核：信号转换与自我稳定（文档 1.2）。
// 快变量：唤醒、边界完整度用欠阻尼二阶系统  ẍ = −k(x−x*) − cẋ + Σwᵢpᵢ + ξ
// 慢变量：充盈度、损耗、沉积用一阶累积—泄漏  ẏ = a·p − (y−y₀)/τ（沉积 τ = ∞，只增不减）
// 新奇度：CBLA 的学习进展 LP = 近期平均误差 − 当前平均误差
// 状态机：偏离最大的变量决定模式，带滞回和最短停留时间

import { clamp, Ring, gauss, rng } from './util.js';

export const VAR_META = [
  { key: 'arousal', name: '唤醒', scale: '秒', dyn: '二阶欠阻尼回归', by: '密度、运动能量、同步性', see: '速度、密度' },
  { key: 'boundary', name: '边界完整度', scale: '分钟', dyn: '二阶回归，阻尼大', by: '边界侵入', see: '边缘收缩或破碎' },
  { key: 'novelty', name: '新奇度', scale: '分钟', dyn: '由学习进展 LP 计算', by: '扰动的可预测性', see: '分叉、突变' },
  { key: 'fullness', name: '充盈度', scale: '小时', dyn: '一阶累积 + 缓慢泄漏', by: '停留、低速注视', see: '色彩饱和度' },
  { key: 'wear', name: '损耗', scale: '小时', dyn: '高唤醒时累积，闭馆后恢复', by: '长时间高唤醒', see: '亮度、节奏变慢' },
  { key: 'sediment', name: '沉积', scale: '天', dyn: '只增不减', by: '每日扰动的总量与类型', see: '底层纹理逐日变化' },
];

export const MODES = {
  rest: { name: '静息', sub: '呼吸节律，无输入也在动' },
  withdraw: { name: '收缩退避', sub: '唤醒 / 边界被侵入' },
  explore: { name: '探索', sub: '新奇度高' },
  sleep: { name: '休眠变暗', sub: '损耗累积' },
  mutate: { name: '自发突变', sub: '停滞后自己变' },
};

export const CANDIDATES = ['withdraw', 'explore', 'sleep', 'mutate'];
export const CANDIDATE_LABEL = { withdraw: '收缩退避', explore: '探索', sleep: '休眠变暗', mutate: '停滞 → 突变' };
export const ENTER = 0.7;
export const EXIT = 0.55;

export const SETPOINT_RANGE = {
  arousal: [0.1, 0.5],
  boundary: [0.6, 0.98],
  fullness: [0.2, 0.6],
  wear: [0.05, 0.3],
};

const BASE = { arousal: 0.22, boundary: 0.9, fullness: 0.35, wear: 0.1 };
const PARAMS = { kA: 4.0, cA: 1.1, gainA: 2.5, kB: 0.35, cB: 0.85, gainB: 0.3, breathHz: 0.12, breathAmp: 0.3, noise: 0.2 };

export class Kernel {
  constructor() {
    this.v = { arousal: 0.22, boundary: 0.9, novelty: 0.15, fullness: 0.35, wear: 0.1, sediment: 0 };
    this.vel = { arousal: 0, boundary: 0 };
    this.base = { ...BASE };
    this.offset = { arousal: 0, boundary: 0, fullness: 0, wear: 0 };
    this.p = { ...PARAMS };
    this.bias = { withdraw: 0, explore: 0, sleep: 0, mutate: 0 };
    this.mode = 'rest';
    this.modeT = 0;
    this.minDwell = 20;
    this.mutateDur = 8;
    this.scores = { withdraw: 0, explore: 0, sleep: 0, mutate: 0 };
    this.raw = { withdraw: 0, explore: 0, sleep: 0, mutate: 0 };
    this.stag = 0;
    this.lp = 0;
    this.lpRel = 0;
    this.err = 0;
    this.eShort = 0;
    this.eLong = 0;
    this.predictability = 1;
    this.predQ = [];
    this.pBuf = [];
    this.errRing = new Ring(150);
    this.acc10 = 0;
    this.t = 0;
    this.ou = 0;
    this.ouB = 0;
    this.breathPh = 0;
    this.intrAcc = 0;
    this.outTimer = 0;
    this.comp = { density: 0, energy: 0, intrusion: 0, dwell: 0, sync: 0 };
    this.dayIntensity = 0;
    this.seed = 1;
    this.rand = rng(20261004);
    this.events = [];
    this.hist = {};
    for (const m of VAR_META) this.hist[m.key] = new Ring(600);
    this.histSet = { arousal: new Ring(600), boundary: new Ring(600), fullness: new Ring(600), wear: new Ring(600) };
    this.histErr = new Ring(600);
    this.histLp = new Ring(600);
    this.histStag = new Ring(600);
  }

  setpoint(key) {
    const r = SETPOINT_RANGE[key];
    return clamp(this.base[key] + this.offset[key], r[0], r[1]);
  }

  // LLM 改设定点：每次最多 ±0.15，总范围有上下限。返回实际生效的变化
  nudgeSetpoint(key, delta) {
    const before = this.setpoint(key);
    const d = clamp(delta, -0.15, 0.15);
    this.offset[key] += d;
    const r = SETPOINT_RANGE[key];
    // 把 offset 收回到范围内，避免越界后"欠账"
    const after = clamp(this.base[key] + this.offset[key], r[0], r[1]);
    this.offset[key] = after - this.base[key];
    return { before, after, requested: delta, applied: after - before };
  }

  // p: {density, intrusion, energy, dwell, sync}
  step(p, dt, dtEx) {
    this.t += dt;
    const P = this.p;
    const v = this.v;
    const aStar = this.setpoint('arousal');
    const bStar = this.setpoint('boundary');
    const sub = Math.max(1, Math.ceil(dt * 120));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      // 唤醒：弹簧 + 呼吸 + 低频噪声
      this.ou += (-this.ou / 2) * h + P.noise * Math.sqrt(h) * gauss(this.rand);
      this.breathPh += 2 * Math.PI * P.breathHz * h;
      const xi = P.breathAmp * Math.sin(this.breathPh) + this.ou;
      const FA = P.gainA * (0.45 * p.density + 0.4 * p.energy + 0.35 * p.sync);
      const accA = -P.kA * (v.arousal - aStar) - P.cA * this.vel.arousal + FA + xi;
      this.vel.arousal += accA * h;
      v.arousal += this.vel.arousal * h;
      if (v.arousal < 0) { v.arousal = 0; this.vel.arousal *= -0.3; }
      if (v.arousal > 1) { v.arousal = 1; this.vel.arousal *= -0.3; }
      // 边界完整度：侵入越久，回复力越弱，恢复越慢
      this.intrAcc += (p.intrusion - this.intrAcc / 60) * h;
      this.ouB += (-this.ouB / 4) * h + 0.015 * Math.sqrt(h) * gauss(this.rand);
      const kB = P.kB / (1 + this.intrAcc / 20);
      const accB = -kB * (v.boundary - bStar) - P.cB * this.vel.boundary - P.gainB * p.intrusion + this.ouB;
      this.vel.boundary += accB * h;
      v.boundary += this.vel.boundary * h;
      if (v.boundary < 0) { v.boundary = 0; this.vel.boundary *= -0.2; }
      if (v.boundary > 1) { v.boundary = 1; this.vel.boundary *= -0.2; }
    }

    // 预测与学习进展，10Hz
    this.acc10 += dt;
    while (this.acc10 >= 0.1) {
      this.acc10 -= 0.1;
      this.learnTick(p);
    }

    // 慢变量：按展期时间
    const tauF = 3600;
    const y0F = this.setpoint('fullness');
    const pF = p.dwell * (1 - p.energy);
    v.fullness = clamp(v.fullness + ((0.6 * pF - (v.fullness - y0F)) / tauF) * dtEx);
    const tauW = 3 * 3600;
    const y0W = this.setpoint('wear');
    const pW = clamp((v.arousal - 0.55) / 0.45);
    v.wear = clamp(v.wear + ((1.4 * pW - (v.wear - y0W)) / tauW) * dtEx);
    const inten = (p.density + p.energy + p.intrusion + p.sync) / 4;
    v.sediment += (inten * dtEx * 1.5) / (8 * 3600);
    for (const k in this.comp) this.comp[k] += (p[k] || 0) * dtEx;
    this.dayIntensity += inten * dtEx;

    this.updateMode(dt);
  }

  learnTick(p) {
    const vec = [p.density, p.intrusion, p.energy, p.dwell, p.sync];
    this.pBuf.push(vec);
    if (this.pBuf.length > 20) this.pBuf.shift();
    let err = 0;
    if (this.predQ.length >= 10) {
      const pred = this.predQ.shift();
      let s = 0;
      for (let i = 0; i < 5; i++) s += (vec[i] - pred[i]) ** 2;
      err = Math.sqrt(s / 5);
    }
    // 入门版预测器：过去 2 秒的滑动均值
    const mean = [0, 0, 0, 0, 0];
    for (const b of this.pBuf) for (let i = 0; i < 5; i++) mean[i] += b[i] / this.pBuf.length;
    this.predQ.push(mean);
    this.err = err;
    this.errRing.push(err);
    this.eShort = this.errRing.mean(30);
    this.eLong = this.errRing.mean(150);
    this.lp = this.eLong - this.eShort;
    this.lpRel = this.lp / (this.eLong + 0.02);
    this.predictability = 1 - clamp(this.eShort * 6);
    const target = clamp(this.lpRel * 1.7);
    this.v.novelty += (target - this.v.novelty) * (1 - Math.exp(-0.1 / 4));
    // 停滞：误差很小且不降（学会了），或一直很大不降（学不会的噪声）
    if (Math.abs(this.lpRel) < 0.12) this.stag += 0.1 / 55;
    else this.stag -= 0.1 / 12;
    if (this.mode === 'explore') this.stag -= 0.1 / 20;
    this.stag = clamp(this.stag);

    for (const m of VAR_META) this.hist[m.key].push(this.v[m.key]);
    for (const k in this.histSet) this.histSet[k].push(this.setpoint(k));
    this.histErr.push(err);
    this.histLp.push(this.lp);
    this.histStag.push(this.stag);
  }

  updateMode(dt) {
    const v = this.v;
    const aStar = this.setpoint('arousal');
    const bStar = this.setpoint('boundary');
    const raw = this.raw;
    raw.withdraw = Math.max(clamp((v.arousal - aStar) / (0.85 - aStar)), clamp((bStar - v.boundary) / (bStar - 0.15)));
    raw.explore = v.novelty;
    raw.sleep = clamp((v.wear - 0.45) / 0.4);
    raw.mutate = this.stag;
    for (const k of CANDIDATES) this.scores[k] = clamp(raw[k] * (1 + this.bias[k]));
    const s = this.scores;
    const best = CANDIDATES.reduce((a, b) => (s[b] > s[a] ? b : a));

    this.modeT += dt;
    if (this.mode === 'mutate') {
      if (this.modeT >= this.mutateDur) this.setMode('rest');
    } else if (this.mode === 'rest') {
      if (s[best] >= ENTER) this.setMode(best);
    } else if (this.modeT >= this.minDwell) {
      const cur = s[this.mode];
      if (cur < EXIT) this.setMode(s[best] >= ENTER ? best : 'rest');
      else if (best !== this.mode && s[best] >= ENTER && s[best] > cur + 0.1) this.setMode(best);
    }

    // 超稳定性：长时间出界就随机改参数，直到重新稳定（Ashby）
    if (raw.withdraw > 0.85) this.outTimer += dt;
    else this.outTimer = Math.max(0, this.outTimer - dt * 2);
    if (this.outTimer > 40) {
      this.outTimer = 0;
      const before = this.p.kA;
      this.p.kA = clamp(this.p.kA * (0.75 + this.rand() * 0.6), 2, 7);
      this.p.gainA = clamp(this.p.gainA * (0.8 + this.rand() * 0.3), 2, 4);
      this.events.push({ type: 'ultra', text: `超稳定性：唤醒长时间出界，随机改参数 k ${before.toFixed(2)} → ${this.p.kA.toFixed(2)}` });
    }
  }

  setMode(m) {
    const from = this.mode;
    if (m === from) return;
    this.mode = m;
    this.modeT = 0;
    this.events.push({ type: 'mode', from, to: m });
    if (m === 'mutate') {
      const old = this.p.breathHz;
      this.p.breathHz = 0.07 + this.rand() * 0.12;
      this.p.breathAmp = 0.22 + this.rand() * 0.16;
      this.seed = Math.floor(this.rand() * 1e6);
      this.stag = 0;
      this.events.push({
        type: 'mutate',
        text: `自发突变：呼吸节律 ${old.toFixed(3)} → ${this.p.breathHz.toFixed(3)} Hz，图像换新种子`,
      });
    }
  }

  get pressure() {
    return Math.max(this.raw.withdraw, this.raw.sleep, this.stag * 0.9);
  }

  // 每个变量偏离设定点的程度，给"most_deviated"
  deviations() {
    const v = this.v;
    return {
      arousal: Math.abs(v.arousal - this.setpoint('arousal')) / (1 - this.setpoint('arousal')),
      boundary: Math.max(0, this.setpoint('boundary') - v.boundary) / this.setpoint('boundary'),
      novelty: v.novelty,
      fullness: Math.abs(v.fullness - this.setpoint('fullness')),
      wear: Math.max(0, v.wear - this.setpoint('wear')),
      sediment: 0,
    };
  }

  mostDeviated() {
    const d = this.deviations();
    return Object.keys(d).reduce((a, b) => (d[b] > d[a] ? b : a));
  }

  // 闭馆：沉积推动基调漂移（不依赖 LLM），损耗恢复
  closeDay() {
    const total = Object.values(this.comp).reduce((a, b) => a + b, 0) || 1;
    const share = {};
    for (const k in this.comp) share[k] = this.comp[k] / total;
    const R = SETPOINT_RANGE;
    const before = { arousal: this.setpoint('arousal'), boundary: this.setpoint('boundary'), fullness: this.setpoint('fullness') };
    const busy = clamp(this.dayIntensity / (8 * 3600 * 0.35));
    this.base.arousal = clamp(this.base.arousal + 0.03 * busy * (share.density + share.energy - 0.45), R.arousal[0], R.arousal[1]);
    this.base.boundary = clamp(this.base.boundary - 0.03 * busy * (share.intrusion - 0.15), R.boundary[0], R.boundary[1]);
    this.base.fullness = clamp(this.base.fullness + 0.04 * busy * (share.dwell - 0.2), R.fullness[0], R.fullness[1]);
    const y0W = this.setpoint('wear');
    this.v.wear = y0W + (this.v.wear - y0W) * 0.25;
    const drift = {
      arousal: this.setpoint('arousal') - before.arousal,
      boundary: this.setpoint('boundary') - before.boundary,
      fullness: this.setpoint('fullness') - before.fullness,
    };
    this.comp = { density: 0, energy: 0, intrusion: 0, dwell: 0, sync: 0 };
    this.dayIntensity = 0;
    this.seed = (this.seed * 31 + 7) % 1000003;
    return drift;
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  toJSON() {
    return {
      sediment: this.v.sediment,
      fullness: this.v.fullness,
      wear: this.v.wear,
      base: this.base,
      offset: this.offset,
      p: this.p,
      bias: this.bias,
      seed: this.seed,
    };
  }

  load(o) {
    if (!o) return;
    this.v.sediment = o.sediment ?? 0;
    this.v.fullness = o.fullness ?? this.v.fullness;
    this.v.wear = o.wear ?? this.v.wear;
    Object.assign(this.base, o.base || {});
    Object.assign(this.offset, o.offset || {});
    Object.assign(this.p, o.p || {});
    Object.assign(this.bias, o.bias || {});
    this.seed = o.seed ?? this.seed;
  }
}
