import { useEffect, useRef, useState } from "react";
import { events, os } from "@neutralinojs/lib";

import {
  DEFAULT_CONFIG,
  configFromEnv,
  normalizeConfig,
  parseEnvFile,
  validateConfig,
} from "../lib/config";
import {
  pickOldLogs,
  splitServerTimestamp,
} from "../lib/logs";
import {
  buildAppPaths,
  buildServerPaths,
  joinPath,
  normalizePath,
} from "../lib/paths";
import {
  acquireLock,
  ensureDir,
  fileExists,
  fileSize,
  findNode,
  getAppDataPath,
  getAppRoot,
  getOwnExePath,
  getOwnPid,
  hideWindow,
  isNeutralino,
  isPackaged,
  killProcessTree,
  movePath,
  openPath,
  quit,
  readDir,
  readText,
  releaseLock,
  removePath,
  setAutostart,
  setTray,
  showWindow,
  spawnBotProcess,
  touchLock,
  writeText,
} from "../lib/platform";
import {
  buildBotConfig,
  buildSpawnCommand,
  hasHiddenFlag,
} from "../lib/process";
import { LineBuffer, parseStatusLine } from "../lib/status";
import { decideAutoRestart, isBotActive } from "../lib/restart";
import {
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from "../lib/theme";
import {
  CHECKSUM_ASSET_NAME,
  RELEASES_PAGE,
  buildApplyCommand,
  buildDownloadCommand,
  buildExtractCommand,
  buildFreeSpaceCommand,
  buildHashCommand,
  buildPowerShellDownloadCommand,
  buildUpdateScript,
  formatBytes,
  isNewerVersion,
  parseChecksumFile,
  parseHashOutput,
  parseRelease,
  parseUpdateResult,
  pickBestRelease,
  progressPercent,
  releasesApiUrl,
  validateDownloadUrl,
} from "../lib/update";
import type { IUpdateState } from "../lib/update";
import type {
  BotState,
  IAppConfig,
  IAppPaths,
  ICheckResult,
  ILogLine,
  IModelInfo,
  IServerPaths,
  IStickerInfo,
  IKnownUser,
  ITrayItem,
  PageId,
  QQState,
  ResolvedTheme,
  ThemeMode,
} from "../lib/types";
import { APP_VERSION } from "../lib/version";
import { useDataActions } from "./useDataActions";
import { useLogs } from "./useLogs";

interface IMessage {
  kind: "ok" | "error" | "info";
  text: string;
}

interface ISpawnDetail {
  id: number;
  action: string;
  data?: unknown;
}

export interface IController {
  ready: boolean;
  bootMessage: string;
  page: PageId;
  setPage: (page: PageId) => void;
  config: IAppConfig;
  configLoaded: boolean;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => Promise<void>;
  /** 是否接收预发布版本（只影响检查更新） */
  setIncludePrerelease: (value: boolean) => Promise<void>;
  botState: BotState;
  qqState: QQState;
  botPid: number | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  exitCode: number | null;
  logs: ILogLine[];
  paths: IAppPaths | null;
  serverPaths: IServerPaths | null;
  nodePath: string;
  packaged: boolean;
  message: IMessage | null;
  dismissMessage: () => void;
  update: IUpdateState;
  checkUpdate: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  openReleasePage: () => Promise<void>;
  saveConfig: (next: IAppConfig) => Promise<boolean>;
  importEnv: () => Promise<IAppConfig | null>;
  startBot: () => Promise<boolean>;
  stopBot: () => Promise<boolean>;
  restartBot: () => Promise<void>;
  quitApp: () => Promise<void>;
  openLogsDir: () => Promise<void>;
  openDataDir: () => Promise<void>;
  exportData: () => Promise<string | null>;
  importData: () => Promise<boolean>;
  listStickers: () => Promise<IStickerInfo[]>;
  deleteSticker: (id: string) => Promise<void>;
  retagStickers: () => Promise<void>;
  listUsers: () => Promise<IKnownUser[]>;
  clearUserData: (
    userId: string,
    target: "history" | "memory" | "both",
  ) => Promise<void>;
  clearLogs: () => void;
  fetchModels: (config: IAppConfig) => Promise<IModelInfo[]>;
  runSelfCheck: (config: IAppConfig) => Promise<ICheckResult[]>;
  readPersona: () => Promise<{
    text: string;
    source: "custom" | "default";
    path: string;
  }>;
  savePersona: (text: string) => Promise<void>;
  resetPersona: () => Promise<void>;
  openPersonaDir: () => Promise<void>;
}

const errText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** QQ 连续离线这么久就自动重启 Bot（进程还活着但连不上，用户通常不会自己去点） */
const QQ_DOWN_RESTART_MS = 5 * 60_000;
/** 两次自动重启至少隔这么久，避免网络长期不通时反复重启 */
const QQ_DOWN_RESTART_COOLDOWN_MS = 30 * 60_000;

const waitFor = (check: () => boolean, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });

/** 解压后的便携包根目录：兼容 zip 里带一层 WhaleCompanion 目录的布局 */
const findPayloadDir = async (root: string): Promise<string | null> => {
  const candidates = [root, joinPath(root, "WhaleCompanion")];

  for (const dir of candidates) {
    if (await fileExists(joinPath(dir, "WhaleCompanion.exe"))) return dir;
  }

  return null;
};

/**
 * 下载 GitHub 资源：优先 curl；没有 curl、或 curl 因代理/TLS 失败时，
 * 退回 PowerShell（会走系统代理）。
 */
const runDownload = async (url: string, destination: string): Promise<void> => {
  let result: Awaited<ReturnType<typeof os.execCommand>> | null = null;

  try {
    result = await os.execCommand(buildDownloadCommand(url, destination));
  } catch {
    // curl 不存在或被策略拦截时 execCommand 可能直接 reject，走下面的兜底
    result = null;
  }

  if (!result || result.exitCode !== 0) {
    const fallback = await os.execCommand(
      buildPowerShellDownloadCommand(url, destination),
    );

    if (fallback.exitCode === 0) return;
    result = fallback;
  }

  if (result.exitCode !== 0) {
    const detail = (
      result.stdErr ||
      result.stdOut ||
      `退出码 ${result.exitCode}`
    ).trim();
    throw new Error(`下载失败：${detail.slice(0, 300)}`);
  }
};

const writeConfigFile = async (
  file: string,
  config: IAppConfig,
): Promise<void> => {
  const tmp = `${file}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  await writeText(tmp, JSON.stringify(config, null, 2));

  try {
    // 大多数 Windows 环境下 move 会直接覆盖，尽量缩短旧配置缺失的窗口
    await movePath(tmp, file);
  } catch {
    await removePath(file);
    await movePath(tmp, file);
  }
};

const themeLabel = (theme: ThemeMode): string => {
  if (theme === "light") return "浅色";
  if (theme === "dark") return "深色";
  return "跟随系统";
};

const stateLabel = (state: BotState): string => {
  switch (state) {
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "stopping":
      return "停止中";
    case "crashed":
      return "异常退出";
    default:
      return "已停止";
  }
};

export const useController = (): IController => {
  const [ready, setReady] = useState(false);
  const [bootMessage, setBootMessage] = useState("正在叫醒小鲸鱼…");
  const [page, setPage] = useState<PageId>("status");
  const [config, setConfig] = useState<IAppConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system", systemPrefersDark()),
  );
  const [botState, setBotState] = useState<BotState>("stopped");
  const [qqState, setQqState] = useState<QQState>("unknown");
  const [botPid, setBotPid] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [paths, setPaths] = useState<IAppPaths | null>(null);
  const [serverPaths, setServerPaths] = useState<IServerPaths | null>(null);
  const [nodePath, setNodePath] = useState("");
  const [packaged, setPackaged] = useState(false);
  const [message, setMessage] = useState<IMessage | null>(null);
  const [update, setUpdate] = useState<IUpdateState>({ status: "idle" });

  const configRef = useRef(DEFAULT_CONFIG);
  const pathsRef = useRef<IAppPaths | null>(null);
  const serverRef = useRef<IServerPaths | null>(null);
  const nodeRef = useRef("");
  const packagedRef = useRef(false);
  const childRef = useRef<number | null>(null);
  const childPidRef = useRef<number | null>(null);
  const botStateRef = useRef<BotState>("stopped");
  const qqStateRef = useRef<QQState>("unknown");
  const outBufferRef = useRef(new LineBuffer());
  const errBufferRef = useRef(new LineBuffer());
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSeenRef = useRef(false);
  const orphanEventsRef = useRef(new Map<number, ISpawnDetail[]>());
  const updateRef = useRef<IUpdateState>({ status: "idle" });
  const updateBusyRef = useRef(false);
  const configWriteRef = useRef<Promise<void>>(Promise.resolve());
  const autoRestartRef = useRef({ count: 0, lastAt: 0 });
  const autoRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** QQ 从什么时候开始连不上（online 时清空） */
  const qqDownSinceRef = useRef<number | null>(null);
  /** 上一次因为 QQ 离线自动重启的时间 */
  const qqAutoRestartAtRef = useRef(0);
  const trayOkRef = useRef(true);

  const { logs, addLog, clearLogs } = useLogs({
    pathsRef,
    maxLines: () => configRef.current.logs.maxLines,
  });

  const updateBotState = (next: BotState) => {
    botStateRef.current = next;
    setBotState(next);
  };

  const updateQqState = (next: QQState) => {
    qqStateRef.current = next;
    setQqState(next);
  };

  const updateStatus = (next: IUpdateState) => {
    updateRef.current = next;
    setUpdate(next);
  };

  /** 主题和设置页可能同时写 config.json，串起来避免后写被先写覆盖 */
  const persistConfig = (
    file: string,
    config: IAppConfig,
  ): Promise<void> => {
    const next = configWriteRef.current.then(() =>
      writeConfigFile(file, config),
    );
    configWriteRef.current = next.catch(() => {});
    return next;
  };

  const clearStartTimer = () => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  };

  const updateTray = async () => {
    const running =
      botStateRef.current === "running" || botStateRef.current === "starting";

    const items: ITrayItem[] = [
      { text: `状态：${stateLabel(botStateRef.current)}`, isDisabled: true },
      { text: "-" },
      { id: "SHOW", text: "显示主界面" },
      { id: running ? "STOP" : "START", text: running ? "暂停 Bot" : "启动 Bot" },
      { id: "RESTART", text: "重启 Bot", isDisabled: !running },
      { text: "-" },
      { id: "LOGS", text: "打开日志目录" },
      { id: "DATA", text: "打开数据目录" },
      { text: "-" },
      { id: "QUIT", text: "退出" },
    ];

    try {
      await setTray(items);
      trayOkRef.current = true;
    } catch (error) {
      trayOkRef.current = false;
      addLog("error", `托盘更新失败：${errText(error)}`);
    }
  };

  const handleStatus = (event: ReturnType<typeof parseStatusLine>) => {
    if (!event) return;

    if (event.type === "boot") {
      bootSeenRef.current = true;
      clearStartTimer();
      if (typeof event.pid === "number") setBotPid(event.pid);

      // Bot 已经读完 --config，删掉这份含密钥的派生文件
      const currentPaths = pathsRef.current;
      if (currentPaths) {
        void removePath(currentPaths.botConfigFile).catch(() => {});
      }
      return;
    }

    if (event.type === "ready") {
      bootSeenRef.current = true;
      clearStartTimer();
      return;
    }

    if (event.type === "qq") {
      const next = String(event.state ?? "");
      if (
        next === "connecting" ||
        next === "online" ||
        next === "closed" ||
        next === "error" ||
        next === "stopped"
      ) {
        updateQqState(next);

        if (next === "online") {
          qqDownSinceRef.current = null;
        } else if (qqDownSinceRef.current === null) {
          qqDownSinceRef.current = Date.now();
        }
      }
      return;
    }

    if (event.type === "activity") {
      setLastActivityAt(Date.now());
    }
  };

  const handleBotLine = (raw: string) => {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) return;

    const status = parseStatusLine(line);
    if (status) {
      handleStatus(status);
      return;
    }

    const parsed = splitServerTimestamp(line);
    if (parsed) addLog("bot", parsed.text, parsed.ts);
    else addLog("bot", line);
  };

  const handleExit = (data: unknown) => {
    const code = Number(data);
    const wasStopping = botStateRef.current === "stopping";

    childRef.current = null;
    childPidRef.current = null;
    bootSeenRef.current = false;
    clearStartTimer();
    outBufferRef.current = new LineBuffer();
    errBufferRef.current = new LineBuffer();

    setBotPid(null);
    setStartedAt(null);
    updateQqState("unknown");
    qqDownSinceRef.current = null;
    setExitCode(Number.isFinite(code) ? code : null);
    updateBotState(wasStopping || code === 0 ? "stopped" : "crashed");
    addLog(
      "gui",
      `Bot 进程已退出（code=${Number.isFinite(code) ? code : "?"}）`,
    );
    void updateTray();

    const decision = decideAutoRestart(autoRestartRef.current, {
      wasStopping,
      code,
      enabled: configRef.current.behavior.autoRestartOnCrash,
    });

    if (decision.kind === "give-up") {
      addLog("error", "Bot 连续异常退出 3 次，停止自动重启");
      return;
    }

    if (decision.kind === "restart") {
      autoRestartRef.current = {
        count: decision.count,
        lastAt: decision.lastAt,
      };

      addLog(
        "gui",
        `将在 ${Math.round(decision.wait / 1000)} 秒后自动重启 Bot（第 ${decision.count}/3 次）`,
      );

      if (autoRestartTimerRef.current) clearTimeout(autoRestartTimerRef.current);
      autoRestartTimerRef.current = setTimeout(() => {
        autoRestartTimerRef.current = null;
        if (botStateRef.current === "crashed") void startBot();
      }, decision.wait);
    }
  };

  const processSpawnEvent = (detail: ISpawnDetail) => {
    if (detail.action === "stdOut") {
      for (const line of outBufferRef.current.push(String(detail.data ?? ""))) {
        handleBotLine(line);
      }
      return;
    }

    if (detail.action === "stdErr") {
      for (const line of errBufferRef.current.push(String(detail.data ?? ""))) {
        if (line.trim()) addLog("error", line);
      }
      return;
    }

    if (detail.action === "exit") {
      for (const line of outBufferRef.current.flush()) handleBotLine(line);
      for (const line of errBufferRef.current.flush()) {
        if (line.trim()) addLog("error", line);
      }
      handleExit(detail.data);
    }
  };

  const onSpawned = (event: Event) => {
    const detail = (event as CustomEvent).detail as ISpawnDetail | undefined;
    if (!detail || typeof detail.id !== "number") return;

    if (childRef.current === null || detail.id !== childRef.current) {
      const buffered = orphanEventsRef.current.get(detail.id) ?? [];
      if (buffered.length < 200) buffered.push(detail);
      orphanEventsRef.current.set(detail.id, buffered);
      return;
    }

    processSpawnEvent(detail);
  };

  const startBot = async (): Promise<boolean> => {
    if (childRef.current !== null) return true;

    const errors = validateConfig(configRef.current);
    if (errors.length > 0) {
      setMessage({ kind: "error", text: errors.join("；") });
      setPage("settings");
      addLog("error", `配置不完整：${errors.join("；")}`);
      return false;
    }

    const currentServer = serverRef.current;
    if (!currentServer) {
      addLog("error", "还没有找到 Bot 程序目录");
      return false;
    }

    if (!nodeRef.current) {
      addLog("error", "没有找到 Node.js，无法启动 Bot");
      return false;
    }

    const entry = joinPath(currentServer.serverDir, "index.js");
    if (!(await fileExists(entry))) {
      addLog(
        "error",
        `找不到 Bot 程序：${entry}。开发模式请先执行 pnpm build。`,
      );
      return false;
    }

    updateBotState("starting");
    updateQqState("unknown");
    setExitCode(null);
    setLastActivityAt(null);
    bootSeenRef.current = false;
    outBufferRef.current = new LineBuffer();
    errBufferRef.current = new LineBuffer();
    orphanEventsRef.current.clear();

    const currentPaths = pathsRef.current;
    if (!currentPaths) {
      addLog("error", "还没有准备好配置目录，无法启动 Bot");
      return false;
    }

    const botConfig = buildBotConfig(configRef.current, {
      dataDir: currentServer.dataDir,
      personaFile: joinPath(currentPaths.root, "persona.md"),
      defaultPersonaFile: currentServer.personaFile,
      parentPid: getOwnPid(),
    });

    try {
      await writeText(
        currentPaths.botConfigFile,
        JSON.stringify(botConfig, null, 2),
      );
    } catch (error) {
      addLog("error", `写入启动配置失败：${errText(error)}`);
      return false;
    }

    const command = buildSpawnCommand(
      nodeRef.current,
      entry,
      currentPaths.botConfigFile,
    );

    addLog("gui", `正在启动 Bot：${entry}`);

    try {
      const proc = await spawnBotProcess(command, currentServer.serverDir);

      childRef.current = proc.id;
      childPidRef.current = proc.pid;
      setBotPid(proc.pid);
      setStartedAt(Date.now());
      updateBotState("running");
      addLog("gui", "Bot 已启动");

      // 稳定运行一分钟后清掉崩溃计数，避免历史失败影响很久以后的一次崩溃
      setTimeout(() => {
        if (botStateRef.current === "running") {
          autoRestartRef.current.count = 0;
        }
      }, 60_000);

      const buffered = orphanEventsRef.current.get(proc.id);
      if (buffered) {
        orphanEventsRef.current.delete(proc.id);
        for (const event of buffered) processSpawnEvent(event);
      }

      startTimerRef.current = setTimeout(() => {
        if (childRef.current !== null && !bootSeenRef.current) {
          addLog(
            "error",
            "Bot 启动 15 秒仍没有输出，请检查配置或查看错误日志。",
          );
        }
      }, 15_000);

      void updateTray();
      return true;
    } catch (error) {
      updateBotState("crashed");
      addLog("error", `启动 Bot 失败：${errText(error)}`);
      setMessage({ kind: "error", text: `启动失败：${errText(error)}` });
      void updateTray();
      return false;
    }
  };

  const stopBot = async (): Promise<boolean> => {
    if (autoRestartTimerRef.current) {
      clearTimeout(autoRestartTimerRef.current);
      autoRestartTimerRef.current = null;
    }

    const id = childRef.current;
    if (id === null) {
      updateBotState("stopped");
      return true;
    }

    updateBotState("stopping");
    addLog("gui", "正在暂停 Bot…");
    void updateTray();

    try {
      // 优先按进程树杀（cmd → node），避免留下孤儿 node
      const pid = childPidRef.current;
      if (pid) await killProcessTree(pid);
      else await os.updateSpawnedProcess(id, "exit");
    } catch (error) {
      addLog("error", `发送停止指令失败：${errText(error)}`);
    }

    const exited = await waitFor(() => childRef.current === null, 5000);

    if (!exited && childRef.current !== null) {
      updateBotState("running");
      addLog("error", "Bot 在 5 秒内没有退出，请用任务管理器检查 node 进程。");
      void updateTray();
      return false;
    }

    return true;
  };

  const restartBot = async (): Promise<void> => {
    const stopped = await stopBot();
    if (!stopped) return;
    await startBot();
  };

  const quitApp = async (): Promise<void> => {
    if (autoRestartTimerRef.current) {
      clearTimeout(autoRestartTimerRef.current);
      autoRestartTimerRef.current = null;
    }

    const id = childRef.current;

    if (id !== null) {
      try {
        const pid = childPidRef.current;
        if (pid) await killProcessTree(pid);
        else await os.updateSpawnedProcess(id, "exit");
      } catch {
        // 交给父进程看门狗兜底
      }
      await waitFor(() => childRef.current === null, 3000);
    }

    const currentPaths = pathsRef.current;
    if (currentPaths) await releaseLock(currentPaths.lockFile);

    await quit();
  };

  const openLogsDir = async (): Promise<void> => {
    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    await ensureDir(currentPaths.logsDir);
    await openPath(currentPaths.logsDir);
  };

  const openDataDir = async (): Promise<void> => {
    const current = serverRef.current;
    if (!current) return;

    await ensureDir(current.dataDir);
    await openPath(current.dataDir);
  };

  const {
    cleanupUpdates,
    exportData,
    importData,
    listStickers,
    deleteSticker,
    retagStickers,
    listUsers,
    clearUserData,
    fetchModels,
    runSelfCheck,
    readPersona,
    savePersona,
    resetPersona,
    openPersonaDir,
  } = useDataActions({
    pathsRef,
    serverRef,
    nodeRef,
    configRef,
    botStateRef,
    addLog,
    startBot,
    stopBot,
  });


  const dismissMessage = () => setMessage(null);

  /** 上一次更新留下的结果：成功就报喜，失败就带着日志路径提醒 */
  const consumeUpdateResult = async (appPaths: IAppPaths): Promise<void> => {
    const updatesDir = joinPath(appPaths.root, "updates");
    const resultFile = joinPath(updatesDir, "update-result.json");
    const pendingFile = joinPath(updatesDir, "update-pending.json");

    const pendingText = await readText(pendingFile);
    const resultText = await readText(resultFile);

    let pending: { version?: string; workDir?: string } | null = null;
    if (pendingText) {
      try {
        const parsed = JSON.parse(
          pendingText.replace(/^\uFEFF/, ""),
        ) as Record<string, unknown>;
        pending = {
          version:
            typeof parsed.version === "string" ? parsed.version : undefined,
          workDir:
            typeof parsed.workDir === "string" ? parsed.workDir : undefined,
        };
      } catch {
        pending = null;
      }
    }

    const result = parseUpdateResult(resultText);

    if (result) {
      if (result.ok && result.version === APP_VERSION) {
        setMessage({ kind: "ok", text: `已更新到 v${APP_VERSION}。` });
        addLog("gui", `更新成功：v${APP_VERSION}`);
        if (pending?.workDir) {
          // 只删 updates 目录下的内容，防止 pending.json 被改成任意路径
          const prefix = `${normalizePath(updatesDir)}\\`;
          const workDir = normalizePath(pending.workDir);
          if (workDir.startsWith(prefix)) {
            await removePath(workDir).catch(() => {});
          }
        }
      } else if (result.ok) {
        setMessage({
          kind: "error",
          text: `更新脚本报告成功，但当前版本仍是 v${APP_VERSION}，请手动检查。`,
        });
        addLog(
          "error",
          `更新结果版本不一致：${result.version} / ${APP_VERSION}`,
        );
      } else {
        setMessage({
          kind: "error",
          text: `上次更新失败：${result.error ?? "未知错误"}。日志在 ${joinPath(
            updatesDir,
            "update.log",
          )}`,
        });
        addLog("error", `上次更新失败：${result.error ?? "未知错误"}`);
      }

      await removePath(resultFile).catch(() => {});
      await removePath(pendingFile).catch(() => {});
      return;
    }

    if (pending) {
      setMessage({
        kind: "error",
        text: "上次更新没有完成，可以重试，或从 GitHub 手动下载覆盖。",
      });
      addLog("error", "发现未完成的更新记录");
      await removePath(pendingFile).catch(() => {});
    }
  };

  /** 查 GitHub Releases；silent=true 时只更新状态，不弹提示 */
  const checkUpdate = async (silent = false): Promise<void> => {
    if (updateBusyRef.current) return;

    const status = updateRef.current.status;
    if (
      status === "downloading" ||
      status === "preparing" ||
      status === "ready"
    ) {
      return;
    }

    updateBusyRef.current = true;
    updateStatus({ status: "checking" });

    const includePrerelease = configRef.current.behavior.includePrerelease;

    // 不用 AbortSignal.timeout：部分旧 WebView2 没有这个静态方法
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(releasesApiUrl(includePrerelease), {
        // 只带 Accept（CORS 安全头），避免触发 GitHub API 的预检请求
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });

      if (res.status === 404) {
        throw new Error("GitHub 上还没有发布版本");
      }
      if (res.status === 403) {
        throw new Error("GitHub 接口被限流了，请稍后再试");
      }
      if (!res.ok) {
        throw new Error(`检查更新失败（HTTP ${res.status}）`);
      }

      const raw: unknown = await res.json();
      const info = includePrerelease
        ? pickBestRelease(raw, APP_VERSION, true)
        : parseRelease(raw);
      const checkedAt = Date.now();

      if (info && isNewerVersion(info.version, APP_VERSION)) {
        updateStatus({ status: "available", info, checkedAt });
        addLog(
          "gui",
          `发现新版本 ${info.tag}（当前 v${APP_VERSION}${includePrerelease ? "，含预发布" : ""}）`,
        );
        if (!silent) {
          setMessage({
            kind: "info",
            text: `发现新版本 ${info.tag}，可以到「关于」页下载更新。`,
          });
        }
      } else {
        updateStatus({ status: "up-to-date", info: info ?? undefined, checkedAt });
        addLog(
          "gui",
          `检查更新：已是最新版本 v${APP_VERSION}${includePrerelease ? "（含预发布）" : ""}`,
        );
        if (!silent) {
          setMessage({
            kind: "ok",
            text: `已经是最新版本 v${APP_VERSION} 啦。`,
          });
        }
      }
    } catch (error) {
      const text =
        error instanceof Error && error.name === "AbortError"
          ? "检查更新超时，请检查网络后重试"
          : errText(error);
      updateStatus({ status: "error", error: text, checkedAt: Date.now() });
      addLog("error", `检查更新失败：${text}`);
      if (!silent) {
        setMessage({ kind: "error", text: `检查更新失败：${text}` });
      }
    } finally {
      clearTimeout(timeout);
      updateBusyRef.current = false;
    }
  };

  const openReleasePage = async (): Promise<void> => {
    const url = updateRef.current.info?.htmlUrl ?? RELEASES_PAGE;
    if (!/^https:\/\/github\.com\//i.test(url)) {
      setMessage({ kind: "error", text: "发布页地址不是 GitHub 域名。" });
      return;
    }

    try {
      await os.open(url);
    } catch (error) {
      addLog("error", `打开发布页失败：${errText(error)}`);
      window.open(url, "_blank");
    }
  };

  /**
   * 下载 → 校验 → 解压 → 写更新脚本 → 退出。
   * 脚本会等当前进程退出后再覆盖便携目录，最后重新启动 exe。
   */
  const installUpdate = async (): Promise<void> => {
    if (updateBusyRef.current) return;

    const current = updateRef.current;
    const info = current.info;
    if (current.status !== "available" || !info) {
      setMessage({ kind: "info", text: "先检查更新，确认有新版本再安装。" });
      return;
    }

    if (!packagedRef.current) {
      setMessage({
        kind: "info",
        text: "开发模式不支持自动安装，请使用打包版或手动替换文件。",
      });
      return;
    }

    const asset = info.asset;
    if (!asset) {
      setMessage({
        kind: "error",
        text: `${info.tag} 没有提供 Windows 便携包。`,
      });
      return;
    }

    // Release 资源名只允许安全字符，避免被拼成路径穿越
    if (!/^[0-9A-Za-z._-]+\.zip$/i.test(asset.name)) {
      setMessage({ kind: "error", text: "安装包文件名不合法，已停止更新。" });
      return;
    }

    if (!validateDownloadUrl(asset.browserDownloadUrl)) {
      setMessage({ kind: "error", text: "安装包下载地址不在 GitHub 域名内。" });
      return;
    }

    const targetDir = normalizePath(getAppRoot());
    if (!(await fileExists(joinPath(targetDir, "WhaleCompanion.exe")))) {
      setMessage({
        kind: "error",
        text: "当前程序不是便携版目录结构，无法自动更新。",
      });
      return;
    }

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    updateBusyRef.current = true;
    let workDir = "";
    let pendingFile = "";
    let stoppedForUpdate = false;

    try {
      const updatesDir = joinPath(currentPaths.root, "updates");
      await ensureDir(updatesDir);

      // 下载 + 解压 + 备份大约需要 3 倍 zip 的空间；查不到就继续，不阻塞更新
      const drive = /^[A-Za-z]:/.exec(targetDir)?.[0]?.[0];
      if (drive) {
        try {
          const freeResult = await os.execCommand(
            buildFreeSpaceCommand(drive),
          );
          const freeMb = Number(freeResult.stdOut.trim());
          const needMb = Math.ceil((asset.size * 3) / (1024 * 1024));

          if (
            Number.isFinite(freeMb) &&
            freeMb > 0 &&
            needMb > 0 &&
            freeMb < needMb
          ) {
            throw new Error(
              `磁盘空间不足：需要约 ${needMb}MB，${drive} 盘只剩 ${freeMb}MB`,
            );
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith("磁盘空间不足")
          ) {
            throw error;
          }
          addLog(
            "gui",
            `检查磁盘空间失败（继续更新）：${errText(error)}`,
          );
        }
      }

      const safeVersion =
        info.version.replace(/[^0-9A-Za-z._-]/g, "_") || "unknown";
      workDir = joinPath(updatesDir, `${safeVersion}-${Date.now()}`);
      await ensureDir(workDir);

      const zipFile = joinPath(workDir, asset.name);
      const partFile = `${zipFile}.part`;
      await removePath(partFile);
      await removePath(zipFile);

      updateStatus({
        status: "downloading",
        info,
        progress: asset.size > 0 ? 0 : null,
      });
      addLog(
        "gui",
        `开始下载 ${asset.name}（${formatBytes(asset.size)}）`,
      );

      let lastSize = -1;
      const progressTimer = setInterval(() => {
        void fileSize(partFile).then((size) => {
          if (size === null || size === lastSize) return;
          lastSize = size;

          const state = updateRef.current;
          if (state.status !== "downloading") return;

          updateStatus({
            ...state,
            progress: progressPercent(size, asset.size),
          });
        });
      }, 400);

      try {
        await runDownload(asset.browserDownloadUrl, partFile);
      } finally {
        clearInterval(progressTimer);
      }

      const downloaded = await fileSize(partFile);
      if (downloaded === null || downloaded <= 0) {
        throw new Error("下载完成但文件是空的");
      }
      if (asset.size > 0 && downloaded !== asset.size) {
        throw new Error(
          `下载大小不一致（期望 ${asset.size} 字节，实际 ${downloaded} 字节）`,
        );
      }

      await removePath(zipFile);
      await movePath(partFile, zipFile);

      updateStatus({ status: "preparing", info, progress: 100 });

      const checksumAsset = info.checksumAsset;
      if (checksumAsset) {
        if (!validateDownloadUrl(checksumAsset.browserDownloadUrl)) {
          throw new Error("校验文件地址不在 GitHub 域名内");
        }

        const sumsFile = joinPath(workDir, CHECKSUM_ASSET_NAME);
        await runDownload(checksumAsset.browserDownloadUrl, sumsFile);

        const expected = parseChecksumFile(
          (await readText(sumsFile)) ?? "",
          asset.name,
        );
        if (!expected) throw new Error("校验文件里没有这个安装包");

        const hashResult = await os.execCommand(buildHashCommand(zipFile));
        if (hashResult.exitCode !== 0) {
          throw new Error("计算安装包 SHA256 失败");
        }

        const actual = parseHashOutput(hashResult.stdOut);
        if (actual !== expected) {
          throw new Error("安装包 SHA256 校验失败，已停止更新");
        }

        addLog("gui", "安装包 SHA256 校验通过");
      } else {
        addLog("gui", "这个版本没有 SHA256SUMS.txt，跳过校验");
      }

      const extractDir = joinPath(workDir, "extract");
      await ensureDir(extractDir);

      const extractResult = await os.execCommand(
        buildExtractCommand(zipFile, extractDir),
      );
      if (extractResult.exitCode !== 0) {
        const detail = (
          extractResult.stdErr ||
          extractResult.stdOut ||
          `退出码 ${extractResult.exitCode}`
        ).trim();
        throw new Error(`解压失败：${detail.slice(0, 300)}`);
      }

      const payloadDir = await findPayloadDir(extractDir);
      if (
        !payloadDir ||
        !(await fileExists(joinPath(payloadDir, "resources.neu")))
      ) {
        throw new Error("解压后的安装包不完整（缺少 resources.neu）");
      }

      const wasRunning =
        botStateRef.current === "running" ||
        botStateRef.current === "starting";

      if (wasRunning) {
        stoppedForUpdate = await stopBot();
        if (!stoppedForUpdate) {
          throw new Error("Bot 没有停下来，请稍后重试");
        }
      }

      const scriptPath = joinPath(
        updatesDir,
        `apply-update-${Date.now()}.ps1`,
      );
      const resultFile = joinPath(updatesDir, "update-result.json");
      pendingFile = joinPath(updatesDir, "update-pending.json");
      const logFile = joinPath(updatesDir, "update.log");
      const backupDir = joinPath(
        updatesDir,
        `backup-${APP_VERSION}-${Date.now()}`,
      );

      const script = buildUpdateScript({
        parentPid: getOwnPid(),
        sourceDir: payloadDir,
        targetDir,
        backupDir,
        resultFile,
        logFile,
        version: info.version,
      });

      // 带 BOM，Windows PowerShell 5.1 才会按 UTF-8 读脚本
      await writeText(scriptPath, `\uFEFF${script}`);
      await writeText(
        pendingFile,
        JSON.stringify(
          {
            version: info.version,
            workDir,
            backupDir,
            script: scriptPath,
            startedAt: Date.now(),
          },
          null,
          2,
        ),
      );
      await removePath(resultFile);

      addLog("gui", `更新器已启动，准备重启安装 ${info.tag}`);
      const helper = await os.spawnProcess(buildApplyCommand(scriptPath), {
        cwd: updatesDir,
      });
      if (!helper || helper.pid <= 0) {
        throw new Error("更新器进程没有启动");
      }

      updateStatus({ status: "ready", info, progress: 100 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await quitApp();
    } catch (error) {
      const text = errText(error);
      updateStatus({
        status: "error",
        info,
        error: text,
        checkedAt: Date.now(),
      });
      addLog("error", `更新失败：${text}`);
      setMessage({ kind: "error", text: `更新失败：${text}` });

      if (pendingFile) await removePath(pendingFile).catch(() => {});
      if (stoppedForUpdate) void startBot();
    } finally {
      updateBusyRef.current = false;
    }
  };

  /**
   * 主题只改外观，不需要重启 Bot；单独写一次 config.json。
   * 先应用再落盘，写失败就回滚到上一份配置。
   */
  const setTheme = async (theme: ThemeMode): Promise<void> => {
    const previous = configRef.current;
    if (previous.appearance.theme === theme) return;

    const next = normalizeConfig({
      ...previous,
      appearance: { theme },
    });

    configRef.current = next;
    setConfig(next);

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    try {
      await persistConfig(currentPaths.configFile, next);
      addLog("gui", `外观已切换为${themeLabel(theme)}`);
    } catch (error) {
      // 用户可能已经又切了别的主题；不要用旧失败覆盖新选择
      if (configRef.current.appearance.theme !== theme) return;

      configRef.current = previous;
      setConfig(previous);
      addLog("error", `保存外观设置失败：${errText(error)}`);
      setMessage({
        kind: "error",
        text: `外观设置没有保存成功：${errText(error)}`,
      });
    }
  };

  /**
   * 「是否接收预发布版本」只影响检查更新的来源，不需要重启 Bot。
   * 先应用再落盘，写失败回滚到上一份配置。
   */
  const setIncludePrerelease = async (value: boolean): Promise<void> => {
    const previous = configRef.current;
    if (previous.behavior.includePrerelease === value) return;

    const next = normalizeConfig({
      ...previous,
      behavior: { ...previous.behavior, includePrerelease: value },
    });

    configRef.current = next;
    setConfig(next);
    updateStatus({ status: "idle" });

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    try {
      await persistConfig(currentPaths.configFile, next);
      addLog(
        "gui",
        value ? "更新已改为包含预发布版本" : "更新已改为只接收正式版本",
      );
    } catch (error) {
      if (configRef.current.behavior.includePrerelease !== value) return;

      configRef.current = previous;
      setConfig(previous);
      addLog("error", `保存更新偏好失败：${errText(error)}`);
      setMessage({
        kind: "error",
        text: `更新偏好没有保存成功：${errText(error)}`,
      });
    }
  };

  const saveConfig = async (next: IAppConfig): Promise<boolean> => {
    const wasRunning = isBotActive(botStateRef.current);

    // 主题已经在设置页即时保存；保存其他字段时不要用表单里的旧值把它覆盖回去
    const normalized = normalizeConfig({
      ...next,
      appearance: configRef.current.appearance,
    });
    const errors = validateConfig(normalized);

    if (errors.length > 0) {
      setMessage({ kind: "error", text: errors.join("；") });
      return false;
    }

    if (normalized.behavior.launchAtLogin && packagedRef.current) {
      try {
        const exePath = await getOwnExePath();
        await setAutostart(true, {
          exePath,
          regFile: joinPath(pathsRef.current?.root ?? "", "autostart.reg"),
        });
      } catch (error) {
        normalized.behavior.launchAtLogin = false;
        addLog("error", `设置开机自启失败：${errText(error)}`);
      }
    } else if (!normalized.behavior.launchAtLogin && packagedRef.current) {
      try {
        await setAutostart(false, {
          exePath: null,
          regFile: joinPath(pathsRef.current?.root ?? "", "autostart.reg"),
        });
      } catch (error) {
        addLog("error", `取消开机自启失败：${errText(error)}`);
      }
    } else if (normalized.behavior.launchAtLogin) {
      normalized.behavior.launchAtLogin = false;
      addLog("gui", "开发模式不支持开机自启，已忽略这个选项");
    }

    const currentPaths = pathsRef.current;
    if (!currentPaths) return false;

    try {
      await persistConfig(currentPaths.configFile, normalized);
    } catch (error) {
      addLog("error", `保存配置失败：${errText(error)}`);
      setMessage({ kind: "error", text: `保存失败：${errText(error)}` });
      return false;
    }

    configRef.current = normalized;
    setConfig(normalized);
    addLog("gui", "设置已保存");
    setMessage({
      kind: "ok",
      text: wasRunning
        ? "设置已保存，正在重启 Bot"
        : "设置已保存；Bot 未运行，下次启动生效",
    });
    void updateTray();

    // 暂停状态的 Bot 不因为保存设置被偷偷启动
    if (wasRunning) await restartBot();
    return true;
  };

  const importEnv = async (): Promise<IAppConfig | null> => {
    const appRoot = getAppRoot();
    const candidates = [
      normalizePath(joinPath(appRoot, "..", "server", ".env")),
      normalizePath(joinPath(appRoot, "server", ".env")),
    ];

    for (const candidate of candidates) {
      const text = await readText(candidate);
      if (!text) continue;

      addLog("gui", `已从 ${candidate} 读取配置`);
      return configFromEnv(parseEnvFile(text), configRef.current);
    }

    setMessage({ kind: "info", text: "没有找到可导入的 .env" });
    return null;
  };

  const onWindowClose = async () => {
    if (configRef.current.behavior.closeAction === "tray") {
      // 托盘没建起来时隐藏窗口等于把程序藏没了，宁可不关
      if (!trayOkRef.current) {
        setMessage({
          kind: "error",
          text: "托盘图标没有创建成功，这次先不隐藏窗口。请检查托盘图标或改设置。",
        });
        addLog("error", "托盘不可用，取消隐藏窗口");
        return;
      }

      try {
        await hideWindow();
        addLog("gui", "窗口已隐藏到托盘");
      } catch (error) {
        addLog("error", `隐藏窗口失败：${errText(error)}`);
      }
      return;
    }

    await quitApp();
  };

  const onTrayClick = (event: Event) => {
    const id = (event as CustomEvent).detail?.id as string | undefined;

    switch (id) {
      case "SHOW":
        void showWindow();
        break;
      case "START":
        void startBot();
        break;
      case "STOP":
        void stopBot();
        break;
      case "RESTART":
        void restartBot();
        break;
      case "LOGS":
        void openLogsDir();
        break;
      case "DATA":
        void openDataDir();
        break;
      case "QUIT":
        void quitApp();
        break;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!isNeutralino()) {
        setMessage({
          kind: "error",
          text: "这个页面需要在桌面端中运行（Neutralino 未初始化）。",
        });
        setReady(true);
        return;
      }

      // 开机自启时注册表传来的 --hidden：先藏起来，配置有问题再露脸
      const startHidden = hasHiddenFlag(window.NL_ARGS);
      let hidden = startHidden;
      if (startHidden) {
        try {
          await hideWindow();
        } catch (error) {
          addLog("error", `隐藏窗口失败：${errText(error)}`);
        }
      }

      const revealIfHidden = async (reason: string) => {
        if (!hidden) return;
        try {
          await showWindow();
          hidden = false;
          addLog("gui", `开机自启：${reason}，已显示窗口`);
        } catch (error) {
          addLog("error", `显示窗口失败：${errText(error)}`);
        }
      };

      try {
        setBootMessage("读取应用目录…");
        const appPaths = buildAppPaths(await getAppDataPath());
        pathsRef.current = appPaths;
        setPaths(appPaths);

        await ensureDir(appPaths.root);
        await ensureDir(appPaths.dataDir);
        await ensureDir(appPaths.logsDir);

        const isPackagedApp = await isPackaged();
        packagedRef.current = isPackagedApp;
        setPackaged(isPackagedApp);

        const server = buildServerPaths(
          getAppRoot(),
          isPackagedApp,
          appPaths.dataDir,
        );
        serverRef.current = server;
        setServerPaths(server);

        try {
          const node = await findNode(isPackagedApp);
          nodeRef.current = node;
          setNodePath(node);
        } catch (error) {
          addLog("error", errText(error));
        }

        setBootMessage("读取配置…");
        let loaded: IAppConfig | null = null;
        let rawConfig = "";
        let needsMigration = false;
        const configText = await readText(appPaths.configFile);

        if (configText) {
          rawConfig = configText;
          try {
            const json = JSON.parse(configText.replace(/^\uFEFF/, "")) as unknown;
            loaded = normalizeConfig(json);
            needsMigration =
              Number((json as { version?: unknown } | null)?.version) !== 2;
          } catch {
            addLog("error", "配置文件不是合法 JSON，已回退到默认值");
          }
        }

        if (!loaded) {
          const appRoot = getAppRoot();
          const envText =
            (await readText(
              normalizePath(joinPath(appRoot, "..", "server", ".env")),
            )) ?? (await readText(joinPath(appRoot, "server", ".env")));

          loaded = envText
            ? configFromEnv(parseEnvFile(envText))
            : { ...DEFAULT_CONFIG };

          if (envText) addLog("gui", "已从 .env 导入初始配置");

          if (rawConfig) {
            // 坏 JSON 也别直接覆盖，留一份现场
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            await writeText(
              `${appPaths.configFile}.bak-invalid-${stamp}`,
              rawConfig,
            ).catch(() => {});
          }

          await writeConfigFile(appPaths.configFile, loaded);
        } else if (needsMigration) {
          // v1 → v2：先备份原始 JSON，再写回完整配置
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          try {
            await writeText(
              `${appPaths.configFile}.bak-v1-${stamp}`,
              rawConfig,
            );
          } catch (error) {
            addLog("error", `备份旧配置失败：${errText(error)}`);
          }

          try {
            await writeConfigFile(appPaths.configFile, loaded);
            addLog("gui", "配置已从 v1 迁移到 v2");
          } catch (error) {
            addLog("error", `写回迁移配置失败：${errText(error)}`);
          }
        }

        configRef.current = loaded;
        setConfig(loaded);
        setConfigLoaded(true);

        // 按用户设置清理旧日志
        for (const name of pickOldLogs(
          await readDir(appPaths.logsDir),
          loaded.logs.keepDays,
        )) {
          await removePath(joinPath(appPaths.logsDir, name));
        }

        await cleanupUpdates(appPaths.root);

        setBootMessage("检查是否已有实例…");
        const lock = await acquireLock(appPaths.lockFile);
        if (!lock.ok) {
          setBootMessage("已经有一个实例在运行，正在退出…");
          addLog(
            "gui",
            `检测到已运行的实例${lock.pid ? `（PID ${lock.pid}）` : ""}，本实例退出`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await quit();
          return;
        }

        // 拿到锁之后再消费更新结果，避免两个实例同时删同一份记录
        await consumeUpdateResult(appPaths);

        setBootMessage("初始化托盘…");
        await updateTray();

        events.on("windowClose", onWindowClose);
        events.on("trayMenuItemClicked", onTrayClick);
        events.on("spawnedProcess", onSpawned);

        // 设置里要求启动时最小化：托盘初始化后再藏，避免完全叫不出来
        if (!hidden && loaded.behavior.startMinimized) {
          try {
            await hideWindow();
            hidden = true;
            addLog("gui", "按设置启动时最小化到托盘");
          } catch (error) {
            addLog("error", `启动时隐藏窗口失败：${errText(error)}`);
          }
        }

        addLog("gui", `小鲸鱼控制台已启动（v${APP_VERSION}）`);

        if (!nodeRef.current) {
          await revealIfHidden("没有找到 Node.js");
          setPage("settings");
          setMessage({
            kind: "error",
            text: "没有找到 Node.js。请安装 Node 22+，或使用带 node.exe 的打包版。",
          });
        } else if (validateConfig(loaded).length > 0) {
          await revealIfHidden("配置不完整");
          setPage("settings");
          setMessage({
            kind: "info",
            text: "先填写 QQ 和模型的配置，保存后 Bot 会自动启动。",
          });
          addLog("gui", "配置未完成，等待填写");
        } else if (!loaded.behavior.autoStartBot) {
          await revealIfHidden("已关闭启动时自动启动");
          addLog("gui", "按设置未自动启动 Bot，等用户手动启动");
        } else {
          setBootMessage("启动 Bot…");
          const started = await startBot();

          if (hidden && started) {
            addLog("gui", "启动时已隐藏到托盘");
          } else if (hidden) {
            await revealIfHidden("Bot 启动失败");
          }
        }

        if (!cancelled) {
          setReady(true);

          // 后台静默查一次；隐藏启动（开机自启）时不打扰网络
          if (
            !hidden &&
            isPackagedApp &&
            loaded.behavior.checkUpdateOnStartup &&
            validateConfig(loaded).length === 0
          ) {
            void checkUpdate(true);
          }
        }
      } catch (error) {
        await revealIfHidden("初始化失败");
        addLog("error", `初始化失败：${errText(error)}`);
        setBootMessage(`初始化失败：${errText(error)}`);
        setMessage({ kind: "error", text: `初始化失败：${errText(error)}` });
        setReady(true);
      }
    };

    void init();

    return () => {
      cancelled = true;
      events.off("windowClose", onWindowClose);
      events.off("trayMenuItemClicked", onTrayClick);
      events.off("spawnedProcess", onSpawned);
      clearStartTimer();
    };
    // 只在启动时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 把配置里的主题落到 DOM；跟随系统时还要监听系统切换
    const mode = config.appearance.theme;

    const sync = () => {
      const resolved = resolveTheme(mode, systemPrefersDark());
      applyTheme(resolved);
      setResolvedTheme(resolved);
    };

    sync();
    if (mode !== "system") return;

    return watchSystemTheme(sync);
  }, [config.appearance.theme]);

  useEffect(() => {
    // 错误留下来，别让用户错过；成功/提示 5 秒后自动消失
    if (!message || message.kind === "error") return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    // 单实例锁的心跳；窗口隐藏时也比 tasklist 探查可靠
    const timer = setInterval(() => {
      const currentPaths = pathsRef.current;
      if (!currentPaths) return;
      void touchLock(currentPaths.lockFile).catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // QQ 长时间连不上就自动重启：兜住「进程活着、会话却死了」这种自己发现不了的状态
    const timer = setInterval(() => {
      const downSince = qqDownSinceRef.current;
      if (downSince === null) return;
      if (botStateRef.current !== "running") return;
      // 权限 / 下架 / 封禁类停机，重启也不会好，交给用户处理
      if (qqStateRef.current === "stopped") return;
      if (updateBusyRef.current) return;

      const now = Date.now();
      if (now - downSince < QQ_DOWN_RESTART_MS) return;
      if (now - qqAutoRestartAtRef.current < QQ_DOWN_RESTART_COOLDOWN_MS) {
        return;
      }

      const minutes = Math.max(1, Math.round((now - downSince) / 60_000));
      qqAutoRestartAtRef.current = now;
      qqDownSinceRef.current = now;

      addLog("error", `QQ 已经 ${minutes} 分钟没有连上，自动重启 Bot`);
      setMessage({
        kind: "info",
        text: `QQ 连接 ${minutes} 分钟没恢复，正在自动重启 Bot…`,
      });
      void restartBot();
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  return {
    ready,
    bootMessage,
    page,
    setPage,
    config,
    configLoaded,
    resolvedTheme,
    setTheme,
    setIncludePrerelease,
    botState,
    qqState,
    botPid,
    startedAt,
    lastActivityAt,
    exitCode,
    logs,
    paths,
    serverPaths,
    nodePath,
    packaged,
    message,
    dismissMessage,
    update,
    checkUpdate,
    installUpdate,
    openReleasePage,
    saveConfig,
    importEnv,
    startBot,
    stopBot,
    restartBot,
    quitApp,
    openLogsDir,
    openDataDir,
    exportData,
    importData,
    listStickers,
    deleteSticker,
    retagStickers,
    listUsers,
    clearUserData,
    clearLogs,
    fetchModels,
    runSelfCheck,
    readPersona,
    savePersona,
    resetPersona,
    openPersonaDir,
  };
};
