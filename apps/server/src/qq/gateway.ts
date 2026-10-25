import { handler } from "./handler.js";
import { getAccessToken } from "./token.js";
import { slog } from "./util.js";

const connect = async (token: string) => {
  const gateway = await fetch("https://api.sgroup.qq.com/gateway", {
    headers: {
      Authorization: "QQBot " + token,
    },
  });

  const url: string = (await gateway.json()).url;

  const ws = new WebSocket(url);

  let lastSeq: number | null = null;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
      heartbeatTimer = setInterval(() => {
        ws.send(JSON.stringify({ op: 1, d: lastSeq }));
      }, data.d.heartbeat_interval);
    }

    // 收到了用户的消息
    if (data.t === "C2C_MESSAGE_CREATE")
      await handler(
        data.d.author.user_openid,
        data.d.id,
        token,
        data.d.content,
      );

    // 日志输出
    switch (data.op) {
      case 10: {
        slog(`heartbeat: ${data.d.heartbeat_interval}`);
        break;
      }
      case 0: {
        if (data.t === "READY") {
          slog("ready");
        }
        break;
      }
      case 11: {
        slog("♥");
        break;
      }
    }
  };

  ws.onclose = (e) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    console.log("close", e.code, e.reason);
  };

  ws.onerror = (e) => {
    console.log("error", e);
  };
};

export const startQQ = async () => {
  const token = await getAccessToken();
  await connect(token);
};
