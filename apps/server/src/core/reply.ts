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

/**
 * 把一条回复拆成最多 max 条，模拟"人不会一口气说完"。
 * 约定：模型用 || 分隔（也兼容独立一行的 ---）。
 */
export const splitReply = (text: string, max = 3): string[] =>
  text
    .split(/\s*\|\|\s*|\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
