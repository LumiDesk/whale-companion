import { createAggregator } from "./aggregator.js";
import { createQQHandler } from "./handler.js";
import { downloadImage } from "./media.js";
import { getAccessToken } from "./token.js";
import { slog } from "../../util.js";
import type { IImageInput } from "../../types/message.js";

let delay = 3000;

type PushFn = (msg: {
  userId: string;
  msgId: string;
  text: string;
  images: IImageInput[];
}) => void;

const connect = async (push: PushFn): Promise<number> => {
  const token = await getAccessToken();

  const gateway = await fetch("https://api.sgroup.qq.com/gateway", {
    headers: { Authorization: `QQBot ${token}` },
  });
  if (!gateway.ok) throw new Error(`拿网关失败 ${gateway.status}`);

  const url = ((await gateway.json()) as { url: string }).url;

  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);

    let lastSeq: number | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    ws.onmessage = async (e) => {
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (err) {
        slog("收到无法解析的消息", err);
        return;
      }

      if (typeof data.s === "number") lastSeq = data.s;

      if (data.op === 10) {
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${token}`,
              intents: 1 << 25,
              shard: [0, 1],
            },
          }),
        );
        heartbeatTimer = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: lastSeq }));
        }, data.d.heartbeat_interval);
        return;
      }

      if (data.op === 11) return; // 心跳 ACK，不刷日志
      if (data.op === 0 && data.t === "READY") {
        slog(`QQ 已上线 bot=${data.d?.user?.id ?? "?"}`);
        delay = 3000;
        return;
      }

      if (data.t !== "C2C_MESSAGE_CREATE") return;

      const d = data.d ?? {};
      const userId: string | undefined = d.author?.user_openid;
      if (!userId || !d.id) return;

      const images: IImageInput[] = [];
      for (const att of d.attachments ?? []) {
        if (!String(att.content_type ?? "").startsWith("image/")) continue;
        try {
          images.push(await downloadImage(att.url));
        } catch (err) {
          slog("图片下载失败", err);
        }
      }

      push({
        userId,
        msgId: d.id,
        text: String(d.content ?? ""),
        images,
      });
    };

    ws.onclose = (e) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      slog(`QQ 连接关闭 code=${e.code} reason=${e.reason || "(空)"}`);
      resolve(e.code);
    };

    ws.onerror = (e) => {
      slog("QQ 连接错误", e);
    };
  });
};

export const startQQ = async () => {
  const aggregator = createAggregator(createQQHandler(getAccessToken));

  while (true) {
    let code: number | undefined;

    try {
      code = await connect(aggregator.push);
    } catch (e) {
      slog("连接失败", e);
    }

    if (code === 4009 || code === 4006 || code === 4007 || code === 4008) {
      slog(`关闭码 ${code}：不再重连（需要人工处理）`);
      return;
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 60_000);
  }
};
