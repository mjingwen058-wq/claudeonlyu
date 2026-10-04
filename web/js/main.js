/* 主循环：声音特征 → 场景状态机 → 轴控制器（X/Y/Z）→ 后期 */
(function () {
  const SF = window.SF;
  const $ = (id) => document.getElementById(id);

  const canvas = $('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const audio = new SF.AudioEngine();
  const hist = new SF.History();
  const post = new SF.Post(renderer);
  const scenes = SF.SceneClasses.map((C) => new C(hist));
  const rig = new SF.AxisRig(scene);           // 所有场景挂在 rig.content 下，跟着 X/Y/Z 轴映射动
  scenes.forEach((s) => rig.content.add(s.group));
  const gizmo = new SF.AxisGizmo($('gizmo'), $('axis-readout'));
  SF.rig = rig;

  // —— 可调映射参数（UI 面板绑定这里）——
  const M = {
    zDepth: 1, chaos: 1, density: 0.5, rowsPerBeat: 8,
    edge: 0, feedback: 0.55, threshold: 0, invertOnOnset: true,
    auto: true, manual: 0,
  };
  SF.M = M;
  SF.audio = audio;
  SF.scenes = scenes;

  // —— 场景状态机：状态 + 噪声度 → 场景；只在小节线上切换 ——
  const weights = scenes.map(() => 0);
  let active = 0, lastSwitchBar = -99;
  function pickScene(f) {
    const noisy = f.flatness > 0.45;
    switch (f.state) {
      case 'SILENT': return 1;              // 半调体缓慢呼吸
      case 'CALM': return noisy ? 1 : 0;    // 音调性 → 字形场；噪声 → 半调体
      case 'BUILD': return 2;               // 唱片隧道
      case 'DROP': return noisy ? 4 : 3;    // 噪声 → 涂鸦巢；音调性 → 笔触流
    }
    return 0;
  }

  // —— 相机固定，空间的运动全部交给轴控制器（axes.js）——
  camera.position.set(0, 1.4, 9.5);
  camera.lookAt(0, 0, -3.5);
  const fx = { flash: 0 };
  const localCam = { position: new THREE.Vector3() };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now(), t = 0;
  function frame(now) {
    const realDt = Math.min(0.25, (now - last) / 1000); // 声音分析用真实时间，保证 BPM 准确
    const dt = Math.min(0.05, realDt);                   // 画面动画限幅，卡顿时不跳帧
    last = now; t += dt;
    const f = audio.update(realDt);
    hist.update(f, realDt, M.rowsPerBeat);

    // 场景选择
    if (M.auto) {
      const want = pickScene(f);
      const canSwitch = f.barStart && f.bar - lastSwitchBar >= 2;
      const forced = f.state === 'SILENT' && want !== active; // 静音立即进入待机
      if (want !== active && (canSwitch || forced || lastSwitchBar < 0)) { active = want; lastSwitchBar = f.bar; }
    } else active = M.manual;

    rig.update(f, dt);
    // 笔触流要在场景自己的坐标系里朝向相机
    localCam.position.copy(camera.position);
    rig.content.worldToLocal(localCam.position);

    scenes.forEach((s, i) => {
      weights[i] += ((i === active ? 1 : 0) - weights[i]) * (1 - Math.exp(-dt * 3));
      const w = weights[i] < 0.004 ? 0 : weights[i];
      s.group.visible = w > 0;
      if (s.u) s.u.uFade.value = w;
      if (s.textU) s.textU.uFade.value = w;
      if (s.setFade) s.setFade(w);
      if (w > 0) s.update(f, t, dt, M, renderer, localCam);
    });

    // 后期
    if (f.onsetFired && f.state === 'DROP' && M.invertOnOnset && f.onset > 0.9 && f.low > 0.55) fx.flash = 1;
    fx.flash *= Math.exp(-dt * 14);
    post.u.uEdge.value = M.edge;
    post.u.uFeedback.value = M.feedback * (0.6 + f.energyFast * 0.5);
    post.u.uThreshold.value = M.threshold;
    post.u.uInvert.value = fx.flash > 0.5 ? 1 : 0;
    post.u.uDrift.value = 0.004 + f.low * 0.01;
    post.render(scene, camera);

    gizmo.draw(rig, camera, dt);
    SF.ui && SF.ui.tick(f, scenes[active], active);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  SF.setActive = (i) => { M.auto = false; M.manual = i; };
})();
