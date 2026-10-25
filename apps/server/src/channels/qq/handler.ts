import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../../config.js";
import { generateReply } from "../../core/chat.js";
import { tagImage } from "../../core/tagger.js";
import { ingestSticker, pickSticker, readSticker } from "../../store/stickers.js";
import { touchUser } from "../../store/users.js";
import { sendC2C, sendImageC2C } from "./send.js";
import type { IBatch } from "./aggregator.js";
import { slog } from "../../util.js";

const STICKER_CMD = /表情包|发图|来张图|贴图/;

/**
 * QQ 通道的批次处理：一批消息 → 一次回复。
 */
export const createQQHandler = (getToken: () => Promise<string>) => {
  return async (batch: IBatch): Promise<void> => {
    const token = await getToken();
    const text = batch.texts.join("\n").trim();

    // 记录"这个人来过"，主动消息要用
    touchUser(batch.userId, "qq");

    // 1) 收货：这一批里的图片都存进图库（顺便打标签）
    for (const img of batch.images) {
      try {
        const tags = await tagImage(img.data, img.mime);
        ingestSticker(new Uint8Array(img.data), img.mime, tags);
        slog("已收表情包", tags.join("/") || "(无标签)");
      } catch (e) {
        slog("表情包入库失败", e);
      }
    }

    // 2) 「发个表情包」指令
    if (STICKER_CMD.test(text) && text.length <= 12) {
      const sticker = pickSticker(text);
      if (sticker) {
        await sendImageC2C(
          batch.userId,
          batch.msgId,
          token,
          readSticker(sticker),
        );
        return;
      }

      // 图库还空着：发个测试图兜底，顺便告诉她怎么攒
      const seed = readFileSync(join(config.paths.assetsDir, "test.png"));
      await sendImageC2C(batch.userId, batch.msgId, token, seed);
      await sendC2C(
        batch.userId,
        batch.msgId,
        token,
        "图库还空着呢，先发几张图给我存着呀 🐋",
      ).catch(() => {});
      return;
    }

    // 3) 正常回复
    try {
      const reply = await generateReply(batch.userId, text, batch.images);
      await sendC2C(batch.userId, batch.msgId, token, reply);
    } catch (e) {
      slog("回复失败", e);
      await sendC2C(
        batch.userId,
        batch.msgId,
        token,
        "脑袋卡了一下…等下再说 🐋",
      ).catch(() => {});
    }
  };
};
