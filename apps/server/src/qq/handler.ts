import { AIReply } from "../llm.js";
import { getPersona } from "../persona.js";
import { sendC2C } from "./send.js";
import { loadHistory, saveHistory } from "./history.js";
import {
  type IContent,
  type IImageInput,
  type IMessages,
} from "../types/message.js";

/** 把图片字节转成模型能吃的 data URL */
const toDataUrl = (img: IImageInput) =>
  `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}`;

/** 有图 → 文字 + 图片数组；没图 → 就是字符串 */
const buildUserContent = (text: string, images: IImageInput[]): IContent => {
  if (images.length === 0) return text;
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: toDataUrl(img) },
    })),
  ];
};

export const handler = async (
  userId: string,
  msgId: string,
  token: string,
  content: string,
  images: IImageInput[],
) => {
  const historys = loadHistory(userId);
  if (historys.length === 0)
    historys.push({ role: "system", content: getPersona() });

  const text = content.trim() || (images.length > 0 ? "（发来一张图片）" : "");

  // 发给模型：历史 + 本轮的多模态用户消息（图片只在这一轮带上）
  const apiMessages: IMessages = [
    ...historys,
    { role: "user", content: buildUserContent(text, images) },
  ];

  const apply = await AIReply(apiMessages);

  await sendC2C(userId, msgId, token, apply);

  // 存历史：只存文字 + [图片] 标记，绝不把 base64 写进 JSON
  historys.push({
    role: "user",
    content: images.length > 0 ? `${text} [图片]` : text,
  });
  historys.push({ role: "assistant", content: apply });
  saveHistory(userId, historys);
};
