import { createAggregator } from "./aggregator.js";
import { createQQHandler } from "./handler.js";
import { downloadImage } from "./media.js";
import { cleanQQContent } from "./text.js";
import { getAccessToken } from "./token.js";
import { reportStatus } from "../../status.js";
import { slog } from "../../util.js";
import type { IImageInput } from "../../types/message.js";

let delay = 3000;

const HANDSHAKE_TIMEOUT_MS = 10_000;
const MIN_HEARTBEAT_MS = 1000;
const MAX_HEARTBEAT_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 41_250;

/** QQ 心跳间隔：只接受 1s–120s，异常值回退默认，避免 0 或超大值把连接拖死 */
export const resolveHeartbeatInterval = (value: unknown): number => {
  const requested = Number(value);
  return Number.isFinite(requested) &&
    requested >= MIN_HEARTBEAT_MS &&
    requested <= MAX_HEARTBEAT_MS
    ? requested
    : DEFAULT_HEARTBEAT_MS;
};

type PushFn = (msg: {
  userId: string;
  msgId: string;
  text: string;
  images: IImageInput[];
}) => void;

/**
 * 处理一条 C2C 消息：先下载图片，再交给聚合器。
 * 串行执行，保证"先发的消息先聚合"，不会因为某张图下载慢而乱序。
 */
const handleC2CMessage = async (d: any, push: PushFn): Promise<void> => {
  const userId: string | undefined = d.author?.user_openid;
  if (!userId || !d.id) return;

  const images: IImageInput[] = [];
  for (const att of d.attachments ?? []) {
    if (!String(att.content_type ?? "").startsWith("image/")) continue;

    try {
      images.push(await downloadImage(att.url));
    } catch (err) {
      slog("图片下载失败（跳过这张）", err);
    }
  }

  push({
    userId,
    msgId: d.id,
    text: cleanQQContent(String(d.content ?? "")),
    images,
  });
};

const fetchGatewayUrl = async (token: string): Promise<string> => {
  let res: Response;

  try {
    res = await fetch("https://api.sgroup.qq.com/gateway", {
      headers: { Authorization: `QQBot ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`拿网关失败（15 秒超时或网络错误）：${reason}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`拿网关失败 ${res.status}: ${body.slice(0, 200)}`);
  }

  const url = ((await res.json()) as { url?: string }).url;
  if (!url) throw new Error("拿网关失败：响应里没有 url");

  return url;
};

const connect = async (push: PushFn): Promise<number> => {
  reportStatus({ type: "qq", state: "connecting" });

  const token = await getAccessToken();
  const url = await fetchGatewayUrl(token);

  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);

    let lastSeq: number | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let ackTimer: ReturnType<typeof setInterval> | null = null;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAckAt = Date.now();
    let settled = false;
    /** 消息处理串行链 */
    let inbound: Promise<void> = Promise.resolve();

    const cleanup = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (ackTimer) {
        clearInterval(ackTimer);
        ackTimer = null;
      }
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
    };

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    const closeQuietly = () => {
      try {
        ws.close();
      } catch {
        // 已经关了
      }
    };

    handshakeTimer = setTimeout(() => {
      slog("QQ WebSocket 握手超时，准备重连");
      closeQuietly();
      finish(-1);
    }, HANDSHAKE_TIMEOUT_MS);

    ws.onopen = () => {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
    };

    ws.onmessage = (e) => {
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (err) {
        slog("收到无法解析的消息", err);
        return;
      }

      if (!data || typeof data !== "object") return;

      const payload =
        data.d && typeof data.d === "object" ? (data.d as any) : {};

      if (typeof data.s === "number") lastSeq = data.s;

      // op 7 = Reconnect：服务端要求重新连接
      if (data.op === 7) {
        slog("QQ 要求重连（op 7）");
        closeQuietly();
        return;
      }

      // op 9 = Invalid Session：清掉 seq，重新 identify
      if (data.op === 9) {
        slog("QQ 会话失效（op 9），重新连接");
        lastSeq = null;
        closeQuietly();
        return;
      }

      if (data.op === 10) {
        const interval = resolveHeartbeatInterval(payload.heartbeat_interval);

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

        lastAckAt = Date.now();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ op: 1, d: lastSeq }));
          } catch (error) {
            slog("发送心跳失败", error);
          }
        }, interval);

        if (ackTimer) clearInterval(ackTimer);
        ackTimer = setInterval(() => {
          if (Date.now() - lastAckAt <= Math.max(interval * 2, 30_000)) return;

          slog("QQ 心跳无响应，主动重连");
          closeQuietly();
          finish(-1);
        }, Math.max(interval, 10_000));
        return;
      }

      if (data.op === 11) {
        lastAckAt = Date.now();
        return;
      }

      if (data.op === 0 && data.t === "READY") {
        slog(`QQ 已上线 bot=${payload.user?.id ?? "?"}`);
        reportStatus({
          type: "qq",
          state: "online",
          botId: payload.user?.id ?? null,
        });
        delay = 3000;
        return;
      }

      if (data.t !== "C2C_MESSAGE_CREATE") return;

      const d = payload;
      inbound = inbound
        .then(() => handleC2CMessage(d, push))
        .catch((err) => slog("消息处理失败", err));
    };

    ws.onclose = (e) => {
      slog(`QQ 连接关闭 code=${e.code} reason=${e.reason || "(空)"}`);
      reportStatus({
        type: "qq",
        state: "closed",
        code: e.code,
        reason: e.reason || "",
      });
      finish(e.code);
    };

    ws.onerror = (e) => {
      slog("QQ 连接错误", e);
      reportStatus({ type: "qq", state: "error" });
      closeQuietly();
      finish(-1);
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
      reportStatus({ type: "qq", state: "error" });
    }

    if (code === 4009 || code === 4006 || code === 4007 || code === 4008) {
      slog(`关闭码 ${code}：不再重连（需要人工处理）`);
      reportStatus({ type: "qq", state: "stopped", code });
      return;
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 60_000);
  }
};
