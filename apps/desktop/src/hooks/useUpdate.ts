import { useRef, useState, type RefObject } from "react";
import { os } from "@neutralinojs/lib";

import { joinPath, normalizePath } from "../lib/paths";
import { errText } from "../lib/format";
import {
  ensureDir,
  fileExists,
  fileSize,
  getAppRoot,
  getOwnPid,
  movePath,
  readText,
  removePath,
  writeText,
} from "../lib/platform";
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
import { APP_VERSION } from "../lib/version";
import type { BotState, IAppConfig, IAppPaths, ILogLine } from "../lib/types";

interface IMessage {
  kind: "ok" | "error" | "info";
  text: string;
}

interface IDeps {
  pathsRef: RefObject<IAppPaths | null>;
  configRef: RefObject<IAppConfig>;
  botStateRef: RefObject<BotState>;
  packagedRef: RefObject<boolean>;
  addLog: (source: ILogLine["source"], text: string, ts?: number) => void;
  setMessage: (message: IMessage | null) => void;
  stopBot: () => Promise<boolean>;
  startBot: () => Promise<boolean>;
  quitApp: () => Promise<void>;
}

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

/**
 * 检查更新 → 下载 → 校验 → 生成更新脚本 → 退出重启。
 * 也在启动时消费上一次更新的结果（成功/失败都提示）。
 */
export const useUpdate = (deps: IDeps) => {
  const {
    pathsRef,
    configRef,
    botStateRef,
    packagedRef,
    addLog,
    setMessage,
    stopBot,
    startBot,
    quitApp,
  } = deps;

  const [update, setUpdate] = useState<IUpdateState>({ status: "idle" });
  const updateRef = useRef<IUpdateState>({ status: "idle" });
  const updateBusyRef = useRef(false);

  const updateStatus = (next: IUpdateState) => {
    updateRef.current = next;
    setUpdate(next);
  };

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

  return {
    update,
    updateBusyRef,
    updateStatus,
    consumeUpdateResult,
    checkUpdate,
    installUpdate,
    openReleasePage,
  };
};
