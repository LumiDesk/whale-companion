import type { ISettings } from "./settings";

export type {
  IConversationSettings,
  ILLMSettings,
  IModelInfo,
  IProactiveSettings,
  ISettings,
  IStickerSettings,
  LogLevel,
  SettingGroup,
  SettingKind,
  ThinkingEffort,
} from "./settings";

export type PageId = "status" | "settings" | "logs" | "about";

export type CloseAction = "tray" | "exit";

/** system = 跟随 Windows 的深浅色设置 */
export type ThemeMode = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

export type BotState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed";

export type QQState =
  | "unknown"
  | "connecting"
  | "online"
  | "closed"
  | "error"
  | "stopped";

export interface IAppConfig extends ISettings {
  version: 2;
  behavior: {
    closeAction: CloseAction;
    launchAtLogin: boolean;
    autoStartBot: boolean;
    autoRestartOnCrash: boolean;
    checkUpdateOnStartup: boolean;
    startMinimized: boolean;
  };
  appearance: {
    theme: ThemeMode;
  };
  logs: ISettings["logs"] & {
    /** 桌面端日志文件保留天数 */
    keepDays: number;
    /** 桌面端界面最多保留多少行 */
    maxLines: number;
  };
}

export interface IStatusEvent {
  v: number;
  ts?: number;
  type: string;
  state?: string;
  code?: number;
  pid?: number;
  botId?: string | null;
  texts?: number;
  images?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface ILogLine {
  id: number;
  ts: number;
  source: "bot" | "gui" | "error";
  text: string;
}

export interface ICheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface IAppPaths {
  root: string;
  configFile: string;
  dataDir: string;
  logsDir: string;
  lockFile: string;
  botConfigFile: string;
}

export interface IServerPaths {
  serverDir: string;
  personaFile: string;
  dataDir: string;
}

export type { ITrayItem } from "./types-ui";
