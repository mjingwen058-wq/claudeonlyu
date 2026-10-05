// 界面：三个视图（展厅 / 思考 / 全流程），组件挪进当前布局的槽；表层常显，后台数据折叠。画布每帧画，文字每秒 10 次。

import { FEATURES } from './features.js';
import { VAR_META, MODES, CANDIDATES, CANDIDATE_LABEL, ENTER } from './kernel.js';
import { WAKE, MODELS } from './mind.js';
import { SOUND_STATES, ENSEMBLES, NODES } from './sound.js';
import { POSE_LINKS } from './capture.js';
import { CATEGORIES } from './lexicon.js';
import { SCENARIOS } from './sim.js';

const $ = (id) => document.getElementById(id);
export const MODE_VAR = { rest: '--m-rest', withdraw: '--m-withdraw', explore: '--m-explore', sleep: '--m-sleep', mutate: '--m-mutate' };
const ID_COLORS = ['#8db4ff', '#f5b85c', '#74d9b3', '#ff806e', '#c9a3ff', '#e7e3d9', '#6fd0e8'];
const VAR_NAME = Object.fromEntries(VAR_META.map((m) => [m.key, m.name]));
const STATUS = { ok: '已执行', truncated: '已截断', rejected: '已拒绝', skipped: '未唤醒' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function idColor(id) {
  const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  return ID_COLORS[(n + (String(id)[0] === 'S' ? 3 : 0)) % ID_COLORS.length];
}

function fit(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// 走势线：从右往左滚动，面积 + 线 + 端点；set 为设定点虚线
function spark(cv, ring, opt = {}) {
  const f = fit(cv);
  if (!f) return;
  const { g, w, h } = f;
  const min = opt.min ?? 0, max = opt.max ?? 1;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.beginPath();
  g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5);
  g.stroke();
  const Y = (v) => h - 1 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 3);
  const X = (k, r) => (w * (k + (r.n - r.len))) / (r.n - 1);
  if (opt.set && opt.set.len) {
    g.setLineDash([3, 3]);
    g.strokeStyle = 'rgba(231,227,217,0.45)';
    g.beginPath();
    for (let k = 0; k < opt.set.len; k++) {
      const x = X(k, opt.set), y = Y(opt.set.get(k));
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
  }
  const series = opt.series || [{ ring, col: opt.col || '#e7e3d9', fill: true }];
  for (const s of series) {
    const r = s.ring;
    if (!r.len) continue;
    g.beginPath();
    for (let k = 0; k < r.len; k++) {
      const x = X(k, r), y = Y(r.get(k));
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    if (s.fill) {
      g.save();
      g.lineTo(X(r.len - 1, r), h);
      g.lineTo(X(0, r), h);
      g.closePath();
      g.fillStyle = s.col + '22';
      g.fill();
      g.restore();
      g.beginPath();
      for (let k = 0; k < r.len; k++) {
        const x = X(k, r), y = Y(r.get(k));
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
    }
    g.strokeStyle = s.col;
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = s.col;
    g.beginPath();
    g.arc(X(r.len - 1, r), Y(r.last()), 2, 0, Math.PI * 2);
    g.fill();
  }
}

const ARROW = (id, col) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${col}"/></marker>`;

const SM_KERNEL = `<svg class="sm" viewBox="0 0 360 238" role="img" aria-label="内核状态机：偏离最大的变量决定模式，所有模式都回归静息">
<defs>${ARROW('ka', '#596067')}${ARROW('kr', '#8db4ff')}</defs>
<polygon points="8,48 34,48 21,26" fill="none" stroke="#8db4ff" stroke-width="1.2"/>
<text x="21" y="63" font-size="10" text-anchor="middle">扰动</text>
<path class="ln" d="M37 39H55" marker-end="url(#ka)"/>
<g data-m="rest"><rect class="bx" x="58" y="20" width="92" height="38" rx="5"/><text x="104" y="36" font-size="12" font-weight="600" text-anchor="middle">静息</text><text class="sub" x="104" y="50" text-anchor="middle">无输入也在呼吸</text></g>
<path class="ln" d="M150 39H175" marker-end="url(#ka)"/>
<polygon class="dm" points="178,39 228,19 278,39 228,59"/>
<text x="228" y="43" font-size="11" text-anchor="middle">偏离最大？</text>
<path class="ln" d="M228 59V78M47 78H311"/>
<path class="ln" d="M47 78V89" marker-end="url(#ka)"/><path class="ln" d="M135 78V89" marker-end="url(#ka)"/>
<path class="ln" d="M223 78V89" marker-end="url(#ka)"/><path class="ln" d="M311 78V89" marker-end="url(#ka)"/>
<g data-m="withdraw"><rect class="bx" x="6" y="92" width="82" height="40" rx="5"/><text x="47" y="109" font-size="11.5" font-weight="600" text-anchor="middle">收缩退避</text><text class="sub" x="47" y="123" text-anchor="middle">唤醒或边界</text></g>
<g data-m="explore"><rect class="bx" x="94" y="92" width="82" height="40" rx="5"/><text x="135" y="109" font-size="11.5" font-weight="600" text-anchor="middle">探索</text><text class="sub" x="135" y="123" text-anchor="middle">新奇度高</text></g>
<g data-m="sleep"><rect class="bx" x="182" y="92" width="82" height="40" rx="5"/><text x="223" y="109" font-size="11.5" font-weight="600" text-anchor="middle">休眠变暗</text><text class="sub" x="223" y="123" text-anchor="middle">损耗累积</text></g>
<g data-m="stag"><rect class="bx" x="270" y="92" width="82" height="40" rx="5"/><text x="311" y="109" font-size="11.5" font-weight="600" text-anchor="middle">停滞上升</text><text class="sub" x="311" y="123" text-anchor="middle">学不到新的</text></g>
<path class="ln" d="M311 132V147" marker-end="url(#ka)"/>
<g data-m="mutate"><rect class="bx" x="270" y="150" width="82" height="34" rx="5"/><text x="311" y="165" font-size="11.5" font-weight="600" text-anchor="middle">自发突变</text><text class="sub" x="311" y="178" text-anchor="middle">带新节律回来</text></g>
<path class="ret" d="M47 132V204M135 132V204M223 132V204M311 184V204M311 204H104V61" marker-end="url(#kr)"/>
<text class="acc" x="210" y="219" text-anchor="middle">欠阻尼回归：带起伏，不是复位</text>
<text class="sub" x="180" y="234" text-anchor="middle">设定点由沉积逐日推动；LLM 只调权重，不参与切换</text>
</svg>`;

const SM_SOUND = `<svg class="sm" viewBox="0 0 360 172" role="img" aria-label="声音状态机：没人时自语，有人时聚拢回应，再散回去">
<defs>${ARROW('sa', '#596067')}${ARROW('sr', '#8db4ff')}</defs>
<g data-s="solo"><rect class="bx" x="4" y="14" width="80" height="36" rx="5"/><text x="44" y="30" font-size="11.5" font-weight="600" text-anchor="middle">自语</text><text class="sub" x="44" y="43" text-anchor="middle">无人也发声</text></g>
<path class="ln" d="M84 32H99" marker-end="url(#sa)"/>
<polygon class="dm" points="102,32 148,14 194,32 148,50"/><text x="148" y="36" font-size="10.5" text-anchor="middle">察觉到人？</text>
<path class="ln" d="M194 32H211" marker-end="url(#sa)"/>
<g data-s="ears"><rect class="bx" x="214" y="14" width="84" height="36" rx="5"/><text x="256" y="30" font-size="11.5" font-weight="600" text-anchor="middle">竖耳朵</text><text class="sub" x="256" y="43" text-anchor="middle">提示音，聚拢</text></g>
<path class="ln" d="M256 50V61" marker-end="url(#sa)"/>
<polygon class="dm" points="208,80 256,63 304,80 256,97"/><text x="256" y="84" font-size="10.5" text-anchor="middle">动作新奇？</text>
<path class="ln" d="M208 80H157" marker-end="url(#sa)"/><text class="sub" x="182" y="75" text-anchor="middle">是</text>
<g data-s="focus"><rect class="bx" x="66" y="62" width="88" height="36" rx="5"/><text x="110" y="78" font-size="11.5" font-weight="600" text-anchor="middle">聚焦回应</text><text class="sub" x="110" y="91" text-anchor="middle">呼应 + 动机 · 接力</text></g>
<path class="ln" d="M256 97V111" marker-end="url(#sa)"/><text class="sub" x="262" y="107">否 · 已习惯</text>
<g data-s="faint"><rect class="bx" x="212" y="114" width="88" height="34" rx="5"/><text x="256" y="129" font-size="11.5" font-weight="600" text-anchor="middle">轻响或不理</text><text class="sub" x="256" y="141" text-anchor="middle">习惯化</text></g>
<path class="ln" d="M110 98V111" marker-end="url(#sa)"/>
<g data-s="disperse"><rect class="bx" x="66" y="114" width="88" height="34" rx="5"/><text x="110" y="129" font-size="11.5" font-weight="600" text-anchor="middle">消散</text><text class="sub" x="110" y="141" text-anchor="middle">声部散回空间</text></g>
<path class="ln" d="M212 131H157" marker-end="url(#sa)"/>
<path class="ret" d="M66 131H44V53" marker-end="url(#sr)"/>
<text class="acc" x="4" y="166">余音并入自语：新学会的词，动机从此出现在自语里</text>
</svg>`;

const TOOL_ZH = { update_lexicon: '更新词库', utter: '开口', adjust_setpoint: '调设定点', set_mode_bias: '调模式权重', write_memory: '写记忆', '—': '调用失败' };
const VIEWS = ['hall', 'think', 'flow'];
const UI_KEY = 'tonos.ui';
const uiStore = () => { try { return window.localStorage; } catch { return null; } };
const sign = (x) => `${x > 0 ? '+' : ''}${Number(x).toFixed(2)}`;

// 一次工具调用：请求了什么
function requested(c) {
  const i = c.input || {};
  switch (c.name) {
    case 'update_lexicon': {
      const parts = [];
      if ((i.add || []).length) parts.push(`新增 ${i.add.map((x) => x.word).join('、')}`);
      if ((i.strengthen || []).length) parts.push(`强化 ${i.strengthen.join('、')}`);
      if ((i.fade || []).length) parts.push(`淡化 ${i.fade.join('、')}`);
      return parts.join(' · ') || '没有提出改动';
    }
    case 'utter': return `「${i.text || ''}」 · 动机 ${(i.words || []).join('、') || '无'}`;
    case 'adjust_setpoint': return `${VAR_NAME[i.variable] || i.variable} 设定点 ${sign(i.delta)}${i.reason ? `（${i.reason}）` : ''}`;
    case 'set_mode_bias': return `${MODES[i.mode]?.name || i.mode} 的触发权重 ${sign(i.bias)}`;
    case 'write_memory': return `(${i.importance}) ${i.text || ''}`;
    default: return '';
  }
}

// 一次工具调用：实际生效了什么
function applied(c) {
  if (c.status === 'rejected') return '没有生效';
  const r = c.result || {};
  switch (c.name) {
    case 'update_lexicon': {
      const parts = [];
      if ((r.added || []).length) parts.push(`新增 ${r.added.join('、')}`);
      if ((r.strengthened || []).length) parts.push(`强化 ${r.strengthened.join('、')}`);
      if ((r.faded || []).length) parts.push(`淡化 ${r.faded.join('、')}`);
      return parts.join(' · ') || '词库没有变化';
    }
    case 'utter': return `「${r.text || ''}」 · 动机 ${(r.words || []).join('、') || '无'}`;
    case 'adjust_setpoint': return `${VAR_NAME[r.variable] || r.variable} 设定点 ${r.from} → ${r.to}`;
    case 'set_mode_bias': return `${MODES[r.mode]?.name || r.mode} 的触发权重 = ${sign(r.bias)}`;
    case 'write_memory': return `已写入，重要性 ${r.importance}`;
    default: return '';
  }
}

export class UI {
  constructor(app) {
    this.app = app;
    this.acc = 1;
    this.v = {};
    this.spans = new Map();
    this.view = 'hall';
    this.stage = 1;
    this.immersive = false;
    this.epSel = null;
    this.openKeys = new Set();
    this.widgets = new Map([...document.querySelectorAll('[data-widget]')].map((el) => [el.dataset.widget, el]));
    this.build();
    this.restore();
    this.bind();
    this.applyView();
  }

  build() {
    const fr = $('feat-rows');
    fr.innerHTML = FEATURES.map((f) => `<div class="frow" data-k="${f.key}" title="${esc(f.how)}">
      <span>${f.name}</span><span class="bar"><b></b></span><span class="val">0.00</span><canvas class="spark"></canvas>
      <span class="to">${esc(f.how)} → 推动 ${esc(f.drives)}</span></div>`).join('');
    this.feat = Object.fromEntries(FEATURES.map((f) => {
      const row = fr.querySelector(`[data-k="${f.key}"]`);
      return [f.key, { bar: row.querySelector('.bar b'), val: row.querySelector('.val'), cv: row.querySelector('canvas') }];
    }));

    const fb = $('feat-big');
    fb.innerHTML = FEATURES.map((f) => `<div class="fbig" data-k="${f.key}"><span>${f.name}</span><span class="bar"><b></b></span><span class="val">0.00</span><span class="to">→ ${esc(f.drives)}</span></div>`).join('');
    this.fbig = Object.fromEntries(FEATURES.map((f) => {
      const row = fb.querySelector(`[data-k="${f.key}"]`);
      return [f.key, { bar: row.querySelector('.bar b'), val: row.querySelector('.val') }];
    }));

    const vr = $('var-rows');
    vr.innerHTML = VAR_META.map((m) => `<div class="vrow" data-k="${m.key}">
      <span class="nm">${m.name}<span class="tag">${m.scale}</span></span><span class="val">0.00</span><canvas></canvas>
      <span class="see">${esc(m.dyn)} · 被${esc(m.by)}推动 · 画面：${esc(m.see)}</span></div>`).join('');
    this.vars = Object.fromEntries(VAR_META.map((m) => {
      const row = vr.querySelector(`[data-k="${m.key}"]`);
      return [m.key, { val: row.querySelector('.val'), cv: row.querySelector('canvas') }];
    }));
    this.meters = [this.buildMeters($('var-meters')), this.buildMeters($('brain-meters'))];

    $('sm-kernel').innerHTML = SM_KERNEL;
    $('sm-sound').innerHTML = SM_SOUND;

    const sr = $('score-rows');
    sr.innerHTML = CANDIDATES.map((c) => `<div class="srow" data-k="${c}"><span>${CANDIDATE_LABEL[c]}</span><span class="bar"><b></b></span><span class="val">0.00</span><span class="bias"></span></div>`).join('');
    this.scores = Object.fromEntries(CANDIDATES.map((c) => {
      const row = sr.querySelector(`[data-k="${c}"]`);
      return [c, { bar: row.querySelector('.bar b'), val: row.querySelector('.val'), bias: row.querySelector('.bias') }];
    }));

    const wr = $('wake-rows');
    wr.innerHTML = WAKE.map((w) => `<div class="wrow" data-k="${w.key}"><span>${w.name}</span><span class="bar"><b></b></span><span class="val">0%</span><span class="desc">${esc(w.desc)}</span></div>`).join('');
    this.wake = Object.fromEntries(WAKE.map((w) => {
      const row = wr.querySelector(`[data-k="${w.key}"]`);
      return [w.key, { row, bar: row.querySelector('.bar b'), val: row.querySelector('.val') }];
    }));

    const mini = (el, items) => {
      el.innerHTML = items.map(([k, label]) => `<span class="mini" data-k="${k}"><span>${label}</span><span class="bar"><b></b></span></span>`).join('');
      return Object.fromEntries(items.map(([k]) => [k, el.querySelector(`[data-k="${k}"] b`)]));
    };
    this.sc2 = mini($('sc2'), [['density', '密度'], ['energy', '能量'], ['intrusion', '侵入']]);
    this.sc3 = mini($('sc3'), [['arousal', '唤醒'], ['boundary', '边界']]);

    const sc = $('scenarios');
    for (const [k, label] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.scenario = k;
      sc.appendChild(b);
    }
    $('model').innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  }

  buildMeters(el) {
    el.innerHTML = VAR_META.map((m) => `<div class="meter" data-k="${m.key}"><span class="nm">${m.name}<span class="tag">${m.scale}</span></span><span class="mbar"><b></b><i></i></span><span class="val">0.00</span></div>`).join('');
    return {
      el,
      rows: Object.fromEntries(VAR_META.map((m) => {
        const r = el.querySelector(`[data-k="${m.key}"]`);
        return [m.key, { b: r.querySelector('b'), i: r.querySelector('i'), val: r.querySelector('.val') }];
      })),
    };
  }

  // ———— 视图、层、折叠 ————
  restore() {
    const s = uiStore();
    try {
      const o = s && JSON.parse(s.getItem(UI_KEY) || 'null');
      if (o) {
        if (VIEWS.includes(o.view)) this.view = o.view;
        if (o.stage >= 1 && o.stage <= 5) this.stage = o.stage;
        this.openKeys = new Set(o.open || []);
      }
    } catch { /* 用默认值 */ }
    document.querySelectorAll('details.data[data-key]').forEach((d) => { d.open = this.openKeys.has(d.dataset.key); });
  }

  persist() {
    const s = uiStore();
    try { if (s) s.setItem(UI_KEY, JSON.stringify({ view: this.view, stage: this.stage, open: [...this.openKeys] })); } catch { /* 忽略 */ }
  }

  bind() {
    document.querySelectorAll('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    document.querySelectorAll('.stage-card').forEach((b) => b.addEventListener('click', () => this.setStage(Number(b.dataset.stage))));
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) this.setView(go.dataset.goto);
      const ep = e.target.closest('[data-ep]');
      if (ep) {
        this.epSel = ep.dataset.ep === 'latest' ? null : Number(ep.dataset.ep);
        this.v.think = null;
        this.v.mind = null;
      }
      const tg = e.target.closest('.toggle-all');
      if (tg) {
        const ds = [...tg.closest('.card').querySelectorAll('details.data')];
        const open = !ds.every((d) => d.open);
        ds.forEach((d) => { d.open = open; });
      }
    });
    document.querySelectorAll('details.data[data-key]').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) this.openKeys.add(d.dataset.key);
      else this.openKeys.delete(d.dataset.key);
      this.persist();
      this.syncToggles();
      this.v = {};
    }));
    $('btn-immerse').addEventListener('click', () => this.setImmersive(true));
    $('btn-exit-immerse').addEventListener('click', () => this.setImmersive(false));
  }

  setView(v) {
    if (!VIEWS.includes(v)) return;
    this.view = v;
    this.applyView();
    this.persist();
  }

  setStage(n) {
    this.stage = n;
    this.applyView();
    this.persist();
  }

  setImmersive(on) {
    this.immersive = on;
    $('immersive').hidden = !on;
    this.applyView();
  }

  openDetails(key) {
    const d = document.querySelector(`details.data[data-key="${key}"]`);
    if (d) d.open = true;
  }

  applyView() {
    document.querySelectorAll('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === this.view)));
    document.querySelectorAll('.view').forEach((s) => { s.hidden = s.dataset.view !== this.view; });
    document.querySelectorAll('.stage-card').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.stage) === this.stage)));
    document.querySelectorAll('.stage-detail').forEach((d) => { d.hidden = Number(d.dataset.stage) !== this.stage; });
    this.layout();
    this.syncToggles();
    this.v = {};
    this.acc = 1;
  }

  // 每个组件只有一份：挪进当前布局里同名的槽，用不到的放回停车区
  layout() {
    const parking = $('parking');
    let root;
    if (this.immersive) root = $('immersive');
    else if (this.view === 'flow') root = document.querySelector(`.stage-detail[data-stage="${this.stage}"]`);
    else root = document.querySelector(`.view[data-view="${this.view}"]`);
    const names = ['think', ...[...this.widgets.keys()].filter((n) => n !== 'think')];
    for (const n of names) {
      const el = this.widgets.get(n);
      const slot = root.querySelector(`[data-slot="${n}"]`);
      const target = slot || parking;
      if (el.parentElement !== target) target.appendChild(el);
    }
  }

  syncToggles() {
    document.querySelectorAll('.toggle-all').forEach((b) => {
      const ds = [...b.closest('.card').querySelectorAll('details.data')];
      b.textContent = ds.length && ds.every((d) => d.open) ? '全部收起' : '全部展开';
    });
  }

  // ———— 每帧 ————
  frame(dt) {
    this.drawCam($('cam-cv'), true);
    if (this.view === 'flow' && !this.immersive) {
      this.drawCam($('thumb-cam'), false);
      this.thumbImage();
    }
    this.drawPhysics();
    this.acc += dt;
    if (this.acc >= 0.1) {
      this.acc = 0;
      this.slow();
    }
    this.cloud();
  }

  drawCam(cv, main) {
    const a = this.app;
    const f = fit(cv);
    if (!f) return;
    const { g, w, h } = f;
    const video = a.capture.video;
    let dw = w, dh = h, ox = 0, oy = 0;
    const live = a.capture.on && video.readyState >= 2 && video.videoWidth;
    if (live) {
      const va = video.videoWidth / video.videoHeight;
      if (va > w / h) { dh = h; dw = h * va; ox = (w - dw) / 2; }
      else { dw = w; dh = w / va; oy = (h - dh) / 2; }
      g.save();
      g.translate(w, 0);
      g.scale(-1, 1);
      g.globalAlpha = 0.5;
      g.drawImage(video, w - ox - dw, oy, dw, dh);
      g.restore();
      g.fillStyle = 'rgba(8,9,10,0.35)';
      g.fillRect(0, 0, w, h);
    } else {
      g.fillStyle = '#08090a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.04)';
      g.beginPath();
      for (let i = 1; i < 10; i++) {
        g.moveTo((w * i) / 10, 0); g.lineTo((w * i) / 10, h);
        g.moveTo(0, (h * i) / 10); g.lineTo(w, (h * i) / 10);
      }
      g.stroke();
    }
    const tracks = a.tracks || [];
    if (main) $('cam-empty').hidden = live || tracks.length > 0;
    g.font = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    for (const t of tracks) {
      const col = idColor(t.id);
      const P = (i) => [ox + t.lm[i].x * dw, oy + t.lm[i].y * dh];
      const vis = (i) => t.lm[i] && (t.lm[i].visibility ?? 1) > 0.5;
      g.strokeStyle = col;
      g.lineWidth = main ? 1.6 : 1;
      g.setLineDash(t.src === 'sim' ? [4, 3] : []);
      g.beginPath();
      for (const [i, j] of POSE_LINKS) {
        if (!vis(i) || !vis(j)) continue;
        const [x1, y1] = P(i), [x2, y2] = P(j);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
      g.stroke();
      g.setLineDash([]);
      if (!main) continue;
      g.fillStyle = col;
      for (let i = 0; i < 33; i++) {
        if (!vis(i)) continue;
        const [x, y] = P(i);
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      const st = a.features.per.get(t.id);
      const head = vis(0) ? P(0) : P(11);
      if (st) {
        const label = `${t.id}${t.src === 'sim' ? ' 模拟' : ''} · ${Math.round(a.features.now - st.first)}s`;
        const tx = Math.min(Math.max(4, head[0] - 20), w - 90), ty = Math.max(12, head[1] - 18);
        g.fillStyle = 'rgba(8,9,10,0.7)';
        g.fillRect(tx - 3, ty - 9, g.measureText(label).width + 6, 13);
        g.fillStyle = col;
        g.fillText(label, tx, ty);
      }
    }
  }

  // 流水线卡片上的图像缩略图：从 WebGL 画布复制（同一帧内，缓冲区还在）
  thumbImage() {
    const f = fit($('thumb-img'));
    if (!f) return;
    const { g, w, h } = f;
    g.fillStyle = '#08090a';
    g.fillRect(0, 0, w, h);
    if (!this.app.body.ok) return;
    const src = $('body-cv');
    const sa = src.width / src.height, da = w / h;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sa > da) { sw = sh * da; sx = (src.width - sw) / 2; } else { sh = sw / da; sy = (src.height - sh) / 2; }
    g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  }

  updateMeters(M) {
    if (!M.el.offsetParent) return;
    const k = this.app.kernel;
    const col = `var(${MODE_VAR[k.mode]})`;
    for (const m of VAR_META) {
      const r = M.rows[m.key];
      const val = k.v[m.key];
      const max = m.key === 'sediment' ? Math.max(1, Math.ceil(val + 0.2)) : 1;
      r.b.style.width = `${Math.min(100, (val / max) * 100).toFixed(1)}%`;
      r.b.style.background = col;
      if (m.key in k.histSet) {
        r.i.style.display = '';
        r.i.style.left = `${(k.setpoint(m.key) / max) * 100}%`;
      } else r.i.style.display = 'none';
      r.val.textContent = val.toFixed(2);
    }
  }

  utterHTML(el, emptyText) {
    const t = this.app.lexicon.trajectory[0];
    el.classList.toggle('empty', !t);
    el.innerHTML = t
      ? `「${esc(t.text)}」<small>${esc(t.at)} · 动机：${esc(t.words.join(' · ') || '无')}</small>`
      : esc(emptyText);
  }

  drawPhysics() {
    const a = this.app;
    const f = fit($('phys-cv'));
    if (!f) return;
    const { g, w, h } = f;
    g.clearRect(0, 0, w, h);
    const sx = w, sy = h / 0.6;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    NODES.forEach((n, i) => {
      g.fillStyle = 'rgba(231,227,217,0.35)';
      g.fillText(n.id, n.x * w, h - 8);
      const recent = a.sound.ripples.some((r) => r.node === i && r.at <= a.sound.now && a.sound.now - r.at < 0.15);
      g.fillStyle = recent ? '#8db4ff' : 'rgba(231,227,217,0.2)';
      g.fillRect(n.x * w - 8, h - 3, 16, 2);
    });
    for (const b of a.sound.bodies) {
      const x = b.x * sx, y = b.y * sy, r = Math.max(1.5, b.r * sx);
      if (b.kind === 'particle') {
        g.fillStyle = `rgba(141,180,255,${Math.min(1, b.life / 2)})`;
        g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
        continue;
      }
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      if (b.flash > 0) {
        g.fillStyle = `rgba(141,180,255,${b.flash * 0.6})`;
        g.fill();
      }
      g.strokeStyle = b.kind === 'word' ? '#f5b85c' : 'rgba(231,227,217,0.7)';
      g.lineWidth = 1.2;
      g.stroke();
      if (b.kind === 'word') {
        g.fillStyle = '#f5b85c';
        g.fillText(b.word, x, y);
      }
    }
  }

  cloud() {
    const a = this.app;
    const lex = a.lexicon;
    const box = $('cloud');
    const now = a.sound.now;
    for (const [word, w] of lex.words) {
      let s = this.spans.get(word);
      if (!s) {
        s = document.createElement('span');
        s.textContent = word;
        s.style.animationDelay = `${-Math.random() * 9}s`;
        s.style.animationDuration = `${7 + Math.random() * 5}s`;
        box.appendChild(s);
        this.spans.set(word, s);
      }
      const pos = this.cloudPos?.get(word);
      if (pos) {
        s.style.left = `${pos.x.toFixed(1)}px`;
        s.style.top = `${pos.y.toFixed(1)}px`;
      } else {
        s.style.left = `${((w.x + 1) / 2) * 84 + 8}%`;
        s.style.top = `${(1 - (w.y + 1) / 2) * 76 + 12}%`;
      }
      s.style.fontSize = `${11 + 20 * w.weight}px`;
      s.style.opacity = `${0.35 + 0.65 * w.weight}`;
      s.title = `${word} · 权重 ${w.weight.toFixed(2)} · ${CATEGORIES[w.category]} · 情绪 ${w.valence.toFixed(1)}`;
      s.classList.toggle('lit', w.lit <= now && now - w.lit < 0.7);
    }
    for (const [word, s] of this.spans) {
      if (!lex.words.has(word)) {
        s.remove();
        this.spans.delete(word);
      }
    }
    let empty = box.querySelector('.empty');
    if (!lex.words.size && !empty) {
      empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = '词库还是空的：LLM 被唤醒后会写入新词';
      box.appendChild(empty);
    } else if (lex.words.size && empty) empty.remove();
  }

  once(key, version, fn) {
    if (this.v[key] === version) return;
    this.v[key] = version;
    fn();
  }


  slow() {
    const a = this.app;
    const k = a.kernel, F = a.features, m = a.mind, s = a.sound;
    const modeName = MODES[k.mode].name;
    const modeCol = `var(${MODE_VAR[k.mode]})`;
    const mindText = !m.enabled ? '认知层关闭' : m.busy ? '思考中…' : `休眠中${m.cooldown > 0 ? ` · 冷却 ${Math.ceil(m.cooldown)}s` : ''}`;
    $('clock').textContent = a.clock.label();
    const chip = $('mode-chip');
    chip.textContent = modeName;
    chip.style.color = modeCol;

    // ① 采集
    const c = a.capture;
    $('cap-status').textContent = c.on ? `${Math.round(c.fps)} fps · ${c.detectMs.toFixed(0)} ms` : c.status;
    if ($('people').offsetParent) {
      $('people').innerHTML = F.list.length
        ? F.list.map((p) => `<li><b style="color:${idColor(p.id)}">${p.id}</b>${p.src === 'sim' ? '模拟' : '摄像头'} · 停留 ${Math.round(F.now - p.first)}s · 距离 ${p.prox.toFixed(2)}</li>`).join('')
        : '<li>没有人：内核照样在呼吸</li>';
    }
    if ($('cap-detail').offsetParent) {
      $('cap-detail').innerHTML = [
        ['状态', c.on ? '识别中' : c.status],
        ['帧率', c.on ? `${Math.round(c.fps)} fps` : '—'],
        ['识别耗时', c.on ? `${c.detectMs.toFixed(0)} ms` : '—'],
        ['推理', c.delegate || '—'],
        ['模型来自', c.source || '—'],
        ['距离标定', a.calib === 'desk' ? '桌面距离' : '展厅距离'],
        ['模拟观众', `${a.crowd.count} 人`],
      ].map(([key, val]) => `<span>${key} <b>${esc(val)}</b></span>`).join('');
      $('people-data').innerHTML = F.list.length
        ? F.list.map((p) => `<li><b style="color:${idColor(p.id)}">${p.id}</b>能量 ${p.e.toFixed(2)} · 距离 ${p.prox.toFixed(2)} · 地面 (${p.fx.toFixed(2)}, ${p.fy.toFixed(2)})${p.raised ? ' · 举手' : ''}</li>`).join('')
        : '<li>没有人</li>';
    }

    // ② 转换
    for (const f of FEATURES) {
      const v = F.v[f.key];
      const big = this.fbig[f.key];
      big.bar.style.width = `${Math.round(v * 100)}%`;
      big.val.textContent = v.toFixed(2);
      const r = this.feat[f.key];
      r.bar.style.width = `${Math.round(v * 100)}%`;
      r.val.textContent = v.toFixed(2);
      spark(r.cv, F.hist[f.key], { col: '#8db4ff' });
    }
    const v = F.v;
    $('perturb-line').textContent = `/perturb ${[v.density, v.intrusion, v.energy, v.dwell, v.predict, v.sync, v.daily].map((x) => x.toFixed(2)).join(' ')}  #${F.sent}`;
    $('pat-next').textContent = `每 ${F.patternEvery} 秒 · 下一次 ${Math.ceil(F.patternEvery - F.windowT)}s`;
    this.once('pat', F.summaries.length && F.summaries[0].at, () => {
      $('patterns').innerHTML = F.summaries.slice(0, 6).map((x) => `<li><time>${esc(x.label || '')}</time>${esc(x.items.map((i) => i.text).join(' · '))}</li>`).join('') || '<li>还没有摘要</li>';
    });

    // ③ 内核
    for (const M of this.meters) this.updateMeters(M);
    for (const meta of VAR_META) {
      const r = this.vars[meta.key];
      const val = k.v[meta.key];
      r.val.textContent = val.toFixed(2);
      spark(r.cv, k.hist[meta.key], {
        col: cssv(MODE_VAR[k.mode]) || '#e7e3d9',
        set: k.histSet[meta.key],
        min: 0,
        max: meta.key === 'sediment' ? Math.max(1, Math.ceil(val + 0.2)) : 1,
      });
    }
    $('sm-mode-name').textContent = modeName;
    $('sm-mode-name').style.color = modeCol;
    this.highlightKernel();
    for (const cand of CANDIDATES) {
      const r = this.scores[cand];
      const sc = k.scores[cand];
      r.bar.style.width = `${Math.round(sc * 100)}%`;
      r.bar.style.background = sc >= ENTER ? `var(${MODE_VAR[cand]})` : 'var(--ink)';
      r.val.textContent = sc.toFixed(2);
      const b = k.bias[cand];
      r.bias.textContent = b ? `偏置 ${b > 0 ? '+' : ''}${b.toFixed(2)}` : '';
    }
    $('mode-time').textContent = k.mode === 'rest'
      ? `${Math.round(k.modeT)}s`
      : `${Math.round(k.modeT)}s${k.mode !== 'mutate' && k.modeT < k.minDwell ? ` · 最短停留还剩 ${Math.ceil(k.minDwell - k.modeT)}s` : ''}`;
    spark($('lp-cv'), null, {
      min: -0.15, max: 0.3,
      series: [
        { ring: k.histErr, col: '#8a9097' },
        { ring: k.histLp, col: '#8db4ff' },
        { ring: k.histStag, col: '#74d9b3' },
      ],
    });
    $('k-err').textContent = k.err.toFixed(3);
    $('k-lp').textContent = k.lp.toFixed(3);
    $('k-stag').textContent = k.stag.toFixed(2);
    this.once('klog', a.klogV, () => {
      $('kernel-log').innerHTML = a.klog.slice(0, 14).map((e) => `<li style="border-left-color:${e.col || 'var(--line)'}"><time>${esc(e.at)}</time>${esc(e.text)}</li>`).join('');
    });

    // ④ 认知
    $('mind-status').textContent = mindText;
    for (const w of WAKE) {
      const r = this.wake[w.key];
      const cv = m.cond[w.key];
      r.bar.style.width = `${Math.round(cv * 100)}%`;
      r.val.textContent = `${Math.round(cv * 100)}%`;
      r.row.classList.toggle('fire', cv >= 1 || (m.busy && m.lastReason === w.key));
    }
    const engineLabel = m.engine === 'claude' && m.apiKey ? (MODELS.find((x) => x.id === m.model)?.label || m.model) : '规则模拟';
    $('m-wakes').textContent = m.wakes;
    $('m-engine').textContent = engineLabel;
    $('m-skip').textContent = m.skipped ? `关闭期间跳过 ${m.skipped} 次` : '';
    const sel = this.selectedEpisode();
    this.once('mind', `${m.version}|${this.epSel}|${this.view}`, () => {
      const rep = this.view === 'think' && sel ? sel.report : m.lastReport;
      if (rep) {
        $('report-at').textContent = `${rep.time} · ${rep.wake_reason}`;
        $('report').textContent = JSON.stringify(rep, null, 2)
          .replace(/\[\s+("[^"]*"),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3]')
          .replace(/\[\s+((?:"[^"]*",?\s*)+)\]/g, (x, inner) => `[${inner.replace(/\s*\n\s*/g, ' ').trim()}]`);
      }
      $('tools').innerHTML = m.toolLog.slice(0, 16).map((e) => `<li><time>${esc(e.at)}</time><span class="tool">${esc(e.name)}</span><span class="st ${e.status}">${STATUS[e.status]}</span> <small style="color:var(--faint)">${esc(e.by)}</small>${this.toolArgs(e)}${e.note ? `<span class="args" style="color:var(--warn)">${esc(e.note)}</span>` : ''}</li>`).join('') || '<li>还没有调用</li>';
      $('mind-text').textContent = m.lastText ? `解释器的叙述：${m.lastText}` : '';
      $('memory').innerHTML = a.memory.items.slice(0, 12).map((x) => `<li><span class="imp">${x.importance}</span>${esc(x.text)}</li>`).join('') || '<li>还没有记忆</li>';
      const last = m.episodes[0];
      $('ms-last').textContent = last ? `最近一次唤醒：${last.at} · ${last.reasonName}` : '还没有被唤醒';
      this.utterHTML($('ms-utter'), '还没有话语');
      this.utterHTML($('b-utter'), '还没有话语。内核被扰动到一定程度，才会唤醒 LLM。');
      const t = a.lexicon.trajectory[0];
      $('sc4-utter').textContent = t ? `「${t.text}」` : '还没有话语';
      $('sc4-utter').classList.toggle('empty', !t);
    });
    $('ms-status').textContent = mindText;
    $('b-mind').textContent = mindText;
    if (this.view === 'think') this.renderThink(engineLabel);

    // 大脑与词汇
    $('b-mode').textContent = modeName;
    $('b-mode').style.color = modeCol;
    $('b-mode-sub').textContent = MODES[k.mode].sub;
    $('b-mode-t').textContent = `${Math.round(k.modeT)}s`;

    // ⑤ 表达
    this.layoutCloud();
    const P = a.body.params;
    $('img-params').textContent = P ? `F ${P.F.toFixed(4)} · k ${P.K.toFixed(4)} · ${P.steps} 步/帧` : '—';
    $('lex-count').textContent = `${a.lexicon.words.size} 个词 · 权重按天衰减`;
    this.once('traj', a.lexicon.version, () => {
      $('trajectory').innerHTML = a.lexicon.trajectory.slice(0, 8).map((x) => `<li><time>${esc(x.at)}</time>「${esc(x.text)}」 <b>${esc(x.words.join(' · '))}</b></li>`).join('') || '<li>还没有话语</li>';
    });
    $('snd-state').textContent = SOUND_STATES[s.state];
    $('snd-ens').textContent = ENSEMBLES[s.ensemble];
    $('hall-sound').textContent = `${SOUND_STATES[s.state]} · ${ENSEMBLES[s.ensemble]}`;
    $('hall-mode-t').textContent = `${modeName} · ${Math.round(k.modeT)}s`;
    this.highlightSound();
    this.once('notes', s.version, () => {
      $('notes').innerHTML = s.log.filter((e) => e.at <= s.now).slice(0, 8).map((e) => `<li>/note ${e.midi} ${e.vel.toFixed(2)} ${NODES[e.node].id} ${e.kind}${e.word ? ' ' + esc(e.word) : ''}</li>`).join('');
    });

    // 流水线卡片
    for (const key in this.sc2) this.sc2[key].style.width = `${Math.round(F.v[key] * 100)}%`;
    for (const key in this.sc3) {
      this.sc3[key].style.width = `${Math.round(k.v[key] * 100)}%`;
      this.sc3[key].style.background = modeCol;
    }
    $('sc3-mode').textContent = modeName;
    $('sc3-mode').style.color = modeCol;
    const act = [
      F.count ? 0.35 + 0.4 * Math.min(1, F.v.energy + 0.2) : 0.04,
      F.count ? 0.15 + 0.5 * Math.max(F.v.energy, F.v.density) : 0.05,
      0.1 + 0.45 * k.v.arousal,
      m.busy ? 0.6 : 0.05 + 0.3 * Math.max(...Object.values(m.cond)),
      Math.min(0.6, 0.06 + 0.05 * s.log.filter((e) => e.at <= s.now && s.now - e.at < 1).length),
    ];
    document.querySelectorAll('.stage-card').forEach((card, i) => {
      card.style.setProperty('--act', act[i].toFixed(3));
      card.classList.toggle('hot', act[i] > 0.45);
    });
    $('pipe-1').textContent = F.count ? `${F.count} 人 · ${c.on ? `摄像头 ${Math.round(c.fps)} fps` : '模拟'}` : c.on ? '摄像头 · 没有人' : '没有人';
    $('pipe-2').textContent = `/perturb 30Hz · 能量 ${F.v.energy.toFixed(2)}`;
    $('pipe-3').textContent = `唤醒 ${k.v.arousal.toFixed(2)} · 边界 ${k.v.boundary.toFixed(2)}`;
    $('pipe-4').textContent = !m.enabled ? '认知层关闭' : m.busy ? '思考中…' : `休眠 · 已唤醒 ${m.wakes} 次`;
    $('pipe-5').textContent = `${SOUND_STATES[s.state]} · ${ENSEMBLES[s.ensemble]} · ${a.lexicon.words.size} 词`;
    $('expo-hud').textContent = `${a.clock.label()} · ${modeName} · ${F.count} 人 · 声音 ${SOUND_STATES[s.state]}`;
  }

  selectedEpisode() {
    const eps = this.app.mind.episodes;
    if (this.epSel == null) return eps[0] || null;
    return eps.find((e) => e.n === this.epSel) || eps[0] || null;
  }

  // 思考视图：把一次唤醒按 5 步展开
  renderThink(engineLabel) {
    const m = this.app.mind;
    const st = $('t-status');
    st.classList.toggle('busy', m.busy);
    st.innerHTML = m.busy ? '<span class="spin"></span> 思考中…' : esc(!m.enabled ? '认知层关闭' : `休眠中${m.cooldown > 0 ? ` · 冷却 ${Math.ceil(m.cooldown)}s` : ''}`);
    $('t-meta').textContent = `解释器 ${engineLabel} · 已唤醒 ${m.wakes} 次`;
    const ep = this.selectedEpisode();
    const key = `${m.version}|${this.epSel}|${ep ? ep.n : 0}|${ep ? ep.done : ''}`;
    if (this.v.think === key) return;
    this.v.think = key;

    $('t-history').innerHTML = m.episodes.length
      ? m.episodes.map((e, i) => `<button type="button" data-ep="${i === 0 ? 'latest' : e.n}" aria-pressed="${ep && e.n === ep.n}">#${e.n} · ${esc(e.at)} · ${esc(e.reasonName)}${i === 0 ? ' · 最新' : ''}</button>`).join('')
      : '<span class="dim">还没有</span>';

    if (!ep) {
      $('t-episode').innerHTML = `<div class="empty-state"><p>还没有被唤醒。LLM 接在慢循环里，只在上面四个条件之一满到 100% 时被内核叫醒：压力超阈、久停滞、重要事件累积，或者定时反思。</p><p>可以点「立即唤醒」看一次完整过程，或者在「模拟观众」里点「多人聚集」把压力推上去。</p></div>`;
      return;
    }
    const r = ep.report;
    const S = r.state, SP = r.setpoints || {};
    const read = VAR_META.map((meta) => {
      const val = S[meta.key];
      const sp = SP[meta.key];
      return `<div class="rv${r.most_deviated === meta.key ? ' hi' : ''}"><span>${meta.name}${r.most_deviated === meta.key ? ' · 偏离最大' : ''}</span><b>${val}</b>${sp !== undefined ? `<small>设定点 ${sp}</small>` : ''}</div>`;
    }).join('');
    const calls = ep.calls.map((cl) => {
      const fail = cl.name === '—';
      return `<div class="call ${cl.status}"><header><b>${esc(TOOL_ZH[cl.name] || cl.name)}</b>${fail ? '' : `<code>${esc(cl.name)}</code>`}<span class="st ${cl.status}">${STATUS[cl.status]}</span></header>
        ${fail ? '' : `<dl><dt>请求</dt><dd>${esc(requested(cl))}</dd><dt>生效</dt><dd>${esc(applied(cl))}</dd></dl>`}
        ${cl.note ? `<p class="why">${esc(cl.note)}</p>` : ''}</div>`;
    }).join('');
    const changes = [];
    for (const cl of ep.calls) {
      if (cl.status === 'rejected') continue;
      const res = cl.result || {};
      if (cl.name === 'update_lexicon' && (res.added || []).length) changes.push(`<div class="change"><span>新词浮到上空</span>${res.added.map((w) => `<span class="word">${esc(w)}</span>`).join('')}</div>`);
      if (cl.name === 'update_lexicon' && (res.strengthened || []).length) changes.push(`<div class="change"><span>旧词变重</span>${esc(res.strengthened.join('、'))}</div>`);
      if (cl.name === 'utter') changes.push(`<div class="change"><span>话语 → 声音动机（不念出来）</span>「${esc(res.text)}」 ${(res.words || []).map((w) => `<span class="word">${esc(w)}</span>`).join('')}</div>`);
      if (cl.name === 'adjust_setpoint') changes.push(`<div class="change"><span>${esc(VAR_NAME[res.variable] || res.variable)}的设定点</span>${res.from} → ${res.to}</div>`);
      if (cl.name === 'set_mode_bias') changes.push(`<div class="change"><span>${esc(MODES[res.mode]?.name || res.mode)}的触发权重</span>${sign(res.bias)}</div>`);
      if (cl.name === 'write_memory') changes.push(`<div class="change"><span>写入记忆 · 重要性 ${res.importance}</span>${esc(res.text)}</div>`);
    }
    const narrative = ep.by === 'Claude' && ep.text && !ep.text.startsWith('（')
      ? `<p>${esc(ep.text)}</p>`
      : '<p class="dim">规则模拟解释器没有叙述。换成真实 Claude（在 ⚙ 控制里填 Key）后，这里会显示它对这次经历的解释。</p>';
    $('t-episode').innerHTML = `<ol class="steps">
      <li><h4>被什么唤醒 <small>#${ep.n} · ${esc(ep.at)} · ${esc(ep.by)}</small></h4>
        <p><b>${esc(ep.reasonName)}</b><span class="dim"> · ${esc(WAKE.find((w) => w.key === ep.reason)?.desc || '点了「立即唤醒」')}</span></p></li>
      <li><h4>它读到的身体 <small>不是谁说了什么，而是一份关于自己的报告</small></h4>
        <div class="readgrid">${read}</div>
        <dl class="facts">
          <dt>当前模式</dt><dd>${esc(MODES[r.mode]?.name || r.mode)}</dd>
          <dt>看到的行为</dt><dd>${esc(r.patterns.join(' · ') || '空场')}</dd>
          <dt>想起的记忆</dt><dd>${esc(r.memories.join('；') || '没有')}</dd>
          <dt>词库前 3</dt><dd>${esc(r.lexicon_top.join('、') || '词库还是空的')}</dd>
        </dl></li>
      <li class="${ep.done || ep.calls.length ? '' : 'wait'}"><h4>它做了什么 <small>只能调用受限的工具</small></h4>
        <div class="calls">${calls || '<p class="dim">没有调用工具</p>'}</div>
        ${ep.done ? '' : '<p class="dim" style="margin-top:8px"><span class="spin"></span> 还在想…</p>'}</li>
      <li class="${ep.done ? '' : 'wait'}"><h4>身体的变化</h4>
        <div class="changes">${changes.join('') || '<p class="dim">这次什么都没改</p>'}</div></li>
      <li class="${ep.done ? '' : 'wait'}"><h4>解释器的叙述</h4>${narrative}</li>
    </ol>`;
  }

  // 词条按语义坐标摆放，再把重叠的标签推开（几轮简单松弛）
  layoutCloud() {
    const box = $('cloud');
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const items = [...this.app.lexicon.words.values()].map((w) => {
      const fs = 11 + 20 * w.weight;
      return {
        word: w.word,
        x: (((w.x + 1) / 2) * 0.84 + 0.08) * W,
        y: ((1 - (w.y + 1) / 2) * 0.76 + 0.12) * H,
        w: fs * [...w.word].length * 1.02 + 8,
        h: fs * 1.3,
      };
    });
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const ox = (a.w + b.w) / 2 - Math.abs(dx);
          const oy = (a.h + b.h) / 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) {
            const sx = (dx > 0 || (dx === 0 && i % 2) ? 1 : -1) * ox / 2;
            a.x -= sx; b.x += sx;
          } else {
            const sy = (dy > 0 || (dy === 0 && i % 2) ? 1 : -1) * oy / 2;
            a.y -= sy; b.y += sy;
          }
        }
      }
      for (const p of items) {
        p.x = Math.min(W - p.w / 2, Math.max(p.w / 2, p.x));
        p.y = Math.min(H - p.h / 2, Math.max(p.h / 2, p.y));
      }
    }
    this.cloudPos = new Map(items.map((p) => [p.word, p]));
  }

  toolArgs(e) {
    const i = e.input || {};
    let s = '';
    switch (e.name) {
      case 'update_lexicon': {
        const add = (i.add || []).map((x) => x.word).join('、');
        s = [add && `新增 ${add}`, (i.strengthen || []).length && `强化 ${i.strengthen.join('、')}`, (i.fade || []).length && `淡化 ${i.fade.join('、')}`].filter(Boolean).join(' · ');
        break;
      }
      case 'utter':
        s = `「${i.text || ''}」 动机：${(i.words || []).join('、')}`;
        break;
      case 'adjust_setpoint':
        s = `${VAR_NAME[i.variable] || i.variable} ${i.delta > 0 ? '+' : ''}${Number(i.delta).toFixed(2)}${e.result?.to !== undefined ? ` → 设定点 ${e.result.from} → ${e.result.to}` : ''}${i.reason ? `（${i.reason}）` : ''}`;
        break;
      case 'set_mode_bias':
        s = `${MODES[i.mode]?.name || i.mode} 偏置 ${Number(i.bias).toFixed(2)}`;
        break;
      case 'write_memory':
        s = `(${i.importance}) ${i.text || ''}`;
        break;
    }
    return s ? `<span class="args">${esc(s)}</span>` : '';
  }

  highlightKernel() {
    const k = this.app.kernel;
    const col = cssv(MODE_VAR[k.mode]);
    document.querySelectorAll('#sm-kernel g[data-m]').forEach((g) => {
      const m = g.dataset.m;
      const on = m === k.mode;
      const rect = g.querySelector('rect');
      g.classList.toggle('on', on);
      if (on) {
        rect.style.stroke = col;
        rect.style.fill = col + '33';
      } else if (m === 'stag') {
        rect.style.stroke = '';
        rect.style.fill = `rgba(116,217,179,${(k.stag * 0.3).toFixed(3)})`;
      } else {
        rect.style.stroke = '';
        rect.style.fill = '';
      }
    });
  }

  highlightSound() {
    const s = this.app.sound;
    document.querySelectorAll('#sm-sound g[data-s]').forEach((g) => {
      const on = g.dataset.s === s.state;
      const rect = g.querySelector('rect');
      g.classList.toggle('on', on);
      rect.style.stroke = on ? '#8db4ff' : '';
      rect.style.fill = on ? 'rgba(141,180,255,0.2)' : '';
    });
  }
}
