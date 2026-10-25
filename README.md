# 小鲸鱼 · 独立陪伴 AI

一个**不依赖 DeepSeek Harness** 的 QQ 陪伴机器人：人设、记忆、表情包、主动搭话，Web 端当作调试台。

```
apps/
  server/   核心 + QQ 通道 + HTTP 接口
  web/      React 调试界面（Vite）
packages/   预留（以后放共享类型）
```

## 功能

- **QQ 私聊**：官方 Bot WebSocket 收、HTTP 回，自带心跳与断线重连
- **人设**：`apps/server/persona.md`，改完下一轮即生效
- **消息聚合**：连发多条 / 多图会合并成一轮再回复（默认停口 2.5 秒）
- **看图**：用户发图会下载并作为多模态输入
- **表情包图库**：收到的图自动入库并让模型打标签；按语义（字符二元组 + 余弦）挑最贴切的一张
- **像真人一样说话**：一条回复可拆成最多 3 条短消息，想发就紧跟一张表情包；时段与每日心情会影响语气
- **斜杠命令**：/help /new /forget /memory /remember /status
- **长期记忆**：历史过长自动压缩成摘要，摘要每轮注入 system
- **主动搭话**：空闲且非免打扰时段，她会自己说一句话（受平台主动消息额度限制，失败只记日志）

## 快速开始

```bash
pnpm install

# 1. 配置
cp apps/server/.env.example apps/server/.env
#   填入 DEEPSEEK_API_KEY / QQBOT_APPID / QQBOT_SECRET

# 2. 跑起来（server + web 一起）
pnpm dev
```

- 后端：http://localhost:3000
- 调试页：http://localhost:5173（Vite 代理 `/api` 到后端）

QQ 端：在 q.qq.com 把机器人「开发设置 → 事件订阅」设为 **WebSocket**，并把你的 QQ 号加进「内部体验号码」，然后在手机私聊它。

## 常用命令

```bash
pnpm dev          # 同时启动 server + web
pnpm typecheck    # 全仓类型检查
pnpm --filter server test   # 单测
```

## 目录说明（apps/server）

```
src/
  config.ts            环境变量集中读取
  core/                llm / persona / chat / tagger / summarize / proactive
  store/               history / memory / stickers / users（都是 data/ 下的 JSON）
  channels/qq/         token / send / media / aggregator / handler / gateway
  channels/web/        Hono 路由
  index.ts             启动 HTTP + QQ + 主动消息
```

**设计原则**：`core/chat.ts` 不知道消息从哪来；QQ 与 Web 只是两个"入口"。

## 数据存放

全部在 `apps/server/data/`（已 gitignore）：

| 文件 | 内容 |
|---|---|
| `history.json` | 每个用户的对话（按 `HISTORY_SEND` 窗口发送） |
| `memory/<userId>.json` | 长期摘要 |
| `stickers/` | 表情包图片 + `index.json`（标签） |
| `users.json` | 谁来过、上次主动打扰时间 |

## 已知限制

- QQ 主动消息受平台额度限制，可能直接被拒（日志里会有 `主动消息失败`）
- 表情包挑图是「标签相似度 + 随机兜底」，标签质量取决于模型打标
- Web 端只做调试，和 QQ 共用同一份服务端历史（用户 id 分别为 `web` / openid）

## 命令

| 命令 | 作用 |
|---|---|
| `/help` | 命令清单 |
| `/new` | 清空对话，重新开始（保留长期记忆） |
| `/forget` | 连记忆一起清空 |
| `/memory` | 查看她记得什么 |
| `/remember 内容` | 手动写入一条事实 |
| `/status` | 对话条数 / 记忆 / 图库 / 上次主动时间 |
