import {
  DEFAULT_SETTINGS,
  fromEnv,
  normalizeSettings,
  toEnv,
  validateSettings,
} from "./settings";
import type { IAppConfig, ThemeMode } from "./types";

const DEFAULT_BEHAVIOR: IAppConfig["behavior"] = {
  closeAction: "tray",
  launchAtLogin: false,
  autoStartBot: true,
  autoRestartOnCrash: false,
  checkUpdateOnStartup: true,
  startMinimized: false,
};

const DEFAULT_LOGS: IAppConfig["logs"] = {
  ...DEFAULT_SETTINGS.logs,
  keepDays: 7,
  maxLines: 2000,
};

export const DEFAULT_CONFIG: IAppConfig = {
  ...DEFAULT_SETTINGS,
  version: 2,
  behavior: { ...DEFAULT_BEHAVIOR },
  appearance: { theme: "system" },
  logs: { ...DEFAULT_LOGS },
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
};

const asIntInRange = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;

  const rounded = Math.floor(number);
  return Math.min(max, Math.max(min, rounded));
};

const asTheme = (value: unknown): ThemeMode => {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
};

const asCloseAction = (value: unknown): IAppConfig["behavior"]["closeAction"] =>
  value === "exit" ? "exit" : "tray";

const normalizeBehavior = (raw: unknown): IAppConfig["behavior"] => {
  const value = asObject(raw);

  return {
    closeAction: asCloseAction(value.closeAction),
    launchAtLogin: asBool(value.launchAtLogin, false),
    autoStartBot: asBool(value.autoStartBot, true),
    autoRestartOnCrash: asBool(value.autoRestartOnCrash, false),
    checkUpdateOnStartup: asBool(value.checkUpdateOnStartup, true),
    startMinimized: asBool(value.startMinimized, false),
  };
};

const normalizeLogs = (
  raw: unknown,
  level: IAppConfig["logs"]["level"],
): IAppConfig["logs"] => {
  const value = asObject(raw);

  return {
    level,
    keepDays: asIntInRange(value.keepDays, 7, 1, 30),
    maxLines: asIntInRange(value.maxLines, 2000, 200, 10_000),
  };
};

/**
 * 把磁盘上的任意 JSON 收敛成 v2 配置。
 * v1（0.1.x）只有 qq / llm / behavior / appearance，其余字段用默认值补。
 */
export const normalizeConfig = (raw: unknown): IAppConfig => {
  const root = asObject(raw);
  const version = Number(root.version);
  const isV2 = version === 2;

  // v1 的 llm 只有 apiKey/model/baseUrl；normalizeSettings 会把新字段补默认
  const botRaw = isV2
    ? root
    : {
        qq: root.qq,
        llm: root.llm,
      };

  const settings = normalizeSettings(botRaw);

  return {
    ...settings,
    version: 2,
    behavior: normalizeBehavior(root.behavior),
    appearance: { theme: asTheme(asObject(root.appearance).theme) },
    logs: normalizeLogs(isV2 ? root.logs : undefined, settings.logs.level),
  };
};

export const validateConfig = (config: IAppConfig): string[] => {
  const errors = validateSettings(config);

  if (
    !Number.isInteger(config.logs.keepDays) ||
    config.logs.keepDays < 1 ||
    config.logs.keepDays > 30
  ) {
    errors.push("日志保留天数需在 1–30 之间");
  }

  if (
    !Number.isInteger(config.logs.maxLines) ||
    config.logs.maxLines < 200 ||
    config.logs.maxLines > 10_000
  ) {
    errors.push("日志最大行数需在 200–10000 之间");
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

/**
 * 从现有 .env 导入，省得用户重新填一遍。
 * 先转成完整 env，再用文件里的值覆盖，保证没写到的字段保留当前配置。
 */
export const configFromEnv = (
  env: Record<string, string>,
  base: IAppConfig = DEFAULT_CONFIG,
): IAppConfig => {
  const current = normalizeConfig(base);
  const mergedEnv = { ...toEnv(current), ...env };
  const settings = fromEnv(mergedEnv);

  return normalizeConfig({
    ...current,
    ...settings,
    logs: { ...current.logs, ...settings.logs },
  });
};
