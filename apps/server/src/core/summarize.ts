import { config } from "../config.js";
import { askModel } from "./llm.js";
import { loadHistory, saveHistory } from "../store/history.js";
import { loadMemory, saveMemory } from "../store/memory.js";
import { slog } from "../util.js";

const SYSTEM =
  "你在为一只叫「小鲸鱼」的聊天机器人整理长期记忆。把给定的对话压缩成不超过 200 字的中文摘要，" +
  "只保留：主人的身份与称呼、偏好与习惯、正在做的事、明确的约定。不要编造，不要客套，不要分点。";

const asText = (content: unknown): string =>
  typeof content === "string" ? content : "[图片]";

/** 同一用户同时只压一次，避免两轮并发把摘要互相覆盖 */
const inFlight = new Set<string>();

/** 落盘历史超过阈值时，把老对话压成摘要，只留最近若干条原文 */
export const summarizeIfNeeded = async (userId: string): Promise<void> => {
  if (inFlight.has(userId)) return;

  const history = loadHistory(userId);
  if (history.length < config.history.summarizeAt) return;

  const keep = config.history.keepAfterSummarize;
  const old = history.slice(0, Math.max(0, history.length - keep));
  if (old.length === 0) return;

  inFlight.add(userId);

  try {
    const mem = loadMemory(userId);
    const transcript = old
      .map(
        (m) => `${m.role === "user" ? "主人" : "小鲸鱼"}：${asText(m.content)}`,
      )
      .join("\n");

    const summary = await askModel([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `已有摘要：\n${mem.summary || "（无）"}\n\n新增对话：\n${transcript}`,
      },
    ]);

    saveMemory(userId, {
      summary: summary.trim(),
      facts: mem.facts,
      updatedAt: Date.now(),
    });
    saveHistory(userId, history.slice(-keep));

    slog(`记忆已压缩：${old.length} 条 → ${summary.length} 字摘要`);
  } finally {
    inFlight.delete(userId);
  }
};
