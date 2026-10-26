import { askModel } from "./llm.js";
import { config } from "../config.js";
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

/** 队列上限：图库很大时不把内存/任务堆爆 */
const MAX_QUEUE = 200;

interface IJob {
  sticker: ISticker;
  /** 延迟到 job 真正执行时再读文件，避免启动时把全部图片读进内存 */
  load: () => Uint8Array;
}

const jobs: IJob[] = [];
let active = 0;

/** 并发可配，但限制在 1–4，避免把模型接口打满 */
const concurrency = (): number =>
  Math.max(1, Math.min(4, Math.floor(config.sticker.tagConcurrency)));

const pump = (): void => {
  while (active < concurrency() && jobs.length > 0) {
    const job = jobs.shift();
    if (!job) return;

    active += 1;
    void (async () => {
      const data = job.load();
      if (data.byteLength > config.media.maxBytes) {
        slog("表情包过大，跳过打标", job.sticker.file);
        return;
      }

      const tags = await tagImage(data, job.sticker.mime);
      if (tags.length === 0) return;

      updateStickerTags(job.sticker.id, tags);
      slog("表情包已打标", `${job.sticker.id.slice(0, 8)} ${tags.join("/")}`);
    })()
      .catch((e) => slog("表情包打标签失败", e))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
};

/**
 * 把一张新入库的图丢进后台队列打标签，立刻返回。
 * load 延迟读文件；调用方可以传闭包，也可以是新收到的字节。
 */
export const queueStickerTagging = (
  sticker: ISticker,
  load: () => Uint8Array,
): void => {
  if (!config.sticker.enabled || !config.llm.vision) return;

  if (jobs.length >= MAX_QUEUE) {
    slog(`打标队列已满（${MAX_QUEUE}），跳过一张`, sticker.id.slice(0, 8));
    return;
  }

  jobs.push({ sticker, load });
  pump();
};

/** 启动时给历史遗留的"无标签图"补标（例如上次打标时进程退出了） */
export const retagUntaggedStickers = (): void => {
  if (!config.sticker.enabled || !config.llm.vision) return;

  const untagged = listUntaggedStickers();
  if (untagged.length === 0) return;

  slog(`发现 ${untagged.length} 张没有标签的表情包，后台补标`);

  for (const sticker of untagged) {
    queueStickerTagging(sticker, () => new Uint8Array(readSticker(sticker)));
  }
};

/** 桌面端「重新打标」用：逐张处理完再退出，方便命令行模式等待结果 */
export const retagAllNow = async (): Promise<{
  total: number;
  tagged: number;
  failed: number;
}> => {
  if (!config.sticker.enabled) {
    throw new Error("表情包功能已关闭");
  }
  if (!config.llm.vision) {
    throw new Error("看图已关闭，无法给表情包打标");
  }

  const untagged = listUntaggedStickers();
  let tagged = 0;
  let failed = 0;

  for (const sticker of untagged) {
    try {
      const data = new Uint8Array(readSticker(sticker));
      if (data.byteLength > config.media.maxBytes) {
        failed += 1;
        continue;
      }

      const tags = await tagImage(data, sticker.mime);
      if (tags.length === 0) {
        failed += 1;
        continue;
      }

      updateStickerTags(sticker.id, tags);
      tagged += 1;
    } catch (error) {
      failed += 1;
      slog("重新打标失败", sticker.id.slice(0, 8), error);
    }

    if ((tagged + failed) % 5 === 0) {
      slog(`重新打标进度：${tagged + failed}/${untagged.length}`);
    }
  }

  return { total: untagged.length, tagged, failed };
};
