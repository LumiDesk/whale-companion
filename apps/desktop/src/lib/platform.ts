import {
  Icon,
  MessageBoxChoice,
  app,
  filesystem,
  os,
  window as neuWindow,
} from "@neutralinojs/lib";

import { isLockFresh, parseLock } from "./lock";
import { joinPath, resolveAppRoot } from "./paths";
import type { ITrayItem } from "./types-ui";

export const isNeutralino = (): boolean =>
  typeof window !== "undefined" && typeof window.NL_PORT === "number";

export const getOwnPid = (): number => {
  const pid = Number(window.NL_PID);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
};

export const ensureDir = async (path: string): Promise<void> => {
  try {
    await filesystem.createDirectory(path);
  } catch {
    // 已存在时 Neutralino 也会抛错，确认一下再决定是否吞掉
    if (!(await fileExists(path))) throw new Error(`无法创建目录：${path}`);
  }
};

export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await filesystem.getStats(path);
    return true;
  } catch {
    return false;
  }
};

export const readText = async (path: string): Promise<string | null> => {
  try {
    return await filesystem.readFile(path);
  } catch {
    return null;
  }
};

/** 文件大小；不存在或读不到时返回 null（下载进度用，不该打断流程） */
export const fileSize = async (path: string): Promise<number | null> => {
  try {
    const stats = await filesystem.getStats(path);
    const size = Number(stats.size);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
};

export const writeText = async (path: string, content: string): Promise<void> => {
  await filesystem.writeFile(path, content);
};

/** 临时文件 + 覆盖，尽量让配置/人设不会写一半 */
export const writeTextAtomic = async (
  path: string,
  content: string,
): Promise<void> => {
  const temp = `${path}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;

  await filesystem.writeFile(temp, content);

  try {
    await filesystem.move(temp, path);
  } catch {
    await removePath(path);
    await filesystem.move(temp, path);
  }
};

export const appendText = async (path: string, content: string): Promise<void> => {
  await filesystem.appendFile(path, content);
};

export const removePath = async (path: string): Promise<void> => {
  try {
    await filesystem.remove(path);
  } catch {
    // 不存在就算了
  }
};

export const movePath = async (from: string, to: string): Promise<void> => {
  await filesystem.move(from, to);
};

export const readDir = async (path: string): Promise<string[]> => {
  try {
    const entries = await filesystem.readDirectory(path);
    return entries.map((entry) => entry.entry);
  } catch {
    return [];
  }
};

export const openPath = async (path: string): Promise<void> => {
  await os.open(path);
};

export const showInfo = async (title: string, message: string): Promise<void> => {
  await os.showMessageBox(title, message, MessageBoxChoice.OK, Icon.INFO);
};

export const showError = async (title: string, message: string): Promise<void> => {
  await os.showMessageBox(title, message, MessageBoxChoice.OK, Icon.ERROR);
};

export const setTray = async (items: ITrayItem[]): Promise<void> => {
  await os.setTray({
    icon: "/resources/icons/tray.png",
    menuItems: items,
  });
};

export const hideWindow = (): Promise<void> => neuWindow.hide();

export const showWindow = async (): Promise<void> => {
  await neuWindow.show();
  try {
    await neuWindow.focus();
  } catch {
    // focus 失败不影响显示
  }
};

export const quit = (): Promise<void> => app.exit();

export const getAppDataPath = (): Promise<string> => os.getPath("data");

export const getAppRoot = (): string =>
  resolveAppRoot(window.NL_PATH, window.NL_CWD);

/** 打包版：exe 旁边有 server/index.js；开发版从 apps/desktop 往上一级找 */
export const isPackaged = async (): Promise<boolean> =>
  fileExists(joinPath(getAppRoot(), "server", "index.js"));

export const findNode = async (packaged: boolean): Promise<string> => {
  if (packaged) {
    const local = joinPath(getAppRoot(), "node.exe");
    if (await fileExists(local)) return local;
  }

  const result = await os.execCommand("where node");
  const first = result.stdOut
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!first) {
    throw new Error(
      "没有找到 Node.js。开发模式请先安装 Node 22+；打包版请保留 node.exe。",
    );
  }

  return first;
};

/**
 * 不传 envs：继承当前进程环境。配置通过 --config 文件传给 Bot，
 * 避免 Neutralino 在 Windows 上替换环境块导致 CreateProcess 失败。
 */
export const spawnBotProcess = async (
  command: string,
  cwd: string,
): Promise<{ id: number; pid: number }> => os.spawnProcess(command, { cwd });

/** cmd.exe 是 node 的父进程，按进程树杀，避免留下孤儿 node */
export const killProcessTree = async (pid: number): Promise<void> => {
  if (!Number.isInteger(pid) || pid <= 0) return;
  await os.execCommand(`taskkill /PID ${pid} /T /F`);
};

/** true=活着，false=确认没了，null=查不出来（用心跳兜底） */
export const isProcessAlive = async (
  pid: number,
): Promise<boolean | null> => {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    const result = await os.execCommand(`tasklist /FI "PID eq ${pid}" /NH`);
    if (result.exitCode !== 0) return null;
    return new RegExp(`\\b${pid}\\b`).test(result.stdOut);
  } catch {
    return null;
  }
};

export const acquireLock = async (
  lockFile: string,
): Promise<{ ok: boolean; pid?: number }> => {
  const lock = parseLock(await readText(lockFile));

  if (lock) {
    const alive = await isProcessAlive(lock.pid);

    // 进程还在，或者查不出来但心跳很新，都认为已有实例
    if (alive === true) return { ok: false, pid: lock.pid };
    if (alive === null && isLockFresh(lock)) {
      return { ok: false, pid: lock.pid };
    }
  }

  const pid = getOwnPid();
  await writeText(
    lockFile,
    JSON.stringify({ pid, startedAt: Date.now(), heartbeat: Date.now() }),
  );
  return { ok: true, pid };
};

/** 定时刷新心跳；进程崩了以后锁会在 3 分钟后自然过期 */
export const touchLock = async (lockFile: string): Promise<void> => {
  const lock = parseLock(await readText(lockFile));
  if (!lock) return;

  await writeText(lockFile, JSON.stringify({ ...lock, heartbeat: Date.now() }));
};

export const releaseLock = async (lockFile: string): Promise<void> => {
  await removePath(lockFile);
};

export const getOwnExePath = async (): Promise<string | null> => {
  const pid = getOwnPid();
  if (!pid) return null;

  try {
    const result = await os.execCommand(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid}).Path"`,
    );
    const path = result.stdOut
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return path || null;
  } catch {
    return null;
  }
};

const escapeRegValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** reg.exe 对非 ASCII 路径按 ANSI 读；带 BOM 的 UTF-16LE 才稳 */
const toUtf16Le = (text: string): ArrayBuffer => {
  const buffer = new Uint8Array(2 + text.length * 2);
  buffer[0] = 0xff;
  buffer[1] = 0xfe;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    buffer[2 + i * 2] = code & 0xff;
    buffer[3 + i * 2] = code >> 8;
  }

  return buffer.buffer;
};

/** 通过 .reg 文件写 HKCU Run，避免命令行嵌套引号踩坑 */
export const setAutostart = async (
  enabled: boolean,
  options: { exePath: string | null; regFile: string },
): Promise<void> => {
  if (!enabled) {
    await os.execCommand(
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v WhaleCompanion /f',
    );
    return;
  }

  if (!options.exePath) {
    throw new Error("读不到当前程序路径，无法设置开机自启");
  }

  const value = `\\"${escapeRegValue(options.exePath)}\\" --hidden`;
  const content =
    "Windows Registry Editor Version 5.00\r\n\r\n" +
    "[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]\r\n" +
    `"WhaleCompanion"="${value}"\r\n`;

  await filesystem.writeBinaryFile(options.regFile, toUtf16Le(content));
  try {
    await os.execCommand(`reg import "${options.regFile}"`);
  } finally {
    await removePath(options.regFile);
  }
};
