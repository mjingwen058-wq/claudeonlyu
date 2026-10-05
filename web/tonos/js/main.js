// 主循环：把五层接起来。快环（采集 → 扰动 → 内核 → 声音 / 图像）每帧跑，从不等慢环（LLM）。

import { Clock } from './clock.js';
import { Crowd } from './sim.js';
import { Capture } from './capture.js';
import { Features } from './features.js';
import { Kernel, MODES } from './kernel.js';
import { Lexicon } from './lexicon.js';
import { Memory, Mind } from './mind.js';
import { Sound } from './sound.js';
import { Body, Nerves, drawMap } from './image.js';
import { UI, MODE_VAR } from './ui.js';
import { Demo } from './demo.js';
import { Life } from './life.js';
import { safeStorage } from './util.js';

const $ = (id) => document.getElementById(id);
const store = safeStorage();
const KEY_KEY = 'tonos.apikey';
const MODEL_KEY = 'tonos.model';

const app = {
  clock: new Clock(),
  crowd: new Crowd(),
  capture: new Capture($('video')),
  features: new Features(),
  kernel: new Kernel(),
  lexicon: new Lexicon(),
  memory: new Memory(),
  sound: new Sound(),
  body: new Body($('body-cv')),
  nerves: new Nerves($('nerve-cv')),
  calib: 'desk',
  tracks: [],
  klog: [],
  klogV: 0,
};
app.mind = new Mind(app);

app.log = (text, col) => {
  app.klog.unshift({ at: app.clock.label(), text, col });
  app.klog.length = Math.min(app.klog.length, 40);
  app.klogV++;
};

app.setSpeed = (x) => {
  app.clock.speed = x;
  if (x > 1) app.clock.realtime = false;
  $('btn-speed').classList.toggle('on', x > 1);
  $('btn-speed').textContent = x > 1 ? '演示加速 60× · 开' : '演示加速 60×';
};

function loadPrefs() {
  if (!store) return;
  try {
    const key = store.getItem(KEY_KEY);
    if (key) { app.mind.apiKey = key; $('api-key').value = key; }
    const model = store.getItem(MODEL_KEY);
    if (model) { app.mind.model = model; }
  } catch { /* 忽略 */ }
}

// 演示里的闭馆：只改这个页面，不写进它的生命
function sandboxClose() {
  const day = app.clock.day;
  const drift = app.kernel.closeDay();
  const gone = app.lexicon.decayDay();
  const { forgotten } = app.memory.compress(day, app.clock.label(), app.clock.real);
  app.features.newDay();
  app.sound.newDay();
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  app.log(
    `闭馆 D${day}（演示）：沉积 ${app.kernel.v.sediment.toFixed(2)}；设定点漂移 唤醒 ${f(drift.arousal)} · 边界 ${f(drift.boundary)} · 充盈 ${f(drift.fullness)}；词条按天衰减${gone.length ? `（${gone.join('、')} 淡出）` : ''}；记忆压成摘要，遗忘 ${forgotten} 条`,
    'var(--flow)',
  );
  app.clock.nextDay();
  app.mind.version++;
  app.log(`D${app.clock.day} 开馆（演示）`, 'var(--flow)');
}

// 闭馆：演示里在沙盒中做；本地模式可以手动闭馆；共享生命按北京时间自动闭馆
app.closeDay = async () => {
  const L = app.life;
  if (L.sandbox || L.mode === 'pending') { sandboxClose(); return; }
  const r = await L.closeDay();
  if (r === 'shared') app.log('共享生命按北京时间自动闭馆。手动闭馆只在演示里可用（先开演示加速）', 'var(--warn)');
  else { app.features.newDay(); app.sound.newDay(); }
};

app.demo = new Demo(app);
app.ui = new UI(app);
app.life = new Life(app);
app.mind.onEffect = (name, input, result) => app.life.fromTool(name, input, result);
app.mind.proxy = () => app.life.shared && app.life.info.llm && !app.life.sandbox;
loadPrefs();
$('model').value = app.mind.model;
app.life.init().catch((e) => app.log(`生命没有接上：${e.message}`, 'var(--bad)'));

// 结束或唤回时，截下它最后一刻的样子（必须在渲染之后的同一帧里读画布）
app.thumbWaiters = [];
app.captureThumb = () => new Promise((resolve) => {
  app.thumbWaiters.push(resolve);
  setTimeout(() => resolve(''), 1500);
});
function snapshot() {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0b0d';
  g.fillRect(0, 0, c.width, c.height);
  if (app.body.ok) g.drawImage($('body-cv'), 0, 0, c.width, c.height);
  const n = $('nerve-cv');
  if (n.width && n.clientWidth) g.drawImage(n, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.82); } catch { return ''; }
}

if (!app.body.ok) {
  $('img-fail').hidden = false;
  $('img-fail').textContent = `图像通道没有启动：${app.body.error}。其他通道照常运行。`;
}

// ———— 事件分发 ————
function onFeatureEvent(e) {
  switch (e.type) {
    case 'arrive': {
      app.sound.onArrive(e.x);
      const st = app.features.per.get(e.id);
      if (st) app.nerves.burst(st.fx, st.fy, 0.3);
      break;
    }
    case 'onset': {
      app.sound.onOnset(e, app.kernel.v.arousal);
      const st = app.features.per.get(e.id);
      if (st) app.nerves.burst(st.fx, st.fy, e.strength);
      break;
    }
    case 'summary':
      e.summary.label = app.clock.label();
      app.mind.addImportance(e.summary.items.reduce((s, i) => s + i.imp, 0));
      break;
  }
}

function onKernelEvent(e) {
  if (e.type === 'mode') app.log(`${MODES[e.from].name} → ${MODES[e.to].name}`, `var(${MODE_VAR[e.to]})`);
  else if (e.type === 'mutate') app.log(e.text, 'var(--m-mutate)');
  else if (e.type === 'ultra') app.log(e.text, 'var(--warn)');
}

function onMindEvent(e) {
  if (e.type === 'wake') app.log(`唤醒 LLM：${e.report.wake_reason}`, 'var(--flow)');
  else if (e.type === 'done') app.life.episode(app.mind.episodes[0]);
  else if (e.type === 'utter') app.sound.utter(e.words, app.lexicon, app.features.count > 0);
}

// ———— 主循环 ————
let last = performance.now();
let crashed = false;
function frame(ts) {
  const dt = Math.min(0.25, Math.max(0, (ts - last) / 1000));
  last = ts;
  try {
    const a = app;
    const dtEx = a.clock.advance(dt);
    if (a.capture.on) a.capture.detect(ts);
    a.crowd.update(dt);
    a.tracks = [...a.capture.current(ts / 1000), ...a.crowd.tracks()];
    a.features.update(a.tracks, dt, dtEx, a.calib, a.kernel.predictability);
    a.kernel.step(a.features.v, dt, dtEx);
    for (const e of a.features.drain()) onFeatureEvent(e);
    for (const e of a.kernel.drain()) onKernelEvent(e);
    a.mind.tick(dt);
    for (const e of a.mind.drain()) onMindEvent(e);

    a.sound.emit(a.features.list, dt);
    a.sound.update(dt, {
      count: a.features.count, mode: a.kernel.mode, stag: a.kernel.stag, lexicon: a.lexicon,
      sediment: a.kernel.v.sediment, wear: a.kernel.v.wear, arousal: a.kernel.v.arousal,
    });
    for (const l of a.sound.lit) if (l.at <= a.sound.now) a.lexicon.light(l.word, l.at);

    const ripples = [];
    for (const r of a.sound.ripples) {
      const age = a.sound.now - r.at;
      if (age >= 0 && age < 1) ripples.push({ node: r.node, age, vel: r.vel });
    }
    a.body.render(dt, {
      mode: a.kernel.mode, v: a.kernel.v, seed: a.kernel.seed, sediment: a.kernel.v.sediment,
      people: a.features.list, ripples,
    });
    a.nerves.update(dt, a.features.list);
    a.nerves.draw(a.body.lag.boundary);
    if (a.thumbWaiters.length) {
      const url = snapshot();
      for (const r of a.thumbWaiters.splice(0)) r(url);
    }
    a.life.tick(dt, dtEx);
    drawMap($('map-cv'), a.features.list, ripples, { labels: !a.ui.immersive });

    a.ui.frame(dt);
    a.demo.update(dt);
    const demoLabel = a.demo.on ? '停止演示' : '自动演示';
    if ($('btn-demo').textContent !== demoLabel) $('btn-demo').textContent = demoLabel;
    if (a.clock.speed > 1 && a.clock.pastClosing) a.closeDay();
  } catch (err) {
    if (!crashed) {
      crashed = true;
      console.error(err);
      app.log(`出错：${err.message}`, 'var(--bad)');
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ———— 控制 ————
async function startAudio() {
  try {
    await app.sound.start();
    $('btn-sound').classList.add('on');
    $('btn-sound').textContent = '声音 开';
  } catch (e) {
    $('btn-sound').textContent = '声音不可用';
    app.log(`声音没有启动：${e.message}`, 'var(--warn)');
  }
}

async function startCam() {
  const btn = $('btn-cam');
  btn.disabled = true;
  btn.textContent = '摄像头启动中…';
  try {
    await app.capture.start((s) => { $('cap-status').textContent = s; });
    btn.textContent = '关摄像头';
    btn.classList.add('on');
    app.log(`摄像头已开启 · 骨骼识别用 ${app.capture.delegate} · 模型来自${app.capture.source}`, 'var(--flow)');
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    const msg = denied
      ? '摄像头权限被拒绝。可以在地址栏左侧的网站权限里重新允许，或者先用模拟观众。'
      : e && e.name === 'NotFoundError' ? '没有找到摄像头。可以先用模拟观众。' : `摄像头没有打开：${e?.message || e}`;
    app.capture.stop();
    app.capture.status = msg;
    $('cap-status').textContent = msg;
    $('start-err').textContent = msg;
    app.log(msg, 'var(--bad)');
    btn.textContent = '开摄像头';
    btn.classList.remove('on');
  } finally {
    btn.disabled = false;
  }
}

function hideStart() {
  $('start').hidden = true;
}

$('go-demo').addEventListener('click', () => { startAudio(); hideStart(); app.demo.start(); });
$('go-cam').addEventListener('click', () => { startAudio(); hideStart(); app.ui.setView('hall'); startCam(); });
$('go-sim').addEventListener('click', () => { startAudio(); hideStart(); app.ui.setView('hall'); app.crowd.scenario('approach'); });

$('btn-cam').addEventListener('click', () => {
  startAudio();
  if (app.capture.on) {
    app.capture.stop();
    $('btn-cam').textContent = '开摄像头';
    $('btn-cam').classList.remove('on');
  } else startCam();
});
$('calib').addEventListener('change', (e) => { app.calib = e.target.value; });
// 模拟观众：顶栏的下拉菜单
function setMenu(open) {
  $('scenarios').hidden = !open;
  $('btn-sim').setAttribute('aria-expanded', String(open));
}
$('btn-sim').addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu($('scenarios').hidden);
});
$('scenarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scenario]');
  if (!b) return;
  startAudio();
  app.crowd.scenario(b.dataset.scenario);
  setMenu(false);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) setMenu(false);
});

// 控制抽屉
function setDrawer(open) {
  $('drawer').hidden = !open;
  $('btn-ctl').setAttribute('aria-expanded', String(open));
  $('btn-ctl').classList.toggle('on', open);
}
$('btn-ctl').addEventListener('click', () => setDrawer($('drawer').hidden));
$('drawer-close').addEventListener('click', () => setDrawer(false));
$('btn-speed').addEventListener('click', () => app.setSpeed(app.clock.speed > 1 ? 1 : 60));
$('btn-close').addEventListener('click', () => app.closeDay());
$('btn-mind').addEventListener('click', () => {
  const m = app.mind;
  m.enabled = !m.enabled;
  m.status = m.enabled ? '休眠中' : '认知层关闭';
  $('btn-mind').classList.toggle('on', m.enabled);
  $('btn-mind').textContent = m.enabled ? '认知层 开' : '认知层 关';
  app.log(m.enabled ? '认知层打开：内核压力大时会唤醒 LLM' : '认知层关闭：只在身体层运行，内核、声音、图像照常，不再发育', 'var(--flow)');
});
$('engine').addEventListener('change', (e) => {
  app.mind.engine = e.target.value;
  $('claude-row').hidden = e.target.value !== 'claude';
  if (e.target.value === 'claude' && !app.mind.apiKey) $('api-key').focus();
});
$('api-key').addEventListener('input', (e) => {
  app.mind.apiKey = e.target.value.trim();
  try { if (store) store.setItem(KEY_KEY, app.mind.apiKey); } catch { /* 忽略 */ }
});
$('model').addEventListener('change', (e) => {
  app.mind.model = e.target.value;
  try { if (store) store.setItem(MODEL_KEY, app.mind.model); } catch { /* 忽略 */ }
});
function wakeNow() {
  if (!app.mind.forceWake('manual')) app.log(app.mind.enabled ? 'LLM 正在思考，等这次结束' : '认知层已关闭，没有唤醒', 'var(--warn)');
  else app.ui.epSel = null;
}
$('btn-wake').addEventListener('click', wakeNow);
$('t-wake').addEventListener('click', wakeNow);
$('btn-sound').addEventListener('click', async () => {
  if (!app.sound.ctx) { await startAudio(); return; }
  const muted = app.sound.on;
  app.sound.setMuted(muted);
  $('btn-sound').classList.toggle('on', !muted);
  $('btn-sound').textContent = muted ? '声音 关' : '声音 开';
});
$('vol').addEventListener('input', (e) => app.sound.setVolume(Number(e.target.value)));
$('btn-demo').addEventListener('click', () => {
  if (app.demo.on) app.demo.stop();
  else { startAudio(); app.demo.start(); }
});
$('cap-stop').addEventListener('click', () => app.demo.stop());
// 长按 3 秒才生效：结束这一生 / 唤回
const HOLD_MS = 3000;
function bindHold(btn) {
  let t0 = 0, raf = 0;
  const cancel = () => { t0 = 0; cancelAnimationFrame(raf); btn.style.setProperty('--p', 0); };
  const step = (now) => {
    if (!t0) return;
    const p = Math.min(1, (now - t0) / HOLD_MS);
    btn.style.setProperty('--p', p);
    if (p >= 1) { cancel(); holdDone(btn); return; }
    raf = requestAnimationFrame(step);
  };
  const begin = () => { t0 = performance.now(); raf = requestAnimationFrame(step); };
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    begin();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !t0 && !btn.disabled) { e.preventDefault(); begin(); } });
  btn.addEventListener('keyup', cancel);
}
async function holdDone(btn) {
  const L = app.life;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在收进收藏柜…';
  try {
    if (L.shared) await L.checkAdmin();
    const thumb = await app.captureThumb();
    if (btn.dataset.act === 'revive') {
      const doc = await L.revive(btn.dataset.id, thumb);
      app.log(`唤回了 #${doc.n}，它带着原来的词库和记忆继续生长`, 'var(--flow)');
    } else {
      const doc = await L.end(thumb);
      app.log(`上一个生命收进了收藏柜。第 ${doc.n} 个生命诞生`, 'var(--flow)');
    }
    app.ui.cabinetDirty = true;
  } catch (e) {
    app.log(`没有完成：${e.message}`, 'var(--bad)');
    app.ui.flash(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
app.bindHold = bindHold;
document.querySelectorAll('button.hold').forEach(bindHold);
$('admin-key').addEventListener('input', (e) => app.life.setAdminKey(e.target.value.trim()));

// 快捷键：1 展厅 · 2 思考 · 3 全流程 · 4 收藏柜 · F 沉浸投影 · Esc 退出
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const views = { 1: 'hall', 2: 'think', 3: 'flow', 4: 'cabinet' };
  if (views[e.key]) { app.ui.setImmersive(false); app.ui.setView(views[e.key]); }
  if (e.key === 'f' || e.key === 'F') app.ui.setImmersive(!app.ui.immersive);
  if (e.key === 'Escape') {
    if (app.ui.immersive) app.ui.setImmersive(false);
    else if (!$('drawer').hidden) setDrawer(false);
    else app.demo.stop();
  }
});

// 便于在控制台里调试
window.tonos = app;
