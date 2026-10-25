import { askModel } from "./llm.js";
import {
  listUntaggedStickers,
  readSticker,
  updateStickerTags,
  type ISticker,
} from "../store/stickers.js";
import { slog } from "../util.js";

const SYSTEM =
  "你是表情包标注器。看着图片，只输出 3-5 个中文词，描述画面、情绪和适用场景。" +
  "词要具体、方便检索，比如「委屈巴巴」「无语翻白眼」「开心转圈」，不要「可爱」「开心」这种太泛的词。" +
  "用逗号分隔，不要标点以外的任何解释，不要换行。";

/** 给一张图打标签（失败返回空数组，不阻断主流程） */
export const tagImage = async (
  data: Uint8Array,
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
    slog("表情包打标签失败", e);
    return [];
  }
};

/* ---------------- 后台打标队列：不挡回复 ---------------- */

const MAX_CONCURRENT = 2;
const jobs: Array<() => Promise<void>> = [];
let active = 0;

const pump = (): void => {
  while (active < MAX_CONCURRENT && jobs.length > 0) {
    const job = jobs.shift();
    if (!job) return;

    active += 1;
    void job()
      .catch((e) => slog("表情包打标签失败", e))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
};

/** 把一张新入库的图丢进后台队列打标签，立刻返回 */
export const queueStickerTagging = (
  sticker: ISticker,
  data: Uint8Array,
): void => {
  jobs.push(async () => {
    const tags = await tagImage(data, sticker.mime);
    if (tags.length === 0) return;

    updateStickerTags(sticker.id, tags);
    slog("表情包已打标", `${sticker.id.slice(0, 8)} ${tags.join("/")}`);
  });

  pump();
};

/** 启动时给历史遗留的"无标签图"补标（例如上次打标时进程退出了） */
export const retagUntaggedStickers = (): void => {
  const untagged = listUntaggedStickers();
  if (untagged.length === 0) return;

  slog(`发现 ${untagged.length} 张没有标签的表情包，后台补标`);

  for (const sticker of untagged) {
    try {
      queueStickerTagging(sticker, new Uint8Array(readSticker(sticker)));
    } catch (e) {
      slog("补标失败：读不到图片", sticker.file, e);
    }
  }
};
