# apps/server

小鲸鱼的本体：核心对话 + QQ 通道。没有对外 HTTP 服务，也没有 Web 调试页。

- 启动：`pnpm dev`（需先按 `.env.example` 建好 `.env`）
- 单测：`pnpm --filter @apps/server test`
- 桌面端会通过 `--config <json>` 传入配置（合并进 `process.env`），并注入
  `WHALE_DATA_DIR` / `WHALE_PERSONA_FILE` / `WHALE_DEFAULT_PERSONA_FILE` / `WHALE_GUI` / `WHALE_PARENT_PID`
- 一次性命令（不建立 QQ 长连接）：
  - `--self-check`：配置、数据目录、人设、图库、QQ token、模型接口
  - `--list-models`：调 `GET /models`，输出可用模型与思考档位
  - `--retag`：逐张给无标签表情包补标
- 设置字段/默认值/范围统一在 `src/settings.ts`；`config.ts` 启动时校验，非法值直接报错
- `data/` 下的 JSON 统一走原子写；启动时会清理旧历史里的 QQ 平台标记，备份为 `history.json.bak-*`
- 结构、分层规则、QQ 平台坑：见仓库根 [`AGENTS.md`](../../AGENTS.md)
- 用户视角的用法：见仓库根 [`README.md`](../../README.md)
