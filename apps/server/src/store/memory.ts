import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface IMemoryTopic {
  text: string;
  lastMentionAt: number;
  pendingQuestion?: string;
}

export interface IMemoryThought {
  text: string;
  createdAt: number;
  expiresAt: number;
  motivation?: string;
}

export interface IMemory {
  /** 老的对话压成的一段话 */
  summary: string;
  /** 关于主人的稳定事实，一行一条 */
  facts: string[];
  /** 还没聊完的话题 */
  topics: IMemoryTopic[];
  /** 想说但还没说出口的话 */
  thoughts: IMemoryThought[];
  updatedAt: number;
}

export type IMemoryInput = Partial<IMemory>;

const dir = join(config.paths.dataDir, "memory");

const fileOf = (userId: string) => join(dir, `${userId}.json`);

export const MAX_FACTS = 20;
export const MAX_TOPICS = 20;
export const MAX_THOUGHTS = 20;
export const TOPIC_TTL_MS = 24 * 60 * 60 * 1000;

const EMPTY: IMemory = {
  summary: "",
  facts: [],
  topics: [],
  thoughts: [],
  updatedAt: 0,
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asTimestamp = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const normalizeTopic = (value: unknown): IMemoryTopic | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const text = asString(raw.text);
  if (!text) return null;

  const pendingQuestion = asString(raw.pendingQuestion);
  return {
    text: text.slice(0, 200),
    lastMentionAt: asTimestamp(raw.lastMentionAt) || Date.now(),
    ...(pendingQuestion
      ? { pendingQuestion: pendingQuestion.slice(0, 200) }
      : {}),
  };
};

const normalizeThought = (value: unknown): IMemoryThought | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const text = asString(raw.text);
  if (!text) return null;

  const createdAt = asTimestamp(raw.createdAt) || Date.now();
  const expiresAt =
    asTimestamp(raw.expiresAt) || createdAt + 2 * 60 * 60 * 1000;
  const motivation = asString(raw.motivation);

  return {
    text: text.slice(0, 200),
    createdAt,
    expiresAt,
    ...(motivation ? { motivation: motivation.slice(0, 50) } : {}),
  };
};

const normalize = (mem: Partial<IMemory>): IMemory => {
  const facts = Array.isArray(mem.facts)
    ? mem.facts.map(asString).filter(Boolean).slice(-MAX_FACTS)
    : [];

  const topics = (Array.isArray(mem.topics) ? mem.topics : [])
    .map(normalizeTopic)
    .filter((topic): topic is IMemoryTopic => topic !== null)
    .slice(-MAX_TOPICS);

  const thoughts = (Array.isArray(mem.thoughts) ? mem.thoughts : [])
    .map(normalizeThought)
    .filter((thought): thought is IMemoryThought => thought !== null)
    .slice(-MAX_THOUGHTS);

  return {
    summary: asString(mem.summary).slice(0, 300),
    facts,
    topics,
    thoughts,
    updatedAt: asTimestamp(mem.updatedAt) || Date.now(),
  };
};

/** 清理过期内容；返回是否发生变化 */
export const pruneMemory = (mem: IMemory, now = Date.now()): boolean => {
  const beforeTopics = mem.topics.length;
  const beforeThoughts = mem.thoughts.length;

  mem.topics = mem.topics.filter(
    (topic) => now - topic.lastMentionAt < TOPIC_TTL_MS,
  );
  mem.thoughts = mem.thoughts.filter((thought) => thought.expiresAt > now);

  return (
    mem.topics.length !== beforeTopics || mem.thoughts.length !== beforeThoughts
  );
};

export const loadMemory = (userId: string): IMemory => {
  try {
    if (!existsSync(fileOf(userId)))
      return { ...EMPTY, topics: [], thoughts: [] };

    const parsed: unknown = JSON.parse(readFileSync(fileOf(userId), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY, topics: [], thoughts: [] };
    }

    return normalize(parsed as Partial<IMemory>);
  } catch (e) {
    console.error("[memory] 读取失败", e);
    return { ...EMPTY, topics: [], thoughts: [] };
  }
};

export const saveMemory = (userId: string, mem: IMemoryInput): void => {
  try {
    const next = normalize(mem);
    pruneMemory(next);
    writeJsonAtomic(fileOf(userId), next);
  } catch (e) {
    console.error("[memory] 写入失败", e);
  }
};

const agoText = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
};

/** 拼进 system 的记忆块；没有就返回空串 */
export const renderMemory = (
  mem: IMemory,
  ownerName = "主人",
  now = Date.now(),
): string => {
  const parts: string[] = [];
  const owner = ownerName.trim() || "主人";

  if (mem.summary.trim()) parts.push(`【你们之前的经历】${mem.summary.trim()}`);

  if (mem.facts.length > 0) {
    parts.push(`【关于${owner}】${mem.facts.map((f) => `- ${f}`).join("\n")}`);
  }

  if (mem.topics.length > 0) {
    const lines = mem.topics.slice(-10).map((topic) => {
      const pending = topic.pendingQuestion
        ? `；待追问：${topic.pendingQuestion}`
        : "";
      return `- ${topic.text}（${agoText(topic.lastMentionAt, now)}）${pending}`;
    });
    parts.push(`【进行中的话题】\n${lines.join("\n")}`);
  }

  if (mem.thoughts.length > 0) {
    const lines = mem.thoughts
      .filter((thought) => thought.expiresAt > now)
      .slice(-10)
      .map((thought) => {
        const motivation = thought.motivation
          ? `（${thought.motivation}）`
          : "";
        return `- ${thought.text}${motivation}`;
      });

    if (lines.length > 0)
      parts.push(`【你想说但还没说的】\n${lines.join("\n")}`);
  }

  return parts.join("\n");
};
