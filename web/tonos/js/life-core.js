// 一个生命的文档：服务器（Vercel 接口）和本地模式共用这套逻辑。
// 只存慢的、会生长的部分：沉积、设定点、模式偏置、词库、意义轨迹、记忆、思考摘要。
// 快变量（唤醒、边界、当前模式）留在各个页面里，跟着各自的摄像头走。

import { Kernel, SETPOINT_RANGE } from './kernel.js';
import { Lexicon } from './lexicon.js';
import { Memory } from './mind.js';
import { clamp } from './util.js';

export const SCHEMA = 1;
const MAX_WORDS = 120;
const MAX_MEMORY = 60;
const MAX_TRAJ = 30;
const MAX_EPISODES = 20;
const MAX_LOG = 30;
const COMP_KEYS = ['density', 'energy', 'intrusion', 'dwell', 'sync'];
const MODES = ['withdraw', 'explore', 'sleep', 'mutate'];

// 展厅在北京时间：日期按 UTC+8 计算
export function localDate(ts) {
  return new Date(ts + 8 * 3600e3).toISOString().slice(0, 10);
}
function localTime(ts) {
  return new Date(ts + 8 * 3600e3).toISOString().slice(11, 16);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
}
const str = (s, n) => String(s ?? '').slice(0, n);
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

export function newLife(n, now = Date.now()) {
  const k = new Kernel();
  const id = `L${n}-${now.toString(36)}`;
  return {
    schema: SCHEMA,
    id,
    n,
    born: new Date(now).toISOString(),
    bornDate: localDate(now),
    lastDate: localDate(now),
    day: 1,
    rev: 0,
    kernel: { ...k.toJSON(), comp: { ...k.comp }, dayIntensity: 0 },
    lexicon: { words: [], trajectory: [] },
    memory: [],
    episodes: [],
    log: [{ at: `D1 ${localTime(now)}`, text: `第 ${n} 个生命诞生` }],
    stats: { ops: 0, wakes: 0 },
    updatedAt: new Date(now).toISOString(),
  };
}

export function lifeTitle(doc) {
  return `#${doc.n} · 生于 ${doc.bornDate.slice(5).replace('-', '.')}`;
}

// 文档 → 可运算的对象
export function hydrate(doc) {
  const kernel = new Kernel();
  kernel.load(doc.kernel);
  kernel.comp = { ...kernel.comp, ...(doc.kernel.comp || {}) };
  kernel.dayIntensity = num(doc.kernel.dayIntensity);
  const lexicon = new Lexicon();
  for (const w of doc.lexicon.words || []) lexicon.add(w, w.weight, w.born);
  lexicon.trajectory = (doc.lexicon.trajectory || []).slice(0, MAX_TRAJ);
  const memory = new Memory();
  memory.items = (doc.memory || []).map((m) => ({ ...m, t: 0 }));
  return { kernel, lexicon, memory };
}

// 对象 → 文档
export function dehydrate(doc, { kernel, lexicon, memory }) {
  let words = [...lexicon.words.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_WORDS);
  words = words.map(({ word, valence, category, x, y, weight, born }) => ({ word, valence, category, x, y, weight: +weight.toFixed(4), born }));
  doc.kernel = { ...kernel.toJSON(), comp: { ...kernel.comp }, dayIntensity: kernel.dayIntensity };
  doc.lexicon = { words, trajectory: lexicon.trajectory.slice(0, MAX_TRAJ) };
  doc.memory = memory.items.slice(0, MAX_MEMORY).map(({ text, importance, kind, at, day }) => ({ text, importance, kind, at, day }));
  return doc;
}

function addLog(doc, now, text) {
  doc.log = [{ at: `D${doc.day} ${localTime(now)}`, text }, ...(doc.log || [])].slice(0, MAX_LOG);
}

// 闭馆一次：沉积推动设定点漂移，词条按天衰减，当天记忆压成摘要
function closeOneDay(doc, objs, now) {
  const { kernel, lexicon, memory } = objs;
  const drift = kernel.closeDay();
  const gone = lexicon.decayDay();
  const { forgotten } = memory.compress(doc.day, `D${doc.day} 闭馆`, 0);
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;
  addLog(doc, now, `闭馆 D${doc.day}：沉积 ${kernel.v.sediment.toFixed(2)}；设定点漂移 唤醒 ${f(drift.arousal)} · 边界 ${f(drift.boundary)} · 充盈 ${f(drift.fullness)}；${gone.length ? `${gone.join('、')} 淡出；` : ''}遗忘 ${forgotten} 条记忆`);
  doc.day += 1;
}

// 按真实日期补做闭馆。force = 手动闭馆（本地模式和演示用）
export function rollover(doc, now = Date.now(), force = false) {
  const today = localDate(now);
  let n = Math.max(0, daysBetween(doc.lastDate, today));
  if (force) n = Math.max(n, 1);
  if (!n) return false;
  const objs = hydrate(doc);
  // 长时间没人打开时，最多补 30 天
  for (let i = 0; i < Math.min(n, 30); i++) closeOneDay(doc, objs, now);
  if (n > 30) doc.day += n - 30;
  dehydrate(doc, objs);
  doc.lastDate = today;
  return true;
}

// 合并一批增量操作。多个页面同时提交时，沉积只做加法，词条按词合并，记忆追加，设定点按限幅叠加。
export function applyOps(doc, ops, now = Date.now()) {
  const list = Array.isArray(ops) ? ops.slice(0, 100) : [];
  if (!list.length) return 0;
  const objs = hydrate(doc);
  const { kernel, lexicon, memory } = objs;
  let applied = 0;
  for (const op of list) {
    if (!op || typeof op !== 'object') continue;
    switch (op.t) {
      case 'perturb': {
        kernel.v.sediment += clamp(num(op.sediment), 0, 0.01);
        for (const key of COMP_KEYS) kernel.comp[key] += clamp(num(op.comp?.[key]), 0, 60);
        kernel.dayIntensity += clamp(num(op.intensity), 0, 60);
        break;
      }
      case 'lex': {
        for (const a of (op.add || []).slice(0, 3)) {
          const word = str(a?.word, 4).trim();
          if (word) lexicon.add({ word, valence: num(a.valence), category: a.category, x: num(a.x), y: num(a.y) }, 0.42, doc.day);
        }
        for (const w of (op.strengthen || []).slice(0, 5)) lexicon.strengthen(str(w, 4), 0.15);
        for (const w of (op.fade || []).slice(0, 5)) lexicon.fade(str(w, 4), 0.2);
        break;
      }
      case 'utter':
        lexicon.say(str(op.at, 16), str(op.text, 24), (op.words || []).slice(0, 4).map((w) => str(w, 4)));
        break;
      case 'mem':
        memory.add({ text: str(op.text, 80), importance: num(op.importance, 1), kind: op.kind === 'summary' ? 'summary' : 'obs', at: str(op.at, 16), day: doc.day, t: 0 });
        break;
      case 'setpoint':
        if (op.key in SETPOINT_RANGE) kernel.nudgeSetpoint(op.key, num(op.delta));
        break;
      case 'bias':
        if (MODES.includes(op.mode)) kernel.bias[op.mode] = clamp(num(op.bias), -0.5, 0.5);
        break;
      case 'episode': {
        const e = {
          n: num(op.n), at: str(op.at, 16), reason: str(op.reason, 20), by: str(op.by, 16),
          calls: (op.calls || []).slice(0, 8).map((c) => [str(c?.[0], 20), str(c?.[1], 10)]),
          utter: str(op.utter, 24),
        };
        doc.episodes = [e, ...(doc.episodes || [])].slice(0, MAX_EPISODES);
        doc.stats.wakes = num(doc.stats.wakes) + 1;
        break;
      }
      default:
        continue;
    }
    applied++;
  }
  dehydrate(doc, objs);
  doc.stats.ops = num(doc.stats.ops) + applied;
  return applied;
}

// 柜子里的一件标本（索引里只放小字段，图像和完整文档另存）
export function specimenEntry(doc, endedAt, hasThumb) {
  const words = [...(doc.lexicon.words || [])].sort((a, b) => b.weight - a.weight).slice(0, 8).map((w) => w.word);
  return {
    id: doc.id,
    n: doc.n,
    title: lifeTitle(doc),
    born: doc.born,
    ended: new Date(endedAt).toISOString(),
    days: doc.day,
    sediment: +num(doc.kernel.sediment).toFixed(2),
    words,
    wordCount: (doc.lexicon.words || []).length,
    memoryCount: (doc.memory || []).length,
    lastUtter: doc.lexicon.trajectory?.[0]?.text || '',
    thumb: !!hasThumb,
  };
}

export function validThumb(t) {
  return typeof t === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(t) && t.length < 400000 ? t : '';
}

// ———— 存储之上的操作：服务器接口和本地模式共用 ————
// store: { get(key) → {value, rev} | null, cas(key, value, rev) → bool, set(key, value), del(key) }
// rev 是整数版本号，cas 只在当前版本等于 rev 时写入

export function keys(prefix = 'tonos') {
  return { life: `${prefix}:life`, cabinet: `${prefix}:cabinet`, specimen: (id) => `${prefix}:specimen:${id}` };
}

async function update(store, key, fn, init) {
  for (let i = 0; i < 6; i++) {
    const cur = await store.get(key);
    const value = cur ? cur.value : init();
    const rev = cur ? cur.rev : 0;
    const next = await fn(value);
    if (next === undefined) return value;
    if (await store.cas(key, next, rev)) return next;
  }
  throw new Error('存储冲突太多，请稍后再试');
}

async function nextNumber(store, K) {
  const cab = await store.get(K.cabinet);
  const cur = await store.get(K.life);
  const ns = [...(cab ? cab.value : []).map((e) => e.n), cur ? cur.value.n : 0];
  return Math.max(0, ...ns) + 1;
}

export async function getLife(store, K, now = Date.now()) {
  return update(store, K.life, (doc) => {
    if (!rollover(doc, now) && doc.rev > 0) return undefined;
    doc.rev += 1;
    doc.updatedAt = new Date(now).toISOString();
    return doc;
  }, () => newLife(1, now));
}

export async function postOps(store, K, ops, now = Date.now()) {
  return update(store, K.life, (doc) => {
    const rolled = rollover(doc, now);
    const n = applyOps(doc, ops, now);
    if (!rolled && !n && doc.rev > 0) return undefined;
    doc.rev += 1;
    doc.updatedAt = new Date(now).toISOString();
    return doc;
  }, () => newLife(1, now));
}

export async function forceClose(store, K, now = Date.now()) {
  return update(store, K.life, (doc) => {
    rollover(doc, now, true);
    doc.rev += 1;
    return doc;
  }, () => newLife(1, now));
}

export async function listCabinet(store, K) {
  const cab = await store.get(K.cabinet);
  return cab ? cab.value : [];
}

export async function getSpecimen(store, K, id) {
  const s = await store.get(K.specimen(id));
  return s ? s.value : null;
}

async function archive(store, K, doc, thumb, now) {
  const t = validThumb(thumb);
  await store.set(K.specimen(doc.id), { doc, thumb: t, ended: new Date(now).toISOString() });
  await update(store, K.cabinet, (list) => [specimenEntry(doc, now, t), ...list.filter((e) => e.id !== doc.id)], () => []);
}

// 结束这一生：当前生命收进柜子，诞生一个新的
export async function endLife(store, K, thumb, now = Date.now()) {
  const cur = await getLife(store, K, now);
  addLog(cur, now, '这一生结束，被收进收藏柜');
  await archive(store, K, cur, thumb, now);
  const n = await nextNumber(store, K);
  const fresh = newLife(n, now);
  fresh.rev = cur.rev + 1;
  await update(store, K.life, () => fresh, () => fresh);
  return fresh;
}

// 唤回：当前的先收进柜子，被唤回的带着原来的全部状态继续生长
export async function reviveLife(store, K, id, thumb, now = Date.now()) {
  const spec = await getSpecimen(store, K, id);
  if (!spec) throw new Error('柜子里没有这个生命');
  const cur = await getLife(store, K, now);
  addLog(cur, now, `让位给 #${spec.doc.n}，被收进收藏柜`);
  await archive(store, K, cur, thumb, now);
  const back = spec.doc;
  back.lastDate = localDate(now); // 在柜子里的日子不算，也不衰减
  back.rev = cur.rev + 1;
  addLog(back, now, '从收藏柜被唤回，继续生长');
  await update(store, K.life, () => back, () => back);
  await update(store, K.cabinet, (list) => list.filter((e) => e.id !== id), () => []);
  await store.del(K.specimen(id));
  return back;
}
