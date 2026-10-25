export interface IParsedReply {
  text: string;
  /** 模型请求发送的表情包关键词（没有就是 undefined） */
  sticker?: string;
}

/** 兼容半角/全角方括号与中英文冒号 */
const MARKER = /(?:\[|【)表情包[:：]\s*([^\]】]{1,20})(?:\]|】)/g;

/**
 * 把模型输出里的 [表情包:关键词] 标记剥出来。
 * 顺手把旧习惯里的 "||" 换行符还原成普通换行——现在不再按它分条了。
 */
export const parseReply = (raw: string): IParsedReply => {
  let sticker: string | undefined;

  const text = raw
    .replace(MARKER, (_full, keyword: string) => {
      if (!sticker) sticker = keyword.trim();
      return "";
    })
    .replace(/\s*\|\|\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, sticker };
};

/**
 * 单条消息的安全长度。QQ 文本上限比这大得多，这里只留一个兜底：
 * 正常回复（一两句话）永远是一条发完，超长才按段落/句子切开。
 */
export const MAX_MESSAGE_CHARS = 500;

/** 切分优先级：空行 > 换行 > 句末标点 > 逗号 > 空格 */
const SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", "～", "，", " "];

/**
 * 把回复切成可发送的块。默认一整条发出去，
 * 只有超过 maxChars 才在自然停顿处切开，避免平台截断。
 */
export const splitReply = (
  text: string,
  maxChars = MAX_MESSAGE_CHARS,
): string[] => {
  const body = text.trim();
  if (!body) return [];
  if (body.length <= maxChars) return [body];

  const out: string[] = [];
  let rest = body;

  while (rest.length > maxChars) {
    let cut = -1;

    for (const sep of SEPARATORS) {
      const idx = rest.lastIndexOf(sep, maxChars);
      // 太靠前会把开头切成一小截，宁可硬切
      if (idx > maxChars * 0.4) {
        cut = idx + sep.length;
        break;
      }
    }

    if (cut <= 0) cut = maxChars;

    const head = rest.slice(0, cut).trim();
    if (head) out.push(head);
    rest = rest.slice(cut).trim();
  }

  if (rest) out.push(rest);
  return out;
};
