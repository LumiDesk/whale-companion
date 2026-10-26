import { config } from "../../config.js";
import { slog } from "../../util.js";
import type {
  IIncomingMessage,
  IWaitOptions,
  IWaitResult,
} from "../../core/agent/types.js";
import type { IBatch } from "./aggregator.js";

interface IPushMessage {
  userId: string;
  msgId: string;
  text: string;
  images: IIncomingMessage["images"];
}

interface IPending {
  userId: string;
  messages: IIncomingMessage[];
  timer: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}

interface IActiveTurn {
  userId: string;
  inbox: IIncomingMessage[];
  consumedSeq: number;
  waiting: boolean;
  replyMsgId: string;
}

export interface ISessionHubOptions {
  onTurn: (
    batch: IBatch,
    messages: IIncomingMessage[],
    hub: ISessionHub,
  ) => Promise<void>;
  /** 返回 true 表示命令已被处理，不再进入回合 */
  onCommand?: (message: IIncomingMessage) => Promise<boolean>;
  /** 测试用：覆盖聚合节奏 */
  timing?: {
    silenceMs: number;
    maxWaitMs: number;
    maxTexts: number;
    maxImages: number;
  };
}

export interface ISessionHub {
  push(message: IPushMessage): void;
  wait(userId: string, options: IWaitOptions): Promise<IWaitResult>;
  currentMsgId(userId: string): string | null;
  stop(): void;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createSessionHub = (options: ISessionHubOptions): ISessionHub => {
  const pending = new Map<string, IPending>();
  const active = new Map<string, IActiveTurn>();
  const seqs = new Map<string, number>();
  const timing = options.timing ?? {
    silenceMs: config.batch.silenceMs,
    maxWaitMs: config.batch.maxWaitMs,
    maxTexts: config.batch.maxTexts,
    maxImages: config.batch.maxImages,
  };
  let closed = false;

  const nextSeq = (userId: string): number => {
    const next = (seqs.get(userId) ?? 0) + 1;
    seqs.set(userId, next);
    return next;
  };

  const clearPending = (item: IPending): void => {
    if (item.timer) clearTimeout(item.timer);
    if (item.deadline) clearTimeout(item.deadline);
    item.timer = null;
    item.deadline = null;
  };

  const startTurn = (messages: IIncomingMessage[]): void => {
    const first = messages[0];
    if (!first || closed) return;

    const userId = first.userId;
    const last = messages[messages.length - 1];
    const turn: IActiveTurn = {
      userId,
      inbox: [...messages],
      consumedSeq: last.seq,
      waiting: false,
      replyMsgId: last.msgId,
    };

    active.set(userId, turn);

    const batch: IBatch = {
      userId,
      msgId: last.msgId,
      texts: messages.map((message) => message.text).filter(Boolean),
      images: messages.flatMap((message) => message.images),
    };

    void options
      .onTurn(batch, messages, hub)
      .catch((error) => slog("回合处理失败", error))
      .finally(() => endTurn(userId, turn));
  };

  const endTurn = (userId: string, turn: IActiveTurn): void => {
    if (active.get(userId) !== turn) return;

    active.delete(userId);
    if (closed) return;

    const remaining = turn.inbox.filter(
      (message) => message.seq > turn.consumedSeq,
    );
    if (remaining.length === 0) return;

    // 回合结束时还有没被 wait 消费的消息：短延迟后开下一轮，避免丢消息
    const timer = setTimeout(() => {
      if (closed) return;
      startTurn(remaining);
    }, 500);
    timer.unref?.();
  };

  const route = (message: IIncomingMessage): void => {
    if (closed) return;

    const turn = active.get(message.userId);
    if (turn) {
      turn.inbox.push(message);
      turn.replyMsgId = message.msgId;
      return;
    }

    const now = Date.now();
    const item =
      pending.get(message.userId) ??
      ({
        userId: message.userId,
        messages: [],
        timer: null,
        deadline: null,
        firstAt: now,
      } satisfies IPending);

    if (item.timer) clearTimeout(item.timer);

    item.messages.push(message);
    pending.set(message.userId, item);

    const texts = item.messages.filter((m) => m.text.trim()).length;
    const images = item.messages.reduce((sum, m) => sum + m.images.length, 0);
    const full = texts >= timing.maxTexts || images >= timing.maxImages;

    if (full) {
      flush(message.userId);
      return;
    }

    item.timer = setTimeout(() => flush(message.userId), timing.silenceMs);

    if (!item.deadline) {
      const wait = Math.max(0, item.firstAt + timing.maxWaitMs - now);
      item.deadline = setTimeout(() => flush(message.userId), wait);
    }
  };

  const flush = (userId: string): void => {
    const item = pending.get(userId);
    if (!item) return;

    clearPending(item);
    pending.delete(userId);
    startTurn(item.messages);
  };

  const push = (input: IPushMessage): void => {
    if (closed) return;

    const message: IIncomingMessage = {
      seq: nextSeq(input.userId),
      userId: input.userId,
      msgId: input.msgId,
      text: input.text,
      images: input.images,
      at: Date.now(),
    };

    if (options.onCommand && message.text.trim().startsWith("/")) {
      void options
        .onCommand(message)
        .then((handled) => {
          if (!handled) route(message);
        })
        .catch((error) => {
          slog("命令处理失败", error);
          route(message);
        });
      return;
    }

    route(message);
  };

  const wait = async (
    userId: string,
    waitOptions: IWaitOptions,
  ): Promise<IWaitResult> => {
    const turn = active.get(userId);
    if (!turn) {
      return { messages: [], quiet: false, timeout: true };
    }
    if (turn.waiting) {
      throw new Error("该用户已经有一个等待中的 wait_for_messages");
    }

    turn.waiting = true;
    const startSeq = turn.consumedSeq;
    const startedAt = Date.now();
    let lastNewAt = 0;
    let seen = 0;
    let current: IIncomingMessage[] = [];

    try {
      while (
        !closed &&
        active.get(userId) === turn &&
        Date.now() - startedAt < waitOptions.timeoutMs
      ) {
        current = turn.inbox.filter((message) => message.seq > startSeq);

        if (current.length !== seen) {
          seen = current.length;
          lastNewAt = Date.now();
        }

        if (seen > 0 && Date.now() - lastNewAt >= waitOptions.quietMs) {
          break;
        }

        await sleep(100);
      }
    } finally {
      turn.waiting = false;
    }

    if (closed || active.get(userId) !== turn) {
      return { messages: [], quiet: false, timeout: true };
    }

    current = turn.inbox.filter((message) => message.seq > startSeq);
    if (current.length === 0) {
      return { messages: [], quiet: false, timeout: true };
    }

    const quiet = Date.now() - lastNewAt >= waitOptions.quietMs;
    turn.consumedSeq = current[current.length - 1].seq;

    return {
      messages: current,
      quiet,
      timeout: !quiet,
    };
  };

  const currentMsgId = (userId: string): string | null => {
    const turn = active.get(userId);
    if (turn) return turn.replyMsgId;

    const item = pending.get(userId);
    return item?.messages[item.messages.length - 1]?.msgId ?? null;
  };

  const stop = (): void => {
    closed = true;
    for (const item of pending.values()) clearPending(item);
    pending.clear();
    active.clear();
  };

  const hub: ISessionHub = { push, wait, currentMsgId, stop };
  return hub;
};
