# 在 TouchDesigner 里测试 Sonic Field

`build_sonic_field.py` 运行一次，就会在 `/project1/sonic_field` 里搭好整套网络。第 1 版先做 **A 字形场**（K/M 字符矩阵，X 轴是频率，Z 轴是时间），其他场景测通以后再加。

## 一步步操作

**准备**
1. 打开 TouchDesigner，新建一个工程（File → New）。默认会有一个 `/project1` 网络。
2. 确认电脑的麦克风是开的。macOS 第一次用要在“系统设置 → 隐私与安全性 → 麦克风”里允许 TouchDesigner。

**放脚本**
3. 在网络编辑区（中间的格子背景）空白处按 **Tab**，弹出算子菜单。
4. 点上方的 **DAT** 标签，再点 **Text**，在空白处点一下放下它（名字会是 `text1`）。
5. 双击 `text1`，打开文字编辑窗口。
6. 打开 `td/build_sonic_field.py`，全选复制，粘贴进这个窗口，然后关掉窗口。

**运行**
7. 在 `text1` 节点上**右键 → Run Script**（或者选中它按 **Ctrl+R**，Mac 是 **Cmd+R**）。
8. 打开 Textport 看结果：菜单 **Dialogs → Textport and DATs**（快捷键 **Alt+T**）。应该看到“Sonic Field 搭建完成：/project1/sonic_field”。

**看效果**
9. 这时 `/project1` 里多了一个 `sonic_field`。选中它按 **I**（或者双击）进到里面。
10. 找到最右边的 **OUT** 节点，点一下它左下角的小圆点（Viewer），节点上就会显示画面。对着麦克风说话、拍手或放音乐，字形会跟着动。
11. 想看大图：在 OUT 上**右键 → View...**，会弹出一个独立的预览窗口。

**全屏输出（投影或第二屏）**
12. 点 **window** 节点，在右侧参数面板里选 Monitor，然后点 **Open**。

**换外接麦克风**
13. 点 **audio_in**，在参数面板的 **Device** 下拉菜单里选你的麦克风或声卡。

## 测试的时候请告诉我这几件事

- Textport 里打印出的内容，或者 `sonic_field` 里 **build_log** 这个节点的内容（双击打开），把文字复制给我。如果有些参数名在你的 TD 版本里不一样，会记在这里。
- **features** 节点：选中后按鼠标**中键**点住它，可以看到每个通道的数值。对着麦克风拍手时，`rms`、`low`、`onset` 应该跳起来，`bpm` 会慢慢接近音乐的速度。
- **OUT** 有没有画面；字是太大、太小还是位置不对。
- 有红色报错的节点（节点右上角会显示红色 ✕），点进去看报错文字发给我。
- 你的 TD 版本号（菜单 Help → About TouchDesigner）。

## 网络里每个节点是干什么的

| 节点 | 类型 | 作用 |
|---|---|---|
| audio_in | Audio Device In CHOP | 麦克风输入 |
| features + features_code | Script CHOP + Text DAT | 声音分析：RMS、64 带频谱、低中高、亮度、噪声度、起音、BPM、状态、相机通道 |
| instances + instances_code | Script CHOP + Text DAT | 把特征变成 64×48 个实例的位置和缩放（tx ty tz、sk、sm） |
| geo_K / geo_M | Geometry COMP（里面是 Text SOP） | 字母 K 和 M，用 Instancing 读 instances；整体旋转跟拍点走 |
| white | Constant MAT | 白色材质 |
| cam | Camera COMP | 相机，距离跟低频和能量走 |
| render | Render TOP | 渲染 1920×1080 |
| fb / trail / decay | Feedback TOP / Composite TOP / Level TOP | 拖影：当前帧和上一帧取最大值，上一帧逐帧变暗 |
| edge | Edge TOP | 描边（默认旁路，在节点上把 Bypass 关掉就开启） |
| threshold | Threshold TOP | 二值化（默认旁路） |
| OUT | Null TOP | 最终画面 |
| window | Window COMP | 全屏输出 |

## 调参数

- **声音相关**：双击 `features_code`，改文件开头的大写变量（增益 `GAIN`、起音灵敏 `ONSET_K`、静音门限 `GATE`、高能阈值 `DROP_LOW` / `DROP_HIGH`、拍点转镜角度 `BEAT_STEP_DEG`）。
- **画面相关**：双击 `instances_code`，改 `ROWS_PER_BEAT`（时间流速）、`Z_DEPTH`、`CHAOS`、`DENSITY`、`GLYPH_SCALE`（字的大小）。
- 改完关掉编辑窗口就会生效。如果没变化，在 `features` 或 `instances` 上右键 → Reset 一下。
- 重新运行 `text1` 会删掉旧的 `sonic_field` 重新搭，你在里面手动改过的东西会丢，记得先另存。
