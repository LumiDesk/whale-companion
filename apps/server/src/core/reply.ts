export interface IParsedReply {
  text: string;
  /** 模型请求发送的表情包关键词（没有就是 undefined） */
  sticker?: string;
}

const MARKER = /\[表情包[:：]\s*([^\]]{1,20})\]/g;

/**
 * 把模型输出里的 [表情包:关键词] 标记剥出来。
 * 正文可能因此变空，调用方要兜底。
 */
export const parseReply = (raw: string): IParsedReply => {
  let sticker: string | undefined;

  const text = raw
    .replace(MARKER, (_full, keyword: string) => {
      if (!sticker) sticker = keyword.trim();
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, sticker };
};
