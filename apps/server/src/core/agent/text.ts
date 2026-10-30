/** 聊天消息的换行处理：一条消息只保留一行。 */

export const splitMessageLines = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** 把多段文字压成一行；用于没有走 send_message 的兜底文本 */
export const flattenChatText = (text: string): string =>
  splitMessageLines(text).join("，");

/** 入站消息里的媒体/表情标记（[表情包：xxx] / [表情：xxx] / [图片x1]） */
const MEDIA_MARKER_RE = /\[(?:表情包?|图片)[^\]]*\]/g;

/** 去掉标记后只剩人说的话：沉默守卫、危机词判断都只看这一段 */
export const humanTextOf = (text: string): string =>
  text.replace(MEDIA_MARKER_RE, " ").replace(/\s+/g, " ").trim();

/** 这条消息是不是只有表情包（没有别的话、也没有图片）；小黄脸不算 */
export const isStickerOnly = (text: string): boolean =>
  /\[表情包[^\]]*\]/.test(text) && humanTextOf(text).length === 0;
