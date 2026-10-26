import { config } from "../config.js";
import { askModel } from "./llm.js";
import {
  historyEpoch,
  loadHistory,
  saveHistory,
} from "../store/history.js";
import { loadMemory, saveMemory } from "../store/memory.js";
import { slog } from "../util.js";

const systemFor = (owner: string): string =>
  `你在为一只叫「小鲸鱼」的聊天机器人整理长期记忆。把给定的对话压缩成不超过 200 字的中文摘要，` +
  `只保留：${owner}的身份与称呼、偏好与习惯、正在做的事、明确的约定。` +
  "不要编造，不要客套，不要分点。";

/** 一次摘要最多喂给模型多少字符，避免历史很长时把上下文撑爆 */
const MAX_TRANSCRIPT_CHARS = 24_000;

/** 摘要落盘上限；prompt 里写 200 字，这里留一点余量防止模型啰嗦 */
const MAX_SUMMARY_CHARS = 300;

const asText = (content: unknown): string =>
  typeof content === "string" ? content : "[图片]";

/** 同一用户同时只压一次，避免两轮并发把摘要互相覆盖 */
const inFlight = new Set<string>();

type Ask = typeof askModel;

/**
 * 落盘历史超过阈值时，把老对话压成摘要，只留最近若干条原文。
 *
 * 摘要要 await 模型，期间用户可能又发消息、执行 /new 或 /forget。
 * 写回前用 historyEpoch 检查；版本变了就丢弃这次摘要，
 * 否则会用旧快照覆盖掉新消息，甚至让 /forget 被“复活”。
 */
export const summarizeIfNeeded = async (
  userId: string,
  ask: Ask = askModel,
): Promise<void> => {
  if (inFlight.has(userId)) return;

  const epoch = historyEpoch(userId);
  const history = loadHistory(userId);
  if (history.length < config.history.summarizeAt) return;

  const keep = config.history.keepAfterSummarize;
  const old = history.slice(0, Math.max(0, history.length - keep));
  if (old.length === 0) return;

  inFlight.add(userId);

  try {
    const owner = config.persona.ownerName;
    const mem = loadMemory(userId);
    let transcript = old
      .map(
        (m) => `${m.role === "user" ? owner : "小鲸鱼"}：${asText(m.content)}`,
      )
      .join("\n");

    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      slog(
        `摘要输入过长（${transcript.length} 字），只取最近 ${MAX_TRANSCRIPT_CHARS} 字`,
      );
      transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
    }

    const summary = await ask([
      { role: "system", content: systemFor(owner) },
      {
        role: "user",
        content: `已有摘要：\n${mem.summary || "（无）"}\n\n新增对话：\n${transcript}`,
      },
    ]);

    if (historyEpoch(userId) !== epoch) {
      slog("摘要期间历史已变化，放弃本次写回");
      return;
    }

    const text = summary.trim().slice(0, MAX_SUMMARY_CHARS);

    saveMemory(userId, {
      summary: text,
      facts: mem.facts,
      updatedAt: Date.now(),
    });
    saveHistory(userId, history.slice(-keep));

    slog(`记忆已压缩：${old.length} 条 → ${text.length} 字摘要`);
  } finally {
    inFlight.delete(userId);
  }
};
