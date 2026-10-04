# Sonic Field

声音驱动的 3D 黑白 VJ 视觉。麦克风收音 → 提取 10 个声音特征 → 驱动五个 3D 场景（字形场、半调体、唱片隧道、笔触流、涂鸦巢）。

- 映射标准和 TouchDesigner 移植对照：[`docs/mapping.md`](docs/mapping.md)
- 浏览器原型：[`web/`](web/)（Three.js + Web Audio，不用联网，three.js 已经放在 `web/vendor/`）
- TouchDesigner 版：[`td/`](td/)（一键搭建脚本和一步步测试说明，见 [`td/README.md`](td/README.md)）

## 在线打开（可以用麦克风）

- GitHub Pages：<https://mjingwen058-wq.github.io/claudeonlyu/>
  第一次需要在仓库 **Settings → Pages → Build and deployment → Source** 里选 **GitHub Actions**。之后每次推送 `web/` 都会自动更新，大约 1 分钟生效。
- 临时链接（按提交号托管，不需要设置）：`https://rawcdn.githack.com/mjingwen058-wq/claudeonlyu/<提交号>/web/index.html`

打开后点“用麦克风”，浏览器问是否允许时点“允许”。

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
