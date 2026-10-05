// 用模拟观众跑一遍"骨骼 → 扰动 → 内核"，打印各阶段的数值，便于标定参数
import { Crowd } from '../web/tonos/js/sim.js';
import { Features } from '../web/tonos/js/features.js';
import { Kernel } from '../web/tonos/js/kernel.js';

const crowd = new Crowd(), feat = new Features(), k = new Kernel();
const dt = 1 / 60;
const script = { 0: null, 5: 'approach', 50: 'gather', 95: 'sync', 130: 'clear', 135: 'circle' };
let t = 0;
const modes = [];
for (let step = 0; step < 60 * 240; step++) {
  const s = Math.round(t * 60) / 60;
  if (script[s] !== undefined && Number.isInteger(s) && script[s]) crowd.scenario(script[s]);
  crowd.update(dt);
  feat.update(crowd.tracks(), dt, dt * 60, 'desk', k.predictability);
  const v = feat.v;
  k.step(v, dt, dt * 60);
  for (const e of k.drain()) modes.push(`${t.toFixed(1)}s ${e.type} ${e.from || ''}→${e.to || ''} ${e.text || ''}`);
  for (const e of feat.drain()) if (e.type === 'summary') modes.push(`${t.toFixed(1)}s summary: ${e.summary.items.map(i => i.text).join(' / ')}`);
  if (step % 300 === 0) {
    const f = Object.entries(v).map(([a, b]) => `${a.slice(0, 4)}=${b.toFixed(2)}`).join(' ');
    const kv = Object.entries(k.v).map(([a, b]) => `${a.slice(0, 4)}=${b.toFixed(2)}`).join(' ');
    const sc = Object.entries(k.scores).map(([a, b]) => `${a.slice(0, 4)}=${b.toFixed(2)}`).join(' ');
    console.log(`${t.toFixed(0).padStart(4)}s n=${feat.count} | ${f} | ${kv} | ${k.mode} | ${sc} lp=${k.lpRel.toFixed(2)}`);
  }
  t += dt;
}
console.log(modes.join('\n'));
