import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface IKnownUser {
  userId: string;
  channel: "qq" | "web";
  lastSeen: number;
  lastProactiveAt?: number;
  /** 本地日期 YYYY-MM-DD，用来实现“每天最多 N 次” */
  proactiveDate?: string;
  proactiveCount?: number;
}

const filePath = join(config.paths.dataDir, "users.json");

const dayKey = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 今天已经主动找过几次；兼容旧文件里只有 lastProactiveAt 的记录 */
export const proactiveCountFor = (
  user: IKnownUser,
  now = new Date(),
): number => {
  const today = dayKey(now);
  if (user.proactiveDate === today) return user.proactiveCount ?? 0;

  // 旧版本每天只发一次：lastProactiveAt 在今天就算已经发过 1 次
  if (
    user.lastProactiveAt &&
    dayKey(new Date(user.lastProactiveAt)) === today
  ) {
    return 1;
  }

  return 0;
};

const readAll = (): IKnownUser[] => {
  try {
    if (!existsSync(filePath)) return [];
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? (parsed as IKnownUser[]) : [];
  } catch (e) {
    console.error("[users] 读取失败", e);
    return [];
  }
};

const writeAll = (list: IKnownUser[]) => {
  try {
    writeJsonAtomic(filePath, list);
  } catch (e) {
    console.error("[users] 写入失败", e);
  }
};

export const touchUser = (userId: string, channel: "qq" | "web") => {
  const list = readAll();
  const found = list.find((u) => u.userId === userId && u.channel === channel);
  if (found) {
    found.lastSeen = Date.now();
  } else {
    list.push({ userId, channel, lastSeen: Date.now() });
  }
  writeAll(list);
};

export const listUsers = (): IKnownUser[] => readAll();

export const markProactive = (
  userId: string,
  channel: "qq" | "web",
  now = new Date(),
) => {
  const list = readAll();
  const found = list.find((u) => u.userId === userId && u.channel === channel);
  if (found) {
    const today = dayKey(now);
    found.lastProactiveAt = now.getTime();
    found.proactiveCount =
      found.proactiveDate === today ? (found.proactiveCount ?? 0) + 1 : 1;
    found.proactiveDate = today;
    writeAll(list);
  }
};
