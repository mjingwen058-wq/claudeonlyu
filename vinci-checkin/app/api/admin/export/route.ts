import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { listCheckins, todayKey } from "@/lib/store";
import { toCSV } from "@/lib/csv";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 一键导出：全部签到记录，一个 CSV 文件
export async function GET(req: NextRequest) {
  if (!verifySessionToken(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = await getSql();
  const [today, records] = await Promise.all([todayKey(sql), listCheckins(sql)]);
  return new NextResponse(toCSV(records), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // 文件名只用英文：中文文件名的写法有些浏览器不认，会变成 "download"
      "Content-Disposition": `attachment; filename="vinci-checkin-all-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
