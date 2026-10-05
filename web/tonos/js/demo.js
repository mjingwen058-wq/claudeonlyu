// 全流程自动演示：约 3 分钟，按剧本驱动模拟观众，每一步在对应面板上出字幕。

const STEPS = [
  { t: 0, panel: 'p-image', text: '空场：没有人时它也在动。图像在呼吸，声音在自语。演示开启了时间加速：真实 1 秒 = 展期 1 分钟。', run: (a) => { a.setSpeed(60); a.crowd.scenario('clear'); } },
  { t: 9, panel: 'p-capture', text: '① 一个人走近。骨骼被识别出来，绑定一个追踪 ID（S1），开始计停留时长。', run: (a) => a.crowd.scenario('approach') },
  { t: 19, panel: 'p-features', text: '② 骨骼不转成语义，而是压成 7 个扰动数值，每秒 30 次发给内核（/perturb）。' },
  { t: 29, panel: 'p-kernel', text: '③ 他贴近主屏：边界完整度被压低，唤醒带着起伏变化。变量是弹簧，不是按钮。' },
  { t: 39, panel: 'p-sound', text: '⑤ 声音最快：第一次察觉到人先响一声提示音（竖耳朵）；他一挥手，粒子撞上音符体就发声。' },
  { t: 51, panel: 'p-state', text: '多人聚集：唤醒或边界越过 0.70，状态机进入「收缩退避」，图像变红、往里收。', run: (a) => a.crowd.scenario('gather') },
  { t: 65, panel: 'p-mind', text: '④ 压力持续超阈，内核唤醒 LLM。它读到的不是谁说了什么，而是一份关于自己身体的报告。', run: (a) => { a.demoWakes = a.mind.wakes; } },
  { t: 72, run: (a) => { if (a.mind.wakes === a.demoWakes) a.mind.forceWake('pressure'); } },
  { t: 79, panel: 'p-tools', text: '④ 它只能调用受限的工具：新词每次最多 3 个，开口有冷却，设定点每次最多 ±0.15。超出的部分被截断。' },
  { t: 93, panel: 'p-lexicon', text: '⑤ 新词浮到上空；话语不念出来，而是变成每个词的动机，在节点之间接力奏出，对应的词同时亮起。' },
  { t: 105, panel: 'p-features', text: '多人同步举手：同步性推动唤醒（共振），合奏方式跟着内核状态变化。', run: (a) => a.crowd.scenario('sync') },
  { t: 127, panel: 'p-image', text: '人离开：声音散回自语，图像慢慢归于平静，但不是复位。', run: (a) => a.crowd.scenario('clear') },
  { t: 141, panel: 'p-learn', text: '学不到新东西时停滞上升，到阈值就自发突变，带着新节律回到静息。（演示里把停滞调快了。）', run: (a) => { a.kernel.stag = Math.max(a.kernel.stag, 0.66); } },
  { t: 158, panel: 'p-kernel', text: '闭馆：沉积累加，设定点逐日漂移，词条按天衰减，当天记忆压成摘要并存盘。', run: (a) => a.closeDay() },
  { t: 170, panel: 'p-image', text: '第 2 天开馆：平静的样子已经和昨天不同。演示结束，可以开摄像头自己试，或者点上方的模拟场景。' },
  { t: 184, end: true },
];

export class Demo {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.t = 0;
    this.i = 0;
    this.spot = null;
    this.total = STEPS.filter((s) => s.text).length;
    this.n = 0;
  }

  start() {
    this.on = true;
    this.t = 0;
    this.i = 0;
    this.n = 0;
    document.getElementById('caption').hidden = false;
  }

  stop() {
    this.on = false;
    document.getElementById('caption').hidden = true;
    if (this.spot) this.spot.classList.remove('spot');
    this.spot = null;
  }

  update(dt) {
    if (!this.on) return;
    this.t += dt;
    while (this.i < STEPS.length && STEPS[this.i].t <= this.t) {
      const s = STEPS[this.i++];
      if (s.end) { this.stop(); return; }
      if (s.run) s.run(this.app);
      if (s.text) {
        this.n++;
        document.getElementById('cap-n').textContent = `${this.n} / ${this.total}`;
        document.getElementById('cap-text').textContent = s.text;
      }
      if (s.panel) {
        if (this.spot) this.spot.classList.remove('spot');
        this.spot = document.getElementById(s.panel);
        if (this.spot) {
          this.spot.classList.add('spot');
          if (!document.body.classList.contains('expo')) this.spot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }
}
