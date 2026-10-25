import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const filePath = fileURLToPath(
  new URL("../../data/history.json", import.meta.url),
);

// 每个用户最多保留多少条（含 system）
const MAX_KEEP = 10000;

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

export const loadHistory = (userId: string): IMessage[] => {
  const list = readAll()[userId];
  return Array.isArray(list) ? list : [];
};

export const saveHistory = (userId: string, messages: IMessage[]): void => {
  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const room = MAX_KEEP - (system ? 1 : 0);
  const trimmed = [...(system ? [system] : []), ...rest.slice(-room)];

  const all = readAll();
  all[userId] = trimmed;

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    console.error("[history] 写入失败", e);
  }
};
