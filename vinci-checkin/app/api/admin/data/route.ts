import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { listCheckins, purgeExpired, todayKey } from "@/lib/store";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifySessionToken(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const sql = await getSql();
    await purgeExpired(sql);
    const [today, records] = await Promise.all([todayKey(sql), listCheckins(sql)]);
    return NextResponse.json({ today, now: Date.now(), records }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "读取数据失败，请刷新再试" }, { status: 500 });
  }
}
