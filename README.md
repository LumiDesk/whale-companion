# 小鲸鱼 · 独立陪伴 AI

一个**不依赖 DeepSeek Harness** 的 QQ 陪伴机器人：人设、多轮对话、长期记忆、表情包、主动搭话。

除了 QQ 通道，现在还有一个 Windows 桌面控制台：设置、状态、日志、托盘，双击就能用。

> 最新版本见 [Releases](https://github.com/Talyra42/whale-companion/releases) · [更新日志](CHANGELOG.md)

## 功能

- **QQ 私聊**：官方 Bot WebSocket 收、HTTP API 回，自带心跳与断线重连
- **桌面控制台**：填写 QQ / DeepSeek 配置、看运行状态、实时日志；托盘里暂停 / 重启 / 退出
- **人设**：`apps/server/persona.md`，改完下一轮即生效
- **消息聚合**：连发多条 / 多图会合并成一轮再回复（停口 3 秒，最多等 10 秒，不会一直发就一直不回）
- **看图**：用户发图会下载并作为多模态输入；单张超过 8MB 自动跳过
- **表情包图库**：收到的图立即入库，标签在后台补；按语义（字符二元组 + 余弦）挑最贴切的一张
- **像真人一样说话**：一条消息说完，只有超长才在自然停顿处切开；想发就紧跟一张表情包
- **斜杠命令**：/help /new /forget /memory /remember /status
- **长期记忆**：历史过长自动压缩成摘要，摘要每轮注入 system
- **主动搭话**：空闲且非免打扰时段，她会自己说一句话（受平台主动消息额度限制，失败只记日志）
- **自动补标**：启动时把上次没打完标签的表情包补上

## 快速开始

### 方式一：桌面版（推荐）

从 [Releases](https://github.com/Talyra42/whale-companion/releases) 下载 `whale-companion-*-win-x64.zip`，或本地 `pnpm desktop:pack`，解压后双击 `WhaleCompanion.exe`。

首次启动（没有配置时）会打开设置页，填写：

- QQ Bot 的 AppID / AppSecret（q.qq.com → 开发设置）
- DeepSeek API Key

保存后 Bot 自动启动。便携包自带 `node.exe`，不需要另外装 Node。
如果已有 `.env`，可以放到 `WhaleCompanion\server\.env`，然后在设置页点「从 .env 导入」。

数据都在 `%APPDATA%\whale-companion`：

```
config.json     桌面端设置
bot.json        启动 Bot 用的临时配置（含密钥）
data/           聊天记录、记忆、表情包
logs/           每日日志
app.lock        单实例锁
```

### 方式二：命令行

```bash
pnpm install

# 1. 配置
cp apps/server/.env.example apps/server/.env
#   填入 DEEPSEEK_API_KEY / QQBOT_APPID / QQBOT_SECRET

# 2. 跑起来
pnpm dev
```

QQ 端：在 q.qq.com 把机器人「开发设置 → 事件订阅」设为 **WebSocket**，并把你的 QQ 号加进「内部体验号码」，然后在手机私聊它。

## 桌面控制台

- **状态页**：运行状态、QQ 连接、运行时长、最近消息、最近日志
- **设置页**：AppID / AppSecret / API Key、关闭窗口行为、开机自启；支持从 `.env` 导入
- **日志页**：实时输出、搜索、按来源筛选、自动滚动、打开日志目录
- **托盘菜单**：显示主界面、暂停/启动、重启、打开日志/数据目录、退出
- **关闭行为**：默认最小化到托盘，也可以设为直接退出
- **单实例**：检测到已运行时会提示并退出，不会抢 QQ 连接
- **生命周期**：关闭程序会停掉 Bot；GUI 崩溃时 Bot 会通过父进程看门狗自己退出

## 常用命令

```bash
pnpm dev                              # 只启动机器人（tsx watch）
pnpm build                            # 先构建 Bot（desktop:dev 需要）
pnpm desktop:dev                      # 启动桌面控制台
pnpm desktop:pack                     # 打 Windows 便携 zip
pnpm typecheck                        # 两个包都查
pnpm test                             # 两个包的单测
```

打包产物：`apps/desktop/dist/whale-companion-<version>-win-x64.zip`。

## 目录说明

```
apps/
  server/               Bot 本体：核心对话 + QQ 通道
  desktop/              Windows 桌面控制台（Neutralino + React）
```

`apps/server/src`：

```
config.ts            环境变量 / --config 集中读取
core/                llm / persona / prompt / chat / reply / tagger / summarize / proactive / commands / mood / sticker-*
store/               history / memory / stickers / users（只碰 data/ 下的 JSON 与文件）
channels/qq/         token / send / media / text / aggregator / handler / gateway
index.ts             启动 QQ + 主动消息 + 补齐标签
```

`apps/desktop/src`：

```
lib/                 配置、路径、锁、日志解析、进程命令（纯函数，有单测）
hooks/useController  托盘、子进程、单实例、状态与日志的编排
components/          状态页 / 设置页 / 日志页 / 关于
```

**设计原则**：`core/chat.ts` 不知道消息从哪来；主动消息的发送方式由 `index.ts` 注入。
桌面端不 import 服务端源码，只通过「启动子进程 + `--config` + stdout 状态行」控制 Bot。

## 数据存放

命令行模式在 `apps/server/data/`；桌面版在 `%APPDATA%\whale-companion\data`。
两边结构一样（已 gitignore）：

| 文件 | 内容 |
|---|---|
| `history.json` | 每个用户的对话（按 `HISTORY_SEND` 窗口发送） |
| `memory/<userId>.json` | 长期摘要 + 手动记住的事实 |
| `stickers/` | 表情包图片 + `index.json`（标签） |
| `users.json` | 谁来过、上次主动打扰时间 |

想沿用命令行模式的历史，把 `apps/server/data` 整个复制到 `%APPDATA%\whale-companion\data` 即可。

## 发版

```bash
pnpm release patch      # 0.1.1 -> 0.1.2
pnpm release minor      # 0.1.1 -> 0.2.0
pnpm release major      # 0.1.1 -> 1.0.0
pnpm release patch --dry-run   # 只看会改什么，不提交
```

脚本会：检查当前在 `main`、工作区干净 → 拉取远程 → 跑 typecheck 和测试 →
同步四个版本文件 → 提交 `chore: release vX.Y.Z` → 打 tag → 推送。
CI 收到 `v*` tag 后会构建便携包，并自动创建 GitHub Release。

版本号以根 `package.json` 为准。发版前记得在 [`CHANGELOG.md`](CHANGELOG.md) 补一条记录（目前手工维护）。

## CI

`.github/workflows/desktop.yml` 在 Windows runner 上跑 typecheck、测试和 `desktop:pack`，
把便携 zip 作为 artifact 上传。

- 手动触发：只上传 artifact
- 推送 `v*` tag：额外创建 GitHub Release 并附上 zip

## 已知限制

- QQ 主动消息受平台额度限制，可能直接被拒（日志里会有 `主动消息失败`）
- 表情包挑图是「标签相似度 + 随机兜底」，标签质量取决于打标模型
- 桌面版目前只有便携 zip，还没做安装包
- exe 未签名，首次运行可能遇到 SmartScreen「未知发布者」
- 第二个实例只提示并退出，不会把已有窗口调到前台
- 桌面版和命令行版数据目录独立，迁移需要手动复制
- 密钥以明文保存在用户目录（`config.json` / `bot.json`），和原来的 `.env` 一致
- 存储读写、真实 QQ 链路、Neutralino 托盘/窗口目前没有自动化测试

## 文档

- [维护指南](AGENTS.md) —— 架构、分层、QQ / Windows 踩坑、排障索引
- [桌面端开发与打包](apps/desktop/README.md)
- [服务端说明](apps/server/README.md)
- [更新日志](CHANGELOG.md)
- [License](LICENSE)

## License

[AGPL-3.0-only](LICENSE) © 2026 Talyra42

简单说：你可以改、可以自己跑，但如果拿它（或改过的版本）对外提供网络服务，必须把源码同样以 AGPL 开放。想闭源商用是不行的。
