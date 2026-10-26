import { useRef, useState, type RefObject } from "react";
import { os } from "@neutralinojs/lib";

import { validateConfig } from "../lib/config";
import { errText } from "../lib/format";
import { splitServerTimestamp } from "../lib/logs";
import { joinPath } from "../lib/paths";
import {
  fileExists,
  getOwnPid,
  killProcessTree,
  quit,
  releaseLock,
  removePath,
  setTray,
  spawnBotProcess,
  writeText,
} from "../lib/platform";
import { buildBotConfig, buildSpawnCommand } from "../lib/process";
import { decideAutoRestart } from "../lib/restart";
import { LineBuffer, parseStatusLine } from "../lib/status";
import type {
  BotState,
  IAppConfig,
  IAppPaths,
  ILogLine,
  IServerPaths,
  ITrayItem,
  PageId,
  QQState,
} from "../lib/types";

interface IMessage {
  kind: "ok" | "error" | "info";
  text: string;
}

interface ISpawnDetail {
  id: number;
  action: string;
  data?: unknown;
}

interface IDeps {
  configRef: RefObject<IAppConfig>;
  pathsRef: RefObject<IAppPaths | null>;
  serverRef: RefObject<IServerPaths | null>;
  nodeRef: RefObject<string>;
  addLog: (source: ILogLine["source"], text: string, ts?: number) => void;
  setMessage: (message: IMessage | null) => void;
  /** 配置不完整时跳去设置页 */
  setPage: (page: PageId) => void;
  /** QQ 离线的起点，由外层的离线看门狗消费 */
  qqDownSinceRef: RefObject<number | null>;
}

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

/**
 * Bot 子进程生命周期：启动、停止、重启、退出，spawn 事件与状态行解析，托盘菜单。
 * 只管进程；配置、更新、数据各自由别的 hook 负责。
 */
export const useBotProcess = (deps: IDeps) => {
  const {
    configRef,
    pathsRef,
    serverRef,
    nodeRef,
    addLog,
    setMessage,
    setPage,
    qqDownSinceRef,
  } = deps;

  const [botState, setBotState] = useState<BotState>("stopped");
  const [qqState, setQqState] = useState<QQState>("unknown");
  const [botPid, setBotPid] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const childRef = useRef<number | null>(null);
  const childPidRef = useRef<number | null>(null);
  const botStateRef = useRef<BotState>("stopped");
  const qqStateRef = useRef<QQState>("unknown");
  const outBufferRef = useRef(new LineBuffer());
  const errBufferRef = useRef(new LineBuffer());
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSeenRef = useRef(false);
  const orphanEventsRef = useRef(new Map<number, ISpawnDetail[]>());

  const autoRestartRef = useRef({ count: 0, lastAt: 0 });
  const autoRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const trayOkRef = useRef(true);

  const updateBotState = (next: BotState) => {
    botStateRef.current = next;
    setBotState(next);
  };

  const updateQqState = (next: QQState) => {
    qqStateRef.current = next;
    setQqState(next);
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

  return {
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
  };
};
