# 小鲸鱼 · 独立陪伴 AI

一个**不依赖 DeepSeek Harness** 的 QQ 陪伴机器人：人设、多轮对话、长期记忆、表情包、主动搭话。

只有一个通道：QQ 私聊。没有 Web 调试台，也没有多余的壳。

## 功能

- **QQ 私聊**：官方 Bot WebSocket 收、HTTP 回，自带心跳与断线重连
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

```bash
pnpm install

# 1. 配置
cp apps/server/.env.example apps/server/.env
#   填入 DEEPSEEK_API_KEY / QQBOT_APPID / QQBOT_SECRET

# 2. 跑起来
pnpm dev
```

QQ 端：在 q.qq.com 把机器人「开发设置 → 事件订阅」设为 **WebSocket**，并把你的 QQ 号加进「内部体验号码」，然后在手机私聊它。

## 常用命令

```bash
pnpm dev                              # 启动机器人（tsx watch）
pnpm typecheck                        # 类型检查
pnpm --filter @apps/server test       # 单测
pnpm build                            # tsc 产物到 apps/server/dist
```

## 目录说明（apps/server）

```
src/
  config.ts            环境变量集中读取（缺必填项启动即报错）
  core/                llm / persona / prompt / chat / reply / tagger / summarize / proactive / commands / mood / sticker-*
  store/               history / memory / stickers / users（只碰 data/ 下的 JSON 与文件）
  channels/qq/         token / send / media / text / aggregator / handler / gateway
  index.ts             启动 QQ + 主动消息 + 补齐标签
```

**设计原则**：`core/chat.ts` 不知道消息从哪来；主动消息的发送方式由 `index.ts` 注入，core 不直接碰 QQ。

## 数据存放

全部在 `apps/server/data/`（已 gitignore）：

| 文件 | 内容 |
|---|---|
| `history.json` | 每个用户的对话（按 `HISTORY_SEND` 窗口发送） |
| `memory/<userId>.json` | 长期摘要 + 手动记住的事实 |
| `stickers/` | 表情包图片 + `index.json`（标签） |
| `users.json` | 谁来过、上次主动打扰时间 |

## 已知限制

- QQ 主动消息受平台额度限制，可能直接被拒（日志里会有 `主动消息失败`）
- 表情包挑图是「标签相似度 + 随机兜底」，标签质量取决于打标模型
- 只有 QQ 通道；想快速调人设，直接改 `apps/server/persona.md` 再在 QQ 里说一句
- 聚合时序、存储读写目前只有部分单测，没有端到端测试

## License

[AGPL-3.0-only](LICENSE) © 2026 Talyra42

简单说：你可以改、可以自己跑，但如果拿它（或改过的版本）对外提供网络服务，必须把源码同样以 AGPL 开放。想闭源商用是不行的。
