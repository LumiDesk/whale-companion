import { config } from "../../config.js";
import { slog } from "../../util.js";
import type { IImageInput } from "../../types/message.js";

/** 聚合后的一批消息：多句话 + 多张图，合成一轮回复 */
export interface IBatch {
  userId: string;
  msgId: string;
  texts: string[];
  images: IImageInput[];
}

interface IPending extends IBatch {
  /** 停口计时器：每来一条新消息就重置 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 兜底截止：从本轮第一条开始算，防止一直发一直不回复 */
  deadline: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}

/**
 * 消息聚合器：
 * - 用户连发多条/多图时，等"停口" silenceMs 后合成一轮
 * - 一直发也不怕：从第一条起最多等 maxWaitMs 就强制结算
 * - 攒到上限（条数或图片数）立即结算
 * - 同一用户的任务串行执行，避免两条回复交叉
 */
export const createAggregator = (onFlush: (batch: IBatch) => Promise<void>) => {
  const pending = new Map<string, IPending>();
  const queues = new Map<string, Promise<void>>();

  const enqueue = (userId: string, task: () => Promise<void>) => {
    const prev = queues.get(userId) ?? Promise.resolve();
    const next = prev.then(task).catch((e) => slog("批次处理失败", e));
    queues.set(userId, next);

    // 队列跑空后清理，别让 Map 随着用户数一直长
    void next.finally(() => {
      if (queues.get(userId) === next) queues.delete(userId);
    });
  };

  const clearTimers = (p: IPending) => {
    if (p.timer) clearTimeout(p.timer);
    if (p.deadline) clearTimeout(p.deadline);
    p.timer = null;
    p.deadline = null;
  };

  const flush = (userId: string) => {
    const p = pending.get(userId);
    if (!p) return;

    clearTimers(p);
    pending.delete(userId);

    enqueue(userId, () =>
      onFlush({
        userId: p.userId,
        msgId: p.msgId,
        texts: p.texts,
        images: p.images,
      }),
    );
  };

  const push = (msg: {
    userId: string;
    msgId: string;
    text: string;
    images: IImageInput[];
  }) => {
    const now = Date.now();

    const cur: IPending = pending.get(msg.userId) ?? {
      userId: msg.userId,
      msgId: msg.msgId,
      texts: [],
      images: [],
      timer: null,
      deadline: null,
      firstAt: now,
    };

    if (cur.timer) clearTimeout(cur.timer);

    const text = msg.text.trim();
    if (text) cur.texts.push(text);
    if (msg.images.length > 0) cur.images.push(...msg.images);
    cur.msgId = msg.msgId;

    pending.set(msg.userId, cur);

    const full =
      cur.texts.length >= config.batch.maxTexts ||
      cur.images.length >= config.batch.maxImages;

    if (full) {
      flush(msg.userId);
      return;
    }

    cur.timer = setTimeout(() => flush(msg.userId), config.batch.silenceMs);

    if (!cur.deadline) {
      const wait = Math.max(0, cur.firstAt + config.batch.maxWaitMs - now);
      cur.deadline = setTimeout(() => flush(msg.userId), wait);
    }
  };

  return { push, flush };
};
