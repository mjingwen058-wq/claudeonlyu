// 先用 esbuild 把 TypeScript 测试打包，再接上本地 PGlite 跑
import { build } from "esbuild";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
require("./local-db.cjs");
process.env.DATABASE_URL ??= "postgresql://local:local@localhost/vinci";

const out = new URL("../.test-build/store.test.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./store.test.ts", import.meta.url).pathname],
  outfile: out.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@neondatabase/serverless", "@electric-sql/pglite"],
  logLevel: "warning",
});
await import(pathToFileURL(out.pathname).href);
