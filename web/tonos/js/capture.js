// ① 采集：电脑摄像头 + MediaPipe Pose Landmarker（浏览器端识别，画面不上传）。
// 模型和 WASM 放在仓库里；本地加载失败时再退到 CDN。识别后镜像坐标，并按质心最近邻分配稳定 ID。

const LOCAL = {
  bundle: './vendor/mediapipe/vision_bundle.mjs',
  loader: './vendor/mediapipe/wasm/vision_wasm_internal.js',
  binary: './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  model: './models/pose_landmarker_lite.task',
  label: '本地',
};
const CDN = {
  bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs',
  loader: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js',
  binary: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.wasm',
  model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  label: 'CDN',
};

export const POSE_LINKS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
];

const abs = (p) => new URL(p, location.href).href;

function centroidOf(lm) {
  let x = 0, y = 0, n = 0;
  for (const i of [11, 12, 23, 24, 0]) {
    const p = lm[i];
    if (p && (p.visibility ?? 1) > 0.4) { x += p.x; y += p.y; n++; }
  }
  if (!n) for (const p of lm) { x += p.x; y += p.y; n++; }
  return { x: x / n, y: y / n };
}

export class Capture {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.landmarker = null;
    this.on = false;
    this.status = '未开启';
    this.error = '';
    this.tracks = [];
    this.n = 0;
    this.lastVideoTime = -1;
    this.fps = 0;
    this.detectMs = 0;
    this.frames = 0;
    this.fpsT = 0;
    this.delegate = '';
    this.source = '';
  }

  async start(onStatus = () => {}) {
    const set = (s) => { this.status = s; onStatus(s); };
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('这个浏览器不支持摄像头（需要 https 或 localhost）');
    }
    set('请求摄像头权限…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.landmarker) {
      set('加载骨骼识别模型（约 17 MB，第一次稍慢）…');
      await this.loadPose();
    }
    this.on = true;
    set(`识别中 · ${this.delegate === 'GPU' ? 'GPU' : 'CPU'} · 模型来自${this.source}`);
  }

  async loadPose() {
    let lastErr = null;
    for (const src of [LOCAL, CDN]) {
      let vision;
      try {
        vision = await import(src.bundle.startsWith('http') ? src.bundle : abs(src.bundle));
      } catch (e) {
        lastErr = e;
        continue;
      }
      const fileset = { wasmLoaderPath: abs(src.loader), wasmBinaryPath: abs(src.binary) };
      for (const delegate of ['GPU', 'CPU']) {
        try {
          this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: abs(src.model), delegate },
            runningMode: 'VIDEO',
            numPoses: 4,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          this.delegate = delegate;
          this.source = src.label;
          return;
        } catch (e) {
          lastErr = e;
        }
      }
    }
    throw lastErr || new Error('骨骼识别模型加载失败');
  }

  stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.on = false;
    this.tracks = [];
    this.status = '已关闭';
  }

  // 每帧调用；视频没有新帧时直接返回
  detect(nowMs) {
    if (!this.on || !this.landmarker || this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = this.video.currentTime;
    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(this.video, nowMs);
    } catch (e) {
      this.error = e.message;
      return false;
    }
    this.detectMs = performance.now() - t0;
    const poses = (res.landmarks || []).map((lm) =>
      lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
    );
    this.track(poses, nowMs / 1000);
    this.frames++;
    if (nowMs / 1000 - this.fpsT >= 1) {
      this.fps = this.frames / (nowMs / 1000 - this.fpsT);
      this.frames = 0;
      this.fpsT = nowMs / 1000;
    }
    return true;
  }

  // 骨骼绑定：按质心最近邻把这一帧的骨架接到上一帧的 ID 上
  track(poses, now) {
    const cents = poses.map(centroidOf);
    const free = new Set(this.tracks.keys());
    const pairs = [];
    cents.forEach((c, pi) => {
      for (const ti of free) {
        const t = this.tracks[ti];
        pairs.push({ pi, ti, d: Math.hypot(c.x - t.cx, c.y - t.cy) });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedP = new Set();
    for (const { pi, ti, d } of pairs) {
      if (usedP.has(pi) || !free.has(ti) || d > 0.25) continue;
      usedP.add(pi);
      free.delete(ti);
      const t = this.tracks[ti];
      t.lm = poses[pi];
      t.cx = cents[pi].x;
      t.cy = cents[pi].y;
      t.lastSeen = now;
      t.stamp++;
    }
    poses.forEach((lm, pi) => {
      if (usedP.has(pi)) return;
      this.n++;
      this.tracks.push({ id: `P${this.n}`, src: 'cam', lm, cx: cents[pi].x, cy: cents[pi].y, lastSeen: now, stamp: 0 });
    });
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < 0.7);
  }

  // 只交出最近还看得到的人
  current(nowS) {
    return this.tracks.filter((t) => nowS - t.lastSeen < 0.35);
  }
}
