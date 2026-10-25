# AGENTS.md — whale-companion 维护指南

写给在此仓库工作的 AI 代理与未来的自己。**中文沟通**。

## 1. 这是什么

一个**独立**的 QQ 陪伴机器人（不依赖 DeepSeek Harness）：人设、多轮对话、长期记忆、表情包、主动搭话。
Web 端只是调试台，不是产品形态。

**不是**：agent 平台、工具执行器、文件操作机器人、多用户 SaaS。别往里塞这些。

## 2. 技术栈与命令

- Node ≥ 22 + TypeScript（`tsx` 直跑，不编译）
- 后端 Hono（`@hono/node-server`），前端 React + Vite
- pnpm workspaces，`apps/*` 两个包
- 模型：DeepSeek OpenAI 兼容接口，原生 `fetch`

```bash
pnpm dev                          # server + web 并行
pnpm typecheck                    # 两个包都查
pnpm --filter @apps/server test   # 单测（tsx --test）
pnpm --filter @apps/server dev    # 只跑机器人
```

## 3. 目录地图

```
apps/server/
  persona.md              人设正文（每轮现读，改完下一条生效）
  src/config.ts           所有环境变量在此收口；缺变量启动即报错
  src/core/               llm / persona / prompt / chat / reply / tagger / summarize / proactive / commands / mood / sticker-*
  src/store/              history / memory / stickers / users（只碰 data/ 下的 JSON 与文件）
  src/channels/qq/        token / send / media / aggregator / handler / gateway
  src/channels/web/       Hono 路由
  src/index.ts            启动 HTTP + QQ + 主动消息
apps/web/                 React 调试页（Vite 代理 /api）
```

**分层铁律**

1. `core/` 不知道消息从哪来，也不直接发 QQ；
2. `channels/` 只做传输（收事件、发消息、下载附件），业务逻辑回 `core/`；
3. `store/` 只做持久化，不做业务判断；
4. 渠道之间不互相 import。

## 4. 一次消息的完整链路

```
QQ 事件 → 下载图片 → 聚合器（停口 2.5s 或攒满）→ 命令? → 入库打标 → core.generateReply
        → 剥 [表情包:关键词] → 拆分（|| / 空行 / 长句断句）→ 逐条发送（msg_seq 递增）→ 最后发图
```

关键文件：`channels/qq/aggregator.ts`（聚合）、`core/chat.ts`（对话）、`core/reply.ts`（标记与拆分）、`channels/qq/handler.ts`（编排）。

## 5. 记忆是两级的

| 层 | 位置 | 规则 |
|---|---|---|
| 原文 | `data/history.json` | 存 `HISTORY_STORE`（默认 200）条；每轮只发 `HISTORY_SEND`（40）条 |
| 长期 | `data/memory/<userId>.json` | `summary`（≤200 字）+ `facts`（≤20 条），每轮注入 system |

- 攒到 `HISTORY_SUMMARIZE_AT`（150）条时，后台把老的压成摘要，原文只留 `HISTORY_KEEP_AFTER`（20）条；
- `facts` 可被用户用 `/remember` 直接写入；
- **system 不落盘**，每轮由 `core/prompt.ts` 现拼（人设 + 记忆 + 此刻 + 心情 + 表情包可用性）。

## 6. 表情包机制

- 收图 → `core/tagger.ts` 让模型打 3~5 个中文标签 → `store/stickers.ts` 落盘 + 索引；
- 挑图 → `core/sticker-search.ts`：字符二元组 + 余弦，阈值为 `MIN_SCORE = 0.12`；
- **模型主动要图只发命中的**（`allowRandom: false`）；用户明确说「发个表情包」才允许随机兜底；
- 同一用户 8 分钟冷却（`STICKER_COOLDOWN_MS`），自发率 0.05（`STICKER_CHANCE`）。

## 7. QQ 平台踩过的坑（别再踩）

1. **发图上传必须 JSON + `file_data` base64**。multipart 会返回 `40093007 富媒体文件下载失败`；base64 不能带 `data:` 前缀。
2. **同一条 `msg_id` 多次回复要带递增的 `msg_seq`**，否则后一条会被丢。
3. **主动消息不带 `msg_id`** 需要平台额度，可能直接拒绝 → 现在只记日志，不许让它拖垮主流程。
4. **一个 AppID 只能有一条 WS 连接**，重复连接会 `4009` 互踢；代码里 4009/4006/4007/4008 一律不重连。
5. intents 用 `1 << 25`（群 + C2C）；token 两小时过期，`channels/qq/token.ts` 有缓存，重连时自然刷新。
6. 服务端推的一切都可能是「非预期 op」，解析必须 try/catch。

## 8. 代码约定

- ESM：相对 import 必须带 `.js` 后缀；内置模块用 `node:` 前缀。
- 不引入 dotenv，用 `tsx --env-file=.env`。
- **错误不许静默**：网络/上游失败要带状态码与响应体片段抛出来；对外回复保持人话（如 502「模型服务暂时不可用」），日志里留真相。
- 拿不准的字段先打印真实结构，再写解析（QQ 接口字段并不稳定）。
- 时间/心情这类"背景信息"写进 system，但明确告诉模型"不要直说"。

## 9. 数据与隐私

- `apps/server/data/` 全部 gitignore：对话、记忆、图库、users。
- `.env` 不提交；`.env.example` 是模板。
- 发图/存图都在本机，不经过第三方。

## 10. 测试与提交

- 纯函数（拆分、解析、相似度、命令解析）必须有单测；存储层与聚合时序目前无测试（已知缺口）。
- 提交前跑：`pnpm typecheck` + `pnpm --filter @apps/server test`。
- commit message 用 `feat: / fix: / docs: / refactor: / chore:` 前缀，中文描述。

## 11. 常见维护任务

| 想做什么 | 改哪里 |
|---|---|
| 调性格/口癖 | `apps/server/persona.md`（即时生效） |
| 加斜杠命令 | `core/commands.ts` 的 `commands` 数组 |
| 改聚合时机/上限 | `config.ts` 的 `batch` |
| 改记忆窗口 | `config.ts` 的 `history` |
| 调表情包频率 | `config.ts` 的 `sticker` |
| 加新渠道（如微信/CLI） | 新建 `channels/xxx/`，调用 `core/chat.ts` 的 `generateReply`，**不要改 core** |
| 改主动消息策略 | `core/proactive.ts` + `config.proactive` |

## 12. 已知限制与候选升级

- 单测只覆盖纯函数；聚合器的时序、存储读写没有测试。
- 挑图依赖标签质量；同义不同词（"高兴" vs "开心"）靠二元组会漏，可换向量模型。
- 主动消息受平台限制，不能保证送达。
- Web 端只有最小聊天页，与 QQ 各自一份历史（用户 id 分别是 `web` / openid）。
- 没有 CI、没有 LICENSE 文件、没有优雅退出（SIGINT 清理定时器）。

## 13. 环境变量

见 `apps/server/.env.example`。必填只有三个：`DEEPSEEK_API_KEY`、`QQBOT_APPID`、`QQBOT_SECRET`；其余都有默认值。
