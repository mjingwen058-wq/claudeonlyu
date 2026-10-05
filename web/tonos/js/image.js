// ⑤ 图像（慢通道，文档 1.4）：WebGL2 反应-扩散（Gray-Scott），画面是展厅的俯视自身地图。
// 内核变量经惯性平滑后驱动参数；观众以扰动的形式出现在真实位置；节点发声时它的位置泛起一圈涟漪。
// 图像只表现内核状态，不跟手走。

import { clamp, rng } from './util.js';
import { NODES } from './sound.js';

const PRESETS = {
  rest: [0.0545, 0.062], // 珊瑚：稳定、缓慢生长
  withdraw: [0.03, 0.062], // 孤子：斑点收缩
  explore: [0.029, 0.057], // 迷宫：分叉
  sleep: [0.022, 0.0535], // 稀薄、变暗
};
const MUTANTS = [[0.078, 0.061], [0.026, 0.051], [0.034, 0.0618], [0.062, 0.0609], [0.042, 0.059], [0.039, 0.058]];
export const MODE_RGB = {
  rest: [0.66, 0.75, 0.84],
  withdraw: [1.0, 0.5, 0.43],
  explore: [0.96, 0.73, 0.38],
  sleep: [0.62, 0.55, 0.86],
  mutate: [0.46, 0.85, 0.7],
};

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const NOISE = `
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }`;

const SIM = `#version 300 es
precision highp float;
uniform sampler2D uS; uniform vec2 uPx; uniform float uF, uK, uNov, uT, uRad, uRough, uAspect;
uniform vec4 uSpot[10]; uniform int uNS; uniform vec4 uRing[6]; uniform int uNR;
in vec2 vUv; out vec4 o;
${NOISE}
void main(){
  vec2 c = texture(uS, vUv).rg;
  vec2 l = texture(uS, vUv + vec2(-uPx.x, 0)).rg + texture(uS, vUv + vec2(uPx.x, 0)).rg
         + texture(uS, vUv + vec2(0, -uPx.y)).rg + texture(uS, vUv + vec2(0, uPx.y)).rg;
  vec2 d = texture(uS, vUv + uPx * vec2(-1, -1)).rg + texture(uS, vUv + uPx * vec2(1, -1)).rg
         + texture(uS, vUv + uPx * vec2(-1, 1)).rg + texture(uS, vUv + uPx * vec2(1, 1)).rg;
  vec2 lap = 0.2 * l + 0.05 * d - c;
  float u = c.r, v = c.g;
  float F = uF;
  float K = uK + uNov * 0.007 * (n2(vUv * 5.0 + uT * 0.03) - 0.5);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(q);
  float edge = uRad * (1.0 + uRough * 0.4 * (n2(vUv * 8.0 + uT * 0.15) - 0.5));
  float outside = smoothstep(edge - 0.03, edge + 0.03, r);
  K += outside * 0.025;
  F -= outside * 0.01;
  float uvv = u * v * v;
  u += lap.x - uvv + F * (1.0 - u);
  v += 0.5 * lap.y + uvv - (F + K) * v;
  for (int i = 0; i < 10; i++) { if (i >= uNS) break; vec4 s = uSpot[i];
    vec2 dd = (vUv - s.xy) * vec2(uAspect, 1.0); float g = exp(-dot(dd, dd) / (s.z * s.z));
    v += s.w * g * 0.05; u -= s.w * g * 0.02; }
  for (int i = 0; i < 6; i++) { if (i >= uNR) break; vec4 s = uRing[i];
    vec2 dd = (vUv - s.xy) * vec2(uAspect, 1.0); float rr = length(dd);
    float g = exp(-pow((rr - s.z) / 0.012, 2.0)); v += s.w * g * 0.06; }
  o = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uS; uniform vec3 uCol; uniform float uSat, uBright; uniform vec2 uPx;
in vec2 vUv; out vec4 o;
void main(){
  float v = texture(uS, vUv).g;
  float gx = texture(uS, vUv + vec2(uPx.x, 0)).g - texture(uS, vUv - vec2(uPx.x, 0)).g;
  float gy = texture(uS, vUv + vec2(0, uPx.y)).g - texture(uS, vUv - vec2(0, uPx.y)).g;
  float edge = clamp(length(vec2(gx, gy)) * 5.0, 0.0, 1.0);
  vec3 bg = vec3(0.043, 0.048, 0.056);
  float body = smoothstep(0.08, 0.34, v);
  vec3 col = mix(vec3(dot(uCol, vec3(0.333))), uCol, uSat);
  vec3 c = mix(bg, col * uBright * 0.85, body) + edge * col * 0.55 * uBright;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.7;
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Body {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.W = 320;
    this.H = 200;
    this.aspect = this.W / this.H;
    this.F = PRESETS.rest[0];
    this.K = PRESETS.rest[1];
    this.col = [...MODE_RGB.rest];
    this.lag = { arousal: 0.2, boundary: 0.9, novelty: 0, fullness: 0.35, wear: 0.1 };
    this.people = new Map();
    this.seedSpots = [];
    this.t = 0;
    this.lastSeed = -1;
    this.wander = { x: 0.5, y: 0.5, a: 0 };
    this.rand = rng(5);
    try {
      this.init();
      this.ok = true;
    } catch (e) {
      this.error = e.message;
    }
  }

  init() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('浏览器不支持 WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('显卡不支持浮点渲染');
    this.gl = gl;
    this.canvas.width = this.W * 2;
    this.canvas.height = this.H * 2;
    this.sim = program(gl, SIM);
    this.show = program(gl, SHOW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    const data = new Float32Array(this.W * this.H * 4);
    for (let i = 0; i < this.W * this.H; i++) data[i * 4] = 1;
    // 初始种子：身体中心附近几团
    for (let b = 0; b < 14; b++) {
      const cx = this.W * (0.3 + this.rand() * 0.4), cy = this.H * (0.3 + this.rand() * 0.4), rad = 3 + this.rand() * 6;
      for (let y = Math.floor(cy - rad); y < cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
          const i = (y * this.W + x) * 4;
          data[i] = 0.4;
          data[i + 1] = 0.35;
        }
      }
    }
    this.tex = [0, 1].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.W, this.H, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    this.fb = this.tex.map((t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('帧缓冲不可用');
      return f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 0;
  }

  // s: {mode, v, seed, sediment, people:[{id,fx,fy,e,prox}], ripples:[{node, age, vel}]}
  render(dt, s) {
    if (!this.ok) return;
    this.t += dt;
    const gl = this.gl;
    // 惯性：图像比声音慢
    const a = 1 - Math.exp(-dt / 2.5);
    for (const k in this.lag) this.lag[k] += (s.v[k] - this.lag[k]) * a;
    const L = this.lag;
    let target = PRESETS[s.mode] || MUTANTS[s.seed % MUTANTS.length];
    // 沉积让"平静"的基调逐日漂移
    const drift = s.sediment;
    const tF = target[0] + 0.0035 * Math.sin(drift * 2.1 + 0.7);
    const tK = target[1] + 0.0015 * Math.cos(drift * 1.7);
    const b = 1 - Math.exp(-dt / 5);
    this.F += (tF - this.F) * b;
    this.K += (tK - this.K) * b;
    const rgb = MODE_RGB[s.mode] || MODE_RGB.rest;
    const c = 1 - Math.exp(-dt / 3);
    for (let i = 0; i < 3; i++) this.col[i] += (rgb[i] - this.col[i]) * c;
    if (s.seed !== this.lastSeed) {
      if (this.lastSeed !== -1) {
        for (let i = 0; i < 6; i++) this.seedSpots.push({ x: 0.3 + this.rand() * 0.4, y: 0.3 + this.rand() * 0.4, life: 0.6 });
      }
      this.lastSeed = s.seed;
    }

    // 观众：位置与能量都经过平滑
    const seen = new Set();
    for (const p of s.people) {
      seen.add(p.id);
      const q = this.people.get(p.id) || { x: p.fx, y: p.fy, e: 0, pr: p.prox };
      const k = 1 - Math.exp(-dt / 1.5);
      q.x += (p.fx - q.x) * k;
      q.y += (p.fy - q.y) * k;
      q.e += (p.e - q.e) * k;
      q.pr += (p.prox - q.pr) * k;
      this.people.set(p.id, q);
    }
    for (const id of [...this.people.keys()]) if (!seen.has(id)) this.people.delete(id);

    const spots = [];
    this.wander.a += dt * 0.2;
    this.wander.x = 0.5 + 0.12 * Math.sin(this.wander.a * 1.3);
    this.wander.y = 0.5 + 0.1 * Math.sin(this.wander.a * 0.9 + 1);
    spots.push([this.wander.x, this.wander.y, 0.03, 0.12 + 0.08 * Math.sin(this.t * 0.7)]);
    for (const q of this.people.values()) {
      if (spots.length >= 8) break;
      spots.push([q.x, 1 - q.y, 0.03 + 0.04 * q.pr, 0.12 + 0.55 * q.e]);
    }
    this.seedSpots = this.seedSpots.filter((p) => (p.life -= dt) > 0);
    for (const p of this.seedSpots) if (spots.length < 10) spots.push([p.x, p.y, 0.025, 1.2]);
    const rings = [];
    for (const r of s.ripples.slice(-6)) {
      const n = NODES[r.node];
      rings.push([n.x, 1 - n.y, 0.015 + r.age * 0.18, (1 - r.age) * (0.25 + 0.5 * r.vel)]);
    }

    const steps = Math.round((4 + 12 * L.arousal) * (1 - 0.5 * L.wear) * (s.mode === 'sleep' ? 0.6 : 1));
    gl.useProgram(this.sim.p);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.W, this.H);
    const U = this.sim.u;
    gl.uniform2f(U.uPx, 1 / this.W, 1 / this.H);
    gl.uniform1f(U.uF, this.F);
    gl.uniform1f(U.uK, this.K);
    gl.uniform1f(U.uNov, L.novelty + (s.mode === 'explore' ? 0.6 : 0));
    gl.uniform1f(U.uT, this.t);
    gl.uniform1f(U.uRad, 0.3 + 0.24 * L.boundary);
    gl.uniform1f(U.uRough, 1 - L.boundary);
    gl.uniform1f(U.uAspect, this.aspect);
    const sp = new Float32Array(40);
    spots.forEach((v, i) => sp.set(v, i * 4));
    gl.uniform4fv(U.uSpot, sp);
    gl.uniform1i(U.uNS, spots.length);
    const rg = new Float32Array(24);
    rings.forEach((v, i) => rg.set(v, i * 4));
    gl.uniform4fv(U.uRing, rg);
    gl.uniform1i(U.uNR, rings.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.uS, 0);
    for (let i = 0; i < steps; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1 - this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = 1 - this.cur;
      if (i === 0) {
        // 注入只在第一步生效
        gl.uniform1i(U.uNS, 0);
        gl.uniform1i(U.uNR, 0);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.show.p);
    const S = this.show.u;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.uniform1i(S.uS, 0);
    gl.uniform3f(S.uCol, ...this.col);
    gl.uniform1f(S.uSat, 0.2 + 0.8 * clamp(L.fullness));
    gl.uniform1f(S.uBright, clamp(1.08 - 0.65 * L.wear, 0.3, 1.1) * (s.mode === 'sleep' ? 0.7 : 1));
    gl.uniform2f(S.uPx, 1 / this.W, 1 / this.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.params = { F: this.F, K: this.K, steps };
  }
}

// 叠加层：节点、观众、主屏的位置（屏幕是空间的自身地图）
export function drawMap(cv, people, ripples, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const ink = opts.ink || 'rgba(230,226,216,0.75)';
  const dim = opts.dim || 'rgba(230,226,216,0.35)';
  g.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  g.textBaseline = 'middle';
  // 主屏 = 身体中心
  g.strokeStyle = dim;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(w * 0.36, h - 6);
  g.lineTo(w * 0.64, h - 6);
  g.stroke();
  if (opts.labels !== false) {
    g.fillStyle = dim;
    g.textAlign = 'center';
    g.fillText('主屏', w * 0.5, h - 14);
  }
  NODES.forEach((n, i) => {
    const x = n.x * w, y = n.y * h;
    g.strokeStyle = ink;
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.stroke();
    for (const r of ripples) {
      if (r.node !== i) continue;
      g.strokeStyle = `rgba(230,226,216,${(1 - r.age) * 0.6})`;
      g.beginPath();
      g.arc(x, y, 5 + r.age * 26, 0, Math.PI * 2);
      g.stroke();
    }
    if (opts.labels !== false) {
      g.fillStyle = dim;
      g.textAlign = 'left';
      g.fillText(n.id, x + 7, y);
    }
  });
  for (const p of people) {
    const x = p.fx * w, y = p.fy * h;
    g.strokeStyle = p.src === 'sim' ? dim : ink;
    g.setLineDash(p.src === 'sim' ? [2, 2] : []);
    g.beginPath();
    g.arc(x, y, 5 + p.e * 6, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.moveTo(x, y - 3); g.lineTo(x, y + 3);
    g.stroke();
    if (opts.labels !== false) {
      g.fillStyle = dim;
      g.textAlign = 'left';
      g.fillText(p.id, x + 9, y - 7);
    }
  }
}

// ———— 扰动层：观众对它的神经挑动 ————
// 和反应-扩散的身体（它自己的状态：慢、叠加）分开画。这一层是快的、线性的、带噪波的：
// 纤维从每个人出发，带着噪波游走到核心，动得越用力越乱；动作一起就有一束直线射向核心；
// 核心外的同心细线在观众方向被刮开、错位。
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}

export class Nerves {
  constructor(canvas) {
    this.cv = canvas;
    this.fibers = [];
    this.streaks = [];
    this.people = [];
    this.acc = new Map();
    this.rand = rng(29);
    this.t = 0;
    this.aspect = 1.6;
  }

  // 一次动作起始：一束直线从这个人射向核心
  burst(fx, fy, strength) {
    const n = Math.round(8 + 16 * clamp(strength));
    for (let i = 0; i < n && this.streaks.length < 160; i++) {
      this.streaks.push({
        x: fx + (this.rand() - 0.5) * 0.025,
        y: fy + (this.rand() - 0.5) * 0.025,
        spread: (this.rand() - 0.5) * 0.5,
        len: 0.12 + 0.3 * this.rand() * (0.5 + strength),
        life: 0,
        max: 0.45 + 0.4 * this.rand(),
        w: 0.8 + 2.2 * this.rand() * strength,
      });
    }
  }

  spawnFiber(p) {
    const A = this.aspect;
    const r = this.rand;
    let x = p.fx * A + (r() - 0.5) * 0.03;
    let y = p.fy + (r() - 0.5) * 0.03;
    const cx = 0.5 * A, cy = 0.5;
    const seed = r() * 100;
    const jit = 0.35 + 1.5 * p.e + 0.4 * p.prox;
    const pts = [x, y];
    for (let i = 0; i < 70; i++) {
      const dx = cx - x, dy = cy - y;
      if (Math.hypot(dx, dy) < 0.05 + 0.05 * r()) break;
      const ang = Math.atan2(dy, dx) + (vnoise(x * 7 + seed, y * 7 + this.t * 0.3) - 0.5) * 2.8 * jit;
      const step = 0.012 * (0.7 + 0.6 * r());
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      pts.push(x, y);
    }
    return { pts, life: 0, max: 0.7 + 0.9 * r() + 0.5 * p.e, w: 0.5 + 0.7 * r(), blue: r() < 0.25 };
  }

  update(dt, people) {
    this.t += dt;
    this.people = people;
    for (const p of people) {
      let acc = (this.acc.get(p.id) || 0) + (3 + 34 * p.e + 10 * p.prox) * dt;
      while (acc >= 1) {
        acc -= 1;
        if (this.fibers.length < 240) this.fibers.push(this.spawnFiber(p));
      }
      this.acc.set(p.id, acc);
    }
    for (const id of [...this.acc.keys()]) if (!people.some((p) => p.id === id)) this.acc.delete(id);
    for (const f of this.fibers) f.life += dt;
    for (const s of this.streaks) s.life += dt;
    this.fibers = this.fibers.filter((f) => f.life < f.max);
    this.streaks = this.streaks.filter((s) => s.life < s.max);
  }

  draw(boundary) {
    const cv = this.cv;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.aspect = w / h;
    const cx = w / 2, cy = h / 2;
    const people = this.people;
    const dirs = people.map((p) => ({ a: Math.atan2(p.fy * h - cy, p.fx * w - cx), e: p.e, pr: p.prox }));

    // 同心细线：核心的膜，被观众的方向刮开、错位
    const R0 = (0.3 + 0.24 * boundary) * h;
    g.lineWidth = 0.7;
    for (let k = 0; k < 7; k++) {
      const R = R0 * (0.55 + k * 0.085);
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= 220; i++) {
        const th = (i / 220) * Math.PI * 2;
        let push = 0, glitch = 0;
        for (const d of dirs) {
          const diff = Math.abs((((th - d.a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
          const g0 = Math.exp((-diff * diff) / 0.12);
          push += g0 * (3 + 22 * d.e + 10 * d.pr);
          glitch += g0 * (0.3 + d.e);
        }
        const n = vnoise(th * 6 + k * 3.1, this.t * 0.6 + k) - 0.5;
        const rr = R + n * (2 + push * 1.2) * (k % 2 ? 1 : -1) + Math.sin(th * 40 + this.t * 8 + k) * push * 0.15;
        if (glitch > 0.25 && vnoise(th * 25 + k * 7, Math.floor(this.t * 12)) < glitch * 0.35) { pen = false; continue; }
        const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.strokeStyle = `rgba(231,227,217,${0.07 + 0.03 * k})`;
      g.stroke();
    }

    // 纤维：从人出发，噪波游走到核心；先长出来，再从尾部收回
    g.lineCap = 'round';
    for (const f of this.fibers) {
      const prog = f.life / f.max;
      const n = f.pts.length / 2;
      const end = Math.max(2, Math.floor(n * Math.min(1, prog / 0.35)));
      const start = prog > 0.6 ? Math.floor((n * (prog - 0.6)) / 0.4) : 0;
      if (end - start < 2) continue;
      const alpha = 0.55 * Math.min(1, prog / 0.1) * (1 - Math.max(0, prog - 0.6) / 0.4);
      g.beginPath();
      for (let i = start; i < end; i++) {
        const x = f.pts[i * 2] * h, y = f.pts[i * 2 + 1] * h;
        if (i === start) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = f.blue ? `rgba(141,180,255,${alpha})` : `rgba(231,227,217,${alpha})`;
      g.lineWidth = f.w;
      g.stroke();
    }

    // 直线束：动作起始时射向核心
    for (const s of this.streaks) {
      const prog = s.life / s.max;
      const x0 = s.x * w, y0 = s.y * h;
      const ang = Math.atan2(cy - y0, cx - x0) + s.spread;
      const L = s.len * h;
      const a0 = Math.max(0, prog - 0.35) / 0.65, a1 = Math.min(1, prog / 0.35);
      g.beginPath();
      g.moveTo(x0 + Math.cos(ang) * L * a0, y0 + Math.sin(ang) * L * a0);
      g.lineTo(x0 + Math.cos(ang) * L * a1, y0 + Math.sin(ang) * L * a1);
      g.strokeStyle = `rgba(231,227,217,${0.85 * (1 - prog)})`;
      g.lineWidth = s.w;
      g.stroke();
    }

    // 噪波：动作强的人身边闪烁的短横线
    for (const p of people) {
      if (p.e < 0.25) continue;
      const k = Math.round(p.e * 10);
      for (let i = 0; i < k; i++) {
        const x = p.fx * w + (this.rand() - 0.5) * 0.14 * h;
        const y = p.fy * h + (this.rand() - 0.5) * 0.14 * h;
        g.fillStyle = `rgba(231,227,217,${0.5 * this.rand()})`;
        g.fillRect(x, y, 4 + this.rand() * 18, 0.8);
      }
    }
  }
}
