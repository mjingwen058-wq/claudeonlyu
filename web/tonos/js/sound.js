// ⑤ 声音（快通道，文档 1.4）：由系统完成的演奏。
// 一个 2D 物理世界：基音体和话语变成的音符体在里面漂浮，观众的动作实时生成粒子，碰撞即发声。
// 声音状态机：自语 → 察觉到人 → 竖耳朵 → 动作新奇就聚焦回应、重复就轻响或不理（习惯化）→ 消散。
// 4 个发声节点分在左右声场，各有固定音色；合奏方式跟着内核状态变。

import { clamp, rng } from './util.js';
import { SCALE, ROOT } from './lexicon.js';

export const NODES = [
  { id: 'N1', x: 0.12, y: 0.42, timbre: 'bell', name: '钟' },
  { id: 'N2', x: 0.37, y: 0.2, timbre: 'pluck', name: '拨弦' },
  { id: 'N3', x: 0.63, y: 0.2, timbre: 'glass', name: '玻璃' },
  { id: 'N4', x: 0.88, y: 0.42, timbre: 'wood', name: '木' },
];

export const SOUND_STATES = {
  solo: '自语',
  ears: '竖耳朵',
  focus: '聚焦回应',
  faint: '轻响或不理',
  disperse: '消散',
};

export const ENSEMBLES = {
  unison: '齐奏',
  hocket: '接力',
  canon: '卡农 / 回声',
  phase: '相位偏移',
  dissonant: '不协和、散开',
};

const BASE_MIDI = [62, 64, 66, 69, 71]; // 基音体：D E F# A B
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const W = 1, H = 0.6;

// 在五声音阶里平移 k 个音级
function shiftDeg(midi, k) {
  if (!k) return midi;
  const rel = midi - ROOT;
  const oct = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  let idx = SCALE.indexOf(pc);
  if (idx < 0) return midi + k * 2;
  const d = oct * 5 + idx + k;
  return ROOT + 12 * Math.floor(d / 5) + SCALE[((d % 5) + 5) % 5];
}

export function nearestNode(x, y = 0.5) {
  let best = 0, bd = 1e9;
  NODES.forEach((n, i) => {
    const d = Math.hypot(n.x - x, (n.y - y) * 0.5);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.volume = 0.7;
    this.state = 'solo';
    this.stateT = 0;
    this.ensemble = 'phase';
    this.bodies = [];
    this.log = [];
    this.ripples = [];
    this.habit = {};
    this.selfT = 2.5;
    this.pending = null;
    this.respondDur = 2;
    this.onsets = new Map();
    this.selfPool = [];
    this.voices = 0;
    this.hocketIdx = 0;
    this.lit = [];
    this.rand = rng(11);
    this.now = 0;
    this.count = 0;
    this.version = 0;
    BASE_MIDI.forEach((m, i) => {
      this.bodies.push({
        kind: 'base', x: 0.14 + 0.18 * i, y: 0.22 + (i % 2) * 0.14,
        vx: (this.rand() - 0.5) * 0.06, vy: (this.rand() - 0.5) * 0.04,
        r: 0.038, midi: m, cool: 0, flash: 0, life: Infinity,
      });
    });
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.on = true;
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('这个浏览器不支持 Web Audio');
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // 空间混响：用衰减噪声生成冲激响应
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb).connect(this.master);
    this.nodeOut = NODES.map((n) => {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      p.pan.value = n.x * 2 - 1;
      g.connect(p);
      p.connect(this.master);
      p.connect(this.revSend);
      return g;
    });
    if (ctx.state === 'suspended') await ctx.resume();
    this.on = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    if (!this.ctx) return;
    if (m) this.ctx.suspend();
    else this.ctx.resume();
    this.on = !m;
  }

  // 记录一次发声（不开声音时也记录，界面照样能看到声音通道在工作）
  note(midi, vel, nodeIdx, opt = {}) {
    const when = opt.when || 0;
    const at = this.now + when;
    this.log.unshift({ at, kind: opt.kind || 'collide', midi, node: nodeIdx, vel, word: opt.word || '' });
    this.log.length = Math.min(this.log.length, 40);
    this.ripples.push({ node: nodeIdx, at, vel });
    if (opt.word) this.lit.push({ word: opt.word, at });
    this.version++;
    if (!this.on || !this.ctx || this.voices > 30 || vel < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005 + when;
    const f = mtof(midi) * Math.pow(2, (opt.detune || 0) / 1200);
    const dur = opt.dur || 0.25;
    const amp = 0.2 * clamp(vel);
    const g = ctx.createGain();
    g.connect(this.nodeOut[nodeIdx]);
    g.gain.setValueAtTime(0.0001, t);
    const tb = opt.timbre || NODES[nodeIdx].timbre;
    const oscs = [];
    let end;
    const osc = (type, freq, gain = 1) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      if (gain === 1) o.connect(g);
      else {
        const gg = ctx.createGain();
        gg.gain.value = gain;
        o.connect(gg).connect(g);
      }
      oscs.push(o);
      return o;
    };
    switch (tb) {
      case 'bell':
        osc('sine', f); osc('sine', f * 2.756, 0.32); osc('sine', f * 5.404, 0.1);
        g.gain.linearRampToValueAtTime(amp, t + 0.004);
        end = t + dur * 3 + 0.5;
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        break;
      case 'pluck': {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(f * 8, t);
        lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.25);
        o.connect(lp).connect(g);
        oscs.push(o);
        g.gain.linearRampToValueAtTime(amp * 1.3, t + 0.003);
        end = t + dur * 2 + 0.25;
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        break;
      }
      case 'glass':
        osc('sine', f); osc('sine', f * 2.003, 0.4);
        g.gain.linearRampToValueAtTime(amp, t + 0.03);
        end = t + dur * 3 + 0.7;
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        break;
      default: {
        // 木：FM，短促
        const car = osc('sine', f);
        const mod = ctx.createOscillator();
        mod.frequency.value = f * 3.5;
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(f * 2.5, t);
        idx.gain.exponentialRampToValueAtTime(1, t + 0.12);
        mod.connect(idx).connect(car.frequency);
        oscs.push(mod);
        g.gain.linearRampToValueAtTime(amp * 1.2, t + 0.002);
        end = t + dur * 1.2 + 0.15;
        g.gain.exponentialRampToValueAtTime(0.0001, end);
      }
    }
    this.voices++;
    for (const o of oscs) { o.start(t); o.stop(end + 0.05); }
    oscs[0].onended = () => { this.voices--; g.disconnect(); };
  }

  // "注意到你"：毫秒级的固定提示音
  cue(nodeIdx, soft = false) {
    const v = soft ? 0.25 : 0.55;
    this.note(81, v, nodeIdx, { kind: 'cue', timbre: 'glass', dur: 0.05 });
    this.note(88, v, nodeIdx, { kind: 'cue', timbre: 'glass', dur: 0.06, when: 0.07 });
  }

  // 按合奏方式分配一个音
  play(midi, vel, x, opt = {}) {
    const near = nearestNode(x, opt.y ?? 0.4);
    switch (this.ensemble) {
      case 'unison':
        for (let i = 0; i < 4; i++) this.note(midi, vel * 0.45, i, { ...opt, word: i === 0 ? opt.word : '' });
        break;
      case 'hocket':
        this.note(midi, vel, this.hocketIdx++ % 4, opt);
        break;
      case 'canon':
        this.note(midi, vel, near, opt);
        this.note(midi, vel * 0.6, (near + 1) % 4, { ...opt, word: '', when: (opt.when || 0) + 0.22 });
        this.note(midi, vel * 0.4, (near + 2) % 4, { ...opt, word: '', when: (opt.when || 0) + 0.44 });
        break;
      case 'dissonant': {
        const off = [1, 6, -1, 11][Math.floor(this.rand() * 4)];
        this.note(midi + off, vel, Math.floor(this.rand() * 4), { ...opt, detune: (this.rand() - 0.5) * 50 });
        break;
      }
      default:
        this.note(midi, vel, near, opt);
    }
  }

  // 一个词的动机：权重越高越清晰、越快
  playMotif(entry, nodeStart, when, opt = {}) {
    const w = entry.weight;
    const tempo = 1.25 - 0.45 * w;
    let t = when;
    entry.motif.notes.forEach((m, i) => {
      const nodeIdx = opt.hocket ? (nodeStart + i) % 4 : nodeStart;
      this.note(shiftDeg(m, opt.shift || 0), (opt.vel ?? 0.6) * (0.5 + 0.5 * w), nodeIdx, {
        kind: opt.kind || 'motif', when: t, dur: entry.motif.durs[i] * tempo,
        detune: (1 - w) * 30 * (this.rand() - 0.5) * 2, word: i === 0 ? entry.word : '',
      });
      t += entry.motif.durs[i] * tempo;
    });
    return t;
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
    if (this.revSend && this.ctx) {
      const target = s === 'disperse' ? 0.75 : s === 'solo' ? 0.45 : 0.3;
      this.revSend.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }
    this.version++;
  }

  onArrive(x) {
    const quiet = this.state === 'ears' || this.state === 'focus';
    if (!quiet) this.setState('ears');
    this.cue(nearestNode(x), quiet);
  }

  onOnset(e, arousal) {
    const list = this.onsets.get(e.id) || [];
    list.push(this.now);
    while (list.length && this.now - list[0] > 4) list.shift();
    this.onsets.set(e.id, list);
    if (this.pending || !['ears', 'faint'].includes(this.state)) return;
    const h = this.habit[e.sig] || 0;
    const novelty = Math.exp(-h * 0.55);
    this.habit[e.sig] = h + 1;
    const delay = clamp(0.3 + 1.4 * (1 - arousal), 0.3, 2);
    this.pending = { at: this.now + delay, id: e.id, x: e.x, sig: e.sig, novelty };
  }

  // 呼应：先模仿观众动作的节奏，再奏词的动机，节点之间接力
  respond(p, lexicon) {
    if (p.novelty < 0.35) {
      if (p.novelty >= 0.15) this.note(BASE_MIDI[2], 0.18, nearestNode(p.x), { kind: 'faint' });
      this.setState('faint');
      return;
    }
    this.setState('focus');
    this.ensemble = 'hocket';
    const start = nearestNode(p.x);
    this.hocketIdx = start;
    const on = this.onsets.get(p.id) || [];
    let gaps = [];
    for (let i = 1; i < on.length; i++) gaps.push(clamp(on[i] - on[i - 1], 0.12, 0.6));
    if (gaps.length < 2) gaps = [0.2, 0.2, 0.32];
    gaps = gaps.slice(-5);
    let t = 0;
    const echo = [62, 66, 69, 71, 74, 76];
    gaps.forEach((g, i) => {
      this.note(echo[i % echo.length], 0.45, (start + i) % 4, { kind: 'echo', when: t, dur: 0.18 });
      t += g;
    });
    t += 0.15;
    const words = lexicon.top(2);
    for (const w of words) t = this.playMotif(w, (start + 1) % 4, t, { hocket: true, vel: 0.55 }) + 0.12;
    this.respondDur = t + 0.4;
  }

  // LLM 的话语：每个词按顺序奏出动机；有人时接力，没人时并入自语
  utter(words, lexicon, hasPeople) {
    const entries = words.map((w) => lexicon.get(w)).filter(Boolean);
    if (!entries.length) return;
    let t = 0.2;
    if (hasPeople) {
      this.setState('focus');
      this.ensemble = 'hocket';
      entries.forEach((e, i) => { t = this.playMotif(e, i % 4, t, { hocket: true, vel: 0.6 }) + 0.15; });
      this.respondDur = t + 0.4;
    } else {
      entries.forEach((e, i) => { t = this.playMotif(e, (i * 2) % 4, t, { vel: 0.4, kind: 'self' }) + 0.2; });
    }
    for (const e of entries) {
      this.bodies.push({
        kind: 'word', word: e.word, x: 0.2 + this.rand() * 0.6, y: 0.04, vx: (this.rand() - 0.5) * 0.1, vy: 0.06,
        r: 0.02 + 0.026 * e.weight, midi: e.motif.notes[0], cool: 0, flash: 0, life: 40,
      });
      if (!this.selfPool.includes(e.word)) this.selfPool.push(e.word);
    }
  }

  // 自语：学会的词的动机在两个节点上以略不同的速度重复，慢慢错开（Steve Reich 的相位偏移）
  selfTalk(lexicon, sediment) {
    const shift = Math.floor(sediment * 1.5) % 5;
    const pool = this.selfPool.map((w) => lexicon.get(w)).filter(Boolean);
    if (!pool.length) {
      const a = Math.floor(this.rand() * 5);
      this.note(shiftDeg(BASE_MIDI[a], shift), 0.22, 0, { kind: 'self', dur: 0.6 });
      this.note(shiftDeg(BASE_MIDI[(a + 2) % 5], shift), 0.18, 3, { kind: 'self', dur: 0.6, when: 0.9 });
      return;
    }
    const tot = pool.reduce((s, e) => s + e.weight, 0);
    let r = this.rand() * tot;
    let e = pool[0];
    for (const p of pool) { r -= p.weight; if (r <= 0) { e = p; break; } }
    const len = e.motif.durs.reduce((a, b) => a + b, 0);
    for (let rep = 0; rep < 2; rep++) {
      this.playMotif(e, 0, rep * len * 1.05, { vel: 0.32, kind: 'self', shift });
      this.playMotif(e, 3, rep * len * 1.09 + 0.05, { vel: 0.26, kind: 'self', shift });
    }
  }

  // 观众的动作 → 粒子
  emit(list, dt) {
    let n = this.bodies.filter((b) => b.kind === 'particle').length;
    for (const s of list) {
      if (s.e < 0.08 || n > 70) continue;
      const expected = 18 * s.e * dt;
      if (this.rand() < expected) {
        this.bodies.push({
          kind: 'particle', x: s.fx, y: H - 0.02, vx: (this.rand() - 0.5) * 0.3, vy: -(0.35 + 0.6 * s.e),
          r: 0.012, life: 3.5, cool: 0, flash: 0,
        });
        n++;
      }
    }
  }

  update(dt, ctx) {
    this.now += dt;
    this.stateT += dt;
    this.count = ctx.count;
    const k = ctx.mode;
    if (this.state !== 'focus') {
      this.ensemble = k === 'withdraw' ? 'dissonant'
        : k === 'explore' ? 'canon'
        : this.state === 'solo' || k === 'mutate' || k === 'sleep' || ctx.stag > 0.5 ? 'phase'
        : 'unison';
    }
    switch (this.state) {
      case 'solo':
        this.selfT -= dt;
        if (this.selfT <= 0) {
          this.selfTalk(ctx.lexicon, ctx.sediment);
          this.selfT = (6 + this.rand() * 4) * (1 + ctx.wear);
        }
        if (ctx.count > 0) this.setState('ears');
        break;
      case 'ears':
        if (ctx.count === 0) this.setState('disperse');
        break;
      case 'focus':
        if (this.stateT > this.respondDur) this.setState('disperse');
        break;
      case 'faint':
        if (this.stateT > 1.2) this.setState('disperse');
        break;
      case 'disperse':
        if (this.stateT > 2.5) {
          for (const w of ctx.lexicon.top(3)) if (!this.selfPool.includes(w.word)) this.selfPool.push(w.word);
          this.setState(ctx.count > 0 ? 'ears' : 'solo');
        }
        break;
    }
    if (this.pending && this.now >= this.pending.at) {
      const p = this.pending;
      this.pending = null;
      if (ctx.count > 0) this.respond(p, ctx.lexicon);
    }
    for (const key in this.habit) this.habit[key] *= Math.exp(-dt / 45);
    this.physics(dt, ctx.arousal);
    const cut = this.now - 3;
    this.ripples = this.ripples.filter((r) => r.at > cut);
    this.lit = this.lit.filter((r) => r.at > cut);
  }

  physics(dt, arousal) {
    const B = this.bodies;
    const stateGain = { solo: 0.5, ears: 0.8, focus: 1, faint: 0.4, disperse: 0.6 }[this.state];
    const jitter = 0.03 + 0.05 * arousal;
    for (const b of B) {
      if (b.kind === 'particle') {
        b.vx *= Math.exp(-0.4 * dt);
        b.vy *= Math.exp(-0.25 * dt);
        b.life -= dt;
        if (b.y < b.r + 0.005) b.life = 0;
      } else {
        b.vx += (this.rand() - 0.5) * jitter * dt * 4 + (0.5 - b.x) * 0.01 * dt;
        b.vy += (this.rand() - 0.5) * jitter * dt * 4 + (0.3 - b.y) * 0.02 * dt;
        b.vx *= Math.exp(-0.5 * dt);
        b.vy *= Math.exp(-0.5 * dt);
        if (b.kind === 'word') b.life -= dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.8; }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.8; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.8; }
      if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.8; }
      b.cool -= dt;
      b.flash = Math.max(0, b.flash - dt * 3);
    }
    for (let i = 0; i < B.length; i++) {
      for (let j = i + 1; j < B.length; j++) {
        const a = B[i], c = B[j];
        if (a.kind === 'particle' && c.kind === 'particle') continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        const rr = a.r + c.r;
        if (d >= rr || d < 1e-6) continue;
        const nx = dx / d, ny = dy / d;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        const ma = a.r * a.r, mc = c.r * c.r;
        if (vn < 0) {
          const jimp = (-(1 + 0.9) * vn) / (1 / ma + 1 / mc);
          a.vx -= (jimp / ma) * nx; a.vy -= (jimp / ma) * ny;
          c.vx += (jimp / mc) * nx; c.vy += (jimp / mc) * ny;
          const s = a.kind === 'particle' ? c : c.kind === 'particle' ? a : a.r >= c.r ? a : c;
          const vel = clamp(-vn * 1.2) * stateGain;
          if (s.cool <= 0 && vel > 0.04) {
            s.cool = 0.12;
            s.flash = 1;
            this.play(s.midi, vel, s.x, { kind: 'collide', y: s.y / H, word: s.word || '' });
          }
        }
        const push = (rr - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        c.x += nx * push; c.y += ny * push;
      }
    }
    this.bodies = B.filter((b) => b.life > 0);
  }

  newDay() {
    this.habit = {};
  }
}
