// 用真实 SQL 测试签到逻辑（经过 Neon 驱动 → PGlite）。运行：npm run test:db
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../lib/db";
import { insertCheckin, listCheckins, deleteCheckin, purgeExpired, todayKey } from "../lib/store";
import { validateCheckin } from "../lib/fields";
import { toCSV } from "../lib/csv";
import { bj } from "../lib/time";

const person = (phone: string, name = "林一诺", companions = 0) => ({ name, phone, gender: "女", age: "18–25 岁", companions });

async function main() {
  const sql = await getSql();
  const today = await todayKey(sql);
  assert.equal(today, bj(Date.now()).day, "数据库的“今天”应该是北京时间的今天");

  // 1. 连续提交，序号递增
  const a = await insertCheckin(sql, person("13800000001"), randomUUID);
  const b = await insertCheckin(sql, person("13800000002", "陈思远", 2), randomUUID);
  assert.equal(a.already, false);
  assert.equal(a.record.seq, 1);
  assert.equal(b.record.seq, 2);
  assert.equal(b.record.companions, 2);
  assert.equal(a.record.day, today);
  assert.ok(Math.abs(a.record.ts - Date.now()) < 60_000, "签到时间应该是现在");

  // 2. 同一个手机号同一天：返回原记录，不新增
  const dup = await insertCheckin(sql, person("13800000001", "改了名字"), randomUUID);
  assert.equal(dup.already, true);
  assert.equal(dup.record.seq, 1);
  assert.equal(dup.record.name, "林一诺");
  assert.equal((await listCheckins(sql)).length, 2);

  // 3. 并发提交：序号不重复
  const many = await Promise.all(Array.from({ length: 8 }, (_, i) => insertCheckin(sql, person(`1390000000${i}`), randomUUID)));
  const seqs = many.map((m) => m.record.seq).sort((x, y) => x - y);
  assert.deepEqual(seqs, [3, 4, 5, 6, 7, 8, 9, 10]);

  // 4. 往日的数据不影响今天的序号；跨天同一个手机号可以再签
  await sql`INSERT INTO vinci_checkins (id, day, seq, name, phone, gender, age, companions, created_at)
            VALUES ('old-1', (now() AT TIME ZONE 'Asia/Shanghai')::date - 1, 1, '昨天的人', '13800000001', '男', '26–35 岁', 0, now() - interval '1 day')`;
  const rows = await listCheckins(sql);
  assert.equal(rows.length, 11);
  assert.equal(rows[0].id, "old-1", "按日期、序号排序，昨天的在最前");

  // 5. 删除
  assert.equal(await deleteCheckin(sql, "old-1"), true);
  assert.equal(await deleteCheckin(sql, "old-1"), false);
  // 删掉之后同一个手机号可以重新签，拿到新序号
  await deleteCheckin(sql, b.record.id);
  const again = await insertCheckin(sql, person("13800000002", "陈思远"), randomUUID);
  assert.equal(again.already, false);
  assert.equal(again.record.seq, 11);

  // 6. 保存 3 个月：超过 3 个月的删掉，没超过的留着
  await sql`INSERT INTO vinci_checkins (id, day, seq, name, phone, gender, age, companions) VALUES
            ('expired', (now() AT TIME ZONE 'Asia/Shanghai')::date - interval '3 months' - interval '1 day', 1, '过期', '13700000000', '男', '26–35 岁', 0),
            ('kept', (now() AT TIME ZONE 'Asia/Shanghai')::date - interval '3 months' + interval '1 day', 1, '保留', '13700000001', '男', '26–35 岁', 0)`;
  assert.equal(await purgeExpired(sql), 1);
  const ids = (await listCheckins(sql)).map((r) => r.id);
  assert.ok(!ids.includes("expired") && ids.includes("kept"));

  // 7. 导出：BOM + 表头 + 每条一行，手机号是完整的
  const csv = toCSV(await listCheckins(sql));
  assert.ok(csv.startsWith("﻿编号,日期,签到时间,姓名,手机号,性别,年龄段,同行人数,到访人数"));
  assert.equal(csv.split("\r\n").length, 1 + (await listCheckins(sql)).length);
  assert.ok(csv.includes("13800000001"));

  // 8. 提交内容校验
  assert.ok(validateCheckin({ ...person("12345"), consent: true }).error);
  assert.ok(validateCheckin({ ...person("13800000009"), consent: false }).error);
  assert.ok(validateCheckin({ ...person("13800000009"), gender: "未知", consent: true }).error);
  assert.ok(validateCheckin({ ...person("13800000009", "林", 51), consent: true }).error);
  assert.ok(validateCheckin({ ...person("138 0000 0009", " 林一诺 "), consent: true }).value?.phone === "13800000009");

  console.log("数据库测试全部通过");
}

main().catch((e) => { console.error(e); process.exit(1); });
