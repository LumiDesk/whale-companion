/**
 * QQ WebSocket 断线处置策略：纯函数，方便单测。
 *
 * 平台语义（和之前的实现相反，这里是最容易踩的坑）：
 * - op 7 = 服务端要求重连，属于正常运维动作；
 * - 4006 / 4007 / 4008 / 4009 是 session、seq、频率、过期问题，**重连就能恢复**；
 * - 4010 / 4012 / 4013 / 4014 / 4914 / 4915 是分片、协议、权限、下架、封禁，重连没有意义。
 *
 * 旧实现把 4009 也当致命错误直接退出，导致一次会话过期后机器人永久离线，
 * 只能靠用户手动重启（见 2026-10-26 的日志：12:16:43 断开，14:47:38 才被人重启）。
 */

export type CloseDecision = "fatal" | "reconnect";

export interface IReconnectState {
  /** 连续重连次数，用于指数退避；会话稳定后清零 */
  attempt: number;
  /** 连续「刚连上就被断开」的次数，用于识别同一 AppID 被抢连接 */
  rapidKicks: number;
}

export interface ICloseOutcome {
  decision: CloseDecision;
  /** 给人看的中文原因 */
  reason: string;
  /** 下一次重连前等多久；fatal 时为 0 */
  delayMs: number;
  state: IReconnectState;
}

export const RECONNECT_BASE_MS = 3_000;
export const RECONNECT_MAX_MS = 60_000;
/** 连上不到这么久就被断开，算「疑似被顶号」 */
export const RAPID_KICK_MS = 10_000;
/** 连续这么多次疑似被顶号后，把重连间隔放慢到 5 分钟 */
export const RAPID_KICK_LIMIT = 3;
export const RAPID_KICK_BACKOFF_MS = 300_000;
/** 稳定在线这么久，就认为上一轮故障已经恢复 */
export const HEALTHY_SESSION_MS = 60_000;

/** 重连没用、只能改配置或去平台处理的关闭码 */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4010: "Shard 配置不正确",
  4012: "协议版本不受支持",
  4013: "Intents 不合法",
  4014: "Intents 没有权限，去 q.qq.com 检查事件订阅",
  4914: "机器人已下架",
  4915: "机器人已封禁",
};

/** 常见关闭码的中文说明；没收录的就显示原始数字 */
const CLOSE_HINTS: Record<number, string> = {
  1000: "正常关闭",
  1001: "对端离开",
  1005: "客户端主动关闭",
  1006: "网络中断",
  4006: "session 无效",
  4007: "seq 错误",
  4008: "发送过快",
  4009: "连接过期",
};

export const describeCloseCode = (code: number): string =>
  CLOSE_HINTS[code] ?? (code < 0 ? "连接异常" : `关闭码 ${code}`);

export const classifyClose = (code: number): CloseDecision =>
  FATAL_CLOSE_CODES[code] ? "fatal" : "reconnect";

export const fatalReason = (code: number): string =>
  FATAL_CLOSE_CODES[code] ?? describeCloseCode(code);

/** 指数退避：3s → 6s → 12s … 封顶 60s；疑似被顶号时至少等 5 分钟 */
export const reconnectDelay = (attempt: number, rapidKicks = 0): number => {
  const step = Math.min(Math.max(attempt - 1, 0), 10);
  const base = Math.min(RECONNECT_BASE_MS * 2 ** step, RECONNECT_MAX_MS);
  return rapidKicks >= RAPID_KICK_LIMIT
    ? Math.max(base, RAPID_KICK_BACKOFF_MS)
    : base;
};

export const initialReconnectState = (): IReconnectState => ({
  attempt: 0,
  rapidKicks: 0,
});

/** 上一次连接的会话快照；断线后用它发 op 6 resume，平台会把漏掉的事件补发回来 */
export interface ISessionSnapshot {
  id: string;
  seq: number;
  /** 最近一次确认会话有效的时间（READY / RESUMED） */
  at: number;
}

/** resume 的有效窗口：超过就老老实实重新 identify */
export const RESUME_TTL_MS = 5 * 60_000;

export const canResumeSession = (
  session: ISessionSnapshot | null,
  now = Date.now(),
): boolean => {
  if (!session || !session.id) return false;

  const age = now - session.at;
  return age >= 0 && age <= RESUME_TTL_MS;
};

/**
 * 根据一次连接的关闭结果决定下一步。
 * `sessionMs` 是 READY 之后存活了多久；负值表示这次根本没连上（取 token / 网关失败）。
 */
export const planReconnect = (
  state: IReconnectState,
  code: number,
  sessionMs: number,
): ICloseOutcome => {
  if (classifyClose(code) === "fatal") {
    return {
      decision: "fatal",
      reason: fatalReason(code),
      delayMs: 0,
      state: initialReconnectState(),
    };
  }

  const connected = sessionMs >= 0;
  const healthy = connected && sessionMs >= HEALTHY_SESSION_MS;
  const rapid = connected && sessionMs < RAPID_KICK_MS;

  const attempt = healthy ? 1 : state.attempt + 1;
  const rapidKicks = healthy ? 0 : rapid ? state.rapidKicks + 1 : 0;

  return {
    decision: "reconnect",
    reason: describeCloseCode(code),
    delayMs: reconnectDelay(attempt, rapidKicks),
    state: { attempt, rapidKicks },
  };
};
