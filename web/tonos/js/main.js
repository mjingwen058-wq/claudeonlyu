// 主循环：把五层接起来。快环（采集 → 扰动 → 内核 → 声音 / 图像）每帧跑，从不等慢环（LLM）。

import { Clock } from './clock.js';
import { Crowd } from './sim.js';
import { Capture } from './capture.js';
import { Features } from './features.js';
import { Kernel, MODES } from './kernel.js';
import { Lexicon } from './lexicon.js';
import { Memory, Mind } from './mind.js';
import { Sound } from './sound.js';
import { Body, drawMap } from './image.js';
import { UI, MODE_VAR } from './ui.js';
import { Demo } from './demo.js';
import { safeStorage } from './util.js';

const $ = (id) => document.getElementById(id);
const store = safeStorage();
const SAVE_KEY = 'tonos.v1';
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
  $('btn-speed').classList.toggle('on', x > 1);
  $('btn-speed').textContent = x > 1 ? '演示加速 60× · 开' : '演示加速 60×';
};

function save() {
  if (!store) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify({
      day: app.clock.day,
      kernel: app.kernel.toJSON(),
      lexicon: app.lexicon.toJSON(),
      memory: app.memory.toJSON(),
    }));
  } catch { /* 存不了就算了，页面照常运行 */ }
}

function load() {
  if (!store) return;
  try {
    const s = JSON.parse(store.getItem(SAVE_KEY) || 'null');
    if (s) {
      app.clock.day = s.day || 1;
      app.kernel.load(s.kernel);
      app.lexicon.load(s.lexicon);
      app.memory.load(s.memory);
      app.sound.selfPool = app.lexicon.top(4).map((w) => w.word);
      app.log(`载入展期存档：D${app.clock.day} 开馆，沉积 ${app.kernel.v.sediment.toFixed(2)}，词库 ${app.lexicon.words.size} 个词`, 'var(--flow)');
    }
    const key = store.getItem(KEY_KEY);
    if (key) { app.mind.apiKey = key; $('api-key').value = key; }
    const model = store.getItem(MODEL_KEY);
    if (model) { app.mind.model = model; }
  } catch { /* 存档损坏时从头开始 */ }
}

// 闭馆：沉积 → 基调漂移，词条衰减，记忆压缩，存盘，第二天开馆
app.closeDay = () => {
  const day = app.clock.day;
  const drift = app.kernel.closeDay();
  const gone = app.lexicon.decayDay();
  const { forgotten } = app.memory.compress(day, app.clock.label(), app.clock.real);
  app.features.newDay();
  app.sound.newDay();
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  app.log(
    `闭馆 D${day}：沉积 ${app.kernel.v.sediment.toFixed(2)}；设定点漂移 唤醒 ${f(drift.arousal)} · 边界 ${f(drift.boundary)} · 充盈 ${f(drift.fullness)}；词条按天衰减${gone.length ? `（${gone.join('、')} 淡出）` : ''}；记忆压成摘要，遗忘 ${forgotten} 条；已存盘`,
    'var(--flow)',
  );
  app.clock.nextDay();
  app.mind.version++;
  save();
  app.log(`D${app.clock.day} 开馆`, 'var(--flow)');
};

app.demo = new Demo(app);
app.ui = new UI(app);
load();
$('model').value = app.mind.model;

if (!app.body.ok) {
  $('img-fail').hidden = false;
  $('img-fail').textContent = `图像通道没有启动：${app.body.error}。其他通道照常运行。`;
}

// ———— 事件分发 ————
function onFeatureEvent(e) {
  switch (e.type) {
    case 'arrive':
      app.sound.onArrive(e.x);
      break;
    case 'onset':
      app.sound.onOnset(e, app.kernel.v.arousal);
      break;
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
    drawMap($('map-cv'), a.features.list, ripples, { labels: !document.body.classList.contains('expo') });

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
$('go-cam').addEventListener('click', () => { startAudio(); hideStart(); startCam(); });
$('go-sim').addEventListener('click', () => { startAudio(); hideStart(); app.crowd.scenario('approach'); });

$('btn-cam').addEventListener('click', () => {
  startAudio();
  if (app.capture.on) {
    app.capture.stop();
    $('btn-cam').textContent = '开摄像头';
    $('btn-cam').classList.remove('on');
  } else startCam();
});
$('calib').addEventListener('change', (e) => { app.calib = e.target.value; });
$('scenarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scenario]');
  if (!b) return;
  startAudio();
  app.crowd.scenario(b.dataset.scenario);
});
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
$('btn-wake').addEventListener('click', () => {
  if (!app.mind.forceWake('reflect')) app.log(app.mind.enabled ? 'LLM 正在思考，等这次结束' : '认知层已关闭，没有唤醒', 'var(--warn)');
});
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
let resetArmed = 0;
$('btn-reset').addEventListener('click', () => {
  const now = performance.now();
  if (now - resetArmed < 4000) {
    try { if (store) store.removeItem(SAVE_KEY); } catch { /* 忽略 */ }
    location.reload();
    return;
  }
  resetArmed = now;
  $('btn-reset').textContent = '再点一次确认重置';
  setTimeout(() => { $('btn-reset').textContent = '重置展期'; }, 4000);
});

function setView(v) {
  document.body.classList.toggle('expo', v === 'expo');
  $('v-flow').classList.toggle('on', v !== 'expo');
  $('v-expo').classList.toggle('on', v === 'expo');
}
$('v-flow').addEventListener('click', () => setView('flow'));
$('v-expo').addEventListener('click', () => setView('expo'));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'v' || e.key === 'V') setView(document.body.classList.contains('expo') ? 'flow' : 'expo');
  if (e.key === 'Escape') { app.demo.stop(); setView('flow'); }
});

// 便于在控制台里调试
window.tonos = app;
