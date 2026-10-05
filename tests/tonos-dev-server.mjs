// 本地仿真 Vercel：静态文件 + /api/life /api/cabinet /api/mind，存储用内存。
// 用法：TONOS_ADMIN_KEY=test node tests/tonos-dev-server.mjs  然后打开 http://localhost:8790/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifeHandler, cabinetHandler, mindHandler } from '../web/tonos/api/_handlers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/tonos');
const PORT = Number(process.env.PORT) || 8790;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.txt': 'text/plain',
};
const ROUTES = { '/api/life': lifeHandler, '/api/cabinet': cabinetHandler, '/api/mind': mindHandler };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = ROUTES[url.pathname];
  if (route) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    try {
      const out = await route({ method: req.method, query: Object.fromEntries(url.searchParams), body, env: process.env });
      res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out.json));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || p.includes('/api/')) { res.writeHead(404); res.end('not found'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => console.log(`TONOS dev server http://localhost:${PORT}/`));
