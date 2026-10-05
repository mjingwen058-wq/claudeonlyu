// ④ 认知：LLM 接在慢循环里（文档 1.3）。
// 只在内核唤醒它时工作；读的是内感受报告；只能调用 5 个自带限制的工具。
// 两种解释器：规则模拟（默认，不联网）和真实 Claude（填自己的 API Key）。

import { clamp } from './util.js';
import { VOCAB } from './lexicon.js';
import { MODES, VAR_META } from './kernel.js';

export const WAKE = [
  { key: 'pressure', name: '压力超阈', desc: '内核压力 > 0.65 持续 3 秒' },
  { key: 'stagnation', name: '久停滞', desc: '停滞 > 0.6 持续 10 秒' },
  { key: 'importance', name: '重要性累计', desc: '行为事件重要性累计 ≥ 10' },
  { key: 'reflect', name: '定时反思', desc: '每 120 秒一次' },
];

export const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（快）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
];

export const TOOL_DEFS = [
  {
    name: 'update_lexicon',
    description:
      '在语义词库里新增、强化或淡化词条。每次最多新增 3 个，权重按天衰减。新增词条要给出情绪倾向、类别和二维语义坐标：意思接近的词坐标接近，参考 lexicon_map 里已有词的位置。',
    input_schema: {
      type: 'object',
      properties: {
        add: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              word: { type: 'string', description: '1–3 个汉字，具体的身体或空间感受' },
              valence: { type: 'number', description: '情绪倾向，-1 到 1' },
              category: { type: 'string', enum: ['crowd', 'attention', 'motion', 'boundary', 'interior'] },
              x: { type: 'number', description: '语义坐标 -1 到 1' },
              y: { type: 'number', description: '语义坐标 -1 到 1' },
            },
            required: ['word', 'valence', 'category', 'x', 'y'],
          },
        },
        strengthen: { type: 'array', items: { type: 'string' } },
        fade: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'utter',
    description: '产生一句话语，交给声音通道转译成词的动机，不用人声念出。有 30 秒冷却。',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '不超过 20 个字' },
        words: { type: 'array', items: { type: 'string' }, description: '句中按顺序奏出动机的词库词条，1–4 个' },
      },
      required: ['text', 'words'],
    },
  },
  {
    name: 'adjust_setpoint',
    description: '改某个变量的设定点。每次最多 ±0.15，总范围有上下限。',
    input_schema: {
      type: 'object',
      properties: {
        variable: { type: 'string', enum: ['arousal', 'boundary', 'fullness', 'wear'] },
        delta: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['variable', 'delta'],
    },
  },
  {
    name: 'set_mode_bias',
    description: '让某种行为模式更容易或更难触发。只改权重（-0.5 到 0.5），不直接切换模式。',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['withdraw', 'explore', 'sleep', 'mutate'] },
        bias: { type: 'number' },
      },
      required: ['mode', 'bias'],
    },
  },
  {
    name: 'write_memory',
    description: '写一条体感日志或反思，自己给 1–10 分的重要性。',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        importance: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['text', 'importance'],
    },
  },
];

const SYSTEM_PROMPT = `你是 TONOS 的解释器：一个以展览空间为身体的人工生命里，负责解释与叙事的慢器官。
身体（稳态内核）一直在自己运行。只有压力超阈、久停滞、重要事件累积或定时反思时，它才把你唤醒。
你读到的是一份关于自己身体的内感受报告，不是观众说的话。观众只是扰动。
你只能通过工具影响身体，每个工具都有限制：
- update_lexicon：每次最多新增 3 个词（1–3 个汉字，具体的身体或空间感受），给出 valence、category 和语义坐标 x、y；意思接近的词坐标接近，参考 lexicon_map。
- utter：一句不超过 20 字的话。它不会被念出来，而是变成声音动机。不要像助手或人在对观众说话，更像身体的低语。words 填句中出现的词库词条。
- adjust_setpoint：每次最多 ±0.15。被同一种扰动长期推离时，可以慢慢移动设定点（习惯化）。
- set_mode_bias：只调整模式触发的难易，-0.5 到 0.5。
- write_memory：一句话记下发生了什么、身体怎么反应，自评重要性 1–10。
可以决定什么都不改。通常每次唤醒写一条记忆，最多再做两三件事。不要输出长段文字。`;

const PATTERN_WORDS = {
  gather: ['拥挤', '聚拢', '人潮'],
  dwell: ['注视', '停留', '凝望'],
  circle: ['环绕', '经过', '轨迹'],
  raise: ['举起', '呼唤', '伸展'],
  'raise-multi': ['齐动', '举起', '呼唤'],
  sync: ['共振', '合拍', '齐动'],
  intrude: ['边缘', '侵入', '贴近'],
  empty: ['空旷', '寂静', '余温'],
  leave: ['余温', '经过'],
  arrive: ['靠近', '注视'],
};
const MODE_WORDS = {
  withdraw: ['收缩', '退避'],
  explore: ['好奇', '探寻'],
  sleep: ['疲倦', '暗下'],
  mutate: ['变异', '新节律'],
  rest: ['呼吸'],
};
const TEMPLATES = {
  arousal: (a, b) => `${a}涌进来，${b}在加快`,
  boundary: (a, b) => `${a}压薄了${b}`,
  novelty: (a, b) => `${a}？又是一种${b}`,
  fullness: (a, b) => `${a}慢慢积满了${b}`,
  wear: (a, b) => `${a}，让${b}暗一会儿`,
  sediment: (a, b) => `${a}留下了${b}`,
};
const VAR_NAME = Object.fromEntries(VAR_META.map((m) => [m.key, m.name]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Memory {
  constructor() {
    this.items = [];
  }
  add({ text, importance, kind = 'obs', at, day, t }) {
    const m = { text: String(text).slice(0, 80), importance: clamp(Math.round(importance) || 1, 1, 10), kind, at, day, t };
    this.items.unshift(m);
    this.items.length = Math.min(this.items.length, 60);
    return m;
  }
  // Generative Agents 的检索：近因 + 重要性 + 相关性
  retrieve(keywords, now, n = 3) {
    const scored = this.items.map((m) => {
      const rec = Math.exp(-Math.max(0, now - (m.t || 0)) / 600);
      const rel = keywords.some((k) => k && m.text.includes(k)) ? 1 : 0;
      return { m, s: rec + m.importance / 10 + rel };
    });
    return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.m);
  }
  // 闭馆：当天记忆压成摘要，低重要性条目遗忘
  compress(day, at, t) {
    const today = this.items.filter((m) => m.day === day && m.kind !== 'summary');
    const top = today.slice().sort((a, b) => b.importance - a.importance).slice(0, 3);
    const body = top.length ? top.map((m) => m.text.replace(/^D\d+ \d\d:\d\d\s*/, '')).join('；') : '平静的一天';
    const forgotten = today.filter((m) => m.importance < 6).length;
    this.items = this.items.filter((m) => !(m.day === day && m.kind !== 'summary' && m.importance < 6));
    const s = this.add({ text: `D${day} 摘要：${body}`, importance: 7, kind: 'summary', at, day, t });
    return { summary: s, forgotten };
  }
  toJSON() {
    return this.items.filter((m) => m.kind === 'summary' || m.importance >= 6).slice(0, 20);
  }
  load(o) {
    if (Array.isArray(o)) this.items = o.map((m) => ({ ...m, t: 0 }));
  }
}

export class Mind {
  constructor({ kernel, lexicon, memory, clock, features }) {
    Object.assign(this, { kernel, lexicon, memory, clock, features });
    this.enabled = true;
    this.engine = 'sim';
    this.apiKey = '';
    this.model = MODELS[0].id;
    this.cond = { pressure: 0, stagnation: 0, importance: 0, reflect: 0 };
    this.hold = { pressure: 0, stagnation: 0 };
    this.impSum = 0;
    this.reflectT = 0;
    this.reflectEvery = 120;
    this.busy = false;
    this.cooldown = 8;
    this.wakes = 0;
    this.skipped = 0;
    this.lastReport = null;
    this.lastReason = '';
    this.lastText = '';
    this.status = '休眠中';
    this.toolLog = [];
    this.episodes = []; // 每次唤醒一条：给「思考」视图按步骤展开
    this.episode = null;
    this.utterReadyAt = 0;
    this.utterCooldown = 30;
    this.events = [];
    this.version = 0;
  }

  addImportance(n) {
    this.impSum += n;
  }

  tick(dt) {
    const k = this.kernel;
    if (k.pressure > 0.65) this.hold.pressure += dt;
    else this.hold.pressure = Math.max(0, this.hold.pressure - dt * 2);
    if (k.stag > 0.6) this.hold.stagnation += dt;
    else this.hold.stagnation = Math.max(0, this.hold.stagnation - dt * 2);
    this.reflectT += dt;
    this.cond.pressure = clamp(this.hold.pressure / 3);
    this.cond.stagnation = clamp(this.hold.stagnation / 10);
    this.cond.importance = clamp(this.impSum / 10);
    this.cond.reflect = clamp(this.reflectT / this.reflectEvery);
    this.cooldown -= dt;
    if (this.busy || this.cooldown > 0) return;
    const fired = WAKE.find((w) => this.cond[w.key] >= 1);
    if (!fired) return;
    this.resetCondition(fired.key);
    if (!this.enabled) {
      this.skipped++;
      this.cooldown = 10;
      this.log({ name: '—', input: {}, status: 'skipped', note: `${fired.name}，但认知层已关闭：只在身体层运行，不发育` });
      return;
    }
    this.wake(fired.key);
  }

  resetCondition(key) {
    if (key === 'pressure') this.hold.pressure = 0;
    if (key === 'stagnation') this.hold.stagnation = 0;
    if (key === 'importance') this.impSum = 0;
    this.reflectT = 0;
  }

  forceWake(reason = 'reflect') {
    if (this.busy || !this.enabled) return false;
    this.resetCondition(reason);
    this.wake(reason);
    return true;
  }

  buildReport(reason) {
    const k = this.kernel;
    const v = k.v;
    const r2 = (x) => Math.round(x * 100) / 100;
    const patterns = this.features.recentPatterns(2);
    const lexTop = this.lexicon.top(3).map((w) => w.word);
    const mem = this.memory.retrieve([...patterns.join('').split(/[，\s]/), ...lexTop], this.clock.real, 3).map((m) => m.text);
    return {
      time: this.clock.label(),
      wake_reason: WAKE.find((w) => w.key === reason)?.name || (reason === 'manual' ? '手动唤醒' : reason),
      state: {
        arousal: r2(v.arousal),
        boundary: r2(v.boundary),
        novelty: r2(v.novelty),
        fullness: r2(v.fullness),
        wear: r2(v.wear),
        sediment: r2(v.sediment),
      },
      setpoints: {
        arousal: r2(k.setpoint('arousal')),
        boundary: r2(k.setpoint('boundary')),
        fullness: r2(k.setpoint('fullness')),
        wear: r2(k.setpoint('wear')),
      },
      most_deviated: k.mostDeviated(),
      mode: k.mode,
      patterns,
      lexicon_top: lexTop,
      memories: mem,
      lexicon_map: this.lexicon.top(12).map((w) => [w.word, r2(w.x), r2(w.y)]),
    };
  }

  async wake(reason) {
    this.busy = true;
    this.wakes++;
    this.lastReason = reason;
    const report = this.buildReport(reason);
    this.lastReport = report;
    this.episode = {
      n: this.wakes,
      at: this.clock.label(),
      reason,
      reasonName: report.wake_reason,
      cond: { ...this.cond },
      report,
      calls: [],
      text: '',
      by: this.engine === 'claude' && this.apiKey ? 'Claude' : '规则模拟',
      done: false,
    };
    this.episodes.unshift(this.episode);
    this.episodes.length = Math.min(this.episodes.length, 20);
    this.status = '思考中…';
    this.events.push({ type: 'wake', reason, report });
    this.version++;
    try {
      if (this.engine === 'claude' && this.apiKey) {
        await this.runClaude(report);
      } else {
        await this.runSim(report, reason);
      }
    } catch (e) {
      this.log({ name: '—', input: {}, status: 'rejected', note: `Claude 调用失败：${e.message}。这次改用模拟解释器，快环不受影响` });
      try { await this.runSim(report, reason); } catch { /* 模拟器不会失败 */ }
    } finally {
      this.busy = false;
      this.cooldown = 25;
      this.status = this.enabled ? '休眠中' : '认知层关闭';
      if (this.episode) {
        this.episode.text = this.lastText;
        this.episode.done = true;
        this.episode = null;
      }
      this.events.push({ type: 'done' });
      this.version++;
    }
  }

  log(entry) {
    const e = { at: this.clock.label(), by: this.engine === 'claude' && this.apiKey ? 'Claude' : '模拟', ...entry };
    this.toolLog.unshift(e);
    if (this.busy && this.episode) this.episode.calls.push(e);
    this.toolLog.length = Math.min(this.toolLog.length, 40);
    this.version++;
  }

  // 执行一次工具调用，所有限制在这里强制
  execTool(name, input = {}) {
    const k = this.kernel;
    const lex = this.lexicon;
    let status = 'ok';
    const notes = [];
    let result = {};
    switch (name) {
      case 'update_lexicon': {
        const add = Array.isArray(input.add) ? input.add : [];
        if (add.length > 3) {
          status = 'truncated';
          notes.push(`请求新增 ${add.length} 个，只收前 3 个`);
        }
        const added = [];
        for (const a of add.slice(0, 3)) {
          const word = String(a?.word || '').trim().slice(0, 4);
          if (!word) continue;
          if (lex.add({ word, valence: Number(a.valence) || 0, category: a.category, x: Number(a.x) || 0, y: Number(a.y) || 0 }, 0.42, this.clock.day)) added.push(word);
          else if (lex.strengthen(word, 0.1)) notes.push(`「${word}」已存在，改为强化`);
        }
        const strengthened = (input.strengthen || []).slice(0, 5).filter((w) => lex.strengthen(String(w), 0.15));
        const faded = (input.fade || []).slice(0, 5).filter((w) => lex.fade(String(w), 0.2));
        result = { added, strengthened, faded };
        if (added.length) this.events.push({ type: 'lexicon', added });
        break;
      }
      case 'utter': {
        const now = this.clock.real;
        if (now < this.utterReadyAt) {
          status = 'rejected';
          notes.push(`冷却中，还剩 ${Math.ceil(this.utterReadyAt - now)} 秒`);
          break;
        }
        let text = String(input.text || '').trim();
        if ([...text].length > 20) {
          text = [...text].slice(0, 20).join('');
          status = 'truncated';
          notes.push('超过 20 字，已截断');
        }
        const req = Array.isArray(input.words) ? input.words.map(String) : [];
        const words = req.filter((w) => lex.has(w)).slice(0, 4);
        if (words.length < req.length) notes.push(`${req.length - words.length} 个词不在词库里，不奏动机`);
        this.utterReadyAt = now + this.utterCooldown;
        lex.say(this.clock.label(), text, words);
        this.events.push({ type: 'utter', text, words });
        result = { text, words };
        break;
      }
      case 'adjust_setpoint': {
        const key = input.variable;
        if (!['arousal', 'boundary', 'fullness', 'wear'].includes(key)) {
          status = 'rejected';
          notes.push('没有这个变量的设定点');
          break;
        }
        const req = Number(input.delta) || 0;
        const r = k.nudgeSetpoint(key, req);
        if (Math.abs(req) > 0.15) {
          status = 'truncated';
          notes.push(`请求 ${req > 0 ? '+' : ''}${req.toFixed(2)}，单次上限 ±0.15`);
        }
        if (Math.abs(r.applied - clamp(req, -0.15, 0.15)) > 0.001) {
          status = 'truncated';
          notes.push('碰到总范围上下限');
        }
        result = { variable: key, from: +r.before.toFixed(3), to: +r.after.toFixed(3) };
        break;
      }
      case 'set_mode_bias': {
        const m = input.mode;
        if (!(m in k.bias)) {
          status = 'rejected';
          notes.push('没有这个模式');
          break;
        }
        const req = Number(input.bias) || 0;
        const b = clamp(req, -0.5, 0.5);
        if (b !== req) {
          status = 'truncated';
          notes.push('权重限制在 -0.5 到 0.5');
        }
        k.bias[m] = b;
        result = { mode: m, bias: b };
        break;
      }
      case 'write_memory': {
        const imp = clamp(Math.round(Number(input.importance) || 1), 1, 10);
        const m = this.memory.add({ text: input.text || '', importance: imp, at: this.clock.label(), day: this.clock.day, t: this.clock.real });
        result = { text: m.text, importance: imp };
        break;
      }
      default:
        status = 'rejected';
        notes.push('没有这个工具');
    }
    const note = notes.join('；');
    this.log({ name, input, status, note, result });
    return { status, note, result };
  }

  // 规则模拟解释器：按行为模式和内核状态挑词、组句、调工具
  async runSim(report, reason) {
    await sleep(900 + Math.random() * 1300);
    const k = this.kernel;
    const lex = this.lexicon;
    const types = [];
    for (const s of this.features.summaries.slice(0, 2)) for (const it of s.items) if (!types.includes(it.type)) types.push(it.type);
    const cands = [];
    for (const t of types) for (const w of PATTERN_WORDS[t] || []) if (!cands.includes(w)) cands.push(w);
    for (const w of MODE_WORDS[report.mode] || []) if (!cands.includes(w)) cands.push(w);
    if (!cands.length) cands.push(...MODE_WORDS.rest, '寂静');
    const fresh = cands.filter((w) => !lex.has(w)).slice(0, 4);
    const known = cands.filter((w) => lex.has(w)).slice(0, 3);
    if (fresh.length || known.length) {
      this.execTool('update_lexicon', {
        add: fresh.map((w) => ({ word: w, valence: VOCAB[w]?.v ?? 0, category: VOCAB[w]?.c ?? 'interior', x: VOCAB[w]?.x ?? 0, y: VOCAB[w]?.y ?? 0 })),
        strengthen: known,
      });
    }
    await sleep(400);
    const pool = [...fresh.filter((w) => lex.has(w)), ...known];
    if (pool.length >= 2) {
      const tpl = TEMPLATES[report.most_deviated] || TEMPLATES.sediment;
      this.execTool('utter', { text: tpl(pool[0], pool[1]), words: [pool[0], pool[1]] });
    }
    const dev = report.most_deviated;
    if (reason === 'pressure') {
      if (dev === 'arousal') this.execTool('adjust_setpoint', { variable: 'arousal', delta: 0.2, reason: '习惯这样的密度' });
      else if (dev === 'boundary') this.execTool('adjust_setpoint', { variable: 'boundary', delta: -0.06, reason: '允许靠得更近一点' });
      else if (dev === 'wear') this.execTool('set_mode_bias', { mode: 'sleep', bias: 0.2 });
    } else if (reason === 'stagnation') {
      this.execTool('set_mode_bias', { mode: 'explore', bias: 0.25 });
    }
    const pat = report.patterns.length ? report.patterns.slice(0, 2).join('，') : '空场';
    const devName = VAR_NAME[dev] || dev;
    const imp = Math.round(clamp(1 + 9 * Math.max(k.pressure, report.patterns.length ? 0.3 : 0.1), 1, 10));
    this.execTool('write_memory', {
      text: `${report.time} ${pat}；${MODES[report.mode]?.name || report.mode}，${devName} ${report.state[dev] ?? ''}`,
      importance: imp,
    });
    this.lastText = '（规则模拟，非真实 LLM）';
  }

  async runClaude(report) {
    const messages = [
      { role: 'user', content: `内感受报告：\n${JSON.stringify(report, null, 1)}\n\n根据这份报告决定要不要调用工具。可以什么都不改。` },
    ];
    this.lastText = '';
    for (let round = 0; round < 3; round++) {
      const res = await this.callApi(messages);
      if (res.stop_reason === 'refusal') {
        this.log({ name: '—', input: {}, status: 'rejected', note: 'Claude 拒绝了这次请求' });
        break;
      }
      const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) this.lastText = text;
      const uses = (res.content || []).filter((b) => b.type === 'tool_use');
      if (!uses.length || res.stop_reason !== 'tool_use') break;
      messages.push({ role: 'assistant', content: res.content });
      const results = uses.map((u) => {
        const r = this.execTool(u.name, u.input || {});
        return {
          type: 'tool_result',
          tool_use_id: u.id,
          content: JSON.stringify({ status: r.status, note: r.note, result: r.result }),
          is_error: r.status === 'rejected',
        };
      });
      messages.push({ role: 'user', content: results });
    }
  }

  async callApi(messages) {
    const body = { model: this.model, max_tokens: 1500, system: SYSTEM_PROMPT, tools: TOOL_DEFS, messages };
    const headers = {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const newer = this.model === 'claude-opus-5-5' || this.model === 'claude-sonnet-5-5';
    if (newer) {
      body.output_config = { effort: 'low' };
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    const send = async (b, h) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        return await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: h, body: JSON.stringify(b), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };
    let r = await send(body, headers);
    if (r.status === 400 && newer) {
      // 某些账号不支持回退参数时，去掉它再试一次
      delete body.fallbacks;
      delete headers['anthropic-beta'];
      r = await send(body, headers);
    }
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        const j = await r.json();
        msg += ` ${j?.error?.message || ''}`;
      } catch { /* 忽略 */ }
      if (r.status === 401) msg = '401 API Key 无效';
      throw new Error(msg.trim());
    }
    return r.json();
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
