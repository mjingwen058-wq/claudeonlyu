// 服务器接口的逻辑（和 Vercel 的 req/res 无关，方便本地测试）。
// /api/life     读取当前生命 / 提交增量操作
// /api/cabinet  收藏柜：列表、单件标本、结束这一生、唤回（后两者要管理口令）
// /api/mind     服务器替所有人调用 Claude（配了 ANTHROPIC_API_KEY 才启用，有频率和每日上限）

import { createHash, timingSafeEqual } from 'node:crypto';
import { keys, getLife, postOps, listCabinet, getSpecimen, endLife, reviveLife, localDate } from '../js/life-core.js';
import { pickStore } from './_store.js';

const prefix = (env) => env.TONOS_PREFIX || 'tonos';

function admin(env, key) {
  const want = env.TONOS_ADMIN_KEY;
  if (!want) return 'unset';
  const a = createHash('sha256').update(String(key || '')).digest();
  const b = createHash('sha256').update(String(want)).digest();
  return timingSafeEqual(a, b) ? 'ok' : 'bad';
}

function lifeReply(doc, kind, env) {
  return { ok: true, store: kind, llm: !!env.ANTHROPIC_API_KEY, admin: !!env.TONOS_ADMIN_KEY, now: Date.now(), life: doc };
}

export async function lifeHandler({ method, body, env, now = Date.now() }) {
  const { store, kind } = await pickStore(env);
  const K = keys(prefix(env));
  if (method === 'GET') return { status: 200, json: lifeReply(await getLife(store, K, now), kind, env) };
  if (method === 'POST') {
    const ops = Array.isArray(body?.ops) ? body.ops : [];
    return { status: 200, json: lifeReply(await postOps(store, K, ops, now), kind, env) };
  }
  return { status: 405, json: { ok: false, error: '只支持 GET 和 POST' } };
}

export async function cabinetHandler({ method, query, body, env, now = Date.now() }) {
  const { store, kind } = await pickStore(env);
  const K = keys(prefix(env));
  if (method === 'GET') {
    if (query?.id) {
      const s = await getSpecimen(store, K, String(query.id));
      return s ? { status: 200, json: { ok: true, specimen: s } } : { status: 404, json: { ok: false, error: '柜子里没有这个生命' } };
    }
    return { status: 200, json: { ok: true, store: kind, items: await listCabinet(store, K) } };
  }
  if (method !== 'POST') return { status: 405, json: { ok: false, error: '只支持 GET 和 POST' } };
  const a = admin(env, body?.key);
  if (a === 'unset') return { status: 403, json: { ok: false, error: '服务器还没有设置管理口令（TONOS_ADMIN_KEY）' } };
  if (a !== 'ok') return { status: 403, json: { ok: false, error: '口令不对' } };
  switch (body?.action) {
    case 'check':
      return { status: 200, json: { ok: true } };
    case 'end': {
      const life = await endLife(store, K, body.thumb, now);
      return { status: 200, json: { ...lifeReply(life, kind, env), items: await listCabinet(store, K) } };
    }
    case 'revive': {
      try {
        const life = await reviveLife(store, K, String(body.id || ''), body.thumb, now);
        return { status: 200, json: { ...lifeReply(life, kind, env), items: await listCabinet(store, K) } };
      } catch (e) {
        return { status: 404, json: { ok: false, error: e.message } };
      }
    }
    default:
      return { status: 400, json: { ok: false, error: '不认识的操作' } };
  }
}

const MODELS = ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

export async function mindHandler({ method, body, env, now = Date.now(), fetchImpl = fetch }) {
  if (method !== 'POST') return { status: 405, json: { ok: false, error: '只支持 POST' } };
  if (!env.ANTHROPIC_API_KEY) return { status: 501, json: { ok: false, error: 'disabled' } };
  const messages = Array.isArray(body?.messages) ? body.messages.slice(0, 7) : [];
  if (!messages.length) return { status: 400, json: { ok: false, error: '没有消息' } };
  // 一次唤醒的第一轮才计频率和每日次数；后续工具轮次跟着走
  if (messages.length === 1) {
    const { store } = await pickStore(env);
    const key = `${prefix(env)}:llm`;
    const daily = Number(env.TONOS_LLM_DAILY) || 300;
    const today = localDate(now);
    for (let i = 0; i < 5; i++) {
      const cur = await store.get(key);
      const v = cur ? cur.value : { last: 0, date: today, count: 0 };
      if (v.date !== today) { v.date = today; v.count = 0; }
      if (now - v.last < 20000) return { status: 429, json: { ok: false, error: '太频繁，20 秒内只思考一次' } };
      if (v.count >= daily) return { status: 429, json: { ok: false, error: '今天的思考次数用完了' } };
      if (await store.cas(key, { last: now, date: today, count: v.count + 1 }, cur ? cur.rev : 0)) break;
    }
  }
  const model = MODELS.includes(env.TONOS_LLM_MODEL) ? env.TONOS_LLM_MODEL : MODELS[0];
  const req = {
    model,
    max_tokens: 1500,
    system: String(body.system || '').slice(0, 4000),
    tools: Array.isArray(body.tools) ? body.tools.slice(0, 8) : [],
    messages,
  };
  const headers = { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  if (model !== 'claude-haiku-4-5') {
    req.output_config = { effort: 'low' };
  }
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(req) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, json: { ok: false, error: j?.error?.message || `HTTP ${r.status}` } };
  return { status: 200, json: j };
}

// 把上面的逻辑接到 Vercel 的 (req, res)
export function vercel(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const out = await fn({ method: req.method, query: req.query || {}, body: body || {}, env: process.env });
      res.status(out.status).json(out.json);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  };
}
