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

/** 一张图的所有可检索字段：备注、上次发送语境、每个标签 */
const fieldsOf = (sticker: ISticker): string[] =>
  [sticker.desc ?? "", sticker.lastContext ?? "", ...sticker.tags]
    .map((item) => item.trim())
    .filter(Boolean);

/** 一张图的"文本"：备注 + 标签（保留给日志/调试用） */
export const stickerText = (sticker: ISticker): string =>
  [sticker.desc ?? "", ...sticker.tags].filter(Boolean).join(" ");

/**
 * 查询与一张图的相似度。
 *
 * 两个刻意的改动（旧实现是"所有标签拼成一坨再算余弦"）：
 * - 逐字段算、取最大值：标签越多分母越大，拼起来会把正确的那张图稀释到阈值以下；
 * - 子串直接算强命中：单字查询（"困""哼"）在二元组里恒为 0 分，但它是标签的一部分。
 */
export const scoreSticker = (sticker: ISticker, query: string): number => {
  const q = query.trim();
  if (!q) return 0;

  const qn = normalize(q);
  if (!qn) return 0;

  const qv = vectorOf(q);
  let best = 0;

  for (const field of fieldsOf(sticker)) {
    const fn = normalize(field);
    if (!fn) continue;

    if (fn.includes(qn)) {
      best = Math.max(best, 0.9);
      continue;
    }

    best = Math.max(best, cosine(qv, vectorOf(field)));
  }

  return best;
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
      (a, b) => b.score - a.score || b.sticker.createdAt - a.sticker.createdAt,
    );
