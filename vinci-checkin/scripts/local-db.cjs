// 只在自己电脑上试用和测试时加载，线上不会用到。
// 作用：把 Neon 驱动发出的 HTTP 查询交给进程内的 PGlite（本地的 Postgres），不用联网、不用真的数据库。
// 设了 VINCI_LOCAL_DATA 时数据存在那个文件夹里（关掉再开还在）；没设时只存在内存里（测试用）。

const fs = require("node:fs");

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = import("@electric-sql/pglite").then(async ({ PGlite }) => {
      const dir = process.env.VINCI_LOCAL_DATA;
      if (dir) fs.mkdirSync(dir, { recursive: true });
      const pg = dir ? new PGlite(dir) : new PGlite();
      await pg.waitReady;
      return pg;
    });
  }
  return dbPromise;
}

// Neon 的 HTTP 接口返回的是 Postgres 文本格式，驱动自己再解析
function toText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function run(pg, { query, params }) {
  const r = await pg.query(query, params, { rowMode: "array" });
  return {
    command: "",
    rowCount: r.affectedRows ?? r.rows.length,
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: r.rows.map((row) => row.map(toText)),
  };
}

globalThis.__VINCI_LOCAL_DB__ = db;
globalThis.__VINCI_LOCAL_FETCH__ = async (_url, init) => {
  const pg = await db();
  const body = JSON.parse(init.body);
  const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  try {
    if (Array.isArray(body.queries)) {
      const results = [];
      for (const q of body.queries) results.push(await run(pg, q));
      return json({ results }, 200);
    }
    return json(await run(pg, body), 200);
  } catch (e) {
    return json({ message: e.message, code: e.code, constraint: e.constraint, detail: e.detail }, 400);
  }
};
