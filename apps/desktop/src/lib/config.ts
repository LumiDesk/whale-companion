import type { IAppConfig, ThemeMode } from "./types";

export const DEFAULT_CONFIG: IAppConfig = {
  version: 1,
  qq: { appId: "", appSecret: "" },
  llm: {
    apiKey: "",
    model: "deepseek-flash",
    baseUrl: "https://api.deepseek.com",
  },
  behavior: { closeAction: "tray", launchAtLogin: false },
  appearance: { theme: "system" },
};

const asTheme = (value: unknown): ThemeMode => {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
};

const asText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() : fallback;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** 把磁盘上的任意 JSON 收敛成合法配置，缺字段用默认值 */
export const normalizeConfig = (raw: unknown): IAppConfig => {
  const root = asObject(raw);
  const qq = asObject(root.qq);
  const llm = asObject(root.llm);
  const behavior = asObject(root.behavior);
  const appearance = asObject(root.appearance);

  return {
    version: 1,
    qq: {
      appId: asText(qq.appId),
      appSecret: asText(qq.appSecret),
    },
    llm: {
      apiKey: asText(llm.apiKey),
      model:
        asText(llm.model, DEFAULT_CONFIG.llm.model) ||
        DEFAULT_CONFIG.llm.model,
      baseUrl: asText(llm.baseUrl, DEFAULT_CONFIG.llm.baseUrl).replace(
        /\/+$/,
        "",
      ),
    },
    behavior: {
      closeAction: behavior.closeAction === "exit" ? "exit" : "tray",
      launchAtLogin: behavior.launchAtLogin === true,
    },
    appearance: {
      theme: asTheme(appearance.theme),
    },
  };
};

export const validateConfig = (config: IAppConfig): string[] => {
  const errors: string[] = [];

  if (!config.qq.appId) errors.push("QQ Bot AppID 不能为空");
  if (!config.qq.appSecret) errors.push("QQ Bot AppSecret 不能为空");
  if (!config.llm.apiKey) errors.push("DeepSeek API Key 不能为空");
  if (!config.llm.model) errors.push("模型名称不能为空");
  if (!/^https?:\/\//.test(config.llm.baseUrl)) {
    errors.push("模型接口地址必须以 http:// 或 https:// 开头");
  }

  return errors;
};

/** 解析 .env，只认 KEY=VALUE，忽略注释与空行 */
export const parseEnvFile = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[match[1]] = value;
  }

  return out;
};

/** 从现有 .env 导入，省得用户重新填一遍 */
export const configFromEnv = (
  env: Record<string, string>,
  base: IAppConfig = DEFAULT_CONFIG,
): IAppConfig => {
  const next = normalizeConfig(base);

  if (env.QQBOT_APPID) next.qq.appId = env.QQBOT_APPID;
  if (env.QQBOT_SECRET) next.qq.appSecret = env.QQBOT_SECRET;
  if (env.DEEPSEEK_API_KEY) next.llm.apiKey = env.DEEPSEEK_API_KEY;
  if (env.DEEPSEEK_MODEL) next.llm.model = env.DEEPSEEK_MODEL;
  if (env.DEEPSEEK_BASE_URL) next.llm.baseUrl = env.DEEPSEEK_BASE_URL;

  return next;
};
