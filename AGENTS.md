# AGENTS.md — whale-companion 维护指南

写给在此仓库工作的 AI 代理与未来的自己。**中文沟通**。

> 版本号以根 `package.json` 为准；发布记录见 [`CHANGELOG.md`](CHANGELOG.md)。不要在这里硬编码版本。

## 文档地图

- [`README.md`](README.md)：用户视角的安装、使用、发版
- [`AGENTS.md`](AGENTS.md)：本文件，架构、约定、坑、排障
- [`apps/desktop/README.md`](apps/desktop/README.md)：桌面端开发与打包
- [`apps/server/README.md`](apps/server/README.md)：服务端入口
- [`CHANGELOG.md`](CHANGELOG.md)：版本记录
- [`docs/README.md`](docs/README.md)：截图、架构图、社交预览图怎么来的、怎么更新

## 1. 这是什么

一个**独立**的 QQ 陪伴机器人（不依赖 DeepSeek Harness）：人设、多轮对话、长期记忆、表情包、主动搭话。
聊天通道只有 QQ 私聊；另有一个 Windows 桌面控制台（Neutralino）负责设置、状态、日志和托盘。
没有 Web 调试台，也没有对外 HTTP 服务。

**不是**：agent 平台、工具执行器、文件操作机器人、多用户 SaaS。别往里塞这些。

## 2. 技术栈与命令

- Node ≥ 22 + TypeScript（server 用 `tsx` 直跑；desktop 用 Vite 构建）
- 没有 Web 框架：QQ 官方 API 用原生 `fetch` + `WebSocket`
- 桌面端：Neutralino 6 + React 19 + Vite（Windows only）
- pnpm workspaces：`apps/server` + `apps/desktop`
- 模型：DeepSeek OpenAI 兼容接口

```bash
pnpm dev                              # 只启动机器人（tsx watch）
pnpm build                            # tsc → apps/server/dist（desktop:dev 需要）
pnpm desktop:dev                      # 启动桌面控制台
pnpm typecheck                        # 两个包都查
pnpm test                             # 两个包的单测
pnpm desktop:pack                     # 打 Windows 便携 zip
pnpm release patch|minor|major        # 发版（bump + tag + push，触发 CI）
```

## 3. 目录地图

```
apps/server/
  persona.md              默认人设（只读，随版本更新；用户覆盖在 APPDATA）
  src/settings.ts         配置契约：字段、默认值、范围、env 映射（纯函数，桌面端只读复用）
  src/config.ts           把 env 收敛成 runtime config；非法值启动即报错
  src/core/               llm / persona / prompt / chat / reply / tagger / summarize / proactive / commands / mood / models / self-check / sticker-*
  src/store/              history / memory / stickers / users / atomic（只碰 data/ 下的 JSON 与文件）
  src/channels/qq/        token / send / media / text / aggregator / handler / gateway / migrate
  src/index.ts            组合根：启动 QQ + 主动消息 + 补齐标签；--self-check / --list-models / --retag

apps/desktop/
  neutralino.config.json  窗口、托盘图标、native API 白名单
  src/lib/                配置/路径/锁/日志/进程/主题/更新（纯函数，有单测）
  src/hooks/useController 托盘、子进程、单实例、主题、更新、状态与日志编排
  src/components/         状态页 / 设置页 / 日志页 / 关于
  src/components/settings/设置字段、模型下拉、人设编辑器、自检

scripts/release.mjs      pnpm release：bump + tag + push
.github/workflows/        CI（typecheck/test/build）/ Windows 构建 / GitHub Release
docs/                    方案、截图、架构图、社交预览图（说明见 docs/README.md）
```

**分层铁律**

1. `core/` 不知道消息从哪来，也不直接发 QQ；主动消息只接受注入的 `send` 回调；
2. `channels/` 只做传输（收事件、发消息、下载附件、清洗平台标记），业务逻辑回 `core/`；
3. `store/` 只做持久化，不做业务判断；
4. 渠道之间不互相 import；
5. 桌面端不 import 服务端源码，只通过「启动子进程 + `--config` + stdout 状态行」控制 Bot。

**唯一例外**：`apps/server/src/settings.ts` 是纯配置契约（无 `node:*`、无 `process.env`、无 DOM），
桌面端只读 import 它来复用字段/默认值/校验；不要从这个文件再引服务端其他模块。

配置链路：`config.json` v2（桌面）→ `settings.ts` 的 `toEnv` → `bot.json` → 服务端 `fromEnv` 校验。
旧的 v1 配置会在桌面端启动时自动迁移，并备份 `config.json.bak-v1-*`。

更细的桌面端约定见第 14 节。

## 4. 一次消息的完整链路

```
QQ 事件 → cleanQQContent 清洗 <faceType>/<@...> → 串行下载图片（限 8MB）
        → 聚合器（停口 3s / 从第一条起最多等 10s / 最多 10 条或 6 图）
        → 命令? → 图片入库（标签丢后台）→ core.generateReply
        → 剥 [表情包:关键词] → 整条发送（超过 REPLY_MAX_CHARS=500 才切）
        → 想发就紧跟一张表情包（msg_seq 递增）
```

关键文件：`channels/qq/aggregator.ts`（聚合）、`core/chat.ts`（对话）、`core/reply.ts`（标记与切分）、`channels/qq/handler.ts`（编排）、`channels/qq/text.ts`（平台标记清洗）。

## 5. 记忆是两级的

| 层 | 位置 | 规则 |
|---|---|---|
| 原文 | `data/history.json` | 存 `HISTORY_STORE`（200）条；每轮只发 `HISTORY_SEND`（40）条 |
| 长期 | `data/memory/<userId>.json` | `summary`（≤200 字）+ `facts`（≤20 条），每轮注入 system |

- 攒到 `HISTORY_SUMMARIZE_AT`（150）条时，后台把老的压成摘要，原文只留 `HISTORY_KEEP_AFTER`（20）条；
- 同一用户同时只压一次（`summarize.ts` 里的 `inFlight`），避免并发覆盖；
- `facts` 可被用户用 `/remember` 直接写入；
- **system 不落盘**，每轮由 `core/prompt.ts` 现拼（人设 + 记忆 + 此刻 + 心情 + 表情包可用性）；
- 主动消息发出后也要写进历史，否则下一轮她不知道自己说过；
- 所有 JSON 写入都走 `store/atomic.ts`（临时文件 + fsync + rename），别再用 `writeFileSync` 直接覆盖；
- 启动时 `channels/qq/migrate.ts` 会清掉旧历史里的 `<faceType>` / `<@...>`，改动前备份为 `history.json.bak-*`。

## 6. 表情包机制

- 收图 → 立即 `ingestSticker`（标签先空着）→ `queueStickerTagging` 后台打标（并发可配）→ `updateStickerTags` 回填；
- 启动时 `retagUntaggedStickers()` 给历史遗留的无标签图补标；桌面端可触发 `--retag` 逐张重打；
- 挑图 → `core/sticker-search.ts`：字符二元组 + 余弦，阈值 `STICKER_MIN_SCORE`（默认 0.12）；
- **模型主动要图只发命中的**（`allowRandom: false`）；用户明确说「发个表情包」才按设置决定是否随机兜底；
- 用户要图的识别与关键词抽取在 `core/sticker-request.ts`（别把「你发的表情包好好笑」当请求）；
- 同一用户默认 8 分钟冷却（`STICKER_COOLDOWN_MS`），自发率 0.05（`STICKER_CHANCE`）；
- 关闭 `VISION_ENABLED` 时不打标；关闭 `STICKER_AUTO_INGEST` 时新图不再进库。

## 7. QQ 平台踩过的坑（别再踩）

1. **发图上传必须 JSON + `file_data` base64**。multipart 会返回 `40093007 富媒体文件下载失败`；base64 不能带 `data:` 前缀。
2. **同一条 `msg_id` 多次回复要带递增的 `msg_seq`**，否则后一条会被丢。
3. **主动消息不带 `msg_id`** 需要平台额度，可能直接拒绝 → 现在只记日志，不许让它拖垮主流程。
4. **一个 AppID 只能有一条 WS 连接**，重复连接会 `4009` 互踢；代码里 4009/4006/4007/4008 一律不重连。
5. intents 用 `1 << 25`（群 + C2C）；token 两小时过期，`channels/qq/token.ts` 有缓存，重连时自然刷新。
6. 服务端推的一切都可能是「非预期 op」，解析必须 try/catch。
7. **正文里会混进 `<faceType=...,ext="...">` 和 `<@!...>`**：入历史前必须 `cleanQQContent`，否则模型看到的是 base64。
8. **WS 事件处理要串行**（`gateway.ts` 里的 `inbound` 链）：图片下载慢时不能插队，否则消息顺序和 `msg_id` 会错。
9. **单张图片限 8MB**（`MEDIA_MAX_BYTES`）：超了跳过并记日志，别把整张图 base64 塞进模型请求。
10. **回复默认一条发完**：用户明确要求不要拆成多条，别把旧的「三条拆分」加回来；只有超长才切。

## 8. 代码约定

- ESM：相对 import 必须带 `.js` 后缀；内置模块用 `node:` 前缀。
- 不引入 dotenv，用 `tsx --env-file=.env`。
- **错误不许静默**：网络/上游失败要带状态码与响应体片段抛出来；对外回复保持人话（如 502「模型服务暂时不可用」），日志里留真相。
- 拿不准的字段先打印真实结构，再写解析（QQ 接口字段并不稳定）。
- 时间/心情这类"背景信息"写进 system，但明确告诉模型"不要直说"。
- 模型请求必须有超时（`DEEPSEEK_TIMEOUT_MS`），网络错误/5xx/429 才重试；401 这类重试没用。

## 9. 数据与隐私

- `apps/server/data/` 全部 gitignore：对话、记忆、图库、users。
- `.env` 不提交；`.env.example` 是模板。
- 图片默认保存在本机；**开启「看图」或「表情包打标」时，图片会随请求发送到用户配置的模型服务商**。
  关闭 `VISION_ENABLED` 后不再把图发给模型，已入库图片和已有标签保留。
- 桌面端把密钥明文存在 `%APPDATA%\whale-companion\config.json` 和 `bot.json`；
  `bot.json` 是每次启动重写的派生文件。

## 10. 测试与提交

- 服务端纯函数（切分、标记解析、相似度、命令解析、要图识别、平台标记清洗）必须有单测；
- 聚合器的停口/最长等待/上限用 `node:test` 的 mock timers 测；
- 桌面端纯函数（配置、路径、锁、日志解析、进程命令、主题、更新）有单测；托盘/窗口需手动冒烟；
- 存储层的原子写与历史迁移有单测；真实 QQ 链路、真实更新链路仍无自动化测试（已知缺口）。
- 提交前跑：`pnpm typecheck` + `pnpm test`。
- commit message 用 `feat: / fix: / docs: / refactor: / chore:` 前缀，中文描述。

## 11. 常见维护任务

| 想做什么 | 改哪里 |
|---|---|
| 加/改设置项 | `apps/server/src/settings.ts`（字段、默认值、范围）→ `config.ts` 消费 → 设置页按 schema 自动渲染 |
| 调性格/口癖 | 人设编辑器写入 `%APPDATA%\whale-companion\persona.md`；默认人设在 `apps/server/persona.md` |
| 加斜杠命令 | `core/commands.ts` 的 `commands` 数组 |
| 改聚合时机/上限 | `config.ts` 的 `batch`（`silenceMs` / `maxWaitMs` / 上限） |
| 改记忆窗口 | `config.ts` 的 `history` |
| 改回复切分 | `core/reply.ts` + `config.reply` |
| 调表情包频率 | `config.ts` 的 `sticker` |
| 加新渠道（如微信/CLI） | 新建 `channels/xxx/`，调用 `core/chat.ts` 的 `generateReply`；主动消息在 `index.ts` 注入发送回调，**不要改 core** |
| 改主动消息策略 | `core/proactive.ts` + `config.proactive` |
| 改主题/配色 | `apps/desktop/src/lib/theme.ts` + `styles.css` 顶部 CSS 变量 + 设置页外观卡片 |
| 改自动更新 | `apps/desktop/src/lib/update.ts` + `useController` 的 `checkUpdate/installUpdate` + 发布工作流的校验文件 |
| 改 JSON 持久化/迁移 | `apps/server/src/store/atomic.ts`、`store/history.ts` 的 `sanitizeHistoryFile`、`channels/qq/migrate.ts` |
| 改桌面端页面 | `apps/desktop/src/components/` |
| 改托盘菜单/关闭行为 | `apps/desktop/src/hooks/useController.ts` |
| 改桌面端打包 | `apps/desktop/scripts/pack.mjs` |
| 换 README 截图 | 重新渲染并覆盖 `docs/screenshots/*.png`（真实组件 + 演示数据），步骤见 [`docs/README.md`](docs/README.md) |

## 12. 已知限制与候选升级

- 桌面版只有便携 zip，没有安装包；exe 未签名，可能触发 SmartScreen。
- 第二个实例只提示并退出，不会把已有窗口调到前台。
- 单测覆盖纯函数、聚合器、原子写与历史迁移；真实存储读写、WS 链路、Neutralino 托盘没有自动化测试。
- 挑图依赖标签质量；同义不同词（"高兴" vs "开心"）靠二元组会漏，可换向量模型。
- 主动消息受平台限制，不能保证送达。
- 自动更新只支持便携版，整包替换，没有增量；GitHub 不可达或安装目录不可写时只能手动更新。
- 自动更新的真实链路（下载/解压/替换/重启）没有自动化测试；改动后至少手动跑一次
  `buildUpdateScript` 的沙盒脚本，再在打包版上冒烟。
- 服务端只有简单的 SIGINT/SIGTERM 退出（不做 WS 优雅关闭）；桌面端退出时会 taskkill 进程树。

## 13. 环境变量

见 `apps/server/.env.example`。必填只有三个：`DEEPSEEK_API_KEY`、`QQBOT_APPID`、`QQBOT_SECRET`；其余都有默认值。

常用可调项：`DEEPSEEK_THINKING_EFFORT`（off/low/high/max）、`DEEPSEEK_TEMPERATURE`、
`DEEPSEEK_TIMEOUT_MS` / `DEEPSEEK_RETRIES`、`HISTORY_*`、`REPLY_MAX_CHARS`、
`BATCH_SILENCE_MS` / `BATCH_MAX_WAIT_MS`、`MEDIA_MAX_BYTES`、
`STICKER_*`、`PROACTIVE_*`、`OWNER_NAME`、`VISION_ENABLED`、`LLM_MAX_IMAGES`。

桌面端启动 Bot 时不走环境变量，而是写 `%APPDATA%\whale-companion\bot.json`，用 `--config` 传入；
`config.ts` 会把其中的值合并进 `process.env`。内部变量有 `WHALE_DATA_DIR`、
`WHALE_PERSONA_FILE`（APPDATA 覆盖）、`WHALE_DEFAULT_PERSONA_FILE`（安装目录默认）、
`WHALE_GUI`、`WHALE_PARENT_PID`，一般不用手动设置。

## 14. 桌面端（apps/desktop）

- **技术栈**：Neutralino 6（系统 WebView2）+ React 19 + Vite；只支持 Windows。
- **进程模型**：桌面端是父进程，Bot 是 `cmd.exe /c node server/index.js --config bot.json` 子进程；
  桌面端不 import 服务端源码。
- **Windows 大坑：不要给 `Neutralino.os.spawnProcess` 传 `envs`**。传了会整体替换环境块，
  丢失 `=C:`/`=D:` 这类隐藏盘符变量，`CreateProcess` 直接失败（表现为 `spawn` 返回 pid=0、退出码 -1）。
  配置写文件、走 `--config`，子进程继承环境。
- **停止 Bot**：用 `taskkill /PID <pid> /T /F` 杀进程树；只杀 `cmd.exe` 会留下 node。
- **单实例**：`app.lock` 存 PID + 心跳；先 `tasklist` 查 PID，查不出来再看 3 分钟内的最近心跳。
  第二个实例显示一句提示后退出，不抢 QQ 连接。模态框在部分环境会卡住，所以单实例提示不走 `showMessageBox`。
- **关闭行为**：默认隐藏到托盘；设置里可改为退出。退出时停 Bot、释放锁。
- **主题**：`config.appearance.theme` 为 `system | light | dark`，默认 `system`；
  `lib/theme.ts` 解析后写到 `<html data-theme>`，颜色全部用 `styles.css` 顶部的 CSS 变量。
  新增颜色不要再写死；日志面板固定深色，不跟随主题。
- **隐藏启动**：`setAutostart` 往注册表写 `--hidden`，`hasHiddenFlag(window.NL_ARGS)` 在初始化时识别并
  `hideWindow()`；配置不完整或 Bot 启动失败要 `showWindow()` 露脸，否则用户以为程序没启动。
- **设置页**：Tab 化（基础/人设/对话/主动/表情包/高级/数据），字段由 `settings.ts` 的
  `SETTINGS` 自动渲染；新增设置只需要改契约，不要手写一个输入框。
- **模型与思考**：`lib/llm.ts` 按 DeepSeek 文档发 `thinking` + `reasoning_effort`
  （off/low/high/max），思考开启时不发 temperature；非 DeepSeek 接口只发 `reasoning_effort`。
  模型选择下拉通过 `--list-models` 子进程调 `GET /models`。
- **人设**：默认人设在安装目录（只读，随更新替换）；用户编辑写入
  `%APPDATA%\whale-companion\persona.md`，由 `WHALE_PERSONA_FILE` 注入；恢复默认 = 删除覆盖文件。
- **一次性命令**：`--self-check`（配置/数据/人设/图库/QQ/LLM）、`--list-models`、`--retag`，
  都通过 `--config` 读临时配置，输出 `@@WHALE` 行。
- **数据管理**：设置页可导出/导入 zip（默认不含密钥）、删除单张表情包、重打标、按用户清对话/记忆；
  覆盖/删除前都会写 `*.bak-时间戳`。
- **自动更新**：`buildUpdateScript` 生成 PowerShell，等当前 PID 退出后覆盖便携目录，
  结果写 `updates/update-result.json`，下次启动由 `consumeUpdateResult` 消费；
  脚本要带 UTF-8 BOM，Windows PowerShell 5.1 才会按中文路径正确解析。
  覆盖前会把 exe/resources.neu/server 备份到 `updates/backup-*`，失败自动还原。
- **校验文件**：CI 生成 `SHA256SUMS.txt` 并随 Release 上传；更新时如果存在就校验，
  旧版本没有这个文件则跳过。发布工作流别漏传它。
- **路径**：配置 `config.json`、Bot 启动配置 `bot.json`、数据 `data/`、日志 `logs/`、锁 `app.lock`、
  更新缓存 `updates/` 都在 `%APPDATA%\whale-companion`。开发态数据目录仍是 `apps/server/data`，便于复用现有对话。
- **打包**：`pnpm desktop:pack` 会构建 server + 前端、`neu build`、复制 `node.exe` 和 `server/`、
  用 rcedit 写图标/版本，最后 `Compress-Archive` 成 `apps/desktop/dist/whale-companion-*-win-x64.zip`。
  `neu build` 的输出在 `dist/<binaryName>/`，里面才是 exe + `resources.neu`。
- **CI**：`.github/workflows/desktop.yml` 在 Windows runner 上跑 typecheck、测试、打包并上传 artifact；
  推 `v*` tag 时额外创建 GitHub Release 并附上 zip 与 `SHA256SUMS.txt`。
- **测试**：`pnpm --filter @apps/desktop test`；托盘/窗口/单实例仍需手动冒烟（用 UIA 或肉眼）。

## 15. 发版

- 版本号以根 `package.json` 为准；`scripts/release.mjs` 会同步根、server、desktop 和
  `neutralino.config.json` 的 `version`。
- 用法：`pnpm release patch|minor|major`，加 `--dry-run` 只预览。
- 前置条件：在 `main`、工作区干净、远程 `origin` 可推送。
- 脚本会先 `git pull --ff-only`，跑 `pnpm typecheck` + `pnpm test`，然后提交
  `chore: release vX.Y.Z`、打 annotated tag、推 `main` 和 tag。
- 推送失败时本地 commit/tag 会保留，按提示手动 `git push origin main && git push origin vX.Y.Z` 即可。
- tag 触发 CI：构建 zip → 生成 `SHA256SUMS.txt` → 上传 artifact →
  `gh release create`（已存在则 `upload --clobber`）。
  所以 workflow 需要 `permissions: contents: write`。
- 自动更新依赖 Release 里的 zip；有 `SHA256SUMS.txt` 时会一并校验。发版后可以在「关于」页手动检查一次。
- 不要在 CI 里跑 release 脚本；它只给本地维护者用。
- `CHANGELOG.md` 目前手工维护：发版前补一条并先提交（release 脚本要求工作区干净）。

## 16. 排障索引

| 症状 | 先看 |
|---|---|
| 桌面端 Bot 起不来 / 立刻退出 | `%APPDATA%\whale-companion\logs`、`bot.json`、`server/index.js`、`node.exe`；确认没有给 `spawnProcess` 传 `envs` |
| 托盘图标找不到 | Windows 隐藏图标区；`setTray` 是否报错；`/resources/icons/tray.png` 是否存在 |
| 第二个实例卡住 | 单实例提示不要用 `showMessageBox`；看 `app.lock`、心跳、`tasklist` |
| QQ 连接失败 / 4009 | `gateway` / `token` 日志；确认没有第二个 Bot 进程；检查 AppID/Secret |
| 回复发不出去 | `channels/qq/send.ts` 的 `msg_seq` 和 QQ 返回体 |
| 表情包不发 / 不匹配 | 标签质量、`MIN_SCORE`、冷却和 `allowRandom` |
| 记忆没生效 | `history.json` / `memory`、`prompt.ts` 的拼接、摘要阈值 |
| 检查更新失败 | GitHub 是否可达、`api.github.com` 是否被代理拦、是否触发限流（403） |
| 更新安装失败 | `%APPDATA%\whale-companion\updates\update.log` / `update-result.json`；安装目录是否可写；Bot 是否已停 |
| 主题切换无效 / 颜色错 | `config.appearance.theme`、`<html data-theme>`、`styles.css` 变量是否覆盖到；别写死颜色 |
| 开机自启仍然弹窗 | 注册表值是否带 `--hidden`、`window.NL_ARGS` 是否包含它、`hasHiddenFlag` 是否命中 |
| 打包失败 | `neu build` 的 `dist/<binaryName>/`、`resources/js/neutralino.js`、rcedit |
| CI Release 失败 | workflow 的 `contents: write`、`gh` 是否可用、tag 是否已存在 |
| 发版脚本中止 | 是否在 `main`、工作区是否干净、tag 是否重复、远程是否可推 |

## 17. License

AGPL-3.0-only，见根目录 `LICENSE`。网络服务也传染：衍生版本对外提供服务必须同样开源。
