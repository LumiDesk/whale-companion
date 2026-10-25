import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface IKnownUser {
  userId: string;
  channel: "qq" | "web";
  lastSeen: number;
  lastProactiveAt?: number;
}

const filePath = join(config.paths.dataDir, "users.json");

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

export const markProactive = (userId: string, channel: "qq" | "web") => {
  const list = readAll();
  const found = list.find((u) => u.userId === userId && u.channel === channel);
  if (found) {
    found.lastProactiveAt = Date.now();
    writeAll(list);
  }
};
