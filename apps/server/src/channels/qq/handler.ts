import { config } from "../../config.js";
import { generateReplyLegacy } from "../../core/chat.js";
import { askModelWithTools } from "../../core/llm.js";
import { parseReply, splitReply } from "../../core/reply.js";
import { parseCommand, runCommand } from "../../core/commands.js";
import { detectStickerRequest } from "../../core/sticker-request.js";
import { pickStickerSmart } from "../../core/sticker-pick.js";
import { queueStickerTagging } from "../../core/tagger.js";
import { summarizeIfNeeded } from "../../core/summarize.js";
import { runAgentTurn } from "../../core/agent/loop.js";
import type {
  IAgentDeps,
  IAgentToolContextBase,
  IIncomingMessage,
  IRememberInput,
  IRememberOutput,
  IWakeInput,
  IWakeOutput,
} from "../../core/agent/types.js";
import { loadHistory, saveHistory } from "../../store/history.js";
import { loadMemory, saveMemory } from "../../store/memory.js";
import {
  ingestSticker,
  listStickers,
  readSticker,
} from "../../store/stickers.js";
import {
  listUsers,
  recordReply,
  recordSilence,
  setNextWake,
  touchUser,
} from "../../store/users.js";
import { reportStatus } from "../../status.js";
import { slog } from "../../util.js";
import type { IMessage } from "../../types/message.js";
import type { IBatch } from "./aggregator.js";
import { ReplySession } from "./reply-session.js";
import type { ISessionHub } from "./session-hub.js";
import {
  sendC2C,
  sendC2CProactive,
  sendImageC2C,
  sendImageProactive,
} from "./send.js";

const EXPLICIT_MIN_MS = 10_000;

const lastStickerAt = new Map<string, number>();
const lastExplicitAt = new Map<string, number>();
const sessions = new Map<string, ReplySession>();

const stickerCooling = (userId: string): boolean =>
  Date.now() - (lastStickerAt.get(userId) ?? 0) < config.sticker.cooldownMs;

const markSticker = (userId: string): void => {
  lastStickerAt.set(userId, Date.now());
};

const sessionFor = (userId: string, msgId?: string): ReplySession => {
  let session = sessions.get(userId);
  if (!session) {
    session = new ReplySession();
    sessions.set(userId, session);
  }
  if (msgId) session.switchTo(msgId);
  return session;
};

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  return "";
};

const rememberMemory = (
  userId: string,
  input: IRememberInput,
): IRememberOutput => {
  const mem = loadMemory(userId);
  const now = Date.now();

  if (input.kind === "fact") {
    if (!mem.facts.includes(input.text)) {
      mem.facts = [...mem.facts, input.text].slice(-20);
    }
    saveMemory(userId, { ...mem, updatedAt: now });
    return { kind: "fact", total: mem.facts.length };
  }

  if (input.kind === "topic") {
    const existing = mem.topics.find((topic) => topic.text === input.text);
    if (existing) {
      existing.lastMentionAt = now;
      if (input.pendingQuestion !== undefined) {
        existing.pendingQuestion = input.pendingQuestion || undefined;
      }
    } else {
      mem.topics = [
        ...mem.topics,
        {
          text: input.text,
          lastMentionAt: now,
          ...(input.pendingQuestion
            ? { pendingQuestion: input.pendingQuestion }
            : {}),
        },
      ].slice(-20);
    }
    saveMemory(userId, { ...mem, updatedAt: now });
    return { kind: "topic", total: mem.topics.length };
  }

  const expiresAt =
    now + Math.max(5, Math.min(1440, input.expiresInMinutes ?? 120)) * 60_000;
  const existing = mem.thoughts.find((thought) => thought.text === input.text);
  if (existing) {
    existing.createdAt = now;
    existing.expiresAt = expiresAt;
  } else {
    mem.thoughts = [
      ...mem.thoughts,
      {
        text: input.text,
        createdAt: now,
        expiresAt,
        ...(input.kind === "thought" && input.pendingQuestion
          ? { motivation: input.pendingQuestion.slice(0, 50) }
          : {}),
      },
    ].slice(-20);
  }
  saveMemory(userId, { ...mem, updatedAt: now });
  return { kind: "thought", total: mem.thoughts.length, expiresAt };
};

const userSilentStreak = (userId: string): number =>
  listUsers().find((user) => user.userId === userId)?.silentStreak ?? 0;

const buildToolContext = (
  userId: string,
  token: string,
  latestUserText: string,
  hub: ISessionHub | null,
): IAgentToolContextBase => {
  const sendText = async (text: string) => {
    const msgId = hub?.currentMsgId(userId) ?? null;
    const session = sessionFor(userId, msgId ?? undefined);

    if (msgId) {
      const seq = session.nextSeq(msgId);
      await sendC2C(userId, msgId, token, text, seq);
      return { sent: 1, failed: 0, remaining: session.remainingOf(msgId) };
    }

    await sendC2CProactive(userId, token, text);
    return {
      sent: 1,
      failed: 0,
      remaining: config.agent.maxMessages,
    };
  };

  const sendImage = async (bytes: Uint8Array) => {
    const msgId = hub?.currentMsgId(userId) ?? null;
    const session = sessionFor(userId, msgId ?? undefined);

    if (msgId) {
      const seq = session.nextSeq(msgId);
      await sendImageC2C(userId, msgId, token, bytes, seq);
      return { sent: 1, failed: 0, remaining: session.remainingOf(msgId) };
    }

    await sendImageProactive(userId, token, bytes);
    return {
      sent: 1,
      failed: 0,
      remaining: config.agent.maxMessages,
    };
  };

  return {
    userId,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sendText,
    sendImage,
    remaining: () => {
      const msgId = hub?.currentMsgId(userId) ?? null;
      return msgId
        ? sessionFor(userId, msgId).remainingOf(msgId)
        : config.agent.maxMessages;
    },
    wait: hub
      ? (options) => hub.wait(userId, options)
      : async () => ({ messages: [], quiet: false, timeout: true }),
    pickSticker: (keyword) => {
      if (!config.sticker.enabled || stickerCooling(userId)) return undefined;

      const query = keyword.trim();
      const pick = pickStickerSmart(listStickers(), query, {
        allowRandom: query ? false : config.sticker.allowRandomOnRequest,
        minScore: config.sticker.minScore,
      });

      if (!pick) return undefined;
      markSticker(userId);
      return pick.sticker;
    },
    readSticker,
    remember: (input) => rememberMemory(userId, input),
    setNextWake: (input: IWakeInput): IWakeOutput => {
      const wakeAt = Date.now() + input.afterMinutes * 60_000;
      setNextWake(userId, wakeAt, input.intent, input.allowSilent);
      return { wakeAt };
    },
    recordReply: () => recordReply(userId),
    recordSilence: (reason) => recordSilence(userId, reason),
    latestUserText,
    silentStreak: userSilentStreak(userId),
    config: config.agent,
    style: config.agent.style,
  };
};

const transcriptToHistory = (
  transcript: Array<
    | { role: "user"; content: string; images: number }
    | { role: "assistant"; content: string }
  >,
): IMessage[] => {
  const out: IMessage[] = [];

  for (const entry of transcript) {
    if (entry.role === "assistant") {
      if (entry.content.trim()) {
        out.push({ role: "assistant", content: entry.content.trim() });
      }
      continue;
    }

    const marker = entry.images > 0 ? ` [图片x${entry.images}]` : "";
    const content = `${entry.content}${marker}`.trim();
    if (content) out.push({ role: "user", content });
  }

  return out;
};

const persistTranscript = (
  userId: string,
  transcript: Array<
    | { role: "user"; content: string; images: number }
    | { role: "assistant"; content: string }
  >,
  silent: boolean,
): void => {
  const messages = transcriptToHistory(transcript);
  if (messages.length > 0) {
    saveHistory(userId, [...loadHistory(userId), ...messages]);
    void summarizeIfNeeded(userId).catch((error) =>
      slog("记忆压缩失败", error),
    );
  }

  if (silent) slog(`[agent] 选择沉默 user=${userId.slice(0, 8)}`);
};

const sendLegacyReply = async (
  userId: string,
  msgId: string,
  token: string,
  text: string,
  images: IBatch["images"],
): Promise<void> => {
  const raw = await generateReplyLegacy(userId, text, images);
  const { text: clean, sticker: requested } = parseReply(raw);
  const chunks = splitReply(clean, config.reply.maxChars);
  const session = sessionFor(userId, msgId);

  const wantSticker = config.sticker.enabled
    ? (requested ??
      (Math.random() < config.sticker.spontaneousChance ? clean : undefined))
    : undefined;

  const pick =
    wantSticker && !stickerCooling(userId)
      ? pickStickerSmart(listStickers(), wantSticker, {
          allowRandom: false,
          minScore: config.sticker.minScore,
        })
      : undefined;

  for (const chunk of (chunks.length > 0
    ? chunks
    : ["……哼，没什么好说的。"]
  ).slice(0, pick ? 3 : 4)) {
    const seq = session.nextSeq(msgId);
    await sendC2C(userId, msgId, token, chunk, seq);
  }

  if (pick) {
    const seq = session.nextSeq(msgId);
    await sendImageC2C(userId, msgId, token, readSticker(pick.sticker), seq);
    markSticker(userId);
  }

  recordReply(userId);
};

const handleCommand = async (
  message: IIncomingMessage,
  getToken: () => Promise<string>,
): Promise<boolean> => {
  const cmd = parseCommand(message.text);
  if (!cmd) return false;

  const token = await getToken();
  const session = sessionFor(message.userId, message.msgId);

  try {
    const out = await runCommand(cmd.name, cmd.args, message.userId);
    const seq = session.nextSeq(message.msgId);
    await sendC2C(message.userId, message.msgId, token, out, seq);
    recordReply(message.userId);
  } catch (error) {
    slog("命令执行失败", error);
    const seq = session.nextSeq(message.msgId);
    await sendC2C(
      message.userId,
      message.msgId,
      token,
      "这条命令没跑通…等下再试试 🐋",
      seq,
    ).catch(() => {});
  }

  return true;
};

export interface IQQHandler {
  onTurn: (
    batch: IBatch,
    messages: IIncomingMessage[],
    hub: ISessionHub,
  ) => Promise<void>;
  onCommand: (message: IIncomingMessage) => Promise<boolean>;
  runProactive: (
    userId: string,
    intent: string,
    afterMinutes: number,
    allowSilent: boolean,
  ) => Promise<boolean>;
}

export const createQQHandler = (
  getToken: () => Promise<string>,
): IQQHandler => {
  const onTurn = async (
    batch: IBatch,
    messages: IIncomingMessage[],
    hub: ISessionHub,
  ): Promise<void> => {
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      slog("获取 QQ token 失败，本轮跳过", error);
      return;
    }

    const text = batch.texts.join("\n").trim();
    const startedAt = Date.now();

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

    const cmd = parseCommand(text);
    if (cmd) {
      try {
        const out = await runCommand(cmd.name, cmd.args, batch.userId);
        const session = sessionFor(batch.userId, batch.msgId);
        const seq = session.nextSeq(batch.msgId);
        await sendC2C(batch.userId, batch.msgId, token, out, seq);
        recordReply(batch.userId);
      } catch (error) {
        slog("命令执行失败", error);
      }
      return;
    }

    if (config.sticker.enabled && config.sticker.autoIngest) {
      for (const image of batch.images) {
        try {
          const bytes = new Uint8Array(image.data);
          const sticker = ingestSticker(bytes, image.mime, []);
          queueStickerTagging(sticker, () => bytes);
        } catch (error) {
          slog("表情包入库失败", error);
        }
      }
    }

    const request = config.sticker.enabled
      ? detectStickerRequest(text)
      : { requested: false, keyword: "" };

    if (request.requested) {
      const last = lastExplicitAt.get(batch.userId) ?? 0;
      const session = sessionFor(batch.userId, batch.msgId);

      if (Date.now() - last < EXPLICIT_MIN_MS) {
        const seq = session.nextSeq(batch.msgId);
        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "刚给你找过一张啦，缓一缓再要嘛 🐋",
          seq,
        ).catch(() => {});
        return;
      }

      const pick = pickStickerSmart(listStickers(), request.keyword, {
        allowRandom: config.sticker.allowRandomOnRequest,
        minScore: config.sticker.minScore,
      });

      try {
        if (pick) {
          const seq = session.nextSeq(batch.msgId);
          await sendImageC2C(
            batch.userId,
            batch.msgId,
            token,
            readSticker(pick.sticker),
            seq,
          );
          lastExplicitAt.set(batch.userId, Date.now());
          markSticker(batch.userId);
          recordReply(batch.userId);
          return;
        }

        const seq = session.nextSeq(batch.msgId);
        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "图库还空着呢，先发几张图给我存着呀 🐋",
          seq,
        );
        recordReply(batch.userId);
      } catch (error) {
        slog("发图失败", error);
      }
      return;
    }

    if (!config.agent.enabled) {
      try {
        await sendLegacyReply(
          batch.userId,
          batch.msgId,
          token,
          text,
          batch.images,
        );
        slog(`已回复（legacy，${Date.now() - startedAt}ms）`);
      } catch (error) {
        slog("回复失败", error);
        await sendC2C(
          batch.userId,
          batch.msgId,
          token,
          "脑袋卡了一下…等下再说 🐋",
          sessionFor(batch.userId, batch.msgId).nextSeq(batch.msgId),
        ).catch(() => {});
      }
      return;
    }

    const latestUserText =
      batch.texts.join("\n").trim() ||
      (batch.images.length > 0 ? "[图片]" : "");

    const toolContext = buildToolContext(
      batch.userId,
      token,
      latestUserText,
      hub,
    );

    const deps: IAgentDeps = {
      history: loadHistory(batch.userId).slice(-config.history.send),
      config: config.agent,
      style: config.agent.style,
      now: () => Date.now(),
      askModel: askModelWithTools,
      persistTurn: async (input) =>
        persistTranscript(batch.userId, input.transcript, input.silent),
      toolContext,
    };

    try {
      await runAgentTurn(batch.userId, messages, "reactive", deps);
      slog(`已回复（agent，${Date.now() - startedAt}ms）`);
    } catch (error) {
      slog("Agent 回复失败，发兜底", error);
      await sendC2C(
        batch.userId,
        batch.msgId,
        token,
        "脑袋卡了一下…等下再说 🐋",
        sessionFor(batch.userId, batch.msgId).nextSeq(batch.msgId),
      ).catch(() => {});
    }
  };

  const onCommand = (message: IIncomingMessage): Promise<boolean> =>
    handleCommand(message, getToken);

  const runProactive = async (
    userId: string,
    intent: string,
    afterMinutes: number,
    allowSilent: boolean,
  ): Promise<boolean> => {
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      slog("主动消息获取 token 失败", error);
      return false;
    }

    const history = loadHistory(userId);
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const latestUserText = lastUser ? contentText(lastUser.content) : "";

    const toolContext = buildToolContext(userId, token, latestUserText, null);
    const deps: IAgentDeps = {
      history: history.slice(-config.history.send),
      config: config.agent,
      style: config.agent.style,
      now: () => Date.now(),
      askModel: askModelWithTools,
      persistTurn: async (input) =>
        persistTranscript(userId, input.transcript, input.silent),
      toolContext,
      proactiveIntent: intent,
      proactiveAfterMinutes: afterMinutes,
      proactiveAllowSilent: allowSilent,
    };

    try {
      const result = await runAgentTurn(userId, [], "proactive", deps);
      slog("主动消息回合结束");
      return result.sent > 0;
    } catch (error) {
      slog("主动消息回合失败", error);
      return false;
    }
  };

  return { onTurn, onCommand, runProactive };
};
