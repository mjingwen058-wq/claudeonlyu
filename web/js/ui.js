/* 控制面板：输入源、实时特征表、场景、映射参数、后期、快捷键 */
(function () {
  const SF = window.SF;
  const $ = (id) => document.getElementById(id);
  const audio = SF.audio, M = SF.M;

  const FEATURES = [
    ['rms', 'RMS 响度', '密度 · 镜头距离'],
    ['low', 'Low 低频', 'Z 向冲击 · 撑开'],
    ['mid', 'Mid 中频', '流速 · 形变'],
    ['high', 'High 高频', '闪烁 · 抖动 · 线数'],
    ['centroid', 'Centroid 亮度', 'K↔M · 线宽'],
    ['flatness', 'Flatness 噪声度', '秩序 ↔ 混沌'],
    ['onset', 'Onset 起音', '洗牌 · 切片 · 闪白'],
    ['energyFast', 'Energy 长时能量', '状态机'],
  ];
  const meterBox = $('meters');
  const meterEls = {};
  FEATURES.forEach(([k, name, target]) => {
    const row = document.createElement('div');
    row.className = 'meter';
    row.innerHTML = `<span class="m-name">${name}</span><span class="m-bar"><i></i></span><span class="m-val">0.00</span><span class="m-target">${target}</span>`;
    meterBox.appendChild(row);
    meterEls[k] = { bar: row.querySelector('i'), val: row.querySelector('.m-val') };
  });

  const msg = (text, isErr) => {
    const el = $('msg');
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  };

  // —— 输入源 ——
  async function refreshDevices() {
    const sel = $('device');
    const list = await audio.listInputs().catch(() => []);
    const cur = sel.value;
    sel.innerHTML = '<option value="">系统默认麦克风</option>';
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `输入设备 ${i + 1}`;
      sel.appendChild(o);
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
  async function startMic() {
    try {
      await audio.useMic($('device').value);
      msg('麦克风已接入。外接麦克风或声卡在上面的下拉菜单里切换。');
      hideStart();
      refreshDevices();
    } catch (e) {
      const blocked = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      msg(blocked
        ? '麦克风被拒绝了。如果你是在 claude.ai 里打开的这个页面，那里不允许用麦克风；请在本地用 Chrome 打开 web/index.html（见 README）。现在可以先用演示信号或音频文件。'
        : `麦克风打不开：${e.message || e}`, true);
    }
  }
  async function startDemo() { await audio.useDemo(); msg('正在播放内置演示信号（16 小节循环：平稳 → 上升 → 高能）。'); hideStart(); }
  async function startFile(file) {
    if (!file) return;
    try { await audio.useFile(file); msg(`正在播放：${file.name}`); hideStart(); }
    catch (e) { msg(`这个文件播放不了：${e.message || e}`, true); }
  }
  function hideStart() { $('start').hidden = true; }

  $('btn-mic').onclick = startMic;
  $('start-mic').onclick = startMic;
  $('btn-demo').onclick = startDemo;
  $('start-demo').onclick = startDemo;
  $('file').onchange = (e) => startFile(e.target.files[0]);
  $('start-file').onchange = (e) => startFile(e.target.files[0]);
  $('btn-stop').onclick = () => { audio.stop(); msg('输入已停止。'); };
  $('device').onchange = () => { if (audio.mode === 'mic') startMic(); };
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }
  refreshDevices();

  // —— 滑杆绑定 ——
  function bindRange(id, get, set, fmt = (v) => v.toFixed(2)) {
    const el = $(id), out = $(id + '-v');
    el.value = get();
    const apply = () => { set(parseFloat(el.value)); if (out) out.textContent = fmt(parseFloat(el.value)); };
    el.addEventListener('input', apply);
    apply();
  }
  bindRange('gain', () => audio.params.gain, (v) => audio.setGain(v), (v) => `${(20 * Math.log10(v)).toFixed(1)} dB`);
  bindRange('onsetK', () => audio.params.onsetK, (v) => (audio.params.onsetK = v));
  bindRange('gate', () => audio.params.gate, (v) => (audio.params.gate = v));
  bindRange('dropLow', () => audio.params.dropLow, (v) => (audio.params.dropLow = v));
  bindRange('dropHigh', () => audio.params.dropHigh, (v) => (audio.params.dropHigh = v));
  bindRange('zDepth', () => M.zDepth, (v) => (M.zDepth = v));
  bindRange('chaos', () => M.chaos, (v) => (M.chaos = v));
  bindRange('density', () => M.density, (v) => (M.density = v));
  bindRange('rowsPerBeat', () => M.rowsPerBeat, (v) => (M.rowsPerBeat = v), (v) => `${v} 行/拍`);
  bindRange('edge', () => M.edge, (v) => (M.edge = v));
  bindRange('feedback', () => M.feedback, (v) => (M.feedback = v));
  bindRange('threshold', () => M.threshold, (v) => (M.threshold = v));
  // —— 轴映射：9 个控制位（X/Y/Z × 位移/旋转/缩放）——
  const rig = SF.rig;
  const slotBox = $('axis-slots');
  rig.slots.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'slot';
    const opts = rig.sources.map(([k, n]) => `<option value="${k}"${k === s.src ? ' selected' : ''}>${n}</option>`).join('');
    row.innerHTML = `<label for="src-${s.id}">${s.axis} ${s.kind}</label>` +
      `<select id="src-${s.id}" aria-label="${s.axis} 轴${s.kind}的声音来源">${opts}</select>` +
      `<input id="amt-${s.id}" type="range" min="0" max="2" step="0.05" value="${s.amt}" aria-label="${s.axis} 轴${s.kind}的强度">` +
      `<output id="amt-${s.id}-v">${s.amt.toFixed(2)}</output>`;
    slotBox.appendChild(row);
    row.querySelector('select').onchange = (e) => { s.src = e.target.value; s.acc = 0; };
    const r = row.querySelector('input'), o = row.querySelector('output');
    r.oninput = () => { s.amt = parseFloat(r.value); o.textContent = s.amt.toFixed(2); };
  });
  $('agc').onchange = (e) => (rig.agc = e.target.checked);
  bindRange('axisSpeed', () => rig.speed, (v) => (rig.speed = v), (v) => v.toFixed(1));

  $('invertOnOnset').checked = M.invertOnOnset;
  $('invertOnOnset').onchange = (e) => (M.invertOnOnset = e.target.checked);

  // —— 节拍 ——
  $('btn-tap').onclick = () => { audio.tap(); $('bpmAuto').checked = false; };
  $('bpmAuto').onchange = (e) => (audio.params.bpmAuto = e.target.checked);

  // —— 场景 ——
  const sceneBtns = [...document.querySelectorAll('[data-scene]')];
  sceneBtns.forEach((b) => (b.onclick = () => { SF.setActive(+b.dataset.scene); $('auto').checked = false; }));
  $('auto').onchange = (e) => (M.auto = e.target.checked);
  $('text').addEventListener('change', (e) => SF.scenes[2].setText(e.target.value.toUpperCase()));

  // —— 面板显隐 / 快捷键 ——
  const togglePanel = () => document.body.classList.toggle('panel-hidden');
  $('btn-panel').onclick = togglePanel;
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'h') togglePanel();
    else if (k === 't') $('btn-tap').click();
    else if (k === 'a') { M.auto = !M.auto; $('auto').checked = M.auto; }
    else if (k === 'f') {
      const el = document.documentElement;
      if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    } else if (k >= '1' && k <= '5') { SF.setActive(+k - 1); $('auto').checked = false; }
  });

  // —— 每帧刷新（节流到约 20fps）——
  let acc = 0, lastT = performance.now();
  const dots = [...document.querySelectorAll('#phase i')];
  const STATE_CN = { SILENT: '静默 SILENT', CALM: '平稳 CALM', BUILD: '上升 BUILD', DROP: '高能 DROP' };
  SF.ui = {
    tick(f, sc, idx) {
      const now = performance.now();
      acc += now - lastT; lastT = now;
      if (acc < 50) return;
      acc = 0;
      FEATURES.forEach(([k]) => {
        const v = Math.max(0, Math.min(1, f[k]));
        meterEls[k].bar.style.transform = `scaleX(${v})`;
        meterEls[k].val.textContent = v.toFixed(2);
      });
      $('bpm').textContent = f.bpm.toFixed(1);
      const b = f.beatCount % 4;
      dots.forEach((d, i) => d.classList.toggle('on', i === b));
      const st = $('state');
      st.textContent = STATE_CN[f.state];
      st.dataset.state = f.state;
      $('scene-name').textContent = sc.name;
      sceneBtns.forEach((btn, i) => btn.classList.toggle('on', i === idx));
      $('src').textContent = { none: '无输入', mic: '麦克风', file: '音频文件', demo: '演示信号' }[audio.mode];
    },
  };
})();
