import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import type { IMessage } from "../types/message.js";

const filePath = join(config.paths.dataDir, "history.json");

type HistoryFile = Record<string, IMessage[]>;

const readAll = (): HistoryFile => {
  try {
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as HistoryFile;
  } catch (e) {
    console.error("[history] 读取失败，按空历史处理", e);
    return {};
  }
};

/** 读某个用户的对话；system 不落盘，由调用方现拼 */
export const loadHistory = (userId: string): IMessage[] => {
  const list = readAll()[userId];
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m.role !== "system");
};

/** 存某个用户的对话；只保留最近 N 条（N = config.historyWindow） */
export const saveHistory = (userId: string, messages: IMessage[]): void => {
  const trimmed = messages
    .filter((m) => m.role !== "system")
    .slice(-config.historyWindow);

  const all = readAll();
  all[userId] = trimmed;

  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    console.error("[history] 写入失败", e);
  }
};
