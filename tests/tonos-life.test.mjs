// 共享生命：增量合并、跨天闭馆、结束与唤回、口令。node --test tests/tonos-life.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { keys, getLife, postOps, listCabinet, endLife, reviveLife, rollover, newLife } from '../web/tonos/js/life-core.js';
import { memoryStore } from '../web/tonos/api/_store.js';
import { lifeHandler, cabinetHandler, mindHandler } from '../web/tonos/api/_handlers.js';

const K = keys('t');
const DAY = 86400e3;
const T0 = Date.parse('2026-10-05T04:00:00Z'); // 北京时间 12:00

test('第一次读取时诞生第 1 个生命', async () => {
  const s = memoryStore();
  const doc = await getLife(s, K, T0);
  assert.equal(doc.n, 1);
  assert.equal(doc.day, 1);
  assert.equal(doc.bornDate, '2026-10-05');
});

test('两个节点交错提交：沉积相加，词条合并，记忆不丢', async () => {
  const s = memoryStore();
  await getLife(s, K, T0);
  const a = [{ t: 'perturb', sediment: 0.002, comp: { density: 10 }, intensity: 5 },
    { t: 'lex', add: [{ word: '拥挤', valence: -0.5, category: 'crowd', x: -0.6, y: 0.5 }] },
    { t: 'mem', text: '东侧聚集', importance: 7, at: 'D1 12:00' }];
  const b = [{ t: 'perturb', sediment: 0.003, comp: { density: 4 }, intensity: 2 },
    { t: 'lex', add: [{ word: '注视', valence: 0.3, category: 'attention', x: 0.1, y: 0.5 }], strengthen: ['拥挤'] },
    { t: 'mem', text: '一人驻足', importance: 4, at: 'D1 12:01' }];
  await postOps(s, K, a, T0);
  const doc = await postOps(s, K, b, T0 + 1000);
  assert.ok(Math.abs(doc.kernel.sediment - 0.005) < 1e-9);
  assert.equal(doc.kernel.comp.density, 14);
  const words = doc.lexicon.words.map((w) => w.word).sort();
  assert.deepEqual(words, ['拥挤', '注视']);
  assert.ok(doc.lexicon.words.find((w) => w.word === '拥挤').weight > 0.42);
  assert.equal(doc.memory.length, 2);
});

test('并发写入冲突时会重试，两边的增量都在', async () => {
  const s = memoryStore();
  await getLife(s, K, T0);
  await Promise.all([
    postOps(s, K, [{ t: 'perturb', sediment: 0.001 }], T0),
    postOps(s, K, [{ t: 'perturb', sediment: 0.001 }], T0),
    postOps(s, K, [{ t: 'perturb', sediment: 0.001 }], T0),
  ]);
  const doc = await getLife(s, K, T0);
  assert.ok(Math.abs(doc.kernel.sediment - 0.003) < 1e-9);
});

test('增量有上限：一次沉积最多 0.01，新词最多 3 个', async () => {
  const s = memoryStore();
  const doc = await postOps(s, K, [
    { t: 'perturb', sediment: 5 },
    { t: 'lex', add: ['一', '二', '三', '四'].map((w) => ({ word: w, valence: 0, category: 'crowd', x: 0, y: 0 })) },
    { t: 'setpoint', key: 'arousal', delta: 0.9 },
  ], T0);
  assert.ok(doc.kernel.sediment <= 0.01 + 1e-9);
  assert.equal(doc.lexicon.words.length, 3);
  assert.ok(Math.abs(doc.kernel.offset.arousal - 0.15) < 1e-9);
});

test('跨天闭馆只做一次，第二天再读不会重复', async () => {
  const s = memoryStore();
  await postOps(s, K, [{ t: 'lex', add: [{ word: '余温', valence: 0.5, category: 'interior', x: 0, y: 0 }] }], T0);
  const d1 = await getLife(s, K, T0 + DAY);
  assert.equal(d1.day, 2);
  const w1 = d1.lexicon.words[0].weight;
  assert.ok(w1 < 0.42, '词条按天衰减');
  const d2 = await getLife(s, K, T0 + DAY + 3600e3);
  assert.equal(d2.day, 2);
  assert.equal(d2.lexicon.words[0].weight, w1);
});

test('结束这一生：收进柜子，诞生第 2 个；唤回后第 1 个带着原来的词回来', async () => {
  const s = memoryStore();
  await postOps(s, K, [{ t: 'lex', add: [{ word: '收缩', valence: -0.5, category: 'boundary', x: 0, y: 0 }] }], T0);
  const fresh = await endLife(s, K, 'data:image/jpeg;base64,AAAA', T0 + 1000);
  assert.equal(fresh.n, 2);
  assert.equal(fresh.lexicon.words.length, 0);
  let cab = await listCabinet(s, K);
  assert.equal(cab.length, 1);
  assert.equal(cab[0].n, 1);
  assert.deepEqual(cab[0].words, ['收缩']);
  assert.equal(cab[0].thumb, true);
  const back = await reviveLife(s, K, cab[0].id, '', T0 + 2000);
  assert.equal(back.n, 1);
  assert.deepEqual(back.lexicon.words.map((w) => w.word), ['收缩']);
  cab = await listCabinet(s, K);
  assert.equal(cab.length, 1);
  assert.equal(cab[0].n, 2, '被替换下来的第 2 个收进了柜子');
});

test('在柜子里的日子不算：唤回后不会补做闭馆', async () => {
  const s = memoryStore();
  await postOps(s, K, [{ t: 'lex', add: [{ word: '呼吸', valence: 0.3, category: 'interior', x: 0, y: 0 }] }], T0);
  await endLife(s, K, '', T0);
  const [e] = await listCabinet(s, K);
  const back = await reviveLife(s, K, e.id, '', T0 + 10 * DAY);
  assert.equal(back.day, 1);
  assert.equal(back.lexicon.words[0].weight, 0.42);
});

test('接口：没有口令或口令不对时拒绝结束生命', async () => {
  const env = { TONOS_PREFIX: `x${Math.random()}` };
  let r = await cabinetHandler({ method: 'POST', body: { action: 'end', key: 'a' }, env });
  assert.equal(r.status, 403);
  env.TONOS_ADMIN_KEY = 'secret';
  r = await cabinetHandler({ method: 'POST', body: { action: 'end', key: 'wrong' }, env });
  assert.equal(r.status, 403);
  r = await cabinetHandler({ method: 'POST', body: { action: 'end', key: 'secret' }, env });
  assert.equal(r.status, 200);
  assert.equal(r.json.life.n, 2);
  const g = await lifeHandler({ method: 'GET', env });
  assert.equal(g.json.life.n, 2);
  assert.equal(g.json.admin, true);
});

test('接口：没配 Anthropic Key 时思考接口返回未启用；配了会限频', async () => {
  const env = { TONOS_PREFIX: `y${Math.random()}` };
  let r = await mindHandler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] }, env });
  assert.equal(r.status, 501);
  env.ANTHROPIC_API_KEY = 'k';
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ content: [], stop_reason: 'end_turn' }) });
  r = await mindHandler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] }, env, now: T0, fetchImpl: fake });
  assert.equal(r.status, 200);
  r = await mindHandler({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] }, env, now: T0 + 5000, fetchImpl: fake });
  assert.equal(r.status, 429);
  r = await mindHandler({ method: 'POST', body: { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }, env, now: T0 + 6000, fetchImpl: fake });
  assert.equal(r.status, 200, '同一次唤醒的后续轮次不限频');
});

test('长时间没人打开：最多补 30 天，天数照算', () => {
  const doc = newLife(1, T0);
  rollover(doc, T0 + 100 * DAY);
  assert.equal(doc.day, 101);
});
