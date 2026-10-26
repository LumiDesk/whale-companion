# 小鲸鱼 v0.2 开发方案：可配置化改造与系统性 Code Review

> 基线：`667981a`（v0.1.2） · 日期：2026-10-26 · 状态：评审稿，不含代码改动
>
> 审查范围：`apps/server` 31 个源文件（1,985 行）、`apps/desktop` 23 个源文件（3,836 行）、
> 19 个测试文件、构建脚本、CI 与文档。
>
> 基线验证：`pnpm typecheck` 通过；`pnpm test` 94 个用例全绿。
> 未做真实 QQ 链路、真实自动更新与托盘的人工冒烟；本文所有结论来自全量静态阅读与基线测试。

---

## 0. 结论

1. **“自定义只有一部分”不是设置页做得少，而是配置链路只传了 5 个键。**
   桌面端 `buildBotConfig` 只把 `DEEPSEEK_API_KEY/MODEL/BASE_URL`、`QQBOT_APPID/SECRET`
   写进 `bot.json`；`config.ts` 里另外 20 个已有旋钮（历史、聚合、表情包、主动消息等）
   在桌面模式下**没有任何入口**，手工改 `bot.json` 也会在下次启动时被覆盖。
2. **先修 3 个 P0，再扩大可配置面。** 记忆压缩的异步竞态会丢消息、会让 `/forget` 被“复活”；
   `REPLY_MAX_CHARS=0` 会让切分函数死循环；多图请求没有总量上限，可能拼出几十 MB 的请求体。
   这三项会直接放大器新增的配置项（例如用户把回复上限调成 0）。
3. **设置改造采用“一份 schema + 三层字段”**：常用（模型、人设、主动消息、表情包）、
   高级（历史窗口、聚合节奏、超时、阈值）、维护（数据导出/清理、图库）。
   默认值全部等于当前行为，升级不改变使用手感。
4. **审查共 38 项：P0 3、P1 11、P2 15、P3 9。** 原 CR-11（发件人白名单）按产品决策取消：
   QQ Bot 能跟谁聊天由 QQ 开放平台侧控制，本地再加一层白名单价值不大。
   主要风险集中在异步一致性、网络超时、配置校验和更新回滚；
   分层、原子写、QQ 平台坑位这些底座是扎实的。
5. **推进方式**：按 P0 → P1 → P2 → P3 → 维护能力的顺序逐步落地；
   版本号只是发布节点，不作为范围门槛。发现问题就顺手修，不攒大版本。

### 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 范围 | 不按“天数/版本”卡范围；按阶段推进，发现的问题逐步修 |
| 2 | 单一配置源 | `apps/server/src/settings.ts` 作为纯契约，桌面端只读 import |
| 3 | 人设存放 | 用户自定义一律放 `%APPDATA%\whale-companion`，不写安装目录 |
| 4 | 图片隐私 | 看图/打标默认开启；在设置页与 README 说明“图片会发给模型服务商” |
| 5 | 白名单 | 不做；QQ 平台侧已经决定谁能私聊 Bot |
| 6 | 数据管理 | 按阶段推进，不单独压到某个版本 |

---

## 1. 现状盘点

### 1.1 配置链路

```
SettingsPage
  → IAppConfig（%APPDATA%\whale-companion\config.json，version=1）
  → buildBotConfig()  ← 只映射 5 个业务键 + 3 个内部键
  → bot.json（%APPDATA%\whale-companion\bot.json，每次启动重写）
  → node server/index.js --config bot.json
  → config.ts 把 JSON 合并进 process.env
```

关键点：

- `bot.json` 是**派生文件**，不是用户配置；用户改它没有意义。
- `config.ts` 的 20 个行为旋钮只在 CLI 模式通过 `.env` 可达。
- 桌面端与 CLI 的默认值分别写在 `apps/desktop/src/lib/config.ts` 和
  `apps/server/src/config.ts`，没有契约测试，已经存在漂移风险。

### 1.2 现在能自定义的（桌面端 8 个入口）

| 项 | 位置 | 说明 |
|---|---|---|
| QQ AppID / AppSecret | 设置页 | 必填 |
| DeepSeek API Key | 设置页 | 必填 |
| 模型名称 | 设置页 | 默认 `deepseek-flash` |
| 接口地址 | 设置页 | 默认 `https://api.deepseek.com` |
| 主题 | 设置页 | 跟随系统 / 浅色 / 深色，即时生效 |
| 关窗行为 | 设置页 | 托盘 / 退出 |
| 开机自启 | 设置页 | 仅打包版 |
| `.env` 导入 | 设置页 | 只导入上面 5 个键 |

### 1.3 已有但桌面端不可达的（20 项）

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `DEEPSEEK_TIMEOUT_MS` | 45000 | 模型请求超时 |
| `DEEPSEEK_RETRIES` | 1 | 模型失败重试次数 |
| `HISTORY_STORE` | 200 | 历史落盘上限 |
| `HISTORY_SEND` | 40 | 每轮发给模型的历史条数 |
| `HISTORY_SUMMARIZE_AT` | 150 | 触发记忆压缩的条数 |
| `HISTORY_KEEP_AFTER` | 20 | 压缩后保留的原文条数 |
| `BATCH_SILENCE_MS` | 3000 | 停口多久合并回复 |
| `BATCH_MAX_WAIT_MS` | 10000 | 从第一条起最长等待 |
| `BATCH_MAX_TEXTS` | 10 | 一轮最多文字条数 |
| `BATCH_MAX_IMAGES` | 6 | 一轮最多图片张数 |
| `REPLY_MAX_CHARS` | 500 | 超过多少字才切条 |
| `MEDIA_MAX_BYTES` | 8388608 | 单张图片下载上限 |
| `STICKER_CHANCE` | 0.05 | 回复后自发跟图概率 |
| `STICKER_COOLDOWN_MS` | 480000 | 同一用户发表情包冷却 |
| `PROACTIVE_ENABLED` | true | 主动消息开关 |
| `PROACTIVE_INTERVAL_MS` | 2700000 | 主动消息检查间隔 |
| `PROACTIVE_QUIET_START` | 23 | 免打扰开始小时 |
| `PROACTIVE_QUIET_END` | 9 | 免打扰结束小时 |
| `PROACTIVE_MIN_IDLE_MS` | 10800000 | 至少闲置多久才打扰 |
| `PROACTIVE_MAX_IDLE_DAYS` | 7 | 超过多少天不再打扰 |

### 1.4 完全写死、没有入口的

| 行为 | 现状 | 位置 |
|---|---|---|
| 人设正文 | 只能手改 `persona.md`，桌面端无编辑器 | `core/persona.ts` |
| 称呼 | 全项目写死「主人」 | 人设、`prompt.ts`、`summarize.ts`、`proactive.ts`、`memory.ts` |
| 挑图阈值 | `MIN_SCORE = 0.12` | `core/sticker-pick.ts` |
| 打标并发 | 固定 2 | `core/tagger.ts` |
| 心情列表 | 6 条固定文案 | `core/mood.ts` |
| 时段划分 | 5/9/12/14/18/22 点固定 | `core/mood.ts` |
| 斜杠命令 | 6 个固定命令、帮助文案手写 | `core/commands.ts` |
| 主动消息文案 | 提示词写死，每人每天最多 1 次 | `core/proactive.ts` |
| 摘要提示词 | 写死「不超过 200 字」，但不做长度约束 | `core/summarize.ts` |
| 模型参数 | 不传 temperature / max_tokens | `core/llm.ts` |
| 图片策略 | 一轮最多 6 张全部塞给模型 | `core/chat.ts` + `aggregator.ts` |
| 空回复兜底 | 「……哼，没什么好说的。」 | `channels/qq/handler.ts` |
| 日志级别 | 全部 `slog` 平铺，无级别 | `util.ts` |
| 发件人限制 | 任何人私聊都会回 | `channels/qq/handler.ts` |
| 主题强调色 / 字号 | 固定海洋蓝、固定字号 | `styles.css` |
| 更新策略 | 固定 GitHub latest、启动静默检查 | `lib/update.ts` |

### 1.5 根因归纳

1. **映射层缺口**：`buildBotConfig` 只认识 5 个键，新增旋钮没有转发通道。
2. **没有 schema**：字段、默认值、范围、单位、控件全靠手写，重复且无法校验。
3. **没有范围校验**：`config.ts` 的 `num()` 只保证“是数字”，0、负数、超大值都能通过。
4. **没有运行时契约测试**：桌面默认值与服务端默认值可能悄悄分叉。
5. **保存即重启**：所有设置都靠重启生效，且不区分“原本暂停”状态（见 CR-07）。

---

## 2. 代码审查

### 2.1 方法

- 按分层逐层读：`channels/qq` → `core` → `store` → `index` → 桌面 `lib` / `hooks` / `components`。
- 沿数据流追：一条 QQ 消息从 WS 到落盘；一次更新从检查到替换；一次设置保存到子进程重启。
- 重点看四类点：**await 前后的数据一致性**、**所有网络调用的超时与重试**、
  **所有用户输入的边界**、**失败路径是否可恢复**。
- 对照 `AGENTS.md` 的约定检查实现是否守规矩；对照 README 检查宣称是否属实。
- 局限：没有真实 QQ / GitHub 环境，没有做动态渗透；行号基于 `667981a`。

### 2.2 严重度定义

| 级别 | 含义 | 处理要求 |
|---|---|---|
| P0 | 数据丢失、隐私破坏、不可恢复、进程卡死 | 下个版本必须修，先于新功能 |
| P1 | 功能错误、可被误配置触发、失败后难恢复 | 随设置改造一并修完，不攒到最后 |
| P2 | 性能、维护性、体验、可观测性 | 排期修，不阻塞发版 |
| P3 | 打磨、文档、已知限制 | 有空再做 |

### 2.3 P0（3 项）

#### CR-01 记忆压缩竞态：会丢消息，也会让 `/forget` 复活旧记忆

- **位置**：`apps/server/src/core/summarize.ts:21-51`、`apps/server/src/store/history.ts:36-48`、
  `apps/server/src/core/commands.ts:94-102`。
- **现象**：`summarizeIfNeeded` 先 `loadHistory` 拿快照，`await askModel` 生成摘要，
  完成后用**旧快照**执行 `saveHistory(history.slice(-keep))`。在这段 await 期间：
  - 同一用户的新消息会被 `chat.ts` 正常写入，然后被摘要用旧快照覆盖 → **新消息丢失**；
  - 用户执行 `/forget` 清空历史与记忆，摘要完成后又把旧摘要和旧原文写回 → **删除被撤销**；
  - 用户执行 `/new` 后，旧历史也会被摘要重新写回。
- **为什么现有串行化没挡住**：聚合器只串行化“每批消息的回复”，`chat.ts` 里的
  `void summarizeIfNeeded(...)` 是 fire-and-forget；摘要跑在用户队列之外。
- **影响**：数据丢失；用户明确要求忘记的内容仍然留在 system 里，属于隐私问题。
- **修复方向**：
  1. 在 `memory` 或新的 `store/user-state.ts` 里维护每用户 `epoch`（单调递增）；
     `/new`、`/forget`、每次 `saveHistory` 都 `bump`。
  2. 摘要开始时记下 `epoch` 与快照；`await` 回来后若 `epoch` 变了，**丢弃摘要**并返回。
  3. 若要“尽量不白跑”，可在 epoch 未变时用**新读到的历史**按“已摘要条数”裁剪，
     而不是用旧数组切片。
  4. 可选：给同一用户的“历史/记忆写操作”加一把异步锁，彻底消除读改写窗口。
- **测试**：用可控 Promise 的假模型，在摘要 await 期间写入新消息，断言新消息仍在；
  在摘要 await 期间执行 `/forget`，断言 `memory.summary` 为空、历史为空。
- **验收**：重复执行 100 次并发模拟不丢条；`/forget` 后摘要永不回写。

#### CR-02 `REPLY_MAX_CHARS <= 0` 会让切分函数死循环

- **位置**：`apps/server/src/core/reply.ts:53-65`、`apps/server/src/config.ts:127-130`。
- **现象**：当 `maxChars = 0` 时，`while (rest.length > 0)` 里 `cut` 会被修正为 0，
  `head` 为空、`rest` 不变，循环永不结束。负数也会进入异常分支。
- **触发面**：当前桌面端没有这个入口，但一旦把 `REPLY_MAX_CHARS` 做进设置页，
  用户填 0 或留空就会把 Bot 卡死（该用户后续消息全部排队）。
- **修复方向**：
  1. `splitReply` 内 `const limit = Math.max(1, Math.floor(maxChars) || 1)`；
  2. 每轮验证 `cut > 0 && head` 且 `rest` 变短，否则硬切 `limit` 并 break；
  3. `config.ts` 与桌面端都校验 100–2000；
  4. 顺手避免把代理对（emoji）切成半个字符，见 P3。
- **测试**：`splitReply("abc", 0)` 返回有限数组；`-1`、`NaN`、`1` 都正常。
- **验收**：模糊测试 0–10 的长度参数 1 万次不挂起。

#### CR-03 多图请求没有总量上限，可能拼出几十 MB 的请求体

- **位置**：`apps/server/src/core/chat.ts:19-25`、`apps/server/src/channels/qq/media.ts:24-28`、
  `apps/server/src/config.ts:117-125`。
- **现象**：单张图上限 8MB，`BATCH_MAX_IMAGES=6`；`buildUserContent` 把每张图转成
  base64 data URL，6 × 8MB × 4/3 ≈ 64MB 的 JSON。DeepSeek / 其他 OpenAI 兼容服务通常会
  返回 413 或直接超时，`askModel` 对 4xx 不重试，用户只看到「脑袋卡了一下」。
- **额外成本**：即使服务端接受，token 与带宽也按整包计费。
- **修复方向**：
  1. 新增 `LLM_MAX_IMAGES`（默认 6，保持现状）与 `LLM_MAX_IMAGE_BYTES`（默认 16MB）；
  2. 纯函数 `selectImagesForModel(images, maxCount, maxBytes)`：从新到旧挑，
     超限的跳过并 `slog` 一次；
  3. `VISION_ENABLED=false` 时完全不拼 image part，只留 `[图片xN]` 占位；
  4. 下载侧改为流式限制（见 CR-17），避免“先读完再检查”；
  5. 后续可选：压缩/缩放（需要新依赖，放进 v0.3 评估）。
- **测试**：6 张 8MB 的假图只选到预算内；0 张/1 张/刚好等于上限；vision 关闭时无 image part。
- **验收**：任何一轮请求的 data URL 总字节不超过配置值。

### 2.4 P1（11 项）

| ID | 位置 | 问题 | 影响 | 修复要点 |
|---|---|---|---|---|
| CR-04 | `lib/update.ts:361-372`、`hooks/useController.ts:1016-1067` | 更新脚本直接覆盖安装目录，失败无回滚 | 复制到一半失败会留下半新半旧目录，exe 可能起不来 | 覆盖前备份 exe/resources.neu/server；失败自动还原；成功后清理 |
| CR-05 | `channels/qq/send.ts:7-13`、`token.ts:16-27`、`gateway.ts:49-56`、`media.ts:12-15` | QQ 发送、换 token、取网关、下载图片都没有超时 | 单次网络挂起会卡住该用户队列约 5 分钟；重连循环可能永久卡住 | 统一 `AbortSignal.timeout`；区分可重试错误；补测试 |
| CR-06 | `config.ts:49-58,85-135`、桌面 `lib/config.ts:62-74` | 配置只有类型校验，没有范围/交叉校验 | `INTERVAL=0` 忙循环、`KEEP_AFTER=0` 让压缩失去意义（`slice(-0)` 仍保留全量）、`CHANCE=5` 必发图、`TIMEOUT=0` 立即失败 | schema 范围 + 交叉规则；桌面阻止保存；服务端启动即报错 |
| CR-07 | `hooks/useController.ts:1122-1179`、`:625-629` | 保存设置无条件 `restartBot()` | 用户明明暂停了 Bot，改个设置又被启动并抢占 QQ 连接 | 保存前记录 `wasRunning`；只对运行中的 Bot 重启，暂停态提示“下次启动生效” |
| CR-08 | `channels/qq/gateway.ts:66-112,129-132` | 不处理 op 7（Reconnect）/ op 9（Invalid Session）；WS 无握手超时；onerror 不关闭 | 服务端要求重连时可能假死；握手失败时 Promise 永不 resolve | 处理 7/9；10 秒握手超时；心跳 ACK 超时主动 close；错误也 resolve |
| CR-09 | `core/tagger.ts:44-94` | 启动补标把所有无标签图同步读进内存；队列无上限 | 图库大时启动卡顿/内存飙升；模型慢时任务堆积 | 队列存路径不存字节；读取放进 job；队列上限 + 丢弃日志；并发可配 |
| CR-10 | `core/tagger.ts:21-31`、`core/chat.ts:10-25`、`AGENTS.md:132-136`、`README.md:188-194` | 文档说“发图/存图都在本机，不经过第三方”，实际打标和看图都会把图片发给模型服务商 | 隐私声明不实，用户会在不知情下外发图片 | 改文档；增加 `VISION_ENABLED` / 打标开关；设置页就地说明 |
| CR-12 | `channels/qq/handler.ts:27,45-50` | 取 token 与命令发送在 try 之外 | token 失败/命令发送失败只留一条“批次处理失败”，用户无回复 | 包进 try；token 失败重试一次；命令发送失败记录并尽量兜底 |
| CR-13 | `store/stickers.ts:35-37,43-59` | `writeIndex` 不捕获异常；图片已落盘、索引写失败会留下孤儿文件 | 图库索引与文件不一致；后续启动补标找不到 | 索引写失败回滚图片；记录并返回结果；补日志 |
| CR-14 | `store/atomic.ts:21-63` | `writeSync` 不循环，极端情况短写；rename 兜底先 `rm` 再 rename | 大 JSON 可能被截断，重命名失败时存在丢文件窗口 | 循环写完整；失败清理临时文件；大文件测试 |
| CR-15 | `core/summarize.ts:32-50` | 摘要输入 transcript 不截断，摘要在 prompt 里要求 ≤200 字但代码不约束 | 历史很长时上下文/费用超预期；摘要可能越来越长挤占 system | transcript 上限（如 24k 字）；摘要 `.slice(0, 300)`；超限日志 |

> 原 CR-11（发件人白名单）按产品决策取消：QQ Bot 的可聊范围由 QQ 开放平台侧配置，
> 本地不再重复做一层白名单。此项不计入 38 项。

**补充说明（P1 里最值得先做的三件）**

- **CR-05** 是最“便宜”的稳定性提升：四个 `fetch` 加超时，半天内能做完，
  但能避免绝大多数“Bot 像死了一样”的现场。
- **CR-06** 是设置 v2 的前置条件：没有范围校验，新增 40 个输入框等于新增 40 个坑。
- **CR-04** 是唯一可能把用户安装弄坏的路径，建议在发布前至少做一次
  “锁定文件导致复制失败”的注入测试。

### 2.5 P2（15 项）

| ID | 位置 | 问题 | 影响 | 修复要点 |
|---|---|---|---|---|
| CR-16 | `store/history.ts:12-48`、`core/prompt.ts:18-21`、`store/stickers.ts:62` | 每条消息多次全量解析 `history.json` 与 `stickers/index.json` | 用户/图库变多后每条回复都变慢 | 内存缓存 + mtime/版本失效；或按用户拆文件 |
| CR-17 | `channels/qq/media.ts:24` | 先 `arrayBuffer()` 再检查大小 | 服务端不返回 content-length 或撒谎时内存峰值不可控 | 流式读取，超过上限立即 abort |
| CR-18 | `core/persona.ts:6-7` | 人设文件读不到时直接抛错 | 用户误删/权限问题后每条回复都变成兜底句 | 启动时校验；读取失败回退默认人设并只记一次日志 |
| CR-19 | `store/users.ts:35-44` | 每条消息全量重写 `users.json`，用户只增不删 | 高频聊天时无谓 IO；长期运行文件膨胀 | 节流写入（如 5s 合并）；提供清理/忽略名单 |
| CR-20 | `lib/update.ts:338-391`、`hooks/useController.ts:899-910` | 更新工作目录、`apply-update-*.ps1` 失败后不清理；无磁盘空间检查 | `updates/` 越积越大；磁盘满时更新失败且难排查 | 启动时清理 N 天前目录/脚本；下载前检查剩余空间 |
| CR-21 | `index.ts:1-53` | 没有 SIGINT/SIGTERM 优雅退出 | 定时器/WS 直接断；日志尾部可能丢 | 注册信号处理，关闭 WS、清定时器、落盘后再退出 |
| CR-22 | 桌面 `lib/config.ts`、`lib/process.ts`、`server/src/config.ts` | 默认值分散在三处，无契约测试 | 改一处忘另一处，桌面与 CLI 行为分叉 | settings 单一来源 + round-trip 测试 |
| CR-23 | `channels/qq/gateway.ts:23,67,88-90` | QQ 事件用 `any`，心跳间隔不校验 | 异常 payload 可能让 `setInterval` 变成 1ms 风暴 | 最小类型 + 字段校验；间隔限定 10s–120s |
| CR-24 | `core/commands.ts:13-25,57-70,94-102` | `/help` 手写文案与命令表可能漂移；`__NEW__/__FORGET__` 哨兵字符串 | 加命令时容易漏帮助；哨兵与正常文本理论上可碰撞 | 由命令表生成 help；改用 Symbol/枚举或结果对象 |
| CR-25 | `util.ts:7-9`、各 store 的 `console.error` | 日志无级别，store 与 core 两套输出 | 桌面端无法按级别过滤；排障噪音大 | `LOG_LEVEL` + `slog.info/warn/error`；store 统一走 logger |
| CR-26 | `.github/workflows/desktop.yml:3-7` | CI 只在 tag/手动触发，PR 不跑 typecheck/test；没有格式检查 | 问题只能到发版才暴露 | 新增 PR/push 的 CI；`prettier --check` |
| CR-27 | `apps/*/test` | 摘要竞态、proactive、handler、llm 超时、send、token、prompt、useController 均无测试 | 回归靠手测；这次 P0 就是漏测典型 | 按第 6 节补纯函数/注入式测试 |
| CR-28 | `hooks/useController.ts:355-377,1200-1212` | 托盘创建失败只记日志；关窗仍按“最小化到托盘”隐藏 | 没有托盘图标时窗口消失，用户只能任务管理器 | `setTray` 失败则本次关窗改为退出/显示提示 |
| CR-29 | `lib/platform.ts:236-262` | 自启 `.reg` 以 UTF-8 写入，`reg import` 对非 ASCII 路径可能按 ANSI 解析 | 中文用户名路径下自启项可能乱码/失效 | 写 UTF-16 LE + BOM，或改用 PowerShell `Set-ItemProperty`；中文路径实测 |
| CR-30 | `channels/qq/token.ts:11-35` | 并发取 token 不去重；401 不会强制刷新 | 冷启动并发多一次请求；token 被撤销后要等过期 | in-flight Promise 缓存；401 时 `force=true` 重取一次 |

### 2.6 P3（9 项）

| ID | 位置 | 问题 | 修复建议 |
|---|---|---|---|
| CR-31 | `core/llm.ts:64-67` | 只接受 `message.content` 为字符串；部分兼容接口返回分段数组 | 兼容数组拼接；记录 `finish_reason`/usage |
| CR-32 | `store/stickers.ts:39-40` | `image/webp` 被存成 `.jpg` 扩展名 | 按 mime 映射 webp；或统一转码 |
| CR-33 | `lib/platform.ts:195-200`、`hooks/useController.ts:1342-1345` | `getOwnPid()` 为 0 时锁写成 pid=0；锁在消费更新结果之后才拿 | pid=0 视为失败；先拿锁再消费更新结果 |
| CR-34 | `App.tsx:21-41` | 没有 React ErrorBoundary | 任一页面抛错整窗白屏 | 加边界 + “重新加载/退出”按钮 |
| CR-35 | `store/history.ts:120-124`、`lib/logs.ts:56-62` | 历史备份只增不减；日志只在启动时轮转 | 备份保留最近 N 份；运行中也可轮转 |
| CR-36 | `core/reply.ts:67-69` | 硬切按 UTF-16 code unit，可能切开 emoji | 用 `Array.from`/Intl.Segmenter 切 |
| CR-37 | `channels/qq/handler.ts:64-94` | 用户明确要图时完全绕过冷却 | 明确要图可放宽，但仍限制最小间隔（如 10s） |
| CR-38 | `lib/process.ts:36-55`、`hooks/useController.ts:540-543` | `bot.json` 明文含密钥，长期留在 APPDATA | 收到 `boot` 状态后删除；或用 `icacls` 收紧当前用户 ACL |
| CR-39 | 打包/发布 | 无代码签名、无安装包（已知限制） | 保持文档说明；有预算再上签名 |

### 2.7 做得好的地方（不要在改造中弄丢）

- **分层是干净的**：`core` 不 import QQ，主动消息靠注入 `send`；`channels` 只做传输；
  `store` 只做持久化。这是后续加设置项时最重要的约束。
- **QQ 平台坑位处理到位**：图片上传 JSON + `file_data`、`msg_seq` 递增、4009 不重连、
  inbound 串行、平台标记清洗。
- **存储底座**：JSON 原子写 + fsync + rename；历史迁移先备份、坏文件不覆盖。
- **更新链路的安全意识**：下载域名允许列表、文件名正则、SHA256 可选校验、脚本 BOM、
  等 PID 退出、结果文件消费，这些都比一般个人项目严谨。
- **桌面生命周期**：单实例锁 + 心跳、父进程看门狗、`taskkill /T /F` 杀进程树。
- **测试习惯**：纯函数与聚合器定时器都有测试，`tsc --noEmit` 严格通过。

### 2.8 审查结论

- 没有发现远程代码执行、路径穿越（贴纸 ID 是 UUID、更新解压有边界）、明显的密钥日志泄漏。
- 真正的风险不在“写错一行”，而在**异步窗口**（CR-01）、**没有上限/超时**（CR-03/05/15）、
  **失败不可恢复**（CR-04）、**配置无边界**（CR-06）。
- 这次改造的顺序必须是：**先 P0 → 再配置底座 → 再 UI → 再数据管理**。
  反过来会一边加功能一边放大已有缺陷。

---

## 3. 自定义能力路线图

### 3.1 设计原则

1. **默认值 = 现状**：升级后不配置也完全一样，避免“更新完她变了”。
2. **三层字段**：常用（一眼能懂）、高级（折叠，带解释）、维护（动作，不是开关）。
3. **能校验的都给范围**：数字有 min/max/step/unit；时段用 0–23 选择器；
   概率用滑杆 + 百分比；路径/JSON 有格式校验。
4. **保存有代价要说清**：服务端字段保存后重启 Bot；主题、人设即时；日志下次启动。
5. **不碰项目身份**：群聊、Web 调试台、工具执行、多租户、插件系统不做。

### 3.2 分层

| 层 | 内容 | 入口 |
|---|---|---|
| 常用 | 模型、称呼、人设、回复长度、主动消息开关/免打扰、表情包开关/频率、主题 | 设置页首屏 |
| 高级 | 历史窗口、压缩阈值、聚合节奏、超时/重试、挑图阈值、打标并发、额外模型参数 | 「高级」Tab |
| 维护 | 数据导出/导入、清空对话/记忆、图库管理、日志清理、连接自检 | 「数据」Tab / 关于页 |

### 3.3 字段清单

> 下表的“阶段”列只是排期标签：v0.2 指首批设置改造，v0.3 指后续维护/内容能力。
> 实际按 P0 → P1 → P2 … 逐步推进，不把任何一项锁死在某个版本里。

#### A. 模型与图像

| 设置项 | 环境变量 | 默认 | 范围/选项 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 模型 | `DEEPSEEK_MODEL` | `deepseek-flash` | 非空；右侧「获取模型」按钮调用 `GET /models` 下拉选择 | 文本框 + 下拉 | 已有 + v0.2 |
| 接口地址 | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | http(s) | 文本框 | 已有 |
| API Key | `DEEPSEEK_API_KEY` | 空 | 非空 | 密码框 | 已有 |
| 思考强度 | `DEEPSEEK_THINKING_EFFORT` | high | off / low / high / max | 分段选择 | v0.2 常用 |
| 温度 | `DEEPSEEK_TEMPERATURE` | 自动（不发送） | 自动，或 0–2 步长 0.1；**思考开启时不生效** | 滑杆 + “自动” | v0.2 |
| 最大输出 | `DEEPSEEK_MAX_TOKENS` | 0（不限制） | 0–8192 | 数字 | v0.2 |
| 超时 | `DEEPSEEK_TIMEOUT_MS` | 45000 | 10–120 秒 | 数字（秒） | v0.2 |
| 重试 | `DEEPSEEK_RETRIES` | 1 | 0–3 | 数字 | v0.2 |
| 额外参数 | `DEEPSEEK_EXTRA_BODY` | `{}` | JSON 对象，≤4KB，禁改 model/messages/stream/thinking/reasoning_effort | JSON 编辑器 | v0.2 高级 |
| 看图 | `VISION_ENABLED` | true | 开关 | 开关 | v0.2 |
| 每轮最多图 | `LLM_MAX_IMAGES` | 6 | 0–8 | 数字 | v0.2 高级 |
| 图片总预算 | `LLM_MAX_IMAGE_BYTES` | 16777216 | 1–32MB | 数字 | v0.2 高级 |

#### B. 对话与记忆

| 设置项 | 环境变量 | 默认 | 范围 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 发送历史 | `HISTORY_SEND` | 40 | 10–100 | 数字 | v0.2 高级 |
| 保存历史 | `HISTORY_STORE` | 200 | 50–1000 | 数字 | v0.2 高级 |
| 压缩阈值 | `HISTORY_SUMMARIZE_AT` | 150 | 50–800 | 数字 | v0.2 高级 |
| 压缩后保留 | `HISTORY_KEEP_AFTER` | 20 | 5–100 | 数字 | v0.2 高级 |
| 回复上限 | `REPLY_MAX_CHARS` | 500 | 100–2000 | 数字 | v0.2 常用 |
| 称呼 | `OWNER_NAME` | 主人 | 1–12 字，无换行 | 文本框 | v0.2 常用 |
| 人设正文 | （文件） | 内置 `persona.md` | 1–20000 字 | 多行编辑器 | v0.2 常用 |

#### C. 消息节奏

| 设置项 | 环境变量 | 默认 | 范围 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 停口等待 | `BATCH_SILENCE_MS` | 3000 | 500–10000 | 数字（秒） | v0.2 高级 |
| 最长等待 | `BATCH_MAX_WAIT_MS` | 10000 | 2000–60000 | 数字（秒） | v0.2 高级 |
| 最多文字 | `BATCH_MAX_TEXTS` | 10 | 1–30 | 数字 | v0.2 高级 |
| 最多图片 | `BATCH_MAX_IMAGES` | 6 | 0–10 | 数字 | v0.2 高级 |

#### D. 表情包

| 设置项 | 环境变量 | 默认 | 范围 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 启用 | `STICKER_ENABLED` | true | 开关 | 开关 | v0.2 常用 |
| 自发概率 | `STICKER_CHANCE` | 0.05 | 0–0.5 | 滑杆（%） | v0.2 常用 |
| 冷却 | `STICKER_COOLDOWN_MS` | 480000 | 1–120 分钟 | 数字（分钟） | v0.2 高级 |
| 命中阈值 | `STICKER_MIN_SCORE` | 0.12 | 0.05–0.5 | 滑杆 | v0.2 高级 |
| 明确要图随机兜底 | `STICKER_ALLOW_RANDOM` | true | 开关 | 开关 | v0.2 高级 |
| 自动收图 | `STICKER_AUTO_INGEST` | true | 开关 | 开关 | v0.2 |
| 打标并发 | `STICKER_TAG_CONCURRENCY` | 2 | 1–4 | 数字 | v0.2 高级 |
| 图库上限 | `STICKER_MAX_LIBRARY` | 0（不限） | 0–5000 | 数字 | v0.3 |
| 图库管理 | （数据） | — | 列表/删除/重打标/禁用标签 | 页面 | v0.3 |

#### E. 主动消息

| 设置项 | 环境变量 | 默认 | 范围 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 启用 | `PROACTIVE_ENABLED` | true | 开关 | 开关 | v0.2 常用 |
| 检查间隔 | `PROACTIVE_INTERVAL_MS` | 2700000 | 5–240 分钟 | 数字（分钟） | v0.2 高级 |
| 免打扰开始 | `PROACTIVE_QUIET_START` | 23 | 0–23 | 小时选择 | v0.2 常用 |
| 免打扰结束 | `PROACTIVE_QUIET_END` | 9 | 0–23 | 小时选择 | v0.2 常用 |
| 最短闲置 | `PROACTIVE_MIN_IDLE_MS` | 10800000 | 30 分钟–24 小时 | 数字（小时） | v0.2 高级 |
| 最长闲置 | `PROACTIVE_MAX_IDLE_DAYS` | 7 | 1–30 天 | 数字 | v0.2 高级 |
| 每天最多 | `PROACTIVE_MAX_PER_DAY` | 1 | 1–5 | 数字 | v0.2 高级 |

#### F. 安全与日志

| 设置项 | 环境变量 | 默认 | 说明 | 控件 | 阶段 |
|---|---|---|---|---|---|
| 日志级别 | `LOG_LEVEL` | info | debug/info/warn/error | 下拉 | v0.2 高级 |
| 日志保留天数 | （桌面） | 7 | 1–30 | 数字 | v0.2 高级 |
| 日志最大行数 | （桌面） | 2000 | 200–10000 | 数字 | v0.2 高级 |
| 图片外发 | `VISION_ENABLED` / 打标 | 开 | 关闭后不把图发给模型 | 开关 + 说明 | v0.2 |

#### G. 桌面行为

| 设置项 | 默认 | 说明 | 阶段 |
|---|---|---|---|
| 主题 | 跟随系统 | 已有 | 已有 |
| 关窗行为 | 最小化到托盘 | 已有 | 已有 |
| 开机自启 | 关 | 已有，仅打包版 | 已有 |
| 启动时自动启动 Bot | 开 | 配置完整时自动启动 | v0.2 |
| 崩溃后自动重启 | 关 | 最多 3 次/10 分钟，指数退避 | v0.2 |
| 启动时检查更新 | 开 | 打包版静默检查 | v0.2 |
| 启动时最小化 | 关 | 与 `--hidden` 区分 | v0.2 |
| 强调色 | 海洋蓝 | 3–4 套预设 | v0.3 |
| 字号 | 100% | 需要 rem 化，成本高 | 待评估 |

#### H. 维护动作（不是配置项）

| 动作 | 说明 | 阶段 |
|---|---|---|
| 连接自检 | QQ token、LLM ping、数据目录、人设、图库索引 | v0.2 |
| 导出备份 | `data/` + `persona.md` + manifest；默认不含密钥 | v0.3 |
| 导入备份 | 选 zip → 校验 → 备份当前 → 替换 → 重启 | v0.3 |
| 清空对话 | 按用户清 history | v0.3 |
| 清空记忆 | 按用户清 memory | v0.3 |
| 图库维护 | 缩略图、删除、重新打标、禁用标签 | v0.3 |
| 日志清理 | 清空日志文件（不只是视图） | v0.3 |

#### I. 后续进阶自定义（内容层）

这些不是“运行参数”，而是“她是谁、她怎么说”，建议在设置 v2 稳定后再做：

| 项 | 做法 | 风险/约束 |
|---|---|---|
| 斜杠命令开关 | `data/commands.json` 的 `disabled` 列表；`/help` 自动过滤 | `/help` 本身不可禁用 |
| 命令别名 | `aliases: { "重置": "new" }`，只允许单行 | 别名冲突要校验 |
| 自定义静态命令 | `{ name, desc, reply }`，只回固定文本，不调模型 | 不允许模板变量/脚本，避免变成插件系统 |
| 心情列表 | `data/moods.json`，默认沿用现有 6 条；1–30 条、每条 ≤40 字 | 空列表/超长要回退默认；提示词注入风险低但需转义换行 |
| 回复兜底文案 | `REPLY_FALLBACK`，默认「……哼，没什么好说的。」 | 空值回退默认 |
| 主动消息提示词 | 高级文本框，默认用内置提示；限制 1–500 字 | 写坏会让她说话很怪，提供“恢复默认” |
| 人设片段库 | 把「身份/说话规则/脾气/边界/示例」拆成可编辑小节，或提供 2–3 套预设 | 内容维护成本高；先做单文件编辑器更稳 |
| 禁用表情包标签 | `stickers.blockedTags: string[]`，挑图时过滤 | 只影响新挑图，不删文件 |
| 时段语气边界 | 把 5/9/12/14/18/22 做成可调 | 配置项过多，收益低，暂不做 |

### 3.4 明确不做的

| 项 | 原因 |
|---|---|
| 发件人白名单 | 谁能私聊 Bot 由 QQ 开放平台侧控制，本地再加一层是重复建设 |
| 群聊 / 多频道 | 项目身份是“QQ 私聊陪伴”，群聊会改变聚合、权限、主动消息模型 |
| Web 调试台 / HTTP 服务 | 现有架构明确排除；桌面端足够 |
| 工具执行 / 文件操作 / Agent 平台 | 与陪伴定位冲突，安全边界会失控 |
| 多用户 SaaS / 计费 | 不是产品方向 |
| 插件系统 / 命令 SDK | 自定义命令用静态模板即可，插件会把维护成本推高 |
| 语音/TTS/视频 | 需要额外模型与平台能力，本期不做 |
| 任意主题色 | 对比度与深色适配成本高；先做 3–4 套预设 |
| 模型自动切换/故障转移 | 行为不可预期；先做好超时与错误提示 |

---

## 4. 技术方案

### 4.1 配置 v2 结构

`config.json` 升到 `version: 2`，保留旧字段含义，新增分组。示意（省略密钥）：

```json
{
  "version": 2,
  "qq": { "appId": "", "appSecret": "" },
  "llm": {
    "apiKey": "",
    "model": "deepseek-flash",
    "baseUrl": "https://api.deepseek.com",
    "temperature": null,
    "maxTokens": 0,
    "timeoutMs": 45000,
    "retries": 1,
    "thinkingEffort": "high",
    "extraBody": {},
    "vision": true,
    "maxImages": 6,
    "maxImageBytes": 16777216
  },
  "conversation": {
    "historySend": 40,
    "historyStore": 200,
    "summarizeAt": 150,
    "keepAfterSummarize": 20,
    "replyMaxChars": 500,
    "ownerName": "主人"
  },
  "batching": {
    "silenceMs": 3000,
    "maxWaitMs": 10000,
    "maxTexts": 10,
    "maxImages": 6
  },
  "stickers": {
    "enabled": true,
    "spontaneousChance": 0.05,
    "cooldownMs": 480000,
    "minScore": 0.12,
    "allowRandomOnRequest": true,
    "autoIngest": true,
    "tagConcurrency": 2,
    "maxLibrary": 0
  },
  "proactive": {
    "enabled": true,
    "intervalMs": 2700000,
    "quietStart": 23,
    "quietEnd": 9,
    "minIdleMs": 10800000,
    "maxIdleDays": 7,
    "maxPerDay": 1
  },
  "behavior": {
    "closeAction": "tray",
    "launchAtLogin": false,
    "autoStartBot": true,
    "autoRestartOnCrash": false,
    "checkUpdateOnStartup": true,
    "startMinimized": false
  },
  "appearance": { "theme": "system" },
  "logs": { "keepDays": 7, "maxLines": 2000, "level": "info" }
}
```

迁移规则：

1. `version` 缺失或为 1 → 按旧字段读取，新字段填默认，写回 v2，并备份
   `config.json.bak-v1-<ts>`。
2. `version === 2` → 正常归一化。
3. 更高版本 → 保留能识别的字段，其余用默认值，记录一条警告，**不覆盖**原文件。
4. `bot.json` 不迁移：它是派生文件，每次启动重写。

### 4.2 单一配置源：三个选项

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A（推荐） | `apps/server/src/settings.ts` 放纯 schema/defaults/映射；桌面端 `lib/settings.ts` 相对 import | 零构建改动；服务端/桌面端同一份默认值；打包不受影响 | 桌面端 import 了 server 源文件，需要在 AGENTS 里写清“仅限纯契约模块” |
| B | 根目录 `settings.schema.json` + `scripts/sync-settings.mjs` 生成两端 TS | 边界最干净；可做 CI diff 检查 | 多一步 codegen；生成文件/脚本维护成本 |
| C | 两端各写一份 + 契约测试 | 改动最小 | 仍然是两份，长期容易漂移 |

**推荐 A，理由**：项目刻意保持“没有构建编排”，B 会引入生成步骤和 CI 校验；
C 不能真正解决问题。A 的边界风险可以用三条规矩压住：

1. `settings.ts` 只允许 import 类型，不 import `node:*`、不读 `process.env`、不碰 DOM；
2. 它只导出 schema、默认值、`toEnv`、`fromEnv`、`normalize`、`validate` 六类纯东西；
3. 加一个单测直接读源码，断言没有 `node:` / `process.` / `window.` 字样（或人工 review checklist）。

桌面端 `lib/settings.ts` 只做 re-export，不二次加工；`lib/config.ts` 负责 v1→v2 迁移。

### 4.3 服务端改动清单

| 文件 | 改动 |
|---|---|
| `src/settings.ts`（新） | 字段元数据、默认值、env 映射、归一化、范围/交叉校验 |
| `src/config.ts` | 从 settings 取默认值；新增 `llm.temperature/maxTokens/extraBody/vision/maxImages/maxImageBytes`、`conversation.ownerName`、`sticker.enabled/minScore/allowRandom/autoIngest/tagConcurrency`、`proactive.maxPerDay`、`log.level`；新增 `paths.defaultPersona`；启动时校验并一次性报错 |
| `src/core/llm.ts` | temperature 为 null 时不发送、max_tokens 为 0 时不发送；按 `thinkingEffort` 拼 `thinking`/`reasoning_effort`；合并 extraBody；兼容 content 数组；记录 finish_reason/usage（debug） |
| `src/core/chat.ts` | `selectImagesForModel`；vision 关闭时用占位；图片预算 |
| `src/core/prompt.ts` | 称呼、vision/表情包开关、附加说明 |
| `src/core/persona.ts` | 优先读 APPDATA 覆盖，回退安装目录默认；读取失败回退最小人设；称呼替换 |
| `src/core/summarize.ts` | epoch 检查；transcript/摘要长度上限；称呼 |
| `src/core/proactive.ts` | 每天次数；称呼；发送失败分类日志 |
| `src/channels/qq/handler.ts` | token/命令错误兜底；表情包开关；挑图阈值 |
| `src/core/sticker-pick.ts` | `minScore` 从参数传入，默认 0.12 |
| `src/core/sticker-request.ts` | 随机兜底开关 |
| `src/core/tagger.ts` | 并发/队列上限；读路径不读字节；自动收图开关 |
| `src/core/reply.ts` | 防御性 limit；emoji 安全切分（P3） |
| `src/index.ts` | `--self-check` / `--list-models` 分支；SIGINT/SIGTERM 优雅退出 |
| `src/core/self-check.ts`（新） | 配置、数据目录、人设、图库、QQ token、LLM ping |
| `src/core/models.ts`（新） | 调 `GET /models`、解析元数据、`--list-models` 输出 |
| `src/store/history.ts` | epoch/bump；按条数裁剪摘要；大文件循环写配合 |
| `src/store/atomic.ts` | 循环写完整；失败清理 |
| `src/store/stickers.ts` | 索引写失败回滚；可选去重/上限（后续） |
| `src/store/users.ts` | 记录 `proactiveDate` / `proactiveCount`，支撑「每天最多 N 次」；旧文件缺字段按 0 处理 |

**思考强度（按 DeepSeek 官方文档）**

官方 Chat Completions（OpenAI 格式）的控制方式：

- 开关：`{"thinking": {"type": "enabled" | "disabled"}}`，思考模式**默认开启**；
- 强度：`{"reasoning_effort": "low" | "high" | "max"}`，默认 `high`；
- 思考模式下 `temperature`、`presence_penalty`、`frequency_penalty` 不生效
  （官方说明：传了不报错，但也不生效）；
- 思维链在响应里是 `message.reasoning_content`，与 `content` 同级；
  本项目不使用 tools，因此不需要回传 `reasoning_content`，也不写入历史。

实现约定：

- 设置项 `thinkingEffort` 四档：
  - `off` → DeepSeek 发 `thinking: {type: "disabled"}`，且**不发** `reasoning_effort`；
  - `low/high/max` → DeepSeek 发 `thinking: {type: "enabled"}` + `reasoning_effort`；
- 判断是否 DeepSeek：`baseUrl` 主机包含 `deepseek.com`，或 `model` 以 `deepseek-` 开头；
  其他 OpenAI 兼容接口只发 `reasoning_effort`，不发 DeepSeek 专有的 `thinking` 对象，
  避免被 400；选 `off` 时两类参数都不发。
- `temperature` 只在 `off` 且不是 `null` 时发送；思考开启时 UI 置灰并提示“思考模式下不生效”。
- 非流式请求，只读 `content`；`reasoning_content` 不落库，debug 日志只记长度。
- 自定义模型不支持某档位时，`/models` 的 `effort.supported_levels` 用来限制 UI 选项；
  拿不到元数据时四档全开。

参考：
[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)、
[获取模型列表](https://api-docs.deepseek.com/zh-cn/api/list-models/)。

**获取模型列表**

- 服务端新增 `--list-models` 模式：加载 `--config`，调用 `GET {baseUrl}/models`，
  带 `Authorization: Bearer`，10 秒超时；输出
  `@@WHALE {"type":"models","models":[...]}` 后退出。
- 解析 `data[]` 的 `id`、`name`、`context_window`、`max_output_tokens`、
  `effort.supported_levels`、`effort.default_level`；字段缺失不报错。
- 桌面端在模型输入框右侧加「获取模型」按钮：
  - 把**当前表单**的 `apiKey/baseUrl` 写进临时 `model-check.json`（不污染已保存配置，
    Bot 运行中也不受影响），spawn `--list-models`，完成后删除临时文件；
  - 成功后展示下拉列表（展示 `name` + `id`，可带上下文窗口），点选即填入模型输入框；
  - 若返回 `effort` 元数据，顺带更新思考强度可选档位与默认值；
  - 失败（401/404/超时/接口不支持）在按钮下方显示原因，不影响手动输入。
- 不把 API Key 放命令行参数；临时文件与 `bot.json` 同样只在当前用户目录，用完即删。

### 4.4 桌面端改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/settings.ts`（新） | re-export server 的 schema/defaults |
| `src/lib/config.ts` | v2 结构；`normalizeConfig` 迁移 v1；`validateConfig` 覆盖范围与交叉规则；`configFromEnv` 支持全部键 |
| `src/lib/process.ts` | `buildBotConfig` 改为 `settingsToEnv` 全量映射；注入 `WHALE_PERSONA_FILE`（APPDATA 覆盖）与 `WHALE_DEFAULT_PERSONA_FILE`（安装目录默认） |
| `src/lib/types.ts` | `IAppConfig` v2；日志/更新类型补充 |
| `src/hooks/useController.ts` | 抽出 `useBotProcess`、`useUpdate`、`useAppConfig`、`useTray`（建议 v0.2 至少拆前两个）；保存时保留暂停态；自检/数据动作 |
| `src/components/settings/`（新） | `SettingsPage` + Tab；`Field` 渲染器；`NumberField/SliderField/SwitchField/HourRange/JsonField/SecretField` |
| `src/components/settings/ModelPicker.tsx` | 模型输入框 +「获取模型」按钮 + 下拉列表；思考档位联动 |
| `src/components/settings/PersonaEditor.tsx` | 人设编辑、重置、字符数、备份 |
| `src/components/settings/SelfCheck.tsx` | 连接自检结果 |
| `src/components/settings/DataPage.tsx`（v0.3） | 导出/导入/清理/图库 |
| `src/App.tsx` | ErrorBoundary |
| `src/styles.css` | 表单/滑杆/Tab 样式；强调色变量（v0.3） |

### 4.5 生效策略

| 类别 | 生效方式 |
|---|---|
| 主题 | 即时保存、即时应用（现状） |
| 人设 | 即时保存；服务端每轮现读，下一条生效 |
| 服务端设置 | 保存 → 写 `config.json` → 写 `bot.json` → 重启 Bot |
| 桌面行为 | 即时保存；下次启动/关窗时生效 |
| 日志级别/保留 | 保存后即时用于新日志；轮转下次启动 |

保存交互：

- Bot 运行中：按钮「保存并重启 Bot」；保存成功后重启，失败保留新配置并提示。
- Bot 已暂停：按钮「保存」；**不要自动启动**，提示「下次启动生效」。
- 未保存离开：设置页内显示“有未保存修改”提示条；不做强制拦截。
- 保存前做一次完整校验，错误定位到字段。

### 4.6 人设与称呼

**存储（默认只读 + 用户覆盖）**

- **默认人设**：仍随软件放在安装目录 `server/persona.md`，只读、随版本更新替换。
  这样没改过人设的用户能持续拿到新人设，而不是被锁在旧版本。
- **用户人设**：`%APPDATA%\whale-companion\persona.md`。只要这个文件存在且非空，
  服务端优先用它；不存在时回退安装目录默认人设。
- **注入方式**：`WHALE_PERSONA_FILE` 指向 APPDATA 覆盖文件；新增
  `WHALE_DEFAULT_PERSONA_FILE` 指向安装目录默认人设。`persona.ts` 先读覆盖，
  再读默认，最后回退一句最小人设。
- **首次升级迁移**：更新脚本在覆盖 `server/` 前，把旧的 `server/persona.md`
  备份到 `updates/persona-backup-<ts>.md`。新版首次启动时：
  - APPDATA 覆盖不存在；
  - 备份存在且内容与 v0.1.2 默认人设的 SHA256 不同 → 认为用户手改过，
    复制为 APPDATA 覆盖；
  - 与默认相同 → 忽略，继续用新版默认人设。
  这样既不会把默认人设误当自定义，也不会丢掉真正的手改。
- **CLI 模式**：不设置 `WHALE_PERSONA_FILE`，仍读仓库内 `apps/server/persona.md`，行为不变。

**编辑**

- 多行文本域，等宽字体可选；实时字符数；上限 20,000 字。
- 「保存」：写 APPDATA 覆盖文件（临时文件 + rename 原子写）；
  保存前备份现有覆盖为 `persona.md.bak-<ts>`（保留最近 5 份）。
- 「恢复默认」：删除 APPDATA 覆盖（先备份），下次读取自动回落到安装目录默认人设；
  二次确认。不是把默认内容复制成一份新的覆盖，否则以后默认更新又进不来了。
- 「预览」：显示当前生效内容的前 500 字与字符数（不需要调模型）。
- 空内容/全空白禁止保存。

**称呼**

- `OWNER_NAME` 默认「主人」，1–12 字，禁止换行/控制字符。
- 服务端加载人设后做**字面替换**：`主人` → `OWNER_NAME`（默认名不替换）。
- `prompt.ts` 的记忆块标题改为「关于{称呼}」；`summarize.ts`、`proactive.ts` 的提示词使用同一称呼。
- 测试：默认值不改变任何 prompt；自定义名只替换称呼词，不破坏「主人的事」这类短语。

**失败兜底**

- `getPersona` 读失败：记录一次日志，回退到打包默认人设；再失败则返回一句最小人设，
  保证 Bot 还能回话，而不是每轮都掉进兜底句。

### 4.7 连接自检

新增 `--self-check` 模式，不启动 WS、不写历史、不跑主动消息：

```
node server/index.js --self-check --config bot.json
```

输出（stdout，逐行）：

```
@@WHALE {"v":1,"type":"check","name":"config","ok":true}
@@WHALE {"v":1,"type":"check","name":"data","ok":true,"detail":"可写"}
@@WHALE {"v":1,"type":"check","name":"persona","ok":true,"detail":"65 行 / 3600 字"}
@@WHALE {"v":1,"type":"check","name":"stickers","ok":true,"detail":"12 张 / 3 张未打标"}
@@WHALE {"v":1,"type":"check","name":"qq","ok":true,"detail":"token 获取成功"}
@@WHALE {"v":1,"type":"check","name":"llm","ok":false,"detail":"HTTP 401"}
@@WHALE {"v":1,"type":"check-done","ok":false}
```

检查项：

1. **config**：必填齐全、范围合法（配置加载阶段已抛错的话直接失败）。
2. **data**：数据目录存在且可写（写一个临时文件再删）。
3. **persona**：可读、非空、长度合理。
4. **stickers**：索引可读；报告总数/未打标数。
5. **qq**：`getAccessToken` 成功（10 秒超时）。
6. **llm**：`chat/completions` 发一条 `ping`，`max_tokens: 1`（15 秒超时）。

桌面端：

- 设置页底部/高级 Tab 放「测试连接」按钮。
- 生成/复用 `bot.json`，spawn 自检进程，收集 `@@WHALE` 行；30 秒总超时。
- 结果用列表展示（成功/失败/详情），失败给“去检查 Key/网络/模型服务”的建议。
- 自检进程结束用 `taskkill /T /F` 兜底，避免残留。
- 不显示密钥；错误详情截断 200 字。

### 4.8 隐私与数据外发

**隐私**

- 事实：`tagImage` 会把每张入库图发给模型打标；`buildUserContent` 会把当轮图发给模型看图。
- 文档修正：
  - `AGENTS.md` 删除“发图/存图都在本机，不经过第三方”的绝对说法；
  - `README.md` 数据与隐私一节明确写“开启看图/打标时，图片会发送到你配置的模型服务商；
    关闭后只在本机保存”。
- 开关：
  - `VISION_ENABLED=false`：用户发来的图不拼进模型请求，历史里写 `[图片xN]`；
  - `STICKER_AUTO_INGEST=false`：用户发的图不再自动进表情包库（仍可正常看图/对话）；
  - 打标跟随 vision：关闭看图时跳过 `tagImage` 与启动补标，已有标签保留；
  - 设置页文案直接写清楚：“看图 = 把图片发给模型服务商；关闭后图片只留在本机。”
    打标同理，另起一行说明。

**不做发件人白名单**

- QQ Bot 能跟谁聊天由 QQ 开放平台的“沙箱/体验成员/发布范围”决定，本地再加一层
  openid 白名单既重复又容易把正常用户挡在外面。
- 因此不新增 `QQ_ALLOWED_OPENIDS`、不做最近联系人勾选；`users.json` 只继续服务
  主动消息的“最后活跃时间”，不参与准入判断。

### 4.9 数据管理（维护能力）

Neutralino 已提供 `os.showSaveDialog` / `os.showOpenDialog` / `filesystem.readBinaryFile` /
`filesystem.writeBinaryFile` / `os.showNotification`，不需要新依赖。

**导出**

1. 可选“先暂停 Bot”（默认勾选，保证跨文件一致）。
2. 选择保存路径（默认 `%APPDATA%\whale-companion\exports\whale-backup-<date>.zip`）。
3. 打包 `data/` + `persona.md` + `manifest.json`；**默认不含 `config.json`**，
   勾选“包含密钥”才加入，并给红色警告。
4. `manifest` 记录 app、version、exportedAt、包含项。
5. 用 PowerShell `Compress-Archive`；完成后 `showNotification` + 打开所在目录。

**导入**

1. 选 zip → 解压到 `%APPDATA%\whale-companion\updates\import-<ts>/`。
2. 校验 manifest 与目录结构；只接受 `data/`、`persona.md`、`manifest.json`。
3. 停 Bot → 把当前 `data/` 重命名/备份为 `data.bak-<ts>/` → 复制新数据 → 重启。
4. 任一步失败：还原备份，保留导入目录供排查。
5. 不覆盖 `config.json`（避免导入别人的密钥）。

**清理**

- 按用户清 history / memory：列出 `users.json` 的 openid + lastSeen，二次确认。
- 清空全部对话/记忆：保留图库。
- 图库：总数/总大小；分页缩略图（`readBinaryFile` → base64）；删除单张；重新打标；
  禁用标签（v0.3 加 `blockedTags`）。
- 日志：清空 `logs/*.log`，不只是清视图。

**图库重打标**

- 新增 `--retag` 模式：加载配置 → 找出无标签/指定 id → 调 `tagImage` → 写回 → 退出。
- 桌面端先暂停 Bot，再 spawn `--retag`，完成后重启；进度用 `@@WHALE` 行回传。

### 4.10 日志与可观测性

- `LOG_LEVEL`：`debug | info | warn | error`，默认 `info`。
- `slog` 增加级别；关键路径用 `warn/error`（模型失败、QQ 断开、索引写失败、更新失败）。
- 桌面端日志行增加 `level` 字段与筛选（可选，v0.2 先按来源筛）。
- **不记录消息正文**；debug 只记录长度、条数、耗时、错误码。
- 自检、更新、配置迁移各留一条明确的成功/失败日志。
- 已知限制：Bot 卡住（不是崩溃）没有心跳监控；v0.3 可加“ready 后每 60 秒心跳，
  5 分钟无心跳提示”。

### 4.11 更新与回滚（CR-04）

建议把 PowerShell 脚本改成：

1. 等旧 PID 退出（现状）。
2. **备份人设**：把旧 `server/persona.md` 复制到 `updates/persona-backup-<ts>.md`；
   首次升级启动时按哈希判断是否把手改迁移到 APPDATA（见 4.6）。
3. **备份程序**：把 `WhaleCompanion.exe`、`resources.neu`、`server/` 复制到
   `updates/backup-<oldVersion>-<ts>/`。
4. **复制**：从解压目录复制到目标；每步失败重试，仍失败则进入 5。
5. **失败还原**：把备份复制回去，写 `update-result.json`（ok=false），启动旧 exe。
6. **成功**：写结果（ok=true, version），启动新 exe；下次启动消费结果并清理备份。
7. 下载前检查剩余磁盘（zip 大小 × 3 的余量）。
8. 清理超过 7 天的 `updates/*` 与 `apply-update-*.ps1`。

验收：手动锁住 `resources.neu` 或断网模拟复制失败，确认旧版本仍能启动。

---

## 5. 实施计划

### 5.1 阶段拆分

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| P0 | CR-01/02/03 + 回归测试 | PR1 | 并发摘要不丢消息；`maxChars=0` 不挂；大图请求被裁剪 |
| P1 | settings 契约 + config v2 + 迁移 + 服务端校验 + bot.json 全量映射 | PR2 | v1 配置无损升级；默认行为不变；非法值启动即报错 |
| P2 | 设置页重构（Tab + schema 渲染）+ 人设编辑 + 称呼 + 思考强度/模型获取 | PR3 | 20+ 常用/高级项可改；暂停态保存不启动；人设即时生效；思考四档与模型下拉可用 |
| P3 | 自检 + 隐私开关 + 文档修正 | PR4 | 自检能定位 QQ/LLM 失败；隐私说明准确 |
| P4 | CR-04/05/08/09/12/13/14/15 修复 | PR5 | 超时/回滚/索引/摘要边界有测试 |
| P5 | CI、文档、截图、首个发布节点 | PR6 | PR 跑 typecheck/test；Release 含 SHA256 |
| P6 | 数据管理 + 图库 + 日志清理 | PR7 | 导出/导入/还原可回滚 |

> 按 P0 → P1 → P2 → P3 → P5 的顺序推进，每阶段独立可验证；P4 的 P1 修复在
> P2/P3 期间穿插完成，P6 作为维护能力接在后面。不按天数承诺，发现问题就修。

### 5.2 PR 拆分与提交信息

| PR | 建议 commit 前缀 | 内容 |
|---|---|---|
| PR1 | `fix:` | 记忆摘要 epoch、切分防御、图片预算 |
| PR2 | `feat:` | settings 契约、config v2、迁移、全量 env 映射 |
| PR3 | `feat:` | 设置页 Tab/字段组件、人设编辑、称呼 |
| PR4 | `feat:` | 自检、隐私开关、文档 |
| PR5 | `fix:` | 网络超时、更新回滚、网关重连、打标队列、索引/原子写、摘要上限 |
| PR6 | `chore:` | CI、README/AGENTS/CHANGELOG、截图、发版 |
| PR7 | `feat:` | 数据导出/导入、图库维护（v0.3） |

每个 PR 都要求：`pnpm typecheck` + `pnpm test`；涉及 UI 的附截图；涉及配置的附迁移用例。

### 5.3 依赖关系

```
P0 ──> P1 ──> P2 ──> P3
        │       │
        └──> P4 ┘
                └──> P5 ──> P6
```

- P0 必须先做：否则 P2 的输入框会放大死循环/大请求。
- P1 必须先做：否则 P2 没有可绑定的 schema。
- P4 中的 CR-04（更新回滚）建议在 P5 发版前完成。

---

## 6. 测试计划

### 6.1 新增单测

| 模块 | 用例 |
|---|---|
| `settings.test.ts` | 默认值在范围内；env 唯一；`toEnv/fromEnv` 往返；非法值报错；交叉规则 |
| `config.test.ts`（桌面） | v1 迁移 v2；未知版本；`.env` 全量导入；范围校验 |
| `summarize.test.ts` | await 期间新消息保留；`/forget` 后不回写；transcript/摘要截断 |
| `reply.test.ts` | 0/负数/NaN 不挂起；不切开 emoji |
| `chat.test.ts` | 图片按数量/字节裁剪；vision 关闭无 image part |
| `handler.test.ts` | token 失败；命令发送失败；表情包开关 |
| `llm.test.ts` | 超时、429/5xx 重试、4xx 不重试、content 数组、extraBody 合并、temperature/maxTokens 默认不发送、思考四档请求体、非 DeepSeek 不带 thinking |
| `models.test.ts` | `/models` 解析、缺失字段、401/404/超时、`--list-models` 输出 |
| `send.test.ts` | `msg_seq` 递增；超时；错误体截断 |
| `token.test.ts` | 缓存命中；并发去重；401 强制刷新 |
| `tagger.test.ts` | 队列上限；并发；启动只入队路径 |
| `atomic.test.ts` | 10MB 写入完整；临时文件清理；rename 失败重试 |
| `update.test.ts` | 回滚脚本片段；备份路径；失败还原 |
| `self-check.test.ts` | 各检查项成功/失败；输出 JSON；不写历史 |
| `persona.test.ts` | 称呼替换；读失败回退；默认人设不变 |
| `proactive.test.ts` | 每天次数跨天重置；免打扰边界 |
| `useController` 纯逻辑 | `shouldRestartAfterSave`；`mergeConfig`；`pickOldLogs` |

### 6.2 集成/注入式测试

- 用本地 HTTP 服务器模拟 LLM 与 QQ token：验证超时、重试、错误码、响应体截断。
- 用可控 Promise 模拟摘要，验证 epoch。
- 用临时目录跑 config 迁移/原子写/图库索引。
- 用 `node:test` mock timers 测主动消息的跨天/免打扰边界（把 `now` 注入）。

### 6.3 手工冒烟矩阵

| 场景 | 期望 |
|---|---|
| 全新安装（无 config） | 打开设置页，填完保存后 Bot 启动 |
| 从 v0.1.2 升级（有 config/data） | 配置自动迁移，历史/记忆/图库都在，行为不变 |
| 运行中改任一服务端设置 | 保存后重启一次，QQ 重新上线 |
| 暂停状态改设置 | **不自动启动**，提示下次启动生效 |
| 非法值（0、负数、超大、空） | 字段级报错，保存被阻止 |
| 人设编辑/恢复默认 | 下一条消息生效；恢复默认可用 |
| 思考强度 Off/Low/High/Max | 请求体符合文档；Off 时 temperature 恢复生效 |
| 获取模型（正常/Key 错/接口不支持） | 下拉可选中；失败有明确提示 |
| 自检成功/LLM Key 错/断网 | 分别给出明确结果 |
| 一次发 6 张图 | 请求体不超预算；回复正常 |
| 更新时锁住文件 | 自动还原旧版本并启动 |
| 中文用户名路径开机自启 | 重启后自启生效（CR-29） |
| 托盘创建失败 | 关窗不会“消失到不存在的地方”（CR-28） |
| 日志保留 7 天 | 启动时清理旧文件 |

### 6.4 CI

- PR/push 到 `main`：`pnpm typecheck`、`pnpm test`、`prettier --check`、`pnpm build`。
- tag：现有打包 + Release + `SHA256SUMS.txt`。
- 可选：Windows runner 上跑一次 `pnpm desktop:build`（Vite 打包），不需要 neu build。

---

## 7. 文档与发版

### 7.1 文档改动

- `README.md`：
  - 新增「自定义」一节，按三层列出能改什么；
  - 数据与隐私改正：图片会发给模型服务商（看图/打标时），关闭方法；
  - 常见问题补：人设在哪、怎么重置、自检怎么用。
- `AGENTS.md`：
  - 第 9 节隐私表述修正；
  - 新增「设置架构」小节：settings.ts 契约、config v2、迁移、校验、桌面映射；
  - 第 11 节维护任务补：加设置项改哪里、加自检项改哪里；
  - 明确 `settings.ts` 的跨端 import 例外与三条规矩。
- `CHANGELOG.md`：v0.2.0 新增/改进/修复/文档四段。
- `docs/README.md`：设置页截图更新说明。
- 截图：设置页（基础/高级/人设/自检）各一张，替换/新增 `docs/screenshots/`。

### 7.2 发版

- 版本：`0.2.0`（minor，新增能力，无破坏性配置；v1 自动迁移）。
- 发版前：`pnpm release patch|minor` 会跑 typecheck/test；手工补 CHANGELOG 并先提交。
- 发布后：在打包版上跑一次自检、改一次设置、导出一次数据（v0.3）、检查一次更新。
- 回滚：保留 v0.1.2 zip；配置备份 `config.json.bak-v1-*`；数据备份不强制。

---

## 8. 风险与待决问题

### 8.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| settings 跨端 import 破坏边界 | 桌面构建/打包把服务端运行时带进来 | 纯契约文件只读 import；单测断言无 `node:`/DOM；codegen 作为备选 |
| 人设放 APPDATA 后用户找不到 | 以为人设丢了 | 设置页显式路径 + “打开目录”；默认/覆盖双文件 + 恢复默认 |
| 新增配置默认值改变行为 | 用户觉得“更新完变了” | 默认=现状；快照测试；CHANGELOG 写明 |
| 数据导入覆盖出错 | 丢数据 | 强制备份、只接受预定义目录、失败还原；放在后续阶段 |
| 图片裁剪后模型看不到关键图 | 回复质量下降 | 默认预算足够 1–2 张；日志提示跳过；后续做缩略图 |
| 自检与运行中的 Bot 并发 | token 请求重复/额度 | 自检只读 token + 一次 ping；不建 WS |
| 设置项过多 UI 混乱 | 用户找不到 | Tab + 常用/高级分离 + 搜索（可选） |
| 更新回滚脚本复杂 | 引入新 bug | 纯函数生成脚本 + 注入失败手测；保留旧 zip |

### 8.2 还需要你确认的

大部分决策已经定了，我只剩两件真正需要你点头的事：

1. **真实 QQ 冒烟**：是否允许我用现有 `apps/server/.env` 启动一次 Bot 做端到端验证？
   这会占用同一个 AppID 的 WS 连接，可能把你正在跑的实例踢下线。
   默认我**不主动连真实 QQ**，只做单测/本地模拟，最后由你在手机上冒烟。
2. **Git 工作流**：每个阶段我提交一个 commit（不 push），还是只改工作区、由你统一提交？
   默认我**不 commit、不 push**，除非你明确说。

以下是我会自行决定、不再打扰你的：

- 设置页分 6 个 Tab（基础 / 对话 / 主动 / 表情包 / 高级 / 数据）。
- 高级 JSON（模型额外参数）保留，折叠在「高级」里，做保留字段校验。
- 数据备份默认不含 `config.json` 与密钥；需要时单独勾选。
- 版本号按 minor 走；先落 P0/P1，再逐步并入 UI 与维护能力。
- 强调色、字号、命令/心情自定义放到设置 v2 稳定之后，不阻塞主线。

---

## 附录 A：新增环境变量速查

| 变量 | 默认 | 引入阶段 |
|---|---|---|
| `DEEPSEEK_TEMPERATURE` | 不设置（自动） | v0.2 |
| `DEEPSEEK_MAX_TOKENS` | 0 | v0.2 |
| `DEEPSEEK_THINKING_EFFORT` | high | v0.2 |
| `DEEPSEEK_EXTRA_BODY` | `{}` | v0.2 |
| `VISION_ENABLED` | true | v0.2 |
| `LLM_MAX_IMAGES` | 6 | v0.2 |
| `LLM_MAX_IMAGE_BYTES` | 16777216 | v0.2 |
| `OWNER_NAME` | 主人 | v0.2 |
| `STICKER_ENABLED` | true | v0.2 |
| `STICKER_MIN_SCORE` | 0.12 | v0.2 |
| `STICKER_ALLOW_RANDOM` | true | v0.2 |
| `STICKER_AUTO_INGEST` | true | v0.2 |
| `STICKER_TAG_CONCURRENCY` | 2 | v0.2 |
| `PROACTIVE_MAX_PER_DAY` | 1 | v0.2 |
| `LOG_LEVEL` | info | v0.2 |
| `STICKER_MAX_LIBRARY` | 0 | v0.3 |
| `COMMAND_DISABLED` | 空 | v0.3 |

内部变量（不暴露给用户）：`WHALE_DATA_DIR`、`WHALE_PERSONA_FILE`、`WHALE_GUI`、
`WHALE_PARENT_PID`；新增 `WHALE_DEFAULT_PERSONA_FILE`（安装目录默认人设路径，
`WHALE_PERSONA_FILE` 指向 APPDATA 覆盖文件，覆盖不存在时读默认）。

## 附录 B：以后每次改动的审查清单

1. 所有 `await` 前后，是否可能被别的消息/命令/摘要改写同一份数据？
2. 所有网络请求是否有超时、是否区分可重试错误、错误信息是否带状态码？
3. 所有用户输入是否有范围/长度/枚举校验？非法值是否 fail fast？
4. 所有写盘是否走原子写？写失败是否会留下半成品/孤儿文件？
5. 所有失败路径是否能回到“旧版本还能用”的状态？
6. Windows 路径/编码/中文用户名是否实测？
7. 是否把密钥/聊天正文写进日志？
8. 是否破坏 `core/channels/store/desktop` 的分层？
9. 新增设置是否同时更新：schema、桌面默认、服务端默认、`.env.example`、README/AGENTS？
10. 是否补了对应的纯函数/注入式测试？
