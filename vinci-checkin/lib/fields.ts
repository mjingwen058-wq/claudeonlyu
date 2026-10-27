// 观众要填的题目和展览的基本设定。改题目、选项、展期都只改这里。

export const GENDERS = ["男", "女", "不便透露"];
export const AGES = ["18 岁以下", "18–25 岁", "26–35 岁", "36–45 岁", "46 岁及以上"];
export const MAX_COMPANIONS = 50;
export const NAME_MAX = 20;
export const PHONE_RE = /^1\d{10}$/;

export const OPEN_HOUR = 10; // 开馆 10:00
export const CLOSE_HOUR = 18; // 闭馆 18:00
export const RETENTION_MONTHS = 3; // 签到记录保存 3 个月

// 展期 2026.11.1–11.15
export const EXPO_DAYS = Array.from({ length: 15 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);

export interface CheckinInput {
  name: string;
  phone: string;
  gender: string;
  age: string;
  companions: number;
}

// 前后端共用的校验：返回出错原因，没问题返回 null
export function validateCheckin(body: unknown): { value?: CheckinInput; error?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const phone = typeof b.phone === "string" ? b.phone.replace(/\s/g, "") : "";
  const gender = typeof b.gender === "string" ? b.gender : "";
  const age = typeof b.age === "string" ? b.age : "";
  const companions = typeof b.companions === "number" ? b.companions : Number.NaN;

  if (!name) return { error: "请填写姓名" };
  if (name.length > NAME_MAX) return { error: `姓名最多 ${NAME_MAX} 个字` };
  if (!PHONE_RE.test(phone)) return { error: "手机号是 11 位数字，以 1 开头" };
  if (!GENDERS.includes(gender)) return { error: "请选择性别" };
  if (!AGES.includes(age)) return { error: "请选择年龄段" };
  if (!Number.isInteger(companions) || companions < 0 || companions > MAX_COMPANIONS) {
    return { error: `同行人数要在 0 到 ${MAX_COMPANIONS} 之间` };
  }
  if (b.consent !== true) return { error: "请先勾选同意" };
  return { value: { name, phone, gender, age, companions } };
}
