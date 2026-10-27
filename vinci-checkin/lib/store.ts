// 所有数据库操作都在这里。sql 由调用方传进来：线上是 Neon，本地测试换成 PGlite。

import type { CheckinInput } from "./fields";
import { RETENTION_MONTHS } from "./fields";

export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, any>[]>;

export interface Checkin {
  id: string;
  day: string; // 北京时间日期 YYYY-MM-DD
  seq: number; // 当天第几位
  ts: number; // 签到时间（毫秒时间戳）
  name: string;
  phone: string;
  gender: string;
  age: string;
  companions: number;
}

const toCheckin = (r: Record<string, any>): Checkin => ({
  id: String(r.id),
  day: String(r.day),
  seq: Number(r.seq),
  ts: Number(r.ts),
  name: String(r.name),
  phone: String(r.phone),
  gender: String(r.gender),
  age: String(r.age),
  companions: Number(r.companions),
});

export async function ensureSchema(sql: Sql) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS vinci_checkins (
        id text PRIMARY KEY,
        day date NOT NULL,
        seq integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        name text NOT NULL,
        phone text NOT NULL,
        gender text NOT NULL,
        age text NOT NULL,
        companions integer NOT NULL DEFAULT 0,
        CONSTRAINT vinci_checkins_day_phone UNIQUE (day, phone),
        CONSTRAINT vinci_checkins_day_seq UNIQUE (day, seq)
      )`;
  } catch (e: any) {
    // 两个请求同时建表时，后到的那个会撞上已存在的表，忽略即可
    if (e?.code !== "23505" && e?.code !== "42P07") throw e;
  }
}

// 提交签到。同一个手机号同一天已经签过，就返回原来那条，不再新增。
export async function insertCheckin(sql: Sql, input: CheckinInput, newId: () => string): Promise<{ record: Checkin; already: boolean }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await sql`
        WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date AS d)
        INSERT INTO vinci_checkins (id, day, seq, name, phone, gender, age, companions)
        SELECT ${newId()}::text, today.d,
               COALESCE((SELECT max(c.seq) FROM vinci_checkins c WHERE c.day = today.d), 0) + 1,
               ${input.name}::text, ${input.phone}::text, ${input.gender}::text, ${input.age}::text, ${input.companions}::integer
        FROM today
        ON CONFLICT (day, phone) DO NOTHING
        RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, seq,
                  (extract(epoch FROM created_at) * 1000)::float8 AS ts,
                  name, phone, gender, age, companions`;
      if (rows.length) return { record: toCheckin(rows[0]), already: false };

      const existing = await sql`
        SELECT id, to_char(day, 'YYYY-MM-DD') AS day, seq,
               (extract(epoch FROM created_at) * 1000)::float8 AS ts,
               name, phone, gender, age, companions
        FROM vinci_checkins
        WHERE day = (now() AT TIME ZONE 'Asia/Shanghai')::date AND phone = ${input.phone}::text`;
      if (existing.length) return { record: toCheckin(existing[0]), already: true };
      // 原记录刚好被后台删了，再试一次
    } catch (e: any) {
      // 两个人同一瞬间提交，抢到了同一个序号：重试拿下一个号
      if (e?.code === "23505" && e?.constraint === "vinci_checkins_day_seq") continue;
      throw e;
    }
  }
  throw new Error("签到太拥挤，请稍后再试");
}

export async function listCheckins(sql: Sql): Promise<Checkin[]> {
  const rows = await sql`
    SELECT id, to_char(day, 'YYYY-MM-DD') AS day, seq,
           (extract(epoch FROM created_at) * 1000)::float8 AS ts,
           name, phone, gender, age, companions
    FROM vinci_checkins
    ORDER BY day, seq`;
  return rows.map(toCheckin);
}

export async function deleteCheckin(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM vinci_checkins WHERE id = ${id}::text RETURNING id`;
  return rows.length > 0;
}

// 删掉超过保存期限的记录（按签到日期算，满 3 个月删除）
export async function purgeExpired(sql: Sql): Promise<number> {
  const rows = await sql`
    DELETE FROM vinci_checkins
    WHERE day < ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(months => ${RETENTION_MONTHS}::integer))::date
    RETURNING id`;
  return rows.length;
}

export async function todayKey(sql: Sql): Promise<string> {
  const rows = await sql`SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS today`;
  return String(rows[0].today);
}
