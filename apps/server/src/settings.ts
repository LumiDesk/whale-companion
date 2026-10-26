/**
 * 配置契约：服务端、桌面端共用的唯一一份字段定义。
 *
 * 这个文件必须保持“纯”：
 * - 不 import `node:*`、不读 `process.env`、不碰 DOM；
 * - 只放字段元数据、默认值、类型转换、校验；
 * 这样桌面端（Vite/WebView）可以安全地 import 它，而服务端直接使用。
 */

export type ThinkingEffort = "off" | "low" | "high" | "max";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type AgentStyle = "standard" | "restrained" | "chatty";

export type SettingKind =
  "text" | "password" | "number" | "boolean" | "select" | "json";

export type SettingGroup =
  | "qq"
  | "llm"
  | "conversation"
  | "batching"
  | "agent"
  | "stickers"
  | "proactive"
  | "media"
  | "logs";

export interface ISettingOption {
  value: string;
  label: string;
}

export interface ISettingSpec {
  /** 传给 Bot 子进程的环境变量名 */
  env: string;
  /** 在 config.json / ISettings 里的路径，例如 llm.model */
  path: string;
  group: SettingGroup;
  label: string;
  kind: SettingKind;
  /** 规范单位下的默认值（数字也存成字符串，便于 env 映射） */
  default: string;
  min?: number;
  max?: number;
  step?: number;
  /** 展示单位后缀，例如 “秒”“MB” */
  unit?: string;
  /** 展示值 = 规范值 × scale，例如 45000ms → 45 秒 */
  scale?: number;
  options?: readonly ISettingOption[];
  help?: string;
  advanced?: boolean;
  secret?: boolean;
  required?: boolean;
  nullable?: boolean;
}

export interface ILLMSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number | null;
  maxTokens: number;
  timeoutMs: number;
  retries: number;
  thinkingEffort: ThinkingEffort;
  extraBody: Record<string, unknown>;
  vision: boolean;
  maxImages: number;
  maxImageBytes: number;
}

export interface IQQSettings {
  appId: string;
  appSecret: string;
}

export interface IConversationSettings {
  historySend: number;
  historyStore: number;
  summarizeAt: number;
  keepAfterSummarize: number;
  replyMaxChars: number;
  ownerName: string;
}

export interface IBatchingSettings {
  silenceMs: number;
  maxWaitMs: number;
  maxTexts: number;
  maxImages: number;
}

export interface IAgentSettings {
  enabled: boolean;
  style: AgentStyle;
  maxSteps: number;
  maxMessages: number;
  replyDelayMs: number;
  gapMinMs: number;
  gapMaxMs: number;
  waitMaxMs: number;
  silenceEnabled: boolean;
  maxSilentStreak: number;
  turnTimeoutMs: number;
}

export interface IStickerSettings {
  enabled: boolean;
  spontaneousChance: number;
  cooldownMs: number;
  minScore: number;
  allowRandomOnRequest: boolean;
  autoIngest: boolean;
  tagConcurrency: number;
  maxLibrary: number;
}

export interface IProactiveSettings {
  enabled: boolean;
  intervalMs: number;
  quietStart: number;
  quietEnd: number;
  minIdleMs: number;
  maxIdleDays: number;
  maxPerDay: number;
}

export interface IMediaSettings {
  maxBytes: number;
}

export interface ILogSettings {
  level: LogLevel;
}

export interface ISettings {
  qq: IQQSettings;
  llm: ILLMSettings;
  conversation: IConversationSettings;
  batching: IBatchingSettings;
  agent: IAgentSettings;
  stickers: IStickerSettings;
  proactive: IProactiveSettings;
  media: IMediaSettings;
  logs: ILogSettings;
}

/** `/models` 返回的模型元数据（桌面端模型下拉用） */
export interface IModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  effortLevels?: string[];
  defaultEffort?: string;
}

const THINKING_OPTIONS: readonly ISettingOption[] = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "high", label: "高" },
  { value: "max", label: "最高" },
];

const LOG_OPTIONS: readonly ISettingOption[] = [
  { value: "debug", label: "调试" },
  { value: "info", label: "信息" },
  { value: "warn", label: "警告" },
  { value: "error", label: "错误" },
];

const STYLE_OPTIONS: readonly ISettingOption[] = [
  { value: "standard", label: "标准" },
  { value: "restrained", label: "克制" },
  { value: "chatty", label: "话痨" },
];

/**
 * 字段顺序就是设置页的展示顺序。
 * `default` 一律用规范单位：毫秒、字节、0–1 概率、0–1 分数。
 */
export const SETTINGS: readonly ISettingSpec[] = [
  {
    env: "QQBOT_APPID",
    path: "qq.appId",
    group: "qq",
    label: "QQ Bot AppID",
    kind: "text",
    default: "",
    required: true,
    help: "q.qq.com → 开发设置",
  },
  {
    env: "QQBOT_SECRET",
    path: "qq.appSecret",
    group: "qq",
    label: "QQ Bot AppSecret",
    kind: "password",
    default: "",
    required: true,
    secret: true,
  },
  {
    env: "DEEPSEEK_API_KEY",
    path: "llm.apiKey",
    group: "llm",
    label: "API Key",
    kind: "password",
    default: "",
    required: true,
    secret: true,
  },
  {
    env: "DEEPSEEK_BASE_URL",
    path: "llm.baseUrl",
    group: "llm",
    label: "接口地址",
    kind: "text",
    default: "https://api.deepseek.com",
    required: true,
    help: "任何 OpenAI 兼容接口都可以",
  },
  {
    env: "DEEPSEEK_MODEL",
    path: "llm.model",
    group: "llm",
    label: "模型名称",
    kind: "text",
    default: "deepseek-flash",
    required: true,
    help: "可以点右侧「获取模型」从接口读取",
  },
  {
    env: "DEEPSEEK_THINKING_EFFORT",
    path: "llm.thinkingEffort",
    group: "llm",
    label: "思考强度",
    kind: "select",
    default: "high",
    options: THINKING_OPTIONS,
    help: "官方默认开启且为高；关闭后 temperature 才生效",
  },
  {
    env: "DEEPSEEK_TEMPERATURE",
    path: "llm.temperature",
    group: "llm",
    label: "温度",
    kind: "number",
    default: "",
    min: 0,
    max: 2,
    step: 0.1,
    nullable: true,
    help: "留空跟随服务商默认；思考模式下不生效",
  },
  {
    env: "DEEPSEEK_MAX_TOKENS",
    path: "llm.maxTokens",
    group: "llm",
    label: "最大输出",
    kind: "number",
    default: "0",
    min: 0,
    max: 8192,
    step: 1,
    advanced: true,
    help: "0 表示不限制",
  },
  {
    env: "DEEPSEEK_TIMEOUT_MS",
    path: "llm.timeoutMs",
    group: "llm",
    label: "请求超时",
    kind: "number",
    default: "45000",
    min: 10_000,
    max: 120_000,
    step: 1_000,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "DEEPSEEK_RETRIES",
    path: "llm.retries",
    group: "llm",
    label: "失败重试",
    kind: "number",
    default: "1",
    min: 0,
    max: 3,
    step: 1,
    advanced: true,
  },
  {
    env: "DEEPSEEK_EXTRA_BODY",
    path: "llm.extraBody",
    group: "llm",
    label: "额外请求参数",
    kind: "json",
    default: "{}",
    advanced: true,
    help: "JSON 对象；model / messages / stream / thinking 等由程序控制",
  },
  {
    env: "VISION_ENABLED",
    path: "llm.vision",
    group: "llm",
    label: "看图",
    kind: "boolean",
    default: "true",
    help: "开启后，图片会作为多模态输入发给模型服务商",
  },
  {
    env: "LLM_MAX_IMAGES",
    path: "llm.maxImages",
    group: "llm",
    label: "每轮最多图片",
    kind: "number",
    default: "6",
    min: 0,
    max: 8,
    step: 1,
    advanced: true,
  },
  {
    env: "LLM_MAX_IMAGE_BYTES",
    path: "llm.maxImageBytes",
    group: "llm",
    label: "图片总预算",
    kind: "number",
    default: String(16 * 1024 * 1024),
    min: 1024 * 1024,
    max: 32 * 1024 * 1024,
    step: 1024 * 1024,
    unit: "MB",
    scale: 1 / (1024 * 1024),
    advanced: true,
  },

  {
    env: "HISTORY_SEND",
    path: "conversation.historySend",
    group: "conversation",
    label: "每轮发送历史",
    kind: "number",
    default: "40",
    min: 10,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    env: "HISTORY_STORE",
    path: "conversation.historyStore",
    group: "conversation",
    label: "历史落盘上限",
    kind: "number",
    default: "200",
    min: 50,
    max: 1000,
    step: 10,
    advanced: true,
  },
  {
    env: "HISTORY_SUMMARIZE_AT",
    path: "conversation.summarizeAt",
    group: "conversation",
    label: "记忆压缩阈值",
    kind: "number",
    default: "150",
    min: 50,
    max: 800,
    step: 10,
    advanced: true,
    help: "落盘历史达到这么多条时压缩成摘要",
  },
  {
    env: "HISTORY_KEEP_AFTER",
    path: "conversation.keepAfterSummarize",
    group: "conversation",
    label: "压缩后保留",
    kind: "number",
    default: "20",
    min: 5,
    max: 100,
    step: 1,
    advanced: true,
  },
  {
    env: "REPLY_MAX_CHARS",
    path: "conversation.replyMaxChars",
    group: "conversation",
    label: "单条回复上限",
    kind: "number",
    default: "500",
    min: 100,
    max: 2000,
    step: 50,
    unit: "字",
    help: "超过才切成多条，正常回复仍是一条",
  },
  {
    env: "OWNER_NAME",
    path: "conversation.ownerName",
    group: "conversation",
    label: "称呼",
    kind: "text",
    default: "主人",
    help: "人设与提示词里的「主人」会替换成这个称呼",
  },

  {
    env: "BATCH_SILENCE_MS",
    path: "batching.silenceMs",
    group: "batching",
    label: "停口等待",
    kind: "number",
    default: "3000",
    min: 500,
    max: 10_000,
    step: 500,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "BATCH_MAX_WAIT_MS",
    path: "batching.maxWaitMs",
    group: "batching",
    label: "最长等待",
    kind: "number",
    default: "10000",
    min: 2000,
    max: 60_000,
    step: 1000,
    unit: "秒",
    scale: 0.001,
    advanced: true,
    help: "从本轮第一条消息开始算",
  },
  {
    env: "BATCH_MAX_TEXTS",
    path: "batching.maxTexts",
    group: "batching",
    label: "最多文字条数",
    kind: "number",
    default: "10",
    min: 1,
    max: 30,
    step: 1,
    advanced: true,
  },
  {
    env: "BATCH_MAX_IMAGES",
    path: "batching.maxImages",
    group: "batching",
    label: "最多图片张数",
    kind: "number",
    default: "6",
    min: 0,
    max: 10,
    step: 1,
    advanced: true,
  },

  {
    env: "AGENT_ENABLED",
    path: "agent.enabled",
    group: "agent",
    label: "启用 Agent 对话",
    kind: "boolean",
    default: "true",
    help: "关闭后回退为单次生成，仅用于排查问题",
  },
  {
    env: "AGENT_STYLE",
    path: "agent.style",
    group: "agent",
    label: "行为风格",
    kind: "select",
    default: "standard",
    options: STYLE_OPTIONS,
    help: "影响一次发几条、等多久、多主动",
  },
  {
    env: "AGENT_MAX_MESSAGES",
    path: "agent.maxMessages",
    group: "agent",
    label: "每轮最多发送",
    kind: "number",
    default: "3",
    min: 1,
    max: 4,
    step: 1,
    unit: "条",
    help: "QQ 单条用户消息最多回 4 条",
  },
  {
    env: "AGENT_SILENCE_ENABLED",
    path: "agent.silenceEnabled",
    group: "agent",
    label: "允许沉默",
    kind: "boolean",
    default: "true",
    help: "模型可以选择这次不回；直接提问和连续沉默仍会被拒绝",
  },
  {
    env: "AGENT_MAX_STEPS",
    path: "agent.maxSteps",
    group: "agent",
    label: "最多模型步数",
    kind: "number",
    default: "6",
    min: 3,
    max: 10,
    step: 1,
    unit: "步",
    advanced: true,
  },
  {
    env: "AGENT_REPLY_DELAY_MS",
    path: "agent.replyDelayMs",
    group: "agent",
    label: "首条前延迟",
    kind: "number",
    default: "800",
    min: 0,
    max: 3000,
    step: 100,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "AGENT_GAP_MIN_MS",
    path: "agent.gapMinMs",
    group: "agent",
    label: "条间最小间隔",
    kind: "number",
    default: "800",
    min: 300,
    max: 3000,
    step: 100,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "AGENT_GAP_MAX_MS",
    path: "agent.gapMaxMs",
    group: "agent",
    label: "条间最大间隔",
    kind: "number",
    default: "2500",
    min: 800,
    max: 5000,
    step: 100,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "AGENT_WAIT_MAX_MS",
    path: "agent.waitMaxMs",
    group: "agent",
    label: "单次等待上限",
    kind: "number",
    default: "20000",
    min: 5000,
    max: 60000,
    step: 1000,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },
  {
    env: "AGENT_MAX_SILENT_STREAK",
    path: "agent.maxSilentStreak",
    group: "agent",
    label: "连续沉默上限",
    kind: "number",
    default: "3",
    min: 1,
    max: 5,
    step: 1,
    unit: "次",
    advanced: true,
  },
  {
    env: "AGENT_TURN_TIMEOUT_MS",
    path: "agent.turnTimeoutMs",
    group: "agent",
    label: "单轮硬超时",
    kind: "number",
    default: "120000",
    min: 30000,
    max: 180000,
    step: 5000,
    unit: "秒",
    scale: 0.001,
    advanced: true,
  },

  {
    env: "STICKER_ENABLED",
    path: "stickers.enabled",
    group: "stickers",
    label: "启用表情包",
    kind: "boolean",
    default: "true",
  },
  {
    env: "STICKER_CHANCE",
    path: "stickers.spontaneousChance",
    group: "stickers",
    label: "自发跟图概率",
    kind: "number",
    default: "0.05",
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: "%",
    scale: 100,
  },
  {
    env: "STICKER_COOLDOWN_MS",
    path: "stickers.cooldownMs",
    group: "stickers",
    label: "同一用户冷却",
    kind: "number",
    default: "480000",
    min: 60_000,
    max: 7_200_000,
    step: 60_000,
    unit: "分钟",
    scale: 1 / 60_000,
    advanced: true,
  },
  {
    env: "STICKER_MIN_SCORE",
    path: "stickers.minScore",
    group: "stickers",
    label: "挑图命中阈值",
    kind: "number",
    default: "0.12",
    min: 0.05,
    max: 0.5,
    step: 0.01,
    unit: "%",
    scale: 100,
    advanced: true,
    help: "低于这个相似度宁可不发",
  },
  {
    env: "STICKER_ALLOW_RANDOM",
    path: "stickers.allowRandomOnRequest",
    group: "stickers",
    label: "明确要图时允许随机",
    kind: "boolean",
    default: "true",
    advanced: true,
  },
  {
    env: "STICKER_AUTO_INGEST",
    path: "stickers.autoIngest",
    group: "stickers",
    label: "自动收图",
    kind: "boolean",
    default: "true",
    help: "关闭后用户发的图不再进表情包库",
  },
  {
    env: "STICKER_TAG_CONCURRENCY",
    path: "stickers.tagConcurrency",
    group: "stickers",
    label: "打标并发",
    kind: "number",
    default: "2",
    min: 1,
    max: 4,
    step: 1,
    advanced: true,
  },
  {
    env: "STICKER_MAX_LIBRARY",
    path: "stickers.maxLibrary",
    group: "stickers",
    label: "图库上限",
    kind: "number",
    default: "0",
    min: 0,
    max: 5000,
    step: 100,
    advanced: true,
    help: "0 表示不限制；超过后由后续版本决定清理策略",
  },

  {
    env: "PROACTIVE_ENABLED",
    path: "proactive.enabled",
    group: "proactive",
    label: "主动消息",
    kind: "boolean",
    default: "true",
  },
  {
    env: "PROACTIVE_INTERVAL_MS",
    path: "proactive.intervalMs",
    group: "proactive",
    label: "检查间隔",
    kind: "number",
    default: "2700000",
    min: 300_000,
    max: 14_400_000,
    step: 60_000,
    unit: "分钟",
    scale: 1 / 60_000,
    advanced: true,
  },
  {
    env: "PROACTIVE_QUIET_START",
    path: "proactive.quietStart",
    group: "proactive",
    label: "免打扰开始",
    kind: "number",
    default: "23",
    min: 0,
    max: 23,
    step: 1,
    unit: "点",
  },
  {
    env: "PROACTIVE_QUIET_END",
    path: "proactive.quietEnd",
    group: "proactive",
    label: "免打扰结束",
    kind: "number",
    default: "9",
    min: 0,
    max: 23,
    step: 1,
    unit: "点",
  },
  {
    env: "PROACTIVE_MIN_IDLE_MS",
    path: "proactive.minIdleMs",
    group: "proactive",
    label: "最短闲置",
    kind: "number",
    default: "10800000",
    min: 1_800_000,
    max: 86_400_000,
    step: 1_800_000,
    unit: "小时",
    scale: 1 / 3_600_000,
    advanced: true,
  },
  {
    env: "PROACTIVE_MAX_IDLE_DAYS",
    path: "proactive.maxIdleDays",
    group: "proactive",
    label: "最长闲置",
    kind: "number",
    default: "7",
    min: 1,
    max: 30,
    step: 1,
    unit: "天",
    advanced: true,
  },
  {
    env: "PROACTIVE_MAX_PER_DAY",
    path: "proactive.maxPerDay",
    group: "proactive",
    label: "每天最多",
    kind: "number",
    default: "1",
    min: 1,
    max: 5,
    step: 1,
    unit: "次",
    advanced: true,
  },

  {
    env: "MEDIA_MAX_BYTES",
    path: "media.maxBytes",
    group: "media",
    label: "单张图片上限",
    kind: "number",
    default: String(8 * 1024 * 1024),
    min: 1024 * 1024,
    max: 8 * 1024 * 1024,
    step: 1024 * 1024,
    unit: "MB",
    scale: 1 / (1024 * 1024),
    advanced: true,
  },

  {
    env: "LOG_LEVEL",
    path: "logs.level",
    group: "logs",
    label: "日志级别",
    kind: "select",
    default: "info",
    options: LOG_OPTIONS,
    advanced: true,
  },
];

export const DEFAULT_ENV: Record<string, string> = Object.fromEntries(
  SETTINGS.map((spec) => [spec.env, spec.default]),
);

const SPEC_BY_PATH = new Map(SETTINGS.map((spec) => [spec.path, spec]));

export const getSpecByPath = (path: string): ISettingSpec | undefined =>
  SPEC_BY_PATH.get(path);

const getPath = (source: unknown, path: string): unknown => {
  let cursor: unknown = source;

  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
};

const setPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void => {
  const parts = path.split(".");
  let cursor = target;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
};

const coerce = (spec: ISettingSpec, raw: unknown): unknown => {
  if (spec.nullable) {
    if (raw === null || raw === undefined || raw === "") return null;
  }

  if (spec.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    const text = String(raw).trim().toLowerCase();
    return text === "true" || text === "1" || text === "yes";
  }

  if (spec.kind === "number") {
    if (raw === null || raw === "") return spec.nullable ? null : Number.NaN;
    return Number(raw);
  }

  if (spec.kind === "select") {
    const text = String(raw);
    return spec.options?.some((option) => option.value === text)
      ? text
      : spec.default;
  }

  if (spec.kind === "json") {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  // text / password：非字符串视为坏数据，回退默认值，不把数字 123 变成 "123"
  if (typeof raw !== "string") return spec.default;

  const text =
    spec.path === "llm.baseUrl" ? raw.trim().replace(/\/+$/, "") : raw.trim();

  // 空字符串对“有默认值”的字段视为没填，回退默认；密钥默认空就保持空
  return text || spec.default;
};

const defaultValue = (spec: ISettingSpec): unknown =>
  coerce(spec, spec.default);

/** 从 env 读一组设置；withDefaults=false 时只返回 env 里实际出现的字段 */
export const fromEnv = (
  env: Record<string, string | undefined>,
  withDefaults = true,
): ISettings => {
  const out: Record<string, unknown> = {};

  for (const spec of SETTINGS) {
    const raw = env[spec.env];

    if (raw === undefined) {
      if (withDefaults) setPath(out, spec.path, defaultValue(spec));
      continue;
    }

    setPath(out, spec.path, coerce(spec, raw));
  }

  return out as unknown as ISettings;
};

/** 把设置写成 Bot 子进程需要的扁平 env */
export const toEnv = (settings: Partial<ISettings>): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const spec of SETTINGS) {
    const raw = getPath(settings, spec.path);
    const value = raw === undefined ? defaultValue(spec) : raw;

    if (spec.nullable && value === null) continue;

    out[spec.env] =
      spec.kind === "json" ? JSON.stringify(value) : String(value);
  }

  return out;
};

/** 把任意 JSON 收敛成完整设置；缺字段用默认值 */
export const normalizeSettings = (raw: unknown): ISettings => {
  const out = fromEnv({});

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

  for (const spec of SETTINGS) {
    const value = getPath(raw, spec.path);
    if (value === undefined) continue;
    setPath(
      out as unknown as Record<string, unknown>,
      spec.path,
      coerce(spec, value),
    );
  }

  return out;
};

export const DEFAULT_SETTINGS: ISettings = fromEnv({});

const displayOf = (spec: ISettingSpec, value: number): string => {
  const scale = spec.scale ?? 1;
  const shown = Number((value * scale).toFixed(2));
  return `${shown}${spec.unit ?? ""}`;
};

const rangeOf = (spec: ISettingSpec): string => {
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = spec.max ?? Number.POSITIVE_INFINITY;
  return `${displayOf(spec, min)}–${displayOf(spec, max)}`;
};

const RESERVED_BODY_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "thinking",
  "reasoning_effort",
  "temperature",
  "max_tokens",
  "tools",
  "tool_choice",
]);

/** 返回给人看的中文错误；空数组表示通过 */
export const validateSettings = (settings: Partial<ISettings>): string[] => {
  const issues: string[] = [];

  for (const spec of SETTINGS) {
    const value = getPath(settings, spec.path);

    if (value === undefined) {
      if (spec.required) issues.push(`${spec.label}不能为空`);
      continue;
    }

    if (spec.required && (typeof value !== "string" || !value.trim())) {
      issues.push(`${spec.label}不能为空`);
      continue;
    }

    if (spec.kind === "number") {
      if (value === null && spec.nullable) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(`${spec.label}必须是数字`);
        continue;
      }
      if (spec.min !== undefined && value < spec.min) {
        issues.push(`${spec.label}不能小于 ${rangeOf(spec).split("–")[0]}`);
      }
      if (spec.max !== undefined && value > spec.max) {
        issues.push(`${spec.label}不能大于 ${rangeOf(spec).split("–")[1]}`);
      }
    }

    if (spec.kind === "boolean" && typeof value !== "boolean") {
      issues.push(`${spec.label}必须是开关值`);
    }

    if (spec.kind === "select") {
      const allowed = spec.options?.some((option) => option.value === value);
      if (!allowed) issues.push(`${spec.label}不是合法选项`);
    }

    if (spec.kind === "json") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        issues.push(`${spec.label}必须是 JSON 对象`);
      } else {
        const text = JSON.stringify(value);
        if (text.length > 4096) {
          issues.push(`${spec.label}太大了（上限 4KB）`);
        }
        for (const key of Object.keys(value)) {
          if (RESERVED_BODY_KEYS.has(key)) {
            issues.push(`${spec.label}不能覆盖 ${key}，请用专用设置`);
          }
        }
      }
    }

    if (spec.path === "llm.baseUrl" && typeof value === "string") {
      if (!/^https?:\/\//i.test(value.trim())) {
        issues.push("接口地址必须以 http:// 或 https:// 开头");
      }
    }

    if (spec.path === "conversation.ownerName" && typeof value === "string") {
      if (value.trim().length < 1 || value.trim().length > 12) {
        issues.push("称呼需要 1–12 个字");
      }
      if (/[\u0000-\u001f\u007f]/.test(value)) {
        issues.push("称呼不能包含换行或控制字符");
      }
    }
  }

  const c = settings.conversation;
  const l = settings.llm;
  const p = settings.proactive;
  const b = settings.batching;

  if (c) {
    if (c.historyStore < c.historySend) {
      issues.push("历史落盘上限不能小于每轮发送历史");
    }
    if (c.summarizeAt > c.historyStore) {
      issues.push("记忆压缩阈值不能大于历史落盘上限");
    }
    if (c.summarizeAt <= c.keepAfterSummarize) {
      issues.push("压缩阈值必须大于压缩后保留条数");
    }
  }

  if (p && Number.isFinite(p.minIdleMs) && Number.isFinite(p.maxIdleDays)) {
    if (p.minIdleMs >= p.maxIdleDays * 86_400_000) {
      issues.push("最短闲置必须小于最长闲置");
    }
  }

  if (
    l &&
    b &&
    Number.isFinite(l.timeoutMs) &&
    Number.isFinite(l.retries) &&
    Number.isFinite(b.maxWaitMs)
  ) {
    const worst = l.timeoutMs * (l.retries + 1) + b.maxWaitMs;
    if (worst > 240_000) {
      issues.push("超时 × 重试 + 聚合等待超过了 QQ 被动回复的安全时长");
    }
  }

  const a = settings.agent;
  if (a) {
    if (
      Number.isFinite(a.maxMessages) &&
      (a.maxMessages < 1 || a.maxMessages > 4)
    ) {
      issues.push("每轮最多发送需在 1–4 条之间");
    }
    if (
      Number.isFinite(a.gapMinMs) &&
      Number.isFinite(a.gapMaxMs) &&
      a.gapMinMs > a.gapMaxMs
    ) {
      issues.push("条间最小间隔不能大于最大间隔");
    }
    if (
      Number.isFinite(a.replyDelayMs) &&
      Number.isFinite(a.waitMaxMs) &&
      Number.isFinite(a.gapMaxMs) &&
      Number.isFinite(a.maxMessages) &&
      Number.isFinite(a.turnTimeoutMs)
    ) {
      const worst = a.replyDelayMs + a.waitMaxMs + a.maxMessages * a.gapMaxMs;
      if (worst > a.turnTimeoutMs) {
        issues.push("首条延迟 + 等待 + 分条间隔可能超过单轮超时");
      }
    }
  }

  return issues;
};
