// 只给本地测试用：一个假的 Neon HTTP 接口，背后是内存里的 PGlite。
// 用法：node scripts/local-neon-server.mjs，然后在 .dev.vars 里设 NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql
import http from "node:http";
import { createRequire } from "node:module";

createRequire(import.meta.url)("./local-db.cjs");
const handle = globalThis.__VINCI_LOCAL_FETCH__;
const port = Number(process.env.PORT || 4444);

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const out = await handle(req.url, { body });
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(await out.text());
  })
  .listen(port, "127.0.0.1", () => console.log(`local neon on http://127.0.0.1:${port}/sql`));
