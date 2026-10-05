// 存储适配：服务器上优先用 Upstash Redis，其次 Vercel Blob；都没配时用内存（只用于本地测试，重启就没了）。
// 统一接口：get(key) → {value, rev} | null；cas(key, value, rev) 只在版本等于 rev 时写入；set；del。

export function memoryStore(map = new Map()) {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    async get(k) { const c = map.get(k); return c ? copy(c) : null; },
    async cas(k, v, rev) {
      const c = map.get(k);
      if ((c ? c.rev : 0) !== rev) return false;
      map.set(k, { value: copy(v), rev: rev + 1 });
      return true;
    },
    async set(k, v) { const c = map.get(k); map.set(k, { value: copy(v), rev: (c ? c.rev : 0) + 1 }); },
    async del(k) { map.delete(k); },
  };
}

// Upstash Redis 的 REST 接口：值和版本号分两个键，比较写入用一段 Lua 保证原子
export function upstashStore(url, token) {
  const call = async (cmd) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (j.error) throw new Error(`Upstash: ${j.error}`);
    return j.result;
  };
  const CAS = "local r = redis.call('GET', KEYS[2]) or '0' if r == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) redis.call('SET', KEYS[2], ARGV[3]) return 1 end return 0";
  const SET = "redis.call('SET', KEYS[1], ARGV[1]) return redis.call('INCR', KEYS[2])";
  return {
    async get(k) {
      const [v, r] = await call(['MGET', k, `${k}:rev`]);
      return v == null ? null : { value: JSON.parse(v), rev: Number(r || 0) };
    },
    async cas(k, v, rev) {
      return Number(await call(['EVAL', CAS, '2', k, `${k}:rev`, String(rev), JSON.stringify(v), String(rev + 1)])) === 1;
    },
    async set(k, v) { await call(['EVAL', SET, '2', k, `${k}:rev`, JSON.stringify(v)]); },
    async del(k) { await call(['DEL', k, `${k}:rev`]); },
  };
}

// Vercel Blob：每个键一个 JSON 文件，用 ETag（ifMatch）做比较写入
export async function blobStore(token, access = 'private') {
  const { put, get, del } = await import('@vercel/blob');
  const path = (k) => `tonos/${k.replace(/:/g, '/').replace(/[^a-zA-Z0-9/_-]/g, '_')}.json`;
  const read = async (k) => {
    const r = await get(path(k), { access, useCache: false, token });
    if (!r || r.statusCode !== 200) return null;
    const o = JSON.parse(await new Response(r.stream).text());
    return { value: o.value, rev: o.rev, etag: r.blob.etag };
  };
  const body = (v, rev) => JSON.stringify({ value: v, rev });
  const opts = { access, addRandomSuffix: false, contentType: 'application/json', token };
  return {
    async get(k) { const o = await read(k); return o ? { value: o.value, rev: o.rev } : null; },
    async cas(k, v, rev) {
      const cur = await read(k);
      if ((cur ? cur.rev : 0) !== rev) return false;
      try {
        await put(path(k), body(v, rev + 1), cur ? { ...opts, ifMatch: cur.etag } : { ...opts, allowOverwrite: false });
        return true;
      } catch (e) {
        if (/precondition|already exists/i.test(`${e.name} ${e.message}`)) return false;
        throw e;
      }
    },
    async set(k, v) {
      const cur = await read(k);
      await put(path(k), body(v, (cur ? cur.rev : 0) + 1), { ...opts, allowOverwrite: true });
    },
    async del(k) { try { await del(path(k), { token }); } catch { /* 已经不在了 */ } },
  };
}

const MEMORY = memoryStore();

export async function pickStore(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { store: upstashStore(url, token), kind: 'Upstash Redis' };
  if (env.BLOB_READ_WRITE_TOKEN) return { store: await blobStore(env.BLOB_READ_WRITE_TOKEN, env.TONOS_BLOB_ACCESS || 'private'), kind: 'Vercel Blob' };
  return { store: MEMORY, kind: 'memory' };
}
