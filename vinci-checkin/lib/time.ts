// 展览在杭州，所有"今天""几点"都按北京时间算，不管服务器或看后台的电脑在哪个时区。

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function bj(ts: number) {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(ts)) p[part.type] = part.value;
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    hm: `${p.hour}:${p.minute}`,
    hms: `${p.hour}:${p.minute}:${p.second}`,
  };
}

// 某一天北京时间 0 点对应的时间戳
export function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
}

export const weekday = (day: string) => WEEK[new Date(dayStart(day) + 12 * 3600 * 1000).getUTCDay()];
export const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const cnDate = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日 ${weekday(day)}`;

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}
