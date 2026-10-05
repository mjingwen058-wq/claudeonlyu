// TONOS 内核与工具限制的单元测试：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../web/tonos/js/kernel.js';
import { Clock } from '../web/tonos/js/clock.js';
import { Features } from '../web/tonos/js/features.js';
import { Lexicon } from '../web/tonos/js/lexicon.js';
import { Memory, Mind } from '../web/tonos/js/mind.js';

const ZERO = { density: 0, intrusion: 0, energy: 0, dwell: 0, sync: 0 };
const quiet = () => {
  const k = new Kernel();
  k.p.noise = 0;
  k.p.breathAmp = 0;
  return k;
};

test('唤醒受扰后带起伏地回到设定点（欠阻尼，不是复位）', () => {
  const k = quiet();
  const dt = 1 / 60;
  const set = k.setpoint('arousal');
  for (let i = 0; i < 60; i++) k.step({ ...ZERO, density: 1 }, dt, 0);
  const peak = k.v.arousal;
  assert.ok(peak > set + 0.05, `扰动后应上升，实际 ${peak}`);
  let min = 1;
  for (let i = 0; i < 60 * 12; i++) {
    k.step(ZERO, dt, 0);
    min = Math.min(min, k.v.arousal);
  }
  assert.ok(min < set - 0.005, `欠阻尼应冲过设定点，最低 ${min}`);
  assert.ok(Math.abs(k.v.arousal - set) < 0.02, `12 秒后应回到设定点附近，实际 ${k.v.arousal}`);
});

test('充盈度一阶泄漏：一个时间常数后剩约 37% 的偏离', () => {
  const k = quiet();
  const y0 = k.setpoint('fullness');
  k.v.fullness = 0.9;
  for (let i = 0; i < 3600; i++) k.step(ZERO, 0, 1);
  const expected = y0 + (0.9 - y0) * Math.exp(-1);
  assert.ok(Math.abs(k.v.fullness - expected) < 0.01, `期望 ${expected.toFixed(3)}，实际 ${k.v.fullness.toFixed(3)}`);
});

test('沉积只增不减', () => {
  const k = quiet();
  let prev = 0;
  for (let i = 0; i < 2000; i++) {
    k.step(i % 400 < 200 ? { density: 0.8, intrusion: 0.5, energy: 0.6, dwell: 0.3, sync: 0.2 } : ZERO, 1 / 60, 60 / 60);
    assert.ok(k.v.sediment >= prev);
    prev = k.v.sediment;
  }
  assert.ok(prev > 0);
});

test('状态机有滞回和最短停留，阈值附近不来回跳', () => {
  const k = quiet();
  k.minDwell = 20;
  let changes = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 120; i++) {
    // 让唤醒在 0.62–0.78 之间来回（跨过进入 / 退出阈值）
    const t = i * dt;
    k.v.arousal = 0.22 + (0.85 - 0.22) * (0.8 + 0.12 * Math.sin(t * 3));
    k.vel.arousal = 0;
    k.updateMode(dt);
    changes += k.drain().filter((e) => e.type === 'mode').length;
  }
  assert.ok(changes <= 1, `120 秒内最多切换 1 次，实际 ${changes}`);
  assert.equal(k.mode, 'withdraw');
});

test('设定点每次最多 ±0.15，且不超出总范围', () => {
  const k = quiet();
  const r = k.nudgeSetpoint('arousal', 0.4);
  assert.ok(Math.abs(r.applied - 0.15) < 1e-9);
  for (let i = 0; i < 10; i++) k.nudgeSetpoint('arousal', 0.15);
  assert.ok(Math.abs(k.setpoint('arousal') - 0.5) < 1e-9);
});

function makeMind() {
  const clock = new Clock();
  const kernel = quiet();
  const lexicon = new Lexicon();
  const memory = new Memory();
  const features = new Features();
  return { mind: new Mind({ kernel, lexicon, memory, clock, features }), clock, kernel, lexicon, memory };
}

test('update_lexicon 每次最多新增 3 个', () => {
  const { mind, lexicon } = makeMind();
  const add = ['一', '二', '三', '四'].map((w) => ({ word: w, valence: 0, category: 'crowd', x: 0, y: 0 }));
  const r = mind.execTool('update_lexicon', { add });
  assert.equal(r.status, 'truncated');
  assert.equal(lexicon.words.size, 3);
});

test('utter 有冷却，超长被截断', () => {
  const { mind, clock, lexicon } = makeMind();
  lexicon.add({ word: '边缘', valence: -0.3, category: 'boundary', x: 0, y: 0 });
  const a = mind.execTool('utter', { text: '一二三四五六七八九十一二三四五六七八九十多出来', words: ['边缘', '不存在'] });
  assert.equal(a.status, 'truncated');
  assert.deepEqual(a.result.words, ['边缘']);
  const b = mind.execTool('utter', { text: '再说一次', words: ['边缘'] });
  assert.equal(b.status, 'rejected');
  clock.real += 31;
  const c = mind.execTool('utter', { text: '再说一次', words: ['边缘'] });
  assert.equal(c.status, 'ok');
});

test('set_mode_bias 只改权重并限制在 ±0.5；write_memory 重要性 1–10', () => {
  const { mind, kernel, memory } = makeMind();
  const r = mind.execTool('set_mode_bias', { mode: 'explore', bias: 0.9 });
  assert.equal(r.status, 'truncated');
  assert.equal(kernel.bias.explore, 0.5);
  assert.equal(kernel.mode, 'rest');
  mind.execTool('write_memory', { text: '测试', importance: 42 });
  assert.equal(memory.items[0].importance, 10);
});
