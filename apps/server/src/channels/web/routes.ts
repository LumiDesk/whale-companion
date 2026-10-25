import { Hono } from "hono";

import { generateReply } from "../../core/chat.js";
import { touchUser } from "../../store/users.js";
import { slog } from "../../util.js";

interface IChatBody {
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** 网页通道：给浏览器/调试用，和 QQ 共用同一套 core */
export const createWebApp = () => {
  const app = new Hono();

  app.get("/", (c) => c.text("whale-companion server"));

  app.post("/api/chat", async (c) => {
    let body: IChatBody;
    try {
      body = await c.req.json<IChatBody>();
    } catch {
      return c.json({ error: "不是合法 JSON" }, 400);
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages 不能为空" }, 400);
    }

    const lastUser = [...body.messages]
      .reverse()
      .find((m) => m.role === "user" && typeof m.content === "string");

    if (!lastUser) {
      return c.json({ error: "没有找到用户消息" }, 400);
    }

    try {
      touchUser("web", "web");
      const reply = await generateReply("web", String(lastUser.content));
      return c.json({ reply });
    } catch (e) {
      slog("网页聊天失败", e);
      return c.json({ error: "模型服务暂时不可用" }, 502);
    }
  });

  return app;
};
