// 全流程视图：把每一层的中间数据画出来。画布每帧画，文字和走势线每秒 10 次。

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

export class UI {
  constructor(app) {
    this.app = app;
    this.acc = 1;
    this.v = {};
    this.spans = new Map();
    this.build();
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

    const vr = $('var-rows');
    vr.innerHTML = VAR_META.map((m) => `<div class="vrow" data-k="${m.key}">
      <span class="nm">${m.name}<span class="tag">${m.scale}</span></span><span class="val">0.00</span><canvas></canvas>
      <span class="see">${esc(m.dyn)} · 被${esc(m.by)}推动 · 画面：${esc(m.see)}</span></div>`).join('');
    this.vars = Object.fromEntries(VAR_META.map((m) => {
      const row = vr.querySelector(`[data-k="${m.key}"]`);
      return [m.key, { val: row.querySelector('.val'), cv: row.querySelector('canvas') }];
    }));

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

  frame(dt) {
    const a = this.app;
    this.drawCam();
    this.drawPhysics();
    this.acc += dt;
    if (this.acc >= 0.1) {
      this.acc = 0;
      this.slow();
    }
    // 词云的高亮要跟上声音
    this.cloud();
  }

  drawCam() {
    const a = this.app;
    const f = fit($('cam-cv'));
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
    $('cam-empty').hidden = live || tracks.length > 0;
    g.font = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    for (const t of tracks) {
      const col = idColor(t.id);
      const P = (i) => [ox + t.lm[i].x * dw, oy + t.lm[i].y * dh];
      const vis = (i) => t.lm[i] && (t.lm[i].visibility ?? 1) > 0.5;
      g.strokeStyle = col;
      g.lineWidth = 1.6;
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
    // 顶部
    $('clock').textContent = a.clock.label();
    const chip = $('mode-chip');
    chip.textContent = MODES[k.mode].name;
    chip.style.color = `var(${MODE_VAR[k.mode]})`;

    // ① 采集
    $('cap-status').textContent = a.capture.on
      ? `${a.capture.status.split(' · ')[0]} · ${Math.round(a.capture.fps)} fps · ${a.capture.detectMs.toFixed(0)} ms`
      : a.capture.status;
    $('people').innerHTML = F.list.length
      ? F.list.map((p) => `<li><b style="color:${idColor(p.id)}">${p.id}</b>${p.src === 'sim' ? '模拟 · ' : '摄像头 · '}停留 ${Math.round(F.now - p.first)}s · 距离 ${p.prox.toFixed(2)} · 能量 ${p.e.toFixed(2)}${p.raised ? ' · 举手' : ''}</li>`).join('')
      : '<li>没有人：内核照样在呼吸</li>';

    // ② 转换
    for (const f of FEATURES) {
      const r = this.feat[f.key];
      const v = F.v[f.key];
      r.bar.style.width = `${Math.round(v * 100)}%`;
      r.val.textContent = v.toFixed(2);
      spark(r.cv, F.hist[f.key], { col: '#8db4ff' });
    }
    const v = F.v;
    $('perturb-line').textContent = `/perturb ${[v.density, v.intrusion, v.energy, v.dwell, v.predict, v.sync, v.daily].map((x) => x.toFixed(2)).join(' ')}  #${F.sent}`;
    $('pat-next').textContent = `每 ${F.patternEvery} 秒 · 下一次 ${Math.ceil(F.patternEvery - F.windowT)}s`;
    this.once('pat', F.summaries.length && F.summaries[0].at, () => {
      $('patterns').innerHTML = F.summaries.slice(0, 6).map((s) => `<li><time>${esc(s.label || '')}</time>${esc(s.items.map((i) => i.text).join(' · '))}</li>`).join('');
    });

    // ③ 内核
    for (const meta of VAR_META) {
      const r = this.vars[meta.key];
      const val = k.v[meta.key];
      r.val.textContent = val.toFixed(2);
      const isSed = meta.key === 'sediment';
      spark(r.cv, k.hist[meta.key], {
        col: cssv(MODE_VAR[k.mode]) || '#e7e3d9',
        set: k.histSet[meta.key],
        min: 0,
        max: isSed ? Math.max(1, Math.ceil(val + 0.2)) : 1,
      });
    }
    this.highlightKernel();
    for (const c of CANDIDATES) {
      const r = this.scores[c];
      const sc = k.scores[c];
      r.bar.style.width = `${Math.round(sc * 100)}%`;
      r.bar.style.background = sc >= ENTER ? `var(${MODE_VAR[c]})` : 'var(--ink)';
      r.val.textContent = sc.toFixed(2);
      const b = k.bias[c];
      r.bias.textContent = b ? `偏置 ${b > 0 ? '+' : ''}${b.toFixed(2)}` : '';
    }
    $('mode-time').textContent = k.mode === 'rest'
      ? `静息 ${Math.round(k.modeT)}s`
      : `${MODES[k.mode].name} ${Math.round(k.modeT)}s${k.mode !== 'mutate' && k.modeT < k.minDwell ? ` · 最短停留还剩 ${Math.ceil(k.minDwell - k.modeT)}s` : ''}`;
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
    $('mind-status').textContent = !m.enabled ? '认知层关闭' : m.busy ? '思考中…' : `休眠中${m.cooldown > 0 ? ` · 冷却 ${Math.ceil(m.cooldown)}s` : ''}`;
    for (const w of WAKE) {
      const r = this.wake[w.key];
      const c = m.cond[w.key];
      r.bar.style.width = `${Math.round(c * 100)}%`;
      r.val.textContent = `${Math.round(c * 100)}%`;
      r.row.classList.toggle('fire', c >= 1 || (m.busy && m.lastReason === w.key));
    }
    $('m-wakes').textContent = m.wakes;
    $('m-engine').textContent = m.engine === 'claude' && m.apiKey ? (MODELS.find((x) => x.id === m.model)?.label || m.model) : '规则模拟';
    $('m-skip').textContent = m.skipped ? `关闭期间跳过 ${m.skipped} 次` : '';
    this.once('mind', m.version, () => {
      if (m.lastReport) {
        $('report-at').textContent = `${m.lastReport.time} · ${m.lastReport.wake_reason}`;
        $('report').textContent = JSON.stringify(m.lastReport, null, 2)
          .replace(/\[\s+("[^"]*"),\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2, $3]')
          .replace(/\[\s+((?:"[^"]*",?\s*)+)\]/g, (s, inner) => `[${inner.replace(/\s*\n\s*/g, ' ').trim()}]`);
      }
      $('tools').innerHTML = m.toolLog.slice(0, 16).map((e) => `<li><time>${esc(e.at)}</time><span class="tool">${esc(e.name)}</span><span class="st ${e.status}">${STATUS[e.status]}</span> <small style="color:var(--faint)">${esc(e.by)}</small>${this.toolArgs(e)}${e.note ? `<span class="args" style="color:var(--warn)">${esc(e.note)}</span>` : ''}</li>`).join('');
      $('mind-text').textContent = m.lastText ? `解释器的叙述：${m.lastText}` : '';
      $('memory').innerHTML = a.memory.items.slice(0, 12).map((x) => `<li><span class="imp">${x.importance}</span>${esc(x.text)}</li>`).join('') || '<li>还没有记忆</li>';
    });

    // ⑤ 表达
    this.layoutCloud();
    const P = a.body.params;
    $('img-params').textContent = P ? `F ${P.F.toFixed(4)} · k ${P.K.toFixed(4)} · ${P.steps} 步/帧` : '';
    $('lex-count').textContent = `${a.lexicon.words.size} 个词 · 权重按天衰减`;
    this.once('traj', a.lexicon.version, () => {
      $('trajectory').innerHTML = a.lexicon.trajectory.slice(0, 8).map((t) => `<li><time>${esc(t.at)}</time>「${esc(t.text)}」 <b>${esc(t.words.join(' · '))}</b></li>`).join('') || '<li>还没有话语</li>';
    });
    $('snd-state').textContent = SOUND_STATES[s.state];
    $('snd-ens').textContent = ENSEMBLES[s.ensemble];
    this.highlightSound();
    this.once('notes', s.version, () => {
      $('notes').innerHTML = s.log.filter((e) => e.at <= s.now).slice(0, 8).map((e) => `<li>/note ${e.midi} ${e.vel.toFixed(2)} ${NODES[e.node].id} ${e.kind}${e.word ? ' ' + esc(e.word) : ''}</li>`).join('');
    });

    // 流水线
    const act = [
      F.count ? 0.35 + 0.4 * Math.min(1, F.v.energy + 0.2) : 0.04,
      F.count ? 0.15 + 0.5 * Math.max(F.v.energy, F.v.density) : 0.05,
      0.1 + 0.45 * k.v.arousal,
      m.busy ? 0.6 : 0.05 + 0.3 * Math.max(...Object.values(m.cond)),
      Math.min(0.6, 0.06 + 0.05 * s.log.filter((e) => e.at <= s.now && s.now - e.at < 1).length),
    ];
    document.querySelectorAll('#pipe li').forEach((li, i) => {
      li.style.setProperty('--act', act[i].toFixed(3));
      li.classList.toggle('hot', act[i] > 0.45);
    });
    $('pipe-1').textContent = F.count ? `${F.count} 人 · ${a.capture.on ? `摄像头 ${Math.round(a.capture.fps)} fps` : '模拟'}` : a.capture.on ? '摄像头 · 没有人' : '没有人';
    $('pipe-2').textContent = `/perturb 30Hz · 能量 ${F.v.energy.toFixed(2)}`;
    $('pipe-3').textContent = `${MODES[k.mode].name} · 唤醒 ${k.v.arousal.toFixed(2)}`;
    $('pipe-4').textContent = !m.enabled ? '认知层关闭' : m.busy ? '思考中…' : `休眠 · 已唤醒 ${m.wakes} 次`;
    $('pipe-5').textContent = `${SOUND_STATES[s.state]} · ${ENSEMBLES[s.ensemble]} · ${a.lexicon.words.size} 词`;
    $('expo-hud').textContent = `${a.clock.label()} · ${MODES[k.mode].name} · ${F.count} 人 · 声音 ${SOUND_STATES[s.state]} · 按 V 返回全流程`;
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
