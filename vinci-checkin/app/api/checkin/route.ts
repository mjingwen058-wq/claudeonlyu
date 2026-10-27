import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSql } from "@/lib/db";
import { insertCheckin } from "@/lib/store";
import { validateCheckin } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { value, error } = validateCheckin(body);
  if (!value) return NextResponse.json({ error }, { status: 400 });

  try {
    const sql = await getSql();
    const { record, already } = await insertCheckin(sql, value, randomUUID);
    // 只回传凭证要显示的内容，不回传手机号
    const { id, day, seq, ts, name, companions } = record;
    return NextResponse.json({ already, record: { id, day, seq, ts, name, companions } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "服务器开小差了，请稍后再试一次" }, { status: 500 });
  }
}
