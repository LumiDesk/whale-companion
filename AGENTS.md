# AGENTS.md — whale-companion 维护指南

写给在此仓库工作的 AI 代理与未来的自己。**中文沟通**。

## 1. 这是什么

一个**独立**的 QQ 陪伴机器人（不依赖 DeepSeek Harness）：人设、多轮对话、长期记忆、表情包、主动搭话。
聊天通道只有 QQ 私聊；另有一个 Windows 桌面控制台（Neutralino）负责设置、状态、日志和托盘。
没有 Web 调试台，也没有 HTTP 服务。

**不是**：agent 平台、工具执行器、文件操作机器人、多用户 SaaS。别往里塞这些。

## 2. 技术栈与命令

- Node ≥ 22 + TypeScript（`tsx` 直跑，不编译）
- 没有 Web 框架：QQ 官方 API 用原生 `fetch` + `WebSocket`
- 桌面端：Neutralino 6 + React 19 + Vite（Windows only）
- pnpm workspaces：`apps/server` + `apps/desktop`
- 模型：DeepSeek OpenAI 兼容接口

```bash
pnpm dev                              # 只启动机器人（tsx watch）
pnpm desktop:dev                      # 启动桌面控制台
pnpm typecheck                        # 两个包都查
pnpm test                             # 两个包的单测
pnpm build                            # tsc → apps/server/dist
pnpm desktop:pack                     # 打 Windows 便携 zip
pnpm release patch|minor|major        # 发版（bump + tag + push，触发 CI）
```

## 3. 目录地图

```
apps/server/
  persona.md              人设正文（每轮现读，改完下一条生效）
  src/config.ts           所有环境变量在此收口；缺必填项启动即报错
  src/core/               llm / persona / prompt / chat / reply / tagger / summarize / proactive / commands / mood / sticker-*
  src/store/              history / memory / stickers / users（只碰 data/ 下的 JSON 与文件）
  src/channels/qq/        token / send / media / text / aggregator / handler / gateway
  src/index.ts            组合根：启动 QQ + 主动消息 + 补齐标签

apps/desktop/
  neutralino.config.json  窗口、托盘图标、native API 白名单
  src/lib/                配置/路径/锁/日志/进程命令（纯函数，有单测）
  src/hooks/useController 托盘、子进程、单实例、状态与日志编排
  src/components/         状态页 / 设置页 / 日志页 / 关于
```

**分层铁律**

1. `core/` 不知道消息从哪来，也不直接发 QQ；主动消息只接受注入的 `send` 回调；
2. `channels/` 只做传输（收事件、发消息、下载附件、清洗平台标记），业务逻辑回 `core/`；
3. `store/` 只做持久化，不做业务判断；
4. 渠道之间不互相 import；
5. 桌面端不 import 服务端源码，只通过「启动子进程 + `--config` + stdout 状态行」控制 Bot。

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
- 主动消息发出后也要写进历史，否则下一轮她不知道自己说过。

## 6. 表情包机制

- 收图 → 立即 `ingestSticker`（标签先空着）→ `queueStickerTagging` 后台打标（并发 2）→ `updateStickerTags` 回填；
- 启动时 `retagUntaggedStickers()` 给历史遗留的无标签图补标；
- 挑图 → `core/sticker-search.ts`：字符二元组 + 余弦，阈值为 `MIN_SCORE = 0.12`；
- **模型主动要图只发命中的**（`allowRandom: false`）；用户明确说「发个表情包」才允许随机兜底；
- 用户要图的识别与关键词抽取在 `core/sticker-request.ts`（别把「你发的表情包好好笑」当请求）；
- 同一用户 8 分钟冷却（`STICKER_COOLDOWN_MS`），自发率 0.05（`STICKER_CHANCE`）。

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
- 发图/存图都在本机，不经过第三方。

## 10. 测试与提交

- 服务端纯函数（切分、标记解析、相似度、命令解析、要图识别、平台标记清洗）必须有单测；
- 聚合器的停口/最长等待/上限用 `node:test` 的 mock timers 测；
- 桌面端纯函数（配置、路径、锁、日志解析、进程命令）有单测；托盘/窗口需手动冒烟；
- 存储层与真实 QQ 链路仍无测试（已知缺口）。
- 提交前跑：`pnpm typecheck` + `pnpm test`。
- commit message 用 `feat: / fix: / docs: / refactor: / chore:` 前缀，中文描述。

## 11. 常见维护任务

| 想做什么 | 改哪里 |
|---|---|
| 调性格/口癖 | `apps/server/persona.md`（即时生效） |
| 加斜杠命令 | `core/commands.ts` 的 `commands` 数组 |
| 改聚合时机/上限 | `config.ts` 的 `batch`（`silenceMs` / `maxWaitMs` / 上限） |
| 改记忆窗口 | `config.ts` 的 `history` |
| 改回复切分 | `core/reply.ts` + `config.reply` |
| 调表情包频率 | `config.ts` 的 `sticker` |
| 加新渠道（如微信/CLI） | 新建 `channels/xxx/`，调用 `core/chat.ts` 的 `generateReply`；主动消息在 `index.ts` 注入发送回调，**不要改 core** |
| 改主动消息策略 | `core/proactive.ts` + `config.proactive` |
| 改桌面端页面 | `apps/desktop/src/components/` |
| 改托盘菜单/关闭行为 | `apps/desktop/src/hooks/useController.ts` |
| 改桌面端打包 | `apps/desktop/scripts/pack.mjs` |

## 12. 已知限制与候选升级

- 桌面版只有便携 zip，没有安装包；exe 未签名，可能触发 SmartScreen。
- 第二个实例只提示并退出，不会把已有窗口调到前台。
- 单测覆盖纯函数与聚合器；存储读写、真实 WS 链路、Neutralino 托盘没有自动化测试。
- 挑图依赖标签质量；同义不同词（"高兴" vs "开心"）靠二元组会漏，可换向量模型。
- 主动消息受平台限制，不能保证送达。
- `history.json` 每次全量重写，无原子写；单用户小规模没问题，并发写入会丢数据。
- 服务端没有优雅退出（SIGINT 清理定时器/WS）；桌面端退出时会 taskkill 进程树。

## 13. 环境变量

见 `apps/server/.env.example`。必填只有三个：`DEEPSEEK_API_KEY`、`QQBOT_APPID`、`QQBOT_SECRET`；其余都有默认值。

常用可调项：`DEEPSEEK_TIMEOUT_MS` / `DEEPSEEK_RETRIES`、`HISTORY_*`、`BATCH_SILENCE_MS` / `BATCH_MAX_WAIT_MS`、`REPLY_MAX_CHARS`、`MEDIA_MAX_BYTES`、`STICKER_CHANCE` / `STICKER_COOLDOWN_MS`、`PROACTIVE_*`。

桌面端启动 Bot 时不走环境变量，而是写 `%APPDATA%\whale-companion\bot.json`，用 `--config` 传入；
`config.ts` 会把其中的值合并进 `process.env`。内部变量有 `WHALE_DATA_DIR`、`WHALE_PERSONA_FILE`、
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
- **路径**：配置 `config.json`、Bot 启动配置 `bot.json`、数据 `data/`、日志 `logs/`、锁 `app.lock`
  都在 `%APPDATA%\whale-companion`。开发态数据目录仍是 `apps/server/data`，便于复用现有对话。
- **打包**：`pnpm desktop:pack` 会构建 server + 前端、`neu build`、复制 `node.exe` 和 `server/`、
  用 rcedit 写图标/版本，最后 `Compress-Archive` 成 `apps/desktop/dist/whale-companion-*-win-x64.zip`。
  `neu build` 的输出在 `dist/<binaryName>/`，里面才是 exe + `resources.neu`。
- **CI**：`.github/workflows/desktop.yml` 在 Windows runner 上跑 typecheck、测试、打包并上传 artifact；
  推 `v*` tag 时额外创建 GitHub Release 并附上 zip。
- **测试**：`pnpm --filter @apps/desktop test`；托盘/窗口/单实例仍需手动冒烟（用 UIA 或肉眼）。

## 15. 发版

- 版本号以根 `package.json` 为准；`scripts/release.mjs` 会同步根、server、desktop 和
  `neutralino.config.json` 的 `version`。
- 用法：`pnpm release patch|minor|major`，加 `--dry-run` 只预览。
- 前置条件：在 `main`、工作区干净、远程 `origin` 可推送。
- 脚本会先 `git pull --ff-only`，跑 `pnpm typecheck` + `pnpm test`，然后提交
  `chore: release vX.Y.Z`、打 annotated tag、推 `main` 和 tag。
- 推送失败时本地 commit/tag 会保留，按提示手动 `git push origin main && git push origin vX.Y.Z` 即可。
- tag 触发 CI：构建 zip → 上传 artifact → `gh release create`（已存在则 `upload --clobber`）。
  所以 workflow 需要 `permissions: contents: write`。
- 不要在 CI 里跑 release 脚本；它只给本地维护者用。

## 16. License

AGPL-3.0-only，见根目录 `LICENSE`。网络服务也传染：衍生版本对外提供服务必须同样开源。
