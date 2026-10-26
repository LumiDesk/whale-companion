import { config } from "../config.js";
import { getPersona } from "./persona.js";
import { dailyMood, timeOfDay, toneHint } from "./mood.js";
import { loadMemory, renderMemory } from "../store/memory.js";
import { listStickers } from "../store/stickers.js";

/**
 * 组装 system：人设 + 长期记忆 + 此刻（时间/心情）+ 表情包可用性。
 * QQ、网页、主动消息都用这一份，保证"同一个她"。
 */
export const buildSystem = (userId: string, now = new Date()): string => {
  const owner = config.persona.ownerName;
  const memory = renderMemory(loadMemory(userId), owner);

  const clock =
    `【此刻】${now.toLocaleString("zh-CN")}，${timeOfDay(now)}。${toneHint(now)}。`;

  const mood = `【今天的心情】${dailyMood(userId, now)}。这是背景，不要直接说出来。`;

  const sticker = !config.sticker.enabled
    ? "【表情包】表情包功能已关闭，不要写 [表情包:关键词]。"
    : listStickers().length > 0
      ? "【表情包】图库里有货，想发就在回复最后写 [表情包:关键词]。"
      : "【表情包】图库还空着，先别用表情包标记。";

  return [getPersona(), memory, clock, mood, sticker]
    .filter(Boolean)
    .join("\n\n");
};
