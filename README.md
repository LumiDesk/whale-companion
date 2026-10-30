<p align="center">
  <img src="docs/assets/logo.png" width="112" alt="小鲸鱼" />
</p>

<h1 align="center">小鲸鱼 · 独立陪伴 AI</h1>

<p align="center">
  一只住进 <b>QQ 私聊</b> 的陪伴机器人 —— 有人格卡、有记忆、会发表情包，也会自己找你说话。<br />
  附带一个 Windows 桌面控制台：填配置、看状态、翻日志，双击就能用。
</p>

<p align="center">
  <a href="https://github.com/LumiDesk/whale-companion/releases"><img src="https://img.shields.io/github/v/release/LumiDesk/whale-companion?style=flat-square&label=release&color=0284c7" alt="release" /></a>
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-0e7490?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64-1d4ed8?style=flat-square" alt="platform" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/TS%C2%B7React%C2%B7Neutralino-0f172a?style=flat-square" alt="stack" />
</p>

<p align="center">
  <a href="#截图">截图</a> ·
  <a href="#功能">功能</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#它怎么工作">架构</a> ·
  <a href="#常见问题">常见问题</a>
</p>

---

## 截图

<p align="center">
  <img src="docs/screenshots/console-status.png" alt="桌面控制台 · 状态页" />
  <br />
  <sub>状态页：运行状态、QQ 连接、最近消息与实时日志</sub>
</p>

<p align="center">
  <img src="docs/screenshots/console-settings.png" alt="桌面控制台 · 设置页" />
  <br />
  <sub>设置页：基础 / 人格 / 对话 / 主动 / 表情包 / 高级 / 数据七个 Tab，截图截取的是基础页</sub>
</p>

<p align="center">
  <img src="docs/screenshots/console-logs.png" alt="桌面控制台 · 日志页" />
  <br />
  <sub>日志页：实时滚动、按来源筛选、搜索、打开日志目录</sub>
</p>

<sub>截图中的路径与密钥均为演示数据。</sub>

## 功能

**像人一样聊天**

- 默认一轮 1–3 条短消息，条间 1–3 秒；只有超长才切，不刷屏
- 模型自己决定发几条、要不要等、要不要这次先不回；等你补充时不会抢话
- 你连发多条 / 多图，会合并成一轮再回（停口 3 秒，从第一条起最多等 10 秒）
- 一天一个心情，还会按时段调语气：清早迷糊一点，深夜小声一点
- 看得懂图：发来的图片会作为多模态输入（单张上限 8MB）；开启看图时图片会发给模型服务商

**人格可选**

- 内置「DeepSeek 小鲸鱼」「猫娘小咪」两张人格卡，也可以新建、编辑、导入 qq-bridge 的 `roles/*.md`
- 切换人格下一条消息生效，不用重启；历史与记忆共享
- 三档行为风格：标准 / 克制 / 话痨

**记得住人**

- 最近 40 条原文 + 一段长期摘要 + 你亲口让她记住的事 + 没聊完的话题 / 想说没说的话
- 聊到 150 条自动把老对话压成摘要，原文只留最近的，不会越长越糊
- `/remember 我不吃香菜` 可以直接写进长期记忆

**表情包**

- 你发的图会按内容哈希去重后再入库，同一张只留一份；标签在后台补（不挡这一轮回复）
- 升级后首次启动会合并旧图库里的重复图：保留最早一张，标签取并集（上限 12 个）
- 想发就调用 `send_sticker`，按语义（字符二元组 + 余弦）挑最贴切的一张
- 模型主动要图时**只发命中的**，宁可不发也不乱发；你明确说「发个表情包」才允许随机兜底
- 同一个人 8 分钟冷却，自发跟图概率 5%

**主动与命令**

- 空闲且不在免打扰时段时，她会自己开口；模型也可以自己安排「下次什么时候再找他」（受平台主动消息额度限制）
- `/help` `/new` `/forget` `/memory` `/remember` `/status`

**桌面控制台**

- 状态页、设置页、日志页、关于页，配色和文案都是照着「养成」的感觉做的
- **提示统一从右上角弹出**：跨页面保留、可手动关闭；成功/提示 5 秒收起，错误留到你关掉
- **深浅色主题**：默认跟随 Windows，也可以固定为浅色或深色，切换即时生效
- 设置页分「基础 / 人格 / 对话 / 主动 / 表情包 / 高级 / 数据」：
  - 模型、接口地址、**思考强度（关闭 / 低 / 高 / 最高）**、温度、超时与重试
  - 模型输入框右侧的「获取模型」会调用 `GET /models`，下拉选择可用模型
  - 人格卡管理：内置 / 自定义、新建、复制、编辑、删除、导入 qq-bridge 角色卡
  - 对话引擎：是否启用 Agent、每轮条数、沉默开关、首条延迟、条间隔、等待上限
  - 历史窗口、压缩阈值、聚合节奏、表情包概率/阈值、主动消息免打扰等
  - 连接自检：检查 QQ token、模型接口、数据目录、当前人格和图库
  - 数据备份：导出/导入对话、记忆、表情包与人格卡；图库可删除、重新打标
- **检查更新**：默认只从 GitHub 正式 Release 检查新版本，在「关于」页下载并安装、自动重启；
  想提前用测试版，可以打开「接收预发布版本」开关
- 托盘菜单：显示主界面、暂停 / 启动、重启、打开日志 / 数据目录、退出
- 单实例锁，不会两个进程抢同一条 QQ 连接
- 关窗默认最小化到托盘；也可设为直接退出
- GUI 崩溃时 Bot 会自己退出（父进程看门狗），不留孤儿进程占着连接
- 开机自启（写 `HKCU\...\Run`，启动后直接隐藏到托盘）

## 自定义

所有可调项都在桌面控制台的「设置」页，按「基础 / 人格 / 对话 / 主动 / 表情包 / 高级 / 数据」分组。
默认值等于原来的行为，不配置也能照常使用。

**常用**

- **思考强度**：关闭 / 低 / 高 / 最高。DeepSeek 默认开启思考且为「高」；
  关闭后温度（temperature）才生效。按 [DeepSeek 思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) 实现。
- **获取模型**：点模型输入框右侧按钮，会调用 `GET /models` 并列出当前 Key 可用的模型
  （含上下文窗口与支持的思考档位）。接口不支持模型列表时仍可手动输入。
- **人格**：内置卡随软件更新；自定义卡写到 `%APPDATA%\whale-companion\personas\`，
  `active.json` 决定当前人格；支持新建、复制、编辑、删除和导入 qq-bridge 的 `roles/*.md`。
- **行为风格**：标准 / 克制 / 话痨，影响一轮发几条、等多久、多主动；在「人格」页切换。
- **称呼**：默认「主人」；改成人名后，人格卡和提示词里的「主人」会一起替换。
- **对话引擎**：开关 Agent、每轮最多几条、是否允许沉默、首条延迟、条间间隔、单次等待上限。
- **回复长度 / 历史窗口 / 聚合节奏**：控制她记得多久、什么时候回、一次回多长。
- **主动消息**：开关、检查间隔、免打扰时段、最短/最长闲置、每天最多几次。
- **表情包**：开关、自发概率、冷却、命中阈值、明确要图时是否允许随机、打标并发。

**高级**

- 模型超时/重试、最大输出、额外 JSON 参数、每轮图片数量与总预算。
- 单张图片上限、日志级别、表情包图库上限。
- Agent 每轮最多步数、句子间隔、连续沉默上限、单轮硬超时。
- 思考开启时 `temperature` 不生效，这是 DeepSeek 的限制，不是设置没保存。

**数据**

- **连接自检**：检查 QQ token、模型接口、数据目录、当前人格与图库；不会建立 QQ 长连接。
- **导出/导入备份**：默认包含 `data/` 与 `personas/`，不含 `config.json` 里的密钥；
  导入前会把当前数据备份到 `updates/import-backup-*`。
- **图库维护**：查看标签、删除单张、重新打标无标签图。
- 配置文件是 `%APPDATA%\whale-companion\config.json`（v2；旧 v1 会自动迁移并备份）。

## 技术栈

| 层         | 选型                               | 说明                                                                          |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Bot 运行时 | **Node.js ≥ 22 · TypeScript**      | `tsx` 直接跑 TS，没有 Web 框架                                                |
| 模型       | **DeepSeek `deepseek-flash`**      | OpenAI 兼容接口，`DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 可换                  |
| QQ 通道    | **QQ 官方机器人 API**              | 原生 `fetch` + `WebSocket`，自带心跳、断线重连、token 缓存                    |
| 桌面控制台 | **Neutralino 6 · React 19 · Vite** | 用系统 WebView2，仅 Windows；不打包 Chromium                                  |
| 打包       | `neu build` + 内置 `node.exe`      | 便携 zip，用户不用装 Node                                                     |
| 测试       | `node:test` + `tsx`                | Agent 循环、SessionHub、人格卡、记忆 v2、原子写与更新脚本都有单测             |
| CI         | **GitHub Actions**                 | Windows runner 构建；推 `v*` tag 生成 `SHA256SUMS.txt` 并创建 **pre-release** |

几个刻意的取舍：

- **不用 Electron**：桌面端只管一个本地进程和四页界面，Neutralino 只有几 MB，直接用系统 WebView2。
- **不用 Hono / Nest**：只有一个 QQ 长连接和几个 JSON 文件，加一层框架不如直接读代码。
- **core 不知道 QQ 的存在**：想加新通道（命令行、其他 IM）只写 `channels/xxx/`，主动消息的发送方式由组合根注入。

## 快速开始

### 方式一：桌面版（推荐）

1. 从 [Releases](https://github.com/LumiDesk/whale-companion/releases) 下载 `whale-companion-*-win-x64.zip`，解压到任意目录
2. 双击 `WhaleCompanion.exe`；首次启动会自动打开设置页
3. 填 **QQ Bot 的 AppID / AppSecret** 和 **DeepSeek API Key**（模型和接口地址可保留默认），保存后 Bot 自动启动

便携包自带 `node.exe`，不需要另外装环境。已有 `.env` 的话，放到 `WhaleCompanion\server\.env`，
再点设置页右上角的「从 .env 导入」即可。

数据都在 `%APPDATA%\whale-companion`：

```
config.json     桌面端设置（含外观主题）
bot.json        启动 Bot 用的临时配置（含密钥）
personas/       人格卡：自定义卡 + active.json
data/           聊天记录、记忆、表情包
logs/           每日日志
updates/        自动更新缓存与安装日志
app.lock        单实例锁
```

### 方式二：命令行

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # 填 DEEPSEEK_API_KEY / QQBOT_APPID / QQBOT_SECRET
pnpm dev
```

Windows 下也可以直接 `Copy-Item apps/server/.env.example apps/server/.env`。

### 方式三：Linux 服务器（无桌面控制台）

适合 VPS、家里常开的小主机；不需要 Windows，也不需要 Docker。
用 `git` + Node 22 + systemd 跑起来，数据放在代码目录外，升级不丢。
只提供这一条源码部署路径，不提供 Docker 镜像或一键脚本。

完整步骤（安装、systemd、时区、备份、从 Windows 迁移、排障）见
[`docs/deploy-linux.md`](docs/deploy-linux.md)。

> 服务器部署没有桌面控制台：人格卡、表情包图库要直接改文件或手动备份。
> 另外同一个 AppID 只能跑一个实例，迁移前先停掉 Windows 版。

### QQ 端要做的两件事

1. 在 [q.qq.com](https://q.qq.com) 的「开发设置 → 事件订阅」里选择 **WebSocket**
2. 把你的 QQ 号加进「内部体验号码」，然后用手机私聊它

## 它怎么工作

<p align="center">
  <img src="docs/assets/architecture.png" alt="架构：主人 ↔ channels/qq ↔ core ↔ data" />
</p>

一条消息的旅程：

1. **收**：WebSocket 事件 → 清洗 `<faceType=…>` / `<@…>` 平台标记 → 串行下载图片
2. **攒**：SessionHub 按「停口 3 秒」合并连发；一直发也最多等 10 秒；同一个人串行处理
3. **判断**：斜杠命令直接回；图片先去重入库、标签丢后台；「发个表情包」走挑图
4. **想**：人格卡 + 行为规则 + 长期记忆 + 此刻 + 心情 + 图库可用性 → Agent 回合
5. **发**：模型调 `send_message` / `send_sticker`，1–3 条短消息依次发出；想等就 `wait_for_messages`，不想回就 `stay_silent`

## 架构

```
apps/
  server/                Bot 本体
    personas/            内置人格卡（deepseek-whale / catgirl）
    prompts/behavior/    内置行为提示词（base / 三档风格 / legacy）
    src/config.ts        所有环境变量在此收口
    src/core/agent/      Agent 回合循环 / 工具 / 提示词 / 时间感
    src/core/            人格卡 / 记忆 / 心情 / 表情包 / 主动消息 / 命令
    src/store/           history / memory / stickers / users
    src/channels/qq/     token / send / media / session-hub / handler / gateway
    src/index.ts         组合根：启动 QQ + 主动消息 + 补齐标签
  desktop/               Windows 控制台（Neutralino + React）
    src/pages/           状态 / 设置 / 日志 / 关于（settings/ 是设置页子组件）
    src/components/      侧边栏、Toast、错误边界、通用控件（ui/）
    src/hooks/           托盘、子进程、单实例、状态与日志编排
    src/lib/             配置、人格卡、路径、锁、日志、进程命令、Toast 入口（纯函数与适配）
docs/
  screenshots/          README 截图
  assets/               图标 · 架构图 · 社交预览图
```

分层铁律（改代码前先看这条）：

1. `core/` 不知道消息从哪来，也不直接发 QQ；主动消息只接受注入的 `send` 回调
2. `channels/` 只做传输：收事件、发消息、下附件、清洗平台标记
3. `store/` 只做持久化，不做业务判断
4. 桌面端不 import 服务端源码，只通过「启动子进程 + `--config` + stdout 状态行」控制 Bot

## 数据与隐私

- `apps/server/data/`、`.env` 全部 gitignore；聊天记录、图片、记忆、人格卡默认只在本机
- **开启「看图 / 表情包打标」时，图片会发送到你配置的模型服务商**；在设置页可以关闭，
  关闭后图片只保存在本机
- 桌面版把密钥明文存在 `%APPDATA%\whale-companion\config.json`（和原来的 `.env` 一致）
- 人格卡与 `active.json` 在 `%APPDATA%\whale-companion\personas\`，不会上传到任何地方
- 图片上传走 QQ 官方接口，不经过第三方图床
- 检查更新只访问 GitHub 的公开 API；安装包下载后先校验 SHA256（Release 带 `SHA256SUMS.txt` 时）
- 服务端没有对外 HTTP 端口；除了 QQ 官方 API、模型接口和 GitHub 更新，不主动连任何地方

## 常用命令

```bash
pnpm dev              # 只启动机器人（tsx watch）
pnpm build            # 构建 Bot（desktop:dev 需要）
pnpm desktop:dev      # 启动桌面控制台（开发态）
pnpm desktop:pack     # 打 Windows 便携 zip
pnpm typecheck        # 两个包都查
pnpm test             # 两个包的单测
pnpm release patch    # 发版：bump + tag + push（CI 默认发 pre-release）
```

打包产物：`apps/desktop/dist/whale-companion-<version>-win-x64.zip`。

## 常见问题

| 现象                  | 先看这里                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| 手机私聊没反应        | q.qq.com 的事件订阅是不是 **WebSocket**；QQ 号在不在「内部体验号码」；是不是同时开了两个 Bot     |
| 日志里出现 `4009`     | 多是服务端会话过期，会自动退避重连；连续出现「刚连上就被断开」才说明有另一个客户端在用同一 AppID |
| 她从不主动说话        | 主动消息受平台额度限制，失败只记日志；再确认 `PROACTIVE_ENABLED` 和免打扰时段（默认 23:00–9:00） |
| 表情包不发或很离谱    | 看图库标签质量、`STICKER_MIN_SCORE` 阈值、8 分钟冷却；模型主动要图时只发语义命中的               |
| 记忆像没生效          | `data/history.json` 与 `memory/<userId>.json` 是否在写；压缩阈值 `HISTORY_SUMMARIZE_AT`          |
| 检查更新失败          | GitHub 是否可达；自动更新需要能访问 `api.github.com` 和 `github.com`                             |
| 更新安装失败          | 看 `%APPDATA%\whale-companion\updates\update.log`；程序目录要可写，Bot 要先停掉                  |
| 深色模式没生效        | 设置页「外观」是否选了深色；选「跟随系统」时由 Windows 主题决定                                  |
| exe 被 SmartScreen 拦 | 默认未签名，点「更多信息 → 仍要运行」；配置签名证书后 CI 会自动签                                |
| 桌面端 Bot 起不来     | `%APPDATA%\whale-companion\logs`、`bot.json`；开发态先 `pnpm build`                              |

更细的排障在 [`AGENTS.md`](AGENTS.md) 的「Troubleshooting」一节。

## 已知限制

- 只有 QQ 私聊，没有群聊，也没有 Web 调试台
- 主动消息不保证送达（平台限制）
- 桌面版只有便携 zip，没有安装包；默认未签名，配置 CI 证书后才会 Authenticode 签名
- 自动更新默认只查正式 Release；想试测试版要在「关于」页打开「接收预发布版本」，
  新版本先由 CI 发成 pre-release，确认稳定后再手动改成正式 Release
- 自动更新依赖 GitHub 可达，且便携目录可写；没有增量更新，每次下载完整 zip
- 第二个实例只提示并退出，不会把已有窗口调到前台
- 挑图依赖标签质量，同义不同词（「高兴」vs「开心」）可能漏
- 表情包去重只认字节完全相同：同一张图被平台重新压缩/转码后仍可能存成两张
- Agent 多步工具调用会提高 token 消耗与首条延迟；可以在「对话」页调节条数、间隔和步数
- 导入的 qq-bridge 群聊角色卡可能带「群友 / 群聊」措辞，需要在人格编辑器里改成私聊版
- 自定义斜杠命令、心情列表和表情包缩略图还没做；图库目前只能看标签、删除、重打标
- 从 0.1.x 第一次升到 0.2.0 时，执行更新的是旧版更新器，旧版没有“失败自动还原”；
  0.2.0 之后的更新才会走备份/还原脚本
- 真实存储读写、真实 QQ 链路、Neutralino 托盘和真实更新链路目前没有自动化测试

## 文档与参与

| 文档                                               | 内容                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                           | 架构、分层、QQ / Windows 踩坑、Troubleshooting 排障表 |
| [`DESIGN.md`](DESIGN.md)                           | 色板、字号、间距、控件规范（改界面前必读）            |
| [`docs/deploy-linux.md`](docs/deploy-linux.md)     | Linux 服务器部署：systemd、备份、迁移、排障           |
| [`AGENT_REDESIGN.md`](AGENT_REDESIGN.md)           | 私聊 Agent / 人格系统改造方案（已实现规格）           |
| [`CHANGELOG.md`](CHANGELOG.md)                     | 版本记录                                              |
| [`apps/desktop/README.md`](apps/desktop/README.md) | 桌面端开发与打包                                      |
| [`apps/server/README.md`](apps/server/README.md)   | 服务端入口                                            |
| [`docs/README.md`](docs/README.md)                 | 截图、架构图、社交预览图的来源与更新方法              |

这是一个偏个人的项目，但 issue 和 PR 都欢迎。动代码之前建议先读 `AGENTS.md`：
里面的「QQ 平台踩过的坑」和「Windows 大坑」能省掉大半天。

## License

[AGPL-3.0-only](LICENSE) · Copyright (C) 2026 Talyra42

简单说：你可以改、可以自己跑，但如果拿它（或改过的版本）对外提供网络服务，必须把源码同样以 AGPL 开放。想闭源商用是不行的。
