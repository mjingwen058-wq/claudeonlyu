"use client";

import { useMemo } from "react";

// 每个人的专属 ASCII 图案，照 KV 的字符画做。用签到编号播种，同一个人每次打开都一样。
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COLS = 46;
const ROWS = 11;
const RAMP = " .:-=+*#%@";
const TINTS = ["blue", "red", "orange", "green"];

export default function AsciiMark({ seed }: { seed: string }) {
  const { tint, lines } = useMemo(() => {
    const r = rng(hash(seed));
    const tint = TINTS[Math.floor(r() * TINTS.length)];
    const blobs = Array.from({ length: 3 }, () => ({ x: r() * COLS, y: r() * ROWS, sx: 5 + r() * 10, sy: 2 + r() * 3, w: 0.55 + r() * 0.6 }));
    const fx = 0.18 + r() * 0.3;
    const fy = 0.35 + r() * 0.5;
    const ph = r() * 6.28;
    const lines: { cls: string; text: string }[][] = [];
    for (let y = 0; y < ROWS; y++) {
      const runs: { cls: string; text: string }[] = [];
      for (let x = 0; x < COLS; x++) {
        let v = 0.12 + 0.12 * (Math.sin(x * fx + ph) + Math.cos(y * fy - ph));
        for (const b of blobs) v += b.w * Math.exp(-(((x - b.x) / b.sx) ** 2 + ((y - b.y) / b.sy) ** 2));
        v = Math.max(0, Math.min(0.999, v));
        const cls = v < 0.3 ? "f" : v < 0.72 ? "t" : "k";
        const ch = RAMP[Math.floor(v * RAMP.length)];
        const last = runs[runs.length - 1];
        if (last && last.cls === cls) last.text += ch;
        else runs.push({ cls, text: ch });
      }
      lines.push(runs);
    }
    return { tint, lines };
  }, [seed]);

  return (
    <pre className="ascii" aria-hidden="true" style={{ ["--tint" as string]: `var(--${tint})` }}>
      {lines.map((runs, i) => (
        <span key={i}>
          {runs.map((run, j) => (
            <span key={j} className={run.cls}>
              {run.text}
            </span>
          ))}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
