import type { Checkin } from "./store";
import { bj } from "./time";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const checkinCode = (r: Pick<Checkin, "day" | "seq">) => `V${r.day.slice(5).replace("-", "")}-${String(r.seq).padStart(4, "0")}`;

// 导出给 Excel：前面加 BOM，中文不乱码
export function toCSV(rows: Checkin[]): string {
  const head = ["编号", "日期", "签到时间", "姓名", "手机号", "性别", "年龄段", "同行人数", "到访人数"];
  const lines = rows.map((r) =>
    [checkinCode(r), r.day, bj(r.ts).hms, r.name, r.phone, r.gender, r.age, r.companions, r.companions + 1].map(cell).join(","),
  );
  return "﻿" + [head.join(","), ...lines].join("\r\n");
}
