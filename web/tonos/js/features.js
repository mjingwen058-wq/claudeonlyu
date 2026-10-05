// ② 转换：骨骼 → 扰动向量（文档 1.1 的表格），以及每隔一段时间的行为模式摘要。
// 这里只产出数值；语义只在 LLM 被唤醒时才出现。

import { clamp, Ring, pearson } from './util.js';

// 肩宽（占画面宽度）→ 离"身体中心"（主屏）的接近程度。桌面 = 坐在笔记本前；展厅 = 远处站立。
export const CALIB = {
  hall: { near0: 0.08, near1: 0.24, label: '展厅距离' },
  desk: { near0: 0.3, near1: 0.55, label: '桌面距离' },
};

export const FEATURES = [
  { key: 'density', name: '人数 / 密度', how: '骨架数 ÷ 区域面积', drives: '唤醒' },
  { key: 'intrusion', name: '边界侵入', how: '离主屏最近的距离（由骨架大小估算）', drives: '边界完整度' },
  { key: 'energy', name: '运动能量', how: '所有关节帧间位移的平方和', drives: '唤醒、损耗' },
  { key: 'dwell', name: '停留时长', how: '同一追踪 ID 在区域内的持续时间', drives: '充盈度' },
  { key: 'predict', name: '可预测性', how: '内核对下一秒扰动的预测误差', drives: '新奇度' },
  { key: 'sync', name: '同步性', how: '多人运动能量的相关系数', drives: '唤醒（共振）' },
  { key: 'daily', name: '当日扰动总量', how: '以上特征按天累计', drives: '沉积' },
];

const TICK = 1 / 30;

function visible(p) {
  return p && (p.visibility === undefined || p.visibility > 0.5);
}

function centroid(lm) {
  let x = 0, y = 0, n = 0;
  for (const i of [11, 12, 23, 24]) {
    if (visible(lm[i])) { x += lm[i].x; y += lm[i].y; n++; }
  }
  if (!n && visible(lm[0])) return { x: lm[0].x, y: lm[0].y };
  if (n) return { x: x / n, y: y / n };
  // 身体还在画外：仍按关键点估一个位置，避免默认值造成假移动
  for (const i of [11, 12, 23, 24]) if (lm[i]) { x += lm[i].x; y += lm[i].y; n++; }
  return n ? { x: x / n, y: y / n } : null;
}

export class Features {
  constructor() {
    this.per = new Map();
    this.v = { density: 0, intrusion: 0, energy: 0, dwell: 0, predict: 1, sync: 0, daily: 0 };
    this.dailyRaw = 0;
    this.count = 0;
    this.acc = 0;
    this.now = 0;
    this.sent = 0; // 已发出的 /perturb 消息数
    this.events = [];
    this.list = [];
    this.patternEvery = 20;
    this.windowT = 0;
    this.window = this.newWindow();
    this.summaries = [];
    this.hist = {};
    for (const f of FEATURES) this.hist[f.key] = new Ring(300); // 15Hz × 20 秒
    this.histAcc = 0;
    this.syncS = 0;
  }

  newWindow() {
    return { maxCount: 0, gather: null, syncHigh: 0, intrHigh: 0, raises: [], left: [], arrived: 0, xr: new Map() };
  }

  // tracks: [{id, src, calib, lm, stamp}]
  update(tracks, dtReal, dtExhibit, camCalib, predictability) {
    this.now += dtReal;
    this.acc += dtReal;
    this.v.predict = predictability;
    let ticked = false;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(tracks, camCalib);
      ticked = true;
    }
    // 当日累计按展期时间走
    const v = this.v;
    const inten = (v.density + v.energy + v.intrusion + v.sync) / 4;
    this.dailyRaw += (inten * dtExhibit) / 3600;
    v.daily = 1 - Math.exp(-this.dailyRaw / 2);

    this.histAcc += dtReal;
    if (this.histAcc >= 1 / 15) {
      this.histAcc = 0;
      for (const f of FEATURES) this.hist[f.key].push(v[f.key]);
    }

    this.windowT += dtReal;
    if (this.windowT >= this.patternEvery) {
      this.windowT = 0;
      this.summarize();
    }
    return ticked;
  }

  tick(tracks, camCalib) {
    const now = this.now;
    const seen = new Set();
    const w = this.window;
    for (const t of tracks) {
      seen.add(t.id);
      let st = this.per.get(t.id);
      if (!st) {
        st = {
          id: t.id, src: t.src, first: now, lastT: now, lastStamp: -1, prevLm: null,
          e: 0, eHist: new Ring(60), proxHist: new Ring(30), armed: true, raised: false,
          fx: 0.5, fy: 0.5, prox: 0, sw: 0.1, x: 0.5, meanE: 0, eN: 0,
        };
        this.per.set(t.id, st);
        w.arrived++;
        this.events.push({ type: 'arrive', id: t.id, x: 0.5 });
        st.isNew = true;
      }
      st.seen = now;
      const lm = t.lm;
      const c = centroid(lm);
      if (c) { st.x = c.x; st.y = c.y; }
      if (visible(lm[11]) && visible(lm[12])) st.sw = Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y);
      const cal = CALIB[t.calib || camCalib] || CALIB.desk;
      st.prox = clamp((st.sw - cal.near0) / (cal.near1 - cal.near0));
      if (t.stamp !== st.lastStamp) {
        const dtL = now - st.lastT;
        if (st.prevLm && dtL > 0 && dtL < 0.5) {
          let E = 0;
          for (let i = 0; i < 33; i++) {
            const a = lm[i], b = st.prevLm[i];
            if (!visible(a) || !visible(b)) continue;
            const dx = a.x - b.x, dy = a.y - b.y;
            E += dx * dx + dy * dy;
          }
          E /= dtL;
          const scale = Math.max(st.sw, 0.05) / 0.2;
          E /= scale * scale;
          const raw = 1 - Math.exp(-Math.max(0, E - 0.004) / 0.03);
          st.e += (raw - st.e) * 0.35;
        }
        st.prevLm = lm;
        st.lastT = now;
        st.lastStamp = t.stamp;
      }
      st.eHist.push(st.e);
      st.proxHist.push(st.prox);
      st.meanE += st.e; st.eN++;
      // 举手：手腕高过鼻子
      const nose = lm[0];
      const up = [15, 16].some((i) => visible(lm[i]) && ((visible(nose) && lm[i].y < nose.y - 0.02) || (visible(lm[11]) && lm[i].y < lm[11].y - st.sw * 0.9)));
      if (up && !st.raised) w.raises.push({ t: now, id: t.id });
      st.raised = up;
      // 动作起始：给声音通道"有人一动就响"
      if (st.armed && st.e > 0.35) {
        st.armed = false;
        const proxRise = st.prox - st.proxHist.last(29);
        const sig = up ? 'raise' : proxRise > 0.15 ? 'approach' : st.e > 0.7 ? 'big' : 'move';
        this.events.push({ type: 'onset', id: t.id, x: st.x, sig, strength: st.e });
      } else if (!st.armed && st.e < 0.18) {
        st.armed = true;
      }
      // 地面位置：x 对应画面左右，越近越靠下（主屏在下方）
      st.fx = clamp(st.x, 0.02, 0.98);
      st.fy = 0.9 - st.prox * 0.7;
      if (st.isNew) {
        this.events.find((e) => e.type === 'arrive' && e.id === t.id).x = st.x;
        st.isNew = false;
      }
      // 绕行 = 在窗口内往两个方向都走过一段（单向进场、离场不算）
      const r = w.xr.get(t.id) || { last: st.x, right: 0, left: 0 };
      const dx = st.x - r.last;
      if (Math.abs(dx) > 0.002) {
        if (dx > 0) r.right += dx;
        else r.left -= dx;
        r.last = st.x;
      }
      w.xr.set(t.id, r);
    }
    for (const [id, st] of this.per) {
      if (!seen.has(id) && now - st.seen > 0.6) {
        this.per.delete(id);
        const r = w.xr.get(id);
        w.left.push({ id, circled: !!r && r.right >= 0.25 && r.left >= 0.25 });
        this.events.push({ type: 'leave', id, x: st.x });
      }
    }
    this.list = [...this.per.values()].filter((s) => now - s.seen < 0.3);
    const L = this.list;
    const n = L.length;
    this.count = n;
    const v = this.v;
    v.density = clamp(n / 6);
    v.intrusion = n ? Math.max(...L.map((s) => s.prox)) : 0;
    v.energy = 1 - Math.exp(-L.reduce((a, s) => a + s.e, 0) * 0.9);
    v.dwell = n ? Math.max(...L.map((s) => 1 - Math.exp(-(now - s.first) / 40))) : 0;
    // 同步性：两两相关，只算在动的人
    let sync = 0;
    const movers = L.filter((s) => s.eHist.mean(60) > 0.06);
    if (movers.length >= 2) {
      let sum = 0, k = 0;
      for (let i = 0; i < movers.length; i++) {
        for (let j = i + 1; j < movers.length; j++) {
          sum += Math.max(0, pearson(movers[i].eHist.toArray(), movers[j].eHist.toArray()));
          k++;
        }
      }
      sync = sum / k;
    }
    this.syncS += (sync - this.syncS) * 0.15;
    v.sync = clamp(this.syncS);
    this.sent++;

    // 行为窗口统计
    w.maxCount = Math.max(w.maxCount, n);
    if (n >= 3) {
      let d = 0, k = 0, cx = 0;
      for (let i = 0; i < n; i++) {
        cx += L[i].fx;
        for (let j = i + 1; j < n; j++) { d += Math.hypot(L[i].fx - L[j].fx, L[i].fy - L[j].fy); k++; }
      }
      d /= k;
      cx /= n;
      if (d < 0.32 && (!w.gather || n >= w.gather.n)) {
        w.gather = { n, d, x: cx, e: L.reduce((a, s) => a + s.e, 0) / n };
      }
    }
    if (v.sync > 0.55) w.syncHigh += TICK;
    if (v.intrusion > 0.7) w.intrHigh += TICK;
  }

  summarize() {
    const w = this.window;
    const items = [];
    const now = this.now;
    if (w.maxCount === 0) {
      items.push({ type: 'empty', text: '空场', imp: 0 });
    }
    let gatherSaysStill = false;
    if (w.gather) {
      const side = w.gather.x > 0.6 ? '东侧' : w.gather.x < 0.4 ? '西侧' : '中央';
      gatherSaysStill = w.gather.e < 0.3;
      items.push({ type: 'gather', text: `${side}聚集 ${w.gather.n} 人${gatherSaysStill ? '，驻足' : ''}`, imp: 3 });
    }
    const still = this.list.filter((s) => now - s.first > 8 && s.eN && s.meanE / s.eN < 0.25).length;
    if (still && !gatherSaysStill) items.push({ type: 'dwell', text: `${still} 人驻足`, imp: 1 });
    const circledLeft = w.left.filter((l) => l.circled).length;
    const circling = [...w.xr.entries()].filter(([id, r]) => this.per.has(id) && r.right >= 0.25 && r.left >= 0.25).length;
    if (circledLeft) items.push({ type: 'circle', text: `${circledLeft} 人绕行后离开`, imp: 2 });
    if (circling) items.push({ type: 'circle', text: `${circling} 人绕行`, imp: 2 });
    // 举手：0.6 秒内两人以上算"多人同时"
    const rs = w.raises.slice().sort((a, b) => a.t - b.t);
    let multi = 0, single = 0;
    for (let i = 0; i < rs.length; ) {
      let j = i + 1;
      while (j < rs.length && rs[j].t - rs[i].t < 0.6) j++;
      const ids = new Set(rs.slice(i, j).map((r) => r.id));
      if (ids.size >= 2) multi++;
      else single++;
      i = j;
    }
    if (multi) items.push({ type: 'raise-multi', text: multi === 1 ? '一次多人同时举手' : `${multi} 次多人同时举手`, imp: 4 });
    if (single) items.push({ type: 'raise', text: single === 1 ? '一次举手' : `${single} 次举手`, imp: 2 });
    if (w.syncHigh >= 3) items.push({ type: 'sync', text: `多人同步 ${Math.round(w.syncHigh)} 秒`, imp: 4 });
    if (w.intrHigh >= 2) items.push({ type: 'intrude', text: `有人贴近边界 ${Math.round(w.intrHigh)} 秒`, imp: 3 });
    const plainLeft = w.left.length - circledLeft;
    if (plainLeft > 0) items.push({ type: 'leave', text: `${plainLeft} 人离开`, imp: 1 });
    if (w.arrived) items.push({ type: 'arrive', text: `${w.arrived} 人进入`, imp: 1 });
    for (const s of this.list) { s.meanE = 0; s.eN = 0; }
    const summary = { at: now, items };
    this.summaries.unshift(summary);
    this.summaries.length = Math.min(this.summaries.length, 12);
    this.events.push({ type: 'summary', summary });
    this.window = this.newWindow();
    return summary;
  }

  // 给 LLM 的最近行为（不含"空场"以外的重复）
  recentPatterns(n = 2) {
    const out = [];
    for (const s of this.summaries.slice(0, n)) for (const it of s.items) if (!out.includes(it.text)) out.push(it.text);
    return out.slice(0, 6);
  }

  newDay() {
    this.dailyRaw = 0;
    this.v.daily = 0;
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
