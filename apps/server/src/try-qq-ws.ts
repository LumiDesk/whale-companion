import { AIReply } from "./llm.js";
import { getPersona } from "./persona.js";
import { getAccessToken } from "./qq/token.js";

const token = await getAccessToken();

const gateway = await fetch("https://api.sgroup.qq.com/gateway", {
  headers: {
    Authorization: "QQBot " + token,
  },
});

const url: string = (await gateway.json()).url;

const ws = new WebSocket(url);

let lastSeq: number | null = null;

interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// key是user，记录不同用户的聊天记录
const messageMap = new Map<string, IMessage[]>();

ws.onmessage = async (e) => {
  const data = JSON.parse(e.data);
  if (data.s) lastSeq = data.s;
  if (data.op === 10) {
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: "QQBot " + token,
          intents: 1 << 25,
          shard: [0, 1],
        },
      }),
    );
    setInterval(() => {
      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
    }, data.d.heartbeat_interval);
  }

  // 收到了用户的消息
  if (data.t === "C2C_MESSAGE_CREATE") {
    const user_id = data.d.author.user_openid;
    const historys = messageMap.get(user_id) || [
      { role: "system", content: getPersona() },
    ];
    historys.push({ role: "user", content: data.d.content });

    const apply = await AIReply({ messages: historys });

    const res = await fetch(
      `https://api.sgroup.qq.com/v2/users/${user_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `QQBot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: apply,
          msg_type: 0,
          msg_id: data.d.id,
        }),
      },
    );

    historys.push({ role: "assistant", content: apply });
    messageMap.set(user_id, historys);
  }
};

ws.onclose = (e) => {
  console.log("close", e);
};

ws.onerror = (e) => {
  console.log("error", e);
};
