import { serve } from "@hono/node-server";

import { config } from "./config.js";
import { createWebApp } from "./channels/web/routes.js";
import { startQQ } from "./channels/qq/gateway.js";
import { slog } from "./util.js";

const app = createWebApp();

serve({ fetch: app.fetch, port: config.server.port }, (info) => {
  slog(`HTTP 服务已启动 http://localhost:${info.port}`);
});

// QQ 长连接与 HTTP 并行跑；内部自带重连，不会阻塞启动
void startQQ();
