import { fileURLToPath } from "node:url";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（检查 apps/server/.env）`);
  return v;
};

const pathOf = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const config = {
  server: { port: Number(process.env.PORT ?? 3000) },

  llm: {
    apiKey: need("DEEPSEEK_API_KEY"),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
  },

  qq: {
    appId: need("QQBOT_APPID"),
    secret: need("QQBOT_SECRET"),
  },

  paths: {
    persona: pathOf("../persona.md"),
    dataDir: pathOf("../data"),
    assetsDir: pathOf("../assets"),
  },

  /** 历史窗口：只把最近这么多条发给模型 */
  historyWindow: Number(process.env.HISTORY_WINDOW ?? 40),

  /** 消息聚合：用户停口多久后统一回复；一次最多攒多少 */
  batch: {
    silenceMs: Number(process.env.BATCH_SILENCE_MS ?? 2500),
    maxTexts: Number(process.env.BATCH_MAX_TEXTS ?? 10),
    maxImages: Number(process.env.BATCH_MAX_IMAGES ?? 6),
  },
} as const;
