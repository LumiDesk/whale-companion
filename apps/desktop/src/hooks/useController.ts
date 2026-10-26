import { useEffect, useRef, useState } from "react";
import { events } from "@neutralinojs/lib";

import {
  DEFAULT_CONFIG,
  configFromEnv,
  normalizeConfig,
  parseEnvFile,
  validateConfig,
} from "../lib/config";
import { errText } from "../lib/format";
import { pickOldLogs } from "../lib/logs";
import {
  buildAppPaths,
  buildServerPaths,
  joinPath,
  normalizePath,
} from "../lib/paths";
import {
  acquireLock,
  ensureDir,
  findNode,
  getAppDataPath,
  getAppRoot,
  getOwnExePath,
  hideWindow,
  isNeutralino,
  isPackaged,
  movePath,
  openPath,
  quit,
  readDir,
  readText,
  removePath,
  setAutostart,
  showWindow,
  touchLock,
  writeText,
} from "../lib/platform";
import { hasHiddenFlag } from "../lib/process";
import { isBotActive } from "../lib/restart";
import {
  applyTheme,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
} from "../lib/theme";
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
  PageId,
  QQState,
  ResolvedTheme,
  ThemeMode,
} from "../lib/types";
import { APP_VERSION } from "../lib/version";
import { useBotProcess } from "./useBotProcess";
import { useDataActions } from "./useDataActions";
import { useLogs } from "./useLogs";
import { useUpdate } from "./useUpdate";

interface IMessage {
  kind: "ok" | "error" | "info";
  text: string;
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

/** QQ 连续离线这么久就自动重启 Bot（进程还活着但连不上，用户通常不会自己去点） */
const QQ_DOWN_RESTART_MS = 5 * 60_000;
/** 两次自动重启至少隔这么久，避免网络长期不通时反复重启 */
const QQ_DOWN_RESTART_COOLDOWN_MS = 30 * 60_000;


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


export const useController = (): IController => {
  const [ready, setReady] = useState(false);
  const [bootMessage, setBootMessage] = useState("正在叫醒小鲸鱼…");
  const [page, setPage] = useState<PageId>("status");
  const [config, setConfig] = useState<IAppConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system", systemPrefersDark()),
  );
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
  const configWriteRef = useRef<Promise<void>>(Promise.resolve());
  /** QQ 从什么时候开始连不上（online 时清空） */
  const qqDownSinceRef = useRef<number | null>(null);
  /** 上一次因为 QQ 离线自动重启的时间 */
  const qqAutoRestartAtRef = useRef(0);

  const { logs, addLog, clearLogs } = useLogs({
    pathsRef,
    maxLines: () => configRef.current.logs.maxLines,
  });


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

  const {
    botState,
    qqState,
    botPid,
    startedAt,
    lastActivityAt,
    exitCode,
    botStateRef,
    qqStateRef,
    trayOkRef,
    updateTray,
    onSpawned,
    clearStartTimer,
    startBot,
    stopBot,
    restartBot,
    quitApp,
  } = useBotProcess({
    configRef,
    pathsRef,
    serverRef,
    nodeRef,
    addLog,
    setMessage,
    setPage,
    qqDownSinceRef,
  });

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

  const {
    update,
    updateBusyRef,
    updateStatus,
    consumeUpdateResult,
    checkUpdate,
    installUpdate,
    openReleasePage,
  } = useUpdate({
    pathsRef,
    configRef,
    botStateRef,
    packagedRef,
    addLog,
    setMessage,
    stopBot,
    startBot,
    quitApp,
  });

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
