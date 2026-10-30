/** 聊天消息的换行处理：一条消息只保留一行。 */

export const splitMessageLines = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** 把多段文字压成一行；用于没有走 send_message 的兜底文本 */
export const flattenChatText = (text: string): string =>
  splitMessageLines(text).join("，");
