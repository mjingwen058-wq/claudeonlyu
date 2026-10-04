/* 轴控制器：把声音特征映射到整个 3D 空间的 X / Y / Z 三个轴
 * 每个轴有 位移 / 旋转 / 缩放 三个控制位，共 9 个，每个控制位选一个声音来源和强度。
 * 所有场景都挂在 world 组下面，所以这里的变化对每个场景都生效。
 */
(function () {
  const SF = window.SF;

  const SOURCES = [
    ['none', '无'], ['rms', 'RMS 响度'], ['low', '低频'], ['mid', '中频'], ['high', '高频'],
    ['centroid', '亮度'], ['flatness', '噪声度'], ['onset', '起音'], ['beat', '节拍'], ['energy', '长时能量'],
  ];
  // 自动增益只作用在电平类特征上；亮度、起音、节拍本身就是 0~1 的相对量
  const AGC_KEYS = ['rms', 'low', 'mid', 'high', 'flatness', 'energy'];

  /* mode：
   *  swing   左右来回摆，幅度 = 声音 × range
   *  offset  直接偏移 = 声音 × range
   *  bipolar 以 0.5 为中心，正负 range
   *  accum   累加：节拍/起音每次触发加 range，连续量按每秒 range × 值 转动；每 8 拍换方向
   *  kick    冲击：值 × range，每次起音换方向
   *  scale   缩放 = base + 声音 × range
   */
  const SLOTS = [
    { id: 'px', axis: 'X', kind: '位移', src: 'mid', mode: 'swing', range: 2.2, unit: '' },
    { id: 'rx', axis: 'X', kind: '旋转', src: 'centroid', mode: 'bipolar', range: 35, unit: '°' },
    { id: 'sx', axis: 'X', kind: '缩放', src: 'mid', mode: 'scale', base: 0.8, range: 1.0, unit: '×' },
    { id: 'py', axis: 'Y', kind: '位移', src: 'low', mode: 'offset', range: 1.6, unit: '' },
    { id: 'ry', axis: 'Y', kind: '旋转', src: 'beat', mode: 'accum', range: 14, unit: '°' },
    { id: 'sy', axis: 'Y', kind: '缩放', src: 'rms', mode: 'scale', base: 0.6, range: 1.6, unit: '×' },
    { id: 'pz', axis: 'Z', kind: '位移', src: 'low', mode: 'offset', range: 2.0, unit: '' },
    { id: 'rz', axis: 'Z', kind: '旋转', src: 'onset', mode: 'kick', range: 22, unit: '°' },
    { id: 'sz', axis: 'Z', kind: '缩放', src: 'low', mode: 'scale', base: 0.5, range: 1.5, unit: '×' },
  ];
  SLOTS.forEach((s) => { s.amt = 1; s.value = s.mode === 'scale' ? s.base : 0; s.acc = 0; s.sign = 1; });

  const DEG = Math.PI / 180;
  const PIVOT_Z = -3.5; // 旋转中心：放在画面内容的中间，旋转时内容绕自身转而不是绕镜头转

  class AxisRig {
    constructor(scene) {
      this.world = new THREE.Group();
      this.world.rotation.order = 'YXZ';
      this.content = new THREE.Group();
      this.content.position.z = -PIVOT_Z;
      this.world.add(this.content);
      scene.add(this.world);
      this.slots = SLOTS;
      this.sources = SOURCES;
      this.agc = true;
      this.speed = 8; // 轴响应速度
      this.peaks = {};
      AGC_KEYS.forEach((k) => (this.peaks[k] = 0.1));
      this.t = 0;
      this.drive = {};
    }

    /* 读出一个声音来源的当前值（0~1），自动增益开时按最近约 8 秒峰值归一 */
    _read(f, src) {
      switch (src) {
        case 'none': return 0;
        case 'beat': return f.beat ? 1 : 0;
        case 'energy': return this._norm('energy', f.energyFast);
        case 'centroid': return f.centroid;
        case 'onset': return f.onset;
        default: return this._norm(src, f[src] || 0);
      }
    }
    _norm(k, v) {
      if (!this.agc) return Math.min(1, v);
      return Math.min(1, v / this.peaks[k]);
    }

    update(f, dt) {
      this.t += dt;
      // 更新峰值：快速跟上，8 秒衰减；下限防止静音时把底噪放大
      AGC_KEYS.forEach((k) => {
        const v = k === 'energy' ? f.energyFast : f[k] || 0;
        this.peaks[k] = Math.max(v, this.peaks[k] * Math.exp(-dt / 8), 0.08);
      });
      if (f.onsetFired) SLOTS.forEach((s) => { if (s.mode === 'kick') s.sign *= -1; });
      const dir = f.beatCount % 8 < 4 ? 1 : -1;

      SLOTS.forEach((s) => {
        const v = this._read(f, s.src) * s.amt;
        this.drive[s.id] = v;
        let target;
        switch (s.mode) {
          case 'swing': target = v * s.range * Math.sin(this.t * 1.7); break;
          case 'offset': target = v * s.range; break;
          case 'bipolar': target = (this._read(f, s.src) - 0.5) * 2 * s.range * s.amt; break;
          case 'kick': target = v * s.range * s.sign; break;
          case 'scale': target = s.base + v * s.range; break;
          case 'accum': {
            const discrete = s.src === 'beat' || s.src === 'onset';
            if (discrete) { if ((s.src === 'beat' ? f.beat : f.onsetFired)) s.acc += s.range * s.amt * dir; }
            else s.acc += v * s.range * dt * dir;
            target = s.acc;
            break;
          }
        }
        // 上升快、回落慢：底鼓的冲击感
        const k = 1 - Math.exp(-dt * (target > s.value ? this.speed * 2 : this.speed));
        s.value += (target - s.value) * k;
      });

      const g = (id) => SLOTS.find((s) => s.id === id).value;
      const w = this.world;
      w.position.set(g('px'), g('py'), PIVOT_Z + g('pz'));
      w.rotation.set(g('rx') * DEG, g('ry') * DEG, g('rz') * DEG);
      w.scale.set(Math.max(0.05, g('sx')), Math.max(0.05, g('sy')), Math.max(0.05, g('sz')));
      w.updateMatrixWorld(true);
    }
  }

  /* 左下角的 XYZ 坐标指示：三根轴线跟 world 一起转，长度表示该轴缩放 */
  class AxisGizmo {
    constructor(canvas, readout) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.readout = readout;
      this._v = new THREE.Vector3();
      this._acc = 0;
    }
    draw(rig, camera, dt) {
      const c = this.ctx, cv = this.cv;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, L = Math.min(W, H) * 0.3;
      const q = rig.world.quaternion, sc = rig.world.scale;
      const view = camera.matrixWorldInverse;
      c.lineWidth = 1.5;
      c.font = '500 11px "DM Mono", ui-monospace, Menlo, monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      [['X', [1, 0, 0], sc.x], ['Y', [0, 1, 0], sc.y], ['Z', [0, 0, 1], sc.z]].forEach(([name, a, s], i) => {
        const v = this._v.set(a[0], a[1], a[2]).applyQuaternion(q).transformDirection(view);
        const len = L * Math.min(2.2, s) / 1.2;
        const x = cx + v.x * len, y = cy - v.y * len;
        c.strokeStyle = '#f3f3ef';
        c.setLineDash(i === 0 ? [] : i === 1 ? [5, 3] : [1.5, 3]);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#000'; c.fillRect(x - 8, y - 8, 16, 16);
        c.strokeRect(x - 8, y - 8, 16, 16);
        c.fillStyle = '#f3f3ef'; c.fillText(name, x, y + 0.5);
      });
      // 读数节流到 10fps
      this._acc += dt;
      if (this._acc < 0.1) return;
      this._acc = 0;
      const val = (id) => rig.slots.find((s) => s.id === id).value;
      const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180; // 角度显示在 -180~180
      const fmt = (id, d) => { const v = val(id); return (id[0] === 'r' ? wrap(v) : v).toFixed(d); };
      this.readout.innerHTML = ['x', 'y', 'z'].map((a) =>
        `<span class="ax">${a.toUpperCase()}</span><span>${fmt('p' + a, 2)}</span><span>${fmt('r' + a, 0)}°</span><span>${fmt('s' + a, 2)}×</span>`).join('');
    }
  }

  SF.AxisRig = AxisRig;
  SF.AxisGizmo = AxisGizmo;
})();
