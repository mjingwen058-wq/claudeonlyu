# TONOS Demo 进度记录（交接用）

下次开新对话时，把这份文件和仓库地址发给 Claude，就能接着做。

- 仓库：<https://github.com/mjingwen058-wq/claudeonlyu>，分支 `claude/peaceful-shannon-fly8rs`
- 技术文档：《TONOS 交互逻辑与技术方案》<https://claude.ai/artifact/Rz1veHzR8Y3GwFfYfbKLSw>
- 代码目录：`web/tonos/`
- 正式入口（规划中）：部署到 Vercel，项目根目录是 `web/tonos`。部署步骤见下面的「上线到 Vercel」
- 临时入口（本地模式，不共享）：`https://rawcdn.githack.com/mjingwen058-wq/claudeonlyu/<提交号>/web/tonos/index.html`
  - `<提交号>` 填分支上最新一次提交的完整哈希
- 本地运行：
  - 本地模式：`cd web && python3 -m http.server 8000`，再打开 <http://localhost:8000/tonos/>
  - 仿真 Vercel（共享模式）：`TONOS_ADMIN_KEY=test node tests/tonos-dev-server.mjs`，再打开 <http://localhost:8790/>

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
| 生命与存档 | 3.1 约束 3 | 一个共享的生命，持续生长：有服务器时状态放在服务器上，所有打开的页面都是它的节点；没有服务器时存在浏览器本地。结束的生命收进收藏柜，可以唤回。详见下面「共享生命与收藏柜」 | `life-core.js`、`life.js`、`api/` |

## 界面结构（第二版，按反馈分层）

- **四个视图**（顶栏切换，按 1 / 2 / 3 / 4）：
  - 展厅：大图像，侧栏放摄像头和「大脑与词汇」
  - 思考：一次唤醒按 5 步展开，侧栏缩小
  - 全流程：5 张流水线卡片选层，下面是该层详情
  - 收藏柜：结束了的生命，每件标本可以点开看详情和唤回（第三版加的）
- **每层分两级**：表层常显，「后台数据」折叠起来；有「全部展开」
- **沉浸投影**：按 F，图像全屏，词条浮在上方
- **控件收纳**：顶栏只留摄像头、模拟观众菜单、声音、自动演示、⚙ 控制，其余在右侧抽屉
- **组件只有一份**：切换视图时挪进对应的槽（`data-slot`）。实现见 `ui.js` 的 `layout()`
- **自动演示**：`demo.js` 共 14 步约 3 分钟，每步自动切视图和层

## 共享生命与收藏柜（第三版）

用户要求部署后别人打开也能用，数据持续更新，不随浏览器丢失。讨论后定下：

- 演示和模拟观众在沙盒里跑，不计入它的生命
- 只有管理员能结束或唤回，要口令
- 结束不是抹除：收进收藏柜，以后能唤回；唤回时当前的生命先被收进去
- 思考默认用规则模拟；服务器配了 Anthropic Key 就由服务器调 Claude

### 数据怎么流动

- **一个共享的生命**：服务器上存一份当前生命，内容有编号、出生日期、天数、沉积和当日构成、设定点和偏置、词库和意义轨迹、记忆、最近 20 次思考摘要、日志
- **每个打开的页面是一个节点**：
  - 快变量（唤醒、边界、新奇、当前模式）各自算，跟着各自的摄像头走
  - 慢的部分放在服务器上
- **同步**：
  - 打开时读取当前生命
  - 之后每 30 秒把这段时间的贡献作为增量操作发上去（`?sync=秒数` 可以改），关页面时用 sendBeacon 补发
  - 服务器合并后返回最新状态，页面用它更新词库、记忆、设定点和沉积
- **增量合并，不会互相覆盖**：
  - 沉积只做加法，单次最多 0.01
  - 词条按词合并，单次最多加 3 个
  - 记忆追加
  - 设定点和偏置按限幅叠加
  - 存储写入带版本号（CAS），冲突时重试 6 次
- **它的一天就是真实的一天**，按北京时间：
  - 新的一天第一次有人访问时，服务器自动闭馆：沉积推动设定点漂移、词条衰减、当天记忆压成摘要
  - 很久没人打开时，最多补 30 天的闭馆，天数照算
  - 顶栏时钟显示「第 N 天 · 当前时间」
- **沙盒**：自动演示、模拟观众、演示加速，任意一个在跑就进沙盒
  - 顶栏显示「演示中 · 不计入它的生命」，这期间不写入
  - 结束后重新读取，回到它真实的样子
- **本地模式**：没有服务器时（githack 或 python 本地服务器），状态存在浏览器 localStorage，用同一套逻辑。收藏柜也能用，不需要口令。旧的 `tonos.v1` 存档会自动迁移

### 收藏柜

- **标本**包括：最后一刻的图像（结束时截的身体层和扰动层）、编号、出生和收进来的日期、活了几天、学会的词、最后一句话、记忆摘要、沉积和设定点
- **结束这一生**：在 ⚙ 控制 →「生命」里，或者收藏柜右侧的「现在活着的」卡片里
  - 共享模式要先填管理口令，再长按 3 秒
  - 口令只在服务器上核对；浏览器只在当前标签页里暂存（sessionStorage）
- **唤回**：在标本详情里长按 3 秒。当前生命先收进柜子，被唤回的带着原来的全部状态继续生长。在柜子里的日子不算，不补做闭馆

### 服务器接口（`web/tonos/api/`）

| 接口 | 作用 |
|---|---|
| `GET /api/life` | 读取当前生命（顺便做跨天闭馆）。返回里有 `store`（用的哪种存储）、`llm`（是否配了 Claude）、`admin`（是否设了口令） |
| `POST /api/life` | `{ops: [...]}` 提交增量，一次最多 100 条 |
| `GET /api/cabinet` | 收藏柜列表；`?id=` 取一件标本的全部内容 |
| `POST /api/cabinet` | `{action: check \| end \| revive, key, id, thumb}`，都要口令 |
| `POST /api/mind` | 服务器代调 Claude。没配 Key 返回 501，页面改用规则模拟；全局每 20 秒最多 1 次唤醒，每天有上限 |

- 文件：
  - `_store.js`：存储适配
  - `_handlers.js`：接口逻辑，和 Vercel 无关，方便测试
  - `life.js`、`cabinet.js`、`mind.js`：Vercel 入口，各一行
- 存储按顺序选：
  1. Upstash Redis（`KV_REST_API_URL` + `KV_REST_API_TOKEN`，或 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`）
  2. Vercel Blob（`BLOB_READ_WRITE_TOKEN`）
  3. 内存。只适合测试：函数冷启动后会丢，正式部署必须配 1 或 2

### Vercel 环境变量

| 变量 | 必须 | 说明 |
|---|---|---|
| `TONOS_ADMIN_KEY` | 是 | 管理口令，结束和唤回用。不设的话谁都不能结束 |
| Upstash 或 Blob 的变量 | 是 | 在 Vercel 里连接存储后自动加上 |
| `ANTHROPIC_API_KEY` | 否 | 配了就由服务器替所有人调 Claude |
| `TONOS_LLM_MODEL` | 否 | 默认 `claude-haiku-4-5`，也可以填 `claude-sonnet-5-5`、`claude-opus-5-5` |
| `TONOS_LLM_DAILY` | 否 | 每天最多唤醒几次 Claude，默认 300 |
| `TONOS_PREFIX` | 否 | 存储键前缀，默认 `tonos`。换一个就是另起一套数据 |

### 上线到 Vercel

**卡在哪里**：这个云端会话的网络策略挡住了 `vercel.com`、`api.vercel.com`（代理返回 403），环境里也没有 Vercel 凭证，所以 Claude 还不能自己部署。claude.ai 的 Vercel 连接器只能查看，不能部署。

**用户需要做一次**（会话标题栏的环境菜单 → Edit，说明见 <https://code.claude.com/docs/en/cloud-environments#network-access>）：

1. **Network access**：选 Custom，勾上包含默认包管理器列表，再加：
   - `vercel.com`
   - `api.vercel.com`
   - `*.vercel.app`
   - `*.vercel-storage.com`
   - `*.upstash.io`
2. **环境变量**（填在环境设置里，不要发在聊天里）：
   - `VERCEL_TOKEN`：在 vercel.com → Account Settings → Tokens 生成
   - `TONOS_ADMIN_KEY`：管理口令

**改好后开新会话，Claude 来做**：

```bash
cd web/tonos
npx vercel@latest link --yes --project tonos --token "$VERCEL_TOKEN"
# 存储：先试 Upstash（Marketplace 集成），不行就建 Vercel Blob
npx vercel@latest blob store add tonos-life --token "$VERCEL_TOKEN"  # 按 CLI 提示连到项目
printf %s "$TONOS_ADMIN_KEY" | npx vercel@latest env add TONOS_ADMIN_KEY production --token "$VERCEL_TOKEN"
npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
# 检查
curl -s https://<域名>/api/life | head -c 300   # store 应该是 upstash 或 blob，不是 memory
curl -sI https://<域名>/models/pose_landmarker_lite.task
```

CLI 的具体子命令以当时 `npx vercel@latest --help` 为准。

- `*.vercel.app` 在中国大陆经常打不开或很慢。要给国内的人用，最好在 Vercel 里绑一个自己的域名
- 免费额度：Upstash 免费版每月 50 万次操作；每个页面每 30 秒 1 次，10 个人同时开 8 小时约 1 万次

## 用户反馈时间线

1. **第一版**：全流程 demo，四列面板全部铺开
2. **反馈：信息太多、主次不分**。改成三个视图 + 表层/后台数据分层，现有内容不删
3. **反馈：扰动在展厅里看不出来**。希望人对它的扰动像神经上的挑动，偏线性、带噪波，参考昨天 Sonic Field 那种线性视觉；它自己的状态保持原样
   - 已加 `Nerves` 扰动层
   - 参考图：核心周围的乱线缠绕、斜向直线束、同心线错位、线描解剖图
   - 用户说回头还会发更多视觉参考
4. **要求部署到 Vercel**，别人打开也能用，数据持续更新；讨论了「一键清空」，改成结束后收进收藏柜、可以唤回。做成了共享生命 + 收藏柜（第三版），等用户改好环境设置后部署

## 测试

- 两个文件要分别写出来，`node --test tests/` 会报错：
  - `node --test tests/tonos-kernel.test.mjs tests/tonos-life.test.mjs`
- `tests/tonos-life.test.mjs`：10 条，包括两个节点交错提交、并发冲突重试、增量上限、跨天闭馆只做一次、结束和唤回、在柜子里的日子不算、口令错误被拒、思考接口限频、最多补 30 天
- `tests/tonos-dev-server.mjs`：本地仿真 Vercel（静态文件 + 3 个接口 + 内存存储）。用它跑过双页面端到端测试：A 的新词 30 秒内到 B、演示期间服务器不变、没口令不能结束、结束后柜子里有带图的标本、唤回后词还在、手机宽度不溢出
- `tests/tonos-kernel.test.mjs`：9 条，包括欠阻尼回归、泄漏时间常数、沉积只增不减、滞回、设定点上限、新词上限、开口冷却、模式权重和记忆重要性的限制，以及 episode 记录
- `node tests/tonos-sim-run.mjs`：打印模拟观众经过每一层的数值，调参数用
- 无头 Chromium 测试是用假摄像头跑的，没有测过真人画面

## 还没做 / 可以接着做

- **部署到 Vercel**：等用户改好环境设置（见上面「上线到 Vercel」），开新会话后由 Claude 部署，并给出固定网址

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
