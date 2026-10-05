// 模拟观众：生成和 MediaPipe 同格式的 33 个关键点，让一个人对着电脑也能演示多人场景。
// 坐标是镜像后的归一化画面坐标（x 向右，y 向下）。模拟观众按"展厅距离"标定。

import { clamp, lerp, rng } from './util.js';

const ease = (k) => k * k * (3 - 2 * k);

class Agent {
  constructor(id, x, s, steps, seed) {
    this.id = id;
    this.x = x;
    this.s = s; // 躯干长度（占画面高度），越大越近
    this.steps = steps;
    this.walk = 0;
    this.raiseL = 0;
    this.raiseR = 0;
    this.mode = null;
    this.t = 0;
    this.r = rng(seed);
    this.swayPh = this.r() * 6.28;
    this.done = false;
    this.stamp = 0;
  }

  update(dt, T) {
    this.t += dt;
    this.swayPh += dt * (1.1 + this.r() * 0.2);
    const st = this.steps[0];
    if (!st) {
      this.mode = null;
    } else if (st.remove) {
      this.done = true;
    } else {
      st.t0 = (st.t0 || 0) + dt;
      if (st.wait !== undefined) {
        this.mode = null;
        if (st.t0 >= st.wait) this.steps.shift();
      } else if (st.to) {
        if (!st.from) st.from = { x: this.x, s: this.s };
        const k = ease(clamp(st.t0 / st.dur));
        const nx = lerp(st.from.x, st.to.x, k);
        const ns = lerp(st.from.s, st.to.s, k);
        this.walk += (Math.abs(nx - this.x) * 38 + Math.abs(ns - this.s) * 26) * (0.16 / Math.max(0.1, this.s));
        this.x = nx;
        this.s = ns;
        this.mode = st.raise || null;
        if (st.t0 >= st.dur) this.steps.shift();
      } else if (st.hold !== undefined) {
        this.mode = st.raise || 'idle';
        if (st.t0 >= st.hold) this.steps.shift();
      }
    }
    // 手臂
    let tl = 0, tr = 0;
    switch (this.mode) {
      case 'sync': {
        const v = 0.5 - 0.5 * Math.cos((2 * Math.PI * T) / 2.4);
        tl = tr = v;
        this.raiseL = tl;
        this.raiseR = tr;
        break;
      }
      case 'wave':
        tl = 0.05;
        tr = 0.75 + 0.2 * Math.sin(this.t * 7.5);
        break;
      case 'fidget':
        tl = 0.08 + 0.12 * Math.max(0, Math.sin(this.t * 0.9 + this.swayPh));
        tr = 0.1 + 0.18 * Math.max(0, Math.sin(this.t * 1.3 + 1.7));
        break;
      default:
        tl = tr = 0.04;
    }
    if (this.mode !== 'sync') {
      const a = 1 - Math.exp(-dt * 6);
      this.raiseL += (tl - this.raiseL) * a;
      this.raiseR += (tr - this.raiseR) * a;
    }
    this.stamp++;
  }

  landmarks() {
    const s = this.s;
    const cx = this.x + Math.sin(this.swayPh) * 0.004;
    const hipY = 0.45 + s * 1.2;
    const shY = hipY - s;
    const headY = shY - 0.42 * s;
    const shW = 0.55 * s, hipW = 0.34 * s;
    const lm = new Array(33);
    const P = (i, x, y) => {
      const vis = x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02 ? 0.2 : 0.98;
      lm[i] = { x, y, z: 0, visibility: vis };
    };
    // 头
    P(0, cx, headY + 0.05 * s);
    P(1, cx - 0.03 * s, headY - 0.02 * s); P(2, cx - 0.06 * s, headY - 0.02 * s); P(3, cx - 0.09 * s, headY - 0.02 * s);
    P(4, cx + 0.03 * s, headY - 0.02 * s); P(5, cx + 0.06 * s, headY - 0.02 * s); P(6, cx + 0.09 * s, headY - 0.02 * s);
    P(7, cx - 0.13 * s, headY); P(8, cx + 0.13 * s, headY);
    P(9, cx - 0.04 * s, headY + 0.12 * s); P(10, cx + 0.04 * s, headY + 0.12 * s);
    // 肩与手臂
    const sL = [cx - shW / 2, shY], sR = [cx + shW / 2, shY];
    P(11, ...sL); P(12, ...sR);
    const swing = Math.sin(this.walk) * 0.22;
    const arm = (sh, raise, side, iE, iW, iP, iI, iT) => {
      const th = lerp(0.12, 2.95, raise) + side * swing * (1 - raise);
      const dx = side * Math.sin(th), dy = Math.cos(th);
      const e = [sh[0] + dx * 0.5 * s, sh[1] + dy * 0.5 * s];
      const th2 = th + 0.2 * raise;
      const w = [e[0] + side * Math.sin(th2) * 0.48 * s, e[1] + Math.cos(th2) * 0.48 * s];
      P(iE, ...e); P(iW, ...w);
      P(iP, w[0] + side * 0.05 * s, w[1] + 0.05 * s);
      P(iI, w[0] + side * 0.02 * s, w[1] + 0.07 * s);
      P(iT, w[0] - side * 0.02 * s, w[1] + 0.04 * s);
    };
    arm(sL, this.raiseL, -1, 13, 15, 17, 19, 21);
    arm(sR, this.raiseR, 1, 14, 16, 18, 20, 22);
    // 髋与腿
    const hL = [cx - hipW / 2, hipY], hR = [cx + hipW / 2, hipY];
    P(23, ...hL); P(24, ...hR);
    const leg = (hp, side, iK, iA, iH, iF) => {
      const ph = Math.sin(this.walk + (side > 0 ? Math.PI : 0));
      const k = [hp[0] + ph * 0.12 * s, hp[1] + 0.74 * s];
      const a = [hp[0] + ph * 0.2 * s, k[1] + 0.72 * s - Math.max(0, ph) * 0.06 * s];
      P(iK, ...k); P(iA, ...a);
      P(iH, a[0] - 0.02 * s, a[1] + 0.04 * s);
      P(iF, a[0] + side * 0.1 * s, a[1] + 0.05 * s);
    };
    leg(hL, -1, 25, 27, 29, 31);
    leg(hR, 1, 26, 28, 30, 32);
    return lm;
  }
}

export const SCENARIOS = {
  approach: '一人靠近',
  gather: '多人聚集',
  sync: '同步举手',
  circle: '绕行后离开',
  clear: '清场',
};

export class Crowd {
  constructor() {
    this.agents = [];
    this.T = 0;
    this.n = 0;
  }

  add(x, s, steps) {
    this.n += 1;
    const a = new Agent(`S${this.n}`, x, s, steps, 977 * this.n + 13);
    this.agents.push(a);
    return a;
  }

  scenario(name) {
    switch (name) {
      case 'approach':
        this.add(-0.12, 0.12, [
          { to: { x: 0.47, s: 0.13 }, dur: 5 },
          { to: { x: 0.5, s: 0.4 }, dur: 7 },
          { hold: 5 },
          { hold: 4, raise: 'wave' },
          { hold: 6 },
          { to: { x: 0.53, s: 0.16 }, dur: 5 },
          { hold: 3 },
          { to: { x: 1.16, s: 0.15 }, dur: 5 },
          { remove: true },
        ]);
        break;
      case 'gather': {
        const offs = [-0.13, -0.05, 0.02, 0.09, 0.16];
        const sizes = [0.17, 0.21, 0.18, 0.23, 0.19];
        offs.forEach((o, i) => {
          const fromLeft = i % 2 === 0;
          this.add(fromLeft ? -0.12 : 1.12, 0.14, [
            { wait: i * 0.8 },
            { to: { x: 0.62 + o, s: sizes[i] }, dur: 5 },
            { hold: 30, raise: 'fidget' },
            { wait: i * 0.6 },
            { to: { x: fromLeft ? -0.15 : 1.15, s: 0.15 }, dur: 5 },
            { remove: true },
          ]);
        });
        break;
      }
      case 'sync':
        [0.2, 0.4, 0.6, 0.8].forEach((x, i) => {
          this.add(x < 0.5 ? -0.12 : 1.12, 0.15, [
            { to: { x, s: 0.18 + (i % 2) * 0.02 }, dur: 4 },
            { hold: 3 },
            { hold: 18, raise: 'sync' },
            { hold: 4 },
            { to: { x: x < 0.5 ? -0.15 : 1.15, s: 0.16 }, dur: 5 },
            { remove: true },
          ]);
        });
        break;
      case 'circle':
        [0, 1.6].forEach((delay, i) => {
          this.add(-0.12, 0.12, [
            { wait: delay },
            { to: { x: 0.86, s: 0.13 + i * 0.01 }, dur: 6 },
            { to: { x: 0.8, s: 0.24 }, dur: 3 },
            { to: { x: 0.16, s: 0.25 }, dur: 6 },
            { to: { x: -0.16, s: 0.2 }, dur: 3 },
            { remove: true },
          ]);
        });
        break;
      case 'clear':
        for (const a of this.agents) {
          const out = a.x < 0.5 ? -0.16 : 1.16;
          a.steps = [{ to: { x: out, s: a.s * 0.85 }, dur: 3 }, { remove: true }];
        }
        break;
    }
  }

  update(dt) {
    this.T += dt;
    for (const a of this.agents) a.update(dt, this.T);
    this.agents = this.agents.filter((a) => !a.done);
  }

  tracks() {
    return this.agents.map((a) => ({
      id: a.id,
      src: 'sim',
      calib: 'hall',
      lm: a.landmarks(),
      stamp: a.stamp,
    }));
  }

  get count() {
    return this.agents.length;
  }
}
