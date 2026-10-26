import type { RefObject } from "react";
import { os } from "@neutralinojs/lib";

import { joinPath } from "../lib/paths";
import {
  ensureDir,
  fileExists,
  fileModifiedAt,
  movePath,
  openPath,
  readDir,
  readText,
  removePath,
  writeText,
  writeTextAtomic,
} from "../lib/platform";
import { buildBotConfig, buildSpawnCommand } from "../lib/process";
import { parseStatusLine } from "../lib/status";
import { buildExtractCommand, psLiteral } from "../lib/update";
import { APP_VERSION } from "../lib/version";
import type {
  BotState,
  IAppConfig,
  IAppPaths,
  ICheckResult,
  IKnownUser,
  ILogLine,
  IModelInfo,
  IServerPaths,
  IStickerInfo,
} from "../lib/types";

interface IDeps {
  pathsRef: RefObject<IAppPaths | null>;
  serverRef: RefObject<IServerPaths | null>;
  nodeRef: RefObject<string>;
  configRef: RefObject<IAppConfig>;
  botStateRef: RefObject<BotState>;
  addLog: (source: ILogLine["source"], text: string, ts?: number) => void;
  startBot: () => Promise<boolean>;
  stopBot: () => Promise<boolean>;
}

/**
 * 数据与只读工具：备份导出/导入、图库与用户维护、人设、模型列表、连接自检。
 * 和 Bot 进程编排分开，各自只关心自己的事。
 */
export const useDataActions = (deps: IDeps) => {
  const {
    pathsRef,
    serverRef,
    nodeRef,
    configRef,
    botStateRef,
    addLog,
    startBot,
    stopBot,
  } = deps;

  /** 清理过期的更新/导入/导出缓存，避免 updates 目录只增不减 */
  const cleanupUpdates = async (root: string): Promise<void> => {
    const updatesDir = joinPath(root, "updates");
    const names = await readDir(updatesDir);
    const now = Date.now();
    const day = 86_400_000;

    for (const name of names) {
      let maxAge: number | null = null;

      if (name === "model-check.json" || name === "self-check.json" || name === "retag-check.json") {
        maxAge = day;
      } else if (/^(export-|import-)/.test(name)) {
        maxAge = 3 * day;
      } else if (/^(backup-|import-backup-)/.test(name)) {
        maxAge = 30 * day;
      } else if (/^apply-update-.*\.ps1$/i.test(name)) {
        maxAge = 7 * day;
      }

      if (maxAge === null) continue;

      const modified = await fileModifiedAt(joinPath(updatesDir, name));
      if (modified !== null && now - modified > maxAge) {
        await removePath(joinPath(updatesDir, name)).catch(() => {});
      }
    }
  };

  /** 导出 data + 自定义人设；默认不含 config.json 里的密钥 */
  const exportData = async (): Promise<string | null> => {
    const currentPaths = pathsRef.current;
    const server = serverRef.current;
    if (!currentPaths || !server) throw new Error("还没有准备好数据目录");

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const exportsDir = joinPath(currentPaths.root, "exports");
    await ensureDir(exportsDir);

    const destination = await os.showSaveDialog("导出小鲸鱼数据", {
      defaultPath: joinPath(exportsDir, `whale-backup-${stamp}.zip`),
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!destination) return null;

    const staging = joinPath(currentPaths.root, "updates", `export-${stamp}`);
    await ensureDir(staging);
    await ensureDir(server.dataDir);

    const manifest = {
      app: "whale-companion",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      includes: ["data"],
    };

    const personaOverride = joinPath(currentPaths.root, "persona.md");
    const persona = await readText(personaOverride);
    if (persona && persona.trim()) {
      manifest.includes.push("persona");
      await writeText(joinPath(staging, "persona.md"), persona);
    }

    await writeText(
      joinPath(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const paths = [server.dataDir, joinPath(staging, "manifest.json")];
    if (persona && persona.trim()) paths.push(joinPath(staging, "persona.md"));

    const command =
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " +
      `"Compress-Archive -LiteralPath ${paths
        .map((item) => psLiteral(item))
        .join(",")} -DestinationPath ${psLiteral(destination)} -Force"`;

    try {
      const result = await os.execCommand(command);
      if (result.exitCode !== 0) {
        const detail = (result.stdErr || result.stdOut || "").trim();
        throw new Error(
          `导出失败${detail ? `：${detail.slice(0, 300)}` : ""}`,
        );
      }

      addLog("gui", `数据已导出：${destination}`);
      return destination;
    } finally {
      await removePath(staging).catch(() => {});
    }
  };

  /** 导入 zip：只接受 data/、persona.md、manifest.json，覆盖前先备份当前数据 */
  const importData = async (): Promise<boolean> => {
    const currentPaths = pathsRef.current;
    const server = serverRef.current;
    if (!currentPaths || !server) throw new Error("还没有准备好数据目录");

    const selected = await os.showOpenDialog("导入小鲸鱼备份", {
      multiSelections: false,
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!selected || selected.length === 0) return false;

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const temp = joinPath(currentPaths.root, "updates", `import-${stamp}`);
    const backup = joinPath(
      currentPaths.root,
      "updates",
      `import-backup-${stamp}`,
    );

    await ensureDir(temp);

    try {
      const extract = await os.execCommand(
        buildExtractCommand(selected[0], temp),
      );
      if (extract.exitCode !== 0) {
        const detail = (extract.stdErr || extract.stdOut || "").trim();
        throw new Error(
          `解压失败${detail ? `：${detail.slice(0, 300)}` : ""}`,
        );
      }

      const manifestText = await readText(joinPath(temp, "manifest.json"));
      if (!manifestText) throw new Error("备份里没有 manifest.json");

      let manifest: { app?: string } = {};
      try {
        manifest = JSON.parse(manifestText) as { app?: string };
      } catch {
        throw new Error("manifest.json 不是合法 JSON");
      }
      if (manifest.app !== "whale-companion") {
        throw new Error("这不是小鲸鱼的备份");
      }

      const importedData = joinPath(temp, "data");
      if (!(await fileExists(importedData))) {
        throw new Error("备份里没有 data 目录");
      }

      const importedPersona = joinPath(temp, "persona.md");
      const hasPersona = await fileExists(importedPersona);

      const wasRunning =
        botStateRef.current === "running" ||
        botStateRef.current === "starting";
      if (wasRunning) {
        const stopped = await stopBot();
        if (!stopped) throw new Error("Bot 没有停下来，已取消导入");
      }

      await ensureDir(backup);
      const currentPersona = joinPath(currentPaths.root, "persona.md");
      const currentData = server.dataDir;

      try {
        if (await fileExists(currentData)) {
          await movePath(currentData, joinPath(backup, "data"));
        }
        if (await fileExists(currentPersona)) {
          await movePath(currentPersona, joinPath(backup, "persona.md"));
        }

        await movePath(importedData, currentData);
        if (hasPersona) {
          await movePath(importedPersona, currentPersona);
        }
      } catch (error) {
        // 尽量还原；还原本身失败时保留 backup 目录供手动恢复
        try {
          await removePath(currentData);
          if (await fileExists(joinPath(backup, "data"))) {
            await movePath(joinPath(backup, "data"), currentData);
          }
          await removePath(currentPersona);
          if (await fileExists(joinPath(backup, "persona.md"))) {
            await movePath(joinPath(backup, "persona.md"), currentPersona);
          }
        } catch {
          // 保留现场
        }

        if (wasRunning) void startBot();
        throw error;
      }

      addLog("gui", `数据已导入，原数据备份在 ${backup}`);
      if (wasRunning) await startBot();
      return true;
    } finally {
      await removePath(temp).catch(() => {});
    }
  };

  const listStickers = async (): Promise<IStickerInfo[]> => {
    const server = serverRef.current;
    if (!server) return [];

    const indexPath = joinPath(server.dataDir, "stickers", "index.json");
    const text = await readText(indexPath);
    if (!text) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("表情包索引不是合法 JSON");
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is IStickerInfo =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as IStickerInfo).id === "string" &&
          typeof (item as IStickerInfo).file === "string",
      )
      .map((item) => ({
        ...item,
        tags: Array.isArray(item.tags) ? item.tags : [],
        createdAt: Number(item.createdAt ?? 0),
        mime: typeof item.mime === "string" ? item.mime : "image/jpeg",
      }));
  };

  const deleteSticker = async (id: string): Promise<void> => {
    const server = serverRef.current;
    const currentPaths = pathsRef.current;
    if (!server || !currentPaths) throw new Error("还没有准备好数据目录");

    const stickersDir = joinPath(server.dataDir, "stickers");
    const indexPath = joinPath(stickersDir, "index.json");
    const text = await readText(indexPath);
    if (!text) throw new Error("图库索引不存在");

    let list: IStickerInfo[];
    try {
      const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (!Array.isArray(parsed)) throw new Error("not array");
      list = parsed as IStickerInfo[];
    } catch {
      throw new Error("表情包索引损坏，已取消删除");
    }

    const target = list.find((item) => item.id === id);
    if (!target) return;
    if (!/^[A-Za-z0-9._-]+$/.test(target.file)) {
      throw new Error("表情包文件名不合法，已取消删除");
    }

    const wasRunning =
      botStateRef.current === "running" || botStateRef.current === "starting";
    if (wasRunning) {
      const stopped = await stopBot();
      if (!stopped) throw new Error("Bot 没有停下来，已取消删除");
    }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeText(joinPath(stickersDir, `index.json.bak-${stamp}`), text);
      await removePath(joinPath(stickersDir, target.file));

      const next = list.filter((item) => item.id !== id);
      await writeTextAtomic(
        indexPath,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      addLog("gui", `已删除表情包 ${id.slice(0, 8)}`);
    } finally {
      if (wasRunning) void startBot();
    }
  };

  const retagStickers = async (): Promise<void> => {
    const wasRunning =
      botStateRef.current === "running" || botStateRef.current === "starting";
    if (wasRunning) {
      const stopped = await stopBot();
      if (!stopped) throw new Error("Bot 没有停下来，已取消重新打标");
    }

    try {
      const { events, detail } = await collectServerEvents(
        configRef.current,
        "--retag",
        "retag-check.json",
      );
      const event = events.find((item) => item.type === "retag");
      if (!event) {
        throw new Error(
          `重新打标没有返回结果${detail ? `：${detail.slice(0, 300)}` : ""}`,
        );
      }
      if (event.ok !== true) {
        throw new Error(String(event.error ?? "重新打标失败"));
      }

      addLog(
        "gui",
        `重新打标完成：${String(event.tagged ?? 0)} 张成功 / ${String(
          event.failed ?? 0,
        )} 张失败`,
      );
    } finally {
      if (wasRunning) void startBot();
    }
  };

  const listUsers = async (): Promise<IKnownUser[]> => {
    const server = serverRef.current;
    if (!server) return [];

    const text = await readText(joinPath(server.dataDir, "users.json"));
    if (!text) return [];

    try {
      const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is IKnownUser =>
            Boolean(item) && typeof item === "object" &&
            typeof (item as IKnownUser).userId === "string",
        )
        .map((item) => ({
          ...item,
          lastSeen: Number(item.lastSeen ?? 0),
        }))
        .sort((a, b) => b.lastSeen - a.lastSeen);
    } catch {
      throw new Error("用户记录不是合法 JSON");
    }
  };

  const clearUserData = async (
    userId: string,
    target: "history" | "memory" | "both",
  ): Promise<void> => {
    const server = serverRef.current;
    if (!server) throw new Error("还没有准备好数据目录");
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
      throw new Error("用户 ID 不合法，已取消");
    }

    const wasRunning =
      botStateRef.current === "running" || botStateRef.current === "starting";
    if (wasRunning) {
      const stopped = await stopBot();
      if (!stopped) throw new Error("Bot 没有停下来，已取消清理");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    try {
      if (target === "history" || target === "both") {
        const historyPath = joinPath(server.dataDir, "history.json");
        const text = await readText(historyPath);
        if (text) {
          await writeText(`${historyPath}.bak-${stamp}`, text);
          const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            delete (parsed as Record<string, unknown>)[userId];
            await writeTextAtomic(
              historyPath,
              `${JSON.stringify(parsed, null, 2)}\n`,
            );
          }
        }
      }

      if (target === "memory" || target === "both") {
        const memoryPath = joinPath(server.dataDir, "memory", `${userId}.json`);
        const text = await readText(memoryPath);
        if (text) {
          await writeText(`${memoryPath}.bak-${stamp}`, text);
          await removePath(memoryPath);
        }
      }

      addLog("gui", `已清理用户数据：${userId.slice(0, 8)}（${target}）`);
    } finally {
      if (wasRunning) void startBot();
    }
  };

  /**
   * 以一次性子进程运行服务端的只读命令（--list-models / --self-check）。
   * 临时配置写到当前用户目录，读完即删；不影响正在运行的 Bot。
   */
  const collectServerEvents = async (
    next: IAppConfig,
    mode: "--list-models" | "--self-check" | "--retag",
    fileName: string,
  ): Promise<{
    events: Array<NonNullable<ReturnType<typeof parseStatusLine>>>;
    detail: string;
  }> => {
    const node = nodeRef.current;
    const server = serverRef.current;
    const currentPaths = pathsRef.current;

    if (!node) throw new Error("没有找到 Node.js，无法运行检查");
    if (!server) throw new Error("还没有找到 Bot 程序目录");
    if (!currentPaths) throw new Error("还没有准备好配置目录");
    if (!next.llm.apiKey.trim()) {
      throw new Error("先填写 API Key，再运行检查");
    }

    const tempFile = joinPath(currentPaths.root, fileName);
    const env = buildBotConfig(next, {
      dataDir: server.dataDir,
      personaFile: joinPath(currentPaths.root, "persona.md"),
      defaultPersonaFile: server.personaFile,
      parentPid: 0,
    });

    // 只做只读检查时不需要 QQ 凭据；用占位值通过必填校验，不会建立连接
    env.QQBOT_APPID ||= "check-placeholder";
    env.QQBOT_SECRET ||= "check-placeholder";

    try {
      await writeText(tempFile, JSON.stringify(env, null, 2));

      const command = `${buildSpawnCommand(
        node,
        joinPath(server.serverDir, "index.js"),
        tempFile,
      )} ${mode}`;

      const result = await os.execCommand(command);
      const events = result.stdOut
        .split(/\r?\n/)
        .map((line) => parseStatusLine(line))
        .filter((event): event is NonNullable<typeof event> => event !== null);

      return {
        events,
        detail: (result.stdErr || result.stdOut || "").trim(),
      };
    } finally {
      await removePath(tempFile).catch(() => {});
    }
  };

  const fetchModels = async (next: IAppConfig): Promise<IModelInfo[]> => {
    const { events, detail } = await collectServerEvents(
      next,
      "--list-models",
      "model-check.json",
    );

    const event = events.find((item) => item.type === "models");
    if (event) {
      if (event.ok !== true) {
        throw new Error(String(event.error ?? "获取模型列表失败"));
      }

      const models = Array.isArray(event.models)
        ? (event.models as IModelInfo[])
        : [];
      if (models.length === 0) throw new Error("接口没有返回可用模型");

      addLog("gui", `已获取 ${models.length} 个可用模型`);
      return models;
    }

    throw new Error(
      `获取模型列表失败${detail ? `：${detail.slice(0, 300)}` : "（无输出）"}`,
    );
  };

  const runSelfCheck = async (next: IAppConfig): Promise<ICheckResult[]> => {
    const { events, detail } = await collectServerEvents(
      next,
      "--self-check",
      "self-check.json",
    );

    const done = events.find((item) => item.type === "check-done");
    if (!done) {
      throw new Error(
        `自检没有返回结果${detail ? `：${detail.slice(0, 300)}` : "（无输出）"}`,
      );
    }

    const results: ICheckResult[] = events
      .filter((item) => item.type === "check")
      .map((item) => ({
        name: String(item.name ?? "unknown"),
        ok: item.ok === true,
        detail: typeof item.detail === "string" ? item.detail : undefined,
      }));

    addLog("gui", `连接自检完成：${done.ok === true ? "全部通过" : "有失败项"}`);
    return results;
  };

  const personaOverrideFile = (): string => {
    const currentPaths = pathsRef.current;
    if (!currentPaths) throw new Error("还没有准备好配置目录");
    return joinPath(currentPaths.root, "persona.md");
  };

  const readPersona = async (): Promise<{
    text: string;
    source: "custom" | "default";
    path: string;
  }> => {
    const override = personaOverrideFile();
    const custom = await readText(override);
    if (custom && custom.trim()) {
      return { text: custom, source: "custom", path: override };
    }

    const server = serverRef.current;
    const fallback = server ? await readText(server.personaFile) : null;

    return {
      text: fallback ?? "",
      source: "default",
      path: server?.personaFile ?? override,
    };
  };

  const savePersona = async (text: string): Promise<void> => {
    const body = text.trim();
    if (!body) throw new Error("人设不能为空");
    if (body.length > 20_000) throw new Error("人设不能超过 20000 字");

    const override = personaOverrideFile();
    const existing = await readText(override);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (existing) {
      await writeText(`${override}.bak-${stamp}`, existing);
    }

    await writeTextAtomic(override, `${body}\n`);
    addLog("gui", "人设已保存，下一条消息生效");
  };

  const resetPersona = async (): Promise<void> => {
    const override = personaOverrideFile();
    const existing = await readText(override);
    if (!existing) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeText(`${override}.bak-${stamp}`, existing);
    await removePath(override);
    addLog("gui", "人设已恢复默认");
  };

  const openPersonaDir = async (): Promise<void> => {
    const currentPaths = pathsRef.current;
    if (!currentPaths) return;
    await ensureDir(currentPaths.root);
    await openPath(currentPaths.root);
  };

  return {
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
  };
};
