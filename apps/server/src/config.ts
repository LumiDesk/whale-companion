import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromEnv, validateSettings } from "./settings.js";

/**
 * 桌面端会把配置写到临时 JSON，并用 --config=<path> 传进来。
 * 这里先合并进 process.env，后面的 环境变量 / 路径逻辑就都能复用。
 */
const configArg =
  process.argv
    .find((arg) => arg.startsWith("--config="))
    ?.slice("--config=".length) ??
  (process.argv.includes("--config")
    ? process.argv[process.argv.indexOf("--config") + 1]
    : undefined);

if (configArg) {
  try {
    const raw = JSON.parse(readFileSync(configArg, "utf8")) as Record<
      string,
      unknown
    >;

    for (const [key, value] of Object.entries(raw)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        process.env[key] = String(value);
      }
    }
  } catch (error) {
    throw new Error(
      `读取桌面端配置失败：${configArg}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

const pathOf = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const settings = fromEnv(process.env);
const issues = validateSettings(settings);

if (issues.length > 0) {
  throw new Error(
    `配置不合法（检查 apps/server/.env 或桌面端设置）：\n- ${issues.join("\n- ")}`,
  );
}

const dataDir = process.env.WHALE_DATA_DIR ?? pathOf("../data");
const userPersonaDir =
  process.env.WHALE_USER_PERSONA_DIR ?? join(dataDir, "personas");

export const config = {
  llm: { ...settings.llm },
  qq: { ...settings.qq },

  paths: {
    /** 内置人格卡目录（随安装包更新） */
    personaDir: process.env.WHALE_PERSONA_DIR ?? pathOf("../personas"),
    /** 用户人格卡目录 */
    userPersonaDir,
    /** 当前人格 ID */
    activePersonaFile:
      process.env.WHALE_ACTIVE_PERSONA_FILE ??
      join(userPersonaDir, "active.json"),
    /** 行为提示词目录 */
    promptsDir: process.env.WHALE_PROMPTS_DIR ?? pathOf("../prompts"),
    dataDir,
  },

  /** 历史与记忆 */
  history: {
    /** 落盘最多留多少条 */
    store: settings.conversation.historyStore,
    /** 每轮最多发给模型多少条 */
    send: settings.conversation.historySend,
    /** 落盘条数超过它就压缩成摘要 */
    summarizeAt: settings.conversation.summarizeAt,
    /** 压缩后保留多少条原文 */
    keepAfterSummarize: settings.conversation.keepAfterSummarize,
  },

  /** 她是谁、怎么称呼主人 */
  persona: {
    ownerName: settings.conversation.ownerName,
  },

  /** 主动消息：她先开口 */
  proactive: { ...settings.proactive },

  /** 表情包行为 */
  sticker: { ...settings.stickers },

  /** 消息聚合：用户停口多久后统一回复；一次最多攒多少 */
  batch: { ...settings.batching },

  /** Agent 回合：步数、条数、等待、沉默与节奏 */
  agent: { ...settings.agent },

  reply: {
    /** 正常回复一条发完；超过这个长度才在自然停顿处切开 */
    maxChars: settings.conversation.replyMaxChars,
  },

  media: { ...settings.media },

  /** 联网搜索：DeepSeek 官方 Search / Fetch */
  web: { ...settings.web },

  log: { ...settings.logs },
} as const;
