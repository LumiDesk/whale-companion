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
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 消息聚合器：
 * - 用户连发多条/多图时，等"停口" silenceMs 后合成一轮
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
  };

  const flush = (userId: string) => {
    const p = pending.get(userId);
    if (!p) return;

    if (p.timer) clearTimeout(p.timer);
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
    const cur: IPending = pending.get(msg.userId) ?? {
      userId: msg.userId,
      msgId: msg.msgId,
      texts: [],
      images: [],
      timer: null,
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
  };

  return { push, flush };
};
