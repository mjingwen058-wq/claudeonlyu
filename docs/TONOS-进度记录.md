# TONOS Demo 进度记录（交接用）

下次开新对话时，把这份文件和仓库地址发给 Claude，就能接着做。

- 仓库：<https://github.com/mjingwen058-wq/claudeonlyu>，分支 `claude/peaceful-shannon-fly8rs`
- 技术文档：《TONOS 交互逻辑与技术方案》<https://claude.ai/artifact/Rz1veHzR8Y3GwFfYfbKLSw>
- 代码目录：`web/tonos/`
- 在线入口：`https://rawcdn.githack.com/mjingwen058-wq/claudeonlyu/<提交号>/web/tonos/index.html`
  - `<提交号>` 填分支上最新一次提交的完整哈希
  - 也可以在本地跑：`cd web && python3 -m http.server 8000`，再打开 <http://localhost:8000/tonos/>

## 为什么是网页而不是 Claude 的 artifact

claude.ai 的 artifact 页面在平台层面不允许开摄像头和麦克风，所以 demo 做成普通网页放在 GitHub 仓库里。用 githack 按提交号托管，是 https，可以开摄像头。

GitHub Pages 还没在仓库设置里打开，所以部署工作流每次都会失败。打开方法：Settings → Pages → Source 选 GitHub Actions。

## 已完成

| 层 | 文档章节 | 浏览器里怎么实现 | 文件 |
|---|---|---|---|
| ① 采集 | 1.1 | MediaPipe Pose Landmarker lite，最多 4 人，模型和 WASM 放在仓库里；按质心最近邻绑定 ID。另有模拟观众：一人靠近、多人聚集、同步举手、绕行后离开、清场 | `capture.js`、`sim.js` |
| ② 转换 | 1.1 表 | 7 个扰动特征，30 Hz；每 20 秒一次行为模式摘要，只交给 LLM | `features.js` |
| ③ 内核 | 1.2 | 唤醒、边界用欠阻尼二阶系统；充盈、损耗、沉积用一阶累积-泄漏；新奇度用 CBLA 学习进展 LP；停滞 → 自发突变；滞回（进 0.70 出 0.55）+ 最短停留 20 秒；超稳定性随机改参数；闭馆时沉积推动设定点漂移 | `kernel.js`、`clock.js` |
| ④ 认知 | 1.3 | 4 个唤醒条件；内感受报告和文档同格式；5 个工具的限制在代码里强制执行；默认规则模拟解释器，可填 Anthropic Key 换真实 Claude；每次唤醒记成一条 episode | `mind.js` |
| ⑤ 声音 | 1.4 | 2D 物理世界里碰撞发声；声音状态机（自语、竖耳朵、聚焦回应、轻响或不理、消散）；习惯化；5 种合奏；4 个节点在左右声场 | `sound.js` |
| ⑤ 词库 | 1.4 | 语义坐标排布 + 防重叠；大小 = 权重，按天衰减；发声时词条亮起；意义轨迹 | `lexicon.js`、`ui.js` |
| ⑤ 图像 | 1.4 | 分两层：<br>· 身体：WebGL2 反应-扩散，内核驱动参数，表现它自己的状态（慢、叠加）<br>· 扰动层：观众的神经挑动（快、线性、带噪波），包括纤维、直线束、同心细线被刮开，以及噪波短横线 | `image.js`（`Body`、`Nerves`） |
| 存档 | 3.1 约束 3 | 闭馆时存到浏览器本地，刷新后接着上一天 | `main.js` |

## 界面结构（第二版，按反馈分层）

- **三个视图**（顶栏切换，按 1 / 2 / 3）：
  - 展厅：大图像，侧栏放摄像头和「大脑与词汇」
  - 思考：一次唤醒按 5 步展开，侧栏缩小
  - 全流程：5 张流水线卡片选层，下面是该层详情
- **每层分两级**：表层常显，「后台数据」折叠起来；有「全部展开」
- **沉浸投影**：按 F，图像全屏，词条浮在上方
- **控件收纳**：顶栏只留摄像头、模拟观众菜单、声音、自动演示、⚙ 控制，其余在右侧抽屉
- **组件只有一份**：切换视图时挪进对应的槽（`data-slot`）。实现见 `ui.js` 的 `layout()`
- **自动演示**：`demo.js` 共 14 步约 3 分钟，每步自动切视图和层

## 用户反馈时间线

1. **第一版**：全流程 demo，四列面板全部铺开
2. **反馈：信息太多、主次不分**。改成三个视图 + 表层/后台数据分层，现有内容不删
3. **反馈：扰动在展厅里看不出来**。希望人对它的扰动像神经上的挑动，偏线性、带噪波，参考昨天 Sonic Field 那种线性视觉；它自己的状态保持原样
   - 已加 `Nerves` 扰动层
   - 参考图：核心周围的乱线缠绕、斜向直线束、同心线错位、线描解剖图
   - 用户说回头还会发更多视觉参考

## 测试

- `node --test tests/tonos-kernel.test.mjs`：9 条，包括欠阻尼回归、泄漏时间常数、沉积只增不减、滞回、设定点上限、新词上限、开口冷却、模式权重和记忆重要性的限制，以及 episode 记录
- `node tests/tonos-sim-run.mjs`：打印模拟观众经过每一层的数值，调参数用
- 无头 Chromium 测试是用假摄像头跑的，没有测过真人画面

## 还没做 / 可以接着做

- 真人摄像头下的效果，需要用户在自己电脑上试，再调距离标定和能量阈值
- 用户之后发来视觉参考后，继续调扰动层的线条风格
- 本体感受（把自己的声音和投影从感知里减掉）
- 对照实验的数据采集（有 / 无 LLM、随机版、纯反应版），以及问卷
- 多节点硬件、ESP32 端侧识别、飞艇

## 下载到本地

在 Windows PowerShell 里运行，会把整个项目放进指定文件夹：

```
git clone -b claude/peaceful-shannon-fly8rs https://github.com/mjingwen058-wq/claudeonlyu.git "E:\m\大学的茅\4大四\AAA_毕设\10.16 开题汇报\测试\实验1,0"
```

没有装 git 的话，可以下载压缩包再解压到同一个文件夹：<https://github.com/mjingwen058-wq/claudeonlyu/archive/refs/heads/claude/peaceful-shannon-fly8rs.zip>
