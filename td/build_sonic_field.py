# Sonic Field · TouchDesigner 一键搭建脚本（第 1 版：A 字形场）
#
# 用法（详见 td/README.md）：
#   1. 在 TD 的 /project1 里按 Tab，新建一个 DAT → Text
#   2. 把整个文件粘贴进这个 Text DAT
#   3. 在 Text DAT 上右键 → Run Script（或选中后按 Ctrl+R）
#   4. 会在 /project1/sonic_field 里生成整套网络，结果写在 sonic_field/build_log
#
# 网络结构（和你说的逻辑一致）：
#   audio_in (Audio Device In CHOP)
#     → features (Script CHOP：RMS / 64 带频谱 / 低中高 / 亮度 / 噪声度 / 起音 / BPM / 状态)
#     → instances (Script CHOP：64×48 个实例的 tx ty tz 和缩放，X=频率 Z=时间)
#     → geo_K / geo_M (Geometry COMP，里面是 Text SOP 'K' / 'M'，用 Instancing 读 instances)
#     → render (Render TOP) → trail (Feedback 拖影) → edge (描边，默认旁路) → threshold (二值化，默认旁路) → OUT
#     → window (Window COMP，全屏输出到投影或第二屏)

PARENT = '/project1'
NAME = 'sonic_field'

log = []


def setp(o, name, value):
    """安全地设置参数：参数名在你的 TD 版本里不存在时记一条日志，不中断搭建"""
    try:
        getattr(o.par, name).val = value
        return True
    except Exception as e:
        log.append('参数没设上：{}.{} = {!r}（{}）'.format(o.name, name, value, e))
        return False


def setexpr(o, name, expr):
    try:
        p = getattr(o.par, name)
        p.expr = expr
        p.mode = ParMode.EXPRESSION
        return True
    except Exception as e:
        log.append('表达式没设上：{}.{} = {}（{}）'.format(o.name, name, expr, e))
        return False


def place(o, x, y):
    o.nodeX = x * 200
    o.nodeY = -y * 150


FEATURES_CODE = r'''# features：声音分析（算法和网页原型 web/js/audio.js 一致）
# 可调参数在下面这几行，改完保存即可生效
GAIN = 1.0          # 输入增益（线性）
ONSET_K = 1.6       # 起音阈值 = 均值 + K × 标准差
GATE = 0.08         # 静音门限（归一化 RMS）
DROP_LOW = 0.35     # 高能状态需要的持续低频
DROP_HIGH = 0.14    # 高能状态需要的持续高频
BEAT_STEP_DEG = 4.0 # 每拍转镜角度

import numpy as np
import math
import time

N = 2048
NB = 64
S = {}


def _ema(cur, target, dt, tau):
    return cur + (target - cur) * (1 - math.exp(-dt / tau))


def _init(sr):
    S.clear()
    S['sr'] = sr
    S['buf'] = np.zeros(N)
    S['win'] = np.blackman(N)
    binhz = sr / N
    edges = 30.0 * (16000.0 / 30.0) ** (np.arange(NB + 1) / NB)
    lo = np.clip(np.floor(edges[:-1] / binhz).astype(int), 1, N // 2 - 1)
    hi = np.minimum(np.maximum(np.ceil(edges[1:] / binhz).astype(int), lo + 1), N // 2)
    fc = np.sqrt(edges[:-1] * edges[1:])
    S.update(binhz=binhz, lo=lo, hi=hi, fc=fc, tilt=np.maximum(0, 3 * np.log2(fc / 1000.0)),
             blo=max(1, int(60 / binhz)), bhi=min(N // 2, int(math.ceil(10000 / binhz))),
             prevlog=np.zeros(N // 2 + 1), bands=np.zeros(NB),
             rms=0.0, cen=0.0, flat=0.0, onset=0.0, fh=[], last_onset=-9.0, t=0.0,
             odf=np.zeros(600), odfacc=0.0, bpm=120.0, bpmtimer=0.0, phase=0.0, beats=0,
             eF=0.0, eM=0.0, eS=0.0, lowS=0.0, highS=0.0, orate=0.0, silence=10.0,
             state=0, cand=0, candt=0.0, ry=0.0, ryT=0.0, camz=10.0, last=time.perf_counter())


def _bpm():
    o = S['odf']
    m = o.mean()
    d = o - m
    zero = float((d * d).sum())
    if zero < 1e-10:
        return
    best, bestlag, ac = 0.0, 0, {}
    for lag in range(30, 91):
        s = float((d[lag:] * d[:-lag]).sum()) / zero
        bpm = 6000.0 / lag
        w = math.exp(-0.5 * (math.log2(bpm / 120.0) / 0.6) ** 2)
        ac[lag] = s
        if s * w > best:
            best, bestlag = s * w, lag
    if not bestlag or best < 0.08:
        return
    a, b, c = ac.get(bestlag - 1, ac[bestlag]), ac[bestlag], ac.get(bestlag + 1, ac[bestlag])
    den = a - 2 * b + c
    off = max(-0.5, min(0.5, 0.5 * (a - c) / den)) if den != 0 else 0.0
    bpm = 6000.0 / (bestlag + off)
    while bpm < 80:
        bpm *= 2
    while bpm > 170:
        bpm /= 2
    S['bpm'] += (bpm - S['bpm']) * 0.35


def onCook(scriptOp):
    scriptOp.clear()
    if not scriptOp.inputs or scriptOp.inputs[0].numChans == 0:
        return
    inp = scriptOp.inputs[0]
    sr = inp.rate
    if S.get('sr') != sr:
        _init(sr)
    now = time.perf_counter()
    dt = min(0.25, max(1e-3, now - S['last']))
    S['last'] = now
    S['t'] += dt

    x = inp.numpyArray().mean(axis=0) * GAIN
    n = len(x)
    if n >= N:
        S['buf'] = x[-N:].astype(float)
    elif n > 0:
        S['buf'] = np.roll(S['buf'], -n)
        S['buf'][-n:] = x
    buf = S['buf']

    # 能量
    rmslin = math.sqrt(float((buf[-1024:] ** 2).mean()))
    rmsn = min(1.0, max(0.0, (20 * math.log10(rmslin + 1e-9) + 60) / 54))
    S['rms'] = _ema(S['rms'], rmsn, dt, 0.03 if rmsn > S['rms'] else 0.12)

    # 频谱：64 带
    mag = np.abs(np.fft.rfft(buf * S['win'])) / N
    pw = mag * mag
    bands = S['bands']
    for b in range(NB):
        lo, hi = S['lo'][b], S['hi'][b]
        db = 10 * math.log10(float(pw[lo:hi].mean()) + 1e-12) + S['tilt'][b]
        v = min(1.0, max(0.0, (db + 85) / 60))
        bands[b] += (v - bands[b]) * (0.55 if v > bands[b] else 0.12)
    fc = S['fc']
    low = float(bands[(fc >= 20) & (fc < 150)].mean())
    mid = float(bands[(fc >= 150) & (fc < 2000)].mean())
    high = float(bands[(fc >= 2000) & (fc < 16000)].mean())

    # 音色
    blo, bhi = S['blo'], S['bhi']
    m = mag[blo:bhi] + 1e-9
    freqs = np.arange(blo, bhi) * S['binhz']
    silent = rmsn < GATE
    cen_hz = float((freqs * m).sum() / m.sum())
    cn = min(1.0, max(0.0, (math.log2(max(cen_hz, 1)) - math.log2(150)) / (math.log2(8000) - math.log2(150))))
    flat = math.exp(float(np.log(m).mean())) / float(m.mean())
    flatn = 0.0 if silent else min(1.0, (flat * 2.2) ** 0.8)
    if not silent:
        S['cen'] = _ema(S['cen'], cn, dt, 0.1)
    S['flat'] = _ema(S['flat'], flatn, dt, 0.15)

    # 起音
    lg = np.log1p(100 * mag)
    flux = float(np.maximum(0, lg[blo:bhi] - S['prevlog'][blo:bhi]).mean())
    S['prevlog'] = lg
    fh = S['fh']
    fh.append(flux)
    if len(fh) > 45:
        fh.pop(0)
    mean = sum(fh) / len(fh)
    sd = math.sqrt(sum((v - mean) ** 2 for v in fh) / len(fh))
    fired = 0
    if not silent and flux > mean + ONSET_K * sd + 0.004 and S['t'] - S['last_onset'] > 0.12:
        S['last_onset'] = S['t']
        S['onset'] = 1.0
        fired = 1
    else:
        S['onset'] *= math.exp(-dt * 7)

    # BPM
    S['odfacc'] += dt * 100
    while S['odfacc'] >= 1:
        S['odfacc'] -= 1
        S['odf'] = np.roll(S['odf'], -1)
        S['odf'][-1] = max(0.0, flux - mean)
    S['bpmtimer'] += dt
    if S['bpmtimer'] > 1:
        S['bpmtimer'] = 0
        _bpm()
    prev = S['phase']
    S['phase'] += dt * S['bpm'] / 60
    if fired:
        fr = S['phase'] - math.floor(S['phase'])
        err = fr - 1 if fr > 0.5 else fr
        if abs(err) < 0.2:
            S['phase'] -= err * 0.35
    beat = 1 if math.floor(S['phase']) > math.floor(prev) else 0
    if beat:
        S['beats'] += 1

    # 状态机：0 静默 1 平稳 2 上升 3 高能
    S['eF'] = _ema(S['eF'], S['rms'], dt, 1.5)
    S['eM'] = _ema(S['eM'], S['rms'], dt, 6)
    S['eS'] = _ema(S['eS'], S['rms'], dt, 20)
    S['lowS'] = _ema(S['lowS'], low, dt, 2)
    S['highS'] = _ema(S['highS'], high, dt, 2)
    S['orate'] = _ema(S['orate'], fired / dt, dt, 3)
    S['silence'] = S['silence'] + dt if S['rms'] < GATE else 0
    if S['silence'] > 1.5:
        cand = 0
    elif S['eF'] > 0.45 and S['lowS'] > DROP_LOW and S['highS'] > DROP_HIGH:
        cand = 3
    elif (S['eF'] > S['eM'] * 1.08 and S['eF'] > 0.2) or S['lowS'] > DROP_LOW * 0.7 or S['orate'] > 2.5:
        cand = 2
    else:
        cand = 1
    if cand != S['cand']:
        S['cand'], S['candt'] = cand, 0.0
    else:
        S['candt'] += dt
    if cand != S['state'] and S['candt'] > 1.2:
        S['state'] = cand

    # 相机：每拍转一步，每 8 拍换方向；低频推近
    if beat:
        S['ryT'] += BEAT_STEP_DEG * (1 + low) * (1 if S['beats'] % 8 < 4 else -1)
    S['ry'] += (S['ryT'] - S['ry']) * (1 - math.exp(-dt * 6))
    S['camz'] += (10.5 - low * 2.2 - S['eF'] * 1.5 - S['camz']) * (1 - math.exp(-dt * 8))

    out = [('rms', S['rms']), ('low', low), ('mid', mid), ('high', high),
           ('centroid', S['cen']), ('flatness', S['flat']), ('onset', S['onset']),
           ('bpm', S['bpm']), ('phase', S['phase'] % 1), ('beat', beat),
           ('energy', S['eF']), ('state', S['state']), ('cam_ry', S['ry']), ('cam_tz', S['camz'])]
    out += [('b%02d' % i, float(bands[i])) for i in range(NB)]
    scriptOp.numSamples = 1
    for name, v in out:
        c = scriptOp.appendChan(name)
        c[0] = float(v)
    return


def onSetupParameters(scriptOp):
    return


def onPulse(par):
    return
'''

INSTANCES_CODE = r'''# instances：把声音特征变成 64×48 个字形实例
# X = 频带（低→高），Z = 时间（每拍推入 ROWS_PER_BEAT 行，越深越旧），Y 和缩放 = 幅度
ROWS_PER_BEAT = 8
Z_DEPTH = 1.0       # Z 向冲击和纵深
CHAOS = 1.0         # 噪声度把网格打散的程度
DENSITY = 0.5       # 密度偏置
GLYPH_SCALE = 0.34  # 字形大小（Text SOP 的字太大/太小就改这里）

import numpy as np
import math
import time

NB = 64
ROWS = 48
H = {}


def _init():
    H['amp'] = np.zeros((ROWS, NB))
    H['cen'] = np.zeros((ROWS, NB))
    H['ons'] = np.zeros((ROWS, NB))
    H['acc'] = 0.0
    H['t'] = 0.0
    H['last'] = time.perf_counter()
    rng = np.random.default_rng(7)
    H['rnd'] = rng.random((ROWS, NB))
    j, i = np.mgrid[0:ROWS, 0:NB]
    H['i'] = i.astype(float)
    H['j'] = j.astype(float)


def onCook(scriptOp):
    scriptOp.clear()
    if not H:
        _init()
    if not scriptOp.inputs or scriptOp.inputs[0].numChans == 0:
        return
    f = scriptOp.inputs[0]
    g = lambda n: float(f[n][0]) if f[n] is not None else 0.0
    now = time.perf_counter()
    dt = min(0.25, max(1e-3, now - H['last']))
    H['last'] = now
    H['t'] += dt
    t = H['t']

    bands = np.array([g('b%02d' % i) for i in range(NB)])
    H['acc'] += dt * g('bpm') / 60.0 * ROWS_PER_BEAT
    while H['acc'] >= 1:
        H['acc'] -= 1
        for k in ('amp', 'cen', 'ons'):
            H[k] = np.roll(H[k], 1, axis=0)
        H['amp'][0] = bands
        H['cen'][0] = g('centroid')
        H['ons'][0] = g('onset')

    a, r, i, j = H['amp'], H['rnd'], H['i'], H['j']
    low, high = g('low') * Z_DEPTH, g('high')
    chaos = g('flatness') ** 1.5 * CHAOS
    density = min(1.0, 0.25 + g('rms') * 0.9 + DENSITY - 0.5)
    depth = 0.7 + g('energy') * Z_DEPTH

    on = (a + r * 0.25) >= (1 - density)
    size = (0.18 + a * 0.95) * on
    flick = (np.mod(r * 91.7 + t * 6.0, 1.0) > 0.82)
    size = size * (1 - high * flick)

    tx = (i - 31.5) * 0.30 + chaos * 2.0 * np.sin(r * 40 + t * 1.3 + j * 0.2)
    ty = a * a * 2.6 - 0.9 + low * 0.6 * np.exp(-j * 0.2) * np.sin(i * 0.4) + chaos * 2.0 * np.cos(r * 33 + t * 1.1 + i * 0.1)
    tz = -j * 0.32 * depth + 7.0 + low * 2.2 * np.exp(-j * 0.12) + chaos * 2.0 * np.sin(r * 17 + t * 0.7)
    # 亮度高 → K，低 → M；起音时随机洗牌
    isk = ((H['cen'] + (r - 0.5) * 0.3 + H['ons'] * (r > 0.5) * 0.6) > 0.45).astype(float)
    sk = size * isk * GLYPH_SCALE
    sm = size * (1 - isk) * GLYPH_SCALE

    scriptOp.numSamples = ROWS * NB
    for name, arr in (('tx', tx), ('ty', ty), ('tz', tz), ('sk', sk), ('sm', sm)):
        c = scriptOp.appendChan(name)
        flat = np.ascontiguousarray(arr.reshape(-1), dtype=np.float32)
        try:
            c.copyNumpyArray(flat)
        except Exception:
            c.vals = flat.tolist()
    return


def onSetupParameters(scriptOp):
    return


def onPulse(par):
    return
'''

README_TEXT = '''Sonic Field（第 1 版：A 字形场）

看哪里：
  OUT          最终画面（点它，打开右下角的预览，或者按 1 看大图）
  features     声音特征（中键点开可以看每个通道的数值）
  window       全屏输出：参数里点 Open 打开窗口

换麦克风：点 audio_in，在参数面板的 Device 里选外接麦克风或声卡。
调参数：打开 features_code 和 instances_code，改文件开头的几个大写变量。
描边/二值化：点 edge 或 threshold，把节点左上角的旁路（Bypass）关掉。
'''


def build():
    root = op(PARENT)
    if root is None:
        raise Exception('找不到 {}，请把 PARENT 改成你工程里存在的路径'.format(PARENT))
    old = root.op(NAME)
    if old is not None:
        old.destroy()
    base = root.create(baseCOMP, NAME)
    base.nodeX, base.nodeY = 0, -400

    readme = base.create(textDAT, 'README')
    readme.text = README_TEXT
    place(readme, 0, -2)

    # —— 声音 ——
    ain = base.create(audiodeviceinCHOP, 'audio_in')
    place(ain, 0, 0)

    fcode = base.create(textDAT, 'features_code')
    fcode.text = FEATURES_CODE
    place(fcode, 1, -1)
    feats = base.create(scriptCHOP, 'features')
    setp(feats, 'callbacks', fcode)
    feats.inputConnectors[0].connect(ain)
    place(feats, 1, 0)

    icode = base.create(textDAT, 'instances_code')
    icode.text = INSTANCES_CODE
    place(icode, 2, -1)
    inst = base.create(scriptCHOP, 'instances')
    setp(inst, 'callbacks', icode)
    inst.inputConnectors[0].connect(feats)
    place(inst, 2, 0)

    # —— 几何：Text SOP → Geometry COMP（实例化）——
    mat = base.create(constantMAT, 'white')
    setp(mat, 'colorr', 1); setp(mat, 'colorg', 1); setp(mat, 'colorb', 1)
    place(mat, 3, -1)

    for k, (letter, chan) in enumerate((('K', 'sk'), ('M', 'sm'))):
        geo = base.create(geometryCOMP, 'geo_' + letter)
        for child in list(geo.children):
            child.destroy()
        txt = geo.create(textSOP, 'glyph')
        setp(txt, 'text', letter)
        setp(txt, 'alignx', 'center')
        setp(txt, 'aligny', 'center')
        txt.render = True
        txt.display = True
        setp(geo, 'instancing', True)
        setp(geo, 'instanceop', inst)
        setp(geo, 'instancetx', 'tx')
        setp(geo, 'instancety', 'ty')
        setp(geo, 'instancetz', 'tz')
        setp(geo, 'instancesx', chan)
        setp(geo, 'instancesy', chan)
        setp(geo, 'instancesz', chan)
        setp(geo, 'material', mat)
        setexpr(geo, 'ry', "op('features')['cam_ry']")
        place(geo, 3, k)

    cam = base.create(cameraCOMP, 'cam')
    setp(cam, 'ty', 2.0)
    setp(cam, 'rx', -8.0)
    setexpr(cam, 'tz', "op('features')['cam_tz']")
    place(cam, 3, 2)

    # —— 渲染和后期 ——
    render = base.create(renderTOP, 'render')
    setp(render, 'camera', cam)
    setp(render, 'geometry', 'geo_*')
    setp(render, 'outputresolution', 'custom')
    setp(render, 'resolutionw', 1920)
    setp(render, 'resolutionh', 1080)
    setp(render, 'bgcolora', 1)
    setp(render, 'antialias', 'aa4x')
    place(render, 4, 0)

    # 拖影：trail = max(当前帧, 上一帧 × 衰减)
    fb = base.create(feedbackTOP, 'fb')
    fb.inputConnectors[0].connect(render)
    place(fb, 5, 1)
    trail = base.create(compositeTOP, 'trail')
    trail.inputConnectors[0].connect(render)
    trail.inputConnectors[1].connect(fb)
    setp(trail, 'operand', 'maximum')
    place(trail, 5, 0)
    decay = base.create(levelTOP, 'decay')
    decay.inputConnectors[0].connect(trail)
    if not setp(decay, 'brightness1', 0.55):
        setp(decay, 'brightness', 0.55)
    place(decay, 6, 1)
    setp(fb, 'top', decay)

    edge = base.create(edgeTOP, 'edge')
    edge.inputConnectors[0].connect(trail)
    edge.bypass = True
    place(edge, 6, 0)
    thr = base.create(thresholdTOP, 'threshold')
    thr.inputConnectors[0].connect(edge)
    thr.bypass = True
    place(thr, 7, 0)
    out = base.create(nullTOP, 'OUT')
    out.inputConnectors[0].connect(thr)
    out.viewer = True
    place(out, 8, 0)

    win = base.create(windowCOMP, 'window')
    setp(win, 'winop', out)
    place(win, 8, 1)

    status = base.create(textDAT, 'build_log')
    status.text = '\n'.join(log) if log else '全部搭建成功，没有报错。'
    place(status, 0, -3)
    return base


try:
    b = build()
    print('Sonic Field 搭建完成：{}'.format(b.path))
    print('\n'.join(log) if log else '没有报错。')
except Exception as e:
    import traceback
    print('Sonic Field 搭建失败：', e)
    traceback.print_exc()
