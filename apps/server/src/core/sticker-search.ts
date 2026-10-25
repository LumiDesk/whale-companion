import type { ISticker } from "../store/stickers.js";

/** 去掉标点/空白/符号，只留字 */
const normalize = (s: string): string =>
  s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** 中文没有空格，用「字符二元组」当词 */
export const bigrams = (text: string): string[] => {
  const s = normalize(text);
  if (!s) return [];
  if (s.length <= 2) return [s];

  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
};

const vectorOf = (text: string): Map<string, number> => {
  const v = new Map<string, number>();
  for (const g of bigrams(text)) v.set(g, (v.get(g) ?? 0) + 1);
  return v;
};

export const cosine = (
  a: Map<string, number>,
  b: Map<string, number>,
): number => {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (const [k, va] of a) {
    na += va * va;
    const vb = b.get(k);
    if (vb) dot += va * vb;
  }
  for (const vb of b.values()) nb += vb * vb;

  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

/** 一张图的"文本": 标签拼接 */
export const stickerText = (sticker: ISticker): string => sticker.tags.join(" ");

export const scoreSticker = (sticker: ISticker, query: string): number => {
  if (!query.trim() || sticker.tags.length === 0) return 0;
  return cosine(vectorOf(query), vectorOf(stickerText(sticker)));
};

export interface IStickerHit {
  sticker: ISticker;
  score: number;
}

/**
 * 按语义挑图：返回按相似度排序的候选。
 * 相似度一样时，新入库的优先（更有新鲜感）。
 */
export const rankStickers = (
  stickers: ISticker[],
  query: string,
): IStickerHit[] =>
  stickers
    .map((sticker) => ({ sticker, score: scoreSticker(sticker, query) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.sticker.createdAt - a.sticker.createdAt,
    );
