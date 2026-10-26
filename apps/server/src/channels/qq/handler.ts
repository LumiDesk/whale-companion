import { config } from "../../config.js";
import { generateReply } from "../../core/chat.js";
import { parseCommand, runCommand } from "../../core/commands.js";
import { parseReply, splitReply } from "../../core/reply.js";
import { detectStickerRequest } from "../../core/sticker-request.js";
import { pickStickerSmart } from "../../core/sticker-pick.js";
import { queueStickerTagging } from "../../core/tagger.js";
import { ingestSticker, listStickers, readSticker } from "../../store/stickers.js";
import { touchUser } from "../../store/users.js";
import { sendC2C, sendImageC2C } from "./send.js";
import type { IBatch } from "./aggregator.js";
import { reportStatus } from "../../status.js";
import { slog } from "../../util.js";

/** 发过表情包的时间（进程内即可，不需要持久化） */
const lastStickerAt = new Map<string, number>();
const lastExplicitAt = new Map<string, number>();

const stickerCooling = (userId: string): boolean =>
  Date.now() - (lastStickerAt.get(userId) ?? 0) < config.sticker.cooldownMs;

/** 明确要图可以绕过 8 分钟冷却，但也不该被连点刷屏 */
const EXPLICIT_MIN_MS = 10_000;

const markSticker = (userId: string) => {
  lastStickerAt.set(userId, Date.now());
};

/** QQ 通道的批次处理：一批消息 → 一次（通常一条）回复 */
export const createQQHandler = (getToken: () => Promise<string>) => {
  return async (batch: IBatch): Promise<void> => {
    let token: string;
    try {
      token = await getToken();
    } catch (e) {
      slog("获取 QQ token 失败，本轮跳过", e);
      return;
    }

    const text = batch.texts.join("\n").trim();

    touchUser(batch.userId, "qq");
    reportStatus({
      type: "activity",
      texts: batch.texts.length,
      images: batch.images.length,
    });

    if (batch.texts.length + batch.images.length > 1) {
      slog(
        `合并回复：${batch.texts.length} 条文字 / ${batch.images.length} 张图`,
      );
    }

    // 0) 斜杠命令
    const cmd = parseCommand(text);
    if (cmd) {
      try {
        const out = await runCommand(cmd.name, cmd.args, batch.userId);
        await sendC2C(batch.userId, batch.msgId, token, out, 1);
      } catch (e) {
        slog("命令执行失败", e);
        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "这条命令没跑通…等下再试试 🐋",
          1,
        ).catch(() => {});
      }
      return;
    }

    // 1) 收货：先入库，打标签丢后台，不挡这一轮回复
    if (config.sticker.enabled && config.sticker.autoIngest) {
      for (const img of batch.images) {
        try {
          const bytes = new Uint8Array(img.data);
          const sticker = ingestSticker(bytes, img.mime, []);
          queueStickerTagging(sticker, () => bytes);
        } catch (e) {
          slog("表情包入库失败", e);
        }
      }
    }

    // 2) 「发个表情包」：用户明确要 → 语义命中优先，没命中才按配置随机
    const request = config.sticker.enabled
      ? detectStickerRequest(text)
      : { requested: false, keyword: "" };
    if (request.requested) {
      const last = lastExplicitAt.get(batch.userId) ?? 0;
      if (Date.now() - last < EXPLICIT_MIN_MS) {
        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "刚给你找过一张啦，缓一缓再要嘛 🐋",
          1,
        ).catch(() => {});
        return;
      }

      const pick = pickStickerSmart(listStickers(), request.keyword, {
        allowRandom: config.sticker.allowRandomOnRequest,
        minScore: config.sticker.minScore,
      });

      try {
        if (pick) {
          await sendImageC2C(
            batch.userId,
            batch.msgId,
            token,
            readSticker(pick.sticker),
            1,
          );
          lastExplicitAt.set(batch.userId, Date.now());
          markSticker(batch.userId);
          return;
        }

        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "图库还空着呢，先发几张图给我存着呀 🐋",
          1,
        );
      } catch (e) {
        slog("发图失败", e);
      }
      return;
    }

    // 3) 正常回复：整条发；只有超长才切，想发就再跟一张表情包
    let seq = 0;

    try {
      const raw = await generateReply(batch.userId, text, batch.images);
      const { text: clean, sticker: requested } = parseReply(raw);
      const chunks = splitReply(clean, config.reply.maxChars);

      const wantSticker = config.sticker.enabled
        ? (requested ??
          (Math.random() < config.sticker.spontaneousChance
            ? clean
            : undefined))
        : undefined;

      // 模型主动要图 / 自发跟图：只发语义命中的，冷期内一律不发
      const pick =
        wantSticker && !stickerCooling(batch.userId)
          ? pickStickerSmart(listStickers(), wantSticker, {
              allowRandom: false,
              minScore: config.sticker.minScore,
            })
          : undefined;

      if (chunks.length === 0 && !pick) {
        chunks.push("……哼，没什么好说的。");
      }

      for (const chunk of chunks) {
        seq += 1;
        await sendC2C(batch.userId, batch.msgId, token, chunk, seq);
      }

      if (pick) {
        seq += 1;
        await sendImageC2C(
          batch.userId,
          batch.msgId,
          token,
          readSticker(pick.sticker),
          seq,
        );
        markSticker(batch.userId);
      }
    } catch (e) {
      slog("回复失败", e);
      await sendC2C(
        batch.userId,
        batch.msgId,
        token,
        "脑袋卡了一下…等下再说 🐋",
        seq + 1,
      ).catch(() => {});
    }
  };
};
