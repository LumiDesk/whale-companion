import { rankStickers } from "./sticker-search.js";
import type { ISticker } from "../store/stickers.js";

/** 相似度低于这个值就当"没搜到"，避免发一张毫不相干的图 */
export const MIN_SCORE = 0.12;

/** 刚发过的图在这段时间内降权；不是硬冷却，只是"还有别的就不重复" */
export const AVOID_RECENT_MS = 10 * 60_000;

export interface IPickResult {
  sticker: ISticker;
  /** true = 按 id/语义命中；false = 随机兜底 */
  matched: boolean;
  score: number;
}

export interface IPickOptions {
  /** id（完整或 6 位以上前缀）或标签/备注关键词 */
  ref?: string;
  /** 没命中时要不要随机兜底 */
  allowRandom?: boolean;
  /** 覆盖默认相似度阈值；来自设置 */
  minScore?: number;
  /** 本轮已经发过、或调用方指定要避开的 id */
  excludeIds?: readonly string[];
  /** 最近用过的图降权窗口；0 表示不降权 */
  avoidRecentMs?: number;
}

const isUsable = (sticker: ISticker, now: number): boolean =>
  !sticker.unsendableUntil || sticker.unsendableUntil <= now;

const isRecent = (sticker: ISticker, now: number, windowMs: number): boolean =>
  windowMs > 0 && (sticker.lastUsedAt ?? 0) > now - windowMs;

const findById = (stickers: ISticker[], ref: string): ISticker | undefined => {
  const query = ref.trim().toLowerCase();
  if (!query) return undefined;

  const exact = stickers.find((sticker) => sticker.id.toLowerCase() === query);
  if (exact) return exact;
  if (query.length < 6) return undefined;

  return stickers.find((sticker) => sticker.id.toLowerCase().startsWith(query));
};

const pickRandom = (
  pool: ISticker[],
  now: number,
  avoidRecentMs: number,
): ISticker => {
  const fresh = pool.filter(
    (sticker) => !isRecent(sticker, now, avoidRecentMs),
  );
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
};

/**
 * 挑一张图：
 * 1. `ref` 是 id → 直接发这张（不走阈值）；
 * 2. `ref` 是标签/备注 → 按相似度排序，过阈值就用；
 * 3. 没命中又允许随机 → 随机一张（优先最近没发过的）。
 */
export const pickSticker = (
  stickers: ISticker[],
  options: IPickOptions = {},
): IPickResult | undefined => {
  if (stickers.length === 0) return undefined;

  const now = Date.now();
  const exclude = new Set(options.excludeIds ?? []);
  const candidates = stickers.filter((sticker) => isUsable(sticker, now));
  if (candidates.length === 0) return undefined;

  const ref = (options.ref ?? "").trim();
  const threshold = Math.min(1, Math.max(0, options.minScore ?? MIN_SCORE));
  const avoidRecentMs = Math.max(0, options.avoidRecentMs ?? AVOID_RECENT_MS);

  if (ref) {
    const hit = findById(candidates, ref);
    if (hit && !exclude.has(hit.id)) {
      return { sticker: hit, matched: true, score: 1 };
    }

    const ranked = rankStickers(candidates, ref)
      .filter((hit) => hit.score >= threshold)
      .filter((hit) => !exclude.has(hit.sticker.id));

    if (ranked.length > 0) {
      const fresh = ranked.filter(
        (hit) => !isRecent(hit.sticker, now, avoidRecentMs),
      );
      const chosen = fresh[0] ?? ranked[0];
      return {
        sticker: chosen.sticker,
        matched: true,
        score: chosen.score,
      };
    }
  }

  if (!options.allowRandom) return undefined;

  const pool = candidates.filter((sticker) => !exclude.has(sticker.id));
  if (pool.length === 0) return undefined;

  return {
    sticker: pickRandom(pool, now, avoidRecentMs),
    matched: false,
    score: 0,
  };
};

export interface IPickSmartOptions {
  /** 没命中时要不要随机兜底（模型主动要图时不应该开） */
  allowRandom?: boolean;
  /** 覆盖默认相似度阈值；来自设置 */
  minScore?: number;
}

/** 旧签名（关键词 + allowRandom），保留给已有调用与测试 */
export const pickStickerSmart = (
  stickers: ISticker[],
  query = "",
  options: IPickSmartOptions = {},
): { sticker: ISticker; matched: boolean } | undefined => {
  const result = pickSticker(stickers, {
    ref: query,
    allowRandom: options.allowRandom,
    minScore: options.minScore,
  });

  return result
    ? { sticker: result.sticker, matched: result.matched }
    : undefined;
};
