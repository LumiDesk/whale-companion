# AGENTS.md

- 本项目为 **Node.js + TypeScript 的 QQ 陪伴机器人**（独立运行，不依赖 DeepSeek Harness），附带 **Windows 桌面控制台**
- 仓库形态：pnpm workspaces，`apps/server`（Bot）+ `apps/desktop`（控制台）
- 包管理器：**pnpm 12**（`pnpm-lock.yaml` 不许手改）
- 运行环境：Node ≥ 22；桌面端 **Neutralino 6 + React 19 + Vite**，仅 Windows
- 样式方案：原生 CSS + CSS 变量（`apps/desktop/src/styles.css`），无 UI 组件库
- 模型：DeepSeek OpenAI 兼容接口
- 设计规范：[`DESIGN.md`](DESIGN.md)（改界面前必读）
- 版本号以根 `package.json` 为准，记录见 [`CHANGELOG.md`](CHANGELOG.md)

> **发版只能由用户执行。** 代理不许运行 `pnpm release`、打 tag、创建/修改 GitHub Release，
> 也不许改任何 `version` 字段。代理只负责代码、结构与 commit。

## Project Structure

```
apps/
├── server/                     # Bot 本体（tsx 直跑，tsc 构建到 dist/）
│   ├── persona.md              # 默认人设（随版本更新，用户覆盖在 APPDATA）
│   └── src/
│       ├── core/               # 对话、提示词、记忆压缩、心情、表情包、主动消息、命令
│       ├── store/              # history / memory / stickers / users / atomic（只碰 data/）
│       ├── channels/qq/        # gateway / aggregator / handler / send / media / token / reconnect
│       ├── settings.ts         # 配置契约（纯函数，桌面端只读复用）
│       ├── config.ts           # env / --config → runtime config
│       ├── types/              # 消息与多模态类型
│       └── index.ts            # 组合根
└── desktop/                    # Windows 控制台
    └── src/
        ├── pages/              # 页面：Status / Settings / Logs / About
        │   └── settings/       # 设置页子组件：Field / ModelPicker / PersonaEditor / SelfCheck
        ├── components/         # 通用组件：Sidebar / MessageBanner / ErrorBoundary
        │   └── ui/             # 基础控件：Icons / Switch
        ├── hooks/              # useController（托盘、子进程、更新、状态与日志编排）
        ├── lib/                # 纯函数：config / paths / lock / logs / process / theme / update
        └── styles.css          # 色板与全部样式（CSS 变量在顶部）

docs/                           # 截图、架构图（见 docs/README.md）
scripts/release.mjs             # 发版脚本（仅用户执行）
```

## Architecture Rules

- `core/` 不知道消息从哪来，也不直接发 QQ；主动消息只接受注入的 `send` 回调
- `channels/` 只做传输（收事件、发消息、下附件、清洗平台标记）；`store/` 只做持久化
- 渠道之间不互相 import；加新渠道只新建 `channels/xxx/`，不要改 `core/`
- 桌面端 **不 import 服务端源码**，只通过「启动子进程 + `--config` + stdout `@@WHALE` 状态行」控制 Bot
- **唯一例外**：`apps/server/src/settings.ts` 可被桌面端只读 import（无 `node:*`、无 `process.env`、无 DOM）
- 配置链路：`config.json` v2 → `toEnv` → `bot.json` → `fromEnv` 校验

## Message Flow

```
QQ 事件 → cleanQQContent 清洗 → 串行下载图（单张 8MB）
        → 聚合（停口 3s / 最长 10s / 10 条或 6 图）
        → 命令？ → 收图入库（打标丢后台）→ core.generateReply
        → 剥 [表情包:关键词] → 整条发送（>500 字才切）→ 想发就跟一张图
```

关键文件：`channels/qq/aggregator.ts`、`channels/qq/handler.ts`、`core/chat.ts`、`core/reply.ts`、`core/prompt.ts`。

## Domain Notes

- **记忆两级**：`history.json`（落盘 200 / 每轮发 40）+ `memory/<userId>.json`（摘要 ≤200 字 + facts ≤20 条）；
  150 条触发压缩，压缩期间有新消息 / `/new` / `/forget` 就丢弃快照
- **system 不落盘**，每轮由 `core/prompt.ts` 现拼（人设 + 记忆 + 此刻 + 心情 + 图库可用性）
- **表情包**：收图即入库、后台打标；挑图用字符二元组 + 余弦（阈值 0.12）；模型主动要图只发命中的；
  同一用户 8 分钟冷却
- **主动消息**：45 分钟 tick，闲置 3 小时–7 天，免打扰 23–9，失败只记日志
- **命令**：`core/commands.ts` 的数组驱动（`/help /new /forget /memory /remember /status`）

## QQ Pitfalls

1. **发图必须 JSON + `file_data` base64**；multipart 会 `40093007`，base64 不能带 `data:` 前缀
2. **同一 `msg_id` 多次回复要带递增 `msg_seq`**，否则后一条被丢
3. **一个 AppID 只能一条 WS 连接**；`4009` = 会话过期，**必须重连**（策略在 `channels/qq/reconnect.ts`），
   连续「刚连上就被踢」才放慢到 5 分钟，永不永久退出
4. intents 用 `1 << 25`；token 两小时过期，重连时自然刷新
5. 入历史前必须 `cleanQQContent`，否则模型看到 `<faceType=...>` 这类 base64
6. **WS 事件处理要串行**（`gateway.ts` 的 `inbound` 链），否则顺序和 `msg_id` 会错
7. 单张图片上限 8MB，超了跳过并记日志
8. 回复默认一条发完，别恢复「拆三条」

## Coding Style

**TypeScript**

- 用 `interface` 定义 Props / 数据类型；组件用函数声明，不写 `React.FC`
- 相对 import 必须带 `.js` 后缀（服务端 Node ESM）；内置模块用 `node:` 前缀
- **Never 用 `any` 兜底**：外部数据先收窄再用；QQ 字段不稳定，解析前先打印真实结构
- **错误不许静默**：网络/上游失败带状态码与响应体片段抛出，对外回复保持人话
- 模型请求必须有超时（`DEEPSEEK_TIMEOUT_MS`）；只有网络错误 / 5xx / 429 才重试

**样式**

- 颜色、圆角、间距只用 `styles.css` 顶部 CSS 变量；新增颜色同时补 `[data-theme="dark"]`
- 布尔用 `Switch`，2–7 项单选用 `.segmented`；不写 `<input type="checkbox">` / `type="radio"`
- Never 写死颜色、Never 用内联样式（动态进度条宽度除外）、Never 用 emoji 当图标

**桌面端**

- 设置字段由 `settings.ts` 的 `SETTINGS` 自动渲染，**不要手写输入框**
- 页面放 `pages/`，可复用的放 `components/`，纯函数放 `lib/`，编排放 `hooks/`

## Build Commands

```bash
pnpm dev                    # 只启动 Bot（tsx watch）
pnpm build                  # 构建 Bot（apps/server/dist）
pnpm desktop:dev            # 启动桌面控制台（需先 pnpm build）
pnpm typecheck              # 两个包都查（提交前必跑）
pnpm test                   # 两个包的单测（提交前必跑）
pnpm lint:prettier          # Prettier 格式化
pnpm desktop:pack           # 打 Windows 便携 zip（仅用户执行）
```

## Never 规则

- **Never 自行发版**：`pnpm release`、git tag、`gh release`、任何 `version` 字段都只能由用户操作
- Never 修改 `pnpm-lock.yaml`
- Never 修改构建产物：`apps/server/dist/`、`apps/desktop/resources/`、`apps/desktop/dist/`
- Never 用 `writeFileSync` 直接覆盖 `data/*.json`（走 `store/atomic.ts` 的原子写）
- Never 给 `Neutralino.os.spawnProcess` 传 `envs`（会丢隐藏盘符变量，`CreateProcess` 直接失败）
- Never 把 `4009` 当致命错误（2026-10-26 因此静默离线 2.5 小时）
- Never 在组件里写死颜色 / 圆角 / 间距
- Never 在渲染路径里做耗时操作；列表渲染必须带 `key`
- Never 提交 `.env`、`config.json`、`bot.json`、`data/`、`logs/`（已 gitignore）
- Never 让桌面端 import `apps/server/src` 的其他模块（`settings.ts` 除外）

## Commit 规范

- 格式：`type(scope): 中文描述`
- 类型：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`
- scope（可选）：`server` / `desktop` / `qq` / `ui` / `docs`
- 一个提交只做一件事；提交前跑 `pnpm typecheck` + `pnpm test`
- 不要提交无关格式化；不要 amend 已推送的提交

## 发版（仅用户执行）

- 用户执行 `pnpm release patch|minor|major`：bump 四个版本文件 → 跑检查 → 提交 `chore: release vX.Y.Z` → 打 tag → 推 main 与 tag
- tag 触发 CI：构建 zip + `SHA256SUMS.txt` → 创建 **pre-release**
- 客户端默认只查正式 Release；用户在 GitHub 把 pre-release 转正式后，客户端才看得到
- 关于页有「接收预发布版本」开关（`behavior.includePrerelease`），只影响本机检查更新
- 代理需要发版时：**提示用户自己执行**，不要代劳

## Troubleshooting

| 症状 | 先看 |
|---|---|
| Bot 起不来 / 立刻退出 | `%APPDATA%\whale-companion\logs`、`bot.json`；确认没给 `spawnProcess` 传 `envs` |
| QQ 连不上 / 4009 | `gateway` 日志；4009 会自动重连，连续被踢说明双开 |
| 托盘没图标 | Windows 隐藏图标区；`/resources/icons/tray.png` |
| 检查更新失败 | GitHub 可达性、`api.github.com` 是否被代理拦、是否 403 限流 |
| 更新安装失败 | `updates/update.log`、`update-result.json`；安装目录可写、Bot 已停 |
| 表情包不发 | 标签质量、`STICKER_MIN_SCORE`、冷却、`allowRandom` |
| 记忆没生效 | `history.json` / `memory/`、`prompt.ts` 拼接、压缩阈值 |

## License

AGPL-3.0-only。衍生版本对外提供网络服务必须同样开源。
