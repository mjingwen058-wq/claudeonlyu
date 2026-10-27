import { neon, neonConfig } from "@neondatabase/serverless";
import { ensureSchema, type Sql } from "./store";

let schemaReady = false;

// 每个请求里调用一次。构建时不会执行，所以构建环境没有 DATABASE_URL 也没关系。
export async function getSql(): Promise<Sql> {
  // 本地端到端测试时 scripts/local-db.cjs 会把数据库请求转给内存里的 PGlite；线上没有这个变量
  const localFetch = (globalThis as any).__VINCI_LOCAL_FETCH__;
  if (localFetch) neonConfig.fetchFunction = localFetch;
  // 在 Cloudflare 本地运行环境里测试时，把查询发到 scripts/local-neon-server.mjs；线上不设置
  if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 没有设置");
  const sql = neon(url) as unknown as Sql;
  if (!schemaReady) {
    await ensureSchema(sql);
    schemaReady = true;
  }
  return sql;
}
