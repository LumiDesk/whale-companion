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

/**
 * 用户列表缓存 + 写入节流。
 * 每条消息都 touchUser，但 users.json 不需要每条消息都落盘；
 * 5 秒合并一次，主动消息这种关键写入则立即 flush。
 */
let cache: IKnownUser[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const load = (): IKnownUser[] => {
  if (cache) return cache;

  try {
    if (!existsSync(filePath)) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    cache = Array.isArray(parsed) ? (parsed as IKnownUser[]) : [];
    return cache;
  } catch (e) {
    console.error("[users] 读取失败", e);
    cache = [];
    return cache;
  }
};

const flush = (): void => {
  if (!cache) return;

  try {
    writeJsonAtomic(filePath, cache);
  } catch (e) {
    console.error("[users] 写入失败", e);
  }
};

export const flushUsers = (): void => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
};

const scheduleFlush = (): void => {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 5000);

  // 测试/退出时不要因为这个定时器挂住进程
  flushTimer.unref?.();
};

export const touchUser = (userId: string, channel: "qq" | "web") => {
  const list = load();
  const found = list.find((u) => u.userId === userId && u.channel === channel);
  if (found) {
    found.lastSeen = Date.now();
  } else {
    list.push({ userId, channel, lastSeen: Date.now() });
  }

  scheduleFlush();
};

export const listUsers = (): IKnownUser[] => load();

export const markProactive = (
  userId: string,
  channel: "qq" | "web",
  now = new Date(),
) => {
  const list = load();
  const found = list.find((u) => u.userId === userId && u.channel === channel);
  if (!found) return;

  const today = dayKey(now);
  found.lastProactiveAt = now.getTime();
  found.proactiveCount =
    found.proactiveDate === today ? (found.proactiveCount ?? 0) + 1 : 1;
  found.proactiveDate = today;

  flushUsers();
};
