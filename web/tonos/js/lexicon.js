// 语义词库（文档 1.4 中速通道）：词条浮在上空，大小 = 权重，按天衰减。
// 每个词有一段固定的动机（耳标），回答时按顺序奏出，词云里同一个词同时亮起。

import { clamp, hashStr, rng } from './util.js';

// 全局用 D 大调五声音阶，保证多节点同时发声也不刺耳（Listen to Wikipedia 的做法）
export const SCALE = [0, 2, 4, 7, 9];
export const ROOT = 50; // D3

export const CATEGORIES = {
  crowd: '人群',
  attention: '注意',
  motion: '动作',
  boundary: '边界',
  interior: '内在',
};

// 模拟解释器用的预设词表：情绪倾向、类别、语义坐标（意思接近的词靠在一起，代替 UMAP）
export const VOCAB = {
  拥挤: { v: -0.5, c: 'crowd', x: -0.62, y: 0.5 },
  聚拢: { v: 0.2, c: 'crowd', x: -0.46, y: 0.62 },
  人潮: { v: -0.2, c: 'crowd', x: -0.72, y: 0.34 },
  齐动: { v: 0.6, c: 'crowd', x: -0.3, y: 0.76 },
  共振: { v: 0.7, c: 'crowd', x: -0.16, y: 0.86 },
  合拍: { v: 0.7, c: 'crowd', x: -0.36, y: 0.9 },
  注视: { v: 0.3, c: 'attention', x: 0.16, y: 0.54 },
  停留: { v: 0.4, c: 'attention', x: 0.3, y: 0.42 },
  凝望: { v: 0.4, c: 'attention', x: 0.22, y: 0.7 },
  靠近: { v: 0.1, c: 'attention', x: 0.04, y: 0.24 },
  环绕: { v: 0.2, c: 'motion', x: 0.6, y: 0.5 },
  经过: { v: 0.0, c: 'motion', x: 0.76, y: 0.34 },
  轨迹: { v: 0.1, c: 'motion', x: 0.7, y: 0.62 },
  举起: { v: 0.5, c: 'motion', x: 0.46, y: 0.84 },
  呼唤: { v: 0.4, c: 'motion', x: 0.34, y: 0.94 },
  伸展: { v: 0.5, c: 'motion', x: 0.56, y: 0.76 },
  边缘: { v: -0.3, c: 'boundary', x: -0.56, y: -0.24 },
  侵入: { v: -0.7, c: 'boundary', x: -0.72, y: -0.08 },
  贴近: { v: -0.4, c: 'boundary', x: -0.4, y: -0.04 },
  收缩: { v: -0.5, c: 'boundary', x: -0.6, y: -0.46 },
  退避: { v: -0.6, c: 'boundary', x: -0.76, y: -0.4 },
  空旷: { v: -0.1, c: 'interior', x: 0.5, y: -0.56 },
  寂静: { v: 0.1, c: 'interior', x: 0.66, y: -0.7 },
  余温: { v: 0.5, c: 'interior', x: 0.36, y: -0.44 },
  疲倦: { v: -0.4, c: 'interior', x: 0.14, y: -0.8 },
  暗下: { v: -0.3, c: 'interior', x: 0.3, y: -0.9 },
  好奇: { v: 0.7, c: 'interior', x: 0.76, y: -0.1 },
  探寻: { v: 0.6, c: 'interior', x: 0.86, y: 0.06 },
  变异: { v: 0.2, c: 'interior', x: 0.04, y: -0.52 },
  新节律: { v: 0.4, c: 'interior', x: -0.12, y: -0.66 },
  呼吸: { v: 0.3, c: 'interior', x: 0.0, y: -0.3 },
};

const degToMidi = (d) => ROOT + 12 * Math.floor(d / 5) + SCALE[((d % 5) + 5) % 5];

// 词 → 动机：音高由情绪倾向决定（上扬 = 好奇，下沉 = 退缩），节奏由词本身决定
export function motifFor(word, valence) {
  const r = rng(hashStr(word));
  const len = 3 + Math.floor(r() * 3);
  let deg = 5 + Math.floor(r() * 4) + (valence >= 0 ? 3 : 0);
  const dir = valence >= 0 ? 1 : -1;
  const notes = [];
  const durs = [];
  for (let i = 0; i < len; i++) {
    notes.push(degToMidi(clamp(deg, 0, 14)));
    durs.push([0.14, 0.2, 0.2, 0.28, 0.36][Math.floor(r() * 5)]);
    const step = 1 + Math.floor(r() * 2);
    deg += (r() < 0.72 ? dir : -dir) * step;
  }
  return { notes, durs };
}

export class Lexicon {
  constructor() {
    this.words = new Map();
    this.trajectory = [];
    this.version = 0;
  }

  add({ word, valence = 0, category = 'interior', x = 0, y = 0 }, weight = 0.42, day = 1) {
    if (this.words.has(word)) return false;
    const val = clamp(valence, -1, 1);
    this.words.set(word, {
      word,
      valence: val,
      category: CATEGORIES[category] ? category : 'interior',
      x: clamp(x, -1, 1),
      y: clamp(y, -1, 1),
      weight: clamp(weight),
      born: day,
      lit: 0,
      motif: motifFor(word, val),
    });
    this.version++;
    return true;
  }

  strengthen(word, amt = 0.15) {
    const w = this.words.get(word);
    if (!w) return false;
    w.weight = clamp(w.weight + amt);
    this.version++;
    return true;
  }

  fade(word, amt = 0.2) {
    const w = this.words.get(word);
    if (!w) return false;
    w.weight = clamp(w.weight - amt);
    if (w.weight < 0.06) this.words.delete(word);
    this.version++;
    return true;
  }

  has(word) {
    return this.words.has(word);
  }

  get(word) {
    return this.words.get(word);
  }

  top(n = 3) {
    return [...this.words.values()].sort((a, b) => b.weight - a.weight).slice(0, n);
  }

  light(word, t) {
    const w = this.words.get(word);
    if (w) w.lit = t;
  }

  // 闭馆：权重按天衰减，太弱的词条淡出
  decayDay() {
    const gone = [];
    for (const [k, w] of this.words) {
      w.weight *= 0.72;
      if (w.weight < 0.08) {
        this.words.delete(k);
        gone.push(k);
      }
    }
    this.version++;
    return gone;
  }

  say(at, text, words) {
    this.trajectory.unshift({ at, text, words });
    this.trajectory.length = Math.min(this.trajectory.length, 30);
    this.version++;
  }

  toJSON() {
    return {
      words: [...this.words.values()].map(({ word, valence, category, x, y, weight, born }) => ({ word, valence, category, x, y, weight, born })),
      trajectory: this.trajectory.slice(0, 12),
    };
  }

  load(o) {
    if (!o) return;
    for (const w of o.words || []) this.add(w, w.weight, w.born);
    this.trajectory = o.trajectory || [];
  }
}
