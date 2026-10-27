# VINCI 2026 观众签到

「无界未来 FUTURES UNBOUND」展览（第 19 届 VINCI 艺术与媒体画廊，2026.11.1–11.15，杭州）的扫码签到网站。

- **观众端** `/`：扫码打开，5 个问题一屏一题（姓名、手机号、性别、年龄段、同行人数），签完显示今天第几位观众和一个走动的时钟。同一个手机号一天只记一次，同行的朋友不用再扫码。
- **后台** `/admin`：密码登录，按天看到访人数、每小时分布、性别 / 年龄段 / 同行情况比例，搜索和删除记录，**一键导出全部**（CSV，Excel 直接打开）。
- 签到记录保存 3 个月，到期自动删除。

做法和 SCAA 问卷一样：Next.js + Neon 数据库，部署到 Cloudflare。不用买服务器，不用备案，免费额度够用。

## 上线步骤（大约 15 分钟，全程在网页上点）

### 1. 建数据库（Neon）

1. 登录 [neon.tech](https://neon.tech)（用之前 SCAA 的账号就行）
2. **New Project**，名字填 `vinci-checkin`，区域选 **AWS Asia Pacific (Singapore)**
3. 建好后点 **Connect**，复制连接串（`postgresql://` 开头那一长串），先存着

表不用手动建，第一次有人签到时会自动建好。

### 2. 部署到 Cloudflare

1. 登录 Cloudflare → **Workers & Pages** → **Create application** → **Import a repository**
2. 选 GitHub 仓库 `mjingwen058-wq/claudeonlyu`
3. 填写设置：
   - **Project name**：`vinci-checkin`（必须是这个名字，和代码里的配置一致）
   - **Build command**：`npx opennextjs-cloudflare build`
   - **Deploy command**：`npx opennextjs-cloudflare deploy`
   - **Root directory**（在高级设置里）：`vinci-checkin`
   - **Production branch**：`claude/trusting-rubin-qeym4b`
4. 点 **Deploy**，等它构建完（几分钟）

### 3. 填数据库和后台密码

进到这个 Worker → **Settings** → **Variables and Secrets** → **Add**，加两个，类型都选 **Secret**（选 Secret，以后重新部署也不会被清掉）：

| 名字 | 值 |
|---|---|
| `DATABASE_URL` | 第 1 步复制的连接串 |
| `ADMIN_PASSWORD` | 你自己定的后台密码，长一点，别用生日 |

### 4. 绑定网址

还是这个 Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**，填 `vinci.islashan.com`。Cloudflare 会自动加好解析和 HTTPS 证书，几分钟后生效。

### 5. 开展前测一遍

1. 手机打开 `https://vinci.islashan.com`，在**微信里**扫码、填一遍；最好移动、联通、电信的手机各试一次
2. 电脑打开 `https://vinci.islashan.com/admin`，输密码，能看到刚才那条
3. 点「一键导出全部」，确认 Excel 能打开
4. **测完把测试记录在后台删掉**，不然会算进统计里
5. 用任意二维码生成工具（比如草料二维码）生成 `https://vinci.islashan.com` 的二维码，打印放前台

建议前台再备一张纸质签到表，万一网络不好可以手写。

## 以后要改东西

- **改题目或选项**：`lib/fields.ts`
- **改展期、开馆时间、保存期限**：也在 `lib/fields.ts`
- 推送到 `claude/trusting-rubin-qeym4b` 分支后，Cloudflare 会自动重新部署

## 本地开发

```bash
npm install
npm run typecheck      # 类型检查
npm run test:db        # 用内存数据库跑一遍签到逻辑（不用联网）
npm run build
```

想在本地完整跑起来：复制 `.env.example` 为 `.env.local`，填上真实的 Neon 连接串和密码，然后 `npm run dev`，打开 <http://localhost:3000>。

## 目录

```
app/
  page.tsx                  观众端（欢迎页 → 一屏一题 → 入场凭证）
  admin/page.tsx            后台（登录 + 看板）
  api/checkin/              提交签到
  api/admin/                登录 / 退出 / 读数据 / 导出 / 删除
components/AsciiMark.tsx    凭证上的 ASCII 图案（每人不同）
lib/
  fields.ts                 题目、选项、展期、开馆时间、保存期限
  store.ts                  所有数据库操作
  db.ts                     连接 Neon
  auth.ts                   后台登录 cookie
  csv.ts                    导出格式
  time.ts                   北京时间
public/assets/              从 KV 裁出来的标题字、标志、主视觉
scripts/                    本地测试用的内存数据库，线上不用
```
