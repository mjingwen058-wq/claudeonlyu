// 页面端：把这个页面接到"它"的共享生命上。
// 部署后（有 /api/life）：所有打开的页面共享一个生命，每 30 秒把这段时间的贡献作为增量提交给服务器。
// 本地运行或临时链接（没有 /api/life）：用同一套逻辑，存在这台电脑的浏览器里。
// 沙盒：自动演示、模拟观众、演示加速任一在跑时，不写入任何东西；结束后回到它真实的状态。

import { keys, getLife, postOps, forceClose, endLife, reviveLife, listCabinet, getSpecimen, lifeTitle, newLife, dehydrate, hydrate } from './life-core.js';
import { safeStorage } from './util.js';

const SYNC = Number(new URLSearchParams(location.search).get('sync')) || 30;
const COMP = ['density', 'energy', 'intrusion', 'dwell', 'sync'];
const ADMIN_KEY = 'tonos.admin';
const zero = () => ({ sediment: 0, intensity: 0, comp: Object.fromEntries(COMP.map((k) => [k, 0])) });

// 浏览器本地存储，接口和服务器存储一样
function localStore() {
  const ls = safeStorage();
  const mem = new Map();
  const read = (k) => {
    try { const s = ls ? ls.getItem(k) : mem.get(k); return s ? JSON.parse(s) : null; } catch { return null; }
  };
  const write = (k, o) => {
    const s = JSON.stringify(o);
    if (!ls) { mem.set(k, s); return; }
    try { ls.setItem(k, s); } catch (e) { throw new Error(`浏览器存储满了：${e.message}`); }
  };
  return {
    async get(k) { return read(k); },
    async cas(k, v, rev) {
      const c = read(k);
      if ((c ? c.rev : 0) !== rev) return false;
      write(k, { value: v, rev: rev + 1 });
      return true;
    },
    async set(k, v) { const c = read(k); write(k, { value: v, rev: (c ? c.rev : 0) + 1 }); },
    async del(k) { try { if (ls) ls.removeItem(k); else mem.delete(k); } catch { /* 忽略 */ } },
  };
}

function session() {
  try { return window.sessionStorage; } catch { return null; }
}

export class Life {
  constructor(app) {
    this.app = app;
    this.mode = 'pending'; // pending | shared | local
    this.K = keys('tonos');
    this.store = null;
    this.doc = null;
    this.ops = [];
    this.pert = zero();
    this.since = 0;
    this.busy = false;
    this.sandbox = false;
    this.info = { store: '', llm: false, admin: false };
    this.error = '';
    this.lastSync = 0;
    this.version = 0;
    this.seenLog = new Set();
    this.adminKey = session()?.getItem(ADMIN_KEY) || '';
  }

  get shared() { return this.mode === 'shared'; }

  async init() {
    try {
      const r = await fetch('./api/life', { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('json')) {
        const j = await r.json();
        if (j.ok && j.life) {
          this.mode = 'shared';
          this.info = { store: j.store, llm: !!j.llm, admin: !!j.admin };
          this.apply(j.life, true);
          this.bindUnload();
          return;
        }
      }
    } catch { /* 没有服务器，走本地 */ }
    this.mode = 'local';
    this.store = localStore();
    this.info = { store: '这台电脑的浏览器', llm: false, admin: false };
    await this.migrate();
    this.apply(await getLife(this.store, this.K), true);
  }

  // 旧版本地存档（tonos.v1）转成第 1 个生命
  async migrate() {
    const ls = safeStorage();
    if (!ls || (await this.store.get(this.K.life))) return;
    try {
      const old = JSON.parse(ls.getItem('tonos.v1') || 'null');
      if (!old) return;
      const doc = newLife(1);
      const objs = hydrate(doc);
      objs.kernel.load(old.kernel);
      objs.lexicon.load(old.lexicon);
      objs.memory.load(old.memory);
      dehydrate(doc, objs);
      doc.day = old.day || 1;
      await this.store.set(this.K.life, doc);
    } catch { /* 旧存档损坏就不迁移 */ }
  }

  // 把共享生命的慢变量放进这个页面；快变量（唤醒、边界、当前模式）留在本地
  apply(doc, full) {
    const a = this.app;
    const k = a.kernel;
    const kd = doc.kernel || {};
    this.doc = doc;
    k.v.sediment = kd.sediment ?? k.v.sediment;
    Object.assign(k.base, kd.base || {});
    Object.assign(k.offset, kd.offset || {});
    Object.assign(k.bias, kd.bias || {});
    if (kd.comp) k.comp = { ...kd.comp };
    k.dayIntensity = kd.dayIntensity ?? k.dayIntensity;
    if (full) {
      if (kd.fullness !== undefined) k.v.fullness = kd.fullness;
      if (kd.wear !== undefined) k.v.wear = kd.wear;
      Object.assign(k.p, kd.p || {});
      if (kd.seed !== undefined) k.seed = kd.seed;
    }
    a.lexicon.replaceAll(doc.lexicon);
    a.memory.items = (doc.memory || []).map((m) => ({ ...m, t: 0 }));
    if (!this.sandbox) a.clock.setReal(doc.day);
    const fresh = [...(doc.log || [])].reverse().filter((e) => !this.seenLog.has(`${e.at}|${e.text}`));
    for (const e of fresh) {
      this.seenLog.add(`${e.at}|${e.text}`);
      if (!full || fresh.indexOf(e) >= fresh.length - 3) a.log(e.text, 'var(--flow)');
    }
    a.mind.version++;
    this.version++;
  }

  // 每帧：判断沙盒，累计这段时间的扰动，按时提交
  tick(dt, dtEx) {
    const a = this.app;
    const sb = a.demo.on || a.crowd.count > 0 || a.clock.speed > 1;
    if (sb !== this.sandbox) {
      this.sandbox = sb;
      if (sb) this.enterSandbox();
      else this.exitSandbox();
    }
    if (this.mode === 'pending' || !this.doc) return;
    if (!sb) {
      const p = a.features.v;
      const inten = (p.density + p.energy + p.intrusion + p.sync) / 4;
      this.pert.sediment += (inten * dtEx * 1.5) / (8 * 3600);
      this.pert.intensity += inten * dtEx;
      for (const key of COMP) this.pert.comp[key] += (p[key] || 0) * dtEx;
    }
    this.since += dt;
    if (!sb && !this.busy && this.since >= SYNC) this.flush();
  }

  takeOps() {
    const ops = this.ops.splice(0);
    if (this.pert.intensity > 0 || this.pert.sediment > 0) {
      const p = this.pert;
      ops.push({ t: 'perturb', sediment: +p.sediment.toFixed(6), intensity: +p.intensity.toFixed(3), comp: Object.fromEntries(COMP.map((k) => [k, +p.comp[k].toFixed(3)])) });
    }
    this.pert = zero();
    return ops;
  }

  async flush() {
    this.since = 0;
    if (this.busy) return;
    const ops = this.takeOps();
    this.busy = true;
    try {
      let doc;
      if (this.shared) {
        const r = await fetch('./api/life', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        this.info = { store: j.store, llm: !!j.llm, admin: !!j.admin };
        doc = j.life;
      } else {
        doc = await postOps(this.store, this.K, ops);
      }
      if (!this.sandbox) this.apply(doc, false);
      this.lastSync = Date.now();
      this.error = '';
    } catch (e) {
      this.error = e.message;
      this.ops.unshift(...ops.filter((o) => o.t !== 'perturb'));
      this.ops.length = Math.min(this.ops.length, 200);
    } finally {
      this.busy = false;
      this.version++;
    }
  }

  // 关页面时把最后一段补交上去
  bindUnload() {
    const send = () => {
      if (this.sandbox || !this.shared) return;
      const ops = this.takeOps();
      if (!ops.length) return;
      try { navigator.sendBeacon('./api/life', new Blob([JSON.stringify({ ops })], { type: 'application/json' })); } catch { /* 忽略 */ }
    };
    addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  }

  effect(op) {
    if (this.sandbox || this.mode === 'pending') return;
    this.ops.push(op);
    if (this.ops.length > 200) this.ops.shift();
  }

  // 工具生效 → 增量操作
  fromTool(name, input, result) {
    const at = this.app.clock.label();
    switch (name) {
      case 'update_lexicon': {
        const added = new Set(result.added || []);
        const add = (input.add || []).filter((x) => added.has(String(x?.word || '').trim().slice(0, 4)))
          .map((x) => ({ word: String(x.word).trim().slice(0, 4), valence: Number(x.valence) || 0, category: x.category, x: Number(x.x) || 0, y: Number(x.y) || 0 }));
        this.effect({ t: 'lex', add, strengthen: result.strengthened || [], fade: result.faded || [] });
        break;
      }
      case 'utter':
        this.effect({ t: 'utter', at, text: result.text, words: result.words });
        break;
      case 'adjust_setpoint':
        this.effect({ t: 'setpoint', key: result.variable, delta: result.to - result.from });
        break;
      case 'set_mode_bias':
        this.effect({ t: 'bias', mode: result.mode, bias: result.bias });
        break;
      case 'write_memory':
        this.effect({ t: 'mem', text: result.text, importance: result.importance, at });
        break;
    }
  }

  episode(ep) {
    if (!ep) return;
    const utter = ep.calls.find((c) => c.name === 'utter' && c.status !== 'rejected');
    this.effect({
      t: 'episode', n: ep.n, at: ep.at, reason: ep.reasonName, by: ep.by,
      calls: ep.calls.map((c) => [c.name, c.status]), utter: utter?.result?.text || '',
    });
  }

  enterSandbox() {
    const a = this.app;
    if (this.ops.length || this.pert.intensity > 0) this.flush();
    a.clock.realtime = false;
    a.log('演示中：这期间的变化不计入它的生命', 'var(--warn)');
  }

  async exitSandbox() {
    const a = this.app;
    this.ops = [];
    this.pert = zero();
    a.log('演示结束，回到它真实的状态', 'var(--flow)');
    try {
      const doc = this.shared ? (await (await fetch('./api/life', { cache: 'no-store' })).json()).life : await getLife(this.store, this.K);
      if (doc) this.apply(doc, true);
    } catch (e) {
      this.error = e.message;
      if (this.doc) this.apply(this.doc, true);
    }
  }

  // 手动闭馆：只在本地模式和演示里可用；共享生命按北京时间自动闭馆
  async closeDay() {
    if (this.sandbox) return 'sandbox';
    if (this.shared) return 'shared';
    this.apply(await forceClose(this.store, this.K), false);
    return 'done';
  }

  setAdminKey(k) {
    this.adminKey = k;
    try { session()?.setItem(ADMIN_KEY, k); } catch { /* 忽略 */ }
  }

  async cabinetCall(body) {
    const r = await fetch('./api/cabinet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, key: this.adminKey }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  async checkAdmin() {
    if (!this.shared) return true;
    await this.cabinetCall({ action: 'check' });
    return true;
  }

  async items() {
    if (this.shared) {
      const j = await (await fetch('./api/cabinet', { cache: 'no-store' })).json();
      return j.items || [];
    }
    return listCabinet(this.store, this.K);
  }

  async specimen(id) {
    if (this.shared) {
      const j = await (await fetch(`./api/cabinet?id=${encodeURIComponent(id)}`, { cache: 'no-store' })).json();
      if (!j.ok) throw new Error(j.error);
      return j.specimen;
    }
    return getSpecimen(this.store, this.K, id);
  }

  async end(thumb) {
    await this.flushNow();
    const doc = this.shared ? (await this.cabinetCall({ action: 'end', thumb })).life : await endLife(this.store, this.K, thumb);
    this.reborn(doc);
    return doc;
  }

  async revive(id, thumb) {
    await this.flushNow();
    const doc = this.shared ? (await this.cabinetCall({ action: 'revive', id, thumb })).life : await reviveLife(this.store, this.K, id, thumb);
    this.reborn(doc);
    return doc;
  }

  async flushNow() {
    if (!this.sandbox && (this.ops.length || this.pert.intensity > 0)) await this.flush();
  }

  // 换了一个生命：页面上这一生的思考记录和日志清空
  reborn(doc) {
    const m = this.app.mind;
    m.episodes = [];
    m.toolLog = [];
    m.lastReport = null;
    m.wakes = 0;
    this.app.sound.selfPool = [];
    this.apply(doc, true);
  }

  title() {
    return this.doc ? lifeTitle(this.doc) : '';
  }
}
