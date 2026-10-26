import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { config } from "../config.js";
import { writeJsonAtomic } from "./atomic.js";

export interface ISticker {
  id: string;
  file: string;
  mime: string;
  tags: string[];
  createdAt: number;
}

const dir = join(config.paths.dataDir, "stickers");
const indexPath = join(dir, "index.json");

const readIndex = (): ISticker[] => {
  try {
    if (!existsSync(indexPath)) return [];
    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    return Array.isArray(parsed) ? (parsed as ISticker[]) : [];
  } catch (e) {
    console.error("[stickers] 索引读取失败", e);
    return [];
  }
};

/** 写失败返回 false，由调用方决定回滚；不再把异常直接抛给无关流程 */
const writeIndex = (list: ISticker[]): boolean => {
  try {
    writeJsonAtomic(indexPath, list);
    return true;
  } catch (e) {
    console.error("[stickers] 索引写入失败", e);
    return false;
  }
};

const extOf = (mime: string): string => {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpg";
};

/** 收一张图进图库（标签可以先空着，后台补） */
export const ingestSticker = (
  bytes: Uint8Array,
  mime: string,
  tags: string[],
): ISticker => {
  mkdirSync(dir, { recursive: true });

  const id = randomUUID();
  const file = `${id}.${extOf(mime)}`;
  const target = join(dir, file);
  const temp = `${target}.${process.pid}.tmp`;

  try {
    // 先写临时文件再 rename，避免崩溃时留下半张图
    writeFileSync(temp, bytes);
    renameSync(temp, target);

    const sticker: ISticker = { id, file, mime, tags, createdAt: Date.now() };
    const list = readIndex();
    list.push(sticker);

    if (!writeIndex(list)) {
      // 索引没写成功就不留孤儿文件
      rmSync(target, { force: true });
      throw new Error("表情包索引写入失败");
    }

    return sticker;
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

export const listStickers = (): ISticker[] => readIndex();

/** 后台打标完成后回填；图已经被删了就静默跳过 */
export const updateStickerTags = (id: string, tags: string[]): void => {
  const list = readIndex();
  const found = list.find((s) => s.id === id);
  if (!found) return;

  found.tags = tags;
  writeIndex(list);
};

export const listUntaggedStickers = (): ISticker[] =>
  readIndex().filter((s) => s.tags.length === 0);

export const readSticker = (sticker: ISticker): Buffer =>
  readFileSync(join(dir, sticker.file));
