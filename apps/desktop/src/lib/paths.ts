import type { IAppPaths, IServerPaths } from "./types";

/** 只处理 Windows 路径；GUI 目前只支持 Windows */
export const joinPath = (...parts: string[]): string => {
  const filtered = parts.filter((p) => p.length > 0);
  if (filtered.length === 0) return "";

  let out = filtered[0].replace(/[\\/]+$/, "");

  for (let i = 1; i < filtered.length; i += 1) {
    const part = filtered[i].replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    if (!part) continue;
    out += `\\${part}`;
  }

  return out;
};

/** 把 C:\a\..\b 这种路径收干净，方便日志和子进程使用 */
export const normalizePath = (path: string): string => {
  const abs = path.replace(/\//g, "\\");
  const drive = /^[A-Za-z]:/.exec(abs)?.[0] ?? "";
  const rest = drive ? abs.slice(drive.length) : abs;

  const out: string[] = [];
  for (const part of rest.split("\\")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!drive) out.push("..");
      continue;
    }
    out.push(part);
  }

  return drive + "\\" + out.join("\\");
};

export const buildAppPaths = (appData: string): IAppPaths => {
  const root = joinPath(appData, "whale-companion");

  return {
    root,
    configFile: joinPath(root, "config.json"),
    dataDir: joinPath(root, "data"),
    logsDir: joinPath(root, "logs"),
    lockFile: joinPath(root, "app.lock"),
    botConfigFile: joinPath(root, "bot.json"),
    personaDir: joinPath(root, "personas"),
    activePersonaFile: joinPath(root, "personas", "active.json"),
  };
};

/**
 * 开发态从 apps/desktop 启动，server 在 ../server；
 * 打包态 server 目录和 exe 放在一起。
 */
export const buildServerPaths = (
  nlPath: string,
  packaged: boolean,
  appDataDir: string,
): IServerPaths => {
  if (packaged) {
    const serverDir = normalizePath(joinPath(nlPath, "server"));
    return {
      serverDir,
      dataDir: normalizePath(appDataDir),
      builtinPersonaDir: normalizePath(joinPath(serverDir, "personas")),
      promptsDir: normalizePath(joinPath(serverDir, "prompts")),
    };
  }

  const appRoot = normalizePath(nlPath);
  return {
    serverDir: normalizePath(joinPath(appRoot, "..", "server", "dist")),
    dataDir: normalizePath(joinPath(appRoot, "..", "server", "data")),
    builtinPersonaDir: normalizePath(
      joinPath(appRoot, "..", "server", "personas"),
    ),
    promptsDir: normalizePath(joinPath(appRoot, "..", "server", "prompts")),
  };
};

/** NL_PATH 在开发模式下可能是 "."，这时用绝对的工作目录 */
export const resolveAppRoot = (
  nlPath: string | undefined,
  nlCwd: string | undefined,
): string => {
  const raw = nlPath ?? "";
  const absolute = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\");
  return normalizePath(absolute ? raw : (nlCwd ?? "."));
};
