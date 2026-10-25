import { handler } from "./handler.js";
import { downloadImage } from "./media.js";
import { getAccessToken } from "./token.js";
import { slog } from "./util.js";

let delay = 3000;

const connect = async (token: string) => {
  const gateway = await fetch("https://api.sgroup.qq.com/gateway", {
    headers: {
      Authorization: "QQBot " + token,
    },
  });

  const url: string = (await gateway.json()).url;

  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);

    let lastSeq: number | null = null;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    ws.onmessage = async (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch (er) {
        slog("字符串解析失败", er, e.data);
        return;
      }
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
      if (data.t === "C2C_MESSAGE_CREATE") {
        // 读取附件图片
        const img = data.d.attachments?.find((a: any) =>
          a.content_type?.startsWith("image"),
        );
        if (img) {
          const { data, mime } = await downloadImage(img.url);
          slog("image", mime, data.byteLength);
        }

        // handler 流程
        try {
          await handler(
            data.d.author.user_openid,
            data.d.id,
            token,
            data.d.content,
          );
        } catch (e) {
          slog("消息解析失败", e);
        }
      }
      // 日志输出
      switch (data.op) {
        case 10: {
          slog(`heartbeat: ${data.d.heartbeat_interval}`);
          break;
        }
        case 0: {
          if (data.t === "READY") {
            slog("ready");
            delay = 3000;
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
      resolve(e.code);
    };

    ws.onerror = (e) => {
      console.log("error", e);
    };
  });
};

export const startQQ = async () => {
  while (true) {
    let code: number | undefined;

    try {
      const token = await getAccessToken();
      code = await connect(token);
    } catch (e) {
      slog("连接失败", e);
    }

    if (code === 4009 || code === 4006 || code === 4007 || code === 4008) {
      break; // 这几种重连没用或会互踢
    }

    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 60000);
  }
};
