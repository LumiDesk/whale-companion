import type { IAppConfig } from "./types";

export const quoteArg = (value: string): string =>
  `"${value.replace(/"/g, '\\"')}"`;

/**
 * 开机自启时注册表里带 `--hidden`，应用启动后应直接收进托盘。
 * NL_ARGS 是 Neutralino 注入的原始命令行参数数组。
 */
export const hasHiddenFlag = (
  args: readonly string[] | undefined | null,
): boolean =>
  Array.isArray(args) &&
  args.some(
    (arg) => arg === "--hidden" || arg === "-hidden" || arg === "--hidden=true",
  );

export const buildSpawnCommand = (
  nodePath: string,
  scriptPath: string,
  configFile: string,
): string =>
  `${quoteArg(nodePath)} ${quoteArg(scriptPath)} --config ${quoteArg(configFile)}`;

export interface IBotConfigOptions {
  dataDir: string;
  personaFile: string;
  parentPid: number;
}

/**
 * 机器人启动配置。桌面端会写成 JSON 文件，通过 --config 传给 Node。
 * 不走子进程 envs：Neutralino 在 Windows 上的 env 替换会丢隐藏盘符变量，
 * CreateProcess 会直接失败。
 */
export const buildBotConfig = (
  config: IAppConfig,
  options: IBotConfigOptions,
): Record<string, string> => {
  const env: Record<string, string> = {
    DEEPSEEK_API_KEY: config.llm.apiKey,
    DEEPSEEK_MODEL: config.llm.model,
    DEEPSEEK_BASE_URL: config.llm.baseUrl,
    QQBOT_APPID: config.qq.appId,
    QQBOT_SECRET: config.qq.appSecret,
    WHALE_DATA_DIR: options.dataDir,
    WHALE_PERSONA_FILE: options.personaFile,
    WHALE_GUI: "1",
  };

  if (Number.isInteger(options.parentPid) && options.parentPid > 0) {
    env.WHALE_PARENT_PID = String(options.parentPid);
  }

  return env;
};
