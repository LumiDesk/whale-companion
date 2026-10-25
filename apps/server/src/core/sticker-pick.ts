import { rankStickers } from "./sticker-search.js";
import type { ISticker } from "../store/stickers.js";

/** 相似度低于这个值就当"没搜到"，避免发一张毫不相干的图 */
export const MIN_SCORE = 0.12;

export interface IPickResult {
  sticker: ISticker;
  /** true = 靠语义命中；false = 随机兜底 */
  matched: boolean;
}

/**
 * 挑一张图：
 * 1. 有查询、且最高分过阈值 → 用最像的
 * 2. 否则随机（保持"随手甩一张"的随机感）
 */
export const pickStickerSmart = (
  stickers: ISticker[],
  query = "",
): IPickResult | undefined => {
  if (stickers.length === 0) return undefined;

  const q = query.trim();
  if (q) {
    const [best] = rankStickers(stickers, q);
    if (best && best.score >= MIN_SCORE) {
      return { sticker: best.sticker, matched: true };
    }
  }

  const random = stickers[Math.floor(Math.random() * stickers.length)];
  return { sticker: random, matched: false };
};
