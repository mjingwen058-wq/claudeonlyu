# TONOS 全流程 Demo

以展厅为身体的人工生命，按《TONOS 交互逻辑与技术方案》在一台电脑上跑通：电脑摄像头代替摄像头节点，电脑扬声器代替 4 个发声节点。代码在 [`web/tonos/`](web/tonos/)。

| 层 | 浏览器里怎么做 |
|---|---|
| ① 采集 | MediaPipe Pose（最多 4 人，模型和 WASM 已放进仓库）+ 质心最近邻追踪，给每人稳定 ID；另有 4 个模拟观众场景 |
| ② 转换 | 7 个扰动特征，30 Hz 发给内核；每 20 秒一次行为模式摘要，只交给 LLM |
| ③ 内核 | 6 个变量：唤醒、边界完整度用欠阻尼二阶系统，充盈度、损耗、沉积用一阶累积—泄漏，新奇度用 CBLA 学习进展；5 种模式的状态机带滞回和最短停留 |
| ④ 认知 | 4 个唤醒条件；内感受报告；5 个工具的限制写在代码里强制执行。默认是规则模拟解释器，填自己的 Anthropic API Key 可换成真实 Claude |
| ⑤ 表达 | 声音：物理世界里碰撞发声 + 声音状态机 + 5 种合奏；词库：语义坐标排布，大小 = 权重；图像：WebGL2 反应-扩散，内核驱动参数 |

打开后点"自动演示"，约 3 分钟走完全流程；或者点"开摄像头，自己试"。点"闭馆 → 下一天"可以看沉积、设定点漂移和记忆压缩，状态存在浏览器本地，刷新后接着上一天。

- 在线入口（不用设置，可以用摄像头）：`https://rawcdn.githack.com/mjingwen058-wq/claudeonlyu/<提交号>/web/tonos/index.html`
- GitHub Pages 打开以后：<https://mjingwen058-wq.github.io/claudeonlyu/tonos/>
- 本地：`cd web && python3 -m http.server 8000`，再用 Chrome 打开 <http://localhost:8000/tonos/>
- 测试：`node --test tests/tonos-kernel.test.mjs`；`node tests/tonos-sim-run.mjs` 打印模拟观众经过每一层的数值

---

# Sonic Field

声音驱动的 3D 黑白 VJ 视觉。麦克风收音 → 提取 10 个声音特征 → 驱动五个 3D 场景（条码层、数据地形、波形隧道、笔触流、涂鸦巢），视觉方向参考池田亮司的纯黑白数据美学。

- 映射标准和 TouchDesigner 移植对照：[`docs/mapping.md`](docs/mapping.md)
- 浏览器原型：[`web/`](web/)（Three.js + Web Audio，不用联网，three.js 已经放在 `web/vendor/`）
- TouchDesigner 版：[`td/`](td/)（一键搭建脚本和一步步测试说明，见 [`td/README.md`](td/README.md)）

## 在线打开（可以用麦克风）

- GitHub Pages：<https://mjingwen058-wq.github.io/claudeonlyu/>
  第一次需要在仓库 **Settings → Pages → Build and deployment → Source** 里选 **GitHub Actions**。之后每次推送 `web/` 都会自动更新，大约 1 分钟生效。
- 临时链接（按提交号托管，不需要设置）：`https://rawcdn.githack.com/mjingwen058-wq/claudeonlyu/<提交号>/web/index.html`

打开后点“用麦克风”，浏览器问是否允许时点“允许”。面板顶部的**收音电平**会显示原始输入音量（dB）：对着麦克风说话应该在 -50 到 -10 dB 之间跳。如果一直是“—”，按面板里的提示检查系统的麦克风权限。

## 在本地运行（用麦克风）

浏览器只允许 `localhost` 或 https 页面用麦克风，所以要起一个本地服务器：

```bash
cd web
python3 -m http.server 8000
```

然后用 Chrome 打开 <http://localhost:8000>，点“用麦克风”并允许访问。

- **换外接麦克风或声卡**：插上以后，在面板顶部的下拉菜单里选它。设备列表会自动刷新。
- 原型已经关掉了浏览器给通话用的降噪、回声消除和自动增益，收到的是原始信号。
- 没有麦克风时，可以用“演示信号”（内置一段 16 小节循环：平稳 → 上升 → 高能）或者选一个音频文件。

## 快捷键

| 键 | 作用 |
|---|---|
| H | 隐藏/显示面板 |
| F | 全屏 |
| T | 手动打拍（连续点 2 次以上锁定 BPM） |
| 1–5 | 手动选场景 A–E（关闭自动） |
| A | 自动切场景开/关 |

## 现场调参顺序

1. 先调**输入增益**，让正常音量下 RMS 在 0.5–0.7 之间
2. 安静时 RMS 应该低于**静音门限**，否则会一直进不了待机
3. 起音闪得太多就调高**起音灵敏**，漏拍就调低
4. 高能段进不了 DROP，就调低**高能·低频 / 高能·高频**
5. 画面参数（Z 深度、混沌量、密度、拍点转镜、时间流速、描边、拖影、二值化）按现场审美调
