/* 五个 3D 场景，各对应一张参考图
 * A Glyph Field   字形场   ← 参考图 1  K/M 字符矩阵
 * B Halftone Vol  半调体   ← 参考图 2  灰阶圆点
 * C Groove Tunnel 唱片隧道 ← 参考图 4  同心圆切字
 * D Stroke Flow   笔触流   ← 参考图 3  粗描边笔触
 * E Scribble Nest 涂鸦巢   ← 参考图 5  乱线和中心黑点
 * 所有场景统一用 uFade（0~1）做淡入淡出：缩小或稀疏，不用透明度，保持纯黑白
 */
(function () {
  const SF = (window.SF = window.SF || {});
  const NB = SF.NB;
  const HIST = 64; // 历史行数（Z 轴深度）

  const GLSL_NOISE = `
    float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vnoise(vec3 x){
      vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                     mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                     mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }`;

  /* —— 共享的声音历史纹理：64 列（频带）× 64 行（时间），行 0 是最新 ——
   * R = 频带幅度  G = 质心  B = 平坦度  A = 起音 */
  class History {
    constructor() {
      this.data = new Uint8Array(NB * HIST * 4);
      this.tex = new THREE.DataTexture(this.data, NB, HIST, THREE.RGBAFormat);
      this.tex.magFilter = THREE.NearestFilter;
      this.tex.minFilter = THREE.NearestFilter;
      this.wave = new Uint8Array(256 * HIST * 4);
      this.waveTex = new THREE.DataTexture(this.wave, 256, HIST, THREE.RGBAFormat);
      this.waveTex.magFilter = THREE.LinearFilter;
      this.waveTex.minFilter = THREE.LinearFilter;
      this._acc = 0;
    }
    /* 每拍推入 rowsPerBeat 行：Z 轴的“时间”跟着 BPM 走 */
    update(f, dt, rowsPerBeat) {
      this._acc += dt * (f.bpm / 60) * rowsPerBeat;
      if (this._acc < 1) return;
      this._acc = Math.min(this._acc - 1, 2);
      const d = this.data;
      d.copyWithin(NB * 4, 0, NB * 4 * (HIST - 1));
      for (let i = 0; i < NB; i++) {
        d[i * 4] = f.bands[i] * 255;
        d[i * 4 + 1] = f.centroid * 255;
        d[i * 4 + 2] = f.flatness * 255;
        d[i * 4 + 3] = f.onset * 255;
      }
      this.tex.needsUpdate = true;
      const w = this.wave;
      w.copyWithin(256 * 4, 0, 256 * 4 * (HIST - 1));
      let peak = 0.02;
      for (let i = 0; i < 256; i++) peak = Math.max(peak, Math.abs(f.wave[i]));
      for (let i = 0; i < 256; i++) {
        const v = (f.wave[i] / peak) * 0.5 + 0.5;
        w[i * 4] = v * 255;
      }
      this.waveTex.needsUpdate = true;
    }
  }

  function glyphAtlas() {
    // 4 格：K 常规 / M 常规 / K 粗 / M 粗
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fam = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    ['K', 'M', 'K', 'M'].forEach((ch, i) => {
      g.font = `${i < 2 ? 500 : 800} 104px ${fam}`;
      g.fillText(ch, i * 128 + 64, 70);
    });
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearMipMapLinearFilter;
    return t;
  }

  /* ———————————————— A 字形场 ———————————————— */
  class GlyphField {
    constructor(hist) {
      this.name = 'A 字形场 Glyph Field';
      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('uv', base.getAttribute('uv'));
      const rows = 48, N = NB * rows;
      const cell = new Float32Array(N * 2), rnd = new Float32Array(N);
      for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < NB; i++, k++) {
        cell[k * 2] = i; cell[k * 2 + 1] = j; rnd[k] = Math.random();
      }
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
      geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
      geo.instanceCount = N;
      this.u = {
        uHist: { value: hist.tex }, uAtlas: { value: glyphAtlas() },
        uTime: { value: 0 }, uFade: { value: 0 }, uChaos: { value: 0 }, uLow: { value: 0 },
        uHigh: { value: 0 }, uDensity: { value: 0.5 }, uDepth: { value: 1 }, uOnset: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: `
          uniform sampler2D uHist; uniform float uTime, uFade, uChaos, uLow, uHigh, uDensity, uDepth, uOnset;
          attribute vec2 aCell; attribute float aRand;
          varying vec2 vUv; varying float vGlyph;
          void main(){
            vec4 h = texture2D(uHist, vec2((aCell.x+.5)/64., (aCell.y+.5)/64.));
            float a = h.r;
            // 密度：响度越大，亮着的格子越多（参考图 1 的上密下疏）
            float on = step(1.0 - uDensity, a + aRand*0.25);
            float size = (0.18 + a*0.95) * on * uFade;
            // 高频：小字闪烁
            size *= 1.0 - uHigh*step(0.82, fract(aRand*91.7 + uTime*6.0));
            vec3 p = vec3((aCell.x-31.5)*0.30, (a*a*2.6 - 0.9), -aCell.y*0.32*uDepth);
            // 低频：最新的几行沿 Z 冲出来
            p.z += uLow*2.2*exp(-aCell.y*0.12);
            p.y += uLow*0.6*exp(-aCell.y*0.2)*sin(aCell.x*0.4);
            // 平坦度（噪声度）：网格解体
            p += uChaos * 2.0 * vec3(sin(aRand*40.+uTime*1.3+aCell.y*.2), cos(aRand*33.+uTime*1.1+aCell.x*.1), sin(aRand*17.+uTime*.7));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            mv.xy += position.xy * size * 0.34;
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            // 质心：亮 → K，暗 → M；幅度大 → 粗体；起音时整行洗牌
            float g = step(0.45, h.g + (aRand-.5)*0.3 + h.a*step(.5,aRand)*.6);
            g = mod(g + step(0.62, a)*2.0, 4.0);
            vGlyph = g;
          }`,
        fragmentShader: `
          uniform sampler2D uAtlas; varying vec2 vUv; varying float vGlyph;
          void main(){
            float a = texture2D(uAtlas, vec2((vGlyph + vUv.x)/4.0, vUv.y)).a;
            if (a < 0.5) discard;
            gl_FragColor = vec4(1.0);
          }`,
        transparent: false,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.frustumCulled = false;
      this.group = new THREE.Group();
      this.group.add(this.mesh);
    }
    update(f, t, dt, m) {
      const u = this.u;
      u.uTime.value = t;
      u.uLow.value = f.low * m.zDepth;
      u.uHigh.value = f.high;
      u.uChaos.value = Math.pow(f.flatness, 1.5) * m.chaos;
      u.uDensity.value = Math.min(1, 0.25 + f.rms * 0.9 + m.density - 0.5);
      u.uDepth.value = 0.7 + f.energyFast * m.zDepth;
      u.uOnset.value = f.onset;
    }
  }

  /* ———————————————— B 半调体 ———————————————— */
  class HalftoneVolume {
    constructor(hist) {
      this.name = 'B 半调体 Halftone Volume';
      const NX = 44, NY = 30, NZ = 8, N = NX * NY * NZ;
      const pos = new Float32Array(N * 3), cell = new Float32Array(N * 3);
      let k = 0;
      for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, k++) {
        pos[k * 3] = (x - (NX - 1) / 2) * 0.26;
        pos[k * 3 + 1] = (y - (NY - 1) / 2) * 0.26;
        pos[k * 3 + 2] = -z * 0.9;
        cell[k * 3] = x / (NX - 1); cell[k * 3 + 1] = y / (NY - 1); cell[k * 3 + 2] = z / (NZ - 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 3));
      this.u = {
        uHist: { value: hist.tex }, uTime: { value: 0 }, uFade: { value: 0 }, uLow: { value: 0 },
        uMid: { value: 0 }, uHigh: { value: 0 }, uRms: { value: 0 }, uScale: { value: 1 },
        uBreath: { value: 0 }, uDepth: { value: 1 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: GLSL_NOISE + `
          uniform sampler2D uHist; uniform float uTime, uFade, uLow, uMid, uHigh, uRms, uScale, uBreath, uDepth;
          attribute vec3 aCell; varying float vVal;
          void main(){
            // X → 频带，Z 层 → 历史（越深越旧）
            float band = texture2D(uHist, vec2(aCell.x, aCell.z*0.5 + 0.004)).r;
            float n = vnoise(vec3(aCell.xy*vec2(5.0,3.5), aCell.z*2.0 + uTime*(0.15+uMid*0.6)));
            float v = n*0.55 + band*0.75*(1.0 - aCell.y*0.35) + uBreath;
            v = clamp(v - 0.35, 0.0, 1.0) * 1.6;
            vec3 p = position;
            p.z = p.z*uDepth + uLow*2.4*v;          // 低频沿 Z 挤出
            p.xy += (vec2(hash(position*3.1), hash(position*7.7))-.5) * uHigh*0.12;  // 高频抖动
            vVal = v;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = clamp(v, 0.0, 1.0) * uFade * uScale * 26.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vVal;
          void main(){
            vec2 c = gl_PointCoord - .5;
            if (dot(c,c) > .25) discard;
            // 四级灰阶（参考图 2）
            float g = floor(clamp(vVal,0.,1.)*3.99)/3.0;
            gl_FragColor = vec4(vec3(0.35 + g*0.65), 1.0);
          }`,
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      this.group = new THREE.Group();
      this.group.add(this.points);
    }
    update(f, t, dt, m, renderer) {
      const u = this.u;
      u.uTime.value = t;
      u.uLow.value = f.low * m.zDepth;
      u.uMid.value = f.mid;
      u.uHigh.value = f.high;
      u.uRms.value = f.rms;
      u.uDepth.value = 0.6 + f.energyFast * m.zDepth * 0.8;
      // 静音待机：缓慢呼吸
      u.uBreath.value = f.state === 'SILENT' ? 0.25 + 0.12 * Math.sin(t * 1.3) : m.density - 0.5;
      u.uScale.value = renderer.getPixelRatio() * window.innerHeight / 900 * 9;
    }
  }

  /* ———————————————— C 唱片隧道 ———————————————— */
  function textMask(text) {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 380;
    g.font = `800 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 1900) { size *= 1900 / w; g.font = `800 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; }
    g.fillText(text, 1024, 270);
    return new THREE.CanvasTexture(c);
  }

  class GrooveTunnel {
    constructor(hist) {
      this.name = 'C 唱片隧道 Groove Tunnel';
      const RINGS = 56, SEG = 256;
      const pos = new Float32Array(RINGS * SEG * 2 * 3), attr = new Float32Array(RINGS * SEG * 2 * 2);
      let k = 0;
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) for (let e = 0; e < 2; e++, k++) {
        attr[k * 2] = (s + e) / SEG; attr[k * 2 + 1] = r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aRing', new THREE.BufferAttribute(attr, 2));
      this.u = {
        uWave: { value: hist.waveTex }, uTime: { value: 0 }, uFade: { value: 0 }, uLow: { value: 0 },
        uMid: { value: 0 }, uOnset: { value: 0 }, uScroll: { value: 0 }, uSlice: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: `
          uniform sampler2D uWave; uniform float uTime, uFade, uLow, uMid, uOnset, uScroll, uSlice;
          attribute vec2 aRing; varying float vZ;
          void main(){
            float ang = aRing.x * 6.2831853;
            float ring = aRing.y;
            float w = texture2D(uWave, vec2(aRing.x, (ring+.5)/64.)).r - .5;
            float r = (1.2 + ring*0.075 + uLow*0.9*exp(-ring*0.08)) * uFade;
            r += w * (0.25 + uMid*1.4);
            // 起音：按扇区切开并错位（参考图 4 的切片感）
            float sector = floor(aRing.x*12.0);
            r += uSlice * 0.35 * (fract(sin(sector*12.9+ring*3.1)*43758.5)-.5);
            float z = -mod(ring*0.42 - uScroll, 56.0*0.42);
            vec3 p = vec3(cos(ang)*r, sin(ang)*r, z);
            vZ = z;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
          }`,
        fragmentShader: `void main(){ gl_FragColor = vec4(1.0); }`,
      });
      this.lines = new THREE.LineSegments(geo, mat);
      this.lines.frustumCulled = false;

      // 前景：同心圆条纹切出文字
      this.textU = {
        uMask: { value: textMask('SONIC FIELD') }, uTime: { value: 0 }, uFade: { value: 0 },
        uMid: { value: 0 }, uSlice: { value: 0 }, uDensity: { value: 60 },
      };
      const tmat = new THREE.ShaderMaterial({
        uniforms: this.textU,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `
          uniform sampler2D uMask; uniform float uTime, uFade, uMid, uSlice, uDensity; varying vec2 vUv;
          void main(){
            vec2 p = (vUv - vec2(.5, -.6)) * vec2(4.0, 1.0);
            float r = length(p);
            float m = texture2D(uMask, vUv).r;
            // 文字内部的同心圆被径向推开，文字靠条纹的错位显现
            float shift = m * (0.5 + uMid*1.5 + uSlice) * 0.09 * (fract(vUv.x*7.0) > .5 ? 1. : -.6);
            float stripe = step(0.62, fract((r + shift) * uDensity - uTime*0.4));
            if (stripe < 0.5 || uFade < 0.02) discard;
            float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
            if (fract(r*3.0+vUv.y) > edge*uFade*1.05) discard;
            gl_FragColor = vec4(1.0);
          }`,
        side: THREE.DoubleSide,
      });
      this.textPlane = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), tmat);
      this.textPlane.position.set(0, 0, 1.2);
      this.group = new THREE.Group();
      this.group.add(this.lines, this.textPlane);
      this._scroll = 0;
      this._slice = 0;
    }
    setText(s) {
      this.textU.uMask.value.dispose();
      this.textU.uMask.value = textMask(s || ' ');
    }
    update(f, t, dt, m) {
      const u = this.u;
      this._scroll += dt * (f.bpm / 60) * 0.42 * (0.5 + f.energyFast * 2);
      if (f.onsetFired) this._slice = 1;
      this._slice *= Math.exp(-dt * 6);
      u.uTime.value = t; u.uLow.value = f.low * m.zDepth; u.uMid.value = f.mid; u.uOnset.value = f.onset;
      u.uScroll.value = this._scroll; u.uSlice.value = this._slice;
      const tu = this.textU;
      tu.uTime.value = t; tu.uMid.value = f.mid; tu.uSlice.value = this._slice;
      tu.uDensity.value = 40 + f.centroid * 50;
    }
  }

  /* ———————————————— D 笔触流 ———————————————— */
  class StrokeFlow {
    constructor() {
      this.name = 'D 笔触流 Stroke Flow';
      this.S = 150; this.P = 40;
      const S = this.S, P = this.P;
      this.pts = new Float32Array(S * P * 3);
      this.age = new Float32Array(S);
      this.life = new Float32Array(S);
      this.wid = new Float32Array(S);
      for (let s = 0; s < S; s++) this._reset(s, true);
      const nV = S * P * 2;
      const idx = [];
      for (let s = 0; s < S; s++) for (let i = 0; i < P - 1; i++) {
        const a = (s * P + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const mk = (color, offset) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
        g.setIndex(idx);
        const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        if (offset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -4; }
        const mesh = new THREE.Mesh(g, mat);
        mesh.frustumCulled = false;
        return mesh;
      };
      // 白色宽带在下，黑色窄带在上 → 黑笔触带白描边（参考图 3）
      this.outer = mk(0xffffff, false);
      this.inner = mk(0x000000, true);
      this.group = new THREE.Group();
      this.group.add(this.outer, this.inner);
      this._fade = 0;
      this._t = new THREE.Vector3(); this._v = new THREE.Vector3(); this._side = new THREE.Vector3();
    }
    _reset(s, scatter) {
      const P = this.P, b = s * P * 3;
      const x = (Math.random() - 0.5) * 12 - 3, y = (Math.random() - 0.5) * 8 - 2, z = (Math.random() - 0.5) * 6 - 2;
      for (let i = 0; i < P; i++) { this.pts[b + i * 3] = x; this.pts[b + i * 3 + 1] = y; this.pts[b + i * 3 + 2] = z; }
      this.age[s] = scatter ? -Math.random() * 3 : 0;
      this.life[s] = 3 + Math.random() * 4;
      this.wid[s] = 0.5 + Math.random();
    }
    update(f, t, dt, m, renderer, camera) {
      const S = this.S, P = this.P, pts = this.pts;
      const speed = (0.6 + f.mid * 4 + f.onset * 2) * dt;
      const turb = 0.4 + f.flatness * 1.6 * m.chaos;
      for (let s = 0; s < S; s++) {
        this.age[s] += dt;
        const b = s * P * 3;
        if (this.age[s] < 0) continue;
        // 头部沿流场前进，身体跟随（移位）
        pts.copyWithin(b + 3, b, b + (P - 1) * 3);
        const x = pts[b], y = pts[b + 1], z = pts[b + 2];
        const vx = 1.0 + Math.sin(y * 0.6 + t * 0.3) * turb + Math.cos(z * 0.5 + t * 0.2) * 0.4;
        const vy = 0.8 + Math.cos(x * 0.5 - t * 0.25) * turb;
        const vz = Math.sin(x * 0.4 + y * 0.3 + t * 0.4) * turb * (0.5 + f.low * m.zDepth * 2);
        pts[b] = x + vx * speed; pts[b + 1] = y + vy * speed; pts[b + 2] = z + vz * speed;
        if (this.age[s] > this.life[s] || Math.abs(pts[b]) > 9 || Math.abs(pts[b + 1]) > 7) this._reset(s, false);
      }
      // 生成面向相机的带状几何
      const baseW = (0.05 + (1 - f.centroid) * 0.1 + f.rms * 0.06) * this._fade;
      const oP = this.outer.geometry.attributes.position.array, iP = this.inner.geometry.attributes.position.array;
      const T = this._t, V = this._v, Sd = this._side, cam = camera.position;
      for (let s = 0; s < S; s++) {
        const b = s * P * 3;
        const alive = this.age[s] > 0 ? Math.min(1, this.age[s] * 2, (this.life[s] - this.age[s]) * 2) : 0;
        for (let i = 0; i < P; i++) {
          const k = b + i * 3, k2 = b + Math.min(i + 1, P - 1) * 3, k0 = b + Math.max(i - 1, 0) * 3;
          T.set(pts[k0] - pts[k2], pts[k0 + 1] - pts[k2 + 1], pts[k0 + 2] - pts[k2 + 2]);
          V.set(cam.x - pts[k], cam.y - pts[k + 1], cam.z - pts[k + 2]);
          Sd.crossVectors(T, V).normalize();
          const u = i / (P - 1);
          const taper = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.35);
          const w = baseW * this.wid[s] * taper * alive;
          const wo = w + 0.03 * alive * this._fade;
          const o = (s * P + i) * 6;
          for (let e = 0; e < 2; e++) {
            const sg = e ? -1 : 1;
            oP[o + e * 3] = pts[k] + Sd.x * wo * sg; oP[o + e * 3 + 1] = pts[k + 1] + Sd.y * wo * sg; oP[o + e * 3 + 2] = pts[k + 2] + Sd.z * wo * sg;
            iP[o + e * 3] = pts[k] + Sd.x * w * sg; iP[o + e * 3 + 1] = pts[k + 1] + Sd.y * w * sg; iP[o + e * 3 + 2] = pts[k + 2] + Sd.z * w * sg;
          }
        }
      }
      this.outer.geometry.attributes.position.needsUpdate = true;
      this.inner.geometry.attributes.position.needsUpdate = true;
    }
    setFade(v) { this._fade = v; }
  }

  /* ———————————————— E 涂鸦巢 ———————————————— */
  class ScribbleNest {
    constructor() {
      this.name = 'E 涂鸦巢 Scribble Nest';
      this.W = 64; this.L = 420;
      const W = this.W, L = this.L;
      this.trail = new Float32Array(W * L * 3);
      this.head = new Int32Array(W);
      this.p = new Float32Array(W * 3);
      this.v = new Float32Array(W * 3);
      for (let w = 0; w < W; w++) {
        const a = Math.random() * 6.28, r = 2 + Math.random() * 3;
        this.p[w * 3] = Math.cos(a) * r * 1.6; this.p[w * 3 + 1] = Math.sin(a) * r * 0.8; this.p[w * 3 + 2] = (Math.random() - 0.5) * 3;
        for (let i = 0; i < L; i++) this.trail.set(this.p.subarray(w * 3, w * 3 + 3), (w * L + i) * 3);
      }
      this.lines = [];
      this.group = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
      for (let w = 0; w < W; w++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L * 3), 3));
        const line = new THREE.Line(g, mat);
        line.frustumCulled = false;
        this.lines.push(line);
        this.group.add(line);
      }
      // 中心黑球 + 白色外圈（背面渲染的放大球体）
      this.core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      this.rim = new THREE.Mesh(new THREE.SphereGeometry(0.54, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }));
      this.group.add(this.rim, this.core);
      this._fade = 0;
    }
    update(f, t, dt, m) {
      const W = this.W, L = this.L, p = this.p, v = this.v;
      const active = Math.round(18 + f.high * 46 * (0.6 + this._fade * 0.4));
      const jitter = 14 + f.high * 30 + f.flatness * 16 * m.chaos;
      const speed = 1.4 + f.rms * 2.6;
      const steps = 3;
      for (let w = 0; w < W; w++) {
        const line = this.lines[w];
        line.visible = w < active && this._fade > 0.02;
        if (!line.visible) continue;
        for (let st = 0; st < steps; st++) {
          const i3 = w * 3;
          const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
          const r = Math.hypot(x / 1.7, y, z * 1.3) + 1e-3;
          const target = 1.6 + f.low * 2.2 * m.zDepth; // 低频把巢撑开
          const pull = (target - r) * 5;
          v[i3] += ((Math.random() - 0.5) * jitter + (x / r) * pull - y * 0.3) * dt * 4;
          v[i3 + 1] += ((Math.random() - 0.5) * jitter + (y / r) * pull + x * 0.15) * dt * 4;
          v[i3 + 2] += ((Math.random() - 0.5) * jitter + (z / r) * pull) * dt * 4;
          const vl = Math.hypot(v[i3], v[i3 + 1], v[i3 + 2]);
          const k = vl > speed ? speed / vl : 1;
          v[i3] *= k * 0.9; v[i3 + 1] *= k * 0.9; v[i3 + 2] *= k * 0.9;
          p[i3] += v[i3] * dt / steps; p[i3 + 1] += v[i3 + 1] * dt / steps; p[i3 + 2] += v[i3 + 2] * dt / steps;
          this.head[w] = (this.head[w] + 1) % L;
          this.trail.set(p.subarray(i3, i3 + 3), (w * L + this.head[w]) * 3);
        }
        // 把环形缓冲按时间顺序拷贝到几何体
        const arr = line.geometry.attributes.position.array;
        const h = this.head[w] + 1, base = w * L * 3;
        arr.set(this.trail.subarray(base + h * 3, base + L * 3), 0);
        arr.set(this.trail.subarray(base, base + h * 3), (L - h) * 3);
        line.geometry.attributes.position.needsUpdate = true;
      }
      const s = (0.8 + f.low * 0.8 + f.onset * 0.3) * this._fade;
      this.core.scale.setScalar(Math.max(s, 1e-3));
      this.rim.scale.setScalar(Math.max(s, 1e-3));
      this.group.scale.setScalar(0.4 + this._fade * 0.6);
    }
    setFade(v) { this._fade = v; }
  }

  SF.HIST = HIST;
  SF.History = History;
  SF.SceneClasses = [GlyphField, HalftoneVolume, GrooveTunnel, StrokeFlow, ScribbleNest];
})();
