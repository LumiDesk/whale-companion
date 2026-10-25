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
import {
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from "../lib/theme";
import {
  CHECKSUM_ASSET_NAME,
  RELEASES_API,
  RELEASES_PAGE,
  buildApplyCommand,
  buildDownloadCommand,
  buildExtractCommand,
  buildHashCommand,
  buildPowerShellDownloadCommand,
  buildUpdateScript,
  formatBytes,
  isNewerVersion,
  parseChecksumFile,
  parseHashOutput,
  parseRelease,
  parseUpdateResult,
  progressPercent,
  validateDownloadUrl,
} from "../lib/update";
import type { IUpdateState } from "../lib/update";
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

/** 解压后的便携包根目录：兼容 zip 里带一层 WhaleCompanion 目录的布局 */
const findPayloadDir = async (root: string): Promise<string | null> => {
  const candidates = [root, joinPath(root, "WhaleCompanion")];

  for (const dir of candidates) {
    if (await fileExists(joinPath(dir, "WhaleCompanion.exe"))) return dir;
  }

  return null;
};

/** 下载 GitHub 资源：优先 curl，系统没有 curl 时退回 PowerShell */
const runDownload = async (url: string, destination: string): Promise<void> => {
  let result = await os.execCommand(
    buildDownloadCommand(url, destination),
  );

  const missingCurl =
    result.exitCode === 9009 ||
    /not recognized|不是内部或外部命令/i.test(result.stdErr);

  if (missingCurl) {
    result = await os.execCommand(
      buildPowerShellDownloadCommand(url, destination),
    );
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
  const tmp = `${file}.tmp`;
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
  const [logs, setLogs] = useState<ILogLine[]>([]);
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
  const logsRef = useRef<ILogLine[]>([]);
  const logIdRef = useRef(0);
  const outBufferRef = useRef(new LineBuffer());
  const errBufferRef = useRef(new LineBuffer());
  const logFileQueueRef = useRef<Promise<void>>(Promise.resolve());
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSeenRef = useRef(false);
  const orphanEventsRef = useRef(new Map<number, ISpawnDetail[]>());
  const updateRef = useRef<IUpdateState>({ status: "idle" });
  const updateBusyRef = useRef(false);

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

    // 不用 AbortSignal.timeout：部分旧 WebView2 没有这个静态方法
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(RELEASES_API, {
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

      const info = parseRelease(await res.json());
      const checkedAt = Date.now();

      if (isNewerVersion(info.version, APP_VERSION)) {
        updateStatus({ status: "available", info, checkedAt });
        addLog("gui", `发现新版本 ${info.tag}（当前 v${APP_VERSION}）`);
        if (!silent) {
          setMessage({
            kind: "info",
            text: `发现新版本 ${info.tag}，可以到「关于」页下载更新。`,
          });
        }
      } else {
        updateStatus({ status: "up-to-date", info, checkedAt });
        addLog("gui", `检查更新：已是最新版本 v${APP_VERSION}`);
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

      const script = buildUpdateScript({
        parentPid: getOwnPid(),
        sourceDir: payloadDir,
        targetDir,
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

        // 上次更新脚本留下的结果（成功/失败）在这里消费一次
        await consumeUpdateResult(appPaths);

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

        if (!cancelled) {
          setReady(true);

          // 后台静默查一次；隐藏启动（开机自启）时不打扰网络
          if (
            !startHidden &&
            isPackagedApp &&
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
    clearLogs,
  };
};
