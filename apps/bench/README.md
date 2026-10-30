# @apps/bench · 拟人度对话 benchmark

给「小鲸鱼」做的主观评测工具：**同一批固定场景 × 不同提示词/采样变体**，输出一份可以盲评打分的 HTML 报告。

它不是单元测试，也不替代 `pnpm test`；它回答的是「哪一版读起来更像人、更像在聊天」。

## 跑一次

```bash
# 默认读取 %APPDATA%\whale-companion\config.json 里的 apiKey / baseUrl / model
pnpm bench

# 只跑部分变体 / 场景
pnpm bench -- --variants baseline,examples --scenarios daily,compliment

# 换配置文件
pnpm bench -- --config "C:\path\to\config.json"

# 只打印将要执行的命令，不调用模型
pnpm bench -- --dry-run
```

输出在 `apps/bench/out/<runId>/`：

| 文件             | 用途                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `report.html`    | **打分用**：每个场景 4 段匿名对话，1–5 分 + 「最像人」+ 备注，可导出 JSON |
| `report.md`      | 纯文本阅读版，方便直接看对话                                              |
| `results.json`   | 完整原始结果（含工具调用、耗时、采样参数）                                |
| `<variant>.json` | 每个变体的单独结果                                                        |
| `prompts/`       | 本次实际使用的提示词副本（可复查）                                        |

评分只存在浏览器 `localStorage`；评完点「导出评分」，会打开一个 JSON 窗口，可以「复制 JSON」或「下载 .json」。如果浏览器拦截了下载，直接点复制，把内容发回来即可。

## 变体

定义在 `src/variants.ts`：

| id                  | 含义                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `baseline`          | 仓库当前的 persona（已修形象本体）+ behavior + `thinking=low`，带联网搜索                                  |
| `examples`          | 采样不变；在基线之上再加一组对照示例（人格卡「再补几组」+ 行为层「说法示例」）                             |
| `examples-sampling` | 示例增强 + `thinking=off`、`temperature=1.2`、`presence_penalty=0.6`、`frequency_penalty=0.4`、`top_p=0.9` |
| `lean`              | 上一个变体 + 行为层瘦身（去掉表情包 / 主动 / 自检等）                                                      |

`examples` / `lean` 的提示词是 `scripts/build-variants.mjs` 从仓库当前文件派生出来的：

```bash
node apps/bench/scripts/build-variants.mjs
```

改了 `apps/server/personas/` 或 `prompts/behavior/` 之后重新跑一次，变体才不会落后。生成物在 `variants/examples/` 与 `variants/lean/`，可以直接改，但下次重新生成会被覆盖。

## 场景

定义在 `src/scenarios.ts`，目前 9 个：无聊的下午、被叫大肥鱼、问最新模型、今天有点难受、你还记得吗、被夸了、你住在哪、你长什么样、发了个表情包。

每个场景是一串**脚本化用户消息**；这样所有变体面对完全一样的输入，差异只来自提示词/采样。`memory` 场景额外带 4 条开局历史，用来测记忆回调。`identity` / `appearance` 专门测「小鲸鱼是形象还是真的水生动物」——她不应该把话题拐到水里。`sticker` 用 `[表情包：名字]` 模拟官方 API 收到表情包时的形态，配套图库在 `fixtures/stickers/`（3 张图），跑之前会复制进每个变体的数据目录。

加场景：往数组里追加对象即可（`id` 不要改，报告按 id 关联评分）。

## 加一个变体

1. 在 `src/variants.ts` 加 `IVariantSpec`（`promptSource` 指向 `variants/<dir>/`，可只放 `persona.md` 或 `behavior.md`，另一个自动用仓库当前文件）。
2. 需要自定义提示词时，建 `variants/<dir>/persona.md` / `behavior.md`。
3. 跑 `pnpm bench -- --variants <新 id>`。

## 实现

- 复用服务端**真实的** `runAgentTurn` / `askModelWithTools` / 工具 schema；只把 QQ 发送换成一个记录用的 mock `toolContext`。
- 消息内的换行会被服务端处理：`send_message` 拆成多条，额度不够时压成一行；没走工具的兜底文本也会压成一行。所以报告里的每条「小鲸鱼」消息都是单行。
- 每个变体跑在独立子进程里：`config` 是单例，靠 `WHALE_PERSONA_DIR` / `WHALE_PROMPTS_DIR` / `DEEPSEEK_*` 环境变量在启动时切分。
- `sleep` 被 mock 成 no-op，回合内不会真的等 1–3 秒；报告里的耗时是模型 + 搜索的真实耗时，不含 QQ 发送节奏。
- 不写真实 `data/`：每个变体用 `out/<runId>/data/<variant>/` 作为数据目录。
- 不读 `.env`；API Key 只从 `config.json` 读，并且只通过子进程环境变量传递，不写进结果文件。

## 局限

- 用户是脚本，不会根据她的回答追问；测的是「面对同一句话，她怎么接」，不是完整自由对话。
- 每个场景只跑一次，随机性会带来噪声；想稳一点可以多跑几次手动对比，或后续加 `--repeat`。
- 没有真实 QQ 延迟、没有主动消息；表情包只测「她挑不挑、发不发」，发出去的是 mock（报告里记 `[表情包]`）。
- 评分是主观的：**先自己盲评一遍，再揭晓**，比看完成分再评可靠。
