import { askModel } from "./llm.js";
import { getPersona } from "./persona.js";
import { loadHistory, saveHistory } from "../store/history.js";
import type {
  IContent,
  IImageInput,
  IMessages,
} from "../types/message.js";

/** 图片字节 → 模型能吃的 data URL */
const toDataUrl = (img: IImageInput): string =>
  `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}`;

/** 一轮用户输入：纯文字，或「文字 + 若干图片」 */
export const buildUserContent = (
  text: string,
  images: IImageInput[],
): IContent => {
  if (images.length === 0) return text;
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: toDataUrl(img) },
    })),
  ];
};

/**
 * 核心对话：读历史 → 拼 system → 调模型 → 落盘 → 返回回复。
 * 不关心消息来自 QQ 还是网页。
 */
export const generateReply = async (
  userId: string,
  text: string,
  images: IImageInput[] = [],
): Promise<string> => {
  const history = loadHistory(userId);

  const messages: IMessages = [
    { role: "system", content: getPersona() },
    ...history,
    { role: "user", content: buildUserContent(text, images) },
  ];

  const reply = await askModel(messages);

  // 落盘只存文字；图片用标记占位，避免 base64 撑爆 history.json
  const marker = images.length > 0 ? `${text} [图片x${images.length}]` : text;
  history.push({ role: "user", content: marker });
  history.push({ role: "assistant", content: reply });
  saveHistory(userId, history);

  return reply;
};
