import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface IMemory {
  /** 老的对话压成的一段话 */
  summary: string;
  /** 关于主人的稳定事实，一行一条 */
  facts: string[];
  updatedAt: number;
}

const dir = join(config.paths.dataDir, "memory");

const fileOf = (userId: string) => join(dir, `${userId}.json`);

const EMPTY: IMemory = { summary: "", facts: [], updatedAt: 0 };

export const loadMemory = (userId: string): IMemory => {
  try {
    if (!existsSync(fileOf(userId))) return { ...EMPTY };
    const parsed = JSON.parse(readFileSync(fileOf(userId), "utf8"));
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      updatedAt: Number(parsed.updatedAt ?? 0),
    };
  } catch (e) {
    console.error("[memory] 读取失败", e);
    return { ...EMPTY };
  }
};

export const saveMemory = (userId: string, mem: IMemory): void => {
  try {
    writeJsonAtomic(fileOf(userId), mem);
  } catch (e) {
    console.error("[memory] 写入失败", e);
  }
};

/** 拼进 system 的记忆块；没有就返回空串 */
export const renderMemory = (
  mem: IMemory,
  ownerName = "主人",
): string => {
  const parts: string[] = [];
  if (mem.summary.trim()) parts.push(`【你们之前的经历】${mem.summary.trim()}`);
  if (mem.facts.length > 0) {
    parts.push(
      `【关于${ownerName.trim() || "主人"}】${mem.facts.map((f) => `- ${f}`).join("\n")}`,
    );
  }
  return parts.join("\n");
};
