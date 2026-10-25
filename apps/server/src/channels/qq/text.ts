/**
 * 清掉 QQ 消息正文里的平台标记。
 * 常见的是表情 `<faceType=1,faceId="75",ext="...">` 与 @ `<@!123456>`；
 * 不清的话会被原样存进历史、再喂回模型，白烧 token 还容易带偏语气。
 */
export const cleanQQContent = (raw: string): string =>
  raw
    .replace(/<faceType=[^>]*>/gi, "")
    .replace(/<@[^>]*>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
