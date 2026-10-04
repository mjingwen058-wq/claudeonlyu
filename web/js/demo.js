/* 内置演示信号：一个 16 小节循环的小曲子，用来在没有麦克风时测试全部映射
 * 第 1–4 小节：只有和弦铺底（平稳、音调性 → CALM，网格类场景）
 * 第 5–8 小节：加入底鼓和镲片，第 8 小节有噪声上扫（能量上升 → BUILD）
 * 第 9–16 小节：全编制 + 军鼓 + 噪声（高能 → DROP）
 */
(function () {
  const SF = (window.SF = window.SF || {});
  const BPM = 124;
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class DemoSynth {
    constructor(ctx, out) {
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.8;
      this.bus.connect(out);
      this.bus.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.step = 0; // 16 分音符计数
      this.nextTime = 0;
      this.timer = null;
    }
    start() {
      this.nextTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this._schedule(), 25);
    }
    stop() {
      clearInterval(this.timer);
      this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => this.bus.disconnect(), 400);
    }
    _schedule() {
      const sixteenth = 60 / BPM / 4;
      while (this.nextTime < this.ctx.currentTime + 0.12) {
        this._play(this.step, this.nextTime, sixteenth);
        this.nextTime += sixteenth;
        this.step++;
      }
    }
    _play(step, t, dur16) {
      const bar = Math.floor(step / 16) % 16;
      const s = step % 16;
      const full = bar >= 8, build = bar >= 4;
      if (s === 0) this._pad(CHORDS[bar % 4], t, dur16 * 16, full ? 0.02 : 0.035);
      if (build && s % 4 === 0) this._kick(t);
      if (build && s % 2 === 0) this._hat(t, s % 4 === 2 ? 0.16 : 0.07);
      if (full && (s === 4 || s === 12)) this._snare(t);
      if (full && s % 4 === 3) this._hat(t, 0.05);
      if (bar === 7 && s === 0) this._riser(t, dur16 * 16);
      if (full && s === 0 && bar % 2 === 0) this._noiseWash(t, dur16 * 8);
    }
    _env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    _kick(t) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this._env(g, t, 0.003, 0.9, 0.35);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + 0.4);
    }
    _noiseHit(t, type, freq, q, peak, d) {
      const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.noise;
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      this._env(g, t, 0.002, peak, d);
      src.connect(f).connect(g).connect(this.bus);
      src.start(t, Math.random() * 0.5); src.stop(t + d + 0.05);
    }
    _hat(t, peak) { this._noiseHit(t, 'highpass', 7500, 0.7, peak, 0.05); }
    _snare(t) { this._noiseHit(t, 'bandpass', 1800, 0.8, 0.45, 0.18); }
    _noiseWash(t, d) { this._noiseHit(t, 'highpass', 3000, 0.3, 0.06, d); }
    _riser(t, d) {
      const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.noise; src.loop = true;
      f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(9000, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
      src.connect(f).connect(g).connect(this.bus);
      src.start(t); src.stop(t + d + 0.1);
    }
    _pad(notes, t, d, peak) {
      const f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.3);
      g.gain.setValueAtTime(peak, t + d - 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      f.connect(g).connect(this.bus);
      notes.forEach((n) => {
        [0, 7].forEach((det) => {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(n);
          o.detune.value = det - 3;
          o.connect(f); o.start(t); o.stop(t + d + 0.05);
        });
      });
    }
  }
  SF.DemoSynth = DemoSynth;
})();
