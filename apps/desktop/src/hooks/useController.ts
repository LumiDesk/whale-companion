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
  appendLogLine,
  formatLogLine,
  logFileName,
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
  appendText,
  ensureDir,
  fileExists,
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
import {
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from "../lib/theme";
import type {
  BotState,
  IAppConfig,
  IAppPaths,
  ILogLine,
  IServerPaths,
  PageId,
  QQState,
  ResolvedTheme,
  ThemeMode,
} from "../lib/types";
import type { ITrayItem } from "../lib/types-ui";
import { APP_VERSION } from "../lib/version";

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
  saveConfig: (next: IAppConfig) => Promise<boolean>;
  importEnv: () => Promise<IAppConfig | null>;
  startBot: () => Promise<boolean>;
  stopBot: () => Promise<boolean>;
  restartBot: () => Promise<void>;
  quitApp: () => Promise<void>;
  openLogsDir: () => Promise<void>;
  openDataDir: () => Promise<void>;
  clearLogs: () => void;
}

const errText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

const writeConfigFile = async (
  file: string,
  config: IAppConfig,
): Promise<void> => {
  const tmp = `${file}.tmp`;
  await writeText(tmp, JSON.stringify(config, null, 2));
  await removePath(file);
  await movePath(tmp, file);
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
  const [logs, setLogs] = useState<ILogLine[]>([]);
  const [paths, setPaths] = useState<IAppPaths | null>(null);
  const [serverPaths, setServerPaths] = useState<IServerPaths | null>(null);
  const [nodePath, setNodePath] = useState("");
  const [packaged, setPackaged] = useState(false);
  const [message, setMessage] = useState<IMessage | null>(null);

  const configRef = useRef(DEFAULT_CONFIG);
  const pathsRef = useRef<IAppPaths | null>(null);
  const serverRef = useRef<IServerPaths | null>(null);
  const nodeRef = useRef("");
  const packagedRef = useRef(false);
  const childRef = useRef<number | null>(null);
  const childPidRef = useRef<number | null>(null);
  const botStateRef = useRef<BotState>("stopped");
  const qqStateRef = useRef<QQState>("unknown");
  const logsRef = useRef<ILogLine[]>([]);
  const logIdRef = useRef(0);
  const outBufferRef = useRef(new LineBuffer());
  const errBufferRef = useRef(new LineBuffer());
  const logFileQueueRef = useRef<Promise<void>>(Promise.resolve());
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSeenRef = useRef(false);
  const orphanEventsRef = useRef(new Map<number, ISpawnDetail[]>());

  const updateBotState = (next: BotState) => {
    botStateRef.current = next;
    setBotState(next);
  };

  const updateQqState = (next: QQState) => {
    qqStateRef.current = next;
    setQqState(next);
  };

  const addLog = (
    source: ILogLine["source"],
    text: string,
    ts = Date.now(),
  ) => {
    const line: ILogLine = {
      id: (logIdRef.current += 1),
      ts,
      source,
      text,
    };

    logsRef.current = appendLogLine(logsRef.current, line);
    setLogs(logsRef.current);

    const currentPaths = pathsRef.current;
    if (!currentPaths) return;

    logFileQueueRef.current = logFileQueueRef.current
      .then(() =>
        appendText(
          joinPath(currentPaths.logsDir, logFileName(new Date(line.ts))),
          `${formatLogLine(line)}\r\n`,
        ),
      )
      .catch(() => {
        // 日志文件写不进去不能影响主流程
      });
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
    } catch (error) {
      addLog("error", `托盘更新失败：${errText(error)}`);
    }
  };

  const handleStatus = (event: ReturnType<typeof parseStatusLine>) => {
    if (!event) return;

    if (event.type === "boot") {
      bootSeenRef.current = true;
      clearStartTimer();
      if (typeof event.pid === "number") setBotPid(event.pid);
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
    setExitCode(Number.isFinite(code) ? code : null);
    updateBotState(wasStopping || code === 0 ? "stopped" : "crashed");
    addLog("gui", `Bot 进程已退出（code=${Number.isFinite(code) ? code : "?"}）`);
    void updateTray();
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

    const botConfig = buildBotConfig(configRef.current, {
      dataDir: currentServer.dataDir,
      personaFile: currentServer.personaFile,
      parentPid: getOwnPid(),
    });

    const currentPaths = pathsRef.current;
    if (!currentPaths) {
      addLog("error", "还没有准备好配置目录，无法启动 Bot");
      return false;
    }

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

  const clearLogs = () => {
    logsRef.current = [];
    setLogs([]);
  };

  const dismissMessage = () => setMessage(null);

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
      await writeConfigFile(currentPaths.configFile, next);
      addLog("gui", `外观已切换为${themeLabel(theme)}`);
    } catch (error) {
      configRef.current = previous;
      setConfig(previous);
      addLog("error", `保存外观设置失败：${errText(error)}`);
      setMessage({
        kind: "error",
        text: `外观设置没有保存成功：${errText(error)}`,
      });
    }
  };

  const saveConfig = async (next: IAppConfig): Promise<boolean> => {
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
      await writeConfigFile(currentPaths.configFile, normalized);
    } catch (error) {
      addLog("error", `保存配置失败：${errText(error)}`);
      setMessage({ kind: "error", text: `保存失败：${errText(error)}` });
      return false;
    }

    configRef.current = normalized;
    setConfig(normalized);
    addLog("gui", "设置已保存");
    setMessage({ kind: "ok", text: "设置已保存，正在重启 Bot" });
    void updateTray();

    await restartBot();
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
      if (startHidden) {
        try {
          await hideWindow();
        } catch (error) {
          addLog("error", `隐藏窗口失败：${errText(error)}`);
        }
      }

      const revealIfHidden = async (reason: string) => {
        if (!startHidden) return;
        try {
          await showWindow();
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

        for (const name of pickOldLogs(await readDir(appPaths.logsDir))) {
          await removePath(joinPath(appPaths.logsDir, name));
        }

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
        const configText = await readText(appPaths.configFile);

        if (configText) {
          try {
            const json = JSON.parse(configText.replace(/^\uFEFF/, "")) as unknown;
            loaded = normalizeConfig(json);
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
          await writeConfigFile(appPaths.configFile, loaded);
        }

        configRef.current = loaded;
        setConfig(loaded);
        setConfigLoaded(true);

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

        setBootMessage("初始化托盘…");
        await updateTray();

        events.on("windowClose", onWindowClose);
        events.on("trayMenuItemClicked", onTrayClick);
        events.on("spawnedProcess", onSpawned);

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
        } else {
          setBootMessage("启动 Bot…");
          const started = await startBot();

          if (startHidden && started) {
            addLog("gui", "开机自启：已隐藏到托盘");
          } else if (startHidden) {
            await revealIfHidden("Bot 启动失败");
          }
        }

        if (!cancelled) setReady(true);
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

  return {
    ready,
    bootMessage,
    page,
    setPage,
    config,
    configLoaded,
    resolvedTheme,
    setTheme,
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
    saveConfig,
    importEnv,
    startBot,
    stopBot,
    restartBot,
    quitApp,
    openLogsDir,
    openDataDir,
    clearLogs,
  };
};
