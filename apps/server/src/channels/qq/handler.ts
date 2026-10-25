import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../../config.js";
import { generateReply } from "../../core/chat.js";
import { sendC2C, sendImageC2C } from "./send.js";
import type { IBatch } from "./aggregator.js";
import { slog } from "../../util.js";

/**
 * QQ 通道的批次处理：一批消息 → 一次回复。
 * 不关心怎么连的，只管"拿到一批、回一条"。
 */
export const createQQHandler = (getToken: () => Promise<string>) => {
  return async (batch: IBatch): Promise<void> => {
    const token = await getToken();
    const text = batch.texts.join("\n").trim();

    // 临时指令：发一张测试图（图库上线后移除）
    if (/^(发图|表情包|来个表情包)$/.test(text)) {
      const png = readFileSync(join(config.paths.assetsDir, "test.png"));
      await sendImageC2C(batch.userId, batch.msgId, token, png);
      return;
    }

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
