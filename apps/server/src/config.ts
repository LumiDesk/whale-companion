import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `缺少环境变量 ${name}（检查 apps/server/.env 或桌面端设置）`,
    );
  }
  return v;
};

const num = (name: string, fallback: number): number => {
  const v = process.env[name];
  if (!v) return fallback;

  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`环境变量 ${name} 不是数字：${v}`);
  }
  return n;
};

const pathOf = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const config = {
  llm: {
    apiKey: need("DEEPSEEK_API_KEY"),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
    /** 单次请求超时；卡住的请求会占住该用户的回复队列 */
    timeoutMs: num("DEEPSEEK_TIMEOUT_MS", 45_000),
    /** 网络错误 / 5xx / 429 时重试几次 */
    retries: num("DEEPSEEK_RETRIES", 1),
    /** true = 把用户发来的图作为多模态输入；false = 只在本机保存 */
    vision: process.env.VISION_ENABLED !== "false",
    /** 一轮最多把几张图发给模型（0 = 不发） */
    maxImages: num("LLM_MAX_IMAGES", 6),
    /** 一轮图片原始字节总预算，超过就跳过较旧的图 */
    maxImageBytes: num("LLM_MAX_IMAGE_BYTES", 16 * 1024 * 1024),
  },

  qq: {
    appId: need("QQBOT_APPID"),
    secret: need("QQBOT_SECRET"),
  },

  paths: {
    /** GUI 打包后由桌面端注入；CLI 模式用仓库内的默认位置 */
    persona: process.env.WHALE_PERSONA_FILE ?? pathOf("../persona.md"),
    dataDir: process.env.WHALE_DATA_DIR ?? pathOf("../data"),
  },

  /** 历史与记忆 */
  history: {
    /** 落盘最多留多少条 */
    store: num("HISTORY_STORE", 200),
    /** 每轮最多发给模型多少条 */
    send: num("HISTORY_SEND", 40),
    /** 落盘条数超过它就压缩成摘要 */
    summarizeAt: num("HISTORY_SUMMARIZE_AT", 150),
    /** 压缩后保留多少条原文 */
    keepAfterSummarize: num("HISTORY_KEEP_AFTER", 20),
  },

  /** 主动消息：她先开口 */
  proactive: {
    enabled: process.env.PROACTIVE_ENABLED !== "false",
    intervalMs: num("PROACTIVE_INTERVAL_MS", 45 * 60 * 1000),
    /** 免打扰时段（整点，含起点不含终点，可跨零点） */
    quietStart: num("PROACTIVE_QUIET_START", 23),
    quietEnd: num("PROACTIVE_QUIET_END", 9),
    /** 至少多久没说话才打扰 */
    minIdleMs: num("PROACTIVE_MIN_IDLE_MS", 3 * 60 * 60 * 1000),
    /** 超过这么多天没说话就不再打扰 */
    maxIdleDays: num("PROACTIVE_MAX_IDLE_DAYS", 7),
  },

  /** 表情包行为 */
  sticker: {
    /** 模型没要、正文也没提，也有这么大概率跟一张（0~1） */
    spontaneousChance: num("STICKER_CHANCE", 0.05),
    /** 同一个人两次发表情包的最短间隔 */
    cooldownMs: num("STICKER_COOLDOWN_MS", 8 * 60 * 1000),
  },

  /** 消息聚合：用户停口多久后统一回复；一次最多攒多少 */
  batch: {
    /** 每条新消息都会把"停口"计时器往后推 */
    silenceMs: num("BATCH_SILENCE_MS", 3000),
    /** 从本轮第一条开始算，最多等这么久（防止一直发一直不回复） */
    maxWaitMs: num("BATCH_MAX_WAIT_MS", 10_000),
    maxTexts: num("BATCH_MAX_TEXTS", 10),
    maxImages: num("BATCH_MAX_IMAGES", 6),
  },

  reply: {
    /** 正常回复一条发完；超过这个长度才在自然停顿处切开 */
    maxChars: num("REPLY_MAX_CHARS", 500),
  },

  media: {
    /** 单张图片下载上限，超了就跳过（避免 base64 撑爆请求） */
    maxBytes: num("MEDIA_MAX_BYTES", 8 * 1024 * 1024),
  },
} as const;
