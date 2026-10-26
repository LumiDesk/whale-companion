import type { ISettings } from "./settings";

export type {
  AgentStyle,
  IAgentSettings,
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
  "stopped" | "starting" | "running" | "stopping" | "crashed";

export type QQState =
  "unknown" | "connecting" | "online" | "closed" | "error" | "stopped";

export interface IAppConfig extends ISettings {
  version: 2;
  behavior: {
    closeAction: CloseAction;
    launchAtLogin: boolean;
    autoStartBot: boolean;
    autoRestartOnCrash: boolean;
    checkUpdateOnStartup: boolean;
    startMinimized: boolean;
    /** 检查更新时是否包含 GitHub pre-release；默认只收正式版 */
    includePrerelease: boolean;
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

export interface IStickerInfo {
  id: string;
  file: string;
  mime: string;
  tags: string[];
  createdAt: number;
}

export interface IKnownUser {
  userId: string;
  channel?: string;
  lastSeen: number;
  lastProactiveAt?: number;
  lastReplyAt?: number;
  lastSilentAt?: number;
  lastSilentReason?: string;
  silentStreak?: number;
  nextWakeAt?: number;
  wakeIntent?: string;
  wakeAllowSilent?: boolean;
}

export type PersonaSource = "builtin" | "user";

export interface IPersonaSummary {
  id: string;
  name: string;
  description: string;
  source: PersonaSource;
  path: string;
  chars: number;
}

export interface IPersonaCard extends IPersonaSummary {
  text: string;
}

export interface IAppPaths {
  root: string;
  configFile: string;
  dataDir: string;
  logsDir: string;
  lockFile: string;
  botConfigFile: string;
  personaDir: string;
  activePersonaFile: string;
}

export interface IServerPaths {
  serverDir: string;
  dataDir: string;
  builtinPersonaDir: string;
  promptsDir: string;
}

/** 托盘菜单项（Neutralino setTray 的入参） */
export interface ITrayItem {
  id?: string;
  text: string;
  isDisabled?: boolean;
  isChecked?: boolean;
}
