// 在自己电脑上试用：不用注册数据库，签到数据存在项目里的 .local-data 文件夹。
// 用法：npm run local（会先构建一次）；Windows 上也可以直接双击 start-local.bat
// 想清空试用数据：关掉窗口，删掉 .local-data 文件夹。

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
process.env.NODE_ENV = "production";

// 先读 .env.local（如果有），再补上试用用的默认值
require("@next/env").loadEnvConfig(root);
process.env.VINCI_LOCAL_DATA ||= path.join(root, ".local-data");
process.env.DATABASE_URL ||= "postgresql://local:local@localhost/vinci";
process.env.ADMIN_PASSWORD ||= "vinci2026";

require("./local-db.cjs");
const next = require("next");

const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, dir: root, hostname: "0.0.0.0", port });
await app.prepare();
const handle = app.getRequestHandler();

const server = http.createServer((req, res) => handle(req, res));
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\n3000 端口被占用了：可能已经开着一个试用窗口，先把它关掉再试。\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(port, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
  const local = `http://localhost:${port}`;
  console.log(`
  VINCI 2026 观众签到 · 本地试用已启动

  观众端    ${local}
  后台      ${local}/admin
  后台密码  ${process.env.ADMIN_PASSWORD}
${lan.length ? `\n  手机连同一个 Wi-Fi 后打开：\n${lan.map((u) => `            ${u}`).join("\n")}\n` : ""}
  试用数据存在：${process.env.VINCI_LOCAL_DATA}
  关掉这个窗口就停止；删掉上面这个文件夹就清空试用数据。
`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === "win32" ? `start "" "${local}"` : process.platform === "darwin" ? `open "${local}"` : `xdg-open "${local}"`;
    exec(cmd, () => {});
  }
});
