/* 声音分析引擎
 * 输入：麦克风 / 音频文件 / 内置演示信号
 * 输出：this.f 里的 10 个特征（见 docs/mapping.md）
 */
(function () {
  const SF = (window.SF = window.SF || {});
  const NB = 64; // 频谱分带数（对应画面 X 轴的列数）
  const ODF_RATE = 100; // 起音包络重采样率 Hz，用于 BPM 估计
  const ODF_LEN = 600; // 6 秒

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ema = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.mode = 'none';
      this.params = {
        gain: 1, // 输入增益（线性）
        onsetK: 1.6, // 起音阈值 = 均值 + K × 标准差
        gate: 0.08, // 静音门限（归一化 RMS）
        attack: 0.55, // 频带上升平滑
        release: 0.12, // 频带下降平滑
        bpmAuto: true,
        dropLow: 0.35, // DROP 需要的持续低频
        dropHigh: 0.14, // DROP 需要的持续高频
      };
      this.f = {
        rms: 0, low: 0, mid: 0, high: 0,
        centroid: 0, flatness: 0,
        flux: 0, onset: 0, onsetFired: false,
        bpm: 120, bpmConf: 0, phase: 0, beat: false, beatCount: 0, bar: 0, barStart: false,
        energyFast: 0, energyMid: 0, energySlow: 0,
        state: 'SILENT', stateTime: 0,
        bands: new Float32Array(NB),
        wave: new Float32Array(256),
      };
      this.listeners = {};
      // 收音诊断：原始输入电平（dBFS，未经增益）、设备名、音频引擎状态
      this.diag = { peakDb: -120, label: '', since: 0 };
      this._stateCand = 'SILENT';
      this._stateCandTime = 0;
      this._silence = 10;
      this._fluxHist = [];
      this._lastOnset = 0;
      this._odf = new Float32Array(ODF_LEN);
      this._odfAcc = 0;
      this._odfMax = 0;
      this._bpmTimer = 0;
      this._taps = [];
      this._time = 0;
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    emit(ev, d) { (this.listeners[ev] || []).forEach((fn) => fn(d)); }

    async ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.inputGain = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0;
        this.inputGain.connect(this.analyser);
        // Safari 等浏览器只处理连到输出端的音频链：接一个音量为 0 的出口，保证分析器一直有数据
        this.sink = this.ctx.createGain();
        this.sink.gain.value = 0;
        this.analyser.connect(this.sink);
        this.sink.connect(this.ctx.destination);
        const n = this.analyser.frequencyBinCount;
        this.freqDb = new Float32Array(n);
        this.mag = new Float32Array(n);
        this.prevLog = new Float32Array(n);
        this.timeData = new Float32Array(this.analyser.fftSize);
        this._buildBands();
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.inputGain.gain.value = this.params.gain;
    }

    _buildBands() {
      const sr = this.ctx.sampleRate;
      const n = this.analyser.frequencyBinCount;
      const binHz = sr / this.analyser.fftSize;
      const fMin = 30, fMax = 16000;
      this.bandLo = new Int32Array(NB);
      this.bandHi = new Int32Array(NB);
      this.bandFc = new Float32Array(NB);
      this.bandTilt = new Float32Array(NB);
      for (let i = 0; i < NB; i++) {
        const f0 = fMin * Math.pow(fMax / fMin, i / NB);
        const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / NB);
        let lo = Math.floor(f0 / binHz), hi = Math.ceil(f1 / binHz);
        lo = clamp(lo, 1, n - 1); hi = clamp(Math.max(hi, lo + 1), 2, n);
        this.bandLo[i] = lo; this.bandHi[i] = hi;
        this.bandFc[i] = Math.sqrt(f0 * f1);
        // 1kHz 以上每倍频程 +3dB 补偿，让高频在画面上不至于总是很弱（低频不衰减）
        this.bandTilt[i] = Math.max(0, 3 * Math.log2(this.bandFc[i] / 1000));
      }
      this.binHz = binHz;
    }

    setGain(g) { this.params.gain = g; if (this.inputGain) this.inputGain.gain.value = g; }

    stop() {
      if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.mediaEl) { this.mediaEl.pause(); this.mediaEl.src = ''; this.mediaEl = null; }
      if (this.demo) { this.demo.stop(); this.demo = null; }
      this.mode = 'none';
      this.emit('source', this.mode);
    }

    async listInputs() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    }

    async useMic(deviceId) {
      await this.ensureCtx();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('这个浏览器环境不允许访问麦克风。请用 Chrome 打开本地的 web/index.html（见 README）。');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // VJ 场景要原始信号：关掉通话用的降噪、回声消除和自动增益
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stop();
      this.stream = stream;
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.inputGain);
      if (this.ctx.state !== 'running') await this.ctx.resume();
      const track = stream.getAudioTracks()[0];
      this.diag.label = track ? track.label : '';
      this.diag.since = performance.now();
      this.mode = 'mic';
      this.emit('source', this.mode);
    }

    async useFile(file) {
      await this.ensureCtx();
      this.stop();
      const el = new Audio();
      el.src = URL.createObjectURL(file);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      this.mediaEl = el;
      this.source = this.ctx.createMediaElementSource(el);
      this.source.connect(this.inputGain);
      this.source.connect(this.ctx.destination); // 监听
      await el.play();
      this.mode = 'file';
      this.emit('source', this.mode);
    }

    async useDemo() {
      await this.ensureCtx();
      this.stop();
      this.demo = new SF.DemoSynth(this.ctx, this.inputGain);
      this.demo.start();
      this.mode = 'demo';
      this.emit('source', this.mode);
    }

    /* 手动打拍：连续点 2 次以上即锁定 BPM，并把拍相位对齐到点击时刻 */
    tap() {
      const now = performance.now() / 1000;
      this._taps = this._taps.filter((t) => now - t < 3);
      this._taps.push(now);
      if (this._taps.length >= 2) {
        const iv = [];
        for (let i = 1; i < this._taps.length; i++) iv.push(this._taps[i] - this._taps[i - 1]);
        const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
        this.f.bpm = clamp(60 / avg, 50, 220);
        this.params.bpmAuto = false;
      }
      this.f.phase = Math.ceil(this.f.phase) - 0.0001; // 下一帧触发拍
    }

    update(dt) {
      const f = this.f;
      f.beat = false; f.barStart = false; f.onsetFired = false;
      this._time += dt;
      if (!this.ctx || this.mode === 'none') {
        // 无输入：所有特征衰减到 0，状态回到 SILENT
        for (let i = 0; i < NB; i++) f.bands[i] *= 0.9;
        f.rms *= 0.9; f.low *= 0.9; f.mid *= 0.9; f.high *= 0.9; f.onset *= 0.9;
        this._advanceBeat(dt, false);
        this._updateState(dt);
        return f;
      }
      const P0 = this.params;
      const an = this.analyser;
      an.getFloatFrequencyData(this.freqDb);
      an.getFloatTimeDomainData(this.timeData);
      const n = this.freqDb.length;

      // —— 能量：RMS ——
      let s = 0;
      const td = this.timeData;
      for (let i = 0; i < td.length; i++) s += td[i] * td[i];
      const rmsLin = Math.sqrt(s / td.length);
      let pk = 0;
      for (let i = 0; i < td.length; i++) pk = Math.max(pk, Math.abs(td[i]));
      const pkDb = 20 * Math.log10(pk / Math.max(P0.gain, 1e-3) + 1e-9);
      this.diag.peakDb = Math.max(pkDb, this.diag.peakDb - dt * 30); // 峰值保持，每秒回落 30dB
      const rmsN = clamp((20 * Math.log10(rmsLin + 1e-9) + 60) / 54);
      f.rms = ema(f.rms, rmsN, dt, rmsN > f.rms ? 0.03 : 0.12);

      // 波形（256 点降采样，给唱片隧道用）
      const step = td.length / 256;
      for (let i = 0; i < 256; i++) f.wave[i] = td[Math.floor(i * step)];

      // —— 线性幅度 ——
      for (let i = 0; i < n; i++) this.mag[i] = Math.pow(10, this.freqDb[i] / 20);

      // —— 频带：64 带对数分布 ——
      const P = this.params;
      for (let b = 0; b < NB; b++) {
        let acc = 0;
        const lo = this.bandLo[b], hi = this.bandHi[b];
        for (let i = lo; i < hi; i++) acc += this.mag[i] * this.mag[i];
        const db = 10 * Math.log10(acc / (hi - lo) + 1e-12) + this.bandTilt[b];
        const v = clamp((db + 85) / 60);
        const k = v > f.bands[b] ? P.attack : P.release;
        f.bands[b] += (v - f.bands[b]) * k;
      }
      const bandAvg = (fLo, fHi) => {
        let a = 0, c = 0;
        for (let b = 0; b < NB; b++) if (this.bandFc[b] >= fLo && this.bandFc[b] < fHi) { a += f.bands[b]; c++; }
        return c ? a / c : 0;
      };
      f.low = bandAvg(20, 150);
      f.mid = bandAvg(150, 2000);
      f.high = bandAvg(2000, 16000);

      // —— 音色：质心 + 平坦度 ——
      const binLo = Math.max(1, Math.floor(60 / this.binHz));
      const binHi = Math.min(n - 1, Math.ceil(10000 / this.binHz));
      let num = 0, den = 0, logSum = 0, cnt = 0;
      for (let i = binLo; i < binHi; i++) {
        const m = this.mag[i] + 1e-9;
        num += i * this.binHz * m; den += m;
        logSum += Math.log(m); cnt++;
      }
      const silent = rmsN < P.gate;
      const centroidHz = den > 0 ? num / den : 0;
      const cN = clamp((Math.log2(Math.max(centroidHz, 1)) - Math.log2(150)) / (Math.log2(8000) - Math.log2(150)));
      const flat = cnt ? Math.exp(logSum / cnt) / (den / cnt) : 0;
      // 平坦度原始值通常 0~0.5，拉伸到 0~1；静音时归零（底噪本身很“平”）
      const flatN = silent ? 0 : clamp(Math.pow(flat * 2.2, 0.8));
      f.centroid = ema(f.centroid, silent ? f.centroid : cN, dt, 0.1);
      f.flatness = ema(f.flatness, flatN, dt, 0.15);

      // —— 节奏：频谱通量 + 自适应阈值 ——
      let flux = 0;
      for (let i = binLo; i < binHi; i++) {
        const l = Math.log1p(100 * this.mag[i]);
        const d = l - this.prevLog[i];
        if (d > 0) flux += d;
        this.prevLog[i] = l;
      }
      flux /= cnt || 1;
      f.flux = flux;
      const H = this._fluxHist;
      H.push(flux); if (H.length > 45) H.shift();
      const mean = H.reduce((a, b) => a + b, 0) / H.length;
      const sd = Math.sqrt(H.reduce((a, b) => a + (b - mean) * (b - mean), 0) / H.length);
      const thr = mean + P.onsetK * sd + 0.004;
      if (!silent && flux > thr && this._time - this._lastOnset > 0.12) {
        this._lastOnset = this._time;
        f.onset = 1; f.onsetFired = true;
        this._onsetCount = (this._onsetCount || 0) + 1;
        this.emit('onset', flux);
      } else {
        f.onset *= Math.exp(-dt * 7);
      }

      // 起音包络 → 100Hz 缓冲，用于 BPM 自相关
      this._odfAcc += dt * ODF_RATE;
      const odfVal = Math.max(0, flux - mean);
      while (this._odfAcc >= 1) {
        this._odfAcc -= 1;
        this._odf.copyWithin(0, 1);
        this._odf[ODF_LEN - 1] = odfVal;
      }
      this._bpmTimer += dt;
      if (P.bpmAuto && this._bpmTimer > 1) { this._bpmTimer = 0; this._estimateBpm(); }

      this._advanceBeat(dt, f.onsetFired);
      this._updateState(dt);
      return f;
    }

    _estimateBpm() {
      const o = this._odf;
      let m = 0; for (let i = 0; i < ODF_LEN; i++) m += o[i]; m /= ODF_LEN;
      let zero = 0; for (let i = 0; i < ODF_LEN; i++) zero += (o[i] - m) * (o[i] - m);
      if (zero < 1e-8) return;
      let best = 0, bestLag = 0;
      const ac = [];
      for (let lag = 30; lag <= 90; lag++) { // 200 ~ 67 BPM
        let s = 0;
        for (let i = lag; i < ODF_LEN; i++) s += (o[i] - m) * (o[i - lag] - m);
        s /= zero;
        const bpm = 6000 / lag;
        const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.6, 2)); // 偏好 120 附近
        ac[lag] = s;
        if (s * w > best) { best = s * w; bestLag = lag; }
      }
      if (!bestLag || best < 0.08) { this.f.bpmConf *= 0.8; return; }
      // 抛物线插值求亚样本精度
      const a = ac[bestLag - 1] ?? ac[bestLag], b = ac[bestLag], c = ac[bestLag + 1] ?? ac[bestLag];
      const den = a - 2 * b + c;
      const off = den !== 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
      let bpm = 6000 / (bestLag + off);
      while (bpm < 80) bpm *= 2;
      while (bpm > 170) bpm /= 2;
      this.f.bpm += (bpm - this.f.bpm) * 0.35;
      this.f.bpmConf = best;
    }

    _advanceBeat(dt, onset) {
      const f = this.f;
      const prev = f.phase;
      f.phase += dt * f.bpm / 60;
      if (onset) {
        // 起音落在拍点附近时，把相位往拍点拉一点（简易锁相）
        const frac = f.phase - Math.floor(f.phase);
        const err = frac > 0.5 ? frac - 1 : frac;
        if (Math.abs(err) < 0.2) f.phase -= err * 0.35;
      }
      if (Math.floor(f.phase) > Math.floor(prev)) {
        f.beat = true;
        f.beatCount++;
        if (f.beatCount % 4 === 0) { f.bar++; f.barStart = true; }
        this.emit('beat', f.beatCount);
      }
    }

    /* 长时状态机：SILENT / CALM / BUILD / DROP，候选状态需持续 1.2 秒才提交
     * DROP  = 响 + 低频持续 + 高频持续（全频段铺满）
     * BUILD = 能量在上升，或者有律动但还没铺满
     * CALM  = 其他（铺底、人声、安静的段落） */
    _updateState(dt) {
      const f = this.f, P = this.params;
      f.energyFast = ema(f.energyFast, f.rms, dt, 1.5);
      f.energyMid = ema(f.energyMid, f.rms, dt, 6);
      f.energySlow = ema(f.energySlow, f.rms, dt, 20);
      this._lowSlow = ema(this._lowSlow || 0, f.low, dt, 2);
      this._highSlow = ema(this._highSlow || 0, f.high, dt, 2);
      this._onsetRate = ema(this._onsetRate || 0, (this._onsetCount || 0) / Math.max(dt, 1e-3), dt, 3);
      this._onsetCount = 0;
      f.onsetRate = this._onsetRate;
      this._silence = f.rms < P.gate ? this._silence + dt : 0;

      let cand;
      if (this._silence > 1.5) cand = 'SILENT';
      else if (f.energyFast > 0.45 && this._lowSlow > P.dropLow && this._highSlow > P.dropHigh) cand = 'DROP';
      else if ((f.energyFast > f.energyMid * 1.08 && f.energyFast > 0.2) || this._lowSlow > P.dropLow * 0.7 || this._onsetRate > 2.5) cand = 'BUILD';
      else cand = 'CALM';

      if (cand !== this._stateCand) { this._stateCand = cand; this._stateCandTime = 0; }
      else this._stateCandTime += dt;
      if (cand !== f.state && this._stateCandTime > 1.2) {
        f.state = cand; f.stateTime = 0;
        this.emit('state', cand);
      } else f.stateTime += dt;
    }
  }

  SF.NB = NB;
  SF.AudioEngine = AudioEngine;
})();
