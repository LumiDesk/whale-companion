import { rankStickers } from "./sticker-search.js";
import type { ISticker } from "../store/stickers.js";

/** 相似度低于这个值就当"没搜到"，避免发一张毫不相干的图 */
export const MIN_SCORE = 0.12;

export interface IPickResult {
  sticker: ISticker;
  /** true = 靠语义命中；false = 随机兜底 */
  matched: boolean;
}

export interface IPickOptions {
  /** 没命中时要不要随机兜底（模型主动要图时不应该开） */
  allowRandom?: boolean;
}

/**
 * 挑一张图：
 * - 有查询且过了阈值 → 最像的那张
 * - 没命中：allowRandom 才随机，否则返回 undefined（宁可不发）
 */
export const pickStickerSmart = (
  stickers: ISticker[],
  query = "",
  options: IPickOptions = {},
): IPickResult | undefined => {
  if (stickers.length === 0) return undefined;

  const q = query.trim();
  if (q) {
    const [best] = rankStickers(stickers, q);
    if (best && best.score >= MIN_SCORE) {
      return { sticker: best.sticker, matched: true };
    }
  }

  if (!options.allowRandom) return undefined;

  const random = stickers[Math.floor(Math.random() * stickers.length)];
  return { sticker: random, matched: false };
};
