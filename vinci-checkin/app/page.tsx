"use client";

import { useEffect, useRef, useState } from "react";
import AsciiMark from "@/components/AsciiMark";
import { AGES, GENDERS, MAX_COMPANIONS, NAME_MAX, PHONE_RE, RETENTION_MONTHS } from "@/lib/fields";
import { bj, cnDate } from "@/lib/time";
import { checkinCode } from "@/lib/csv";

interface Pass {
  id: string;
  day: string;
  seq: number;
  ts: number;
  name: string;
  companions: number;
}

const PASS_KEY = "vinci-checkin-pass";
const STEPS = [
  { id: "name", title: "你的名字", hint: "会显示在入场凭证上" },
  { id: "phone", title: "手机号", hint: "用来确认今天是否已经签到，不会公开" },
  { id: "gender", title: "性别" },
  { id: "age", title: "年龄段" },
  { id: "companions", title: "今天还有几位同行？", hint: "不算你自己。一起来的朋友不用再扫码" },
] as const;
const MARKS = ["red", "orange", "yellow", "green"];

function readPass(): Pass | null {
  try {
    const p = JSON.parse(localStorage.getItem(PASS_KEY) || "null") as Pass | null;
    return p && p.day === bj(Date.now()).day ? p : null;
  } catch {
    return null;
  }
}
function savePass(p: Pass | null) {
  try {
    if (p) localStorage.setItem(PASS_KEY, JSON.stringify(p));
    else localStorage.removeItem(PASS_KEY);
  } catch {
    /* 隐身模式等存不了，不影响签到 */
  }
}

type Screen = "loading" | "welcome" | "q" | "done";

export default function CheckinPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [i, setI] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [companions, setCompanions] = useState("0");
  const [consent, setConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [phoneErr, setPhoneErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pass, setPass] = useState<Pass | null>(null);
  const [already, setAlready] = useState(false);
  const advance = useRef<ReturnType<typeof setTimeout>>();

  // 今天在这台手机上签过，再扫码直接显示凭证
  useEffect(() => {
    const p = readPass();
    if (p) {
      setPass(p);
      setAlready(true);
      setScreen("done");
    } else setScreen("welcome");
  }, []);

  const compN = /^\d+$/.test(companions) ? Number(companions) : NaN;
  const valid = [
    name.trim().length > 0 && name.trim().length <= NAME_MAX,
    PHONE_RE.test(phone),
    GENDERS.includes(gender),
    AGES.includes(age),
    Number.isInteger(compN) && compN >= 0 && compN <= MAX_COMPANIONS,
  ];
  const last = i === STEPS.length - 1;
  const canNext = !submitting && valid[i] && (!last || consent);
  // 手机号填了但格式不对时按钮仍可点，点了显示错在哪；其他情况不满足就置灰
  const blocked = submitting || (last && !consent) || (i === 1 ? phone.length === 0 : !valid[i]);

  function go(n: number) {
    clearTimeout(advance.current);
    setError("");
    setPhoneErr("");
    setI(n);
    window.scrollTo(0, 0);
  }
  function next() {
    if (!canNext) {
      if (i === 1) checkPhone();
      return;
    }
    if (last) submit();
    else go(i + 1);
  }
  function back() {
    if (i === 0) setScreen("welcome");
    else go(i - 1);
  }
  function pick(setter: (v: string) => void, v: string) {
    setter(v);
    const at = i;
    clearTimeout(advance.current);
    advance.current = setTimeout(() => setI((cur) => (cur === at ? at + 1 : cur)), 260);
  }
  function checkPhone() {
    setPhoneErr(phone && !PHONE_RE.test(phone) ? "手机号是 11 位数字，以 1 开头。" : "");
  }
  function setComp(n: number) {
    setCompanions(String(Math.max(0, Math.min(MAX_COMPANIONS, n))));
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone, gender, age, companions: compN, consent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.record) throw new Error(data.error || "");
      savePass(data.record);
      setPass(data.record);
      setAlready(Boolean(data.already));
      setScreen("done");
      window.scrollTo(0, 0);
    } catch (e: any) {
      setError(
        e?.message
          ? `提交没有成功：${e.message}`
          : "提交没有成功，可能是网络不稳定。你填的内容都还在，再点一次「重新提交」。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    savePass(null);
    setPass(null);
    setAlready(false);
    setName("");
    setPhone("");
    setGender("");
    setAge("");
    setCompanions("0");
    setConsent(false);
    setShowPrivacy(false);
    setI(0);
    setScreen("welcome");
  }

  if (screen === "loading") {
    return (
      <main className="app">
        <div className="v-loading">VINCI 2026</div>
      </main>
    );
  }

  if (screen === "welcome") {
    return (
      <main className="app">
        <div className="v-body">
          <div className="w-top">
            <img className="w-logo" src="/assets/vinci-logo.png" alt="VINCI 2026" width={600} height={111} />
            <div className="w-gallery">
              <span className="w-tri" aria-hidden="true" />
              <b>艺术与媒体画廊</b>
              <span>ART &amp; MEDIA GALLERY</span>
            </div>
          </div>
          <div className="w-title">
            <img className="w-cn" src="/assets/kv-title-cn.png" alt="无界未来" width={999} height={236} />
            <img className="w-en" src="/assets/kv-title-en.png" alt="FUTURES UNBOUND" width={1829} height={129} />
            <p className="w-sub">Visualizing Tech, Culture, and Connection in an AI- and Robot-Driven World</p>
          </div>
          <img className="w-art" src="/assets/kv-art.webp" alt="" width={1500} height={920} />
          <p className="w-meta">
            <span className="sq sq-green" aria-hidden="true" />
            2026.11.1–11.15 / 杭州 HANGZHOU
          </p>
          <p className="w-intro">欢迎来到第 19 届 VINCI 艺术与媒体画廊。签到一共 5 个小问题，大约 30 秒。</p>
        </div>
        <div className="v-foot">
          <button type="button" className="btn-next btn-wide" onClick={() => { setScreen("q"); go(0); }}>
            开始签到 →
          </button>
        </div>
        <div className="strip" aria-hidden="true" />
      </main>
    );
  }

  if (screen === "done" && pass) {
    return <Done pass={pass} already={already} onOther={startOver} />;
  }

  const step = STEPS[i];
  const radio = (options: string[], value: string, setter: (v: string) => void) => (
    <div className="opts" role="radiogroup" aria-labelledby="q-title">
      {options.map((o) => (
        <button key={o} type="button" className="opt" role="radio" aria-checked={value === o} onClick={() => pick(setter, o)}>
          <span>{o}</span>
          <span className="box" aria-hidden="true" />
        </button>
      ))}
    </div>
  );

  return (
    <main className="app">
      <div className="v-body">
        <div className="q-progress" aria-hidden="true">
          {STEPS.map((s, k) => (
            <i key={s.id} className={k <= i ? "on" : ""} />
          ))}
        </div>
        <p className="q-num">
          <span className={`sq sq-${MARKS[i % 4]}`} aria-hidden="true" />
          {String(i + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
        </p>
        <h1 className="q-title" id="q-title">
          {step.title}
        </h1>
        {"hint" in step && <p className="q-hint">{step.hint}</p>}

        {step.id === "name" && (
          <input
            key="name"
            className="field-input"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            placeholder="姓名"
            aria-labelledby="q-title"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) next(); }}
          />
        )}
        {step.id === "phone" && (
          <>
            <input
              key="phone"
              className="field-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={11}
              placeholder="11 位手机号"
              aria-labelledby="q-title"
              aria-describedby="phone-err"
              autoFocus
              value={phone}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 11);
                setPhone(v);
                if (phoneErr && PHONE_RE.test(v)) setPhoneErr("");
              }}
              onBlur={checkPhone}
              onKeyDown={(e) => { if (e.key === "Enter") next(); }}
            />
            <p className="field-err" id="phone-err" hidden={!phoneErr}>
              {phoneErr}
            </p>
          </>
        )}
        {step.id === "gender" && radio(GENDERS, gender, setGender)}
        {step.id === "age" && radio(AGES, age, setAge)}
        {step.id === "companions" && (
          <>
            <div className="stepper">
              <button type="button" aria-label="减少一位" disabled={!(compN > 0)} onClick={() => setComp(compN - 1)}>
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-labelledby="q-title"
                value={companions}
                onChange={(e) => setCompanions(e.target.value.replace(/\D/g, "").slice(0, 2))}
                onBlur={() => setComp(Number.isNaN(compN) ? 0 : compN)}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" aria-label="增加一位" disabled={!(compN < MAX_COMPANIONS)} onClick={() => setComp((Number.isNaN(compN) ? 0 : compN) + 1)}>
                +
              </button>
            </div>
            <p className="stepper-note">
              {Number.isNaN(compN) ? "请填一个数字" : compN > MAX_COMPANIONS ? `最多填 ${MAX_COMPANIONS} 位，人更多请找工作人员登记` : <>加上你，今天一共 <b>{compN + 1}</b> 人</>}
            </p>
            <div className="consent">
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  我同意主办方收集以上信息，用于观展签到和人数统计。
                  <button type="button" className="link" aria-expanded={showPrivacy} onClick={(e) => { e.preventDefault(); setShowPrivacy((v) => !v); }}>
                    {showPrivacy ? "收起说明" : "查看说明"}
                  </button>
                </span>
              </label>
              {showPrivacy && (
                <div className="privacy">
                  <p>收集内容：姓名、手机号、性别、年龄段、同行人数。</p>
                  <p>用途：观众签到、统计观展人数。只在主办方内部使用，不提供给第三方。</p>
                  <p>保存期限：{RETENTION_MONTHS} 个月，到期自动删除。</p>
                </div>
              )}
            </div>
          </>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="v-foot">
        <button type="button" className="btn-ghost" onClick={back}>
          ← 上一步
        </button>
        <button type="button" className="btn-next" disabled={blocked} onClick={next}>
          {submitting ? "提交中…" : last ? (error ? "重新提交" : "提交签到") : "下一步"}
        </button>
      </div>
    </main>
  );
}

function Done({ pass, already, onOther }: { pass: Pass; already: boolean; onOther: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="app">
      <div className="v-body">
        <div className="done-top">
          <span className="chip">{already ? "今天已签到" : "签到成功"}</span>
          <span className="done-code">{checkinCode(pass)}</span>
        </div>
        {already && <p className="done-note">你今天 {bj(pass.ts).hm} 已经签到过了，下面是你的入场凭证。</p>}
        <div className="done-seq">
          <span>今天第</span>
          <b>{pass.seq}</b>
          <span>位观众</span>
        </div>
        <AsciiMark seed={pass.id} />
        <dl className="ticket">
          <div>
            <dt>姓名</dt>
            <dd>{pass.name}</dd>
          </div>
          <div>
            <dt>日期</dt>
            <dd>{cnDate(pass.day)}</dd>
          </div>
          <div>
            <dt>签到时间</dt>
            <dd className="mono">{bj(pass.ts).hm}</dd>
          </div>
          <div>
            <dt>到访人数</dt>
            <dd>{pass.companions ? `${pass.companions + 1} 人（含同行 ${pass.companions} 位）` : "1 人"}</dd>
          </div>
        </dl>
        <div className="live">
          <span className="sq sq-orange blink" aria-hidden="true" />
          <span className="clock mono">{bj(now).hms}</span>
          <span className="live-label">北京时间</span>
        </div>
        <p className="done-hint">入场时把这个页面给工作人员看一眼。时钟一直在走，说明不是截图。</p>
        <button type="button" className="btn-ghost done-other" onClick={onOther}>
          帮别人签到
        </button>
      </div>
      <div className="strip" aria-hidden="true" />
    </main>
  );
}
