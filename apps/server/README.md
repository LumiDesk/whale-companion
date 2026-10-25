# apps/server

小鲸鱼的本体：核心对话 + QQ 通道。没有对外 HTTP 服务，也没有 Web 调试页。

- 启动：`pnpm dev`（需先按 `.env.example` 建好 `.env`）
- 单测：`pnpm --filter @apps/server test`
- 桌面端会通过 `--config <json>` 传入配置（合并进 `process.env`），并注入
  `WHALE_DATA_DIR` / `WHALE_PERSONA_FILE` / `WHALE_GUI` / `WHALE_PARENT_PID`
- 结构、分层规则、QQ 平台坑：见仓库根 [`AGENTS.md`](../../AGENTS.md)
- 用户视角的用法：见仓库根 [`README.md`](../../README.md)
