import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { config } from "../config.js";
import type { IMessage } from "../types/message.js";
import { writeFileAtomic, writeJsonAtomic } from "./atomic.js";

const filePath = join(config.paths.dataDir, "history.json");

type HistoryFile = Record<string, IMessage[]>;

/**
 * 每用户的历史版本号：进程内单调递增。
 * 摘要生成期间如果用户又发了消息、执行了 /new 或 /forget，
 * 版本号会变化，摘要就放弃写回，避免覆盖新数据。
 */
const epochs = new Map<string, number>();

export const historyEpoch = (userId: string): number =>
  epochs.get(userId) ?? 0;

export const bumpHistoryEpoch = (userId: string): void => {
  epochs.set(userId, historyEpoch(userId) + 1);
};

const readHistoryFile = (file: string): HistoryFile => {
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as HistoryFile;
  } catch (e) {
    console.error("[history] 读取失败，按空历史处理", e);
    return {};
  }
};

const readAll = (): HistoryFile => readHistoryFile(filePath);

/** 读某个用户的对话；system 不落盘，由调用方现拼 */
export const loadHistory = (userId: string): IMessage[] => {
  const list = readAll()[userId];
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m.role !== "system");
};

/** 存某个用户的对话；只保留最近 N 条（N = config.history.store） */
export const saveHistory = (userId: string, messages: IMessage[]): void => {
  // 先 bump：哪怕这次写盘失败，也说明有人尝试改过历史，摘要不该再覆盖
  bumpHistoryEpoch(userId);

  const trimmed = messages
    .filter((m) => m.role !== "system")
    .slice(-config.history.store);

  const all = readAll();
  all[userId] = trimmed;

  try {
    writeJsonAtomic(filePath, all);
  } catch (e) {
    console.error("[history] 写入失败", e);
  }
};

export interface IHistorySanitizeResult {
  /** 被改写的消息条数 */
  changed: number;
  /** 涉及的用户数 */
  users: number;
  /** 改动前的备份文件；没有改动时为 null */
  backup: string | null;
}

/**
 * 清理历史里遗留的平台标记（例如旧版本写进去的 `<faceType=...>`）。
 * 只在确实有改动时备份并重写，重复执行是安全的。
 * cleaner 由调用方注入，store 不关心是哪个平台的标记。
 */
export const sanitizeHistoryFile = (
  file: string,
  cleaner: (text: string) => string,
): IHistorySanitizeResult => {
  if (!existsSync(file)) return { changed: 0, users: 0, backup: null };

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(
      `读取历史失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let parsed: HistoryFile;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { changed: 0, users: 0, backup: null };
    }
    parsed = value as HistoryFile;
  } catch (e) {
    // 坏文件不覆盖：宁可保留现场，也不能把用户的历史清空
    console.error(
      "[history] 清理时发现 JSON 无效，跳过：",
      e instanceof Error ? e.message : String(e),
    );
    return { changed: 0, users: 0, backup: null };
  }

  let changed = 0;
  const changedUsers = new Set<string>();
  const next: HistoryFile = {};

  for (const [userId, messages] of Object.entries(parsed)) {
    if (!Array.isArray(messages)) {
      next[userId] = messages;
      continue;
    }

    next[userId] = messages.map((message) => {
      if (typeof message.content !== "string") return message;

      const cleaned = cleaner(message.content);
      if (cleaned === message.content) return message;

      changed += 1;
      changedUsers.add(userId);
      return { ...message, content: cleaned };
    });
  }

  if (changed === 0) return { changed: 0, users: 0, backup: null };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.bak-${stamp}`;

  writeFileAtomic(backup, raw);
  writeJsonAtomic(file, next);
  pruneBackups(file, 5);

  return { changed, users: changedUsers.size, backup };
};

/** 历史迁移备份只保留最近几份，避免长期运行后目录膨胀 */
const pruneBackups = (file: string, keep: number): void => {
  try {
    const dir = dirname(file);
    const prefix = `${basename(file)}.bak-`;
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort();

    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
      unlinkSync(join(dir, name));
    }
  } catch (e) {
    console.error("[history] 清理旧备份失败", e);
  }
};
