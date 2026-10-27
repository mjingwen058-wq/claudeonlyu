"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGES, CLOSE_HOUR, EXPO_DAYS, GENDERS, OPEN_HOUR, RETENTION_MONTHS } from "@/lib/fields";
import { addMonths, bj, cnDate, dayStart, md, weekday } from "@/lib/time";
import { checkinCode } from "@/lib/csv";
import type { Checkin } from "@/lib/store";

const MAX_TRIES = 5;
const LOCK_MS = 30_000;
const POLL_MS = 20_000;
const MARKS = ["red", "orange", "yellow", "green"];
const GROUPS = ["独自一人", "2 人", "3–4 人", "5 人及以上"];
const groupOf = (r: Checkin) => (r.companions === 0 ? 0 : r.companions === 1 ? 1 : r.companions <= 3 ? 2 : 3);
const visitors = (rs: Checkin[]) => rs.reduce((s, r) => s + r.companions + 1, 0);
const maskPhone = (p: string) => (p.length === 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : p);
const fmtNum = (n: number) => n.toLocaleString("zh-CN");

interface Data {
  today: string;
  records: Checkin[];
}

// 各项比例：取整后加起来正好 100%
function pcts(counts: number[]) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total);
  const fl = raw.map(Math.floor);
  let rem = 100 - fl.reduce((a, b) => a + b, 0);
  raw
    .map((v, i) => [v - fl[i], i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (rem > 0) {
        fl[i]++;
        rem--;
      }
    });
  return fl;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [day, setDay] = useState<string>("");
  const [auto, setAuto] = useState(true);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [armDel, setArmDel] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/data", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "读取数据失败");
      setData({ today: json.today, records: json.records });
      setDay((d) => d || json.today);
      setAuthed(true);
      setLoadErr("");
      setUpdatedAt(Date.now());
    } catch (e: any) {
      setLoadErr(e?.message || "读取数据失败，请检查网络");
      setAuthed((a) => (a === null ? false : a));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 实时更新：页面在前台时每 20 秒拉一次
  useEffect(() => {
    if (!authed || !auto) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [authed, auto, load]);

  if (authed === null) return <main className="page"><p className="muted">加载中…</p></main>;
  if (!authed) return <Login onDone={load} error={loadErr} />;
  if (!data) return null;

  async function remove(id: string) {
    if (armDel !== id) {
      setArmDel(id);
      return;
    }
    setArmDel(null);
    const res = await fetch(`/api/admin/checkins/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 401) return setAuthed(false);
    flash(res.ok ? "已删除 1 条记录" : "删除失败，请刷新再试");
    load();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
    setData(null);
    setDay("");
  }

  return (
    <main className="page">
      <Dashboard
        data={data}
        day={day || data.today}
        setDay={(d) => {
          setDay(d);
          setShowAll(false);
          setArmDel(null);
        }}
        updatedAt={updatedAt}
        loadErr={loadErr}
        auto={auto}
        setAuto={setAuto}
        query={query}
        setQuery={setQuery}
        showAll={showAll}
        setShowAll={setShowAll}
        armDel={armDel}
        remove={remove}
        logout={logout}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

function Login({ onDone, error }: { onDone: () => void; error: string }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [tries, setTries] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const locked = lockUntil > Date.now();

  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= lockUntil) setLockUntil(0);
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || busy) return;
    if (!pw) return setErr("请输入密码。");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setErr("");
        onDone();
        return;
      }
      const n = tries + 1;
      if (n >= MAX_TRIES) {
        setTries(0);
        setLockUntil(Date.now() + LOCK_MS);
        setErr("");
      } else {
        setTries(n);
        setErr(`密码不对，还可以再试 ${MAX_TRIES - n} 次。`);
      }
    } catch {
      setErr("连不上服务器，请检查网络后再试。");
    } finally {
      setBusy(false);
    }
  }

  const message = locked ? `连续输错 ${MAX_TRIES} 次，${Math.ceil((lockUntil - Date.now()) / 1000)} 秒后再试。` : err || error;
  return (
    <main className="page">
      <div className="login">
        <img className="login-logo" src="/assets/vinci-logo.png" alt="VINCI 2026" width={600} height={111} />
        <h1>签到后台</h1>
        <p className="muted">无界未来 FUTURES UNBOUND · 观众签到数据</p>
        <form onSubmit={submit} noValidate>
          <label className="lbl" htmlFor="admin-pw">
            后台密码
          </label>
          <div className="pw">
            <input
              className="field-input"
              id="admin-pw"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              disabled={locked}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button type="button" className="btn-ghost" aria-pressed={show} onClick={() => setShow((v) => !v)}>
              {show ? "隐藏" : "显示"}
            </button>
          </div>
          <p className="field-err" role="alert" hidden={!message}>
            {message}
          </p>
          <button type="submit" className="btn-next btn-wide" disabled={locked || busy}>
            {busy ? "登录中…" : "进入后台"}
          </button>
        </form>
      </div>
    </main>
  );
}

interface DashProps {
  data: Data;
  day: string;
  setDay: (d: string) => void;
  updatedAt: number;
  loadErr: string;
  auto: boolean;
  setAuto: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  armDel: string | null;
  remove: (id: string) => void;
  logout: () => void;
}

function Dashboard(p: DashProps) {
  const { data } = p;
  const today = data.today;
  const all = p.day === "all";

  // 日期按钮：展期每一天 + 有数据的其他日子（比如开展前测试）+ 今天
  const days = useMemo(() => {
    const set = new Set([...EXPO_DAYS, today, ...data.records.map((r) => r.day)]);
    return Array.from(set).sort();
  }, [data.records, today]);
  const openDays = days.filter((d) => d <= today);
  const byDay = useMemo(() => {
    const m = new Map<string, Checkin[]>();
    for (const r of data.records) m.set(r.day, [...(m.get(r.day) ?? []), r]);
    return m;
  }, [data.records]);
  const recsOf = (d: string) => byDay.get(d) ?? [];
  const recs = all ? data.records : recsOf(p.day);
  const now = Date.now();

  let title: string;
  let kpis: { label: string; value: string; sub: React.ReactNode }[];
  let chart: ChartItem[];
  let chartTitle: string;
  let chartSub: string;

  if (!all) {
    const isToday = p.day === today;
    const idx = days.indexOf(p.day);
    const prevKey = idx > 0 ? days[idx - 1] : null;
    let delta: React.ReactNode = p.day === EXPO_DAYS[0] ? "开幕日" : "没有前一天的数据";
    if (prevKey && recsOf(prevKey).length) {
      let prev = recsOf(prevKey);
      if (isToday) {
        const off = now - dayStart(today);
        prev = prev.filter((r) => r.ts - dayStart(prevKey) <= off);
      }
      delta = <Delta cur={visitors(recs)} prev={visitors(prev)} label={isToday ? "比前一天同时段" : "比前一天"} />;
    } else if (p.day === EXPO_DAYS[0]) delta = "开幕日";
    const hours = hourBins(recs, isToday ? now : null);
    const peak = hours.reduce((a, b) => (b.visitors > a.visitors ? b : a), hours[0]);
    const v = visitors(recs);
    kpis = [
      { label: "到访人数", value: fmtNum(v), sub: delta },
      { label: "签到人数", value: fmtNum(recs.length), sub: `同行 ${v - recs.length} 人 · 平均每组 ${recs.length ? (v / recs.length).toFixed(1) : 0} 人` },
      isToday
        ? { label: "最近一小时", value: fmtNum(visitors(recs.filter((r) => r.ts > now - 3600e3))), sub: `到访人数 · 截至 ${bj(now).hm}` }
        : { label: "平均每小时", value: fmtNum(Math.round(v / (CLOSE_HOUR - OPEN_HOUR))), sub: `开馆 ${OPEN_HOUR}:00–${CLOSE_HOUR}:00` },
      peak && peak.visitors
        ? { label: "高峰时段", value: `${pad(peak.h)}:00`, sub: `${pad(peak.h)}:00–${pad(peak.h + 1)}:00 · ${peak.visitors} 人到访` }
        : { label: "高峰时段", value: "—", sub: "还没有人签到" },
    ];
    const curH = bj(now).hour;
    chart = hours.map((b) => ({
      label: `${pad(b.h)}:00`,
      value: b.visitors,
      future: b.future,
      hi: isToday ? b.h === curH : !!peak && b.h === peak.h && b.visitors > 0,
      title: b.future ? `${pad(b.h)}:00 还没到` : `${pad(b.h)}:00–${pad(b.h + 1)}:00 · 到访 ${b.visitors} 人（签到 ${b.checkins} 人）`,
    }));
    title = `${cnDate(p.day)}${isToday ? " · 今天" : ""}`;
    chartTitle = "时段分布";
    chartSub = isToday ? "每小时到访人数 · 橙色是当前这一小时，虚线是还没到的时段" : "每小时到访人数 · 橙色是高峰时段";
  } else {
    const per = days.map((d) => ({ d, n: d <= today ? visitors(recsOf(d)) : null, c: recsOf(d).length }));
    const opened = per.filter((x) => x.n !== null && (x.n > 0 || EXPO_DAYS.includes(x.d)));
    const best = opened.reduce((a, b) => ((b.n ?? 0) > (a.n ?? 0) ? b : a), opened[0]);
    const v = visitors(recs);
    const dayCount = Math.max(1, opened.length);
    kpis = [
      { label: "累计到访", value: fmtNum(v), sub: `${dayCount} 天` },
      { label: "累计签到", value: fmtNum(recs.length), sub: `同行 ${v - recs.length} 人` },
      { label: "日均到访", value: fmtNum(Math.round(v / dayCount)), sub: "今天按当前进度计" },
      best && best.n
        ? { label: "最高单日", value: md(best.d), sub: `${weekday(best.d)} · ${best.n} 人到访` }
        : { label: "最高单日", value: "—", sub: "还没有数据" },
    ];
    chart = per.map((x) => ({
      label: md(x.d),
      sub: x.d === today ? "今天" : weekday(x.d).slice(1),
      value: x.n ?? 0,
      future: x.n === null,
      hi: !!best && x.d === best.d && (x.n ?? 0) > 0,
      title: x.n === null ? `${md(x.d)} 还没到` : `${md(x.d)} ${weekday(x.d)} · 到访 ${x.n} 人（签到 ${x.c} 人）`,
    }));
    title = `全展期 · ${md(days[0])}–${md(days[days.length - 1])}`;
    chartTitle = "每日到访";
    chartSub = "每天的到访人数 · 橙色是最高单日，虚线是还没到的日子";
  }

  const earliest = data.records[0]?.day;
  return (
    <div className="admin">
      <div className="a-head">
        <div className="a-brand">
          <img className="a-logo" src="/assets/vinci-logo.png" alt="VINCI 2026" width={600} height={111} />
          <div>
            <h1>{title}</h1>
            <p className="muted">数据更新于 {bj(p.updatedAt).hms}</p>
          </div>
        </div>
        <div className="a-actions">
          <button type="button" className="btn-line" aria-pressed={p.auto} onClick={() => p.setAuto(!p.auto)}>
            <span className="dot" aria-hidden="true" />
            实时更新
          </button>
          <a className="btn-line btn-export" href="/api/admin/export">
            一键导出全部
          </a>
          <button type="button" className="btn-line" onClick={p.logout}>
            退出
          </button>
        </div>
      </div>
      {p.loadErr && <div className="banner" role="alert">{p.loadErr}。页面上是上次读到的数据。</div>}

      <div className="days" role="group" aria-label="选择日期">
        {days.map((d) => (
          <button key={d} type="button" className="day" aria-pressed={p.day === d} disabled={d > today} onClick={() => p.setDay(d)}>
            <b>{md(d)}</b>
            <small>{d === today ? "今天" : weekday(d)}</small>
          </button>
        ))}
        <button type="button" className="day day-all" aria-pressed={all} onClick={() => p.setDay("all")}>
          <b>全展期</b>
          <small>汇总</small>
        </button>
      </div>

      <div className="kpis">
        {kpis.map((k, i) => (
          <div className="kpi" key={k.label}>
            <span className="k-label">
              <span className={`sq sq-${MARKS[i]}`} aria-hidden="true" />
              {k.label}
            </span>
            <span className="k-val">{k.value}</span>
            <span className="k-sub">{k.sub}</span>
          </div>
        ))}
      </div>

      <section className="sec">
        <div className="sec-head">
          <h2>
            <span className="sq sq-orange" aria-hidden="true" />
            {chartTitle}
          </h2>
          <p>{chartSub}</p>
        </div>
        <BarChart items={chart} />
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>
            <span className="sq sq-green" aria-hidden="true" />
            观众构成
          </h2>
          <p>性别和年龄段按签到人算，同行者没有填信息{all ? " · 全展期合计" : ""}</p>
        </div>
        <div className="mix">
          <Mix title="性别" mark="red" labels={GENDERS} counts={GENDERS.map((g) => recs.filter((r) => r.gender === g).length)} />
          <Mix title="年龄段" mark="orange" labels={AGES.map((a) => a.replace(/ 岁$/, ""))} counts={AGES.map((a) => recs.filter((r) => r.age === a).length)} />
          <Mix title="同行情况" mark="yellow" labels={GROUPS} counts={GROUPS.map((_, i) => recs.filter((r) => groupOf(r) === i).length)} unit="组" />
        </div>
      </section>

      <Records recs={recs} all={all} query={p.query} setQuery={p.setQuery} showAll={p.showAll} setShowAll={p.setShowAll} armDel={p.armDel} remove={p.remove} />

      <p className="foot-note">
        到访人数 = 签到的人 + 他们填的同行人数。没扫码的观众不在统计里。
        <br />
        签到记录保存 {RETENTION_MONTHS} 个月，到期自动删除
        {earliest ? `（${cnDate(earliest)}的记录会在 ${addMonths(earliest, RETENTION_MONTHS)} 之后删除）` : ""}。要长期保留，请先点「一键导出全部」。
      </p>
    </div>
  );
}

function Delta({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (!prev) return <>{label}：没有可比数据</>;
  const d = Math.round(((cur - prev) / prev) * 100);
  return (
    <>
      {label} <span className={`delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d)}%</span>
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function hourBins(recs: Checkin[], ref: number | null) {
  let lo = OPEN_HOUR;
  let hi = CLOSE_HOUR - 1;
  for (const r of recs) {
    const h = bj(r.ts).hour;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const refDay = ref === null ? null : bj(ref).day;
  const bins = [];
  for (let h = lo; h <= hi; h++) {
    bins.push({ h, visitors: 0, checkins: 0, future: refDay !== null && dayStart(refDay) + h * 3600e3 > ref! });
  }
  for (const r of recs) {
    const b = bins[bj(r.ts).hour - lo];
    b.visitors += r.companions + 1;
    b.checkins += 1;
    b.future = false;
  }
  return bins;
}

interface ChartItem {
  label: string;
  sub?: string;
  value: number;
  future: boolean;
  hi: boolean;
  title: string;
}

function BarChart({ items }: { items: ChartItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(280, Math.floor(w || 600));
  const H = 230;
  const hasSub = items.some((i) => i.sub);
  const padX = 4;
  const padT = 22;
  const padB = hasSub ? 40 : 26;
  const n = Math.max(1, items.length);
  const slot = (W - padX * 2) / n;
  const maxV = Math.max(1, ...items.map((i) => i.value));
  const base = H - padB;
  const hgt = base - padT;
  const cx = (i: number) => padX + slot * (i + 0.5);
  const bw = Math.max(4, Math.min(44, slot * 0.62));
  const every = slot < 30 ? 2 : 1;

  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={items.map((i) => i.title).join("；")}>
          <line className="c-base" x1={padX} x2={W - padX} y1={base} y2={base} />
          {items.map((it, i) => {
            const x = cx(i) - bw / 2;
            if (it.future) {
              return (
                <g key={i}>
                  <title>{it.title}</title>
                  <rect className="c-future" x={x} y={base - 18} width={bw} height={17} />
                </g>
              );
            }
            const h = it.value > 0 ? Math.max(2, (hgt * it.value) / maxV) : 0;
            return (
              <g key={i}>
                <title>{it.title}</title>
                <rect className={`c-bar${it.hi ? " hi" : ""}`} x={x} y={base - h} width={bw} height={h} />
                {slot >= 20 && (
                  <text className={`c-val${it.hi ? " hi" : ""}`} x={cx(i)} y={base - h - 6} textAnchor="middle">
                    {it.value}
                  </text>
                )}
              </g>
            );
          })}
          {items.map((it, i) =>
            i % every ? null : (
              <g key={`l${i}`}>
                <text className={`c-ax${it.hi ? " hi" : ""}`} x={cx(i)} y={base + 16} textAnchor="middle">
                  {it.label}
                </text>
                {it.sub && (
                  <text className="c-ax" x={cx(i)} y={base + 31} textAnchor="middle">
                    {it.sub}
                  </text>
                )}
              </g>
            ),
          )}
        </svg>
      )}
    </div>
  );
}

function Mix({ title, mark, labels, counts, unit = "人" }: { title: string; mark: string; labels: string[]; counts: number[]; unit?: string }) {
  const total = counts.reduce((a, b) => a + b, 0);
  const p = pcts(counts);
  const max = Math.max(1, ...counts);
  const top = counts.indexOf(Math.max(...counts));
  return (
    <div className="mix-panel">
      <div className="mix-head">
        <h3>
          <span className={`sq sq-${mark}`} aria-hidden="true" />
          {title}
        </h3>
        <span>{total ? `最多：${labels[top]}` : "暂无数据"}</span>
      </div>
      <div className="rows">
        {labels.map((l, i) => (
          <div className="row" key={l} title={`${l}：${counts[i]} ${unit}，占 ${p[i]}%`}>
            <span className="lbl">{l}</span>
            <span className="track">
              <span className={`fill${i === top && total ? " top" : ""}`} style={{ width: `${((counts[i] / max) * 100).toFixed(1)}%` }} />
            </span>
            <span className="pct">{p[i]}%</span>
            <span className="cnt">{counts[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Records(props: {
  recs: Checkin[];
  all: boolean;
  query: string;
  setQuery: (v: string) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  armDel: string | null;
  remove: (id: string) => void;
}) {
  const q = props.query.trim();
  let rows = props.recs.slice().sort((a, b) => (a.day === b.day ? b.seq - a.seq : a.day < b.day ? 1 : -1));
  if (q) rows = rows.filter((r) => r.name.includes(q) || r.phone.includes(q));
  const shown = props.showAll || q ? rows : rows.slice(0, 15);
  const recent = Date.now() - 5 * 60e3;

  return (
    <section className="sec">
      <div className="sec-head">
        <h2>
          <span className="sq sq-red" aria-hidden="true" />
          签到明细
        </h2>
        <p>最新的在最上面 · 共 {props.recs.length} 条 · 黄色是 5 分钟内的新签到</p>
      </div>
      <div className="tbl-tools">
        <input className="search" type="search" placeholder="搜姓名或手机号" aria-label="搜索签到记录" value={props.query} onChange={(e) => props.setQuery(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>时间</th>
              <th>姓名</th>
              <th>手机号</th>
              <th>性别</th>
              <th>年龄段</th>
              <th>同行</th>
              <th>
                <span className="sr">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.ts > recent ? "is-new" : undefined}>
                <td className="num">{checkinCode(r)}</td>
                <td className="num">
                  {props.all ? `${md(r.day)} ` : ""}
                  {bj(r.ts).hm}
                </td>
                <td>{r.name}</td>
                <td className="num" title={r.phone}>{maskPhone(r.phone)}</td>
                <td>{r.gender}</td>
                <td>{r.age}</td>
                <td className="num">{r.companions ? `+${r.companions}` : "—"}</td>
                <td>
                  <button type="button" className={`del${props.armDel === r.id ? " armed" : ""}`} onClick={() => props.remove(r.id)}>
                    {props.armDel === r.id ? "确认删除" : "删除"}
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={8} className="empty">
                  {q ? `没有找到「${q}」` : "这一天还没有人签到"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!q && rows.length > 15 && (
        <button type="button" className="btn-line more" onClick={() => props.setShowAll(!props.showAll)}>
          {props.showAll ? "只看最新 15 条" : `显示全部 ${rows.length} 条`}
        </button>
      )}
    </section>
  );
}
