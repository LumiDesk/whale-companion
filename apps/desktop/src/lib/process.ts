import type { IAppConfig } from "./types";
import { toEnv } from "./settings";

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
  /** 用户覆盖人设：%APPDATA%\whale-companion\persona.md */
  personaFile: string;
  /** 安装目录里的默认人设；升级时替换 */
  defaultPersonaFile: string;
  parentPid: number;
}

/**
 * 机器人启动配置。桌面端会写成 JSON 文件，通过 --config 传给 Node。
 * 不走子进程 envs：Neutralino 在 Windows 上的 env 替换会丢隐藏盘符变量，
 * CreateProcess 会直接失败。
 *
 * 这里把 settings 契约里的**全部**环境变量都映射过去，
 * 不再只传 5 个键，否则设置页改了也不会生效。
 */
export const buildBotConfig = (
  config: IAppConfig,
  options: IBotConfigOptions,
): Record<string, string> => {
  const env: Record<string, string> = {
    ...toEnv(config),
    WHALE_DATA_DIR: options.dataDir,
    WHALE_PERSONA_FILE: options.personaFile,
    WHALE_DEFAULT_PERSONA_FILE: options.defaultPersonaFile,
    WHALE_GUI: "1",
  };

  if (Number.isInteger(options.parentPid) && options.parentPid > 0) {
    env.WHALE_PARENT_PID = String(options.parentPid);
  }

  return env;
};
