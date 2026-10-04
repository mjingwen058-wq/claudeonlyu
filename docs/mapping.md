# 声音 → 图像 映射标准

浏览器原型（`web/`）和之后的 TouchDesigner 版共用这一套映射。改映射时先改这里，再改代码。

## 1. 声音分析：10 个特征，4 个层级

| 层级 | 特征 | 计算 | 平滑/时间尺度 | 代码 |
|---|---|---|---|---|
| 能量 | RMS 响度 | 时域均方根 → dB → 0~1（-60dB…-6dB） | 上升 30ms / 下降 120ms | `audio.js` `f.rms` |
| 频段 | 64 带频谱 | FFT 2048，30Hz–16kHz 对数分 64 带，1kHz 以上每倍频程 +3dB 补偿，-85…-25dB → 0~1 | 上升 0.55 / 下降 0.12（每帧系数） | `f.bands` |
| | Low 低频 | 20–150Hz 各带平均（底鼓、贝斯） | 同上 | `f.low` |
| | Mid 中频 | 150Hz–2kHz（人声、主体） | 同上 | `f.mid` |
| | High 高频 | 2k–16kHz（镲片、齿音、空气感） | 同上 | `f.high` |
| 音色/形态 | Centroid 亮度 | 频谱质心，150Hz–8kHz 对数映射到 0~1 | 100ms | `f.centroid` |
| | Flatness 噪声度 | 几何均值 / 算术均值（60Hz–10kHz），静音时归零 | 150ms | `f.flatness` |
| 节奏/时间 | Onset 起音 | 频谱通量（对数幅度正向差分），阈值 = 近 0.75 秒均值 + K×标准差，最短间隔 120ms | 触发后约 140ms 衰减 | `f.onset` `f.onsetFired` |
| | BPM / 拍相位 | 起音包络重采样到 100Hz，6 秒窗口自相关，偏好 120 附近，折叠到 80–170；起音落在拍点 ±0.2 拍内时校正相位。可手动打拍锁定 | 每秒更新 | `f.bpm` `f.phase` `f.beat` `f.barStart` |
| 状态 | 长时能量 + 状态机 | 能量 1.5s / 6s / 20s 三条包络；低频、高频 2 秒均值；起音率 | 候选状态持续 1.2s 才提交 | `f.state` |

### 状态机

| 状态 | 条件 | 画面 |
|---|---|---|
| SILENT 静默 | RMS 低于静音门限超过 1.5 秒 | 半调点阵缓慢呼吸（待机） |
| CALM 平稳 | 其他情况 | 音调性 → A 字形场；噪声 → B 半调体 |
| BUILD 上升 | 1.5s 能量 > 6s 能量 × 1.08，或低频均值 > DROP 低频阈值 × 0.7，或起音率 > 2.5 次/秒 | C 唱片隧道 |
| DROP 高能 | 1.5s 能量 > 0.45，且低频均值 > 0.35，且高频均值 > 0.14（全频段铺满） | 音调性 → D 笔触流；噪声 → E 涂鸦巢 |

“噪声”指 Flatness > 0.45。自动模式只在小节线（每 4 拍）上切场景，两次切换至少隔 2 小节；进入 SILENT 时立即切换。

## 2. 特征 → 画面

| 特征 | 控制什么 | 具体做法 |
|---|---|---|
| 64 带频谱 | **X 轴** | 第 i 列 = 第 i 个频带，从左到右是低频到高频 |
| 时间历史 | **Z 轴** | 每拍推入 N 行（默认 8 行/拍）到 64 行的历史纹理，越深越旧，形成 3D 瀑布 |
| 频带幅度 | **Y 轴 / 单元尺寸** | 幅度越大，字/点越大、越高 |
| Low | Z 向冲击 | 最新几行沿 Z 冲出、半调点阵沿 Z 挤出、隧道环扩张、涂鸦巢撑开、镜头推近 |
| Mid | 流动、形变 | 噪声场速度、笔触流速、隧道环的波形幅度、文字条纹错位 |
| High | 细节、闪烁 | 字形闪烁、圆点抖动、涂鸦线条数和抖动 |
| RMS | 全局密度 | 亮着的格子比例、笔触线宽 |
| Centroid | 字形和线宽 | 亮 → K、细线、密条纹；暗 → M、粗线 |
| Flatness | **秩序 ↔ 混沌** | 网格位移噪声、笔触湍流、涂鸦抖动；也参与选场景 |
| Onset | 事件 | 字形洗牌、隧道按扇区切开错位、高能段重拍反相闪白 |
| BPM / 相位 | 时间同步 | 历史滚动速度、隧道前进速度、镜头每拍转一步（每 8 拍换方向），DROP 时每小节大跳 |
| 状态 | 场景和参数 | 见状态机 |

## 3. 轴映射：整个 3D 空间的 X / Y / Z

所有场景都挂在一个 world 组下面。world 的每个轴有位移、旋转、缩放 3 个控制位，共 9 个。每个控制位可以在面板“轴映射”里换声音来源、调强度（0–2）。默认是：

| 轴 | 位移 | 旋转 | 缩放 |
|---|---|---|---|
| X | 中频 → 左右摆动，最大 ±2.2 | 亮度 → 俯仰，±35°（亮往上、暗往下） | 中频 → 横向拉伸 0.8–1.8× |
| Y | 低频 → 上弹，最大 1.6 | 节拍 → 每拍转 14°，每 8 拍换方向 | RMS → 高度拉伸 0.6–2.2× |
| Z | 低频 → 朝镜头冲出，最大 2.0 | 起音 → 翻滚（roll）±22°，每次起音换方向 | 低频 → 纵深拉伸 0.5–2.0× |

- **自动增益**（默认开）：RMS、低频、中频、高频、噪声度、长时能量都会除以各自最近约 8 秒的峰值，所以麦克风音量小也能把轴推满。关掉后用绝对电平。
- **轴响应速度**：数值越大跟得越紧。上升速度是回落的 2 倍，所以底鼓有“砸”的感觉。
- 旋转中心在画面内容的中间（z = -3.5），所以内容是绕自己转，不是绕镜头转。
- 左下角的 XYZ 指示：实线是 X、长虚线是 Y、点线是 Z。轴线跟 world 一起转，长度表示该轴的缩放；右边是三个轴实时的位移、旋转、缩放读数。

## 4. 五个场景

| 场景 | 参考 | 3D 结构 |
|---|---|---|
| A 字形场 Glyph Field | 图 1 K/M 字符矩阵 | 64×48 个面向相机的字形实例，X 频率 · Z 时间 · Y/尺寸 幅度 |
| B 半调体 Halftone Volume | 图 2 灰阶圆点 | 44×30×8 点阵，点径 = 噪声场 × 频谱，四级灰阶，低频沿 Z 挤出 |
| C 唱片隧道 Groove Tunnel | 图 4 同心圆切字 | 56 个波形环沿 Z 排成隧道 + 前景同心圆条纹切出文字 |
| D 笔触流 Stroke Flow | 图 3 粗描边笔触 | 150 条带状笔触在流场里走，白色宽带 + 黑色窄带 = 白描边黑笔触 |
| E 涂鸦巢 Scribble Nest | 图 5 乱线和黑点 | 最多 64 条随机游走线绕中心黑球，低频把巢撑开 |

后期统一：Sobel 描边、Feedback 拖影、二值化、反相闪白。全部只用黑白和灰阶。

## 5. 移植到 TouchDesigner：算子对应

按你说的结构（SOP → Geometry COMP 实例化 ← CHOP 分析 → 渲染 → 输出）：

| 网页原型 | TouchDesigner |
|---|---|
| 麦克风输入 `getUserMedia` | **Audio Device In CHOP**（外接声卡在 Device 里选） |
| FFT / 64 带 | **Audio Spectrum CHOP** → **Resample CHOP**（重采样到 64 个样本）或 Script CHOP 按对数分带 |
| Low / Mid / High | **Audio Filter CHOP**（低通/带通/高通）→ **Analyze CHOP**（RMS Power）→ **Lag CHOP** |
| RMS | **Analyze CHOP**（RMS Power）→ **Math CHOP**（换算到 0~1）→ **Lag CHOP** |
| Centroid / Flatness / Onset | **Script CHOP**（numpy，算法照抄 `audio.js`）；Onset 也可以用 **Slope CHOP** + **Trigger CHOP** |
| BPM / 拍 | **Beat CHOP** 或 **Timer CHOP**，配合手动 Tap |
| 历史纹理（X 频率 × Z 时间） | **Trail CHOP** 或 **CHOP to TOP** + **Cache TOP** |
| 状态机 | **Logic CHOP** / **Timer CHOP**，或者用 Script CHOP 输出状态编号 |
| A 字形场 | **Text SOP**（K、M 各一个）→ **Geometry COMP**，Instancing 读一个 CHOP 的 tx/ty/tz/scale 通道 |
| B 半调体 | **Sphere SOP**/**Circle SOP** → Geometry COMP，实例位置来自 **Noise CHOP/TOP** × 频谱 |
| C 唱片隧道 | **Circle SOP**（开放弧线）+ **CHOP to SOP** 写入波形 → **Copy SOP** 沿 Z 复制 |
| D 笔触流 | **Line SOP** + **Noise SOP** + **Trail SOP**，或 **Particle SOP/POP** 拖尾，线宽用 Line MAT |
| E 涂鸦巢 | **Noise CHOP** 驱动的点 → **Trail SOP** → 中心 **Sphere SOP** |
| 轴映射（world 的 9 个控制位） | 把所有 geo 放进一个父 **Geometry COMP** 或 **Null COMP**，它的 tx/ty/tz、rx/ry/rz、sx/sy/sz 用表达式读特征 CHOP，经过 **Lag CHOP** 平滑 |
| 后期 | **Render TOP** → **Edge TOP** → **Feedback TOP** + **Composite TOP** → **Threshold TOP** → **Level TOP**（反相） |
| 输出 | **Window COMP**（全屏到投影/第二屏）、**Video Device Out TOP**（采集卡）、**Syphon Spout Out TOP** / **NDI Out TOP**（送 Resolume）、**Movie File Out TOP**（录屏） |
