export type PageId = "status" | "settings" | "logs" | "about";

export type CloseAction = "tray" | "exit";

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

export interface IAppConfig {
  version: 1;
  qq: {
    appId: string;
    appSecret: string;
  };
  llm: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  behavior: {
    closeAction: CloseAction;
    launchAtLogin: boolean;
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
