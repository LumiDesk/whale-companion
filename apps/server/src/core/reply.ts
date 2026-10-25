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
 * 支持三种写法：|| 分隔、空行分隔、独立的 --- 分隔；
 * 另外超长的单段会在句号处再断一刀（否则模型不写分隔符就永远不分条）。
 */
export const splitReply = (text: string, max = 3): string[] => {
  const rough = text
    .split(/\s*\|\|\s*|\n{2,}|\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];

  for (const chunk of rough) {
    if (out.length >= max) break;

    if (chunk.length > 60) {
      const parts = chunk
        .split(/(?<=[。！？!?～~])\s*/u)
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts.length > 1) {
        out.push(parts[0]);
        const rest = parts.slice(1).join("");
        if (rest && out.length < max) out.push(rest);
        continue;
      }
    }

    out.push(chunk);
  }

  return out.slice(0, max);
};
