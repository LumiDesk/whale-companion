import { config } from "../config.js";
import { askModel } from "./llm.js";
import { buildSystem } from "./prompt.js";
import { summarizeIfNeeded } from "./summarize.js";
import { loadHistory, saveHistory } from "../store/history.js";
import { slog } from "../util.js";
import type { IContent, IImageInput, IMessages } from "../types/message.js";

/** 图片字节 → 模型能吃的 data URL */
const toDataUrl = (img: IImageInput): string =>
  `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}`;

/**
 * 从一轮图片里挑出发给模型的部分：
 * - 优先保留较新的图（更贴近当前话题）
 * - 最多 maxCount 张，原始字节总和不超过 maxBytes
 * - 返回顺序仍按用户发送的先后
 */
export const selectImagesForModel = (
  images: IImageInput[],
  maxCount: number,
  maxBytes: number,
): IImageInput[] => {
  const count = Math.max(0, Math.floor(maxCount));
  const budget = Math.max(0, Math.floor(maxBytes));
  if (count === 0 || budget === 0) return [];

  const picked: IImageInput[] = [];
  let used = 0;

  for (let i = images.length - 1; i >= 0; i -= 1) {
    if (picked.length >= count) break;

    const image = images[i];
    const size = image.data.byteLength;
    if (used + size > budget) continue;

    picked.push(image);
    used += size;
  }

  return picked.reverse();
};

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
 * 核心对话：人设 + 长期记忆 + 最近历史 → 调模型 → 落盘 → 返回回复。
 * 不关心消息来自 QQ 还是网页。
 */
export const generateReply = async (
  userId: string,
  text: string,
  images: IImageInput[] = [],
): Promise<string> => {
  const system = buildSystem(userId);

  const recent = loadHistory(userId).slice(-config.history.send);

  const selected = config.llm.vision
    ? selectImagesForModel(
        images,
        config.llm.maxImages,
        config.llm.maxImageBytes,
      )
    : [];

  if (selected.length < images.length) {
    slog(
      `本轮图片 ${images.length} 张，发给模型 ${selected.length} 张` +
        `（上限 ${config.llm.maxImages} 张 / ${Math.round(
          config.llm.maxImageBytes / 1024 / 1024,
        )}MB${config.llm.vision ? "" : "，看图已关闭"}）`,
    );
  }

  const messages: IMessages = [
    { role: "system", content: system },
    ...recent,
    { role: "user", content: buildUserContent(text, selected) },
  ];

  const reply = await askModel(messages);

  // 落盘只存文字；图片用标记占位，避免 base64 撑爆 history.json
  const marker = images.length > 0 ? `${text} [图片x${images.length}]` : text;
  saveHistory(userId, [
    ...loadHistory(userId),
    { role: "user", content: marker },
    { role: "assistant", content: reply },
  ]);

  // 历史太长就压缩成摘要，不阻塞本轮回复
  void summarizeIfNeeded(userId).catch((e) => slog("记忆压缩失败", e));

  return reply;
};
