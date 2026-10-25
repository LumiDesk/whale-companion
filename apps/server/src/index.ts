import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getPersona } from "./persona.js";
import { AIReply } from "./llm.js";
import { startQQ } from "./qq/gateway.js";

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface IRequestApiChat {
  messages: Array<IMessage>;
}

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.post("/api/chat", async (c) => {
  let body: IRequestApiChat;
  try {
    body = await c.req.json<IRequestApiChat>();
  } catch (_) {
    return c.json({ error: "不是合法 JSON" }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ error: "必须是数组" }, 400);
  }
  if (body.messages.length === 0) {
    return c.json({ error: "不能为空" }, 400);
  }
  const lastMessage = body.messages.findLast((i) => i.role === "user");
  if (!lastMessage) {
    return c.json({ error: "没有找到用户消息" }, 400);
  }

  // Main Chats
  const messages: Array<IMessage> = [
    { role: "system", content: getPersona() },
    ...body.messages,
  ];

  let res: string;
  try {
    res = await AIReply({ messages });
  } catch (e) {
    console.error(e);
    return c.json({ error: "模型服务暂时不可用" }, 502);
  }
  return c.json({ reply: res });
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

await startQQ();
