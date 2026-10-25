import { askModel } from "./llm.js";

const SYSTEM =
  "你是表情包标注器。看着图片，只输出 3-5 个中文词，描述画面、情绪和适用场景。" +
  "用逗号分隔，不要标点以外的任何解释，不要换行。";

/** 给一张图打标签（失败返回空数组，不阻断主流程） */
export const tagImage = async (
  data: ArrayBuffer,
  mime: string,
): Promise<string[]> => {
  try {
    const url = `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
    const text = await askModel([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "给这张表情包打标签" },
          { type: "image_url", image_url: { url } },
        ],
      },
    ]);

    return text
      .split(/[,，、;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
  } catch (e) {
    console.error("[tagger] 打标签失败", e);
    return [];
  }
};
