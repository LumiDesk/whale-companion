import { downloadImage } from "./media.js";
import {
  canResumeSession,
  initialReconnectState,
  planReconnect,
  RAPID_KICK_LIMIT,
  type IReconnectState,
  type ISessionSnapshot,
} from "./reconnect.js";
import { cleanQQContent } from "./text.js";
import { getAccessToken } from "./token.js";
import { reportStatus } from "../../status.js";
import { slog } from "../../util.js";
import type { IImageInput } from "../../types/message.js";

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

export type QQPush = PushFn;

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

  const text = cleanQQContent(String(d.content ?? ""));

  // 每收到一条就记一行：没有这行日志时，"机器人是不是没收到消息"只能靠猜
  slog(
    `收到消息 ${String(d.id).slice(0, 8)}：${text.length} 字` +
      `${images.length > 0 ? ` / ${images.length} 图` : ""}`,
  );

  if (!text && images.length === 0) {
    slog("这条消息既没有文字也没有图片（可能是语音/卡片），已跳过");
    return;
  }

  push({ userId, msgId: d.id, text, images });
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

/** 一次 WebSocket 连接的结局：关闭码 + READY 之后活了多久（负值表示没连上） */
export interface IConnectionResult {
  code: number;
  sessionMs: number;
  /** 这次连接拿到的会话；null 表示没有有效会话，下次必须 identify */
  session: ISessionSnapshot | null;
}

const connect = async (
  push: PushFn,
  previous: ISessionSnapshot | null,
): Promise<IConnectionResult> => {
  reportStatus({ type: "qq", state: "connecting" });

  const token = await getAccessToken();
  const url = await fetchGatewayUrl(token);

  return new Promise<IConnectionResult>((resolve) => {
    const ws = new WebSocket(url);

    let lastSeq: number | null = previous?.seq ?? null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let ackTimer: ReturnType<typeof setInterval> | null = null;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAckAt = Date.now();
    let readyAt: number | null = null;
    /** READY 或 RESUMED 之后才有效；op 9 会清空 */
    let activeSessionId: string | null = null;
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
      resolve({
        code,
        sessionMs: readyAt === null ? -1 : Date.now() - readyAt,
        session: activeSessionId
          ? { id: activeSessionId, seq: lastSeq ?? 0, at: Date.now() }
          : null,
      });
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

      // op 9 = Invalid Session：会话彻底失效，清掉 session 与 seq，下次重新 identify
      if (data.op === 9) {
        slog("QQ 会话失效（op 9），下次重新建立会话");
        activeSessionId = null;
        lastSeq = null;
        closeQuietly();
        return;
      }

      if (data.op === 10) {
        const interval = resolveHeartbeatInterval(payload.heartbeat_interval);
        const resumable = canResumeSession(previous) ? previous : null;

        ws.send(
          JSON.stringify(
            resumable
              ? {
                  op: 6,
                  d: {
                    token: `QQBot ${token}`,
                    session_id: resumable.id,
                    seq: resumable.seq,
                  },
                }
              : {
                  op: 2,
                  d: {
                    token: `QQBot ${token}`,
                    intents: 1 << 25,
                    shard: [0, 1],
                  },
                },
          ),
        );

        if (resumable) {
          slog(`QQ 尝试恢复会话（resume，seq=${resumable.seq}）`);
        }

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
        ackTimer = setInterval(
          () => {
            const silentMs = Date.now() - lastAckAt;
            if (silentMs <= Math.max(interval * 2, 30_000)) return;

            slog(`QQ 心跳 ${Math.round(silentMs / 1000)} 秒没有响应，主动重连`);
            closeQuietly();
            finish(-1);
          },
          Math.max(interval, 10_000),
        );
        return;
      }

      if (data.op === 11) {
        lastAckAt = Date.now();
        return;
      }

      if (data.op === 0 && data.t === "READY") {
        readyAt = Date.now();
        activeSessionId =
          typeof payload.session_id === "string" && payload.session_id
            ? payload.session_id
            : null;
        slog(
          `QQ 已上线 bot=${payload.user?.id ?? "?"}` +
            (activeSessionId
              ? ""
              : "（没拿到 session_id，断线后只能重建会话）"),
        );
        reportStatus({
          type: "qq",
          state: "online",
          botId: payload.user?.id ?? null,
        });
        return;
      }

      // RESUMED：op 6 成功，会话接回来了，断线期间的事件由平台补发
      if (data.op === 0 && data.t === "RESUMED") {
        readyAt = Date.now();
        activeSessionId = previous?.id ?? null;
        slog(`QQ 会话已恢复（resume，seq=${lastSeq ?? 0}）`);
        reportStatus({
          type: "qq",
          state: "online",
          botId: payload.user?.id ?? null,
        });
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * QQ 通道主循环：断了就按策略重连，只有「配置/权限」类错误才停。
 * 会话过期（4009）之类的平台动作不再让机器人永久离线。
 */
export const startQQ = async (push: PushFn) => {
  let state: IReconnectState = initialReconnectState();
  /** 跨连接保留的会话，用来在断线后 resume，避免丢消息 */
  let session: ISessionSnapshot | null = null;

  for (;;) {
    let result: IConnectionResult;

    try {
      result = await connect(push, session);
    } catch (e) {
      slog("连接失败", e);
      reportStatus({ type: "qq", state: "error" });
      result = { code: -1, sessionMs: -1, session };
    }

    // 4009 / 4006 说明平台侧会话已经作废，resume 必然失败，直接走 identify
    session =
      result.code === 4009 || result.code === 4006 ? null : result.session;

    const plan = planReconnect(state, result.code, result.sessionMs);
    state = plan.state;

    if (plan.decision === "fatal") {
      slog(
        `QQ 连接无法恢复（${plan.reason}），请检查机器人配置或平台权限；` +
          "改好后在控制台重启 Bot 即可",
      );
      reportStatus({
        type: "qq",
        state: "stopped",
        code: result.code,
        reason: plan.reason,
      });
      return;
    }

    const seconds = Math.round(plan.delayMs / 1000);
    slog(
      `QQ ${plan.reason}，${seconds} 秒后重连（第 ${state.attempt} 次` +
        `${state.rapidKicks >= RAPID_KICK_LIMIT ? "，连续被顶号，已放慢" : ""}` +
        `${session ? "，将尝试 resume" : ""}）`,
    );
    reportStatus({
      type: "qq",
      state: "connecting",
      code: result.code,
      reason: plan.reason,
    });

    await sleep(plan.delayMs);
  }
};
