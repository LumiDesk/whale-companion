const STICKER_WORD = /表情包|贴图|发图|来张图/;
/** 这些词说明是在聊表情包，不是在要表情包 */
const CHATTING = /笑|好笑|可爱|不错|喜欢|怎么样|为什么|什么|是不是/;
const REQUEST_VERB = /^(?:那|就|快|再|帮我|给我|你)?(?:来|发|给|整|丢|拿|要)/;

const NOISE =
  /[发来给整丢拿要看个张一点份些的你我表情包贴图图片图吧呀啊嘛呗呢啦~～!！。，,？?\s]/g;

export interface IStickerRequest {
  requested: boolean;
  /** 去掉请求套话后的检索词；可能为空（那就随机给一张） */
  keyword: string;
}

/** 判断这句话是不是"给我发个表情包"，并抽出关键词 */
export const detectStickerRequest = (text: string): IStickerRequest => {
  const t = text.trim();

  if (!t || t.length > 15) return { requested: false, keyword: "" };
  if (!STICKER_WORD.test(t)) return { requested: false, keyword: "" };
  if (CHATTING.test(t)) return { requested: false, keyword: "" };
  if (!REQUEST_VERB.test(t)) return { requested: false, keyword: "" };

  return { requested: true, keyword: t.replace(NOISE, "").trim() };
};
